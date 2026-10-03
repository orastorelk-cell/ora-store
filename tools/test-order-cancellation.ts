import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import { importRecovery,dataBucket,activeData,configureCloudflareData,cloudflareDataFetch,readDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { canonicalJson } from '../src/lib/confirmCsvSave';

class MemoryBucket {
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>();revision=0;failKey='';failNth=0;writes=0;
  async get(key:string){const object=this.objects.get(key);await Promise.resolve();return object?{text:async()=>object.value,etag:object.etag,customMetadata:object.customMetadata}:null;}
  async put(key:string,value:string,options:any={}){
    if(key===this.failKey&&++this.writes===this.failNth)throw new Error('simulated cancellation write failure');
    const old=this.objects.get(key),condition=options.onlyIf;
    if(condition?.etagMatches&&condition.etagMatches!==old?.etag)return null;
    if(condition?.etagDoesNotMatch==='*'&&old)return null;
    const object={value,etag:String(++this.revision),customMetadata:options.customMetadata};this.objects.set(key,object);return {etag:object.etag};
  }
}
const raw=new MemoryBucket(),env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:'synthetic-cancel-secret',SUPABASE_SECRET_KEY:'synthetic-service-secret',VITE_SUPABASE_URL:'https://test.supabase.co',ORA_R2_COMPRESSION_ENABLED:'1'};
configureCloudflareData(env);const bucket=dataBucket(env)!;
const admin='admin-fixture',staff='staff-fixture';
const order=(id:string,waybill:string,items:any[],extra={})=>({id,order_number:'TEST-'+id,order_status:'Processing',call_center_status:'Confirmed',stock_allocated:true,stock_status:'Allocated',
  waybill_number:waybill,courier_name:'Fardar',dispatch_status:'Not Handed Over',invoice_number:'INV-'+id,invoice_locked:true,invoice_generated_at:'2026-10-01T00:00:00Z',invoice_pack_batch_id:'PACK-EXISTING',
  invoice_pack_downloaded_at:'2026-10-01T00:01:00Z',fardar_csv_exported_at:'2026-10-01T00:02:00Z',fardar_csv_exported_waybill:waybill,total_amount:2600,payment_method:'COD',items,...extra});
const normalItem={product_id:'mat',sku:'SYN-MAT',product_name:'Synthetic Mat',quantity:3};
const originals=[order('mat-order','SYN-WB-1',[normalItem]),
  order('variant-order','SYN-WB-2',[{product_id:'variant',variant_id:'blue',sku:'SYN-BLUE',product_name:'Synthetic Variant',quantity:2}]),
  order('bundle-order','SYN-WB-3',[{product_type:'bundle',product_id:'bundle',quantity:2,bundle_components:[{product_id:'component',product_name:'Synthetic Component',quantity_per_bundle:2}]}]),
  order('shipped-order','SYN-WB-4',[normalItem],{order_status:'Shipped'}),
  order('waiting-order','SYN-WB-5',[normalItem],{stock_allocated:false,stock_status:'Waiting for Stock',invoice_locked:false,invoice_number:undefined}),
  order('missing-product','SYN-WB-6',[{product_id:'missing',quantity:1}]),
  order('conflict-order','SYN-WB-7',[normalItem])];
await importRecovery(bucket,{format:'ora-r2-recovery-v1',orders:originals,
  admin_users:[{id:admin,role:'admin',is_active:true,display_name:'Synthetic Admin'},{id:staff,role:'staff',is_active:true}],
  admin_data_store:[{key:'storefront-state-v1',payload:{version:1,updated_at:'2026-10-01T00:00:00Z',categories:[],settings:{},products:[
    {id:'mat',sku:'SYN-MAT',name_en:'Synthetic Mat',stock_quantity:1,status:'Active'},
    {id:'variant',sku:'SYN-VARIANT',name_en:'Synthetic Variant',product_type:'variant',stock_quantity:10,variants:[{id:'blue',sku:'SYN-BLUE',option_value:'Blue',stock_quantity:3},{id:'red',sku:'SYN-RED',option_value:'Red',stock_quantity:7}]},
    {id:'component',sku:'SYN-COMPONENT',name_en:'Synthetic Component',stock_quantity:0},
    {id:'bundle',sku:'SYN-BUNDLE',product_type:'bundle',stock_quantity:0,bundle_components:[{product_id:'component',quantity_per_bundle:2}]},
  ]}}],courier_waybills:originals.map(o=>({waybill_number:o.waybill_number,status:'Assigned',assigned_order_id:o.id,assigned_order_number:o.id==='conflict-order'?'OTHER-ORDER':o.order_number})),tables:{}});
const active=(await activeData(bucket))!,adminKey=active.prefix+'admin_data_store.json',orderKey=active.prefix+'order_snapshots.json';
const token=(id:string)=>{const payload=Buffer.from(JSON.stringify({sub:id,exp:Date.now()+3_600_000})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update(payload).digest('base64url');};
const call=async(path:string,method='GET',body?:any,auth=token(admin))=>{
  const response=await withR2DataFallback(new Request('https://test'+path,{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{},async()=>new Response('Unexpected Node bridge',{status:599}));
  return {status:response.status,body:await response.json() as any};
};
const cancelPath='/api/orders/cancel-before-dispatch',input=(index:number)=>({order_id:originals[index].id,waybill_number:originals[index].waybill_number,reason:'Synthetic parcel removed before dispatch'});
const state=async()=>(await readDataTable(env,'admin_data_store')).find(row=>row.key==='storefront-state-v1')!.payload;
const product=async(id:string)=>(await state()).products.find((p:any)=>p.id===id);
assert.equal((await call(cancelPath+'?waybill=SYN-WB-1','GET',undefined,'invalid')).status,401);
assert.equal((await call(cancelPath+'?waybill=SYN-WB-1','GET',undefined,token(staff))).status,403);
assert.equal((await call(cancelPath,'POST',input(0),token(staff))).status,403);
const old=(await call(cancelPath+'?waybill=SYN-WB-1')).body;assert.equal(old.order_number,'TEST-mat-order');assert.equal(old.items[0].quantity,3);assert.equal(old.complete,false);
const deniedEtag=raw.objects.get(adminKey)!.etag;
for(const index of [3,5,6])assert.equal((await call(cancelPath,'POST',input(index))).status,409);
assert.equal((await call(cancelPath,'POST',{...input(0),waybill_number:'OTHER'})).status,409);
assert.equal(raw.objects.get(adminKey)!.etag,deniedEtag,'Invalid cancellations must not modify the catalog or create journals');

// Catalog save failure: status and waybill retirement are durable; stock has not
// changed. The pending journal prevents a browser from racing the stock release.
raw.failKey=adminKey;raw.failNth=2;raw.writes=0;
const failed=await call(cancelPath,'POST',input(0));assert.equal(failed.status,503);
assert.equal((await product('mat')).stock_quantity,1);
const pending=(await call(cancelPath+'?waybill=SYN-WB-1')).body;
assert.equal(pending.order_status,'Cancelled');assert.equal(pending.cancellation_state,'pending');assert.equal(pending.waybill_retired,true);assert.equal(pending.complete,false);
const site=await state();assert.equal((await call('/api/admin/storefront/state','PUT',{...site,expected_version:site.version})).status,409);
raw.failKey='';
const repaired=await call(cancelPath,'POST',input(0));assert.equal(repaired.status,200,JSON.stringify(repaired.body));
assert.equal(repaired.body.complete,true);assert.equal(repaired.body.stock_restored[0].quantity,3);assert.equal(repaired.body.stock_restored[0].previous_stock,1);assert.equal(repaired.body.stock_restored[0].new_stock,4);
assert.equal((await product('mat')).stock_quantity,4);
const saved=(await readDataTable(env,'order_snapshots')).find(row=>row.order_id==='mat-order')!.payload;
for(const field of ['invoice_number','invoice_locked','invoice_generated_at','invoice_pack_batch_id','invoice_pack_downloaded_at','fardar_csv_exported_at','fardar_csv_exported_waybill','waybill_number','items','total_amount','payment_method'])assert.equal(canonicalJson(saved[field]),canonicalJson(originals[0][field]),field+' stays unchanged');
assert.equal(saved.stock_allocated,false);assert.equal(saved.call_center_status,'Cancelled');
const revision=raw.revision;
assert.equal((await call(cancelPath,'POST',input(0))).body.complete,true);assert.equal(raw.revision,revision,'Lost-response retry never repeats any committed write');

// Fail after the stock write but before the order completion acknowledgment.
raw.failKey=orderKey;raw.failNth=2;raw.writes=0;
assert.equal((await call(cancelPath,'POST',input(1))).status,503);
assert.equal((await product('variant')).variants[0].stock_quantity,5);
assert.equal((await product('variant')).variants[1].stock_quantity,7);
raw.failKey='';assert.equal((await call(cancelPath,'POST',input(1))).body.complete,true);
assert.equal((await product('variant')).variants[0].stock_quantity,5,'Retry cannot double-restock an exact variant');
assert.equal((await product('variant')).stock_quantity,12);
const concurrent=await Promise.all([call(cancelPath,'POST',input(2)),call(cancelPath,'POST',input(2))]);
assert(concurrent.every(result=>result.status===200&&result.body.complete));assert.equal((await product('component')).stock_quantity,4,'Bundle components restore once under concurrent requests');assert.equal((await product('bundle')).stock_quantity,0);
assert.equal((await call(cancelPath,'POST',input(4))).body.stock_restored.length,0,'Unallocated stock is never added');
assert.equal((await product('mat')).stock_quantity,4);

// Every normal SDK path and the old order PUT must retain the cancellation and
// permanently retired waybill, including against an older open dashboard.
const sdk=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SECRET_KEY,{global:{fetch:cloudflareDataFetch},db:{retry:false},auth:{persistSession:false,autoRefreshToken:false}});
const stale=await call('/api/orders/mat-order','PUT',{order:originals[0]});assert.equal(stale.body.order.order_status,'Cancelled');assert.equal(stale.body.cancellation_preserved,true);
assert.equal((await call('/api/orders/mat-order','DELETE',{reason:'Synthetic delete'})).status,409);
assert.equal((await sdk.from('order_snapshots').upsert({order_id:'mat-order',order_number:'TEST-mat-order',payload:originals[0]},{onConflict:'order_id'})).error,null);
assert.equal((await sdk.from('order_snapshots').select('payload').eq('order_id','mat-order').single()).data!.payload.order_status,'Cancelled');
assert((await sdk.from('order_snapshots').update({payload:originals[0]}).eq('order_id','mat-order')).error);
assert((await sdk.from('courier_waybills').upsert({waybill_number:'SYN-WB-1',status:'Assigned',assigned_order_number:'OTHER-ORDER'},{onConflict:'waybill_number'})).error);
assert.equal((await sdk.from('courier_waybills').upsert({waybill_number:'SYN-WB-1',status:'Assigned',assigned_order_number:'TEST-mat-order'},{onConflict:'waybill_number'})).error,null);
assert.equal((await sdk.from('courier_waybills').select('*').eq('waybill_number','SYN-WB-1').single()).data!.status,'Cancelled');
assert((await sdk.from('courier_waybills').delete().eq('waybill_number','SYN-WB-1')).error);
assert.equal((await call('/api/admin/storefront/state','PUT',{...(await state()),expected_version:(await state()).version})).status,200,'Completed journals release the catalog save lock');

// The purchase-ledger authority already releases a cancelled allocation. Its
// audit entry must not count as another manual Increase.
assert.equal(repaired.body.stock_restored[0].change_type,'Adjustment');
const purchased=4,allocated=0,manualAdjustment=repaired.body.stock_restored.reduce((sum:number,event:any)=>sum+(event.change_type==='Increase'?event.quantity:event.change_type==='Decrease'?-event.quantity:0),0);
assert.equal(purchased-allocated+manualAdjustment,4);
const html=fs.readFileSync('public/cancel-order.html','utf8');new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)![1]);
assert(html.includes('report.textContent=')&&!html.includes('innerHTML'),'Cancellation report uses safe text rendering');
assert([...raw.objects.values()].every(object=>['ora-aes-gcm-v1','ora-aes-gcm-v2'].includes(JSON.parse(object.value).format)),'Cancellation journals remain encrypted');
console.log('PASS: pre-dispatch cancellation; Super Admin auth; 3 allocated items restored once; stock/final-save failures and retries; exact variants and bundle components; concurrent/replayed requests; unchanged invoices/amounts/export history; permanent waybill owner; stale PUT/SDK guards; pending catalog conflict; unallocated and blocked parcels; safe report script.');
