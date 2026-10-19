import { confirmCsvRequestWithRetry } from './confirmCsvSave';
import { orderJournalShard } from './orderJournalShard';

type RecordData = Record<string, any>;
export class InvoiceDownloadError extends Error {
  constructor(message: string, readonly status = 404) { super(message); }
}
export type InvoiceDownloadIdentity = { id: string; invoiceNumber: string; batchId: string; waybill: string };
export type InvoiceDownloadRequest = {
  orderIds: string[];
  downloadedAt: string;
  downloadedBy: string;
  downloadSet?: { date: string; number: number };
  invoices?: InvoiceDownloadIdentity[];
};
const sameInvoice = (order: RecordData, invoice: InvoiceDownloadIdentity) => String(order.invoice_number||'')===invoice.invoiceNumber &&
  String(order.invoice_pack_batch_id||'')===invoice.batchId && String(order.waybill_number||'')===invoice.waybill;

export const mergeInvoiceDownloadReceipt = <T extends RecordData>(current: T, receipt: RecordData): T => {
  if (String(current.id) !== String(receipt.id) || Date.parse(current.invoice_pack_downloaded_at || '') > Date.parse(receipt.invoice_pack_downloaded_at || '')) return current;
  if (['invoice_number','invoice_pack_batch_id','waybill_number'].some(field=>Object.hasOwn(current,field)&&Object.hasOwn(receipt,field)&&current[field]!==receipt[field])) return current;
  const fields = ['invoice_pack_downloaded_at', 'invoice_pack_downloaded_by', 'invoice_pack_download_set_date', 'invoice_pack_download_set_number'];
  return { ...current, ...Object.fromEntries(fields.filter(field => Object.hasOwn(receipt, field)).map(field => [field, receipt[field]])) };
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
  const orderIds=[...new Set<string>(body.orderIds.map((id:string)=>id.trim()))], invoices=body.invoices;
  if(invoices!==undefined&&(!Array.isArray(invoices)||invoices.length!==orderIds.length||new Set(invoices.map((invoice:any)=>invoice?.id)).size!==orderIds.length||
    invoices.some((invoice:any)=>!invoice||!orderIds.includes(invoice.id)||['invoiceNumber','batchId','waybill'].some(field=>typeof invoice[field]!=='string'||invoice[field].length>200))))return null;
  return { orderIds, downloadedAt,
    downloadedBy: downloadedBy.trim() || 'Packing Staff', ...(set ? { downloadSet: { date: set.date, number: set.number } } : {}),
    ...(invoices?{invoices:invoices.map((invoice:InvoiceDownloadIdentity)=>({id:invoice.id,invoiceNumber:invoice.invoiceNumber,batchId:invoice.batchId,waybill:invoice.waybill}))}:{}) };
};

// Patch only download metadata against CURRENT durable orders. Replays are
// write-free and an older retry cannot replace a newer download record.
export const applyInvoiceDownloadStatus = (orders: RecordData[], body: InvoiceDownloadRequest) => {
  const byId = new Map<string, RecordData[]>();
  for (const order of orders) { const id = String(order.id), rows = byId.get(id) || []; rows.push(order); byId.set(id, rows); }
  const matched = body.orderIds.map(id => {
    const rows = byId.get(id) || [];
    if (rows.length !== 1) throw new InvoiceDownloadError('Invoice order was not uniquely found: ' + id);
    const expected=body.invoices?.find(invoice=>invoice.id===id), current=rows[0];
    if(expected&&!sameInvoice(current,expected))
      throw new InvoiceDownloadError('This invoice or parcel changed after the PDF was downloaded. Review its current invoice before marking it Downloaded.',422);
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

export const invoiceDownloadBatches = (ids: string[], downloadedBy: string, downloadSet?: InvoiceDownloadRequest['downloadSet'], invoices?: InvoiceDownloadIdentity[]) => {
  const unique = [...new Set(ids.map(id => String(id).trim()).filter(Boolean))];
  const partitions = new Map<string, string[]>(), batches: InvoiceDownloadRequest[] = [], downloadedAt = new Date().toISOString();
  for (const id of unique) { const shard = orderJournalShard(id), group = partitions.get(shard) || []; group.push(id); partitions.set(shard, group); }
  for (const group of partitions.values()) for (let offset = 0; offset < group.length; offset += 50) {
    const orderIds=group.slice(offset,offset+50);
    const body = invoiceDownloadRequest({ orderIds, downloadedAt, downloadedBy, ...(downloadSet ? { downloadSet } : {}),
      ...(invoices?{invoices:invoices.filter(invoice=>orderIds.includes(invoice.id))}:{}) });
    if (!body) throw new Error('Invoice download details are invalid. Keep the PDF and retry saving its status.');
    batches.push(body);
  }
  return batches;
};

export const saveInvoiceDownloadRequest = async (body: InvoiceDownloadRequest,
  request: (url: string, options?: RequestInit) => Promise<any>, pause?: (ms: number) => Promise<void>) => {
  const {downloadedAt, downloadedBy, downloadSet} = body;
  const checked = async (url: string, options?: RequestInit) => {
    const data = await request(url, options);
    if (data?.ok !== true || !Array.isArray(data.orders) || data.orders.length !== body.orderIds.length ||
        new Set(data.orders.map((order: any) => order?.id)).size !== body.orderIds.length ||
        body.orderIds.some(id => !data.orders.some((order: any) => order?.id === id &&
          (!body.invoices||body.invoices.some(invoice=>invoice.id===id&&sameInvoice(order,invoice))) &&
          (Date.parse(order.invoice_pack_downloaded_at || '') > Date.parse(downloadedAt) ||
            (order.invoice_pack_downloaded_at === downloadedAt && order.invoice_pack_downloaded_by === downloadedBy &&
              (!downloadSet || (order.invoice_pack_download_set_date === downloadSet.date && order.invoice_pack_download_set_number === downloadSet.number))))))) {
      const error: any = new Error('The server did not confirm every invoice download.'); error.status = 503; throw error;
    }
    return data;
  };
  const data = await confirmCsvRequestWithRetry(checked, '/api/orders/invoice-download-status',
    { method: 'POST', body: JSON.stringify(body) }, pause);
  return data.orders as RecordData[];
};

export const saveInvoiceDownloadStatus = async (ids: string[], downloadedBy: string,
  downloadSet: InvoiceDownloadRequest['downloadSet'], request: (url: string, options?: RequestInit) => Promise<any>,
  pause?: (ms: number) => Promise<void>) => {
  const orders: RecordData[] = [];
  for (const body of invoiceDownloadBatches(ids, downloadedBy, downloadSet)) orders.push(...await saveInvoiceDownloadRequest(body, request, pause));
  return orders;
};
