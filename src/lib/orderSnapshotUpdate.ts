type Row = Record<string, any>;
import { physicalReturnItems } from './returnSheets';
export class OrderUpdateConflict extends Error { readonly status = 409; }

// One-way stock, invoice and courier guards for order snapshot updates.
export const prepareOrderSnapshotUpdate = (existing: Row | undefined, incoming: Row, locks: readonly Row[]) => {
  const order = { ...incoming };
  if(!existing){delete order.stock_quantity_correction;delete order.stock_quantity_correction_lock;delete order.item_edit;delete order.item_edit_lock;}
  let waybillPreserved = false;
  const requestedWaybill = String(order.waybill_number || '').trim();
  const lock = locks.find(row => String(row.waybill_number) === requestedWaybill);
  if (lock && ['Assigned', 'Used', 'Cancelled'].includes(String(lock.status || '')) && lock.assigned_order_number &&
      String(lock.assigned_order_number) !== String(order.order_number || ''))
    throw new OrderUpdateConflict('Waybill ' + requestedWaybill + ' is already locked/used by ' + String(lock.assigned_order_number) + '.');
  if (existing) {
    // Missing-lead recovery owns the original identity and its retry receipt.
    // An in-flight webhook or stale browser predating recovery cannot replace
    // the restored Sheet corrections with a newly built lead snapshot.
    if (existing.facebook_missing_recovery) {
      if (incoming.facebook_missing_recovery?.operation_id !== existing.facebook_missing_recovery.operation_id)
        return {order: existing, waybillPreserved: true};
      order.facebook_missing_recovery = existing.facebook_missing_recovery;
      for (const field of ['id','order_number','order_source','platform_lead_id','sheet_lead_recovery'])
        if (existing[field] !== undefined) order[field] = existing[field];
    } else delete order.facebook_missing_recovery;
    // Duplicate review owns its hold and approval. A stale browser mirror must
    // neither release a pending repeat purchase nor restore a cleared hold.
    if(existing.is_duplicate_order===true||existing.duplicate_review_status){
      order.is_duplicate_order=existing.is_duplicate_order===true;
      for(const field of ['duplicate_review_status','duplicate_reviewed_at','duplicate_reviewed_by','duplicate_reviewed_by_name','duplicate_of_order_id','duplicate_fingerprint']){
        if(existing[field]!==undefined)order[field]=existing[field];else delete order[field];
      }
    }
    if (existing.variant_correction_lock || existing.stock_quantity_correction_lock || existing.item_edit_lock) return { order: existing, waybillPreserved: true };
    if (existing.stock_quantity_correction) {
      for (const field of ['stock_quantity_correction','items','invoice_confirm_snapshot']) {
        if (existing[field] !== undefined) order[field] = existing[field]; else delete order[field];
      }
    } else delete order.stock_quantity_correction;
    delete order.stock_quantity_correction_lock;
    // Courier imports own these amounts. A stale order editor or browser mirror
    // cannot erase a confirmed invoice fee or turn a return back into a delivery.
    for (const field of ['fardar_delivery_fee','fardar_return_fee','fardar_return_fee_recorded_at','fardar_invoice_status','fardar_invoice_waybill'])
      if (existing[field] !== undefined) order[field] = existing[field];
    if (existing.cod_payment_source === 'Fardar CSV' && existing.cod_payment_received_at !== incoming.cod_payment_received_at) {
      for (const field of ['cod_payment_received','cod_payment_amount','cod_payment_amount_basis','cod_payment_received_at','cod_payment_source','cod_payment_reference','payment_status','payment_paid_type']) {
        if (existing[field] !== undefined) order[field] = existing[field]; else delete order[field];
      }
    }
    // A browser mirror cannot acknowledge, remove or replace a server Sheet
    // import receipt. Hold imported orders until the complete batch is saved.
    if(existing.sheet_confirm_hold)return {order:existing,waybillPreserved:true};
    if(existing.sheet_confirm_import){
      order.sheet_confirm_import=existing.sheet_confirm_import;
      for(const field of ['items','subtotal','special_offer_discount','delivery_rebalance_qty_offer','delivery_rebalance_qty_offer_amount','delivery_rebalance_amount_snapshot','delivery_visible_fee_snapshot',
        'delivery_fee','gift_wrap_selected','gift_wrap_fee','total_amount','customer_name','address','city','district','fardar_city','city_verified','city_mapping_source',
        'confirm_upload_batch_id','invoice_confirm_snapshot','call_center_status','call_center_updated_at','product_change_history','notes','cancelled_at','cancelled_by','cancel_reason']){
        if(existing[field]!==undefined)order[field]=existing[field];else delete order[field];
      }
      if(!['Shipped','Delivered'].includes(String(order.order_status))||['Cancelled','Delivered'].includes(String(existing.order_status)))order.order_status=existing.order_status;
    }else delete order.sheet_confirm_import;
    if (existing.variant_correction) {
      for (const field of ['variant_correction','items','invoice_confirm_snapshot','product_change_history','notes',
        'invoice_pack_downloaded_at','invoice_pack_downloaded_by','invoice_pack_download_set_date','invoice_pack_download_set_number']) {
        if (existing[field] !== undefined) order[field] = existing[field]; else delete order[field];
      }
    } else delete order.variant_correction;
    delete order.variant_correction_lock;
    delete order.sheet_confirm_hold;
    if(existing.return_packing_lock?.operation_id)return {order:existing,waybillPreserved:true};
    if(existing.return_packing_operation){
      order.return_packing_operation=existing.return_packing_operation;
      for(const field of ['customer_name','phone','whatsapp','address','city','district','items','subtotal','total_amount','special_offer_discount','delivery_fee','gift_wrap_selected','gift_wrap_fee','payment_method','payment_paid_type','payment_received_amount','invoice_confirm_snapshot']){if(existing[field]!==undefined)order[field]=existing[field];else delete order[field];}
    }
    if (existing.return_sheet_id || existing.return_tracking_waybill) {
      const signature = (value: Row) => {
        try { return JSON.stringify(physicalReturnItems(value).map(item => [item.id,item.expected_qty]).sort()); }
        catch { throw new OrderUpdateConflict('The items linked to this return sheet are invalid.'); }
      };
      if (signature(existing) !== signature(incoming)) throw new OrderUpdateConflict('Items in a return sheet cannot be replaced by an order edit.');
      order.items = existing.items;
      for (const field of ['return_tracking_waybill','return_state','return_pending_qty','return_damaged_qty','return_checked_at','return_packing_operation','return_sheet_id','return_sheet_waybill','return_sheet_revision','return_status','return_received_at','return_checked_by','delivery_status','order_status','call_center_status','is_duplicate_order','is_test_order']) {
        if (existing[field] !== undefined) order[field] = existing[field];
        else delete order[field];
      }
    }
    if (/^PACK-(RESTOCK|RETURN)-/.test(String(existing.invoice_pack_batch_id || ''))) order.invoice_pack_batch_id = existing.invoice_pack_batch_id;
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
        'invoice_payment_label_snapshot', 'invoice_advance_percentage_snapshot', 'invoice_pack_merge']) if (existing[field] !== undefined) order[field] = existing[field];
      order.invoice_locked = true;
    }
    // This server operation owns item money and invoice snapshots. Older Sheet
    // uploads and browser mirrors must not reinstate the previous parcel.
    if (existing.item_edit) {
      for (const field of ['item_edit','items','subtotal','total_amount','special_offer_discount','delivery_rebalance_qty_offer',
        'delivery_rebalance_qty_offer_amount','delivery_rebalance_offset','delivery_fee','gift_wrap_selected','gift_wrap_fee','is_advance_required','advance_amount',
        'invoice_confirm_snapshot','product_change_history','stock_quantity_correction',
        ...(existing.invoice_locked ? ['invoice_pack_batch_id','invoice_generated_at','invoice_generated_by',
          'invoice_pack_downloaded_at','invoice_pack_downloaded_by','invoice_pack_download_set_date','invoice_pack_download_set_number',
          'fardar_csv_exported_at','fardar_csv_exported_by','fardar_csv_export_batch_id','fardar_csv_exported_waybill','invoice_payment_label_snapshot'] : [])]) {
        if (existing[field] !== undefined) order[field] = existing[field]; else delete order[field];
      }
      if (incoming.item_edit?.operation_id !== existing.item_edit.operation_id) {
        for (const field of ['payment_received_amount','payment_status','payment_paid_type','invoice_payment_label_snapshot']) {
          if (existing[field] !== undefined) order[field] = existing[field]; else delete order[field];
        }
      }
    } else delete order.item_edit;
    delete order.item_edit_lock;
  }
  return { order, waybillPreserved };
};
