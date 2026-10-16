import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createClient } from '@supabase/supabase-js';
import { configureCloudflareData, dataBucket, importRecovery, readDataTable, mutateDataTable, cloudflareDataFetch } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { stockConsumedItems, STOCK_QUANTITY_PREFIX } from '../src/lib/orderStockQuantities';
import { physicalReturnItems, returnPackingInProgress } from '../src/lib/returnSheets';
import { purchaseHistoryStockDurabilityPatch } from '../src/lib/purchaseHistoryStockDurabilityPatch';
import { runAuthorizedOrder657StockCorrection } from '../worker/authorizedOrder657StockCorrection';

class MemoryBucket {
  objects = new Map<string, {value: string; etag: string; customMetadata: any}>(); revision = 0;
  failSuffix = ''; failNth = 0; writes = 0;
  async get(key: string) {const row = this.objects.get(key); await Promise.resolve(); return row ? {text: async () => row.value, etag: row.etag, customMetadata: row.customMetadata} : null;}
  async put(key: string, value: string, options: any = {}) {
    if (this.failSuffix && key.endsWith(this.failSuffix) && ++this.writes === this.failNth) throw new Error('Simulated lost save');
    const current = this.objects.get(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== current?.etag || options.onlyIf?.etagDoesNotMatch === '*' && current) return null;
    const row = {value, etag: String(++this.revision), customMetadata: options.customMetadata}; this.objects.set(key, row); return {etag: row.etag};
  }
}
const setup = async (items = [{product_id: 'mat', sku: 'SYN-MAT', product_name: 'Synthetic Mat', quantity: 5}] as any[], extra = {}) => {
  const raw = new MemoryBucket(), env = {ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: 'synthetic-quantity-secret', SUPABASE_SECRET_KEY: 'synthetic-service-key', VITE_SUPABASE_URL: 'https://fixture.supabase.co'};
  configureCloudflareData(env);
  const order = {id: 'synthetic-657', order_number: 'FB-000657', waybill_number: '18160739', stock_allocated: true, stock_status: 'Allocated', order_status: 'Processing',
    stock_allocated_at: '2026-10-01T00:00:00Z', call_center_status: 'Confirmed', dispatch_status: 'Not Scanned', return_status: 'None', invoice_locked: true,
    invoice_number: 'INV-FB-000657', invoice_generated_at: '2026-10-01T00:00:00Z', invoice_pack_batch_id: 'PACK-ORIGINAL', invoice_pack_downloaded_at: '2026-10-01T00:01:00Z',
    fardar_csv_exported_at: '2026-10-01T00:02:00Z', fardar_csv_exported_waybill: '18160739', total_amount: 5250, items, invoice_confirm_snapshot: {items, final_total: 5250}, ...extra};
  const other = {...order, id: 'unrelated', order_number: 'FB-000656', waybill_number: '18160738'};
  const products = [{id: 'mat', sku: 'SYN-MAT', name_en: 'Synthetic Mat', stock_quantity: 0},
    {id: 'colors', sku: 'SYN-C', product_type: 'variant', name_en: 'Synthetic colors', stock_quantity: 4, variants: [{id: 'blue', sku: 'SYN-BLUE', stock_quantity: 1, option_value: 'Blue'}, {id: 'red', sku: 'SYN-RED', stock_quantity: 3, option_value: 'Red'}]},
    {id: 'part', sku: 'SYN-PART', name_en: 'Synthetic component', stock_quantity: 0}];
  await importRecovery(dataBucket(env)!, {format: 'ora-r2-recovery-v1', orders: [order, other], admin_users: [{id: 'admin', role: 'admin', is_active: true}, {id: 'staff', role: 'staff', is_active: true}],
    admin_data_store: [{key: 'storefront-state-v1', payload: {version: 1, products, categories: [], settings: {}}}],
    courier_waybills: [order, other].map(value => ({waybill_number: value.waybill_number, status: 'Assigned', assigned_order_id: value.id, assigned_order_number: value.order_number}))});
  const token = (sub = 'admin') => {const payload = Buffer.from(JSON.stringify({sub, exp: Date.now() + 600000})).toString('base64url'); return payload + '.' + crypto.createHmac('sha256', env.STAFF_SESSION_SECRET).update(payload).digest('base64url');};
  const call = async (path: string, body?: any, method = body ? 'POST' : 'GET', auth = token()) => {
    const response = await withR2DataFallback(new Request('https://fixture' + path, {method, headers: {authorization: 'Bearer ' + auth, 'content-type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}), env, {}, async () => new Response('{}', {status: 599}));
    return {status: response.status, body: await response.json() as any};
  };
  const state = async () => (await call('/api/admin/storefront/state')).body.state;
  const current = async () => (await readDataTable(env, 'order_snapshots')).find(row => row.order_id === order.id)!.payload;
  const input = async (quantities = [2]) => ({order_id: order.id, operation_id: crypto.randomUUID(), waybill_number: order.waybill_number,
    expected_identity: (await call('/api/orders/stock-quantity?search=FB-000657')).body.expected_identity, item_quantities: quantities, reason: 'Actual dispatched quantities checked'});
  return {raw, env, order, other, call, token, state, current, input};
};
const path = '/api/orders/stock-quantity';
const f = await setup(), input = await f.input(), originalWaybills = await readDataTable(f.env, 'courier_waybills');
assert.equal((await f.call(path + '?search=FB-000657', undefined, 'GET', 'invalid')).status, 401);
assert.equal((await f.call(path + '?search=FB-000657', undefined, 'GET', f.token('staff'))).status, 403);
assert.equal((await f.call(path, input, 'POST', f.token('staff'))).status, 403);
assert.equal((await f.call(path + '?search=18160739')).body.order.id, f.order.id);
assert.equal((await f.call(path + '?search=fb-000657')).body.order.id, f.order.id);
const result = await f.call(path, input); assert.equal(result.status, 200, JSON.stringify(result));
assert.equal((await f.state()).products[0].stock_quantity, 3);
const corrected = await f.current(); assert.deepEqual(stockConsumedItems(corrected).map(item => item.quantity), [2]);
for (const field of Object.keys(f.order)) assert.deepEqual(corrected[field], (f.order as any)[field], 'Preserve original field ' + field);
assert.equal(corrected.stock_quantity_correction.revision, 1);
assert.equal((await readDataTable(f.env, 'order_snapshots')).length, 2, 'No follow-up order or invoice is created');
assert.deepEqual((await readDataTable(f.env, 'order_snapshots')).find(row => row.order_id === 'unrelated')!.payload, f.other);
assert.deepEqual(await readDataTable(f.env, 'courier_waybills'), originalWaybills);
const revision = f.raw.revision; assert.equal((await f.call(path, input)).body.already_saved, true); assert.equal(f.raw.revision, revision);
assert.equal((await f.call(path, {...input, item_quantities: [1]})).status, 409, 'Same operation cannot change its payload');
assert.equal((await f.call(path, {...input, operation_id: crypto.randomUUID()})).status, 409, 'Old previews cannot release stock again');
assert.equal(physicalReturnItems(corrected)[0].expected_qty, 2, 'A future return cannot credit the original five');
assert.equal((await f.state()).return_inventory.stockHistory[0].change_type, 'Adjustment', 'Purchase-ledger release is never counted twice');

// Exercise the actual purchase authority effect after transformation.
let source = fs.readFileSync('src/context/StoreContext.tsx', 'utf8');
source = purchaseHistoryStockDurabilityPatch().transform(source, process.cwd() + '/src/context/StoreContext.tsx')!.code;
const effect = source.slice(source.indexOf('  // PURCHASE LEDGER STOCK AUTHORITY'), source.indexOf("  const fifoAllocatorSignatureRef"));
let calculated: any[] = [{id: 'mat', sku: 'SYN-MAT', name_en: 'Synthetic Mat', stock_quantity: 0}];
const authority = (orders: any[]) => vm.runInNewContext(transformSync(effect, {loader: 'ts'}).code, {orders, purchaseOrders: [{sku: 'SYN-MAT', quantity_added: 5}], stockHistory: result.body.stock_history,
  stockConsumedItems, useEffect: (fn: Function) => fn(), normalizedProductType: () => 'normal', setProducts: (fn: Function) => {calculated = fn(calculated);}});
authority([corrected]); assert.equal(calculated[0].stock_quantity, 3, 'Refresh/purchase authority respects 2 consumed, 3 available');
assert.equal(source.split('stockConsumedItems(order).forEach(item=>{').length - 1, 2, 'Both the authority and FIFO hard cap use actual consumption');

// A stale dashboard cannot erase the durable stock override or delete its audit.
const put = await f.call('/api/orders/' + f.order.id, {order: f.order}, 'PUT'); assert.equal(put.status, 200);
assert.equal(put.body.order.stock_quantity_correction.item_quantities[0], 2);
assert.equal((await f.call('/api/orders/' + f.order.id, {reason: 'test'}, 'DELETE')).status, 409);
const sdk = createClient(f.env.VITE_SUPABASE_URL, f.env.SUPABASE_SECRET_KEY, {global: {fetch: cloudflareDataFetch}, auth: {persistSession: false, autoRefreshToken: false}});
assert.equal((await sdk.from('order_snapshots').upsert({order_id: f.order.id, order_number: f.order.order_number, payload: f.order}, {onConflict: 'order_id'})).error, null);
assert.equal((await f.current()).stock_quantity_correction.item_quantities[0], 2);
assert((await sdk.from('order_snapshots').update({payload: f.order}).eq('order_id', f.order.id)).error);

const cancel = await f.call('/api/orders/cancel-before-dispatch', {order_id: f.order.id, waybill_number: '18160739', reason: 'Unshipped parcel cancelled'});
assert.equal(cancel.status, 200, JSON.stringify(cancel)); assert.equal(cancel.body.complete, true); assert.equal(cancel.body.stock_restored[0].quantity, 2);
assert.equal((await f.state()).products[0].stock_quantity, 5, 'Cancellation restores only the remaining two');
const cancelled = await f.current(); authority([cancelled]); assert.equal(calculated[0].stock_quantity, 5);
assert.equal(cancel.body.waybill_retired, true);
assert.equal((await f.call('/api/orders/cancel-before-dispatch?order_number=FB-000657')).body.complete, true);
assert.equal((await f.call('/api/orders/cancel-before-dispatch', {order_id: f.order.id, waybill_number: '18160739', reason: 'Retry'})).body.complete, true);
assert.equal((await f.state()).products[0].stock_quantity, 5);

// Every durable boundary is retry-safe, including after stock was committed.
for (const [suffix, nth] of [['admin_data_store.json', 2], ['admin_data_store.json', 3], ['order-changes-v1.json', 2]] as const) {
  const retry = await setup(), body = await retry.input(); retry.raw.failSuffix = suffix; retry.raw.failNth = nth;
  assert.equal((await retry.call(path, body)).status, 503, suffix + ' boundary ' + nth);
  const pending = await readDataTable(retry.env, 'admin_data_store'); assert.equal(returnPackingInProgress(pending), true);
  const state = await retry.state(); assert.equal((await retry.call('/api/admin/storefront/state', {...state, expected_version: state.version}, 'PUT')).status, 409);
  retry.raw.failSuffix = '';
  const resumed = await retry.call(path, body); assert.equal(resumed.status, 200, JSON.stringify(resumed));
  assert.equal((await retry.state()).products[0].stock_quantity, 3);
  assert.equal(returnPackingInProgress(await readDataTable(retry.env, 'admin_data_store')), false);
  assert.equal((await retry.call(path, body)).body.already_saved, true);
}
const concurrent = await setup(), concurrentInput = await concurrent.input();
const responses = await Promise.all([concurrent.call(path, concurrentInput), concurrent.call(path, concurrentInput)]);
assert(responses.every(value => value.status === 200)); assert.equal((await concurrent.state()).products[0].stock_quantity, 3);

const variants = await setup([{product_id: 'colors', variant_id: 'blue', sku: 'SYN-BLUE', product_name: 'Blue', quantity: 5}]);
assert.equal((await variants.call(path, await variants.input())).status, 200);
assert.deepEqual((await variants.state()).products[1].variants.map((value: any) => value.stock_quantity), [4, 3]);
assert.equal((await variants.state()).products[1].stock_quantity, 7);
const bundle = await setup([{product_id: 'bundle', product_type: 'bundle', sku: 'SYN-BUNDLE', quantity: 5, bundle_components: [{product_id: 'part', sku: 'SYN-PART', product_name: 'Part', quantity_per_bundle: 2}]}]);
assert.equal((await bundle.call(path, await bundle.input())).status, 200); assert.equal((await bundle.state()).products[2].stock_quantity, 6);
const zero = await setup(); assert.equal((await zero.call(path, await zero.input([0]))).status, 200);
assert.deepEqual(stockConsumedItems(await zero.current()), []); assert.equal((await zero.state()).products[0].stock_quantity, 5);
assert.equal((await zero.call('/api/orders/cancel-before-dispatch', {order_id: zero.order.id, waybill_number: '18160739', reason: 'No units sent'})).body.stock_restored.length, 0);
const increased = await setup(); await increased.call(path, await increased.input());
assert.equal((await increased.call(path, await increased.input([4]))).status, 200); assert.equal((await increased.state()).products[0].stock_quantity, 1);
await mutateDataTable(increased.env, 'admin_data_store', rows => {rows.find(row => row.key === 'storefront-state-v1')!.payload.products[0].stock_quantity = 0;});
assert.equal((await increased.call(path, await increased.input([5]))).status, 409, 'Re-deduction needs available stock');
for (const extra of [{return_status: 'Pending Verification'}, {return_sheet_id: 'synthetic-sheet'}, {order_status: 'Cancelled'}, {stock_allocated: false}]) {
  const blocked = await setup(undefined, extra), body = await blocked.input(); assert.equal((await blocked.call(path, body)).status, 409);
  assert.equal((await blocked.state()).products[0].stock_quantity, 0);
}
const dispatched = await setup(undefined, {order_status: 'Delivered', dispatch_status: 'Handed Over'});
assert.equal((await dispatched.call(path, await dispatched.input())).status, 200, 'Actual dispatched counts can be corrected after delivery');
assert.equal((await dispatched.call('/api/orders/cancel-before-dispatch', {order_id: dispatched.order.id, waybill_number: '18160739', reason: 'Invalid cancel'})).status, 409);

const authorized = await setup(); const repair = await runAuthorizedOrder657StockCorrection(authorized.env);
assert.equal(repair.complete, true); assert.equal(repair.stock_history[0].quantity, 3); assert.equal((await authorized.current()).stock_quantity_correction.item_quantities[0], 2);
assert.equal((await runAuthorizedOrder657StockCorrection(authorized.env)).already_saved, true);
assert.equal((await readDataTable(authorized.env, 'admin_data_store')).filter(row => row.key.startsWith(STOCK_QUANTITY_PREFIX)).length, 1);
const mismatch = await setup(undefined, {waybill_number: 'SYN-OTHER'}); await assert.rejects(() => runAuthorizedOrder657StockCorrection(mismatch.env));
assert.equal((await mismatch.state()).products[0].stock_quantity, 0);
console.log('PASS: 5→2 releases 3 once; invoice/items/money/waybill preserved; real purchase authority; stale PUT/SDK; cancellation restores only 2 and retires waybill; all partial-save boundaries/concurrent retries; variants/bundles/zero/re-deduction; return guards; exact authorized FB-000657 repair.');
