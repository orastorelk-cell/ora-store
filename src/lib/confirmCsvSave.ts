type OrderData = Record<string, any>;
export type ConfirmCsvEntry = { id:string; order_number:string; expected:string; patch:OrderData; clear_fields:string[] };
type DecisionResult = { id:string; order_number:string; status:'saved'|'already_saved'|'failed'; order?:OrderData; error?:string };

const fields = new Set([
  'items','subtotal','special_offer_discount','delivery_rebalance_qty_offer','delivery_rebalance_qty_offer_amount',
  'delivery_rebalance_amount_snapshot','delivery_visible_fee_snapshot','delivery_fee','gift_wrap_selected','gift_wrap_fee',
  'total_amount','is_advance_required','advance_amount','advance_confirmed','address','customer_name','city','district',
  'fardar_city','city_verified','city_mapping_source','confirm_upload_batch_id','invoice_confirm_snapshot',
  'call_center_status','order_status','call_center_updated_at','stock_allocated','stock_status','product_change_history','notes',
  'cancelled_at','cancelled_by','cancel_reason','payment_method','payment_status','payment_paid_type','payment_received_amount',
  'payment_verification_status','payment_reviewed_at','payment_reviewed_by','invoice_payment_label_snapshot',
]);
const clearable = new Set(['fardar_city','city_mapping_source']);
const volatile = new Set(['call_center_updated_at','cancelled_at','payment_reviewed_at','confirm_upload_batch_id']);
const moneyFields = ['subtotal','special_offer_discount','delivery_rebalance_qty_offer_amount','delivery_rebalance_amount_snapshot',
  'delivery_visible_fee_snapshot','delivery_fee','gift_wrap_fee','total_amount','advance_amount','payment_received_amount'];

const sorted = (value:any):any => Array.isArray(value) ? value.map(sorted) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])) : value;
export const canonicalJson = (value:unknown) => JSON.stringify(sorted(JSON.parse(JSON.stringify(value))));
const uniqueNotes = (value:unknown) => [...new Set(String(value||'').split(' | ').map(part=>part.trim()).filter(Boolean))].join(' | ');

export const validConfirmCsvEntries = (entries:unknown):entries is ConfirmCsvEntry[] => {
  if(!Array.isArray(entries)||!entries.length||entries.length>20)return false;
  const ids=new Set<string>();
  return entries.every(entry=>{
    if(!entry||typeof entry.id!=='string'||!entry.id||entry.id.length>150||ids.has(entry.id))return false;
    ids.add(entry.id);
    if(typeof entry.order_number!=='string'||entry.order_number.length>100||typeof entry.expected!=='string'||entry.expected.length>200000)return false;
    const patch=entry.patch;
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(field=>!fields.has(field)))return false;
    if(!Array.isArray(entry.clear_fields)||entry.clear_fields.some((field:any)=>!clearable.has(field)))return false;
    const confirmed=patch.call_center_status==='Confirmed'&&patch.order_status==='Processing';
    const cancelled=patch.call_center_status==='Cancelled'&&patch.order_status==='Cancelled';
    if(!confirmed&&!cancelled)return false;
    if(confirmed&&(!Array.isArray(patch.items)||!patch.items.length||patch.items.length>100||patch.items.some((item:any)=>
      !item||!Number.isFinite(item.quantity)||item.quantity<1||item.quantity>99||!Number.isFinite(item.unit_price)||item.unit_price<0||!Number.isFinite(item.subtotal)||item.subtotal<0)))return false;
    if(patch.stock_allocated!==undefined&&patch.stock_allocated!==false)return false;
    return moneyFields.every(field=>patch[field]===undefined||(typeof patch[field]==='number'&&Number.isFinite(patch[field])&&patch[field]>=0));
  });
};

const sameDecision = (current:OrderData,entry:ConfirmCsvEntry) => {
  for(const [field,value] of Object.entries(entry.patch)){
    if(volatile.has(field))continue;
    let actual=current[field],expected=value;
    if(field==='notes'){actual=uniqueNotes(actual);expected=uniqueNotes(expected);}
    if(field==='invoice_confirm_snapshot'){
      const {captured_at:oldTime,...oldSnapshot}=actual||{};
      const {captured_at:newTime,...newSnapshot}=expected||{};
      actual=oldSnapshot;expected=newSnapshot;
    }
    if(canonicalJson([actual])!==canonicalJson([expected]))return false;
  }
  return entry.clear_fields.every(field=>current[field]===undefined);
};

// Called inside the R2 ETag transaction, so guards inspect the current order on
// every CAS retry. A Confirm CSV can only update an existing, unlocked order.
export const applyConfirmCsvDecisions = (orders:OrderData[],entries:ConfirmCsvEntry[]) => {
  const updatedOrders:OrderData[]=[],results:DecisionResult[]=[];
  for(const entry of entries){
    const matches=orders.filter(order=>String(order.id)===entry.id&&String(order.order_number)===entry.order_number);
    const current=matches[0];
    const failed=(error:string)=>results.push({id:entry.id,order_number:entry.order_number,status:'failed',error});
    if(matches.length!==1){failed('Order was not found uniquely in the durable store.');continue;}
    // A response may be lost after committing. A replay acknowledges the durable
    // decision without changing its packing group, notes, history or timestamps.
    if(sameDecision(current,entry)){
      results.push({id:entry.id,order_number:entry.order_number,status:'already_saved',order:current});continue;
    }
    if(current.return_packing_lock?.operation_id||current.stock_allocated||current.invoice_locked||current.waybill_protection_locked||current.fardar_csv_exported_at||
      current.dispatch_status==='Handed Over'||['Shipped','Delivered','Cancelled'].includes(current.order_status)){
      failed('Order is already stock/invoice/dispatch locked or cancelled. Refresh before making a correction.');continue;
    }
    if(canonicalJson(current)!==entry.expected){failed('Order changed while the CSV was being processed. Refresh and upload again.');continue;}
    const next={...current,...entry.patch};
    if(typeof next.notes==='string')next.notes=uniqueNotes(next.notes);
    for(const field of entry.clear_fields)delete next[field];
    updatedOrders.push(next);
    results.push({id:entry.id,order_number:entry.order_number,status:'saved',order:next});
  }
  return {updatedOrders,results};
};

type StaffRequest = (url:string,options?:RequestInit)=>Promise<any>;
export const confirmCsvRequestWithRetry = async (request:StaffRequest,url:string,options?:RequestInit,
  pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))) => {
  for(let attempt=0;attempt<4;attempt++){
    try{return await request(url,options);}catch(error:any){
      if(attempt===3||(![429,502,503,504].includes(error?.status)&&!(error instanceof TypeError)))throw error;
      await pause(500*2**attempt);
    }
  }
};

export const saveConfirmCsvDecisions = async (entries:ConfirmCsvEntry[],request:StaffRequest,
  pause?:(ms:number)=>Promise<void>) => {
  const saved=new Map<string,OrderData>(),errors:string[]=[];
  for(let offset=0;offset<entries.length;offset+=20){
    const batch=entries.slice(offset,offset+20);
    try{
      const checkedRequest:StaffRequest=async(url,options)=>{
        const data=await request(url,options);
        const results=data?.results;
        const valid=data?.ok===true&&Array.isArray(results)&&results.length===batch.length&&
          new Set(results.map((result:any)=>result?.id)).size===batch.length&&batch.every(entry=>results.some((result:any)=>
            result?.id===entry.id&&result.order_number===entry.order_number&&
            ((['saved','already_saved'].includes(result.status)&&result.order?.id===entry.id&&result.order?.order_number===entry.order_number)||
              (result.status==='failed'&&typeof result.error==='string'))));
        if(!valid){const error:any=new Error('Server did not confirm every CSV decision.');error.status=503;throw error;}
        return data;
      };
      const data=await confirmCsvRequestWithRetry(checkedRequest,'/api/orders/confirm-csv',{
        method:'POST',body:JSON.stringify({entries:batch}),
      },pause);
      for(const result of data.results as DecisionResult[]){
        if(result.status==='failed')errors.push(`${result.order_number}: Decision was NOT saved to the server. ${result.error}`);
        else saved.set(result.order_number,result.order!);
      }
    }catch(error:any){
      for(const entry of batch)errors.push(`${entry.order_number}: Decision was NOT saved to the server. ${error?.message||'Order update failed.'}`);
    }
  }
  return {saved,errors};
};
