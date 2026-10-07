import { readDataTable, replaceDataTable } from './cloudflareData';
import { prepareOrderSnapshotUpdate, OrderUpdateConflict } from '../src/lib/orderSnapshotUpdate';
import { sameStorefrontValue } from './r2Storefront';

export const r2OrderUpdateHandler = async (request: Request, env: unknown, id: string) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ora-storage': 'cloudflare-r2' } });
  const incoming = (await request.json().catch(() => null))?.order;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || String(incoming.id) !== id ||
      typeof incoming.order_number !== 'string' || !incoming.order_number || !Array.isArray(incoming.items)) return json({ error: 'Invalid order snapshot or ID mismatch.' }, 400);
  const checkUnique = (rows: readonly Record<string, any>[], order: Record<string, any>) => {
    if (rows.some(row => String(row.order_id) !== id && (String(row.order_number) === String(order.order_number) ||
        (order.waybill_number && String(row.payload?.waybill_number || '').trim() === String(order.waybill_number).trim()))))
      throw new OrderUpdateConflict('Order number or waybill already belongs to another order.');
  };
  try {
    const initialRows = await readDataTable(env, 'order_snapshots');
    const initial = initialRows.find(row => String(row.order_id) === id)?.payload;
    if (initial?.cancel_stock_restore?.operation_id) return json({ ok: true, order: initial, waybill_preserved: true, cancellation_preserved: true });
    let locks = await readDataTable(env, 'courier_waybills');
    const first = prepareOrderSnapshotUpdate(initial, incoming, locks);
    checkUnique(initialRows, first.order);
    const wb = String(first.order.waybill_number || '').trim();
    if (wb) {
      await replaceDataTable(env, 'courier_waybills', rows => {
        const current = rows.find(row => String(row.waybill_number) === wb);
        if (current && (current.permanently_retired || current.status === 'Cancelled' ||
            (['Assigned', 'Used'].includes(current.status) && current.assigned_order_number && String(current.assigned_order_number) !== String(first.order.order_number))))
          throw new OrderUpdateConflict('Waybill is already locked or permanently retired.');
        const status = current?.status === 'Used' || first.order.dispatch_status === 'Handed Over' || first.order.order_status === 'Delivered' ? 'Used' : 'Assigned';
        const courier = String(first.order.courier_name || 'Fardar');
        if (current?.status === status && String(current.assigned_order_number) === String(first.order.order_number) && String(current.courier_name || 'Fardar') === courier)
          return { rows, result: null };
        const saved = { ...current, waybill_number: wb, courier_name: courier, status, assigned_order_number: String(first.order.order_number), assigned_at: new Date().toISOString() };
        return { rows: current ? rows.map(row => row === current ? saved : row) : [...rows, saved], result: null };
      });
      locks = await readDataTable(env, 'courier_waybills');
    }
    const saved = await replaceDataTable(env, 'order_snapshots', rows => {
      const row = rows.find(row => String(row.order_id) === id), existing = row?.payload;
      if (existing?.cancel_stock_restore?.operation_id) return { rows, result: { ok: true, order: existing, waybill_preserved: true, cancellation_preserved: true } };
      const result = prepareOrderSnapshotUpdate(existing, incoming, locks), order = result.order;
      checkUnique(rows, order);
      if (existing && sameStorefrontValue(existing, order)) return { rows, result: { ok: true, order: existing, waybill_preserved: result.waybillPreserved } };
      const now = new Date().toISOString(), next = { ...row, order_id: id, order_number: String(order.order_number), payload: order,
        created_at: row?.created_at || order.created_at || now, updated_at: now };
      return { rows: row ? rows.map(current => current === row ? next : current) : [...rows, next], result: { ok: true, order, waybill_preserved: result.waybillPreserved } };
    });
    return json(saved);
  } catch (error) {
    if (error instanceof OrderUpdateConflict) return json({ error: error.message }, error.status);
    throw error;
  }
};
