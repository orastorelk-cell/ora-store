import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { loadConfigFromFile } from 'vite';
import { configureCloudflareData, dataBucket, importRecovery, readDataTable, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { invoiceComplete, invoiceReady, saveInvoiceQueue } from '../src/lib/invoiceQueue';

class MemoryBucket {
  objects=new Map<string,{value:string;etag:string}>();revision=0;
  async get(key:string){const row=this.objects.get(key);return row?{text:async()=>row.value,etag:row.etag}:null;}
  async put(key:string,value:string,options:any={}){
    const current=this.objects.get(key);
    if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==current?.etag)return null;
    if(options.onlyIf?.etagDoesNotMatch==='*'&&current)return null;
    const row={value,etag:String(++this.revision)};this.objects.set(key,row);return {etag:row.etag};
  }
}
const env={ORA_MEDIA_R2:new MemoryBucket(),STAFF_SESSION_SECRET:'stock-regression-fixture',SUPABASE_SECRET_KEY:'fixture',VITE_SUPABASE_URL:'https://fixture.supabase.co'};
configureCloudflareData(env);
const fixtureSkus:Record<string,string>={'returned-stock':'R',ordinary:'O',a:'A',b:'B',combo:'C',colour:'V'};
const item=(product_id:string,quantity=1,extra={})=>({product_id,product_name:product_id,sku:fixtureSkus[product_id],quantity,unit_price:500,subtotal:quantity*500,...extra});
const waiting=(id:string,items:any[],extra={})=>({id,order_number:'FIXTURE-'+id,created_at:'2026-10-02T00:00:00Z',customer_name:'Stock fixture',phone:'0770000000',address:'Fixture address',city:'Fixture city',fardar_city:'Fixture city',call_center_status:'Confirmed',order_status:'Processing',stock_allocated:false,stock_status:'Waiting for Stock',stock_waiting_since:'2026-10-02T01:00:00Z',total_amount:1000,payment_method:'COD',items,...extra});
const printed=waiting('printed',[item('ordinary')],{stock_allocated:true,stock_status:'Allocated',waybill_number:'WB-PRINTED',invoice_locked:true,invoice_number:'INV-KEEP',invoice_generated_at:'2026-10-01T00:00:00Z',invoice_pack_batch_id:'PACK-KEEP',invoice_pack_downloaded_at:'2026-10-01T01:00:00Z'});
const returned={...printed,id:'returned',order_number:'FIXTURE-returned',waybill_number:'WB-RETURN',order_status:'Shipped',dispatch_status:'Handed Over',items:[item('returned-stock',2)]};
const orders=[returned,printed,
  waiting('first',[item('returned-stock',2)]),waiting('second',[item('returned-stock',2)],{created_at:'2026-10-03T00:00:00Z'}),
  waiting('ordinary',[item('ordinary')]),
  waiting('blue',[item('colour',1,{variant_id:'blue',variant_name:'Blue',sku:'BLUE'})]),
  waiting('combo',[item('combo',1,{product_type:'bundle',bundle_components:[{product_id:'a',product_name:'A',sku:'A',quantity_per_bundle:2},{product_id:'b',product_name:'B',sku:'B',quantity_per_bundle:1}]})]),
  waiting('unconfirmed',[item('returned-stock')],{call_center_status:'Pending'}),
  waiting('cancelled',[item('ordinary')],{order_status:'Cancelled'})];
const products=[{id:'returned-stock',sku:'R',name_en:'Returned stock',stock_quantity:1},{id:'ordinary',sku:'O',name_en:'Ordinary stock',stock_quantity:1},
  {id:'a',sku:'A',name_en:'A',stock_quantity:2},{id:'b',sku:'B',name_en:'B',stock_quantity:1},{id:'combo',sku:'C',product_type:'bundle',stock_quantity:0},
  {id:'colour',sku:'V',name_en:'Colour',product_type:'variant',stock_quantity:5,variants:[{id:'blue',sku:'BLUE',option_value:'Blue',stock_quantity:0},{id:'red',sku:'RED',option_value:'Red',stock_quantity:5}]}];
await importRecovery(dataBucket(env)!,{format:'ora-r2-recovery-v1',orders,admin_users:[{id:'admin',role:'admin',display_name:'Fixture',is_active:true}],admin_data_store:[{key:'storefront-state-v1',payload:{version:1,products,categories:[],settings:{}}}],courier_waybills:[{waybill_number:'WB-PRINTED',status:'Used',assigned_order_number:printed.order_number},{waybill_number:'WB-RETURN',status:'Used',assigned_order_number:returned.order_number},...Array.from({length:4},(_,i)=>({waybill_number:'WB-FREE-'+i,status:'Available',courier_name:'Fardar',imported_at:'2026-10-01T00:00:00Z'}))],tables:{}});
const payload=Buffer.from(JSON.stringify({sub:'admin',exp:Date.now()+3600000})).toString('base64url');
const token=payload+'.'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update(payload).digest('base64url');
const request=async(url:string,options:RequestInit={})=>{
  const response=await withR2DataFallback(new Request('https://fixture'+url,{...options,headers:{authorization:'Bearer '+token,'content-type':'application/json'}}),env,{},async()=>new Response('Unexpected bridge',{status:599}));
  const body:any=await response.json();return {status:response.status,body};
};
const checked=async(url:string,options:RequestInit={})=>{const result=await request(url,options);assert.equal(result.status,200,JSON.stringify(result));return result.body;};
const post=(url:string,body:any)=>checked(url,{method:'POST',body:JSON.stringify(body)});
const state=async()=>(await checked('/api/admin/storefront/state')).state;
const savedOrders=async()=>(await readDataTable(env,'order_snapshots')).map(row=>row.payload);
await post('/api/returns/scan',{waybill:'WB-RETURN'});
const parcel=(await checked('/api/returns/parcels/WB-RETURN')).sheet.parcels[0];
const receipt={operation_id:crypto.randomUUID(),expected_revision:parcel.revision,waybill:parcel.waybill,items:[{id:parcel.items[0].id,good_qty:2,damaged_qty:0,not_received:false,photo_ids:[]}],notes:''};
await post('/api/returns/parcels/WB-RETURN/receive',receipt);
const received=await state();assert.equal(received.products[0].stock_quantity,3);assert.equal(received.return_inventory.packing_pending,true);assert.equal(received.return_inventory.allocation_paused,false);
await post('/api/returns/parcels/WB-RETURN/receive',receipt);assert.equal((await state()).products[0].stock_quantity,3,'Receipt retries cannot add stock again');

// Execute both actual production React effects after all Vite business-rule transforms.
const config=(await loadConfigFromFile({command:'build',mode:'production'}))!.config as any;
let source=fs.readFileSync('src/context/StoreContext.tsx','utf8');
for(const plugin of config.plugins.flat(Infinity))if(plugin?.name?.startsWith('ora-')&&typeof plugin.transform==='function'){
  const result=await plugin.transform(source,process.cwd()+'/src/context/StoreContext.tsx');if(result)source=typeof result==='string'?result:result.code;
}
const start=source.indexOf('  type InventoryRequirement='),end=source.indexOf('  const updateOrderStatus',start);assert.ok(start>=0&&end>start);
const effects:Function[]=[],tasks:Promise<any>[]=[];let history:any[]=received.return_inventory.stockHistory;
const track=(task:Promise<any>)=>{tasks.push(task);return task;};
const context:any={Date,Math,console,orders:await savedOrders(),products:received.products,adminUser:{id:'admin'},sharedStoreReady:true,sharedOrdersReady:true,sharedWaybillPoolReady:true,
  returnPackingPending:true,returnStockTransactionPending:false,waybillRecords:(await checked('/api/courier/waybills')).records,waybillPoolRetry:0,
  purchaseOrders:[{sku:'R',quantity_added:3},{sku:'O',quantity_added:2},{sku:'A',quantity_added:2},{sku:'B',quantity_added:1}],stockHistory:history,
  fifoAllocatorSignatureRef:{current:''},automaticWaybillRunRef:{current:false},automaticWaybillRetryTimerRef:{current:null},autoInvoiceReadyRef:{current:new Set()},invoiceQueueBusyRef:{current:false},invoiceQueueRetryTimerRef:{current:null},invoiceQueueRetry:0,setWaybillPoolRetry:()=>{},
  settings:{courier_provider:'Fardar'},getStaffSessionToken:()=>token,normalizedProductType:(p:any)=>p.product_type||'normal',variantById:(p:any,id:string)=>p.variants?.find((v:any)=>v.id===id),
  useEffect:(effect:Function)=>effects.push(effect),setProducts:(update:any)=>{context.products=typeof update==='function'?update(context.products):update;},
  setOrders:(update:any)=>{context.orders=typeof update==='function'?update(context.orders):update;},setStockHistory:(update:Function)=>{history=update(history);context.stockHistory=history;},
  mirrorOrderUpdate:(order:any)=>track(checked('/api/orders/'+order.id,{method:'PUT',body:JSON.stringify({order})})),
  assignNextWaybill:(id:string,courier_name:string)=>track(post('/api/orders/waybill/assign',{order_id:id,courier_name}).then(data=>{if(data.order)context.orders=context.orders.map((order:any)=>order.id===id?data.order:order);return data.order?.waybill_number;})),
  invoiceComplete,invoiceReady,sharedStaffRequest:checked,saveInvoiceQueue:(...args:any[])=>track((saveInvoiceQueue as any)(...args)),
  logActivity:()=>{},refreshOrdersFromServer:async()=>{},setInvoiceQueueRetry:()=>{},window:{setTimeout:(_callback:Function,delay:number)=>{assert.equal(delay,5000,'Only the normal waybill poll should be scheduled');return 1;}}};
vm.runInNewContext(transformSync(source.slice(start,end),{loader:'ts'}).code,context);assert.equal(effects.length,2);
const flush=async()=>{let i=0;do{for(;i<tasks.length;i++)await tasks[i];await new Promise(resolve=>setImmediate(resolve));}while(i<tasks.length||context.automaticWaybillRunRef.current||context.invoiceQueueBusyRef.current);};
const before=JSON.stringify({products:context.products,orders:context.orders});
await replaceDataTable(env,'admin_data_store',rows=>({rows:[...rows,{key:'return-packing-v1:fixture-active',payload:{phase:'prepared'}}],result:null}));
context.returnStockTransactionPending=(await state()).return_inventory.allocation_paused;
effects[0]();effects[1]();await flush();assert.equal(JSON.stringify({products:context.products,orders:context.orders}),before,'An active stock journal still pauses both effects');
assert.equal((await request('/api/orders/ordinary',{method:'PUT',body:JSON.stringify({order:context.orders.find((order:any)=>order.id==='ordinary')})})).status,409);
assert.equal((await request('/api/orders/waybill/assign',{method:'POST',body:JSON.stringify({order_id:'ordinary'})})).status,409);
assert.equal((await request('/api/orders/invoices/ensure',{method:'POST',body:JSON.stringify({order_ids:['ordinary'],batch_id:'PACK-BLOCKED',automatic:true})})).status,409);
await replaceDataTable(env,'admin_data_store',rows=>({rows:rows.filter(row=>row.key!=='return-packing-v1:fixture-active'),result:null}));
context.returnStockTransactionPending=(await state()).return_inventory.allocation_paused;
effects[0]();await flush();
const byId=(id:string)=>context.orders.find((order:any)=>order.id===id);
assert.equal(byId('first').stock_allocated,true);assert.equal(byId('second').stock_allocated,false,'FIFO never over-allocates returned stock');
assert.equal(byId('ordinary').stock_allocated,true,'Unrelated available stock resumes without a manual return packing click');
assert.equal(byId('blue').stock_allocated,false,'Red stock cannot satisfy a Blue order');assert.equal(byId('combo').stock_allocated,true);
assert.equal(byId('unconfirmed').stock_allocated,false);assert.equal(byId('cancelled').stock_allocated,false);
assert.equal(context.products.find((p:any)=>p.id==='returned-stock').stock_quantity,1);
assert.equal(context.products.find((p:any)=>p.id==='a').stock_quantity,0);assert.equal(context.products.find((p:any)=>p.id==='b').stock_quantity,0);
assert.equal(context.products.find((p:any)=>p.id==='colour').variants[1].stock_quantity,5);
const latest=await state();await checked('/api/admin/storefront/state',{method:'PUT',body:JSON.stringify({...latest,products:context.products,expected_version:latest.version})});
effects[0]();await flush();effects[1]();await flush();
for(const id of ['first','ordinary','combo']){assert.ok(invoiceComplete(byId(id)),id+' has a durable invoice');assert.ok(byId(id).waybill_number);assert.equal(byId(id).invoice_pack_downloaded_at,undefined);assert.equal(byId(id).fardar_csv_exported_at,undefined);}
assert.equal(new Set(['first','ordinary','combo'].map(id=>byId(id).invoice_pack_batch_id)).size,1,'Orders released together use one restock packing batch');
const shipped=await savedOrders();assert.equal(JSON.stringify(shipped.find(order=>order.id==='printed')),JSON.stringify(printed),'Existing invoice, waybill and download metadata stay intact');
const stableProducts=JSON.stringify(context.products),stableOrders=JSON.stringify(context.orders),stableHistory=history.length;
effects[0]();effects[1]();await flush();assert.equal(JSON.stringify(context.products),stableProducts);assert.equal(JSON.stringify(context.orders),stableOrders);assert.equal(history.length,stableHistory,'Repeat renders cannot deduct stock or generate invoices twice');
assert.ok((await state()).return_inventory.packing_pending,'The old pending flag may remain set without blocking normal fulfillment');
console.log('PASS: real return receipt → production FIFO → server stock save → unique waybills → durable automatic invoices; exact variants, combos, shortage, one batch, transaction locks, retry deduplication and existing invoice preservation.');
