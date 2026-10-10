import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { applyPackingBatchMerge, PackingMergeConflict, validPackingMergeRequest } from '../src/lib/packingBatchMerge';
import { prepareOrderSnapshotUpdate } from '../src/lib/orderSnapshotUpdate';
import { createStaffMutationQueue } from '../src/lib/staffMutationQueue';
import { configureCloudflareData, dataBucket, importRecovery, readDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';

const order = (id: string, batch: string) => ({ id, order_number: 'FB-' + id, created_at: '2026-10-10T12:00:00Z',
  call_center_status: 'Confirmed', stock_allocated: true, stock_status: 'Allocated', order_status: 'Confirmed',
  invoice_locked: true, invoice_number: 'INV-' + id, invoice_generated_at: '2026-10-10T13:00:00Z',
  invoice_pack_batch_id: batch, waybill_number: 'WB-' + id, total_amount: 1250, delivery_fee: 350,
  payment_received_amount: 250, customer_name: 'Customer ' + id, items: [{ sku: 'SKU-1', quantity: 2 }] });
const original = [order('1', 'PACK-RESTOCK-A'), order('2', 'PACK-RESTOCK-B'),
  { ...order('3', 'PACK-UPLOAD-OLD'), invoice_pack_downloaded_at: '2026-10-09T13:00:00Z' }];
const body = { batch_ids: ['PACK-RESTOCK-A', 'PACK-RESTOCK-B'], order_ids: ['1', '2'], target_batch_id: 'PACK-RESTOCK-MERGED-TEST' };
assert(validPackingMergeRequest(body));
assert(!validPackingMergeRequest({ ...body, order_ids: ['1', '1'] }));
const result = applyPackingBatchMerge(original, body, 'Admin', '2026-10-10T14:00:00Z');
assert.equal(result.updated.length, 2);
for (const changed of result.updated) {
  const { invoice_pack_batch_id, invoice_pack_merge, ...unchanged } = changed;
  const { invoice_pack_batch_id: oldBatch, ...before } = original.find(item => item.id === changed.id)!;
  assert.deepEqual(unchanged, before, 'Merging must preserve invoice, waybill, stock, amounts and customer fields');
  assert.equal(invoice_pack_merge.source_batch_id, oldBatch);
  const stale = prepareOrderSnapshotUpdate(changed, original.find(item => item.id === changed.id)!, []);
  assert.deepEqual(stale.order, changed, 'A stale browser cannot undo the saved merge or its audit trail');
}
const merged = [...result.orders, original[2]];
assert.equal(applyPackingBatchMerge(merged, body, 'Other admin', '2026-10-10T15:00:00Z').updated.length, 0);
assert.throws(() => applyPackingBatchMerge(merged, { ...body, batch_ids: ['PACK-RESTOCK-X', 'PACK-RESTOCK-Y'] }, 'Admin', ''), PackingMergeConflict);
assert.throws(() => applyPackingBatchMerge([...original, order('4', 'PACK-RESTOCK-A')], body, 'Admin', ''), PackingMergeConflict);
for (const blocked of [{ invoice_pack_downloaded_at: 'today' }, { fardar_csv_exported_at: 'today' },
  { dispatch_status: 'Handed Over' }, { invoice_number: '' }, { stock_allocated: false }, { waybill_number: 'WB-2' }]) {
  assert.throws(() => applyPackingBatchMerge([{ ...original[0], ...blocked }, original[1]], body, 'Admin', ''), PackingMergeConflict);
}

class MemoryBucket {
  objects = new Map<string, any>(); revision = 0; failKey = '';
  async get(key: string) { const value = this.objects.get(key); return value ? { ...value, text: async () => value.value } : null; }
  async put(key: string, value: string, options: any = {}) {
    if (key === this.failKey) throw new Error('simulated durable write failure');
    const current = this.objects.get(key), condition = options.onlyIf;
    if (condition?.etagMatches && condition.etagMatches !== current?.etag || condition?.etagDoesNotMatch === '*' && current) return null;
    const next = { value, etag: String(++this.revision), customMetadata: options.customMetadata };
    this.objects.set(key, next); return { etag: next.etag };
  }
}
const raw = new MemoryBucket(), secret = 'test-merge-secret';
const users = [{ id: 'admin', username: 'admin', role: 'admin', is_active: true },
  { id: 'staff', username: 'staff', role: 'staff', is_active: true }];
const env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: secret, SUPABASE_SECRET_KEY: 'test-storage-secret' };
configureCloudflareData(env);
await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders: original,
  admin_users: users, admin_data_store: [{ key: 'storefront-state-v1', payload: { products: [{ id: 'p1', stock_quantity: 7 }], settings: {} } }],
  courier_waybills: original.map(item => ({ waybill_number: item.waybill_number, status: 'Assigned', assigned_order_number: item.order_number })) });
const token = (id: string) => {
  const payload = Buffer.from(JSON.stringify({ sub: id, role: id === 'admin' ? 'admin' : 'staff', exp: Date.now() + 60000 })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
};
const request = (auth = token('admin'), data: any = body) => withR2DataFallback(new Request('https://test/api/orders/invoices/merge-batches',
  { method: 'POST', headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  env, {}, async () => new Response('Unexpected fallback', { status: 599 }));
assert.equal((await request('')).status, 401);
assert.equal((await request(token('staff'))).status, 403);
assert.equal((await request(token('admin'), {})).status, 400);
const stock = await readDataTable(env, 'admin_data_store'), pool = await readDataTable(env, 'courier_waybills');
const saved = await request(); assert.equal(saved.status, 200);
assert.equal((await saved.json() as any).orders.length, 2);
const rows = await readDataTable(env, 'order_snapshots');
assert.equal(rows.find(row => row.order_id === '3')?.payload.invoice_pack_batch_id, 'PACK-UPLOAD-OLD');
assert.deepEqual(await readDataTable(env, 'admin_data_store'), stock);
assert.deepEqual(await readDataTable(env, 'courier_waybills'), pool);
const revision = raw.revision;
const replay = await request(); assert.equal(replay.status, 200);
assert.equal((await replay.json() as any).already_saved, true);
assert.equal(raw.revision, revision, 'A lost acknowledgement replay must not write a second time');

let clock = 0, active = 0, maxActive = 0;
const starts: number[] = [], queue = createStaffMutationQueue(1100, async ms => { clock += ms; }, () => clock);
const writes = [1, 2, 3].map(id => queue.run(async () => {
  active++; maxActive = Math.max(active, maxActive); starts.push(clock);
  await Promise.resolve(); active--; if (id === 2) throw new Error('Transient failure'); return id;
}));
const outcomes = await Promise.allSettled(writes);
assert.equal(maxActive, 1); assert.deepEqual(starts, [0, 1100, 2200]);
assert.equal(outcomes[2].status, 'fulfilled', 'A failed save must not poison later saves');
await queue.drain();
console.log('Packing merge: complete invoices preserved, stale/exported/downloaded batches rejected, authenticated R2 save and replay verified; staff writes serialized.');
