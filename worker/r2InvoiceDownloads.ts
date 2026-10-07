import { replaceDataTable } from './cloudflareData';
import { applyInvoiceDownloadStatus, invoiceDownloadRequest, InvoiceDownloadError } from '../src/lib/invoiceDownloadStatus';

export const r2InvoiceDownloadsHandler = async (request: Request, env: unknown) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ora-storage': 'cloudflare-r2' } });
  const body = invoiceDownloadRequest(await request.json().catch(() => null));
  if (!body) return json({ error: 'Send 1 to 50 valid invoice order IDs and download details.' }, 400);
  try {
    const saved = await replaceDataTable(env, 'order_snapshots', rows => {
      const result = applyInvoiceDownloadStatus(rows.map(row => row.payload).filter(Boolean), body);
      const changed = new Map(result.updatedOrders.map(order => [String(order.id), order]));
      const now = new Date().toISOString();
      const next = changed.size ? rows.map(row => changed.has(String(row.order_id))
        ? { ...row, payload: changed.get(String(row.order_id)), updated_at: now } : row) : rows;
      return { rows: next, result: result.orders };
    });
    return json({ ok: true, downloadedAt: body.downloadedAt, updatedCount: saved.length, orders: saved });
  } catch (error) {
    if (error instanceof InvoiceDownloadError) return json({ error: error.message }, error.status);
    throw error;
  }
};
