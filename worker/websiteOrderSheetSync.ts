import { readDataTable,replaceDataTable } from './cloudflareData';
import { markR2SheetSynced } from './r2SheetSyncStatus';

const eligible = (order:any) => order?.order_source==='Website' && !order.is_synced_google_sheets && !order.is_test_order && order.order_status!=='Cancelled' &&
  (order.payment_method!=='Bank Payment'||order.payment_verification_status==='Approved');
let running:Promise<void>|null=null;

// The unsynced durable order IS the outbox. A lost response or a failed Google
// request cannot lose the retry, and no customer browser must stay open.
export const syncWebsiteOrderSheets = async (env:unknown, ids?:string[], network:typeof fetch=fetch) => {
  const orders=(await readDataTable(env,'order_snapshots')).map(row=>row.payload).filter(order=>eligible(order)&&(ids?ids.includes(String(order.id)):!(Date.parse(order.website_sheet_next_retry_at||'')>Date.now())))
    .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).slice(0,3);
  if(!orders.length)return;
  const rows=await readDataTable(env,'admin_data_store');
  const webhook=String(rows.find(row=>row.key==='storefront-state-v1')?.payload?.settings?.google_sheet_webhook_url||'').trim();
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook))throw new Error('Google Sheet connection is missing; saved website orders remain queued.');
  const post=async(body:any)=>{
    const response=await network(webhook,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify(body),redirect:'follow',signal:AbortSignal.timeout(10000)});
    const data:any=await response.json();
    if(!response.ok||data?.ok===false||data?.status==='error')throw new Error('Google Sheet did not acknowledge the website order.');
    return data;
  };
  const failures=new Map<string,string>();
  for(const order of orders){
    try {
      const expected=Math.max(1,order.items?.length||0);
      let physical=await post({action:'read_order',orderId:order.order_number});
      // Never rewrite an existing call-center order on an acknowledgment retry.
      if(physical.found!==true||Number(physical.rows||0)<expected){
        const sent=await post({action:'sync_orders',order});
        if(!['orders_synced','orders_batch_synced'].includes(String(sent.status)))throw new Error('Google Sheet did not confirm the saved order.');
        physical=await post({action:'read_order',orderId:order.order_number});
      }
      if(physical.found!==true||Number(physical.rows||0)<expected)throw new Error('Google Sheet row verification is pending.');
      await markR2SheetSynced([order],env,true);
    }catch(error){const message=String((error as Error)?.message||error).slice(0,500);failures.set(String(order.id),message);console.warn('Website Sheet mirror will retry for '+String(order.order_number)+': '+message);}
  }
  // Back off failed rows so a broken historic order cannot starve newer orders.
  if(failures.size)await replaceDataTable(env,'order_snapshots',rows=>({rows:rows.map(row=>{
    const error=failures.get(String(row.order_id));if(!error||row.payload?.is_synced_google_sheets)return row;
    const count=Math.max(0,Number(row.payload.website_sheet_retry_count)||0)+1,now=new Date().toISOString();
    return {...row,updated_at:now,payload:{...row.payload,website_sheet_error:error,website_sheet_retry_count:count,website_sheet_next_retry_at:new Date(Date.now()+Math.min(300000,60000*2**Math.min(count,3))).toISOString()}};
  }),result:true}));
};

export const scheduleWebsiteOrderSheets=(env:unknown,ctx:any)=>{
  if(running)return;
  running=syncWebsiteOrderSheets(env).catch(error=>console.warn(String(error?.message||error))).finally(()=>{running=null;});
  ctx.waitUntil(running);
};
