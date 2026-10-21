import { confirmCsvRequestWithRetry } from './confirmCsvSave';

type Row = Record<string, any>;
export const FARDAR_EXPORT_STATUS_API = '/api/orders/fardar-export-status';
type Entry = {id: string; waybill: string; invoice_number: string; invoice_batch_id: string};
export type FardarExportRequest = {entries: Entry[]; exported_at: string; exported_by: string; export_batch_id: string};
export class FardarExportError extends Error {
  constructor(message: string, public status = 409) {super(message);}
}
export const fardarExportRequest = (body: any): FardarExportRequest | null => {
  if (!Array.isArray(body?.entries) || !body.entries.length || body.entries.length > 50 ||
      body.entries.some((entry: any) => !entry || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 150 ||
        typeof entry.waybill !== 'string' || !entry.waybill.trim() || entry.waybill.length > 100 ||
        typeof entry.invoice_number !== 'string' || entry.invoice_number.length > 200 ||
        typeof entry.invoice_batch_id !== 'string' || entry.invoice_batch_id.length > 200) ||
      new Set(body.entries.map((entry: Entry) => entry.id.trim())).size !== body.entries.length ||
      typeof body.exported_at !== 'string' || body.exported_at.length > 40 || !Number.isFinite(Date.parse(body.exported_at)) ||
      typeof body.exported_by !== 'string' || !body.exported_by.trim() || body.exported_by.length > 200 ||
      typeof body.export_batch_id !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(body.export_batch_id)) return null;
  return {entries: body.entries.map((entry: Entry) => ({...entry, id: entry.id.trim(), waybill: entry.waybill.trim()})),
    exported_at: body.exported_at, exported_by: body.exported_by.trim(), export_batch_id: body.export_batch_id};
};

// Patch only export history against current orders. Every member is validated
// before one conditional commit; stock, invoices, payment and waybills stay exact.
export const applyFardarExportStatus = (orders: readonly Row[], body: FardarExportRequest) => {
  const matched = body.entries.map(entry => {
    const matches = orders.filter(order => String(order.id) === entry.id);
    if (matches.length !== 1) throw new FardarExportError('Fardar order not uniquely found: ' + entry.id, 404);
    const order = matches[0];
    if (String(order.waybill_number || '').trim() !== entry.waybill || String(order.invoice_number || '') !== entry.invoice_number ||
        String(order.invoice_pack_batch_id || '') !== entry.invoice_batch_id)
      throw new FardarExportError(order.order_number + ': The saved parcel changed. Refresh this batch before downloading its CSV.');
    if (order.order_status === 'Cancelled' || order.cancel_stock_restore || !order.stock_allocated || order.call_center_status !== 'Confirmed')
      throw new FardarExportError(order.order_number + ': This parcel is not ready for Fardar export.');
    if (order.variant_correction_lock || order.stock_quantity_correction_lock || order.item_edit_lock || order.sheet_confirm_hold)
      throw new FardarExportError(order.order_number + ': Its saved operation is finishing. Retry this same batch shortly.');
    return {entry, order};
  });
  const updatedOrders: Row[] = [];
  const saved = matched.map(({entry, order}) => {
    // A lost response or another user's download must retain the first durable
    // acknowledgment for this waybill, without rewriting the order again.
    if (order.fardar_csv_exported_waybill === entry.waybill && Number.isFinite(Date.parse(order.fardar_csv_exported_at || ''))) return order;
    const next = {...order, fardar_csv_exported_at: body.exported_at, fardar_csv_exported_by: body.exported_by,
      fardar_csv_export_batch_id: body.export_batch_id, fardar_csv_exported_waybill: entry.waybill};
    updatedOrders.push(next); return next;
  });
  return {orders: saved, updatedOrders};
};

export const saveFardarExportStatus = async (orders: readonly Row[], actor: string, batchId: string,
  request: (url: string, options?: RequestInit) => Promise<any>, pause?: (ms: number) => Promise<void>) => {
  const entries = new Map<string, Entry>();
  for (const order of orders) {
    const entry = {id: String(order.id), waybill: String(order.waybill_number || '').trim(), invoice_number: String(order.invoice_number || ''), invoice_batch_id: String(order.invoice_pack_batch_id || '')};
    if (entries.has(entry.id) && JSON.stringify(entries.get(entry.id)) !== JSON.stringify(entry)) throw new FardarExportError('The selected order appears with different parcel details. Refresh before export.');
    entries.set(entry.id, entry);
  }
  const selected = [...entries.values()], exported_at = new Date().toISOString(), saved: Row[] = [];
  for (let offset = 0; offset < selected.length; offset += 50) {
    const body = {entries: selected.slice(offset, offset + 50), exported_at, exported_by: actor.trim() || 'Packing Staff', export_batch_id: batchId};
    if (!fardarExportRequest(body)) throw new FardarExportError('Select current Fardar orders with valid invoice and waybill details.', 400);
    const checked = async (url: string, options?: RequestInit) => {
      const result = await request(url, options);
      if (!result?.ok || !Array.isArray(result.orders) || result.orders.length !== body.entries.length ||
          new Set(result.orders.map((order: Row) => order?.id)).size !== body.entries.length ||
          body.entries.some(entry => !result.orders.some((order: Row) => order?.id === entry.id &&
            String(order.waybill_number || '').trim() === entry.waybill && order.fardar_csv_exported_waybill === entry.waybill &&
            Number.isFinite(Date.parse(order.fardar_csv_exported_at || ''))))) {
        const error: any = new Error('The server did not confirm every Fardar export. Retry this same batch.'); error.status = 503; throw error;
      }
      return result;
    };
    const result = await confirmCsvRequestWithRetry(checked, FARDAR_EXPORT_STATUS_API, {method: 'POST', body: JSON.stringify(body)}, pause);
    saved.push(...result.orders);
  }
  return saved;
};
