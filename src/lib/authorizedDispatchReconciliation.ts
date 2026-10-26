// Explicitly authorized, one-time reconciliation for five October 14 parcels.
// A paid, delivered courier record (or an existing Delivered order) proves that
// courier handover occurred, but NOT the time an original scan took place.
// Never manufacture dispatch_scanned_at or override financial/stock records.
export const AUTHORIZED_DISPATCH_WAYBILLS = [
  {order_number:'FB-000664',waybill:'18160742'},
  {order_number:'FB-000658',waybill:'18160740'},
  {order_number:'FB-000657',waybill:'18160739'},
  {order_number:'FB-000654',waybill:'18160738'},
  {order_number:'FB-000653',waybill:'18160737'},
] as const;

type Order = Record<string,any>;
export type DispatchRow = {order_id:string;payload?:Order;updated_at?:string;[field:string]:unknown};
export type DispatchReconciliationResult<T extends DispatchRow> = {
  rows:readonly T[]; reconciled:string[]; already_saved:string[];
  skipped:Array<{order_number:string;reason:string}>;
};
const normalized=(value:unknown)=>String(value??'').trim().replace(/^'+|'+$/g,'').toUpperCase();
const is=(value:unknown,status:string)=>normalized(value)===status.toUpperCase();
const failed=(order_number:string,reason:string)=>({order_number,reason});

export const reconcileAuthorizedDispatch = <T extends DispatchRow>(
  rows:readonly T[], now:string,
):DispatchReconciliationResult<T>=>{
  const reconciled:string[]=[],already_saved:string[]=[];
  const skipped:Array<{order_number:string;reason:string}>=[];
  let next:T[]|null=null;
  for(const target of AUTHORIZED_DISPATCH_WAYBILLS){
    const matching=rows.filter(row=>normalized(row.payload?.order_number)===target.order_number);
    if(matching.length!==1){
      skipped.push(failed(target.order_number,matching.length?'Duplicate order number':'Order not found'));continue;
    }
    const row=matching[0],order=row.payload!;
    if(normalized(order.waybill_number)!==target.waybill){
      skipped.push(failed(target.order_number,'Expected waybill does not match current order'));continue;
    }
    const colliding=rows.filter(candidate=>normalized(candidate.payload?.waybill_number)===target.waybill);
    if(colliding.length!==1){
      skipped.push(failed(target.order_number,'Waybill is assigned to more than one order'));continue;
    }
    if(is(order.order_status,'Cancelled')||is(order.order_status,'Returned')||order.return_sheet_id||
      order.return_tracking_waybill||order.return_received_at||order.cancel_stock_restore||is(order.fardar_invoice_status,'Return Complete')||
      (order.return_status&&!is(order.return_status,'None'))){
      skipped.push(failed(target.order_number,'Cancelled or return record exists'));continue;
    }
    if(order.item_edit_lock||order.variant_correction_lock||order.stock_quantity_correction_lock||
      order.return_packing_lock){
      skipped.push(failed(target.order_number,'A correction or packing operation is still locked'));continue;
    }
    if(order.invoice_locked!==true||order.stock_allocated!==true){
      skipped.push(failed(target.order_number,'Invoice and stock allocation must be confirmed'));continue;
    }
    const paidFardarDelivery=is(order.fardar_invoice_status,'Delivered') &&
      normalized(order.fardar_invoice_waybill)===target.waybill &&
      (!is(order.payment_method,'COD')||
        (order.cod_payment_received===true&&is(order.payment_status,'Paid')&&is(order.cod_payment_source,'Fardar CSV')));
    const deliveredAlready=is(order.order_status,'Delivered')||
      (is(order.delivery_status,'Delivered')&&is(order.tracking_status,'Delivered'));
    if(!paidFardarDelivery&&!deliveredAlready){
      skipped.push(failed(target.order_number,'Awaiting confirmed delivered courier evidence / COD settlement'));continue;
    }
    const done=is(order.dispatch_status,'Handed Over')&&is(order.order_status,'Delivered')&&
      is(order.delivery_status,'Delivered')&&is(order.tracking_status,'Delivered');
    if(done){already_saved.push(target.order_number);continue;}
    const updated:Order={...order,dispatch_status:'Handed Over',order_status:'Delivered',
      delivery_status:'Delivered',tracking_status:'Delivered',
      dispatch_reconciled_at:now,dispatch_reconciled_by:'Authorized historical courier reconciliation',
      dispatch_reconciliation_evidence:paidFardarDelivery?'Fardar Delivered invoice and recorded payment':'Previously saved Delivered courier status'};
    // Deliberately do not fill dispatch_scanned_at/by: the actual scan timestamp
    // and operator are unknown; this is an audited historical reconciliation.
    if(!next)next=rows.slice() as T[];
    const index=rows.indexOf(row);
    next[index]={...row,payload:updated,updated_at:now} as T;
    reconciled.push(target.order_number);
  }
  return {rows:next||rows,reconciled,already_saved,skipped};
};
