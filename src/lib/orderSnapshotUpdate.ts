type Row = Record<string, any>;
export class OrderUpdateConflict extends Error { readonly status = 409; }

// One-way stock, invoice and courier guards for order snapshot updates.
export const prepareOrderSnapshotUpdate = (existing: Row | undefined, incoming: Row, locks: readonly Row[]) => {
  const order = { ...incoming };
  let waybillPreserved = false;
  const requestedWaybill = String(order.waybill_number || '').trim();
  const lock = locks.find(row => String(row.waybill_number) === requestedWaybill);
  if (lock && ['Assigned', 'Used', 'Cancelled'].includes(String(lock.status || '')) && lock.assigned_order_number &&
      String(lock.assigned_order_number) !== String(order.order_number || ''))
    throw new OrderUpdateConflict('Waybill ' + requestedWaybill + ' is already locked/used by ' + String(lock.assigned_order_number) + '.');
  if (existing) {
    if (String(existing.invoice_pack_batch_id || '').startsWith('PACK-RESTOCK-')) order.invoice_pack_batch_id = existing.invoice_pack_batch_id;
    const existingWaybill = String(existing.waybill_number || '').trim();
    const waybillProtected = existingWaybill && (existing.waybill_protection_locked === true || existing.invoice_locked === true ||
      existing.fardar_csv_exported_at || existing.fardar_csv_exported_waybill || existing.dispatch_status === 'Handed Over' ||
      existing.order_status === 'Shipped' || existing.order_status === 'Delivered');
    if (waybillProtected) {
      waybillPreserved = requestedWaybill !== existingWaybill;
      for (const field of ['waybill_number', 'courier_name', 'shipment_mode', 'tracking_status', 'delivery_status', 'fardar_city', 'city_verified',
        'fardar_csv_exported_at', 'fardar_csv_exported_by', 'fardar_csv_export_batch_id', 'fardar_csv_exported_waybill',
        'waybill_protection_locked', 'waybill_protection_reason']) if (existing[field] !== undefined) order[field] = existing[field];
      order.waybill_number = existingWaybill;
    }
    if (existing.stock_allocated === true) {
      order.stock_allocated = true;
      for (const field of ['stock_status', 'stock_allocated_at', 'stock_allocated_by']) if (existing[field] !== undefined) order[field] = existing[field];
    }
    if (existing.invoice_locked === true) {
      for (const field of ['invoice_locked', 'invoice_number', 'invoice_generated_at', 'invoice_generated_by', 'invoice_pack_batch_id',
        'invoice_pack_downloaded_at', 'invoice_pack_downloaded_by', 'invoice_pack_download_set_date', 'invoice_pack_download_set_number',
        'invoice_payment_label_snapshot', 'invoice_advance_percentage_snapshot']) if (existing[field] !== undefined) order[field] = existing[field];
      order.invoice_locked = true;
    }
  }
  return { order, waybillPreserved };
};
