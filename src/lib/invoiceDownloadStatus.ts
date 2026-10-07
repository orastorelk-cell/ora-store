import { confirmCsvRequestWithRetry } from './confirmCsvSave';

type RecordData = Record<string, any>;
export class InvoiceDownloadError extends Error { readonly status = 404; }
export type InvoiceDownloadRequest = {
  orderIds: string[];
  downloadedAt: string;
  downloadedBy: string;
  downloadSet?: { date: string; number: number };
};

export const invoiceDownloadRequest = (body: any): InvoiceDownloadRequest | null => {
  if (!Array.isArray(body?.orderIds) || !body.orderIds.length || body.orderIds.length > 50 ||
      body.orderIds.some((id: any) => typeof id !== 'string' || !id.trim() || id.length > 150)) return null;
  const downloadedAt = body.downloadedAt === undefined ? new Date().toISOString() : body.downloadedAt;
  if (typeof downloadedAt !== 'string' || downloadedAt.length > 40 || !Number.isFinite(Date.parse(downloadedAt))) return null;
  const downloadedBy = body.downloadedBy === undefined ? 'Packing Staff' : body.downloadedBy;
  if (typeof downloadedBy !== 'string' || downloadedBy.length > 200) return null;
  const set = body.downloadSet;
  if (set !== undefined && (!set || typeof set.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(set.date) ||
      !Number.isFinite(Date.parse(set.date)) || !Number.isSafeInteger(set.number) || set.number < 1)) return null;
  return { orderIds: [...new Set<string>(body.orderIds.map((id: string) => id.trim()))], downloadedAt,
    downloadedBy: downloadedBy.trim() || 'Packing Staff', ...(set ? { downloadSet: { date: set.date, number: set.number } } : {}) };
};

// Patch only download metadata against CURRENT durable orders. Replays are
// write-free and an older retry cannot replace a newer download record.
export const applyInvoiceDownloadStatus = (orders: RecordData[], body: InvoiceDownloadRequest) => {
  const matched = body.orderIds.map(id => {
    const rows = orders.filter(order => String(order.id) === id);
    if (rows.length !== 1) throw new InvoiceDownloadError('Invoice order was not uniquely found: ' + id);
    return rows[0];
  });
  const updatedOrders: RecordData[] = [];
  const saved = matched.map(order => {
    if (Date.parse(order.invoice_pack_downloaded_at || '') > Date.parse(body.downloadedAt)) return order;
    const fields: RecordData = { invoice_pack_downloaded_at: body.downloadedAt, invoice_pack_downloaded_by: body.downloadedBy,
      ...(body.downloadSet ? { invoice_pack_download_set_date: body.downloadSet.date, invoice_pack_download_set_number: body.downloadSet.number } : {}) };
    if (Object.keys(fields).every(field => order[field] === fields[field])) return order;
    const next = { ...order, ...fields };
    updatedOrders.push(next);
    return next;
  });
  return { orders: saved, updatedOrders };
};

export const saveInvoiceDownloadStatus = async (ids: string[], downloadedBy: string,
  downloadSet: InvoiceDownloadRequest['downloadSet'], request: (url: string, options?: RequestInit) => Promise<any>,
  pause?: (ms: number) => Promise<void>) => {
  const unique = [...new Set(ids.map(id => String(id).trim()).filter(Boolean))];
  downloadedBy = downloadedBy.trim() || 'Packing Staff';
  const downloadedAt = new Date().toISOString(), orders: RecordData[] = [];
  for (let offset = 0; offset < unique.length; offset += 50) {
    const body = { orderIds: unique.slice(offset, offset + 50), downloadedAt, downloadedBy, ...(downloadSet ? { downloadSet } : {}) };
    const checked = async (url: string, options?: RequestInit) => {
      const data = await request(url, options);
      if (!data?.ok || !Array.isArray(data.orders) || data.orders.length !== body.orderIds.length ||
          new Set(data.orders.map((order: any) => order?.id)).size !== body.orderIds.length ||
          body.orderIds.some(id => !data.orders.some((order: any) => order?.id === id &&
            (Date.parse(order.invoice_pack_downloaded_at || '') > Date.parse(downloadedAt) ||
              (order.invoice_pack_downloaded_at === downloadedAt && order.invoice_pack_downloaded_by === downloadedBy &&
                (!downloadSet || (order.invoice_pack_download_set_date === downloadSet.date && order.invoice_pack_download_set_number === downloadSet.number))))))) {
        const error: any = new Error('The server did not confirm every invoice download.'); error.status = 503; throw error;
      }
      return data;
    };
    const data = await confirmCsvRequestWithRetry(checked, '/api/orders/invoice-download-status',
      { method: 'POST', body: JSON.stringify(body) }, pause);
    orders.push(...data.orders);
  }
  return orders;
};
