import { invoiceComplete, invoiceReady } from './invoiceQueue';

type Row = Record<string, any>;
export class PackingMergeConflict extends Error { readonly status = 409; }
export const packingMergeEligible = (order: Row) => invoiceComplete(order) && invoiceReady(order) &&
  String(order.invoice_pack_batch_id || '').startsWith('PACK-RESTOCK-') &&
  !order.invoice_pack_downloaded_at && !order.fardar_csv_exported_at && !order.fardar_csv_exported_waybill &&
  !order.return_packing_lock && !order.return_packing_operation &&
  order.dispatch_status !== 'Handed Over' && !['Shipped', 'Delivered'].includes(order.order_status);

export const validPackingMergeRequest = (body: any) =>
  Array.isArray(body?.batch_ids) && body.batch_ids.length >= 2 && body.batch_ids.length <= 100 &&
  new Set(body.batch_ids).size === body.batch_ids.length &&
  body.batch_ids.every((id: any) => typeof id === 'string' && /^PACK-RESTOCK-[A-Za-z0-9_-]{1,130}$/.test(id)) &&
  Array.isArray(body.order_ids) && body.order_ids.length > 0 && body.order_ids.length <= 200 &&
  new Set(body.order_ids).size === body.order_ids.length &&
  body.order_ids.every((id: any) => typeof id === 'string' && id.length > 0 && id.length <= 150) &&
  typeof body.target_batch_id === 'string' && /^PACK-RESTOCK-MERGED-[A-Za-z0-9_-]{1,100}$/.test(body.target_batch_id) &&
  !body.batch_ids.includes(body.target_batch_id);

const sameIds = (left: string[], right: string[]) => left.length === right.length &&
  [...left].sort().every((id, index) => id === [...right].sort()[index]);

// Only the grouping and its audit trail change. Invoice snapshots, stock, amounts,
// waybills and download/export flags remain byte-for-byte equivalent.
export const applyPackingBatchMerge = (orders: readonly Row[], body: Row, by: string, now: string) => {
  const ids = new Set<string>(body.order_ids), batches = new Set<string>(body.batch_ids);
  const target = orders.filter(order => order.invoice_pack_batch_id === body.target_batch_id);
  if (target.length) {
    if (!sameIds(target.map(order => String(order.id)), body.order_ids) || target.some(order =>
      order.invoice_pack_merge?.target_batch_id !== body.target_batch_id ||
      !sameIds(order.invoice_pack_merge?.source_batch_ids || [], body.batch_ids) ||
      !sameIds(order.invoice_pack_merge?.order_ids || [], body.order_ids)))
      throw new PackingMergeConflict('This batch ID already belongs to another merge. Refresh and retry.');
    return { orders: target, updated: [] as Row[], already_saved: true };
  }
  const selected = orders.filter(order => batches.has(String(order.invoice_pack_batch_id)));
  if (!sameIds(selected.map(order => String(order.id)), body.order_ids) ||
      new Set(selected.map(order => order.invoice_pack_batch_id)).size !== batches.size)
    throw new PackingMergeConflict('The source batches changed. Refresh the packing list before merging.');
  if (selected.some(order => !packingMergeEligible(order)))
    throw new PackingMergeConflict('Merge requires complete restock invoices that have not been downloaded, exported or dispatched.');
  const waybills = selected.map(order => String(order.waybill_number).trim());
  if (new Set(waybills).size !== selected.length || orders.some(order => !ids.has(String(order.id)) &&
      waybills.includes(String(order.waybill_number || '').trim())))
    throw new PackingMergeConflict('A waybill is duplicated. Resolve it before merging these batches.');
  const updated = selected.map(order => ({ ...order, invoice_pack_batch_id: body.target_batch_id,
    invoice_pack_merge: { target_batch_id: body.target_batch_id, source_batch_id: order.invoice_pack_batch_id,
      source_batch_ids: [...body.batch_ids], order_ids: [...body.order_ids], merged_at: now, merged_by: by,
      ...(order.invoice_pack_merge ? { previous_merge: order.invoice_pack_merge } : {}) } }));
  return { orders: updated, updated, already_saved: false };
};
