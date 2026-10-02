import { confirmCsvRequestWithRetry } from './confirmCsvSave';

type RecordData = Record<string, any>;
type QueueResult = {id:string;order_number:string;status:'saved'|'already_saved'|'failed';order?:RecordData;error?:string};
export const invoiceComplete = (order:RecordData) => order.invoice_locked===true &&
  Boolean(String(order.invoice_number||'').trim()) && Boolean(String(order.invoice_pack_batch_id||'').trim()) &&
  Number.isFinite(Date.parse(order.invoice_generated_at||''));
export const invoiceReady = (order:RecordData) => order.call_center_status==='Confirmed' && order.stock_allocated===true &&
  order.stock_status==='Allocated' && Boolean(String(order.waybill_number||'').trim()) &&
  !order.is_duplicate_order && !order.is_test_order && order.order_status!=='Cancelled';
export const validInvoiceQueueRequest = (body:any) => Array.isArray(body?.order_ids) && body.order_ids.length>0 &&
  body.order_ids.length<=50 && new Set(body.order_ids).size===body.order_ids.length &&
  body.order_ids.every((id:any)=>typeof id==='string'&&id.length>0&&id.length<=150) &&
  typeof body.batch_id==='string' && /^PACK-[A-Za-z0-9_-]{1,145}$/.test(body.batch_id) &&
  (body.automatic===undefined||typeof body.automatic==='boolean');

const paymentLabel = (order:RecordData,settings:RecordData) => {
  if(order.payment_method==='COD')return 'COD';
  const paid=Number(order.payment_received_amount||order.payment_detected_amount||0),total=Number(order.total_amount||0);
  if(order.payment_paid_type==='Full'||(paid>0&&total>0&&paid>=total*.98))return 'FULLY PAID';
  if(order.payment_paid_type==='Advance'||(order.is_advance_required&&order.advance_confirmed))return `${Math.min(100,Math.max(1,Number(settings.advance_percentage??50)))}% ADVANCE PAID`;
  return order.payment_status==='Paid'?'FULLY PAID':'BANK PAYMENT';
};

// Runs inside the R2 ETag transaction. It creates only missing invoice metadata
// against CURRENT orders; it never imports a browser order, reserves a waybill,
// changes money/items/stock, or resets a downloaded invoice.
export const applyInvoiceQueue = (orders:RecordData[],ids:string[],batchId:string,settings:RecordData,generatedBy:string,locks:RecordData[]=[]) => {
  const results:QueueResult[]=[],updatedOrders:RecordData[]=[];
  for(const id of ids){
    const matches=orders.filter(order=>String(order.id)===id),current=matches[0];
    const fail=(error:string)=>results.push({id,order_number:String(current?.order_number||''),status:'failed',error});
    if(matches.length!==1){fail('Order not uniquely found in current R2 data.');continue;}
    if(invoiceComplete(current)){results.push({id,order_number:current.order_number,status:'already_saved',order:current});continue;}
    if(!invoiceReady(current)){fail('Confirmed order, allocated stock and current waybill are required.');continue;}
    const waybill=String(current.waybill_number).trim();
    if(orders.some(order=>String(order.id)!==id&&String(order.waybill_number||'').trim()===waybill)||
      locks.some(lock=>String(lock.waybill_number||'').trim()===waybill&&['Assigned','Used','Cancelled'].includes(lock.status)&&
        (lock.status==='Cancelled'||(lock.assigned_order_number&&String(lock.assigned_order_number)!==String(current.order_number))))){
      fail('The current waybill is locked for another parcel.');continue;
    }
    const confirmedAt=Date.parse(current.invoice_confirm_snapshot?.captured_at||current.call_center_updated_at||''),allocatedAt=Date.parse(current.stock_allocated_at||'');
    const freshConfirm=Boolean(current.confirm_upload_batch_id)&&Number.isFinite(confirmedAt)&&Number.isFinite(allocatedAt)&&Math.abs(allocatedAt-confirmedAt)<=10*60*1000;
    const updated={...current,invoice_locked:true,
      invoice_number:String(current.invoice_number||'').trim()?current.invoice_number:`INV-${String(current.order_number).replace(/^ORA-/,'')}`,
      invoice_generated_at:Number.isFinite(Date.parse(current.invoice_generated_at||''))?current.invoice_generated_at:new Date().toISOString(),
      invoice_generated_by:current.invoice_generated_by||generatedBy,
      invoice_pack_batch_id:String(current.invoice_pack_batch_id||'').trim()?current.invoice_pack_batch_id:(freshConfirm?current.confirm_upload_batch_id:batchId),
      invoice_payment_label_snapshot:current.invoice_payment_label_snapshot||paymentLabel(current,settings),
      invoice_advance_percentage_snapshot:current.invoice_advance_percentage_snapshot??Number(settings.advance_percentage??50)};
    updatedOrders.push(updated);results.push({id,order_number:current.order_number,status:'saved',order:updated});
  }
  return {updatedOrders,results};
};

export const saveInvoiceQueue = async (ids:string[],batchId:string,request:(url:string,options?:RequestInit)=>Promise<any>,automatic=false,pause?:(ms:number)=>Promise<void>) => {
  const orders:RecordData[]=[],errors:string[]=[];
  const unique=[...new Set(ids.map(String).filter(Boolean))];
  for(let offset=0;offset<unique.length;offset+=50){
    const group=unique.slice(offset,offset+50);
    const checked=async(url:string,options?:RequestInit)=>{
      const data=await request(url,options),results=data?.results;
      if(!data?.ok||!Array.isArray(results)||results.length!==group.length||new Set(results.map((result:any)=>result?.id)).size!==group.length||
        group.some(id=>!results.some((result:any)=>result?.id===id&&
          ((['saved','already_saved'].includes(result.status)&&result.order?.id===id&&result.order.order_number===result.order_number&&invoiceComplete(result.order))||
           (result.status==='failed'&&typeof result.error==='string'))))){
        const error:any=new Error('The server did not confirm every saved invoice.');error.status=503;throw error;
      }
      return data;
    };
    const data=await confirmCsvRequestWithRetry(checked,'/api/orders/invoices/ensure',{
      method:'POST',body:JSON.stringify({order_ids:group,batch_id:batchId,automatic})},pause);
    for(const result of data.results as QueueResult[]){
      if(result.status==='failed')errors.push(`${result.order_number||result.id}: ${result.error}`);
      else orders.push(result.order!);
    }
  }
  return {orders,errors};
};
