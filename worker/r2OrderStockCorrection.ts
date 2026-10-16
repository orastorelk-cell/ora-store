import { canonicalJson } from '../src/lib/confirmCsvSave';
import { stockItemQuantities, STOCK_QUANTITY_PREFIX, activeOrderPackingLock } from '../src/lib/orderStockQuantities';
import { physicalReturnItems, inventoryReturnTarget, returnPackingInProgress } from '../src/lib/returnSheets';
import { readDataTable, mutateDataTable } from './cloudflareData';
import { cancellationInProgress, cancellationSummary } from './r2OrderCancellation';

type Row = Record<string, any>;
const KEY = 'storefront-state-v1';
const fail = (message: string, status = 409): never => { const error: any = new Error(message); error.status = status; throw error; };
const orderAt = (rows: readonly Row[], id: string) => {
  const matches = rows.filter(row => String(row.order_id) === id && String(row.payload?.id) === id);
  if (matches.length !== 1) fail('Order not uniquely found.', 404);
  return matches[0];
};
export const stockCorrectionIdentity = (order: Row) => canonicalJson(Object.fromEntries([
  'id','order_number','items','stock_allocated','stock_status','stock_quantity_correction','waybill_number',
  'invoice_number','invoice_locked','invoice_generated_at','invoice_pack_batch_id','invoice_confirm_snapshot',
  'return_status','return_sheet_id','return_tracking_waybill','return_received_at',
].map(field => [field, order[field] ?? null])));

const eligible = (order: Row, admin: readonly Row[], orders: readonly Row[]) => {
  if (order.stock_allocated !== true || !order.invoice_locked || !order.invoice_number) fail('Use an existing invoiced order with deducted stock.');
  if (order.order_status === 'Cancelled' || order.cancel_stock_restore || order.is_duplicate_order || order.is_test_order || order.is_replacement_order)
    fail('This order cannot receive a stock quantity correction.');
  if (order.return_sheet_id || order.return_tracking_waybill || order.return_received_at || (order.return_status && order.return_status !== 'None') ||
      /return|\brtn\b/i.test(String(order.delivery_status || '') + ' ' + String(order.tracking_status || '')))
    fail('This order has return history. Check its items through Return Sheets.');
  if (order.variant_correction_lock || order.stock_quantity_correction_lock || activeOrderPackingLock(order, admin)) fail('An operation is finishing for this order. Retry its saved request first.');
  if (orders.some(row => row.payload?.replacement_of_order_id === order.id && row.payload?.order_status !== 'Cancelled'))
    fail('An active missing-item replacement already exists. Review it before releasing this order stock.');
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 100 ||
      order.items.some((item: Row) => !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1_000_000)) fail('The original item quantities require review.');
  stockItemQuantities(order as any);
};
const owner = (orders: readonly Row[], locks: readonly Row[], order: Row) => {
  const wb = String(order.waybill_number || '').trim();
  if (!wb || orders.some(row => String(row.order_id) !== String(order.id) && String(row.payload?.waybill_number || '').trim() === wb)) fail('An exclusive current waybill is required.');
  const matches = locks.filter(row => String(row.waybill_number || '').trim() === wb);
  if (matches.length !== 1 || !['Assigned','Used'].includes(matches[0].status) || matches[0].permanently_retired ||
      String(matches[0].assigned_order_number) !== String(order.order_number) ||
      (matches[0].assigned_order_id && String(matches[0].assigned_order_id) !== String(order.id))) fail('The waybill must belong exclusively to this order.');
};
const changesFor = (order: Row, products: Row[], quantities: number[]) => {
  if (quantities.length !== order.items.length || quantities.some((qty, index) => !Number.isSafeInteger(qty) || qty < 0 || qty > order.items[index].quantity))
    fail('Enter a whole quantity from zero to the original quantity for every item.', 400);
  if (canonicalJson(quantities) === canonicalJson(stockItemQuantities(order as any))) fail('The stock quantities have not changed.');
  const before = physicalReturnItems(order), after = physicalReturnItems({...order, stock_quantity_correction: {item_quantities: quantities}});
  const deltas = new Map(before.map(item => [item.id, {...item, delta: item.expected_qty}]));
  for (const item of after) {
    const prior = deltas.get(item.id);
    if (prior) prior.delta -= item.expected_qty; else deltas.set(item.id, {...item, delta: -item.expected_qty});
  }
  const changes = [...deltas.values()].filter(item => item.delta);
  for (const item of changes) {
    const {target} = inventoryReturnTarget(products, item), stock = Number(target.stock_quantity || 0);
    if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(stock + item.delta) || stock + item.delta < 0)
      fail('Insufficient available stock for ' + item.sku + '. Nothing was changed.');
    if (target.return_stock_debt) fail('Resolve the return stock balance for ' + item.sku + ' before correcting this order.');
  }
  return changes;
};

// A journal and catalog share a conditional R2 transaction. The order lock
// prevents stale mirrors while stock is saved; a replay resumes each step once.
export const correctOrderStockQuantities = async (env: unknown, input: Row, actor: string) => {
  const id = input.order_id, operation = input.operation_id, key = STOCK_QUANTITY_PREFIX + operation;
  const orders = await readDataTable(env, 'order_snapshots'), initial = orderAt(orders, id).payload;
  const locks = await readDataTable(env, 'courier_waybills'), requestIdentity = canonicalJson(input);
  const adminBefore = await readDataTable(env, 'admin_data_store');
  let journal = await mutateDataTable(env, 'admin_data_store', rows => {
    const saved = rows.find(row => row.key === key);
    if (saved) {
      if (saved.payload.request_identity !== requestIdentity) fail('The saved correction request changed.');
      if (saved.payload.phase === 'failed') fail('Reload the current order before making a new correction.');
      return saved.payload;
    }
    if (returnPackingInProgress(rows) || cancellationInProgress(rows)) fail('A stock batch is finishing. Retry its saved request first.');
    eligible(initial, rows, orders); owner(orders, locks, initial);
    if (stockCorrectionIdentity(initial) !== input.expected_identity || String(initial.waybill_number) !== input.waybill_number) fail('The order changed. Search for its current details again.');
    const products = rows.find(row => row.key === KEY)?.payload?.products;
    if (!Array.isArray(products)) fail('The stock catalog is unavailable.');
    const changes = changesFor(initial, products, input.item_quantities), at = new Date().toISOString();
    const payload = {phase: 'pending', operation_id: operation, order_id: id, order_number: initial.order_number,
      waybill_number: initial.waybill_number, request_identity: requestIdentity, expected_identity: input.expected_identity,
      item_quantities: input.item_quantities, previous_quantities: stockItemQuantities(initial as any),
      revision: Number(initial.stock_quantity_correction?.revision || 0) + 1, changes, actor, reason: input.reason.trim(), created_at: at};
    rows.push({key, payload, updated_at: at}); return payload;
  });
  if (journal.phase === 'complete') return {order: orderAt(await readDataTable(env, 'order_snapshots'), id).payload, stock_history: journal.stock_history, already_saved: true};
  try {
    await mutateDataTable(env, 'order_snapshots', rows => {
      const row = orderAt(rows, id), order = row.payload;
      if (order.stock_quantity_correction?.operation_id === operation || order.stock_quantity_correction_lock === operation) return;
      eligible(order, adminBefore, rows); owner(rows, locks, order);
      if (stockCorrectionIdentity(order) !== journal.expected_identity) fail('The order changed before the correction started.');
      row.payload = {...order, stock_quantity_correction_lock: operation}; row.updated_at = new Date().toISOString();
    });
    journal = await mutateDataTable(env, 'admin_data_store', rows => {
      const entry = rows.find(row => row.key === key)!;
      if (entry.payload.stock_applied) return entry.payload;
      const catalog = rows.find(row => row.key === KEY), products = catalog?.payload?.products;
      if (!Array.isArray(products)) fail('The stock catalog is unavailable.');
      const changes = changesFor(initial, products, journal.item_quantities);
      if (canonicalJson(changes) !== canonicalJson(journal.changes)) fail('The allocated items changed. Retry the saved request.');
      const at = new Date().toISOString();
      const stock_history = changes.map((item, index) => {
        const {product, target} = inventoryReturnTarget(products, item), before = Number(target.stock_quantity || 0), after = before + item.delta;
        target.stock_quantity = after; target.status = after > 0 ? 'Active' : 'Out of Stock';
        if (item.variant_id) {
          product.stock_quantity = product.variants.reduce((sum: number, variant: Row) => sum + Number(variant.stock_quantity || 0), 0);
          product.status = product.stock_quantity > 0 ? 'Active' : 'Out of Stock';
        }
        return {id: key + ':' + index, product_id: item.product_id, variant_id: item.variant_id, sku: String(target.sku || product.sku || item.sku), product_name: item.name,
          change_type: 'Adjustment', quantity: Math.abs(item.delta), previous_stock: before, new_stock: after,
          reason: 'Actual quantity correction: ' + journal.order_number + ' / ' + journal.waybill_number + ' • ' + journal.reason, performed_by: journal.actor, created_at: at};
      });
      catalog!.payload.version = Number(catalog!.payload.version || 1) + 1; catalog!.payload.updated_at = at; catalog!.updated_at = at;
      entry.payload = {...entry.payload, phase: 'stock_saved', stock_applied: true, stock_history}; entry.updated_at = at; return entry.payload;
    });
    const order = await mutateDataTable(env, 'order_snapshots', rows => {
      const row = orderAt(rows, id), order = row.payload;
      if (order.stock_quantity_correction?.operation_id === operation) return order;
      if (order.stock_quantity_correction_lock !== operation || stockCorrectionIdentity(order) !== journal.expected_identity) fail('The stock correction lock changed. Retry this saved request.');
      const updated = {...order, stock_quantity_correction: {operation_id: operation, revision: journal.revision, item_quantities: journal.item_quantities,
        corrected_at: new Date().toISOString(), corrected_by: journal.actor, reason: journal.reason}};
      delete updated.stock_quantity_correction_lock;
      // No invoice, batch, order item, amount, dispatch or waybill fields change.
      row.payload = updated; row.updated_at = new Date().toISOString(); return updated;
    });
    await mutateDataTable(env, 'admin_data_store', rows => { const entry = rows.find(row => row.key === key)!; if (entry.payload.phase !== 'complete') {entry.payload.phase = 'complete'; entry.updated_at = new Date().toISOString();} });
    return {order, stock_history: journal.stock_history, already_saved: false};
  } catch (error: any) {
    if (error.status === 409 && !(await readDataTable(env, 'admin_data_store')).find(row => row.key === key)?.payload?.stock_applied) {
      await mutateDataTable(env, 'order_snapshots', rows => { const row = orderAt(rows, id); if (row.payload.stock_quantity_correction_lock === operation) {delete row.payload.stock_quantity_correction_lock; row.updated_at = new Date().toISOString();} });
      await mutateDataTable(env, 'admin_data_store', rows => { const entry = rows.find(row => row.key === key)!; entry.payload.phase = 'failed'; entry.updated_at = new Date().toISOString(); });
    }
    throw error;
  }
};

export const r2OrderStockCorrectionHandler = async (request: Request, env: unknown, user: Row) => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
  if (user.role !== 'admin') return json({error: 'Super Admin access is required.'}, 403);
  try {
    if (request.method === 'GET') {
      const search = String(new URL(request.url).searchParams.get('search') || '').trim();
      if (!search || search.length > 150) return json({error: 'Enter an exact order ID or waybill.'}, 400);
      const orders = await readDataTable(env, 'order_snapshots');
      const matches = orders.filter(row => [row.order_id, row.payload?.order_number, row.payload?.waybill_number].some(value => String(value || '').toUpperCase() === search.toUpperCase()));
      if (matches.length !== 1) return json({error: matches.length ? 'Search matches multiple orders. Use the exact Order ID.' : 'Order not found.'}, matches.length ? 409 : 404);
      const order = matches[0].payload, admin = await readDataTable(env, 'admin_data_store');
      let correctionError = '';
      try {eligible(order, admin, orders); owner(orders, await readDataTable(env, 'courier_waybills'), order);} catch (error: any) {correctionError = error.message;}
      const cancellation = await cancellationSummary(env, String(order.id), String(order.waybill_number || '').trim());
      const quantities = stockItemQuantities(order);
      return json({ok: true, order: {id: order.id, order_number: order.order_number, order_status: order.order_status, waybill_number: order.waybill_number,
        invoice_number: order.invoice_number, invoice_pack_batch_id: order.invoice_pack_batch_id, items: order.items, stock_quantity_correction: order.stock_quantity_correction},
        expected_identity: stockCorrectionIdentity(order), item_quantities: quantities, can_correct: !correctionError, correction_error: correctionError, cancellation,
        stock_history: order.stock_quantity_correction ? admin.find(row => row.key === STOCK_QUANTITY_PREFIX + order.stock_quantity_correction.operation_id)?.payload?.stock_history || [] : []});
    }
    const input: any = await request.json().catch(() => null);
    if (!input || typeof input.order_id !== 'string' || !input.order_id || input.order_id.length > 150 ||
        !/^[A-Za-z0-9_-]{16,100}$/.test(input.operation_id || '') || typeof input.expected_identity !== 'string' || input.expected_identity.length > 250000 ||
        typeof input.waybill_number !== 'string' || input.waybill_number.length > 100 || !Array.isArray(input.item_quantities) || input.item_quantities.length > 100 ||
        input.item_quantities.some((qty: any) => typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty < 0 || qty > 1_000_000) ||
        typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) return json({error: 'The current order, valid item quantities and correction reason are required.'}, 400);
    return json({ok: true, ...await correctOrderStockQuantities(env, input, String(user.display_name || user.username || 'Super Admin'))});
  } catch (error: any) { return json({error: error.message || 'Correction did not finish. Retry the saved request.', retry_safe: true}, Number(error.status || 503)); }
};
