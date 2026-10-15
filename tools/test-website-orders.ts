import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ACTIVE_KEY,dataBucket,readDataTable,replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { syncWebsiteOrderSheets } from '../worker/websiteOrderSheetSync';
import { savePublicOrder } from '../src/lib/publicOrderSave';
import { invoiceReady } from '../src/lib/invoiceQueue';
import { prepareOrderSnapshotUpdate } from '../src/lib/orderSnapshotUpdate';

class MemoryBucket {
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>();revision=0;failWrites=false;
  async get(key:string){const object=this.objects.get(key);return object?{...object,text:async()=>object.value}:null;}
  async put(key:string,value:string,options:any={}){
    if(this.failWrites&&key.endsWith('/order-changes-v1.json'))throw new Error('503 synthetic write failure');
    const previous=this.objects.get(key),condition=options.onlyIf;
    if(condition?.etagMatches&&condition.etagMatches!==previous?.etag||condition?.etagDoesNotMatch==='*'&&previous)return null;
    const etag=String(++this.revision);this.objects.set(key,{value,etag,customMetadata:options.customMetadata});return {etag};
  }
}
const raw=new MemoryBucket(),secret='website-test-'+crypto.randomUUID(),env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:secret,ORA_R2_COMPRESSION_ENABLED:'1'};
const bucket=dataBucket(env)!,prefix='ora-data/generations/website-test/';
const password='cfhmac:salt:'+crypto.createHmac('sha256',secret).update('salt:test-pass').digest('hex');
const users=[{id:'admin-fixture',username:'admin',display_name:'Admin',role:'admin',is_active:true,password_hash:password},
  {id:'viewer-fixture',username:'viewer',role:'staff',is_active:true,password_hash:password,permissions:['orders','level:orders:view']}];
const product={id:'p1',sku:'P1',name_en:'Fixture item',selling_price:100,stock_quantity:7};
await bucket.put(ACTIVE_KEY,JSON.stringify({format:'ora-r2-tables-v2',prefix}));
await bucket.put(prefix+'order_snapshots.json','[]');
await bucket.put(prefix+'__sequences.json',JSON.stringify(['WEB','FB','TK','MAN'].map(id=>({id,value:0}))));
await bucket.put(prefix+'admin_users.json',JSON.stringify(users));
await bucket.put(prefix+'admin_data_store.json',JSON.stringify([{key:'storefront-state-v1',payload:{products:[product],categories:[],settings:{google_sheet_webhook_url:'https://script.google.com/macros/s/fixture/exec'}}}]));
const request=(path:string,body?:any,token='')=>withR2DataFallback(new Request('https://store.test'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:token?'Bearer '+token:'','cf-connecting-ip':'192.0.2.1'},...(body?{body:JSON.stringify(body)}:{})}),env,{},async()=>{throw new Error('Website submit must not depend on the Node/Supabase bridge');});
const order=(id=crypto.randomUUID(),extra:any={})=>({id:'ord-'+id,order_number:'WEB-000001',order_source:'Website',customer_name:'Test Buyer',phone:'0770000000',whatsapp:'0770000000',address:'Test Road No 10',city:'Naiwala',district:'Gampaha',payment_method:'COD',subtotal:100,delivery_fee:250,total_amount:350,items:[{product_id:'p1',product_name:'Fixture item',sku:'P1',main_sku:'P1',quantity:1,unit_price:100,subtotal:100}],created_at:new Date().toISOString(),...extra});
const beforeCatalog=JSON.stringify(await readDataTable(env,'admin_data_store'));
const original=order(undefined,{duplicate_review_status:'Approved'});
for(let i=0;i<3;i++)assert.equal((await request('/api/order-guard',{phone:original.phone,items:[{id:'p1',qty:1}]})).status,200,'Preflight must not reserve duplicate identity');
raw.failWrites=true;
assert.equal((await request('/api/orders',{order:original})).status,503);
assert.equal((await readDataTable(env,'order_snapshots')).length,0,'A failed write cannot be acknowledged or recorded as an order');
raw.failWrites=false;
const saved=await (await request('/api/orders',{order:original})).json();
assert.equal(saved.ok,true);assert.equal(saved.order.is_duplicate_order,false);
assert.equal(saved.order.duplicate_review_status,undefined,'A customer cannot forge staff approval history');
const replay=await (await request('/api/orders',{order:original})).json();
assert.equal(replay.order.order_number,saved.order.order_number);
assert.equal((await readDataTable(env,'order_snapshots')).length,1,'Response-loss retries must not create a second order');
const repeat=order();
const repeated=await (await request('/api/orders',{order:repeat})).json();
assert.equal(repeated.ok,true);assert.equal(repeated.order.is_duplicate_order,true);
assert.equal(repeated.order.duplicate_review_status,'Pending');assert.equal(repeated.order.duplicate_of_order_id,original.id);
assert.notEqual(repeated.order.order_number,saved.order.order_number);
assert.equal(invoiceReady({...repeated.order,call_center_status:'Confirmed'}),false,'Held duplicates cannot auto-generate another invoice');
assert.equal((await request('/api/orders',{order:{...original,total_amount:450}})).status,409,'An old request ID cannot be used to overwrite different details');
assert.equal(JSON.stringify(await readDataTable(env,'admin_data_store')),beforeCatalog,'Order creation cannot reduce product stock or rewrite the catalog');
const login=async(username:string)=>(await (await request('/api/staff/login',{username,password:'test-pass'})).json()).token;
const adminToken=await login('admin'),viewToken=await login('viewer');
assert.equal((await request('/api/orders/duplicate-review')).status,401);
const list=await (await request('/api/orders/duplicate-review',undefined,adminToken)).json();
assert.equal(list.pending,1);assert.equal(list.pairs[0].original.id,original.id);
assert.equal((await request('/api/orders/duplicate-review',{action:'approve_separate',order_id:repeat.id},viewToken)).status,403);
const approved=await (await request('/api/orders/duplicate-review',{action:'approve_separate',order_id:repeat.id},adminToken)).json();
assert.equal(approved.ok,true);assert.equal(approved.order.is_duplicate_order,false);assert.equal(approved.order.duplicate_review_status,'Approved');
assert.equal(approved.order.stock_allocated,false);assert.equal(approved.order.duplicate_of_order_id,original.id);
assert.equal(prepareOrderSnapshotUpdate(repeated.order,{...repeated.order,is_duplicate_order:false},[]).order.is_duplicate_order,true,'A browser edit cannot bypass duplicate review');
assert.equal(prepareOrderSnapshotUpdate(approved.order,{...repeated.order,is_duplicate_order:true},[]).order.is_duplicate_order,false,'A stale browser cannot reverse an approval');
assert.equal((await (await request('/api/orders/duplicate-review',{action:'approve_separate',order_id:repeat.id},adminToken)).json()).already_approved,true);
assert.equal((await readDataTable(env,'order_snapshots')).length,2);
assert.equal(JSON.stringify(await readDataTable(env,'admin_data_store')),beforeCatalog);

const physical=new Map<string,number>();let writes=0,loseAck=true,failGoogle=false;
const network:typeof fetch=async(_input:any,init:any)=>{
  assert.equal(String(_input),'https://script.google.com/macros/s/fixture/exec','Test requests may only reach the fake Sheet');
  if(failGoogle)throw new Error('Google temporarily unavailable');
  const body=JSON.parse(init.body);
  if(body.action==='read_order')return Response.json({found:physical.has(body.orderId),rows:physical.get(body.orderId)||0});
  assert.equal(body.action,'sync_orders');writes++;physical.set(body.order.order_number,body.order.items.length);
  // Simulate the physical Google write succeeding but the HTTP acknowledgment being lost.
  if(loseAck){loseAck=false;throw new Error('Lost Google acknowledgment');}
  return Response.json({status:'orders_synced',rows:body.order.items.length,synced:1});
};
await syncWebsiteOrderSheets(env,[original.id],network);
assert.equal((await readDataTable(env,'order_snapshots')).find(row=>row.order_id===original.id)!.payload.is_synced_google_sheets,false);
await syncWebsiteOrderSheets(env,[original.id],network);
assert.equal(writes,1,'Read-back acknowledgment retries cannot create duplicate Sheet rows');
assert((await readDataTable(env,'order_snapshots')).find(row=>row.order_id===original.id)!.payload.sheet_sync_verified_at);
failGoogle=true;await syncWebsiteOrderSheets(env,[repeat.id],network);
assert.equal((await readDataTable(env,'order_snapshots')).find(row=>row.order_id===repeat.id)!.payload.is_synced_google_sheets,false);
failGoogle=false;await syncWebsiteOrderSheets(env,[repeat.id],network);
assert((await readDataTable(env,'order_snapshots')).find(row=>row.order_id===repeat.id)!.payload.sheet_sync_verified_at);
assert.equal(physical.size,2);

const storage=new Map<string,string>();(globalThis as any).sessionStorage={getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)};
const pendingOrder=order();let calls=0;const ids:string[]=[];
await assert.rejects(savePublicOrder(pendingOrder as any,undefined,false,false,async(_url:any,init:any)=>{ids.push(JSON.parse(init.body).order.id);calls++;return Response.json({error:'503 test failure'},{status:503});}),/503/);
assert.equal(calls,3);assert.equal(new Set(ids).size,1);assert(storage.has('ora_pending_website_order_v1'));
const retried=await savePublicOrder(order() as any,undefined,false,false,async(_url:any,init:any)=>{const sent=JSON.parse(init.body).order;assert.equal(sent.id,pendingOrder.id);return Response.json({ok:true,order:{...sent,order_number:'WEB-000999'}});});
assert.equal(retried.id,pendingOrder.id);assert.equal(storage.size,0);
const deliberate=order();await savePublicOrder(deliberate as any,undefined,false,false,async(_url:any,init:any)=>{const sent=JSON.parse(init.body).order;assert.equal(sent.id,deliberate.id,'A deliberate repeat after success gets its own reviewable order ID');return Response.json({ok:true,order:{...sent,order_number:'WEB-001000'}});});
console.log('PASS: failed saves retry safely; stable IDs, repeat-purchase review and protected approval; no stock/waybill changes; durable Sheet catch-up, physical read-back and lost-ack deduplication; browser retry identity.');
