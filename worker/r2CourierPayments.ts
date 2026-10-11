import { applyCodPaymentEntries, canRecordCourierPayments, validCodPaymentEntries } from '../src/lib/codPaymentImport';
import { replaceDataTable } from './cloudflareData';
import type { Order } from '../src/types';

export const r2CourierPaymentsHandler = async (request: Request, env: unknown, user: { role?: string; permissions?: string[] }) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ora-storage': 'cloudflare-r2' } });
  if (!canRecordCourierPayments(user)) return json({ error: 'COD Payments or Profit Report edit permission required.' }, 403);
  const entries = (await request.json().catch(() => null))?.entries;
  if (!validCodPaymentEntries(entries)) return json({ error: 'Send 1 to 20 valid payment or completed-return entries.' }, 400);
  const now = new Date().toISOString();
  const result = await replaceDataTable(env, 'order_snapshots', rows => {
    const applied = applyCodPaymentEntries(rows.map(row => row.payload).filter(Boolean) as Order[], entries, now);
    const changes = new Map(applied.updatedOrders.map(order => [String(order.id), order]));
    let changed = 0;
    const next = rows.map(row => {
      const order = changes.get(String(row.order_id));
      if (!order) return row;
      changed++;
      return { ...row, payload: order, updated_at: now };
    });
    if (changed !== changes.size) throw new Error('Order identity mismatch; courier update stopped.');
    const { updatedOrders, ...summary } = applied;
    return { rows: next, result: { ok: true, ...summary } };
  });
  return json(result);
};
