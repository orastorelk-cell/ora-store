import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { loadConfigFromFile } from 'vite';
import { activeData, dataBucket, importRecovery, readDataTable, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { applyInvoiceDownloadStatus, invoiceDownloadRequest, saveInvoiceDownloadStatus } from '../src/lib/invoiceDownloadStatus';
import { confirmCsvRequestWithRetry } from '../src/lib/confirmCsvSave';

class MemoryBucket {
  objects = new Map<string, { value: string; etag: string; customMetadata?: any }>();
  revision = 0;
  writes: string[] = [];
  failKey = '';
  beforePut?: (key: string) => Promise<void>;
  async get(key: string) {
    const row = this.objects.get(key);
    return row ? { etag: row.etag, customMetadata: row.customMetadata, text: async () => row.value } : null;
  }
  async put(key: string, value: string, options: any = {}) {
    if (this.beforePut) await this.beforePut(key);
    if (key === this.failKey) throw new Error('simulated write failure');
    const old = this.objects.get(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== old?.etag) return null;
    if (options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    this.writes.push(key);
    const etag = String(++this.revision);
    this.objects.set(key, { value, etag, customMetadata: options.customMetadata });
    return { etag };
  }
}

const raw = new MemoryBucket(), secret = 'invoice-download-test-secret';
const env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: secret, ORA_R2_COMPRESSION_ENABLED: '1' };
const orders = Array.from({ length: 511 }, (_, index) => ({ id: 'order-' + index, order_number: 'FB-' + String(index).padStart(6, '0'),
  customer_name: 'Synthetic customer ' + index, address: 'Original address', notes: 'original ' + 'x'.repeat(2300),
  total_amount: 1340, stock_allocated: true, stock_status: 'Allocated', call_center_status: 'Confirmed', order_status: 'Processing',
  waybill_number: 'WB-' + index, invoice_locked: true, invoice_number: 'INV-' + index, invoice_pack_batch_id: 'PACK-ORIGINAL',
  invoice_generated_at: '2026-10-01T00:00:00Z', fardar_csv_exported_at: '2026-10-02T00:00:00Z',
  invoice_pack_downloaded_at: '2026-10-02T00:00:00Z', invoice_pack_downloaded_by: 'Original Staff',
  items: [{ sku: 'R0053-Black', quantity: 1, unit_price: 1090, subtotal: 1090 }], created_at: '2026-10-01T00:00:00Z' }));
await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders,
  admin_users: [{ id: 'admin-id', username: 'admin', role: 'admin', is_active: true }],
  admin_data_store: [{ key: 'storefront-state-v1', payload: { version: 1, products: [], categories: [], settings: {} } }], courier_waybills: [] });
const active = (await activeData(dataBucket(env)!))!, orderKey = active.prefix + 'order_snapshots.json';
const payload = Buffer.from(JSON.stringify({ sub: 'admin-id', role: 'admin', exp: Date.now() + 60000 })).toString('base64url');
const token = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
const post = (body: any, auth = token) => withR2DataFallback(new Request('https://test/api/orders/invoice-download-status', {
  method: 'POST', headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, {},
  async () => new Response('Unexpected Node bridge', { status: 599 }));
const body = { orderIds: orders.slice(0, 50).map(order => order.id), downloadedAt: '2026-10-07T00:00:00Z', downloadedBy: 'Packing Staff', downloadSet: { date: '2026-10-07', number: 2 } };
assert.equal((await post(body, 'invalid')).status, 401);
assert.equal((await post({ ...body, orderIds: [...body.orderIds, 'order-50'] })).status, 400);
assert.equal(invoiceDownloadRequest({ ...body, downloadedAt: 'invalid' }), null);
assert.equal(invoiceDownloadRequest({ ...body, downloadSet: { date: 'bad', number: 0 } }), null);
const before = await readDataTable(env, 'order_snapshots');
const original = JSON.stringify(before);
raw.writes = [];
const saved = await post(body);
assert.equal(saved.status, 200);
const result: any = await saved.json();
assert.equal(result.orders.length, 50);
assert.equal(raw.writes.filter(key => key === orderKey).length, 1, '50 downloads use ONE durable order-table write');
const after = await readDataTable(env, 'order_snapshots');
assert.equal(JSON.stringify(before), original, 'Immutable metadata transactions never mutate a cached read');
for (let index = 0; index < after.length; index++) {
  const changed = { ...after[index].payload };
  for (const field of ['invoice_pack_downloaded_at', 'invoice_pack_downloaded_by', 'invoice_pack_download_set_date', 'invoice_pack_download_set_number']) delete changed[field];
  const existing = { ...orders[index] } as any;
  for (const field of ['invoice_pack_downloaded_at', 'invoice_pack_downloaded_by']) delete existing[field];
  assert.deepEqual(changed, existing, 'Money, stock, items, invoice/waybill and export fields remain exact');
}
assert.deepEqual(after.slice(50), before.slice(50), 'Every unselected durable record remains exact');
raw.writes = [];
assert.equal((await post(body)).status, 200);
assert.equal(raw.writes.length, 0, 'Lost-response replays are completely write-free');
const missingBefore = JSON.stringify(await readDataTable(env, 'order_snapshots'));
assert.equal((await post({ ...body, orderIds: ['order-0', 'missing'] })).status, 404);
assert.equal(JSON.stringify(await readDataTable(env, 'order_snapshots')), missingBefore, 'A missing group member cannot partially change downloads');

// A CAS conflict rereads current data; a later customer edit survives the retry.
let interleaved = false;
raw.beforePut = async key => {
  if (key !== orderKey || interleaved) return;
  interleaved = true;
  await replaceDataTable(env, 'order_snapshots', rows => ({ rows: rows.map(row => row.order_id === 'order-50'
    ? { ...row, payload: { ...row.payload, address: 'Concurrent staff correction', payment_status: 'Paid' } } : row), result: null }));
};
const nextBody = { ...body, orderIds: ['order-50'], downloadedAt: '2026-10-07T00:01:00Z' };
assert.equal((await post(nextBody)).status, 200);
raw.beforePut = undefined;
const corrected = (await readDataTable(env, 'order_snapshots')).find(row => row.order_id === 'order-50')!.payload;
assert.equal(corrected.address, 'Concurrent staff correction'); assert.equal(corrected.payment_status, 'Paid');
assert.equal(corrected.invoice_pack_downloaded_at, nextBody.downloadedAt);
const latest = JSON.stringify(corrected);
await post({ ...nextBody, downloadedAt: '2026-10-03T00:00:00Z', downloadedBy: 'Older retry' });
assert.equal(JSON.stringify((await readDataTable(env, 'order_snapshots')).find(row => row.order_id === 'order-50')!.payload), latest, 'Older retries preserve a newer download');

// The client sends metadata only, confirms every ID, and retries the SAME event.
let lost = true, attempts = 0;
const client = async (_path: string, options?: RequestInit) => {
  attempts++;
  const input = JSON.parse(String(options?.body));
  assert.deepEqual(Object.keys(input).sort(), ['downloadSet', 'downloadedAt', 'downloadedBy', 'orderIds']);
  const response = await post(input);
  if (lost) { lost = false; const error: any = new Error('Lost acknowledgment'); error.status = 503; throw error; }
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};
raw.writes = [];
const clientSaved = await saveInvoiceDownloadStatus(['order-100', 'order-101'], ' Packing Staff ', { date: '2026-10-07', number: 3 }, client, async () => {});
assert.equal(clientSaved.length, 2); assert.equal(attempts, 2);
assert.equal(raw.writes.filter(key => key === orderKey).length, 1, 'A lost acknowledgment does not create another download write');
raw.failKey = orderKey;
const failed = await post({ ...nextBody, orderIds: ['order-102'] });
assert.equal(failed.status, 503, 'A real storage failure is never acknowledged');
raw.failKey = '';
assert.equal((await readDataTable(env, 'order_snapshots')).find(row => row.order_id === 'order-102')!.payload.invoice_pack_downloaded_at, orders[102].invoice_pack_downloaded_at);
await assert.rejects(saveInvoiceDownloadStatus(['order-0'], 'Packing Staff', undefined, async () => ({ ok: true, orders: [] }), async () => {}));

// Execute the production hydration and publish effect: acknowledged server data
// generates no PUT, while a subsequent actual edit still schedules one.
const source = fs.readFileSync('src/context/StoreContext.tsx', 'utf8');
const hydrationStart = source.indexOf('  const applySharedStorefrontState =');
const hydrationEnd = source.indexOf('\n  useEffect(', hydrationStart);
const effectStart = source.indexOf('  useEffect(() => {', source.indexOf('// Publish catalog/category/store-setting edits'));
const effectEnd = source.indexOf('\n  // Public storefront freshness:', effectStart);
const scope: any = { products: [], categories: [], settings: { delivery_fee: 250 }, sharedStoreReady: true, adminUser: { id: 'admin-id' },
  sharedStoreSnapshotRef: { current: null }, sharedStoreVersionRef: { current: 0 }, normalizeProductForStorage: (p: any) => p,
  localStorage: { setItem: () => {} }, timers: 0, window: { setTimeout: () => { scope.timers++; return 1; } },
  useEffect: (callback: any) => callback(), setProducts: (p: any) => { scope.products = p; }, setCategories: (c: any) => { scope.categories = c; },
  setSettings: (update: any) => { scope.settings = update(scope.settings); } };
const hydration = transformSync(source.slice(hydrationStart, hydrationEnd) + '\nglobalThis.hydrate=applySharedStorefrontState;', { loader: 'ts' }).code;
const effect = transformSync(source.slice(effectStart, effectEnd), { loader: 'ts' }).code;
vm.runInNewContext(hydration, scope);
vm.runInNewContext(effect, scope);
assert.equal(scope.timers, 0, 'A failed or pending server load must never publish stale browser cache');
scope.hydrate({ version: 2, products: [{ id: 'p1', sku: 'R0001' }], categories: [], settings: { delivery_fee: 300 } }, true);
vm.runInNewContext(effect, scope);
assert.equal(scope.timers, 0, 'Hydrating an acknowledged catalog must not schedule a website save');
scope.settings = { ...scope.settings, delivery_fee: 350 };
vm.runInNewContext(effect, scope);
assert.equal(scope.timers, 1, 'A real settings edit still schedules a durable save');

// Normal background order mirrors use the native handler and never rewrite an
// unchanged order or courier lock. All one-way fields survive stale clients.
const put = (order: any, auth = token) => withR2DataFallback(new Request('https://test/api/orders/' + order.id, {
  method: 'PUT', headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' }, body: JSON.stringify({ order }) }), env, {},
  async () => new Response('Unexpected Node bridge', { status: 599 }));
let mirrored = (await readDataTable(env, 'order_snapshots')).find(row => row.order_id === 'order-450')!.payload;
await replaceDataTable(env, 'courier_waybills', rows => ({ rows: [...rows, { waybill_number: mirrored.waybill_number,
  courier_name: 'Fardar', status: 'Used', assigned_order_number: mirrored.order_number, assigned_at: '2026-10-01T00:00:00Z' }], result: null }));
assert.equal((await put(mirrored, 'invalid')).status, 401);
assert.equal((await put({ ...mirrored, items: undefined })).status, 400);
raw.writes = [];
assert.equal((await put(mirrored)).status, 200);
assert.equal(raw.writes.length, 0, 'An unchanged mirror rewrites neither history nor the existing waybill lock');
const cached = JSON.stringify(await readDataTable(env, 'order_snapshots'));
const stale = { ...mirrored, address: 'Corrected address', stock_allocated: false, stock_status: 'Waiting', invoice_locked: false,
  invoice_number: 'stale invoice', waybill_number: '', invoice_pack_downloaded_at: '2020-01-01T00:00:00Z' };
const protectedResponse = await put(stale);
assert.equal(protectedResponse.status, 200);
const protectedOrder: any = (await protectedResponse.json() as any).order;
assert.equal(protectedOrder.address, 'Corrected address');
for (const field of ['stock_allocated', 'stock_status', 'invoice_locked', 'invoice_number', 'waybill_number', 'invoice_pack_downloaded_at', 'fardar_csv_exported_at'])
  assert.equal(protectedOrder[field], mirrored[field], field + ' survives a stale mirror');
assert.equal(raw.writes.filter(key => key === orderKey).length, 1);
mirrored = protectedOrder;
const poolKey = active.prefix + 'courier_waybills.json';
assert.equal(raw.writes.filter(key => key === poolKey).length, 0, 'Used courier locks are never downgraded or rewritten');
raw.writes = [];
assert.equal((await put({ ...mirrored, order_number: orders[451].order_number })).status, 409);
assert.equal(raw.writes.length, 0, 'A duplicate order number fails before any waybill reservation');
assert.equal((await put({ ...mirrored, id: 'new-order', order_number: 'FB-NEW' })).status, 409);
await replaceDataTable(env, 'courier_waybills', rows => ({ rows: [...rows, { waybill_number: 'RETIRED', status: 'Cancelled', permanently_retired: true }], result: null }));
assert.equal((await put({ ...mirrored, id: 'retired-order', order_number: 'FB-RETIRED', waybill_number: 'RETIRED' })).status, 409);
raw.failKey = orderKey;
assert.equal((await put({ ...mirrored, address: 'Must not be acknowledged' })).status, 503);
raw.failKey = '';
assert.equal((await readDataTable(env, 'order_snapshots')).find(row => row.order_id === mirrored.id)!.payload.address, mirrored.address);

// A cancellation committed during the ETag race remains authoritative.
interleaved = false;
raw.beforePut = async key => {
  if (key !== orderKey || interleaved) return;
  interleaved = true;
  await replaceDataTable(env, 'order_snapshots', rows => ({ rows: rows.map(row => row.order_id === mirrored.id
    ? { ...row, payload: { ...row.payload, order_status: 'Cancelled', cancel_stock_restore: { operation_id: 'cancel-durable' } } } : row), result: null }));
};
const cancellationResponse: any = await (await put({ ...mirrored, address: 'Stale after cancellation' })).json();
raw.beforePut = undefined;
assert.equal(cancellationResponse.cancellation_preserved, true);
assert.equal(cancellationResponse.order.cancel_stock_restore.operation_id, 'cancel-durable');
assert.equal(cancellationResponse.order.address, mirrored.address);
assert.notEqual(JSON.stringify(await readDataTable(env, 'order_snapshots')), cached);

// Execute the mirror queue AFTER every production Vite patch: different orders
// serialize against the same R2 table, and a transient 503 retries before the
// next mirror begins rather than competing with the rest of the CSV batch.
const config = (await loadConfigFromFile({ command: 'build', mode: 'production' }))!.config as any;
let patched = source;
for (const plugin of config.plugins.flat(Infinity)) if (plugin?.name?.startsWith('ora-') && typeof plugin.transform === 'function') {
  const result = await plugin.transform(patched, '/repo/src/context/StoreContext.tsx');
  if (result) patched = typeof result === 'string' ? result : result.code;
}
const queueStart = patched.indexOf('  const orderMirrorQueueRef =');
const mirrorStart = patched.indexOf('  const mirrorOrderUpdate =', queueStart);
const queueEnd = patched.indexOf('\n  };', mirrorStart) + 7;
assert(queueStart >= 0 && queueEnd > mirrorStart);
let activeRequests = 0, peakRequests = 0, mirrorAttempts = 0;
const completed: string[] = [], warnings: any[] = [];
const mirrorScope: any = { useRef: (current: any) => ({ current }), getStaffSessionToken: () => 'test-token', encodeURIComponent,
  console: { warn: (...args: any[]) => warnings.push(args) },
  confirmCsvRequestWithRetry: (request: any, url: string, options: any) => confirmCsvRequestWithRetry(request, url, options, async () => {}),
  sharedStaffRequest: async (_url: string, options: any) => {
    activeRequests++; peakRequests = Math.max(peakRequests, activeRequests); mirrorAttempts++;
    try {
      await Promise.resolve(); await Promise.resolve();
      if (mirrorAttempts === 1) { const error: any = new Error('Transient 503'); error.status = 503; throw error; }
      completed.push(JSON.parse(options.body).order.id);
      return { ok: true };
    } finally { activeRequests--; }
  } };
vm.runInNewContext(transformSync(patched.slice(queueStart, queueEnd) + '\nglobalThis.mirror=mirrorOrderUpdate; globalThis.tail=()=>orderMirrorChainRef.current; globalThis.pending=orderMirrorQueueRef;', { loader: 'ts' }).code, mirrorScope);
for (let i = 0; i < 17; i++) mirrorScope.mirror({ id: 'csv-' + i });
await mirrorScope.tail();
assert.equal(peakRequests, 1, 'Different order mirrors never compete for the shared history table');
assert.equal(mirrorAttempts, 18, 'The 503 is retried before processing the next order');
assert.deepEqual(completed, Array.from({ length: 17 }, (_, i) => 'csv-' + i));
assert.equal(mirrorScope.pending.current.size, 0); assert.equal(warnings.length, 0);
console.log('PASS: 511-order download fixture; one write per 50 invoices; exact unrelated data; auth/validation; CAS edits; lost acknowledgments; older retries; failed storage; strict client confirmation; hydration without redundant publishing; native order mirrors/locks/cancellation; 17 serialized mirrors with 503 retry.');
