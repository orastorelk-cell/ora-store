import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { activeData, configureCloudflareData, dataBucket, importRecovery, mutateDataTable, readDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { purchaseHistoryStockDurabilityPatch } from '../src/lib/purchaseHistoryStockDurabilityPatch';
import { storefrontSaveBody } from '../src/lib/storefrontProductSave';
import { acknowledgeStaffPurchase, pendingStaffPurchases, rememberStaffPurchase, STAFF_PURCHASE_API, STAFF_PURCHASE_PREFIX } from '../src/lib/staffPurchases';

class Bucket {
  objects = new Map<string, { value: string; etag: string; customMetadata: any }>(); revision = 0; fail = ''; lost = false;
  async get(key: string) { const value = this.objects.get(key); await Promise.resolve(); return value ? { ...value, text: async () => value.value } : null; }
  async put(key: string, value: string, options: any = {}) {
    if (key === this.fail) throw new Error('Synthetic failed staff purchase commit');
    const previous = this.objects.get(key);
    if (options.onlyIf?.etagMatches && previous?.etag !== options.onlyIf.etagMatches || options.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
    const row = { value, etag: String(++this.revision), customMetadata: options.customMetadata }; this.objects.set(key, row);
    if (this.lost && key.endsWith('admin-changes-v1.json')) { this.lost = false; throw new Error('R2 put failed: (503) Service unavailable'); }
    return { etag: row.etag };
  }
}
const setup = async () => {
  const raw = new Bucket(), env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: 'synthetic-staff-purchase-secret', ORA_R2_COMPRESSION_ENABLED: '1' };
  configureCloudflareData(env);
  const catalog = { version: 1, products: [
    { id: 'normal', sku: 'N001', name_en: 'Normal item', stock_quantity: 10, selling_price: 1500, discount_price: 1200, buying_price: 500, status: 'Active' },
    { id: 'colors', sku: 'V001', name_en: 'Colour item', product_type: 'variant', stock_quantity: 9, selling_price: 2000, variants: [
      { id: 'blue', sku: 'V001-B', option_value: 'Blue', stock_quantity: 4, selling_price: 2000, status: 'Active' },
      { id: 'red', sku: 'V001-R', option_value: 'Red', stock_quantity: 5, selling_price: 2000, status: 'Active' }] },
    { id: 'bundle', sku: 'CB001', name_en: 'Combo', product_type: 'bundle', stock_quantity: 10 },
    { id: 'other', sku: 'OTHER', name_en: 'Unrelated item', stock_quantity: 8 },
  ], categories: [{ id: 'c' }], settings: { store_name: 'Synthetic store', invoice_logo: 'unchanged-logo' } };
  const order = { id: 'unrelated-order', order_number: 'FB-KEEP', invoice_locked: true, invoice_number: 'INV-KEEP', waybill_number: 'KEEP-WB', items: [] };
  await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders: [order], courier_waybills: [{ waybill_number: 'KEEP-WB', status: 'Assigned' }],
    admin_users: [{ id: 'admin', role: 'admin', display_name: 'Admin', is_active: true }, { id: 'editor', role: 'staff', permissions: ['stock'], is_active: true },
      { id: 'viewer', role: 'staff', permissions: ['stock', 'level:stock:view'], is_active: true }, { id: 'other', role: 'staff', permissions: ['orders'], is_active: true }, { id: 'disabled', role: 'admin', is_active: false }],
    admin_data_store: [{ key: 'storefront-state-v1', payload: catalog }, { key: 'keep-history', payload: { value: 'preserve' } }] });
  const token = (user = 'admin') => { const payload = Buffer.from(JSON.stringify({ sub: user, exp: Date.now() + 600_000 })).toString('base64url');
    return payload + '.' + crypto.createHmac('sha256', env.STAFF_SESSION_SECRET).update(payload).digest('base64url'); };
  const call = async (body?: any, user = 'admin', query = '', method = body ? 'POST' : 'GET', path = STAFF_PURCHASE_API) => {
    const response = await withR2DataFallback(new Request('https://fixture' + path + query, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (user === 'invalid' ? user : token(user)) },
      ...(body ? { body: JSON.stringify(body) } : {}) }), env, {}, async () => new Response('Unexpected legacy bridge', { status: 599 }));
    return { status: response.status, body: await response.json() as any };
  };
  const state = async () => (await readDataTable(env, 'admin_data_store')).find(row => row.key === 'storefront-state-v1')!.payload;
  const input = (quantity = 2) => ({ operation_id: crypto.randomUUID(), staff_name: 'Staff member', notes: 'Manual staff price', items: [{ product_id: 'normal', quantity, unit_price: 625.25 }] });
  return { raw, env, catalog, order, token, call, state, input };
};
const f = await setup(), input = { ...f.input(), items: [...f.input().items, { product_id: 'colors', variant_id: 'blue', quantity: 3, unit_price: 900.10 }] };
const orders = await readDataTable(f.env, 'order_snapshots'), waybills = await readDataTable(f.env, 'courier_waybills');
const base = (await activeData(dataBucket(f.env)!))!.prefix, originalBase = f.raw.objects.get(base + 'admin_data_store.json');
for (const user of ['invalid', 'disabled']) assert.equal((await f.call(undefined, user)).status, 401);
assert.equal((await f.call(undefined, 'other')).status, 403);
assert.equal((await f.call(undefined, 'viewer')).status, 200);
assert.equal((await f.call(input, 'viewer')).status, 403);
assert.equal((await f.call(input, 'other')).status, 403);
const saved = await f.call(input); assert.equal(saved.status, 200, JSON.stringify(saved));
const purchase = saved.body.purchase, state = await f.state();
assert.equal(purchase.total_amount, 3950.80, 'Only manually entered staff prices determine the total');
assert.deepEqual(purchase.items.map((item: any) => item.unit_price), [625.25, 900.10]);
assert.equal(state.products[0].stock_quantity, 8);
assert.deepEqual(state.products[1].variants.map((variant: any) => variant.stock_quantity), [1, 5]);
assert.equal(state.products[1].stock_quantity, 6);
for (const key of ['selling_price', 'discount_price', 'buying_price']) assert.equal(state.products[0][key], (f.catalog.products[0] as any)[key]);
assert.deepEqual(state.products[2], f.catalog.products[2]); assert.deepEqual(state.products[3], f.catalog.products[3]);
assert.deepEqual(state.categories, f.catalog.categories); assert.deepEqual(state.settings, f.catalog.settings);
assert.deepEqual(await readDataTable(f.env, 'order_snapshots'), orders, 'No customer order or invoice is created or changed');
assert.deepEqual(await readDataTable(f.env, 'courier_waybills'), waybills);
assert.equal(f.raw.objects.get(base + 'admin_data_store.json'), originalBase, 'The restored base remains intact');
const revision = f.raw.revision;
assert.equal((await f.call(input)).body.already_saved, true); assert.equal(f.raw.revision, revision);
assert.equal((await f.call({ ...input, staff_name: 'Different' })).status, 409);
assert.equal((await f.call(input, 'editor')).status, 409);

// A stale browser cannot undo the committed staff deduction.
const stale = { ...f.catalog, products: f.catalog.products.map(product => product.id === 'normal' ? { ...product, stock_quantity: 9 } : product) };
assert.equal((await f.call(storefrontSaveBody(f.catalog, stale, 1), 'admin', '', 'PUT', '/api/admin/storefront/state')).status, 409);
assert.equal((await f.state()).products[0].stock_quantity, 8);
const history = await f.call(undefined, 'viewer', '?search=V001-B'); assert.equal(history.body.total, 1);
assert.equal(history.body.total_quantity, 5); assert.equal(history.body.total_amount, 3950.80);
assert.equal((await f.call(undefined, 'admin', '?search=not-found')).body.total, 0);
assert.equal((await f.call(undefined, 'admin', '?from=2099-01-01')).body.total, 0);
assert.equal((await f.call(undefined, 'admin', '?page=0')).status, 400);
assert.equal((await f.call(undefined, 'admin', '?from=2026-10-20&to=2026-10-01')).status, 400);

// The real production Purchase History authority and FIFO cap both consume the
// shared Decrease audits. Reload cannot recreate staff-sold units.
const shared = (await f.call(undefined, 'admin', '', 'GET', '/api/admin/storefront/state')).body.state.return_inventory;
assert.deepEqual(shared.stockHistory, purchase.stock_history);
const source = purchaseHistoryStockDurabilityPatch().transform(fs.readFileSync('src/context/StoreContext.tsx', 'utf8'), process.cwd() + '/src/context/StoreContext.tsx')!.code;
const effect = source.slice(source.indexOf('  // PURCHASE LEDGER STOCK AUTHORITY'), source.indexOf('  const fifoAllocatorSignatureRef'));
let calculated = structuredClone(f.catalog.products) as any[];
const authority = { orders: [], purchaseOrders: [{ sku: 'N001', quantity_added: 10 }, { variant_sku: 'V001-B', quantity_added: 4 }, { variant_sku: 'V001-R', quantity_added: 5 }],
  stockHistory: shared.stockHistory, useEffect: (fn: Function) => fn(), setProducts: (fn: Function) => { calculated = fn(calculated); }, normalizedProductType: (product: any) => product.product_type || 'normal' };
vm.runInNewContext(transformSync(effect, { loader: 'ts' }).code, authority);
assert.equal(calculated[0].stock_quantity, 8); assert.deepEqual(Array.from(calculated[1].variants, (value: any) => value.stock_quantity), [1, 5]);
const capStart = source.indexOf('    const inventory=cloneInventoryProducts(products);'), capEnd = source.indexOf('    const productMap=new Map(inventory.map', capStart);
const capped = vm.runInNewContext(transformSync(source.slice(capStart, capEnd) + '\ninventory;', { loader: 'ts' }).code,
  { ...authority, products: f.catalog.products, cloneInventoryProducts: (products: any) => structuredClone(products) });
assert.equal(capped[0].stock_quantity, 8); assert.equal(capped[1].variants[0].stock_quantity, 1);

// Validation and a shortage on ANY line leave all lines untouched.
const invalid = await setup(), unchanged = await invalid.state();
for (const items of [
  [{ product_id: 'normal', quantity: 1 }], [{ product_id: 'normal', quantity: 1, unit_price: null }],
  [{ product_id: 'normal', quantity: -1, unit_price: 1 }], [{ product_id: 'normal', quantity: 1.5, unit_price: 1 }],
  [{ product_id: 'normal', quantity: 1, unit_price: 0 }], [{ product_id: 'normal', quantity: 1, unit_price: 1.123 }],
  [invalid.input().items[0], invalid.input().items[0]],
]) assert.equal((await invalid.call({ ...invalid.input(), items })).status, 400);
for (const items of [
  [{ product_id: 'colors', quantity: 1, unit_price: 1 }], [{ product_id: 'normal', variant_id: 'blue', quantity: 1, unit_price: 1 }],
  [{ product_id: 'bundle', quantity: 1, unit_price: 1 }], [{ product_id: 'missing', quantity: 1, unit_price: 1 }],
  [invalid.input().items[0], { product_id: 'colors', variant_id: 'red', quantity: 6, unit_price: 1 }],
]) assert.equal((await invalid.call({ ...invalid.input(), items })).status, 409);
assert.deepEqual(await invalid.state(), unchanged);
assert.equal((await readDataTable(invalid.env, 'admin_data_store')).filter(row => row.key.startsWith(STAFF_PURCHASE_PREFIX)).length, 0);
assert.equal((await invalid.call(invalid.input(1), 'editor')).status, 200, 'Existing stock editors can enter purchases');

// Concurrent operations cannot oversell; duplicate requests deduct only once.
const concurrent = await setup(), same = concurrent.input(7);
assert((await Promise.all([concurrent.call(same), concurrent.call(same)])).every(value => value.status === 200));
assert.equal((await concurrent.state()).products[0].stock_quantity, 3);
const competing = await setup(), race = await Promise.all([competing.call(competing.input(7)), competing.call(competing.input(7))]);
assert.deepEqual(race.map(value => value.status).sort(), [200, 409]); assert.equal((await competing.state()).products[0].stock_quantity, 3);
const exact = await setup(); assert.equal((await exact.call(exact.input(10))).status, 200); assert.equal((await exact.state()).products[0].status, 'Out of Stock');

// A failed manifest publishes neither stock nor receipt; a lost acknowledgment
// resumes the committed operation without changing the total or stock again.
const failed = await setup(), failedInput = failed.input();
failed.raw.fail = (await activeData(dataBucket(failed.env)!))!.prefix + 'admin-changes-v1.json';
assert.equal((await failed.call(failedInput)).status, 503); assert.equal((await failed.state()).products[0].stock_quantity, 10);
assert.equal((await failed.call()).body.total, 0);
failed.raw.fail = ''; failed.raw.lost = true;
assert.equal((await failed.call(failedInput)).status, 200);
assert.equal((await failed.state()).products[0].stock_quantity, 8); assert.equal((await failed.call(failedInput)).body.already_saved, true);
const locked = await setup();
await mutateDataTable(locked.env, 'admin_data_store', rows => { rows.push({ key: 'return-packing-v1:synthetic', payload: { phase: 'pending' } }); });
assert.equal((await locked.call(locked.input())).status, 409); assert.equal((await locked.state()).products[0].stock_quantity, 10);

class MemoryStorage implements Storage {
  values = new Map<string, string>(); get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] || null; }
  getItem(key: string) { return this.values.get(key) || null; } setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); } clear() { this.values.clear(); }
}
const storage = new MemoryStorage(), pendingA = f.input(), pendingB = f.input();
rememberStaffPurchase(storage, 'user-a', pendingA); rememberStaffPurchase(storage, 'user-a', pendingB);
rememberStaffPurchase(storage, 'user-b', f.input());
assert.deepEqual(pendingStaffPurchases(storage, 'user-a'), [pendingA, pendingB]);
acknowledgeStaffPurchase(storage, 'user-a', pendingA); assert.deepEqual(pendingStaffPurchases(storage, 'user-a'), [pendingB]);
assert.equal(pendingStaffPurchases(storage, 'user-b').length, 1);
console.log('PASS: manual staff prices; atomic exact-variant deductions/audits; permissions; no order/invoice/waybill changes; shortage rollback; stale saves; reload authority/FIFO cap; concurrent retries/overselling; failed/lost commits; history filters; account- and operation-scoped pending receipts.');
