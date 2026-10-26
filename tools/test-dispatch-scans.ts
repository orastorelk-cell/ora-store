import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { activeData, dataBucket, importRecovery, readDataTable, replaceDataTable, mutateDataTable, cloudflareDataFetch, configureCloudflareData } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { prepareOrderSnapshotUpdate, preserveDispatchReceipt } from '../src/lib/orderSnapshotUpdate';
import { AUTHORIZED_DISPATCH_WAYBILLS } from '../src/lib/authorizedDispatchReconciliation';
class MemoryBucket {
  objects = new Map<string, { value: string; etag: string; customMetadata?: any }>();
  revision = 0;
  writes: string[] = [];
  failKey = '';
  beforePut?: (key: string) => Promise<void>;
  async get(key: string) {
    const row = this.objects.get(key);
    return row ? { etag: row.etag, customMetadata: row.customMetadata, text: async () => row.value } : null;
  }
  async put(key: string, value: string, options: any = {}) {
    if (this.beforePut) await this.beforePut(key);
    if (key === this.failKey) throw new Error('simulated write failure');
    const old = this.objects.get(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== old?.etag) return null;
    if (options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    this.writes.push(key);
    const etag = String(++this.revision);
    this.objects.set(key, { value, etag, customMetadata: options.customMetadata });
    return { etag };
  }
}


const raw = new MemoryBucket(), secret = 'dispatch-test-secret';
const env = {ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:secret,VITE_SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'test-key'};
configureCloudflareData(env);
const orders = Array.from({length:33},(_,i)=>({id:'order-'+i,order_number:'FB-'+i,waybill_number:'WB-'+i,
  stock_allocated:true,invoice_locked:true,invoice_number:'INV-'+i,order_status:'Processing',dispatch_status:'Not Scanned',
  items:[{sku:'R1',quantity:2}],total_amount:500,created_at:'2026-10-01T00:00:00Z'}));
await importRecovery(dataBucket(env)!,{format:'ora-r2-recovery-v1',orders,admin_users:[
  {id:'admin',username:'admin',display_name:'Test Admin',role:'admin',is_active:true},
  {id:'viewer',username:'viewer',role:'staff',is_active:true,permissions:['dispatch','level:dispatch:view']}],
  admin_data_store:[{key:"storefront-state-v1",payload:{products:[],categories:[],settings:{}}}],courier_waybills:[]});
const token=(sub:string)=>{const p=Buffer.from(JSON.stringify({sub,role:sub==='admin'?'admin':'staff',exp:Date.now()+60000})).toString('base64url');return p+'.'+crypto.createHmac('sha256',secret).update(p).digest('base64url');};
const call=(path:string,body:any,method='POST',user='admin')=>withR2DataFallback(new Request('https://test'+path,{method,
  headers:{authorization:'Bearer '+token(user),'content-type':'application/json'},body:JSON.stringify(body)}),env,{},async()=>new Response('Unexpected bridge',{status:599}));
const scan=(i:number,barcode='WB-'+i,user='admin')=>call('/api/orders/order-'+i+'/dispatch-scan',{barcode},'POST',user);
assert.equal((await scan(0,'wrong')).status,409);
assert.equal((await scan(0,'WB-0','viewer')).status,403);
assert.equal((await scan(0,'')).status,400);
const before=await readDataTable(env,'order_snapshots');
for(let i=0;i<31;i++)assert.equal((await scan(i)).status,200);
const after=await readDataTable(env,'order_snapshots');
assert.deepEqual(after.slice(31),before.slice(31),'Unselected parcels remain exact');
for(let i=0;i<31;i++){
 const saved=after[i].payload;
 assert.equal(saved.dispatch_status,'Handed Over');assert.equal(saved.dispatch_scanned_by,'Test Admin');
 assert.deepEqual(saved.items,orders[i].items);assert.equal(saved.total_amount,500);
 assert.equal(prepareOrderSnapshotUpdate(saved,orders[i],[]).order.dispatch_scanned_at,saved.dispatch_scanned_at);
 const put=await call('/api/orders/order-'+i,{order:orders[i]},'PUT');assert.equal(put.status,200);
}
assert.deepEqual((await readDataTable(env,'order_snapshots')).slice(0,31),after.slice(0,31),'Stale browser PUTs cannot erase scans');
raw.writes=[];
const duplicate:any=await (await scan(0)).json();assert.equal(duplicate.duplicate,true);
assert.equal(duplicate.order.dispatch_scanned_at,after[0].payload.dispatch_scanned_at);assert.equal(raw.writes.length,0);
// Legacy Express/SDK upserts are guarded too.
await cloudflareDataFetch(new Request(env.VITE_SUPABASE_URL+'/rest/v1/order_snapshots?on_conflict=order_id',{
 method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,prefer:'resolution=merge-duplicates','content-type':'application/json'},
 body:JSON.stringify({...after[0],payload:orders[0]})}));
assert.equal((await readDataTable(env,'order_snapshots'))[0].payload.dispatch_scanned_at,after[0].payload.dispatch_scanned_at);
// Conflict retries must retain another staff member's edit.
const prefix=(await activeData(dataBucket(env)!))!.prefix;let interleaved=false;
raw.beforePut=async key=>{if(key!==prefix+'order-changes-v1.json'||interleaved)return;interleaved=true;
 await replaceDataTable(env,'order_snapshots',rows=>({rows:rows.map(row=>row.order_id==='order-31'?{...row,payload:{...row.payload,notes:'Concurrent edit'}}:row),result:null}));};
assert.equal((await scan(31)).status,200);raw.beforePut=undefined;
assert.equal((await readDataTable(env,'order_snapshots')).find(r=>r.order_id==='order-31')!.payload.notes,'Concurrent edit');
// A failed durable write never reports success.
raw.failKey=prefix+'order-changes-v1.json';assert.notEqual((await scan(32)).status,200);raw.failKey='';
assert.equal((await readDataTable(env,'order_snapshots')).find(r=>r.order_id==='order-32')!.payload.dispatch_status,'Not Scanned');
assert.equal(prepareOrderSnapshotUpdate({...after[0].payload,order_status:'Delivered'},orders[0],[]).order.order_status,'Delivered');
const delivered={...after[0].payload,order_status:'Delivered',delivery_status:'Delivered',tracking_status:'Delivered'};
assert.deepEqual(preserveDispatchReceipt(after[0].payload,delivered),delivered,'A fresh courier delivery update still advances normally');
const redispatch={...after[0].payload,waybill_number:'NEW-WB',dispatch_status:'Not Scanned',dispatch_scanned_at:undefined,dispatch_scanned_by:undefined};
assert.deepEqual(preserveDispatchReceipt(after[0].payload,redispatch),redispatch,'A fresh waybill keeps the existing redispatch workflow');

// Historic scan regression: these exact five waybills must be treated as
// delivered courier reconciliations, not assigned a fabricated scan timestamp.
const historicRows=AUTHORIZED_DISPATCH_WAYBILLS.map((target,i)=>({
  order_id:'historic-'+i,updated_at:'2026-10-14T00:00:00Z',
  payload:{id:'historic-'+i,order_number:target.order_number,waybill_number:target.waybill,
    invoice_locked:true,stock_allocated:true,invoice_number:'INV-'+target.order_number,
    order_status:'Processing',dispatch_status:'Not Scanned',payment_method:'COD',
    payment_status:'Paid',cod_payment_received:true,cod_payment_source:i===1?'Manual':'Fardar CSV',
    fardar_invoice_status:'Delivered',fardar_invoice_waybill:target.waybill,
    cod_payment_amount:2450,total_amount:2450,...(i===2?{stock_quantity_correction_lock:'FINISHED-657'}:{})},
}));
await mutateDataTable(env,'order_snapshots',rows=>{rows.push(...historicRows);});
await mutateDataTable(env,'admin_data_store',rows=>{rows.push({
  key:'order-stock-quantity-v1:FINISHED-657',
  payload:{phase:'complete',order_id:'historic-2',waybill_number:'18160739'},
  updated_at:'2026-10-17T00:00:00Z',
});});
for(let i=0;i<historicRows.length;i++){
  const data=await (await call('/api/orders/historic-'+i+'/dispatch-scan',{barcode:historicRows[i].payload.waybill_number})).json();
  assert.equal(data.ok,true,historicRows[i].payload.order_number+' must be reconciled');
  assert.equal(data.order.order_status,'Delivered');
  assert.equal(data.order.dispatch_status,'Handed Over');
  assert.equal(data.order.cod_payment_amount,2450);
  assert.equal(data.order.dispatch_scanned_at,undefined,'do not forge a scan timestamp');
}
const historicalSaved=(await readDataTable(env,'order_snapshots')).filter(row=>String(row.order_id).startsWith('historic-'));
assert.equal(historicalSaved.length,5);
assert(historicalSaved.every(row=>row.payload.dispatch_status==='Handed Over'),'none of five are left on Not Scanned');
assert.equal(historicalSaved[2].payload.stock_quantity_correction_lock,undefined,'completed correction lock cleaned');
assert.equal((await (await call('/api/orders/historic-0/dispatch-scan',{barcode:'18160742'})).json()).duplicate,true);

console.log('Dispatch scans: 31 parcels, stale mirrors, duplicate retries, concurrent edits and write failures passed.');
