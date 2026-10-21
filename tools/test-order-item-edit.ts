import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { configureCloudflareData, dataBucket, importRecovery, readDataTable, mutateDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { ORDER_ITEM_EDIT_API, ORDER_ITEM_EDIT_PREFIX, itemEditDraft } from '../src/lib/orderItemEdit';
import { returnPackingCsv } from '../src/lib/returnExports';
import { prepareOrderSnapshotUpdate } from '../src/lib/orderSnapshotUpdate';
import { invoiceReady } from '../src/lib/invoiceQueue';
import { applyFardarExportStatus } from '../src/lib/fardarExportStatus';
import { prepareCodPaymentUpdate } from '../src/lib/codPaymentImport';

class Bucket {
  objects = new Map<string, {value: string; etag: string; customMetadata: any}>(); revision = 0;
  orderWrites = 0; adminWrites = 0; failOrder = 0; failAdmin = 0; lostAdmin = false;
  async get(key: string) {const row = this.objects.get(key); await Promise.resolve(); return row ? {...row, text: async () => row.value} : null;}
  async put(key: string, value: string, options: any = {}) {
    if (key.endsWith('/order-changes-v1.json') && ++this.orderWrites >= this.failOrder && this.failOrder) throw new Error('Synthetic interrupted order write');
    if (key.endsWith('/admin-changes-v1.json') && ++this.adminWrites >= this.failAdmin && this.failAdmin) throw new Error('Synthetic interrupted admin write');
    const before = this.objects.get(key);
    if (options.onlyIf?.etagMatches && before?.etag !== options.onlyIf.etagMatches || options.onlyIf?.etagDoesNotMatch === '*' && before) return null;
    const next = {value, etag: String(++this.revision), customMetadata: options.customMetadata}; this.objects.set(key, next);
    if (this.lostAdmin && key.endsWith('/admin-changes-v1.json')) {this.lostAdmin = false; throw new Error('R2 put failed: (503) Service unavailable');}
    return {etag: next.etag};
  }
}
const setup = async (patch: any = {}) => {
  const raw = new Bucket(), env = {ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: 'synthetic-item-editor-secret', ORA_R2_COMPRESSION_ENABLED: '1'};
  configureCloudflareData(env);
  const products = [
    {id: 'colours', name_en: 'Lunch bag', sku: 'BAG', product_type: 'variant', stock_quantity: 8, variants: [
      {id: 'blue', sku: 'BAG-B', option_value: 'Blue', selling_price: 1100, buying_price: 500, stock_quantity: 5},
      {id: 'red', sku: 'BAG-R', option_value: 'Red', selling_price: 1100, buying_price: 550, stock_quantity: 3}]},
    {id: 'normal', name_en: 'Other item', sku: 'NORMAL', selling_price: 700, buying_price: 200, stock_quantity: 10},
    {id: 'combo', name_en: 'Combo', sku: 'COMBO', product_type: 'bundle', selling_price: 1500, buying_price: 900,
      bundle_components: [{product_id: 'colours', quantity: 1}, {product_id: 'normal', quantity: 2}]},
  ];
  const order: any = {id: 'order', order_number: 'FB-000001', customer_name: 'Synthetic customer', address: 'Synthetic address', city: 'Colombo',
    phone: '0770000000', order_status: 'Processing', call_center_status: 'Confirmed', payment_method: 'COD', payment_status: 'Pending',
    stock_allocated: true, stock_status: 'Allocated', invoice_locked: true, invoice_number: 'INV-1', invoice_pack_batch_id: 'PACK-ORIGINAL',
    invoice_generated_at: '2026-10-01T00:00:00Z', invoice_pack_downloaded_at: '2026-10-01T01:00:00Z',
    waybill_number: 'WB-1', fardar_csv_exported_at: '2026-10-01T01:30:00Z', fardar_csv_exported_waybill: 'WB-1',
    delivery_fee: 250, special_offer_discount: 100, subtotal: 1800, total_amount: 1950, created_at: '2026-10-01T00:00:00Z',
    items: [{product_id: 'colours', product_type: 'variant', product_name: 'Lunch bag', sku: 'BAG-B', main_sku: 'BAG', variant_id: 'blue', variant_name: 'Blue',
      quantity: 2, unit_price: 900, regular_unit_price: 1000, supplier_offer_discount_per_unit: 100, buying_price: 450, effective_buying_price: 450, subtotal: 1800}],
    invoice_confirm_snapshot: {normal_total: 2000, discount: 300, delivery_fee: 250, final_total: 1950, items: [{item_code: 'BAG-B', qty: 2, unit_price: 1000, line_total: 2000}]}, ...patch};
  const other = {...order, id: 'other', order_number: 'FB-000002', waybill_number: 'WB-2', invoice_number: 'INV-2'};
  await importRecovery(dataBucket(env)!, {format: 'ora-r2-recovery-v1', orders: [order, other],
    admin_users: [{id: 'admin', role: 'admin', display_name: 'Admin', is_active: true}, {id: 'staff', role: 'staff', is_active: true}],
    admin_data_store: [{key: 'storefront-state-v1', payload: {version: 1, products, categories: [{id: 'keep'}], settings: {invoice_logo: 'keep'}}}, {key: 'keep-record', payload: {unchanged: true}}],
    courier_waybills: [{waybill_number: 'WB-1', status: 'Assigned', assigned_order_number: order.order_number}, {waybill_number: 'WB-2', status: 'Assigned', assigned_order_number: other.order_number}]});
  const token = (sub: string) => {const payload = Buffer.from(JSON.stringify({sub, exp: Date.now() + 600_000})).toString('base64url'); return payload + '.' + crypto.createHmac('sha256', env.STAFF_SESSION_SECRET).update(payload).digest('base64url');};
  const call = async (body?: any, query = '?search=FB-000001', user = 'admin', path = ORDER_ITEM_EDIT_API, method = body ? 'POST' : 'GET') => {
    const response = await withR2DataFallback(new Request('https://fixture' + path + query, {method, headers: {authorization: 'Bearer ' + (user === 'bad' ? 'bad' : token(user)), 'content-type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}), env, {}, async () => new Response('{}', {status: 599}));
    return {status: response.status, body: await response.json() as any};
  };
  const current = async () => (await readDataTable(env, 'order_snapshots')).find(row => row.order_id === order.id)!.payload;
  const state = async () => (await readDataTable(env, 'admin_data_store')).find(row => row.key === 'storefront-state-v1')!.payload;
  const input = async () => {const p = (await call()).body; return {...p.draft, order_id: order.id, operation_id: crypto.randomUUID(), expected_identity: p.expected_identity, reason: 'Two different colours',
    items: [{...p.draft.items[0], quantity: 1}, {...p.draft.items[0], quantity: 1, variant_id: 'red'}]};};
  return {raw, env, order, other, call, current, state, input};
};
const f = await setup();
assert.equal((await f.call(undefined, '', 'bad')).status, 401);
assert.equal((await f.call(undefined, '?search=WB-1', 'staff')).status, 403);
assert.equal((await f.call(undefined, '?search=wb-1')).body.order.id, 'order');
assert.equal((await f.call(undefined, '?search=missing')).status, 404);
assert.equal((await f.call(undefined, '')).status, 400);
const input = await f.input(), originalLocks = await readDataTable(f.env, 'courier_waybills'), originalCatalog = await f.state();
const result = await f.call(input); assert.equal(result.status, 200, JSON.stringify(result));
const corrected = await f.current(), catalog = await f.state();
assert.deepEqual(catalog.products[0].variants.map((v: any) => v.stock_quantity), [6, 2]);
assert.equal(corrected.total_amount, 1950); assert.equal(corrected.subtotal, 1800);
assert.equal(corrected.items[0].buying_price, 450, 'Unchanged items retain historical buying cost');
assert.equal(corrected.items[1].buying_price, 550, 'Changed selection costs come from server catalog');
assert.deepEqual(corrected.items.map((i: any) => [i.variant_id, i.quantity]), [['blue', 1], ['red', 1]]);
assert.deepEqual(corrected.invoice_confirm_snapshot.items.map((i: any) => [i.item_code, i.qty]), [['BAG-B', 1], ['BAG-R', 1]]);
assert.equal(corrected.invoice_confirm_snapshot.normal_total - corrected.invoice_confirm_snapshot.discount + corrected.invoice_confirm_snapshot.delivery_fee, corrected.total_amount);
assert.equal(corrected.waybill_number, f.order.waybill_number); assert.equal(corrected.invoice_number, f.order.invoice_number);
assert.equal(corrected.invoice_pack_batch_id, 'PACK-EDIT-' + input.operation_id);
assert.equal(corrected.invoice_pack_downloaded_at, undefined); assert.equal(corrected.fardar_csv_exported_at, undefined);
assert.deepEqual(await readDataTable(f.env, 'courier_waybills'), originalLocks);
assert.deepEqual(catalog.products.slice(1), originalCatalog.products.slice(1));
assert.deepEqual(catalog.settings, originalCatalog.settings); assert.deepEqual(catalog.categories, originalCatalog.categories);
assert.deepEqual((await readDataTable(f.env, 'order_snapshots')).find(row => row.order_id === 'other')!.payload, f.other);
assert(returnPackingCsv([corrected], {fardar_parcel_type: 'Parcel'} as any).includes('WB-1,FB-000001,'));
assert.equal(result.body.stock_history.length, 2); assert(result.body.stock_history.every((row: any) => row.change_type === 'Adjustment'));
const revision = f.raw.revision; assert.equal((await f.call(input)).body.already_saved, true); assert.equal(f.raw.revision, revision);
assert.equal((await f.call({...input, items: [{...input.items[0], quantity: 5}]})).status, 409);
assert.equal((await f.call({order: f.order}, '', 'admin', '/api/orders/order', 'PUT')).status, 200);
assert.deepEqual((await f.current()).items, corrected.items, 'A stale order mirror cannot undo corrected items');
assert.equal((await f.current()).invoice_pack_downloaded_at, undefined);
const add = await f.input(), preview = (await f.call()).body;
Object.assign(add, {...preview.draft, items: [...preview.draft.items, {product_id: 'normal', quantity: 3, unit_price: 625.25}], expected_identity: preview.expected_identity});
assert.equal((await f.call(add)).status, 200);
assert.equal((await f.state()).products[1].stock_quantity, 7);
assert.equal((await f.current()).total_amount, 3825.75); assert.equal((await f.current()).items[2].buying_price, 200);
assert.equal((await f.call(input)).body.already_saved, true, 'An older replay does not reverse a later correction');
assert.equal((await f.current()).total_amount, 3825.75);

const waiting = await setup({stock_allocated: false, stock_status: 'Waiting for Stock', invoice_locked: false, invoice_number: undefined, invoice_pack_batch_id: undefined, waybill_number: undefined,
  fardar_csv_exported_at: undefined, fardar_csv_exported_waybill: undefined});
const waitingState = await waiting.state(), waitingInput = await waiting.input();
assert.equal((await waiting.call(waitingInput)).status, 200);
assert.deepEqual(await waiting.state(), waitingState, 'Unallocated items do not consume stock');
const unbilled = await waiting.current(); assert.equal(unbilled.invoice_locked, false); assert.equal(unbilled.invoice_number, undefined);
const nextInvoice = prepareOrderSnapshotUpdate(unbilled, {...unbilled, stock_allocated: true, invoice_locked: true, invoice_number: 'INV-NEW', invoice_generated_at: 'now', invoice_pack_batch_id: 'NEW'}, []);
assert.equal(nextInvoice.order.invoice_pack_batch_id, 'NEW', 'Normal later invoice generation remains possible');

const short = await setup(), shortageInput = await short.input();
await mutateDataTable(short.env, 'admin_data_store', rows => {rows.find(row => row.key === 'storefront-state-v1')!.payload.products[0].variants[1].stock_quantity = 0;});
const shortBefore = await short.state(); assert.equal((await short.call(shortageInput)).status, 409);
assert.deepEqual(await short.state(), shortBefore); assert.deepEqual(await short.current(), short.order);
for (const field of [{dispatch_status: 'Handed Over'}, {order_status: 'Cancelled'}, {order_status: 'Delivered'}, {return_sheet_id: 'sheet'}, {cod_payment_received: true}, {is_duplicate_order: true}]) {
  const blocked = await setup(field); assert.equal((await blocked.call()).body.can_edit, false);
}
const stale = await setup(), staleInput = await stale.input();
await mutateDataTable(stale.env, 'order_snapshots', rows => {rows.find(row => row.order_id === 'order')!.payload.total_amount += 1;});
assert.equal((await stale.call(staleInput)).status, 409);
for (const change of [{items: []}, {discount: 100_000}, {items: [{product_id: 'colours', quantity: 1, unit_price: 1}]}, {items: [{product_id: 'normal', quantity: 1.5, unit_price: 1}]}, {items: [{product_id: 'normal', quantity: 1, unit_price: 1.001}]}]) {
  const invalid = await setup(), before = await invalid.state(), request = {...await invalid.input(), ...change};
  assert([400,409].includes((await invalid.call(request)).status)); assert.deepEqual(await invalid.state(), before);
}

const bundle = await setup(), bundleInput = await bundle.input();
bundleInput.items = [{product_id: 'combo', quantity: 2, unit_price: 1500, bundle_variants: {'0': 'red'}}];
assert.equal((await bundle.call(bundleInput)).status, 200);
assert.deepEqual((await bundle.state()).products[0].variants.map((v: any) => v.stock_quantity), [7,1]);
assert.equal((await bundle.state()).products[1].stock_quantity, 6, 'Bundle stock comes from exact physical components');
const partial = await setup({stock_quantity_correction: {operation_id: 'earlier', item_quantities: [1]}});
assert.equal((await partial.call(await partial.input())).status, 200);
assert.deepEqual((await partial.state()).products[0].variants.map((v: any) => v.stock_quantity), [5,2], 'Use only the actual earlier stock consumption');
assert.equal((await partial.current()).stock_quantity_correction, undefined);

for (const boundary of ['before-stock','after-stock','after-order'] as const) {
  const crash = await setup(), action = await crash.input();
  if (boundary === 'before-stock') crash.raw.failAdmin = 2;
  if (boundary === 'after-stock') crash.raw.failOrder = 2;
  if (boundary === 'after-order') crash.raw.failAdmin = 3;
  const failed = await crash.call(action); assert.equal(failed.status, 503, boundary); assert.equal(failed.body.retry_required, true);
  const savedAdmin = await readDataTable(crash.env, 'admin_data_store');
  assert(!['complete','failed'].includes(savedAdmin.find(row => row.key === ORDER_ITEM_EDIT_PREFIX + action.operation_id)!.payload.phase));
  const held = await crash.current();
  if (held.item_edit_lock) {
    assert.equal(invoiceReady(held), false, 'A racing invoice/merge transaction cannot change a held parcel');
    const exportRequest = {entries: [{id: held.id, waybill: held.waybill_number, invoice_number: held.invoice_number, invoice_batch_id: held.invoice_pack_batch_id}],
      exported_at: new Date().toISOString(), exported_by: 'Synthetic staff', export_batch_id: 'SYNTHETIC-EXPORT'};
    assert.throws(() => applyFardarExportStatus([held], exportRequest), /finishing/);
    assert.throws(() => prepareCodPaymentUpdate(held as any, {waybill: held.waybill_number, status: 'delivered', amount: held.total_amount} as any), /finishing/);
    const exportResult = await crash.call(exportRequest, '', 'admin', '/api/orders/fardar-export-status');
    assert.equal(exportResult.status, 409, 'The native CSV acknowledgment cannot invalidate an interrupted item edit');
    assert.deepEqual(await crash.current(), held, 'Racing export leaves the saved recovery identity untouched');
  }
  crash.raw.failAdmin = 0; crash.raw.failOrder = 0;
  const resumed = await crash.call(action); assert.equal(resumed.status, 200, JSON.stringify(resumed));
  assert.deepEqual((await crash.state()).products[0].variants.map((v: any) => v.stock_quantity), [6,2], boundary + ': stock applied exactly once');
  assert.equal((await crash.current()).item_edit_lock, undefined);
  assert.equal((await readDataTable(crash.env, 'admin_data_store')).find(row => row.key === ORDER_ITEM_EDIT_PREFIX + action.operation_id)!.payload.phase, 'complete');
}
const concurrent = await setup(), action = await concurrent.input();
const responses = await Promise.all([concurrent.call(action), concurrent.call(action)]);
assert(responses.every(response => response.status === 200), JSON.stringify(responses));
assert.deepEqual((await concurrent.state()).products[0].variants.map((v: any) => v.stock_quantity), [6,2]);
const paid = await setup({payment_method: 'Bank Payment', payment_status: 'Paid', payment_paid_type: 'Full'}), paidInput = await paid.input();
paidInput.items.push({product_id: 'normal', quantity: 1, unit_price: 700});
assert.equal((await paid.call(paidInput)).status, 200);
assert.equal((await paid.current()).payment_received_amount, 1950); assert.equal((await paid.current()).payment_status, 'Pending');
assert.equal((await paid.current()).invoice_payment_label_snapshot, 'ADVANCE PAID');
assert.equal((await paid.call({order: paid.order}, '', 'admin', '/api/orders/order', 'PUT')).status, 200);
assert.equal((await paid.current()).payment_status, 'Pending', 'A stale fully-paid marker cannot hide the revised payment balance');
assert.equal((await paid.current()).payment_received_amount, 1950);
console.log('PASS: native order/waybill search; split and different-cost variants; added items and decimal prices; corrected invoice snapshots/CSV; exact stock and bundles; unallocated orders; same waybill; auth; stale writes; shortage; dispatch/return guards; every interrupted-save boundary; concurrent replay; bank payment balance.');
