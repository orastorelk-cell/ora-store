import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { configureCloudflareData, dataBucket, importRecovery, readDataTable, mutateDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { returnPackingCsv } from '../src/lib/returnExports';
import { runAuthorizedOrder659Correction, ORDER659_CORRECTION_OPERATION } from '../worker/authorizedOrder659Correction';

class MemoryBucket {
  objects = new Map<string, { value: string; etag: string }>(); revision = 0; failFinalOrder = false; orderWrites = 0;
  async get(key: string) { const row = this.objects.get(key); return row ? { text: async () => row.value, etag: row.etag } : null; }
  async put(key: string, value: string, options: any = {}) {
    const current = this.objects.get(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== current?.etag) return null;
    if (options.onlyIf?.etagDoesNotMatch === '*' && current) return null;
    if (key.endsWith('/order_snapshots.json')) { this.orderWrites++; if (this.failFinalOrder && this.orderWrites >= 3) throw new Error('Simulated lost order save after stock commit'); }
    const row = { value, etag: String(++this.revision) }; this.objects.set(key, row); return { etag: row.etag };
  }
}
const setup = async () => {
  const raw = new MemoryBucket(), env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: 'variant-fixture-secret' };
  configureCloudflareData(env);
  const variants = ['Maroon','Grey','Black'].map((name, index) => ({ id: name.toLowerCase(), sku: 'R0008-' + name.toUpperCase(), option_value: name,
    stock_quantity: [5,6,5][index], selling_price: 900, buying_price: 500, status: 'Active' }));
  const items = ['maroon','grey','maroon'].map((id, index) => ({ id: 'item-' + index, product_id: 'bag', product_type: 'variant', main_sku: 'R0008',
    sku: 'R0008-' + id.toUpperCase(), product_name: 'Lunch Bag', variant_id: id, variant_name: variants.find(v => v.id === id)!.option_value,
    quantity: 1, unit_price: 900, buying_price: 500, subtotal: 900 }));
  const order = { id: 'order-659', order_number: 'FB-000659', customer_name: 'Synthetic fixture', created_at: '2026-10-14T00:29:27Z',
    order_status: 'Processing', return_status: 'None', call_center_status: 'Confirmed', stock_allocated: true, stock_status: 'Allocated', stock_allocated_at: '2026-10-14T14:21:21Z',
    waybill_number: '18160741', fardar_csv_exported_waybill: '18160741', invoice_number: 'INV-FB-000659', invoice_locked: true, invoice_generated_at: '2026-10-14T14:21:33Z',
    invoice_pack_batch_id: 'PACK-SHEET-fixture', invoice_pack_downloaded_at: '2026-10-14T14:22:00Z', subtotal: 2700, total_amount: 2450,
    special_offer_discount: 500, delivery_fee: 250, payment_method: 'COD', items, sheet_confirm_import: { operation_id: 'sheet-fixture' },
    invoice_confirm_snapshot: { final_total: 2450, normal_total: 2700, discount: 500, delivery_fee: 250, items: items.map(item => ({ item_code: item.sku, variant: item.variant_name, qty: 1, unit_price: 900, line_total: 900 })) } };
  const other = { ...order, id: 'other', order_number: 'FB-000658', waybill_number: '18160740', invoice_number: 'INV-OTHER' };
  await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders: [order, other],
    admin_users: [{ id: 'admin', role: 'admin', username: 'admin', is_active: true }, { id: 'staff', role: 'staff', is_active: true }],
    admin_data_store: [{ key: 'storefront-state-v1', payload: { version: 1, products: [{ id: 'bag', sku: 'R0008', name_en: 'Lunch Bag', product_type: 'variant', stock_quantity: 16, variants }], categories: [], settings: {} } }],
    courier_waybills: [{ waybill_number: '18160741', status: 'Assigned', assigned_order_number: order.order_number }, { waybill_number: '18160740', status: 'Assigned', assigned_order_number: other.order_number }] });
  const token = (sub = 'admin') => { const payload = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 60000 })).toString('base64url'); return payload + '.' + crypto.createHmac('sha256', env.STAFF_SESSION_SECRET).update(payload).digest('base64url'); };
  const request = async (path: string, options: RequestInit = {}, auth = token()) => {
    const response = await withR2DataFallback(new Request('https://fixture' + path, { ...options, headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' } }), env, {}, async () => new Response('{}', { status: 599 }));
    return { status: response.status, body: await response.json() as any };
  };
  const preview = async () => (await request('/api/orders/variant-correction?order_id=' + order.id)).body;
  const input = async () => ({ order_id: order.id, operation_id: crypto.randomUUID(), expected_identity: (await preview()).expected_identity, waybill_number: order.waybill_number, variant_ids: ['maroon','grey','black'], reason: 'Maroon 1 / Black 1 / Gray 1' });
  const post = (body: any) => request('/api/orders/variant-correction', { method: 'POST', body: JSON.stringify(body) });
  const current = async () => (await readDataTable(env, 'order_snapshots')).find(row => row.order_id === order.id)!.payload;
  const state = async () => (await request('/api/admin/storefront/state')).body.state;
  const stock = async () => (await state()).products[0].variants.map((v: any) => v.stock_quantity);
  return { raw, env, order, other, token, request, input, post, current, state, stock };
};

const f = await setup(), input = await f.input();
assert.equal((await f.request('/api/orders/variant-correction?order_id=order-659', {}, 'invalid')).status, 401);
assert.equal((await f.request('/api/orders/variant-correction?order_id=order-659', {}, f.token('staff'))).status, 403);
const result = await f.post(input); assert.equal(result.status, 200, JSON.stringify(result));
assert.deepEqual(await f.stock(), [6,6,4], 'Restore only one Maroon, deduct only one Black, leave Grey exact');
const corrected = await f.current();
assert.deepEqual(corrected.items.map((item: any) => item.variant_id), ['maroon','grey','black']);
assert.deepEqual(corrected.invoice_confirm_snapshot.items.map((item: any) => item.item_code), ['R0008-MAROON','R0008-GREY','R0008-BLACK']);
for (const field of ['invoice_number','waybill_number','subtotal','total_amount','special_offer_discount','delivery_fee','stock_allocated']) assert.deepEqual(corrected[field], (f.order as any)[field]);
assert.equal(corrected.invoice_pack_batch_id, 'PACK-CORRECTION-' + input.operation_id);
assert.equal(corrected.variant_correction.previous_batch_id, f.order.invoice_pack_batch_id);
assert.equal(corrected.variant_correction.previous_invoice_generated_at, f.order.invoice_generated_at);
assert.equal(corrected.invoice_pack_downloaded_at, undefined);
const csv = returnPackingCsv([corrected], {fardar_parcel_type: 'Parcel'});
assert.equal(csv.split('\r\n').length, 2, 'Fardar export contains exactly one parcel');
assert.ok(csv.includes('R0008-BLACK') && csv.includes('R0008-MAROON') && csv.includes('R0008-GREY'));
assert.equal(csv.match(/R0008-MAROON/g)?.length, 1, 'The corrected CSV cannot describe two Maroon units');
assert.ok(csv.includes('18160741,FB-000659,') && csv.endsWith(',2450,0'));
assert.deepEqual((await readDataTable(f.env, 'order_snapshots')).find(row => row.order_id === 'other')!.payload, f.other, 'Other orders remain exact');
const beforeReplay = JSON.stringify(await f.state());
assert.equal((await f.post(input)).body.already_saved, true);
assert.equal(JSON.stringify(await f.state()), beforeReplay, 'Lost-response replay does not write stock or history again');
assert.equal((await f.post({ ...input, variant_ids: ['black','grey','black'] })).status, 409);
assert.equal((await f.request('/api/orders/order-659', { method: 'PUT', body: JSON.stringify({ order: f.order }) })).status, 200);
assert.deepEqual((await f.current()).items, corrected.items, 'A stale Sheet/browser snapshot cannot undo corrected invoice colors');
assert.equal((await f.current()).invoice_pack_downloaded_at, undefined, 'A stale snapshot cannot restore obsolete print acknowledgement');
assert.equal((await f.state()).return_inventory.stockHistory.length, 2);

const crash = await setup(), resume = await crash.input(); crash.raw.failFinalOrder = true;
assert.equal((await crash.post(resume)).status, 503);
assert.deepEqual(await crash.stock(), [6,6,4]);
assert.equal((await crash.state()).return_inventory.allocation_paused, true);
assert.equal((await crash.request('/api/admin/storefront/state', { method: 'PUT', body: JSON.stringify({ ...(await crash.state()), expected_version: (await crash.state()).version }) })).status, 409, 'Catalog changes pause while stock/order correction is incomplete');
crash.raw.failFinalOrder = false;
assert.equal((await crash.post(resume)).status, 200);
assert.deepEqual(await crash.stock(), [6,6,4], 'Resume after a partial commit applies the stock delta once');
assert.equal((await crash.state()).return_inventory.allocation_paused, false);
assert.equal((await crash.state()).return_inventory.stockHistory.length, 2);

const shortage = await setup(), shortageInput = await shortage.input();
await mutateDataTable(shortage.env, 'admin_data_store', rows => { rows.find(row => row.key === 'storefront-state-v1')!.payload.products[0].variants[2].stock_quantity = 0; });
assert.equal((await shortage.post(shortageInput)).status, 409);
assert.deepEqual(await shortage.stock(), [5,6,0], 'Shortage cannot partially restore another color');
assert.deepEqual(await shortage.current(), shortage.order);
assert.equal((await shortage.state()).return_inventory.allocation_paused, false);
const dispatched = await setup();
await mutateDataTable(dispatched.env, 'order_snapshots', rows => { rows.find(row => row.order_id === 'order-659')!.payload.dispatch_status = 'Handed Over'; });
assert.equal((await dispatched.request('/api/orders/variant-correction?order_id=order-659')).status, 409);
for (const returnStatus of ['Pending Verification','Verified','Issue Found']) {
  const returned = await setup();
  await mutateDataTable(returned.env, 'order_snapshots', rows => { rows.find(row => row.order_id === 'order-659')!.payload.return_status = returnStatus; });
  assert.equal((await returned.request('/api/orders/variant-correction?order_id=order-659')).status, 409, 'Actual return history remains blocked: ' + returnStatus);
}
const exported = await setup();
await mutateDataTable(exported.env, 'order_snapshots', rows => { rows.find(row => row.order_id === 'order-659')!.payload.fardar_csv_exported_at = '2026-10-14T14:25:00Z'; });
assert.equal((await exported.request('/api/orders/variant-correction?order_id=order-659')).status, 409, 'An acknowledged CSV export remains blocked');
const mismatchedExport = await setup();
await mutateDataTable(mismatchedExport.env, 'order_snapshots', rows => { rows.find(row => row.order_id === 'order-659')!.payload.fardar_csv_exported_waybill = '18169999'; });
assert.equal((await mismatchedExport.request('/api/orders/variant-correction?order_id=order-659')).status, 409, 'A mismatched export waybill remains blocked');
const maintenance = await setup();
assert.equal((await runAuthorizedOrder659Correction(maintenance.env)).complete, true);
assert.deepEqual(await maintenance.stock(), [6,6,4]);
assert.equal((await maintenance.current()).invoice_pack_batch_id, 'PACK-CORRECTION-' + ORDER659_CORRECTION_OPERATION);
const maintenanceStock = JSON.stringify(await maintenance.state());
assert.equal((await runAuthorizedOrder659Correction(maintenance.env)).already_saved, true);
assert.equal(JSON.stringify(await maintenance.state()), maintenanceStock, 'Minute cron replays cannot alter another stock unit or batch');
console.log('PASS: exact variant stock/invoice correction, unchanged money and waybill, unrelated order preservation, authorization, retry after partial commit, stale browser protection, shortage and dispatch guards.');
