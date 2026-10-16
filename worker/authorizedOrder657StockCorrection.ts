import { readDataTable } from './cloudflareData';
import { stockItemQuantities, STOCK_QUANTITY_PREFIX } from '../src/lib/orderStockQuantities';
import { correctOrderStockQuantities, stockCorrectionIdentity } from './r2OrderStockCorrection';

export const ORDER657_STOCK_OPERATION = 'ora-fb000657-stock-5-to-2-20261016-v1';
// User-authorized maintenance for one exact order and waybill. No public write
// endpoint or caller-selected order. A completed receipt is never applied again.
export const runAuthorizedOrder657StockCorrection = async (env: unknown) => {
  const admin = await readDataTable(env, 'admin_data_store');
  const journal = admin.find(row => row.key === STOCK_QUANTITY_PREFIX + ORDER657_STOCK_OPERATION)?.payload;
  if (journal?.phase === 'complete') return {complete: true, already_saved: true, stock_history: journal.stock_history};
  if (journal?.phase === 'failed') throw new Error('FB-000657 stock correction needs review; no new request was started.');
  let input: any;
  if (journal) input = JSON.parse(journal.request_identity);
  else {
    const matches = (await readDataTable(env, 'order_snapshots')).filter(row => row.payload?.order_number === 'FB-000657');
    if (matches.length !== 1) throw new Error('FB-000657 must match exactly one order.');
    const order = matches[0].payload, items = order.items || [];
    if (String(order.waybill_number) !== '18160739' || !items.length || items.some((item: any) => item.product_type === 'bundle' ||
        String(item.product_id) !== String(items[0].product_id) || String(item.variant_id || '') !== String(items[0].variant_id || '')) ||
        items.reduce((sum: number, item: any) => sum + Number(item.quantity), 0) !== 5)
      throw new Error('FB-000657 does not match five units of one exact item on waybill 18160739. No stock was changed.');
    if (order.stock_quantity_correction) {
      if (stockItemQuantities(order).reduce((sum, qty) => sum + qty, 0) === 2) return {complete: true, already_saved: true, stock_history: []};
      throw new Error('FB-000657 was already corrected differently. No stock was changed.');
    }
    let remaining = 2;
    const item_quantities = items.map((item: any) => {const qty = Math.min(remaining, item.quantity); remaining -= qty; return qty;});
    input = {order_id: String(order.id), operation_id: ORDER657_STOCK_OPERATION, expected_identity: stockCorrectionIdentity(order), waybill_number: '18160739', item_quantities,
      reason: 'User confirmed 5 ordered but only 2 dispatched; release the 3 warehouse-left units. Preserve the existing invoice and waybill.'};
  }
  const result = await correctOrderStockQuantities(env, input, 'Super Admin authorized stock correction');
  return {complete: true, already_saved: result.already_saved, stock_history: result.stock_history};
};
