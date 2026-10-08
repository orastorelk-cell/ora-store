import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { loadConfigFromFile } from 'vite';
import { activeData, dataBucket, importRecovery, readDataTable, readDataTableWire, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { confirmCsvRequestWithRetry } from '../src/lib/confirmCsvSave';
import { finishInvoiceRecovery, invoiceRecoveryPath } from '../src/lib/invoiceRecovery';
import { invoiceComplete } from '../src/lib/invoiceQueue';
import { RETURN_CONTROL_KEY, RETURN_UNLISTED_PREFIX, sharedReturnInventory } from '../src/lib/returnSheets';
import { returnPackingCsv } from '../src/lib/returnExports';
import { staffJsonRequest } from '../src/lib/staffRequest';
import { markR2SheetSynced } from '../worker/r2SheetSyncStatus';

class MemoryBucket{
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>();revision=0;bodyReads=0;failKey='';failAfter=false;
  async get(key:string){const object=this.objects.get(key);await Promise.resolve();return object?{etag:object.etag,customMetadata:object.customMetadata,text:async()=>{this.bodyReads++;return object.value;}}:null;}
  async put(key:string,value:string,options:any={}){
    const old=this.objects.get(key);if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==old?.etag)return null;
    if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;
    const fail=key===this.failKey;if(fail&&!this.failAfter){this.failKey='';throw new Error('Synthetic storage failure before commit');}
    const next={value,etag:String(++this.revision),customMetadata:options.customMetadata};this.objects.set(key,next);
    if(fail){this.failKey='';throw new Error('Synthetic response lost after commit');}return {etag:next.etag};
  }
}
const waiting=(id:string,extra:any={})=>({id,order_number:'WEB-'+id,created_at:'2026-10-01T00:00:00Z',customer_name:'Fixture customer',phone:'0770000000',address:'Fixture address',city:'Colombo',total_amount:350,payment_method:'COD',call_center_status:'Confirmed',order_status:'Processing',stock_allocated:false,stock_status:'Waiting for Stock',items:[{product_id:'mat',product_name:'Fixture mat',sku:'MAT',quantity:1,unit_price:100,subtotal:100}],...extra});
const fixture=async(orders:any[],stock=100,extraAdmin:any[]=[])=>{
  const raw=new MemoryBucket(),env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:'recovery-fixture-only',ORA_R2_COMPRESSION_ENABLED:'1'};
  const hash='cfhmac:salt:'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update('salt:fixture-password').digest('hex');
  await importRecovery(dataBucket(env)!,{format:'ora-r2-recovery-v1',orders,
    admin_users:[{id:'admin',role:'admin',username:'admin',password_hash:hash,is_active:true},{id:'staff',role:'staff',username:'staff',permissions:['confirm_upload'],is_active:true},{id:'viewer',role:'staff',permissions:['confirm_upload','level:confirm_upload:view'],is_active:true}],
    admin_data_store:[{key:'storefront-state-v1',payload:{version:1,products:[{id:'mat',sku:'MAT',name_en:'Fixture mat',stock_quantity:stock}],categories:[],settings:{fardar_parcel_type:'Parcel'}}},...extraAdmin],
    courier_waybills:[...orders.filter(order=>order.waybill_number).map(order=>({waybill_number:order.waybill_number,status:'Assigned',assigned_order_number:order.order_number,assigned_order_id:order.id,courier_name:'Fardar'})),...Array.from({length:Math.max(orders.length,3)},(_,i)=>({waybill_number:'WB-NEW-'+i,status:'Available',courier_name:'Fardar',imported_at:'2026-10-01T00:00:00Z'}))],tables:{}});
  const active=(await activeData(dataBucket(env)!))!;
  const token=(user='admin')=>{const payload=Buffer.from(JSON.stringify({sub:user,exp:Date.now()+3600000})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update(payload).digest('base64url');};
  const call=async(path:string,body?:any,user='admin')=>{
    const response=await withR2DataFallback(new Request('https://fixture'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token(user)},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{},async()=>new Response('Unexpected Node bridge',{status:599}));
    return {status:response.status,data:await response.json() as any};
  };
  const request=async(path:string,body?:unknown)=>{const response=await call(path,body);if(response.status!==200){const error:any=new Error(response.data.error);error.status=response.status;throw error;}return response.data;};
  const currentOrders=async()=>(await readDataTable(env,'order_snapshots')).map(row=>row.payload);
  const admin=()=>readDataTable(env,'admin_data_store');
  const currentStock=async()=>(await admin()).find(row=>row.key==='storefront-state-v1')!.payload.products[0].stock_quantity;
  return {raw,env,active,token,call,request,currentOrders,admin,currentStock};
};

// Gateway errors are bounded and retried; authentication/conflict failures are
// returned immediately, rather than turning a genuine rejection into success.
for(const status of [429,500,502,503,504,507]){
  let attempts=0;const pauses:number[]=[];
  assert.equal(await confirmCsvRequestWithRetry(async()=>{if(++attempts===1)throw Object.assign(new Error('Fixture failure'),{status});return 'saved';},'/fixture',undefined,async ms=>{pauses.push(ms);}), 'saved');
  assert.equal(attempts,2);assert(pauses[0]>=1100);
}
for(const status of [400,401,403,409]){let attempts=0;await assert.rejects(confirmCsvRequestWithRetry(async()=>{attempts++;throw Object.assign(new Error('Fixture rejection'),{status});},'/fixture',undefined,async()=>{}));assert.equal(attempts,1);}
const originalFetch=globalThis.fetch;
try{globalThis.fetch=async()=>new Response('Gateway HTML',{status:507});await assert.rejects(staffJsonRequest('/fixture'),(error:any)=>error.status===507);
  globalThis.fetch=async()=>new Response('Not JSON',{status:200});await assert.rejects(staffJsonRequest('/fixture'),(error:any)=>error.status===503);
  globalThis.fetch=async(_url,options)=>new Promise((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted fixture'),{name:'AbortError'})),{once:true});});
  await assert.rejects(staffJsonRequest('/fixture',{},5),(error:any)=>error.status===503&&/timed out/.test(error.message));
}finally{globalThis.fetch=originalFetch;}

const printed=waiting('printed',{stock_allocated:true,stock_status:'Allocated',waybill_number:'WB-PRINTED',invoice_locked:true,invoice_number:'INV-KEEP',invoice_pack_batch_id:'PACK-KEEP',invoice_generated_at:'2026-10-01T00:00:00Z',invoice_pack_downloaded_at:'2026-10-01T01:00:00Z'});
const shipped=waiting('shipped',{order_status:'Shipped',dispatch_status:'Handed Over',stock_allocated:true,waybill_number:'WB-SHIPPED'});
const f=await fixture([waiting('missing'),waiting('allocated',{stock_allocated:true,stock_status:'Allocated',waybill_number:'WB-ALLOCATED'}),waiting('partial',{stock_allocated:true,stock_status:'Allocated',waybill_number:'WB-PARTIAL',invoice_locked:true,invoice_number:'INV-PARTIAL',invoice_generated_at:'2026-10-01T01:00:00Z'}),printed,shipped,waiting('cancelled',{order_status:'Cancelled'}),waiting('test',{is_test_order:true})],10);
const id=crypto.randomUUID();
assert.equal((await f.call(invoiceRecoveryPath,{operation_id:id},'viewer')).status,403);
assert.equal((await f.call(invoiceRecoveryPath,{operation_id:'invalid'})).status,400);
const prepared=await f.request(invoiceRecoveryPath,{operation_id:id});assert.equal(prepared.phase,'prepared');assert.equal(await f.currentStock(),10);
const protectedScan=await f.call('/api/returns/scan',{waybill:'WB-SHIPPED'});assert.equal(protectedScan.status,409,'A staged stock operation protects concurrent return receipt writes');
f.raw.failKey=f.active.prefix+'order_snapshots.json';f.raw.failAfter=true;
await assert.rejects(f.request(invoiceRecoveryPath,{operation_id:id,advance:true}),/Synthetic response lost/);
assert.equal(await f.currentStock(),10,'An order-lock acknowledgment loss cannot deduct stock early');
const savedStock=await f.request(invoiceRecoveryPath,{operation_id:id,advance:true});assert.equal(savedStock.phase,'stock_saved');assert.equal(await f.currentStock(),9);
f.raw.failKey=f.active.prefix+'order_snapshots.json';f.raw.failAfter=true;
await assert.rejects(f.request(invoiceRecoveryPath,{operation_id:id,advance:true}),/Synthetic response lost/);
const finished=await finishInvoiceRecovery(id,f.request);assert.equal(finished.orders.length,3);assert(finished.orders.every(invoiceComplete));assert.equal(await f.currentStock(),9);
const old=await f.currentOrders();assert.deepEqual(old.find(order=>order.id==='printed'),printed);assert.deepEqual(old.find(order=>order.id==='shipped'),shipped);
assert.equal(finished.orders.find((order:any)=>order.id==='partial').invoice_number,'INV-PARTIAL');
const snapshots=f.raw.objects.get(f.active.prefix+'order_snapshots.json')!.etag;
await finishInvoiceRecovery(id,f.request);assert.equal(f.raw.objects.get(f.active.prefix+'order_snapshots.json')!.etag,snapshots);assert.equal(await f.currentStock(),9);
await f.request(invoiceRecoveryPath+'/'+id+'/downloaded',{});await f.request(invoiceRecoveryPath+'/'+id+'/downloaded',{});
assert.equal((await f.request(invoiceRecoveryPath+'/'+id)).orders.length,3);
assert.equal((await f.request(invoiceRecoveryPath)).batches.length,1);
assert.equal((await f.call('/api/returns/packing/'+id)).status,409,'Recovery journals cannot be exported through the return workflow');
const inventory=sharedReturnInventory(await f.admin());assert.equal(inventory.stockHistory.filter((row:any)=>row.reason.startsWith('Confirm Upload Double Check')).length,1);assert.equal(inventory.batches.length,0);
assert.equal(returnPackingCsv(finished.orders,finished.settings).split('\r\n').length,4);
const again=await finishInvoiceRecovery(crypto.randomUUID(),f.request);assert.equal(again.orders.length,0);assert.equal(await f.currentStock(),9);

// Every view still checks the durable ETag; unchanged encrypted objects do not
// require repeated body reads/decryption, and a failed write is never cached.
await (await readDataTableWire(f.env,'order_snapshots')).text();const reads=f.raw.bodyReads;
await (await readDataTableWire(f.env,'order_snapshots')).text();assert.equal(f.raw.bodyReads,reads);
const otherEnv={...f.env,ORA_MEDIA_R2:{get:f.raw.get.bind(f.raw),put:f.raw.put.bind(f.raw)}};
await replaceDataTable(otherEnv,'order_snapshots',rows=>({rows:rows.map(row=>row.order_id==='cancelled'?{...row,payload:{...row.payload,notes:'Another device'}}:row),result:null}));
assert.match(await (await readDataTableWire(f.env,'order_snapshots')).text(),/Another device/);

// An open return check permits invoice-only repair of already allocated stock;
// new allocations wait and the manual return-packing flag remains set.
const open=await fixture([waiting('allocated',{stock_allocated:true,stock_status:'Allocated',waybill_number:'WB-A'}),waiting('waiting')],3,
  [{key:RETURN_CONTROL_KEY,payload:{packing_pending:true}},{key:RETURN_UNLISTED_PREFIX+'WB-OPEN',payload:{id:'',parcels:[{waybill:'WB-OPEN',scanned_at:'2026-10-01T00:00:00Z',items:[]}],receipts:[]}}]);
const openResult=await finishInvoiceRecovery(crypto.randomUUID(),open.request);assert.equal(openResult.orders.length,1);assert.equal(openResult.skipped.return_checks,1);assert.equal(await open.currentStock(),3);assert.equal((await open.admin()).find(row=>row.key===RETURN_CONTROL_KEY)!.payload.packing_pending,true);

const many=await fixture(Array.from({length:121},(_,i)=>waiting('many-'+i)),150);
let count=0,next=true;const seen=new Set<string>();
while(next){const batch=await finishInvoiceRecovery(crypto.randomUUID(),many.request);assert(batch.orders.length<=50);batch.orders.forEach((order:any)=>{assert(!seen.has(order.id));seen.add(order.id);});count+=batch.orders.length;next=batch.skipped.limit>0;}
assert.equal(count,121);assert.equal(await many.currentStock(),29);
const writeStart=many.raw.revision;
const mirrored=await markR2SheetSynced(await many.currentOrders(),many.env,true);
assert.equal(many.raw.revision-writeStart,1,'A large Sheet verification writes one table revision');
assert(mirrored.every(order=>invoiceComplete(order)&&order.is_synced_google_sheets&&order.sheet_sync_verified_at));
const verifiedVersion=many.raw.objects.get(many.active.prefix+'order_snapshots.json')!.etag;
await markR2SheetSynced(mirrored,many.env,true);
assert.equal(many.raw.objects.get(many.active.prefix+'order_snapshots.json')!.etag,verifiedVersion,'A repeated Sheet acknowledgment does not rewrite orders');

const conflict=await fixture([waiting('conflict')],5),conflictId=crypto.randomUUID();
await conflict.request(invoiceRecoveryPath,{operation_id:conflictId});
await replaceDataTable(conflict.env,'order_snapshots',rows=>({rows:rows.map(row=>({...row,payload:{...row.payload,notes:'An earlier staff request finished'}})),result:null}));
assert.equal((await conflict.call(invoiceRecoveryPath,{operation_id:conflictId,advance:true})).status,409);
assert.equal(await conflict.currentStock(),5);assert.equal((await conflict.admin()).find(row=>row.key===RETURN_CONTROL_KEY)!.payload.packing_pending,false,'A failed prepared check must not freeze automatic packing forever');
assert.equal((await finishInvoiceRecovery(crypto.randomUUID(),conflict.request)).orders.length,1);
assert.equal(await conflict.currentStock(),4);
const concurrent=await fixture([waiting('parallel')],5),parallelId=crypto.randomUUID();
await concurrent.request(invoiceRecoveryPath,{operation_id:parallelId});
const advances=await Promise.all([concurrent.request(invoiceRecoveryPath,{operation_id:parallelId,advance:true}),concurrent.request(invoiceRecoveryPath,{operation_id:parallelId,advance:true})]);
assert(advances.every(data=>data.ok));
await Promise.all([finishInvoiceRecovery(parallelId,concurrent.request),finishInvoiceRecovery(parallelId,concurrent.request)]);
assert.equal(await concurrent.currentStock(),4);
const stockAck=await fixture([waiting('stock-ack')],5),stockAckId=crypto.randomUUID();
await stockAck.request(invoiceRecoveryPath,{operation_id:stockAckId});
stockAck.raw.failKey=stockAck.active.prefix+'admin_data_store.json';stockAck.raw.failAfter=true;
await assert.rejects(stockAck.request(invoiceRecoveryPath,{operation_id:stockAckId,advance:true}),/Synthetic response lost/);
assert.equal(await stockAck.currentStock(),4);
await markR2SheetSynced(await stockAck.currentOrders(),stockAck.env,true);
await finishInvoiceRecovery(stockAckId,stockAck.request);assert.equal(await stockAck.currentStock(),4,'A lost stock-commit acknowledgment resumes without another deduction');
assert.equal((await stockAck.currentOrders())[0].is_synced_google_sheets,true,'An in-flight Sheet acknowledgment does not interrupt or get lost during recovery');

// Execute the actual legacy bulk route too: replayed IDs remain unchanged and
// the second Sheet-status save must not import Lead IDs rejected by deduplication.
const server=fs.readFileSync('server.ts','utf8'),bulkStart=server.indexOf("app.post('/api/admin/orders/bulk-import'"),bulkEnd=server.indexOf("app.get('/api/orders/version'",bulkStart);
const known=waiting('known',{platform_lead_id:'already',order_source:'Facebook Ads',is_synced_google_sheets:true,total_amount:999});
let durable=[known],handler:any;const writes:any[][]=[];
const scope:any={app:{post:(_path:string,...steps:any[])=>{handler=steps.at(-1);}},requireStaffAnyPermission:()=>()=>{},normalizeIncomingOrderText:(order:any)=>structuredClone(order),getOrderSnapshots:async()=>structuredClone(durable),attachOrderSheetMetadataServer:async()=>{},
  saveOrderSnapshotsBatch:async(orders:any[])=>{writes.push(structuredClone(orders));durable=[...durable.filter(old=>!orders.some(order=>order.id===old.id)),...structuredClone(orders)];},
  syncOrdersToGoogleSheetsServer:async()=>({ok:true}),isOrderEligibleForSheetServer:()=>true,dataBucket:()=>null,console};
vm.createContext(scope);vm.runInContext(transformSync(server.slice(bulkStart,bulkEnd),{loader:'ts',target:'es2022'}).code,scope);
let response:any;const res:any={status:()=>res,json:(data:any)=>{response=data;return res;}};
const incoming=[waiting('known',{total_amount:1}),waiting('dupe',{order_source:'Facebook Ads',platform_lead_id:'already'}),waiting('fresh',{order_source:'Facebook Ads',platform_lead_id:'new'})];
await handler({body:{orders:incoming}},res);assert(response.ok);assert.equal(response.orders.length,2);assert(writes.every(batch=>batch.length===1&&batch[0].id==='fresh'));assert.equal(durable.length,2);assert.equal(durable.find(order=>order.id==='known')!.total_amount,999);
const firstWrites=writes.length;await handler({body:{orders:incoming}},res);assert.equal(writes.length,firstWrites);assert.equal(durable.length,2,'A lost bulk-upload response must not create orders again');

// The Vite plugin replaces the raw Confirm section. Check the ACTUAL production
// output so the button cannot disappear in that transformation.
const config=(await loadConfigFromFile({command:'build',mode:'production'}))!.config as any;
let dashboard=fs.readFileSync('src/components/admin/AdminDashboard.tsx','utf8');
for(const plugin of config.plugins.flat(Infinity))if(plugin?.name?.startsWith('ora-')&&typeof plugin.transform==='function'){const result=await plugin.transform(dashboard,process.cwd()+'/src/components/admin/AdminDashboard.tsx');if(result)dashboard=typeof result==='string'?result:result.code;}
const section=dashboard.slice(dashboard.indexOf("{activeTab === 'confirm_upload'"),dashboard.indexOf('      {/* TAB 5: GOOGLE SHEETS SYNC */}'));
assert(section.includes('<InvoiceDoubleCheck />'));
console.log('PASS: 500/507 retries and strict JSON acknowledgments; staged, resumable Double Check; lost responses before/after stock; partial invoices; read-only staff guards; repeat exports; preserved completed/dispatched orders; current ETag cache; unchecked-return isolation; 121 orders in bounded batches; actual production Confirm Upload button.');
