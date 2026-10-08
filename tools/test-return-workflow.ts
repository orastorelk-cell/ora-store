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
import { RETURN_SCAN_PREFIX, returnScanDate, returnScanHistory } from '../src/lib/returnScanHistory';

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

// Packing mistakes must credit and correct the physical item, while preserving
// the expected order and legacy receipts from before actual identities existed.
const extraOrders=[returned('mixed','WB-MIXED',5),returned('settle','WB-SETTLE',2),{
  ...returned('wrong-colour','WB-WRONG-COLOUR',2,'variant'),items:[{product_id:'variant',variant_id:'blue',sku:'BLUE',product_name:'Colour item',variant_name:'Blue',quantity:2}],
}];
await replaceDataTable(env,'order_snapshots',rows=>({rows:[...rows,...extraOrders.map(value=>({order_id:value.id,order_number:value.order_number,payload:value}))],result:null}));
const sendActual=async(wb:string,good:number,damaged:number,productId:string,variantId?:string,photos:string[]=[])=>{
  const sheet=await get(wb),parcel=sheet.parcels.find((value:any)=>value.waybill===wb);
  const body={operation_id:crypto.randomUUID(),expected_revision:parcel.revision,waybill:wb,items:[{id:parcel.items[0].id,good_qty:good,damaged_qty:damaged,not_received:false,received_product_id:productId,...(variantId?{received_variant_id:variantId}:{}),photo_ids:photos}],notes:'Packing mistake fixture'};
  return {body,response:await call('/api/returns/parcels/'+wb+'/receive','POST',body,'receiver')};
};
await scan('WB-MIXED');await receive('WB-MIXED',2);
await replaceDataTable(env,'admin_data_store',rows=>({rows:rows.map(row=>row.key==='return-unlisted-v1:WB-MIXED'?{...row,payload:{...row.payload,parcels:row.payload.parcels.map((parcel:any)=>({...parcel,items:parcel.items.map(({received_items,...item}:any)=>item)}))}}:row),result:null}));
const originalMixed=await order('mixed'),matBefore=(await product()).stock_quantity,aBefore=(await product('a')).stock_quantity;
const mixedPhoto=crypto.randomUUID();assert.equal((await call('/api/returns/photos','POST',{upload_id:mixedPhoto,waybill:'WB-MIXED',item_id:'mat::',data_url:image},'receiver')).status,200);
for(const [pid,vid,status] of [['missing-product',undefined,409],['bundle',undefined,409],['variant',undefined,409],['variant','missing-colour',409]] as const){const invalid=await sendActual('WB-MIXED',2,1,pid,vid);assert.equal(invalid.response.status,status,JSON.stringify(invalid.response));}
assert.equal((await product()).stock_quantity,matBefore);assert.equal((await product('a')).stock_quantity,aBefore);
const mismatch=await sendActual('WB-MIXED',2,1,'a',undefined,[mixedPhoto]);assert.equal(mismatch.response.status,200,JSON.stringify(mismatch.response));
assert.equal((await product()).stock_quantity,matBefore,'Wrong item never credits the expected product');assert.equal((await product('a')).stock_quantity,aBefore+2,'Only actual good units are credited');
const mixedItem=mismatch.response.body.sheet.parcels[0].items[0];assert.deepEqual(mixedItem.received_items.map((value:any)=>[value.product_id,value.good_qty,value.damaged_qty]),[['mat',2,0],['a',2,1]]);
assert.equal(mixedItem.received_items[1].damage_photo_ids[0],mixedPhoto);assert.equal(mismatch.response.body.summary.wrong_item_qty,3);assert.equal(mismatch.response.body.receipt.stock_history[0].product_id,'a');
assert.equal(mismatch.response.body.summary.all_received,true);assert.equal((await order('mixed')).return_status,'Issue Found');assert.equal((await order('mixed')).return_wrong_item_qty,3);assert.equal((await order('mixed')).return_state,'Received');
assert.deepEqual((await order('mixed')).items,originalMixed.items);assert.equal((await order('mixed')).invoice_number,originalMixed.invoice_number);
assert.equal((await call('/api/returns/parcels/WB-MIXED/receive','POST',mismatch.body,'receiver')).body.unchanged,true);assert.equal((await product('a')).stock_quantity,aBefore+2);
const changedRetry={...mismatch.body,items:mismatch.body.items.map(value=>({...value,received_product_id:'b'}))};assert.equal((await call('/api/returns/parcels/WB-MIXED/receive','POST',changedRetry,'receiver')).status,409);
const mixedRecord=(await call('/api/admin/storefront/state')).body.state.return_inventory.returnRecords.find((value:any)=>value.waybill_number==='WB-MIXED');assert.equal(mixedRecord.items[0].product_id,'mat');assert.equal(mixedRecord.items[0].received_items[1].product_id,'a');assert.ok(mixedRecord.wrong_item_note.includes(mixedItem.received_items[1].name));
const photoOnly=crypto.randomUUID();assert.equal((await call('/api/returns/photos','POST',{upload_id:photoOnly,waybill:'WB-MIXED',item_id:'mat::',data_url:image},'receiver')).status,200);
await receive('WB-MIXED',0,0,[photoOnly]);assert.ok((await get('WB-MIXED')).parcels[0].items[0].received_items[1].damage_photo_ids.includes(photoOnly));
await replaceDataTable(env,'admin_data_store',rows=>({rows:rows.map(row=>row.key==='storefront-state-v1'?{...row,payload:{...row.payload,products:row.payload.products.map((value:any)=>value.id==='a'?{...value,stock_quantity:0}:value)}}:row),result:null}));
const correctionInput={operation_id:crypto.randomUUID(),expected_revision:(await get('WB-MIXED')).parcels[0].revision,items:[{id:'mat::',quantity:2,received_product_id:'a',photo_ids:[mixedPhoto]}],notes:'Actual wrong item later found damaged'};
const corrected=await call('/api/returns/parcels/WB-MIXED/correct','POST',correctionInput,'receiver');assert.equal(corrected.status,200,JSON.stringify(corrected));assert.equal((await product('a')).return_stock_debt,2);assert.equal((await product()).stock_quantity,matBefore);
assert.equal(corrected.body.sheet.parcels[0].items[0].received_items[1].good_qty,0);assert.equal(corrected.body.sheet.parcels[0].items[0].received_items[1].damaged_qty,3);
assert.equal((await call('/api/returns/parcels/WB-MIXED/correct','POST',correctionInput,'receiver')).body.unchanged,true);assert.equal((await product('a')).return_stock_debt,2);
await scan('WB-SETTLE');assert.equal((await sendActual('WB-SETTLE',2,0,'a')).response.status,200);assert.equal((await product('a')).return_stock_debt,0);assert.equal((await product('a')).stock_quantity,0);
const beforeLink=JSON.stringify((await state()).products),wrongLinked=await call('/api/returns/sheets','POST',{filename:'780.csv',csv:csv(['WB-MIXED','WB-SETTLE'])});assert.equal(wrongLinked.status,200,JSON.stringify(wrongLinked));assert.equal(JSON.stringify((await state()).products),beforeLink);assert.equal(wrongLinked.body.summary.wrong_item_qty,5);assert.equal(wrongLinked.body.sheet.parcels[0].items[0].received_items[1].damage_photo_ids[0],mixedPhoto);
assert.equal((await call('/api/returns/parcels/WB-MIXED/receive','POST',mismatch.body,'receiver')).body.unchanged,true,'Wrong-item retries survive late CSV linking');
await scan('WB-WRONG-COLOUR');const colourBefore=await product('variant');const wrongColour=await sendActual('WB-WRONG-COLOUR',1,1,'variant','red');assert.equal(wrongColour.response.status,200,JSON.stringify(wrongColour.response));
const colourAfter=await product('variant');assert.equal(colourAfter.variants[0].stock_quantity,colourBefore.variants[0].stock_quantity);assert.equal(colourAfter.variants[1].stock_quantity,colourBefore.variants[1].stock_quantity+1);assert.equal(colourAfter.stock_quantity,colourBefore.stock_quantity+1);
const colourCorrection={operation_id:crypto.randomUUID(),expected_revision:wrongColour.response.body.sheet.parcels[0].revision,items:[{id:'variant::blue',quantity:1,received_product_id:'variant',received_variant_id:'red',photo_ids:[]}],notes:''};assert.equal((await call('/api/returns/parcels/WB-WRONG-COLOUR/correct','POST',colourCorrection,'receiver')).status,200);assert.equal((await product('variant')).stock_quantity,colourBefore.stock_quantity);
assert.equal((await order('wrong-colour')).items[0].variant_id,'blue');assert.equal((await order('wrong-colour')).invoice_number,'INV-wrong-colour');
console.log('PASS: actual wrong-item/colour stock credits, legacy mixed receipts, private photos and photo-only saves, exact-item damage corrections and deferred balances, mismatch reporting, retry and late-CSV durability, and unchanged order/invoice identities.');
console.log('PASS: unlisted receipts, late CSV linking without duplicate stock, private damage photos, received/pending filters, corrections and deferred balance, actual single/bulk purchasing, manual FIFO/variant/bundle packing, journal retries/concurrency, common invoice/CSV batch and preserved prior invoices.');

// Scan history must be usable while a receiver holds a pre-deployment popup.
// Its read requests and other staff rescans cannot invalidate that draft.
assert.equal((await call('/api/returns/scans','GET',undefined,'other')).status,403);
assert.equal((await call('/api/returns/scans','GET',undefined,'viewer')).status,200);
assert.equal((await call('/api/returns/scans?date=2026-02-30')).status,400);
assert.equal((await call('/api/returns/scan','POST',{waybill:'WB-EXTRA',scan_id:'bad'},'receiver')).status,400);
const savedLegacy=JSON.stringify((await get('WB-EXTRA')).parcels[0]);
await replaceDataTable(env,'admin_data_store',rows=>({rows:rows.filter(row=>!(String(row.key).startsWith(RETURN_SCAN_PREFIX)&&row.payload.waybill==='WB-EXTRA')),result:null}));
const legacyHistory=await call('/api/returns/scans?search=wb-extra');assert.equal(legacyHistory.body.total,1);
assert.equal(legacyHistory.body.scans[0].id,'legacy:WB-EXTRA');assert.equal(legacyHistory.body.scans[0].sheet_id,'777');
assert.equal(JSON.stringify((await get('WB-EXTRA')).parcels[0]),savedLegacy,'Reading existing first scans requires no parcel migration');
await replaceDataTable(env,'order_snapshots',rows=>({rows:[...rows,{order_id:'history-active',order_number:'FIXTURE-history-active',payload:returned('history-active','WB-HISTORY-ACTIVE',2)}],result:null}));
const activeScan=await scan('WB-HISTORY-ACTIVE'),draft=structuredClone(activeScan.sheet.parcels[0]);
assert.equal((await call('/api/returns/scans?search=HISTORY-ACTIVE')).body.total,1,'First scan appears once, without a duplicate legacy row');
const beforeRescan=await readDataTable(env,'admin_data_store'),nonScanRows=JSON.stringify(beforeRescan.filter(row=>!String(row.key).startsWith(RETURN_SCAN_PREFIX))),activeOrder=JSON.stringify(await order('history-active'));
const rescanId=crypto.randomUUID(),rescanBody={waybill:'WB-HISTORY-ACTIVE',scan_id:rescanId};
const rescanned=await call('/api/returns/scan','POST',rescanBody,'receiver');assert.equal(rescanned.status,200);assert.deepEqual(rescanned.body.sheet.parcels[0],draft);
assert.equal(JSON.stringify((await readDataTable(env,'admin_data_store')).filter(row=>!String(row.key).startsWith(RETURN_SCAN_PREFIX))),nonScanRows,'Rescanning touches no receipt, parcel, catalog or packing rows');
assert.equal(JSON.stringify(await order('history-active')),activeOrder,'Rescanning preserves current invoice and order metadata');
const latest=await call('/api/returns/scans');assert.equal(latest.body.scans[0].id,rescanId);assert.equal(latest.body.scans[0].waybill,'WB-HISTORY-ACTIVE');
const unchangedRevision=raw.revision;await call('/api/returns/scans?search=wb-history-active&date='+returnScanDate(latest.body.scans[0].scanned_at));
assert.equal(raw.revision,unchangedRevision,'History search/date refresh is strictly read-only');
await call('/api/returns/scan','POST',rescanBody,'receiver');assert.equal((await call('/api/returns/scans?search=HISTORY-ACTIVE')).body.total,2,'Retrying one scan ID cannot duplicate history');
assert.equal((await call('/api/returns/scan','POST',{...rescanBody,waybill:'WB-EXTRA'},'receiver')).status,409);
const stockBeforeDraft=(await product()).stock_quantity;
const oldClientReceipt=await call('/api/returns/parcels/WB-HISTORY-ACTIVE/receive','POST',{operation_id:crypto.randomUUID(),expected_revision:draft.revision,waybill:draft.waybill,items:[{id:draft.items[0].id,good_qty:1,damaged_qty:0,not_received:false,photo_ids:[]}],notes:'Already-open receiver popup'},'receiver');
assert.equal(oldClientReceipt.status,200,JSON.stringify(oldClientReceipt));assert.equal((await product()).stock_quantity,stockBeforeDraft+1,'Already-open receiver saves stock exactly once after a rescan');
const historyAfterReceipt=JSON.stringify((await get('WB-HISTORY-ACTIVE')).parcels[0]);
const concurrentScanIds=[crypto.randomUUID(),crypto.randomUUID()];const scanResults=await Promise.all(concurrentScanIds.map(scan_id=>call('/api/returns/scan','POST',{waybill:'WB-HISTORY-ACTIVE',scan_id},'receiver')));
assert.ok(scanResults.every(result=>result.status===200),JSON.stringify(scanResults));
assert.equal((await call('/api/returns/scans?search=HISTORY-ACTIVE')).body.total,4,'Concurrent staff scans both survive the atomic journal save');
assert.equal(JSON.stringify((await get('WB-HISTORY-ACTIVE')).parcels[0]),historyAfterReceipt);
const lostScanId=crypto.randomUUID();let lostScanAck=false;
const lostScanStorage={...native,changeAdmin:async(change:any)=>{const result=await native.changeAdmin(change);if(!lostScanAck){lostScanAck=true;throw new Error('Synthetic scan acknowledgment lost');}return result;}};
await assert.rejects(()=>returnSheetsHandler(new Request('https://fixture/api/returns/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({waybill:'WB-HISTORY-ACTIVE',scan_id:lostScanId})}),lostScanStorage,{id:'receiver',role:'staff',permissions:['returns']}),/Synthetic scan acknowledgment lost/);
assert.equal((await call('/api/returns/scan','POST',{waybill:'WB-HISTORY-ACTIVE',scan_id:lostScanId},'receiver')).status,200);
assert.equal((await call('/api/returns/scans?search=HISTORY-ACTIVE')).body.total,5);
const linkedHistory=await call('/api/returns/sheets','POST',{filename:'781.csv',csv:csv(['WB-HISTORY-ACTIVE'])});assert.equal(linkedHistory.status,200);
const linkedScans=(await call('/api/returns/scans?search=HISTORY-ACTIVE')).body;assert.equal(linkedScans.total,5);assert.ok(linkedScans.scans.every((scan:any)=>scan.sheet_id==='781'),'Late CSV linking updates labels without duplicating or losing scan events');

// Midnight is the staff's calendar date (UTC+05:30), including older history.
await replaceDataTable(env,'admin_data_store',rows=>({rows:[...rows,
  {key:RETURN_SCAN_PREFIX+'midnight-before-fixture',payload:{waybill:'WB-TZ-BEFORE',scanned_at:'2026-10-07T18:29:59.000Z',scanned_by:'Fixture'}},
  {key:RETURN_SCAN_PREFIX+'midnight-after-fixture',payload:{waybill:'WB-TZ-AFTER',scanned_at:'2026-10-07T18:30:00.000Z',scanned_by:'Fixture'}},
  ...Array.from({length:105},(_,index)=>({key:RETURN_SCAN_PREFIX+'page-fixture-'+index,payload:{waybill:'WB-PAGE-'+index,scanned_at:'2026-10-06T12:00:00.000Z',scanned_by:'Fixture',sequence:index+1}})),
],result:null}));
assert.deepEqual((await call('/api/returns/scans?search=WB-TZ&date=2026-10-07')).body.scans.map((scan:any)=>scan.waybill),['WB-TZ-BEFORE']);
assert.deepEqual((await call('/api/returns/scans?search=WB-TZ&date=2026-10-08')).body.scans.map((scan:any)=>scan.waybill),['WB-TZ-AFTER']);
const firstPage=(await call('/api/returns/scans?search=WB-PAGE')).body;assert.equal(firstPage.total,105);assert.equal(firstPage.scans.length,50);assert.equal(firstPage.scans[0].waybill,'WB-PAGE-104','Equal timestamps retain last-scan-first sequence');
await replaceDataTable(env,'admin_data_store',rows=>({rows:[...rows,{key:RETURN_SCAN_PREFIX+'page-fixture-new',payload:{waybill:'WB-PAGE-NEW',scanned_at:'2026-10-06T13:00:00.000Z',scanned_by:'Fixture',sequence:106}}],result:null}));
const secondPage=(await call('/api/returns/scans?search=WB-PAGE&before='+firstPage.scans.at(-1).id)).body;
const thirdPage=(await call('/api/returns/scans?search=WB-PAGE&before='+secondPage.scans.at(-1).id)).body;
assert.equal(new Set([...firstPage.scans,...secondPage.scans,...thirdPage.scans].map(scan=>scan.id)).size,105,'New scans between page loads cannot skip or duplicate older rows');
assert.equal((await call('/api/returns/scans?search=WB-PAGE&before=missing')).status,400);
assert.equal((await call('/api/returns/scans?search=missing-waybill')).body.total,0);
assert.equal(returnScanHistory(await readDataTable(env,'admin_data_store')).filter(scan=>scan.waybill==='WB-EXTRA').length,1);
console.log('PASS: shared newest-first scan history, existing first-scan fallback, repeat/concurrent scans, retry deduplication, Sri Lanka date filters, cursor pagination during new scans, read-only polling and already-open receipt compatibility.');
