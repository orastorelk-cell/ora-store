import { returnPackingInProgress } from '../src/lib/returnSheets';
import { applyPackingBatchMerge, PackingMergeConflict, validPackingMergeRequest } from '../src/lib/packingBatchMerge';
import { readDataTable, replaceDataTable } from './cloudflareData';

export const r2PackingBatchMergeHandler = async (request: Request, env: unknown, user: Record<string, any>) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ora-storage': 'cloudflare-r2' } });
  if (user.role !== 'admin') return json({ error: 'Super Admin permission required to merge batches.' }, 403);
  const body = await request.json().catch(() => null);
  if (!validPackingMergeRequest(body)) return json({ error: 'Select 2 or more restock batches, with at most 200 invoices.' }, 400);
  if (returnPackingInProgress(await readDataTable(env, 'admin_data_store')))
    return json({ error: 'A return packing operation is finishing. Complete it before merging.' }, 409);
  try {
    const result = await replaceDataTable(env, 'order_snapshots', rows => {
      const now = new Date().toISOString();
      const merged = applyPackingBatchMerge(rows.map(row => row.payload).filter(Boolean), body,
        String(user.display_name || user.username || 'Admin'), now);
      const changed = new Map(merged.updated.map(order => [String(order.id), order]));
      let count = 0;
      const next = changed.size ? rows.map(row => {
        const order = changed.get(String(row.order_id)); if (!order) return row;
        count++; return { ...row, payload: order, updated_at: now };
      }) : rows;
      if (count !== changed.size) throw new PackingMergeConflict('An order identity changed. Refresh before merging.');
      return { rows: next, result: { ok: true, batch_id: body.target_batch_id, orders: merged.orders,
        source_batch_ids: body.batch_ids, already_saved: merged.already_saved } };
    });
    return json(result);
  } catch (error) {
    if (error instanceof PackingMergeConflict) return json({ error: error.message }, 409);
    throw error;
  }
};
