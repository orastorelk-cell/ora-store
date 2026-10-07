import { activeData, configureCloudflareData, dataBucket, readDataTable, readDataTableWire, mutateDataTable, replaceDataTable } from './cloudflareData';
import { applyDeliveredReport, type DeliveredEntry } from '../src/lib/deliveredOrders';
import { applyConfirmCsvDecisions, validConfirmCsvEntries } from '../src/lib/confirmCsvSave';
import { r2StorefrontHandler } from './r2Storefront';
import { Buffer } from 'node:buffer';
import { auditConfirmCsvOrders, validConfirmAuditOrders } from '../src/lib/confirmCsvAudit';
import { r2InvoiceQueueHandler } from './r2InvoiceQueue';
import { r2InvoiceDownloadsHandler } from './r2InvoiceDownloads';
import { r2OrderUpdateHandler } from './r2OrderUpdate';
import { r2OrderCancellationHandler } from './r2OrderCancellation';
import { r2WaybillPoolHandler, r2WaybillAssignmentHandler, r2FulfilmentStatusHandler } from './r2Waybills';
import { returnSheetsHandler, r2ReturnStorage, returnSheetForWaybill } from './r2ReturnSheets';

type Env = Record<string, any>;
type StaffSession = { sub:string; role:'admin'|'staff'; exp:number };
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

const b64urlBytes=(value:string)=>{
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const binary=atob(padded);
  const out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
  return out;
};

const hmac=async(secret:string,payload:string)=>{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)));
};

export const verifyActiveStaff=async(request:Request,env:unknown)=>{
  const session=await verifySession(request,env);if(!session)return null;
  const users=await readDataTable(env,'admin_users');
  return users.find(user=>String(user.id)===session.sub&&user.is_active!==false)||null;
};

const operationalHandler=async(request:Request,env:unknown):Promise<Response|null>=>{
  const path=new URL(request.url).pathname;
  const read=request.method==='GET'&&['/api/orders','/api/orders/version'].includes(path);
  const delivered=request.method==='POST'&&path==='/api/orders/delivered-csv';
  const confirmed=request.method==='POST'&&path==='/api/orders/confirm-csv';
  const refresh=request.method==='POST'&&path==='/api/staff/session/refresh';
  const audit=request.method==='POST'&&path==='/api/orders/confirm-csv/check';
  const invoices=request.method==='POST'&&path==='/api/orders/invoices/ensure';
  const downloads=request.method==='POST'&&path==='/api/orders/invoice-download-status';
  const cancellation=['GET','POST'].includes(request.method)&&path==='/api/orders/cancel-before-dispatch';
  const pool=(request.method==='GET'&&path==='/api/courier/waybills')||(request.method==='POST'&&path==='/api/courier/waybills/import');
  const assignment=request.method==='POST'&&path==='/api/orders/waybill/assign';
  const fulfilment=request.method==='GET'&&path==='/api/orders/fulfilment-status';
  const orderPut=['PUT','DELETE'].includes(request.method)&&/^\/api\/orders\/[^/]+$/.test(path);
  const returns=path.startsWith('/api/returns/');
  const redispatch=request.method==='POST'&&path==='/api/orders/redispatch-waybill';
  if(!read&&!delivered&&!confirmed&&!refresh&&!audit&&!invoices&&!downloads&&!cancellation&&!orderPut&&!pool&&!assignment&&!fulfilment&&!returns&&!redispatch)return null;
  const user=await verifyActiveStaff(request,env);
  if(!user)return json({error:'Login session required.'},401);
  if(returns)return returnSheetsHandler(request,r2ReturnStorage(env),user);
  if(redispatch){
    const body:any=await request.clone().json().catch(()=>null);
    const sheet=returnSheetForWaybill(await readDataTable(env,'admin_data_store'),String(body?.old_waybill||'').trim());
    if(sheet)return json({error:'This parcel belongs to Return Sheet '+sheet.id+'. Receive its items there. Create a new order with a fresh stock allocation for another dispatch.'},409);
    return null;
  }
  if(pool)return r2WaybillPoolHandler(request,env);
  if(assignment)return r2WaybillAssignmentHandler(request,env);
  if(fulfilment)return r2FulfilmentStatusHandler(request,env);
  if(cancellation)return r2OrderCancellationHandler(request,env,user);
  if(orderPut){
    const id=decodeURIComponent(path.slice('/api/orders/'.length));
    if(request.method==='PUT')return r2OrderUpdateHandler(request,env,id);
    const current=(await readDataTable(env,'order_snapshots')).find(row=>String(row.order_id)===id)?.payload;
    if(current?.return_sheet_id)return json({error:'Orders linked to a return sheet must remain in history.'},409);
    if(current?.cancel_stock_restore?.operation_id){
      if(request.method==='DELETE')return json({error:'The cancelled order and its retired waybill must remain in history.'},409);
      return json({ok:true,order:current,waybill_preserved:true,cancellation_preserved:true});
    }
    return null;
  }
  if(invoices)return r2InvoiceQueueHandler(request,env,user);
  if(downloads)return r2InvoiceDownloadsHandler(request,env);
  if(audit){
    const body:any=await request.json().catch(()=>null);
    if(!validConfirmAuditOrders(body?.orders))return json({error:'Send 1 to 20 unique CSV order decisions.'},400);
    const rows=await readDataTable(env,'order_snapshots');
    return json(auditConfirmCsvOrders(rows.map(row=>row.payload).filter(Boolean),body.orders));
  }
  if(refresh){
    const secret=String((env as Env)?.STAFF_SESSION_SECRET||(env as Env)?.ABUSE_HASH_SALT||'');
    const payload=Buffer.from(JSON.stringify({sub:String(user.id),role:user.role==='admin'?'admin':'staff',exp:Date.now()+12*60*60*1000})).toString('base64url');
    const signature=Buffer.from(await hmac(secret,payload)).toString('base64url');
    return json({ok:true,token:payload+'.'+signature});
  }
  if(read){
    if(path.endsWith('/version')){
      const wire=await readDataTableWire(env,'order_snapshots'),meta=wire.customMetadata||{};
      if(/^\d+$/.test(meta.oraCount||'')&&Number.isFinite(Date.parse(meta.oraUpdatedAt||'')))return json({count:Number(meta.oraCount),updated_at:meta.oraUpdatedAt,revision:wire.etag});
    }else if(new URL(request.url).searchParams.get('format')==='snapshots'){
      const wire=await readDataTableWire(env,'order_snapshots'),text=await wire.text();
      if(!text.startsWith('[')||!text.endsWith(']'))throw new Error('Invalid Cloudflare order data.');
      return new Response('{"snapshots":'+text+'}',{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ora-storage':'cloudflare-r2'}});
    }
    const rows=await readDataTable(env,'order_snapshots');
    if(path.endsWith('/version')){
      const updated_at=rows.reduce((latest,row)=>String(row.updated_at||'')>latest?String(row.updated_at||''):latest,'');
      return json({count:rows.length,updated_at});
    }
    const orders=rows.map(row=>row.payload).filter(Boolean);
    return json({orders});
  }
  if(confirmed){
    const body:any=await request.json().catch(()=>null);
    if(!validConfirmCsvEntries(body?.entries))return json({error:'Send at most 20 valid Confirm/Cancel decisions.'},400);
    const results=await replaceDataTable(env,'order_snapshots',rows=>{
      const applied=applyConfirmCsvDecisions(rows.map(row=>row.payload).filter(Boolean),body.entries);
      const updates=new Map(applied.updatedOrders.map(order=>[String(order.id),order]));
      const now=new Date().toISOString();let changed=0;
      const next=updates.size?rows.map(row=>{const order=updates.get(String(row.order_id));if(!order)return row;changed++;return {...row,payload:order,updated_at:now};}):rows;
      if(changed!==applied.updatedOrders.length)throw new Error('Invalid order identity; Confirm CSV update stopped.');
      return {rows:next,result:applied.results};
    });
    return json({ok:true,results});
  }
  if(user.role!=='admin'&&!['delivery','delivered_csv_upload'].some(permission=>(user.permissions||[]).includes(permission)))return json({error:'Delivered CSV permission required.'},403);
  const body:any=await request.json().catch(()=>null);
  if(!Array.isArray(body?.entries)||body.entries.length>20||body.entries.some((entry:any)=>!entry||typeof entry.waybill!=='string'||entry.waybill.length>100))return json({error:'Send at most 20 valid delivered report entries.'},400);
  const saved=await mutateDataTable(env,'order_snapshots',rows=>{
    // Apply only delivery fields to the current durable snapshot in the same
    // ETag-guarded write. Other staff edits and invoice/stock locks are retained.
    const result=applyDeliveredReport(rows.map(row=>row.payload).filter(Boolean),body.entries as DeliveredEntry[]);
    const updates=new Map(result.updatedOrders.map(order=>[String(order.id),order]));
    const now=new Date().toISOString();
    let changed=0;
    for(const row of rows){const order=updates.get(String(row.order_id));if(order){row.payload=order;row.updated_at=now;changed++;}}
    if(changed!==result.updated)throw new Error('Invalid order identity; delivered update stopped.');
    const {updatedOrders,...summary}=result;return summary;
  });
  return json({ok:true,...saved});
};

const verifySession=async(request:Request,envValue:unknown):Promise<StaffSession|null>=>{
  try{
    const token=String(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
    const parts=token.split('.');
    const payload=parts[0],sig=parts[1];
    if(!payload||!sig)return null;
    const env=envValue as Env;
    const secret=String(env?.STAFF_SESSION_SECRET || env?.ABUSE_HASH_SALT || '');
    if(!secret)return null;
    const expected=await hmac(secret,payload);
    const actual=b64urlBytes(sig);
    if(actual.length!==expected.length)return null;
    let diff=0;for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];
    if(diff!==0)return null;
    const session=JSON.parse(new TextDecoder().decode(b64urlBytes(payload))) as StaffSession;
    if(!session?.sub||!session?.exp||Date.now()>Number(session.exp))return null;
    return session;
  }catch{return null;}
};

const RECOVERY_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>O-RA Cloudflare Recovery</title><style>body{font-family:Arial,sans-serif;background:#0b1020;color:white;max-width:760px;margin:40px auto;padding:24px}.card{background:#151c30;border:1px solid #2a3552;border-radius:18px;padding:24px}button,a{display:block;margin-top:16px;color:inherit}button{padding:14px;border-radius:10px;border:0;cursor:pointer}pre{white-space:pre-wrap}</style></head><body><div class=\"card\"><h2>O-RA Cloudflare data</h2><p>Recovery is complete. System data now saves in Cloudflare R2.</p><p>The temporary snapshot and one-time import have been removed to protect live data.</p><a href=\"/system\">Open O-RA System</a><button id=\"check\">Check Cloudflare data</button><pre id=\"status\">Sign in to /system first to check the current order count.</pre></div><script>history.replaceState(null,'',location.pathname);document.getElementById('check').onclick=async()=>{const out=document.getElementById('status');try{const token=localStorage.getItem('ora_staff_session_token')||'';if(!token)throw new Error('Sign in to /system first.');const r=await fetch('/api/cloudflare-recovery/status',{headers:{authorization:'Bearer '+token},cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Cloudflare status could not be read.');out.textContent='Storage: '+d.mode+'\\nOrders: '+d.orders+'\\nRecovery active: '+d.active;}catch(e){out.textContent=e.message||String(e)}};</script></body></html>";

const recoveryHandler=async(request:Request,envValue:unknown):Promise<Response|null>=>{
  const url=new URL(request.url);
  const bucket=dataBucket(envValue);

  if(url.pathname==='/system/recovery'&&request.method==='GET'){
    return new Response(RECOVERY_HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }

  if(!bucket && url.pathname.startsWith('/api/cloudflare-recovery/'))return json({error:'Cloudflare R2 binding is unavailable.'},503);
  if(!bucket)return null;

  if(url.pathname==='/api/cloudflare-recovery/import')return json({error:'Recovery is complete. Imports are disabled to protect live Cloudflare data.'},410);

  if(url.pathname==='/api/cloudflare-recovery/status'&&request.method==='GET'){
    const session=await verifySession(request,envValue);
    if(!session)return json({error:'Login required.'},401);
    const active=await activeData(bucket);
    if(!active)return json({ok:true,active:false});
    const users=JSON.parse(await (await bucket.get(active.prefix+'admin_users.json'))!.text());
    if(!users.some((u:any)=>String(u.id)===session.sub && u.is_active!==false))return json({error:'Account is disabled or missing.'},401);
    const orders=JSON.parse(await (await bucket.get(active.prefix+'order_snapshots.json'))!.text());
    return json({ok:true,active:true,mode:'cloudflare-r2',orders:orders.length,restored_at:active.restored_at,counts:active.counts});
  }

  return null;
};

export const withR2DataFallback=async(request:Request,env:unknown,_ctx:any,next:()=>Promise<Response>):Promise<Response>=>{
  configureCloudflareData(env);
  try {
    const recovery=await recoveryHandler(request,env);
    if(recovery)return recovery;
    const operational=await operationalHandler(request,env);
    if(operational)return operational;
    const storefront=await r2StorefrontHandler(request,env,_ctx,verifyActiveStaff);
    if(storefront)return storefront;
    return await next();
  }catch(e:any){return json({error:e?.message||'Cloudflare data recovery failed.'},503);}
};
