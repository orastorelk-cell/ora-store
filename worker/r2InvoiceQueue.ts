import { returnPackingPending } from '../src/lib/returnSheets';
import { readDataTable, replaceDataTable } from './cloudflareData';
import { applyInvoiceQueue, validInvoiceQueueRequest } from '../src/lib/invoiceQueue';

export const r2InvoiceQueueHandler = async(request:Request,env:unknown,user:Record<string,any>) => {
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ora-storage':'cloudflare-r2'}});
  const body:any=await request.json().catch(()=>null);
  if(!validInvoiceQueueRequest(body))return json({error:'Send 1 to 50 unique order IDs and a valid packing batch.'},400);
  const adminRows=await readDataTable(env,'admin_data_store');
  if(returnPackingPending(adminRows))return json({error:'Check returns, then use Create Packing Invoice & Fardar CSV in Return Sheets.'},409);
  const settings=adminRows.find(row=>row.key==='storefront-state-v1')?.payload?.settings||{};
  const locks=await readDataTable(env,'courier_waybills');
  const results=await replaceDataTable(env,'order_snapshots',rows=>{
    const applied=applyInvoiceQueue(rows.map(row=>row.payload).filter(Boolean),body.order_ids,body.batch_id,settings,
      body.automatic?'System Auto Invoice Queue':String(user.display_name||user.username||'Staff'),locks);
    const changed=new Map(applied.updatedOrders.map(order=>[String(order.id),order]));
    const now=new Date().toISOString();let count=0;
    const next=changed.size?rows.map(row=>{const order=changed.get(String(row.order_id));if(!order)return row;count++;return {...row,payload:order,updated_at:now};}):rows;
    if(count!==changed.size)throw new Error('Invalid invoice order identity; durable save stopped.');
    return {rows:next,result:applied.results};
  });
  return json({ok:true,results});
};
