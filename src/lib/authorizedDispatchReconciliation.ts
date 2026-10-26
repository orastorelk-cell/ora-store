// Authorized historical courier reconciliation. This is not a fabricated
// barcode scan: retain the original scan audit fields unchanged.
export const AUTHORIZED_DISPATCH_WAYBILLS = [
  {order_number:'FB-000664',waybill:'18160742'},
  {order_number:'FB-000658',waybill:'18160740'},
  {order_number:'FB-000657',waybill:'18160739'},
  {order_number:'FB-000654',waybill:'18160738'},
  {order_number:'FB-000653',waybill:'18160737'},
] as const;

type Order = Record<string,any>;
export type DispatchRow = {order_id?:string;payload?:Order;updated_at?:string;[field:string]:any};
type AdminRow = {key?:string;payload?:Record<string,any>};
export type DispatchReconciliationResult<T extends DispatchRow> = {
  rows:readonly T[];reconciled:string[];already_saved:string[];
  skipped:Array<{order_number:string;reason:string}>;
};

const normalized=(value:unknown)=>String(value??'').trim().replace(/^'+|'+$/g,'').toUpperCase();
const is=(value:unknown,status:string)=>normalized(value)===status.toUpperCase();
const failed=(order_number:string,reason:string)=>({order_number,reason});

export const authorizedDispatchTarget=(order_number:unknown,waybill:unknown)=>
  AUTHORIZED_DISPATCH_WAYBILLS.find(target=>
    normalized(order_number)===target.order_number&&normalized(waybill)===target.waybill);

const locks = [
  ['item_edit_lock','order-item-edit-v1:'],
  ['variant_correction_lock','order-variant-correction-v1:'],
  ['stock_quantity_correction_lock','order-stock-quantity-v1:'],
  ['return_packing_lock','return-packing-v1:'],
] as const;

const completedLock = (order:Order,field:string,prefix:string,adminRows:readonly AdminRow[]):boolean=>{
  const lock=order[field];
  if(!lock)return false;
  const operation=typeof lock==='string'?lock:lock?.operation_id;
  if(typeof operation!=='string'||!operation.trim())return false;
  const record=adminRows.find(row=>row.key===prefix+operation)?.payload;
  if(!record||record.phase!=='complete')return false;
  const id=String(order.id||''),wb=normalized(order.waybill_number);
  if(record.order_id&&String(record.order_id)!==id)return false;
  if(record.waybill_number&&normalized(record.waybill_number)!==wb)return false;
  if(prefix==='return-packing-v1:'){
    if(order.return_packing_operation!==operation)return false;
    if(Array.isArray(record.order_ids)&&!record.order_ids.map(String).includes(id))return false;
  }
  return true;
};

// Return the EXACT reason instead of a blanket "cancelled / returns / corrected".
// Completed journal receipts allow old, orphaned correction locks to be cleaned
// without skipping active transactions or altering their stock/money fields.
export const historicalDispatchBlockers = (order:Order,adminRows:readonly AdminRow[]=[])=>{
  const reasons:string[]=[];
  if(is(order.order_status,'Cancelled')||order.cancel_stock_restore)reasons.push('Order is cancelled or its stock cancellation is recorded');
  if(is(order.order_status,'Returned')||order.return_sheet_id||order.return_tracking_waybill||
    order.return_received_at||is(order.fardar_invoice_status,'Return Complete')||
    (order.return_status&&!is(order.return_status,'None')))
    reasons.push('Order has an active or recorded return');
  for(const [field,prefix] of locks)
    if(order[field]&&!completedLock(order,field,prefix,adminRows))
      reasons.push(field+' is awaiting its completed operation');
  if(order.invoice_locked!==true||order.stock_allocated!==true||!order.waybill_number)
    reasons.push('Invoice, stock allocation or waybill is missing');
  return reasons;
};

const matchingDeliveredEvidence=(order:Order,waybill:string)=>{
  const actualDelivery=is(order.order_status,'Delivered')||
    (is(order.delivery_status,'Delivered')&&is(order.tracking_status,'Delivered'));
  const matchingFardarInvoice=is(order.fardar_invoice_status,'Delivered')&&
    normalized(order.fardar_invoice_waybill)===waybill;
  const paid=order.cod_payment_received===true&&is(order.payment_status,'Paid');
  // A paid courier invoice is delivery evidence regardless of whether the
  // money was entered from the CSV or manually recorded by the operator.
  if(matchingFardarInvoice&&(!is(order.payment_method,'COD')||paid))
    return 'Matching Fardar delivered invoice and saved payment';
  if(actualDelivery)return 'Existing saved Delivered courier status';
  return '';
};

export const reconcileAuthorizedDispatch = <T extends DispatchRow>(
  rows:readonly T[],now:string,adminRows:readonly AdminRow[]=[],onlyOrderId?:string,
):DispatchReconciliationResult<T>=>{
  const reconciled:string[]=[],already_saved:string[]=[];
  const skipped:Array<{order_number:string;reason:string}>=[];
  let next:T[]|null=null;
  for(const target of AUTHORIZED_DISPATCH_WAYBILLS){
    const matching=rows.filter(row=>normalized(row.payload?.order_number)===target.order_number);
    if(onlyOrderId!==undefined&&!matching.some(row=>String(row.order_id)===onlyOrderId))continue;
    if(matching.length!==1){
      skipped.push(failed(target.order_number,matching.length?'Duplicate order number':'Order not found'));continue;
    }
    const row=matching[0],order=row.payload!;
    if(normalized(order.waybill_number)!==target.waybill){
      skipped.push(failed(target.order_number,'Expected waybill does not match current order'));continue;
    }
    if(rows.filter(candidate=>normalized(candidate.payload?.waybill_number)===target.waybill).length!==1){
      skipped.push(failed(target.order_number,'Waybill belongs to more than one order'));continue;
    }
    const blockers=historicalDispatchBlockers(order,adminRows);
    if(blockers.length){
      skipped.push(failed(target.order_number,blockers.join('; ')));continue;
    }
    const evidence=matchingDeliveredEvidence(order,target.waybill);
    if(!evidence){
      skipped.push(failed(target.order_number,'No saved Delivered courier evidence and matching settled Fardar invoice'));continue;
    }
    // Preserve any original dispatch scan timestamp/operator if already present.
    const staleLocks=locks.filter(([field,prefix])=>order[field]&&completedLock(order,field,prefix,adminRows))
      .map(([field])=>field);
    const done=is(order.dispatch_status,'Handed Over')&&is(order.order_status,'Delivered')&&
      is(order.delivery_status,'Delivered')&&is(order.tracking_status,'Delivered')&&!staleLocks.length;
    if(done){already_saved.push(target.order_number);continue;}
    const updated:Order={...order,dispatch_status:'Handed Over',order_status:'Delivered',
      delivery_status:'Delivered',tracking_status:'Delivered',
      dispatch_reconciled_at:now,
      dispatch_reconciled_by:'Authorized historical courier reconciliation',
      dispatch_reconciliation_evidence:evidence};
    for(const field of staleLocks)delete updated[field];
    if(!next)next=rows.slice() as T[];
    next[rows.indexOf(row)]={...row,payload:updated,updated_at:now} as T;
    reconciled.push(target.order_number);
  }
  return {rows:next||rows,reconciled,already_saved,skipped};
};
