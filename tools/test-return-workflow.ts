import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { loadConfigFromFile } from 'vite';
import { importRecovery, dataBucket, activeData, configureCloudflareData, readDataTable, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { creditReturnStock, returnOrderFilter } from '../src/lib/returnSheets';
import { returnSheetsHandler, r2ReturnStorage } from '../worker/r2ReturnSheets';
import { returnPackingCsv } from '../src/lib/returnExports';

class MemoryBucket {
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>(); revision=0;failKey='';failMode='';
  async get(key:string){const value=this.objects.get(key);await Promise.resolve();return value?{text:async()=>value.value,etag:value.etag,customMetadata:value.customMetadata}:null;}
  async put(key:string,value:string,options:any={}){const current=this.objects.get(key);if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==current?.etag)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&current)return null;
    const fail=key===this.failKey,mode=this.failMode;if(fail){this.failKey='';if(mode==='before')throw new Error('Synthetic write failure before save');}
    const saved={value,etag:String(++this.revision),customMetadata:options.customMetadata};this.objects.set(key,saved);if(fail&&mode==='after')throw new Error('Synthetic acknowledgement lost');return {etag:saved.etag};}
}
const raw=new MemoryBucket(),env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:'workflow-fixture',SUPABASE_SECRET_KEY:'synthetic-service',ORA_R2_COMPRESSION_ENABLED:'1',VITE_SUPABASE_URL:'https://workflow-fixture.supabase.co'};
configureCloudflareData(env);
const returned=(id:string,wb:string,qty=5,product='mat')=>({id,order_number:'FIXTURE-'+id,waybill_number:wb,stock_allocated:true,stock_status:'Allocated',order_status:'Shipped',dispatch_status:'Handed Over',call_center_status:'Confirmed',invoice_locked:true,invoice_number:'INV-'+id,invoice_generated_at:'2026-10-01T00:00:00Z',invoice_pack_batch_id:'PACK-OLD',items:[{product_id:product,sku:product.toUpperCase(),product_name:'Fixture item '+product,quantity:qty}]});
const waiting=(id:string,items:any[],extra={})=>({id,order_number:'FIXTURE-'+id,created_at:'2026-10-02T00:00:00Z',customer_name:'Synthetic fixture',phone:'0770000000',whatsapp:'',address:'Fixture address',city:'Fixture city',fardar_city:'Fixture city',courier_name:'Fardar',call_center_status:'Confirmed',order_status:'Processing',stock_allocated:false,stock_status:'Pending',payment_method:'COD',total_amount:1000,items:items.map(item=>({sku:'FIXTURE',product_name:'Fixture item',unit_price:500,subtotal:500,quantity:1,...item})),...extra});
const orders=[returned('unlisted','WB-EXTRA'),returned('balance','WB-BALANCE',2),returned('future','WB-FUTURE',2),
  waiting('first',[{product_id:'mat',quantity:4}],{payment_paid_type:'Advance',payment_received_amount:500}),
  waiting('bundle',[{product_id:'bundle',product_type:'bundle',bundle_components:[{product_id:'a',quantity_per_bundle:2,sku:'A',product_name:'A'},{product_id:'b',quantity_per_bundle:1,sku:'B',product_name:'B'}]}]),
  waiting('variant',[{product_id:'variant',variant_id:'blue',quantity:2}]),
  waiting('allocated',[{product_id:'mat'}],{waybill_number:'WB-READY',stock_allocated:true,stock_status:'Allocated',payment_method:'Bank Payment',payment_status:'Paid',payment_paid_type:'Full'}),
  waiting('printed',[{product_id:'mat'}],{waybill_number:'WB-PRINTED',stock_allocated:true,stock_status:'Allocated',invoice_locked:true,invoice_number:'INV-KEEP',invoice_generated_at:'2026-10-01T00:00:00Z',invoice_pack_batch_id:'PACK-KEEP'})];
await importRecovery(dataBucket(env)!,{format:'ora-r2-recovery-v1',orders,admin_users:[{id:'admin',role:'admin',display_name:'Uploader',is_active:true},{id:'receiver',role:'staff',display_name:'Receiver fixture',permissions:['returns'],is_active:true},{id:'viewer',role:'staff',permissions:['returns','level:returns:view'],is_active:true},{id:'other',role:'staff',permissions:['orders'],is_active:true}],admin_data_store:[{key:'storefront-state-v1',payload:{version:1,updated_at:'2026-10-01T00:00:00Z',categories:[],settings:{fardar_parcel_type:'Parcel'},products:[{id:'mat',sku:'MAT',name_en:'Mat',stock_quantity:1},{id:'a',sku:'A',stock_quantity:2},{id:'b',sku:'B',stock_quantity:1},{id:'bundle',sku:'BUNDLE',product_type:'bundle',stock_quantity:0},{id:'variant',sku:'VAR',product_type:'variant',stock_quantity:5,variants:[{id:'blue',sku:'BLUE',option_value:'Blue',stock_quantity:0},{id:'red',sku:'RED',option_value:'Red',stock_quantity:5}]}]}}],courier_waybills:[...orders.filter(order=>order.waybill_number).map(order=>({waybill_number:order.waybill_number,status:'Assigned',courier_name:'Fardar',assigned_order_id:order.id,assigned_order_number:order.order_number})),...Array.from({length:5},(_,i)=>({waybill_number:'WB-NEW-'+i,status:'Available',courier_name:'Fardar',imported_at:'2026-10-01T00:00:00Z'}))],tables:{}});
const active=(await activeData(dataBucket(env)!))!,adminKey=active.prefix+'admin_data_store.json',orderKey=active.prefix+'order_snapshots.json';
const token=(id:string)=>{const payload=Buffer.from(JSON.stringify({sub:id,exp:Date.now()+3600000})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update(payload).digest('base64url');};
const request=async(path:string,method='GET',body?:any,staff='admin')=>withR2DataFallback(new Request('https://fixture'+path,{method,headers:{authorization:'Bearer '+token(staff),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{},async()=>new Response('Unexpected Node bridge',{status:599}));
const call=async(path:string,method='GET',body?:any,staff='admin')=>{const response=await request(path,method,body,staff);return {status:response.status,body:await response.json() as any};};
const state=async()=>(await readDataTable(env,'admin_data_store')).find(row=>row.key==='storefront-state-v1')!.payload;
const product=async(id='mat')=>(await state()).products.find((p:any)=>p.id===id);
const order=async(id:string)=>(await readDataTable(env,'order_snapshots')).find(row=>row.order_id===id)!.payload;
const get=async(wb:string)=>(await call('/api/returns/parcels/'+wb)).body.sheet;
const scan=async(wb:string)=>{const response=await call('/api/returns/scan','POST',{waybill:wb},'receiver');assert.equal(response.status,200,JSON.stringify(response.body));return response.body;};
const receive=async(wb:string,good:number,damaged=0,photo_ids:string[]=[])=>{const sheet=await get(wb),parcel=sheet.parcels.find((p:any)=>p.waybill===wb);const response=await call('/api/returns/parcels/'+wb+'/receive','POST',{operation_id:crypto.randomUUID(),expected_revision:parcel.revision,waybill:wb,items:parcel.items.map((item:any)=>({id:item.id,good_qty:good,damaged_qty:damaged,not_received:good+damaged===0,photo_ids})),notes:''},'receiver');assert.equal(response.status,200,JSON.stringify(response.body));return response.body;};
const correct=async(wb:string,quantity:number,photo_ids:string[]=[])=>{const sheet=await get(wb),parcel=sheet.parcels.find((p:any)=>p.waybill===wb);const input={operation_id:crypto.randomUUID(),expected_revision:parcel.revision,items:[{id:parcel.items[0].id,quantity,photo_ids}],notes:'Damage fixture'};const response=await call('/api/returns/parcels/'+wb+'/correct','POST',input,'receiver');assert.equal(response.status,200,JSON.stringify(response.body));return {input,response};};
const csv=(wbs:string[])=>'Waybill ID,Order ID,Returned Date,Reason\n'+wbs.map(wb=>[wb,wb,'2026-10-06','Fixture'].join(',')).join('\n');

assert.equal(returnOrderFilter({return_sheet_id:'old',return_status:'Issue Found'},'Return Received',{items:[{expected_qty:5,good_qty:4,damaged_qty:1,missing_qty:0}]} as any),true);
assert.equal(returnOrderFilter({return_sheet_id:'old',return_status:'Issue Found'},'Return Pending',{items:[{expected_qty:5,good_qty:4,damaged_qty:0,missing_qty:1}]} as any),true);
const opened=await scan('WB-EXTRA');assert.equal(opened.unlisted,true);assert.equal(opened.sheet.id,'');assert.equal((await call('/api/returns/sheets')).body.total,0);assert.equal((await order('unlisted')).return_sheet_id,undefined);
const partial=await receive('WB-EXTRA',4);assert.equal((await product()).stock_quantity,5);assert.equal(returnOrderFilter(await order('unlisted'),'Return Pending'),true);assert.equal(returnOrderFilter(await order('unlisted'),'Return Received'),false);
const photoId=crypto.randomUUID(),image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
assert.equal((await call('/api/returns/photos','POST',{upload_id:photoId,waybill:'WB-EXTRA',item_id:'mat::',data_url:image},'viewer')).status,403);
assert.equal((await call('/api/returns/photos','POST',{upload_id:photoId,waybill:'WB-EXTRA',item_id:'mat::',data_url:image},'receiver')).status,200);
assert.equal((await request('/api/returns/photos/'+photoId,'GET',undefined,'other')).status,403);
const evidence=await request('/api/returns/photos/'+photoId,'GET',undefined,'receiver');assert.equal(evidence.status,200);assert.equal(evidence.headers.get('cache-control'),'private, no-store');assert.equal(evidence.headers.get('content-type'),'image/png');assert.ok((await evidence.arrayBuffer()).byteLength>10);
const firstCorrection=await correct('WB-EXTRA',1,[photoId]);assert.equal((await product()).stock_quantity,4);assert.equal((await call('/api/returns/parcels/WB-EXTRA/correct','POST',firstCorrection.input,'receiver')).body.unchanged,true);assert.equal((await product()).stock_quantity,4);
assert.equal((await order('unlisted')).invoice_number,'INV-unlisted');
await replaceDataTable(env,'admin_data_store',rows=>({rows:rows.map(row=>row.key==='storefront-state-v1'?{...row,payload:{...row.payload,products:row.payload.products.map((p:any)=>p.id==='mat'?{...p,stock_quantity:0}:p)}}:row),result:null}));
await correct('WB-EXTRA',3);assert.equal((await product()).return_stock_debt,3);assert.equal((await product()).stock_quantity,0);
await receive('WB-EXTRA',1);assert.equal((await product()).return_stock_debt,2);assert.equal((await product()).stock_quantity,0);assert.equal(returnOrderFilter(await order('unlisted'),'Return Received'),true);assert.equal((await order('unlisted')).return_state,'Received');
await scan('WB-BALANCE');const balanced=await receive('WB-BALANCE',2);assert.equal(balanced.receipt.balance_qty,2);assert.equal((await product()).return_stock_debt,0);assert.equal((await product()).stock_quantity,0);
const historyBefore=(await call('/api/admin/storefront/state')).body.state.return_inventory.stockHistory.map((row:any)=>row.id).sort();
const linked=await call('/api/returns/sheets','POST',{filename:'777.csv',csv:csv(['WB-EXTRA','WB-BALANCE'])});assert.equal(linked.status,200,JSON.stringify(linked.body));assert.equal(linked.body.summary.all_received,true);assert.equal((await order('unlisted')).return_sheet_id,'777');assert.equal(linked.body.sheet.parcels[0].items[0].damage_photo_ids[0],photoId);assert.equal((await product()).stock_quantity,0);
assert.deepEqual((await call('/api/admin/storefront/state')).body.state.return_inventory.stockHistory.map((row:any)=>row.id).sort(),historyBefore);
assert.equal((await call('/api/returns/unlisted')).body.parcels.length,0);assert.equal((await call('/api/returns/sheets?status=complete')).body.total,1);assert.equal((await call('/api/returns/sheets?status=pending')).body.total,0);
assert.equal((await call('/api/returns/parcels/WB-EXTRA/receive','POST',{operation_id:partial.receipt.operation_id,expected_revision:0,waybill:'WB-EXTRA',items:[{id:'mat::',good_qty:4,damaged_qty:0,not_received:false,photo_ids:[]}],notes:''},'receiver')).body.unchanged,true,'Receipt retries survive later CSV linking');
assert.equal((await call('/api/returns/scan','POST',{waybill:'WB-UNKNOWN'},'receiver')).body.sheet.parcels[0].review_reason,'Waybill not found in system orders.');
assert.equal((await call('/api/storefront/state')).body.state.return_inventory,undefined);
assert.equal((await call('/api/orders/invoices/ensure','POST',{order_ids:['allocated'],batch_id:'PACK-AUTO-FIXTURE',automatic:true})).status,409,'Returns do not automatically invoice');
assert.equal((await call('/api/orders/first','PUT',{order:{...orders[3],stock_allocated:true,stock_status:'Allocated'}})).status,409,'Old browser cannot allocate before manual packing');
assert.deepEqual(creditReturnStock({stock_quantity:0,return_stock_debt:2},1),{stock_quantity:0,return_stock_debt:1,balance_qty:1});
assert.deepEqual(creditReturnStock({stock_quantity:0,return_stock_debt:1},3),{stock_quantity:2,return_stock_debt:0,balance_qty:1});

// Exercise the actual production purchase functions, including the injected bulk
// purchase implementation, so debt is settled once for exact variants too.
const config=(await loadConfigFromFile({command:'build',mode:'production'}))!.config as any;
let source=fs.readFileSync('src/context/StoreContext.tsx','utf8');for(const plugin of config.plugins.flat(Infinity))if(plugin?.name?.startsWith('ora-')&&typeof plugin.transform==='function'){const result=await plugin.transform(source,process.cwd()+'/src/context/StoreContext.tsx');if(result)source=typeof result==='string'?result:result.code;}
assert.ok(source.includes('if(returnPackingPending)return;'));assert.ok(source.includes('invoiceQueueRetry,returnPackingPending]'));
const single=source.slice(source.indexOf('  const addPurchaseOrder='),source.indexOf('  const addPurchaseOrdersBatch='));
const bulk=source.slice(source.indexOf('  const addPurchaseOrdersBatch='),source.indexOf('  // Category CRUD\n  const addCategory =',source.indexOf('  const addPurchaseOrdersBatch=')));
let fixtureProducts:any[]=[{id:'v',product_type:'variant',name_en:'Variant',sku:'V',stock_quantity:7,variants:[{id:'blue',stock_quantity:0,return_stock_debt:2,option_value:'Blue'},{id:'red',stock_quantity:7,return_stock_debt:0,option_value:'Red'}]}];
const context:any={creditReturnStock,Date,Math,products:fixtureProducts,purchaseOrders:[],stockHistory:[],adminUser:{name:'Fixture'},normalizedProductType:(p:any)=>p.product_type||'normal',variantById:(p:any,id:string)=>p.variants?.find((v:any)=>v.id===id),cloneInventoryProducts:structuredClone,logActivity:()=>{},setProducts:(update:any)=>{fixtureProducts=typeof update==='function'?update(fixtureProducts):update;context.products=fixtureProducts;},setPurchaseOrders:()=>{},setStockHistory:()=>{},localStorage:{setItem:()=>{}}};
const purchaseCode=transformSync(single+'\n'+bulk+'\n globalThis.fixturePurchase=addPurchaseOrder;globalThis.fixtureBulk=addPurchaseOrdersBatch;',{loader:'ts'}).code;
vm.runInNewContext(purchaseCode,context);context.fixturePurchase({supplier_name:'Fixture',product_id:'v',variant_id:'blue',quantity_added:1,unit_buying_price:1});assert.equal(fixtureProducts[0].variants[0].return_stock_debt,1);assert.equal(fixtureProducts[0].variants[0].stock_quantity,0);
context.fixtureBulk([{supplier_name:'Fixture',product_id:'v',variant_id:'blue',quantity_added:3,unit_buying_price:1}]);assert.equal(fixtureProducts[0].variants[0].return_stock_debt,0);assert.equal(fixtureProducts[0].variants[0].stock_quantity,2);assert.equal(fixtureProducts[0].variants[1].stock_quantity,7);

await replaceDataTable(env,'admin_data_store',rows=>({rows:rows.map(row=>row.key==='storefront-state-v1'?{...row,payload:{...row.payload,products:row.payload.products.map((p:any)=>p.id==='mat'?{...p,stock_quantity:4}:p)}}:row),result:null}));
const originalPrinted=JSON.stringify(await order('printed')),operation=crypto.randomUUID();raw.failKey=orderKey;raw.failMode='before';
const interrupted=await call('/api/returns/packing','POST',{operation_id:operation},'receiver');assert.equal(interrupted.status,503,JSON.stringify(interrupted));assert.equal((await product()).stock_quantity,4,'Preparing failed batch has not deducted stock');
assert.equal((await call('/api/admin/storefront/state','PUT',{...await state(),expected_version:(await state()).version})).status,409,'Active journal blocks catalog overwrites');
const packed=await call('/api/returns/packing','POST',{operation_id:operation},'receiver');assert.equal(packed.status,200,JSON.stringify(packed));assert.equal(packed.body.orders.length,3);assert.equal(new Set(packed.body.orders.map((order:any)=>order.invoice_pack_batch_id)).size,1);assert.ok(packed.body.orders.every((order:any)=>order.invoice_locked&&order.invoice_pack_batch_id==='PACK-RETURN-'+operation));
assert.ok(packed.body.orders.every((value:any)=>value.fardar_csv_export_batch_id===packed.body.batch_id&&value.fardar_csv_exported_waybill===value.waybill_number),'Batch creation claims its CSV rows before another export screen can duplicate them');
assert.equal((await product()).stock_quantity,0);assert.equal((await product('a')).stock_quantity,0);assert.equal((await product('b')).stock_quantity,0);assert.equal((await product('variant')).variants[1].stock_quantity,5);assert.equal((await order('variant')).stock_allocated,false);assert.equal(JSON.stringify(await order('printed')),originalPrinted);
const retry=await call('/api/returns/packing','POST',{operation_id:operation},'receiver');assert.deepEqual(retry.body.orders.map((order:any)=>order.waybill_number),packed.body.orders.map((order:any)=>order.waybill_number));assert.equal((await product()).stock_quantity,0);
const courierCsv=returnPackingCsv(packed.body.orders,packed.body.settings);assert.ok(courierCsv.startsWith('\uFEFF'));assert.equal(courierCsv.split('\r\n').length,4);assert.ok(courierCsv.includes(',500,0'));assert.ok(courierCsv.includes(',0,0'));
assert.equal((await call('/api/returns/packing/'+operation+'/downloaded','POST',{},'receiver')).status,200);
for(const value of packed.body.orders){const saved=await order(value.id);assert.equal(saved.fardar_csv_export_batch_id,packed.body.batch_id);assert.equal(saved.fardar_csv_exported_waybill,saved.waybill_number);assert.ok(saved.invoice_pack_downloaded_at);assert.equal(saved.return_packing_lock,undefined);}
assert.equal((await call('/api/returns/packing/'+operation+'/downloaded','POST',{},'receiver')).status,200);
const afterHistory=(await call('/api/admin/storefront/state')).body.state.return_inventory;assert.ok(afterHistory.stockHistory.some((row:any)=>row.id.startsWith('return-stock:packing:')));assert.equal(afterHistory.batches[0].count,3);

await scan('WB-FUTURE');const future=await receive('WB-FUTURE',2);assert.equal((await product()).stock_quantity,2);
await correct('WB-FUTURE',2);assert.equal((await product()).stock_quantity,0);assert.equal(JSON.stringify(await order('printed')),originalPrinted);assert.equal((await order('first')).invoice_pack_batch_id,packed.body.batch_id);
const emptyOp=crypto.randomUUID();const concurrent=await Promise.all([call('/api/returns/packing','POST',{operation_id:emptyOp},'receiver'),call('/api/returns/packing','POST',{operation_id:emptyOp},'receiver')]);assert.ok(concurrent.every(result=>result.status===200),JSON.stringify(concurrent));assert.equal((await product()).stock_quantity,0);

await replaceDataTable(env,'admin_data_store',rows=>({rows:rows.map(row=>row.key==='storefront-state-v1'?{...row,payload:{...row.payload,products:row.payload.products.map((p:any)=>p.id==='variant'?{...p,stock_quantity:7,variants:p.variants.map((v:any)=>v.id==='blue'?{...v,stock_quantity:2}:v)}:p)}}:row),result:null}));
const interruptedOp=crypto.randomUUID(),native=r2ReturnStorage(env);let dropped=false;
const faulty={...native,changeAdmin:async(change:any)=>{const result:any=await native.changeAdmin(change);if(!dropped&&result?.phase==='stock_saved'){dropped=true;throw new Error('Synthetic acknowledgement lost after stock was deducted');}return result;}};
await assert.rejects(()=>returnSheetsHandler(new Request('https://fixture/api/returns/packing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation_id:interruptedOp})}),faulty,{id:'receiver',role:'staff',permissions:['returns']}),/Synthetic acknowledgement lost/);
assert.equal((await product('variant')).variants[0].stock_quantity,0);assert.equal((await order('variant')).stock_allocated,false);
const resumed=await Promise.all([call('/api/returns/packing','POST',{operation_id:interruptedOp},'receiver'),call('/api/returns/packing','POST',{operation_id:interruptedOp},'receiver')]);assert.ok(resumed.every(result=>result.status===200),JSON.stringify(resumed));assert.equal(resumed[0].body.orders.length,1);assert.equal(resumed[0].body.orders[0].id,'variant');assert.equal((await product('variant')).variants[0].stock_quantity,0);assert.equal((await product('variant')).variants[1].stock_quantity,5);assert.equal(JSON.stringify(await order('printed')),originalPrinted);

const unknownBefore=(await get('WB-UNKNOWN')).parcels[0];
await replaceDataTable(env,'order_snapshots',rows=>({rows:[...rows,{order_id:'unknown-later',order_number:'FIXTURE-unknown-later',payload:returned('unknown-later','WB-UNKNOWN',1)}],result:null}));
const resolved=await call('/api/returns/sheets','POST',{filename:'779.csv',csv:csv(['WB-UNKNOWN'])});assert.equal(resolved.status,200,JSON.stringify(resolved));assert.equal(resolved.body.sheet.parcels[0].review_reason,undefined);assert.equal(resolved.body.sheet.parcels[0].items[0].expected_qty,1);assert.equal(resolved.body.sheet.parcels[0].scanned_at,unknownBefore.scanned_at);assert.equal((await product()).stock_quantity,0,'Matching an earlier unknown scan never adds stock');
console.log('PASS: unlisted receipts, late CSV linking without duplicate stock, private damage photos, received/pending filters, corrections and deferred balance, actual single/bulk purchasing, manual FIFO/variant/bundle packing, journal retries/concurrency, common invoice/CSV batch and preserved prior invoices.');
