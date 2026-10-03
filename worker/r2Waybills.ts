import { readDataTable, replaceDataTable } from './cloudflareData';
import { invoiceComplete } from '../src/lib/invoiceQueue';

type Row=Record<string,any>;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ora-storage':'cloudflare-r2'}});
const number=(value:any)=>String(value||'').trim();
const validNumber=(value:any)=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(value)&&/\d/.test(value);
const locked=(row:Row)=>['Assigned','Used','Cancelled'].includes(row.status)||row.permanently_retired===true;
const ownerMap=(orders:Row[])=>new Map(orders.filter(o=>number(o.waybill_number)).map(o=>[number(o.waybill_number),o]));
export const publicWaybillRow=(row:Row)=>({...row,id:row.id||'wb-server-'+row.waybill_number,
  imported_at:row.imported_at||row.assigned_at||'1970-01-01T00:00:00.000Z',courier_name:row.courier_name||'Fardar',status:row.status||'Used'});

// The pool is shared in R2. A legacy browser may publish its existing records,
// but may never clear the pool or turn a used/cancelled number into Available.
export const r2WaybillPoolHandler=async(request:Request,env:unknown)=>{
  if(request.method==='GET')return json({ok:true,records:(await readDataTable(env,'courier_waybills')).map(publicWaybillRow)});
  const body:any=await request.json().catch(()=>null),records=body?.records;
  if(!Array.isArray(records)||!records.length||records.length>50||records.some(r=>!r||!validNumber(r.waybill_number)||!['Available','Assigned','Used','Cancelled'].includes(r.status)))return json({error:'Send 1 to 50 valid waybill records.'},400);
  const owners=ownerMap((await readDataTable(env,'order_snapshots')).map(r=>r.payload).filter(Boolean));
  const result=await replaceDataTable(env,'courier_waybills',rows=>{
    const next=[...rows],byNumber=new Map(next.map((r,i)=>[number(r.waybill_number),i]));let added=0,changed=0;
    for(const incoming of records){
      const wb=number(incoming.waybill_number),at=byNumber.get(wb),current=at===undefined?undefined:next[at],owner=owners.get(wb);
      if(current&&locked(current))continue;
      const status=owner?(owner.dispatch_status==='Handed Over'||owner.order_status==='Delivered'?'Used':'Assigned'):incoming.status;
      if(current&&status==='Available')continue;
      const row={waybill_number:wb,id:current?.id||'wb-server-'+wb,courier_name:number(incoming.courier_name)||'Fardar',status,
        imported_at:current?.imported_at||(Number.isFinite(Date.parse(incoming.imported_at))?incoming.imported_at:new Date().toISOString()),
        ...(owner?{assigned_order_id:owner.id,assigned_order_number:owner.order_number,assigned_at:owner.stock_allocated_at||owner.created_at}:{}),
        ...(status==='Cancelled'?{permanently_retired:true}:{})};
      if(at===undefined){byNumber.set(wb,next.length);next.push(row);added++;}else{next[at]={...current,...row};changed++;}
    }
    return {rows:added||changed?next:rows,result:{ok:true,added,updated:changed}};
  });
  return json(result);
};

export const r2AssignWaybill=async(env:unknown,id:string,courier='Fardar')=>{
  const before=(await readDataTable(env,'order_snapshots')).map(r=>r.payload).filter(Boolean),order=before.find(o=>String(o.id)===id);
  if(!order)throw new Error('Order not found.');
  if(order.order_status==='Cancelled'||order.is_duplicate_order||order.is_test_order)throw new Error('This order cannot receive a waybill.');
  if(number(order.waybill_number))return order;
  if(order.call_center_status!=='Confirmed'||order.stock_allocated!==true||order.stock_status!=='Allocated')throw new Error('Confirm the order and allocate stock before assigning a waybill.');
  if(order.invoice_locked||order.invoice_number||order.invoice_generated_at)throw new Error('An existing invoice has lost its waybill. Use the invoice correction flow.');
  const owners=ownerMap(before);
  const reserved=await replaceDataTable<Row|null>(env,'courier_waybills',rows=>{
    // An interrupted response/write resumes this order's same reservation.
    const existing=rows.find(r=>r.status==='Assigned'&&!r.permanently_retired&&String(r.assigned_order_number||'')===String(order.order_number)&&(!owners.has(number(r.waybill_number))||String(owners.get(number(r.waybill_number))!.id)===id));
    if(existing)return {rows,result:existing};
    const candidate=rows.filter(r=>r.status==='Available'&&!r.permanently_retired&&(r.courier_name||'Fardar')===courier&&!owners.has(number(r.waybill_number)))
      .sort((a,b)=>Date.parse(a.imported_at||'1970-01-01')-Date.parse(b.imported_at||'1970-01-01'))[0];
    if(!candidate)return {rows,result:null};
    const row={...candidate,status:'Assigned',assigned_order_id:id,assigned_order_number:order.order_number,assigned_at:new Date().toISOString()};
    return {rows:rows.map(r=>r===candidate?row:r),result:row};
  });
  if(!reserved)return null;
  return replaceDataTable<Row>(env,'order_snapshots',rows=>{
    const row=rows.find(r=>String(r.order_id)===id),current=row?.payload;
    if(!current||current.order_status==='Cancelled'||current.call_center_status!=='Confirmed'||current.stock_allocated!==true||current.stock_status!=='Allocated')throw new Error('Order changed during assignment; the reserved waybill remains protected.');
    if(number(current.waybill_number))return {rows,result:current};
    const wb=number(reserved.waybill_number);
    if(rows.some(r=>String(r.order_id)!==id&&number(r.payload?.waybill_number)===wb))throw new Error('Waybill already belongs to another order.');
    const updated={...current,waybill_number:wb,courier_name:reserved.courier_name||courier,shipment_mode:'manual',
      fardar_city:current.fardar_city||current.city,city_verified:Boolean(current.fardar_city||current.city),tracking_status:'Waybill Assigned',delivery_status:'Ready to Ship'};
    const saved={...row,payload:updated,updated_at:new Date().toISOString()};
    return {rows:rows.map(r=>r===row?saved:r),result:updated};
  });
};

export const r2WaybillAssignmentHandler=async(request:Request,env:unknown)=>{
  const body:any=await request.json().catch(()=>null);
  if(typeof body?.order_id!=='string'||!body.order_id||body.order_id.length>150||String(body.courier_name||'Fardar').length>100)return json({error:'A valid order ID is required.'},400);
  try{
    const order=await r2AssignWaybill(env,body.order_id,number(body.courier_name)||'Fardar');
    return order?json({ok:true,order}):json({error:'No available waybill is saved in the shared pool. Import the existing waybill CSV once.',code:'WAYBILL_POOL_EMPTY'},409);
  }catch(error:any){return json({error:error?.message||'Waybill assignment did not finish.'},409);}
};

export const r2FulfilmentStatusHandler=async(request:Request,env:unknown)=>{
  const input=(new URL(request.url).searchParams.get('orders')||'').split(/[\s,]+/).filter(Boolean);
  if(input.length>20||input.some(n=>n.length>100))return json({error:'Check at most 20 order numbers.'},400);
  const orders=(await readDataTable(env,'order_snapshots')).map(r=>r.payload).filter(Boolean),pool=await readDataTable(env,'courier_waybills');
  const selected=input.length?input.map(n=>orders.find(o=>o.order_number===n)||{order_number:n,missing:true}):orders.filter(o=>o.call_center_status==='Confirmed'&&!invoiceComplete(o)&&o.order_status!=='Cancelled').slice(-20);
  const owners=ownerMap(orders);
  const site=(await readDataTable(env,'admin_data_store')).find(r=>r.key==='storefront-state-v1')?.payload;
  return json({ok:true,build:'20261003-sync-waybill-v1',pool:{total:pool.length,available:pool.filter(r=>r.status==='Available'&&!r.permanently_retired&&!owners.has(number(r.waybill_number))).length},
    website:{version:site?.version,updated_at:site?.updated_at,products:site?.products?.length},orders:selected.map(o=>({id:o.id,order_number:o.order_number,
      call_center_status:o.call_center_status,order_status:o.order_status,stock_allocated:o.stock_allocated===true,stock_status:o.stock_status,
      waybill_number:o.waybill_number||null,invoice_number:o.invoice_number||null,invoice_saved:invoiceComplete(o),packing_batch:o.invoice_pack_batch_id||o.confirm_upload_batch_id||null,
      reason:o.missing?'Order not found':o.order_status==='Cancelled'?'Cancelled':invoiceComplete(o)?'Invoice saved':o.stock_allocated!==true?'Waiting for stock':!number(o.waybill_number)?'Waiting for waybill':'Waiting for invoice save'}))});
};
