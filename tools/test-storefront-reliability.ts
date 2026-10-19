import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ACTIVE_KEY, activeData, configureCloudflareData, dataBucket, importRecovery, mutateDataTable, readDataTable, readDataTableWire, readStorefrontVersion, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { rebaseStorefrontEdit, storefrontSaveBody, validStorefrontPatch } from '../src/lib/storefrontProductSave';
import { acknowledgeStorefrontDraft, readStorefrontDraft, rememberStorefrontDraft } from '../src/lib/storefrontDraft';
import { staffJsonRequest } from '../src/lib/staffRequest';

class Bucket {
  objects = new Map<string, { value: string; etag: string; customMetadata: any }>();
  writes: {key: string; bytes: number}[] = []; revision = 0; fail = ''; lost = false;
  async get(key: string) { const row = this.objects.get(key); await Promise.resolve(); return row ? { ...row, text: async () => row.value } : null; }
  async put(key: string, value: string, options: any = {}) {
    if (key === this.fail) throw new Error('Synthetic failed commit');
    const previous = this.objects.get(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== previous?.etag || options.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
    const etag = String(++this.revision); this.objects.set(key, { value, etag, customMetadata: options.customMetadata });
    this.writes.push({ key, bytes: Buffer.byteLength(value) });
    if (this.lost && key.endsWith('/admin-changes-v1.json')) { this.lost = false; throw new Error('R2 put failed: (503) Service unavailable'); }
    return { etag };
  }
}
const raw = new Bucket(), env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: 'synthetic-journal-secret', ORA_R2_COMPRESSION_ENABLED: '1' };
const logo = 'data:image/png;base64,' + crypto.randomBytes(190000).toString('base64');
const site = { version: 1, updated_at: '2026-10-01T00:00:00Z', products: Array.from({length: 60}, (_, i) => ({id: 'p' + i, sku: 'R' + i, stock_quantity: 10, name_en: 'Synthetic product ' + i})), categories: [{id: 'c', name: 'Test'}], settings: { invoice_logo: logo, store_name: 'Test Store', bank_details_saved: false, old_field: false } };
const history = Array.from({length: 500}, (_, i) => ({key: 'completed-operation:' + i, payload: {phase: 'complete', note: 'පැරණි සටහන ' + 'x'.repeat(2000), order_ids: ['order-' + i]}}));
await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders: [{id: 'old', order_number: 'OLD-1', invoice_locked: true, waybill_number: 'KEEP-1', items: []}], admin_users: [{id: 'admin', role: 'admin', is_active: true}], admin_data_store: [{key: 'storefront-state-v1', payload: site, updated_at: site.updated_at}, ...history], courier_waybills: [] });
const active = (await activeData(dataBucket(env)!))!, baseKey = active.prefix + 'admin_data_store.json', commitKey = active.prefix + 'admin-changes-v1.json';
const original = raw.objects.get(baseKey), originalOrders = raw.objects.get(active.prefix + 'order_snapshots.json');
const payload = Buffer.from(JSON.stringify({sub: 'admin', exp: Date.now() + 3600000})).toString('base64url'), token = payload + '.' + crypto.createHmac('sha256', env.STAFF_SESSION_SECRET).update(payload).digest('base64url');
const call = async (body?: any, auth = token) => {
  const response = await withR2DataFallback(new Request('https://fixture/api/admin/storefront/state', {method: body ? 'PUT' : 'GET', headers: {authorization: 'Bearer ' + auth}, ...(body ? {body: JSON.stringify(body)} : {})}), env, {}, async () => new Response('Unexpected bridge', {status: 599}));
  return {status: response.status, body: await response.json() as any};
};
const state = async () => (await call()).body.state;
assert.equal((await call(undefined, 'invalid')).status, 401);
raw.writes = [];
const next = {...site, products: site.products.map(product => product.id === 'p4' ? {...product, stock_quantity: 7} : product)};
const stockBody = storefrontSaveBody(site, next, 1), stock = await call(stockBody);
assert.equal(stock.status, 200); assert.equal(stock.body.version, 2);
assert(raw.writes.reduce((sum, write) => sum + write.bytes, 0) < 15000, 'A small stock edit must not rewrite old history, every product, or embedded logos');
assert.equal(raw.objects.get(baseKey), original, 'The restored admin table stays byte-for-byte intact');
assert.equal(raw.objects.get(active.prefix + 'order_snapshots.json'), originalOrders, 'A catalog save never changes orders or invoices');
assert.deepEqual((await readDataTable(env, 'admin_data_store')).filter(row => row.key !== 'storefront-state-v1'), history);
assert.equal((await state()).settings.invoice_logo, logo);
const revision = raw.objects.get(commitKey)!.etag;
assert.equal((await call(stockBody)).body.unchanged, true);
assert.equal(raw.objects.get(commitKey)!.etag, revision, 'Lost-response replay cannot deduct stock twice');

const current = await state(), textEdit = {...current, settings: {...current.settings, store_name: 'Changed Store'}};
const patch: any = storefrontSaveBody(current, textEdit, current.version);
assert(validStorefrontPatch(patch)); assert(JSON.stringify(patch).length < 1000, 'A text edit excludes the large unchanged invoice logo');
assert.equal((await call({...patch, setting_changes: [...patch.setting_changes, patch.setting_changes[0]]})).status, 400);
raw.fail = commitKey;
assert.equal((await call(patch)).status, 503); assert.equal((await state()).settings.store_name, 'Test Store');
assert.equal(raw.objects.get(commitKey)!.etag, revision, 'Staged blobs are invisible until the single manifest commits');
raw.fail = ''; raw.lost = true;
assert.equal((await call(patch)).status, 200); assert.equal((await state()).version, 3);
assert.equal((await call(patch)).body.unchanged, true); assert.equal((await state()).version, 3);
assert.equal((await call({...patch, setting_changes: [{...patch.setting_changes[0], after: {present: true, value: 'Stale'}}]})).status, 409);

// Another staff member can edit a different field between the browser read and save.
const disjoint = {...current, settings: {...current.settings, phone: '0770000000'}};
assert.equal((await call(storefrontSaveBody(current, disjoint, current.version))).status, 200);
assert.equal((await state()).settings.store_name, 'Changed Store');
const removed = await state(); delete removed.settings.old_field;
assert.equal((await call(storefrontSaveBody(await state(), removed, removed.version))).status, 200);
assert.equal(Object.hasOwn((await state()).settings, 'old_field'), false);

const add = (key: string) => replaceDataTable(env, 'admin_data_store', rows => ({rows: [...rows, {key, payload: {zero: 0, flag: false, text: 'සිංහල'}}], result: key}));
await Promise.all([add('concurrent:a'), add('concurrent:b')]);
assert((await readDataTable(env, 'admin_data_store')).some(row => row.key === 'concurrent:a'));
assert((await readDataTable(env, 'admin_data_store')).some(row => row.key === 'concurrent:b'));
await mutateDataTable(env, 'admin_data_store', rows => { rows.find(row => row.key === 'concurrent:a')!.payload.zero = 2; rows.splice(rows.findIndex(row => row.key === 'concurrent:b'), 1); });
const wire = JSON.parse(await (await readDataTableWire(env, 'admin_data_store')).text());
assert.equal(wire.find((row: any) => row.key === 'concurrent:a').payload.zero, 2); assert(!wire.some((row: any) => row.key === 'concurrent:b'));
assert.deepEqual(wire.filter((row: any) => row.key.startsWith('completed-operation:')), history);
const coldEnv = {...env, ORA_MEDIA_R2: {get: raw.get.bind(raw), put: raw.put.bind(raw)}};
assert.deepEqual(await readDataTable(coldEnv, 'admin_data_store'), wire, 'Cold encrypted readers see exactly the same merged records');
const noFullRead={...env,ORA_MEDIA_R2:{put:raw.put.bind(raw),get:async(key:string)=>{
  const object=await raw.get(key);
  return key===baseKey&&object?{...object,text:async()=>{throw new Error('Version polling must not decrypt the full history');}}:object;
}}};
assert.deepEqual(await readStorefrontVersion(noFullRead),{initialized:true,updated_at:(await state()).updated_at});
assert.equal((await withR2DataFallback(new Request('https://fixture/api/health'),noFullRead,{},async()=>{throw new Error('Health must not start the Node bridge');})).status,200);
const checkpointKey = raw.writes.find(write => write.key.startsWith('ora-data/backups-v2/admin_data_store/'))!.key;
assert.equal(JSON.parse(await (await dataBucket(env)!.get(checkpointKey))!.text()).format, 'ora-admin-checkpoint-v1');
assert([...raw.objects.values()].every(row => ['ora-aes-gcm-v1', 'ora-aes-gcm-v2'].includes(JSON.parse(row.value).format)));
const manifest = JSON.parse(await (await dataBucket(env)!.get(commitKey))!.text()), shard = Object.values(manifest.shards)[0] as string;
raw.objects.delete(shard);
await assert.rejects(readDataTable({...env,ORA_MEDIA_R2:{get:raw.get.bind(raw),put:raw.put.bind(raw)}}, 'admin_data_store'), /journal is missing or invalid/);
assert.equal(raw.objects.get(baseKey), original);
assert(raw.objects.has(ACTIVE_KEY));
console.log('PASS: small encrypted atomic admin writes; unchanged logos/history/base; single-commit failure/lost acknowledgment; replay/conflicts/disjoint edits; concurrent mutation/deletion; cold wire reads, checkpoints, auth and corruption guards.');

const storageValues = new Map<string, string>(), storage = {getItem: (key: string) => storageValues.get(key) || null, setItem: (key: string, value: string) => {storageValues.set(key, value);}, removeItem: (key: string) => {storageValues.delete(key);}};
assert(rememberStorefrontDraft(storage, 'admin', site, next, 1));
assert.equal(readStorefrontDraft(storage, 'other'), null, 'Drafts are scoped to the signed-in staff identity');
const draft = readStorefrontDraft(storage, 'admin')!;
assert.deepEqual(rebaseStorefrontEdit(draft.base, draft.next, site), {products:next.products,categories:next.categories,settings:next.settings}, 'Reload restores an unsaved stock edit against its verified baseline');
assert.equal(rebaseStorefrontEdit(draft.base, draft.next, {...site, products: site.products.map(product => product.id === 'p4' ? {...product, stock_quantity: 2} : product)}), null, 'Recovery cannot overwrite a newer stock allocation');
assert.equal(rebaseStorefrontEdit(draft.base, draft.next, {...site, settings: {...site.settings, store_name: 'Other edit'}})!.settings.store_name, 'Other edit');
const later = {...next, settings: {...next.settings, store_name: 'Queued edit'}};
rememberStorefrontDraft(storage, 'admin', site, later, 1); acknowledgeStorefrontDraft(storage, 'admin', next, 2);
assert.deepEqual(readStorefrontDraft(storage, 'admin')!.base, next, 'An earlier acknowledgment rebases a newer pending edit rather than deleting it');
acknowledgeStorefrontDraft(storage, 'admin', later, 3); assert.equal(readStorefrontDraft(storage, 'admin'), null);
assert.equal(rememberStorefrontDraft({...storage, setItem: () => {throw new Error('Full');}}, 'admin', site, next, 1), false);
console.log('PASS: durable draft reload, staff isolation, newer stock protection, disjoint rebase, queued acknowledgments and full-cache handling.');

const oldFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response('error code: 1102', {status: 503, headers: {'cf-ray': 'test-ray', 'Retry-After': '3'}});
  await assert.rejects(staffJsonRequest('/api/admin/storefront/state', {method: 'PUT'}), (error: any) => error.status === 503 && error.code === 'WORKER_RESOURCE_LIMIT' && error.requestId === 'test-ray' && error.retryAfterMs === 3000);
  globalThis.fetch = async () => Response.json({ok: true, version: 1});
  assert.equal((await staffJsonRequest('/api/admin/storefront/state')).ok, true);
} finally { globalThis.fetch = oldFetch; configureCloudflareData(env); }
console.log('PASS: non-JSON gateway/resource-limit diagnostics and verified JSON acknowledgments.');
