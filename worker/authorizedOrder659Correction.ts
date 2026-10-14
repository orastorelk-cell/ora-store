import { readDataTable } from './cloudflareData';
import { correctInvoicedVariants, variantCorrectionIdentity } from './r2VariantCorrection';
import { VARIANT_CORRECTION_PREFIX } from '../src/lib/returnSheets';

// One explicitly authorized operational repair. It is server-owned maintenance,
// never a public mutation route, and cannot select any other order or waybill.
export const ORDER659_CORRECTION_OPERATION = 'ora-fb000659-colorfix-20261014-v1';
export const runAuthorizedOrder659Correction = async (env: unknown) => {
  const admin = await readDataTable(env, 'admin_data_store');
  const journal = admin.find(row => row.key === VARIANT_CORRECTION_PREFIX + ORDER659_CORRECTION_OPERATION)?.payload;
  if (journal?.phase === 'complete') return { complete: true, batch_id: journal.batch_id, already_saved: true };
  if (journal?.phase === 'failed') throw new Error('FB-000659 correction requires review; no new operation will be started.');
  let input: any;
  if (journal) input = JSON.parse(journal.request_identity);
  else {
    const matches = (await readDataTable(env, 'order_snapshots')).filter(row => row.payload?.order_number === 'FB-000659');
    if (matches.length !== 1) throw new Error('FB-000659 must match exactly one current order.');
    const order = matches[0].payload;
    const expected = ['R0008-MAROON','R0008-GREY','R0008-MAROON'];
    if (String(order.waybill_number) !== '18160741' || order.invoice_number !== 'INV-FB-000659' || Number(order.total_amount) !== 2450 ||
      order.items?.length !== 3 || order.items.some((item: any, index: number) => String(item.sku).toUpperCase() !== expected[index] || item.quantity !== 1))
      throw new Error('FB-000659 no longer matches the authorized original invoice; stopped without changing stock.');
    const products = admin.find(row => row.key === 'storefront-state-v1')?.payload?.products || [];
    const codes = ['R0008-MAROON','R0008-GREY','R0008-BLACK'];
    const variant_ids = order.items.map((item: any, index: number) => {
      const product = products.find((product: any) => product.id === item.product_id);
      const variants = (product?.variants || []).filter((variant: any) => String(variant.sku).toUpperCase() === codes[index]);
      if (variants.length !== 1) throw new Error('FB-000659 exact color is unavailable: ' + codes[index]);
      return variants[0].id;
    });
    input = { order_id: order.id, operation_id: ORDER659_CORRECTION_OPERATION, expected_identity: variantCorrectionIdentity(order),
      waybill_number: '18160741', variant_ids, reason: 'User authorized Maroon 1 / Black 1 / Grey 1, the same waybill and a new invoice/Fardar batch.' };
  }
  const result = await correctInvoicedVariants(env, input, 'Super Admin authorized correction');
  return { complete: true, batch_id: result.order.invoice_pack_batch_id, already_saved: result.already_saved };
};
