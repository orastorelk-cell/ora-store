import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { importRecovery, dataBucket, activeData, configureCloudflareData, readDataTable, cloudflareDataFetch } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { parseReturnCsv, physicalReturnItems } from '../src/lib/returnSheets';
import { purchaseHistoryStockDurabilityPatch } from '../src/lib/purchaseHistoryStockDurabilityPatch';

class MemoryBucket {
  objects = new Map<string,{value:string;etag:string;customMetadata:any}>(); revision=0; failKey=''; failMode='';
  async get(key:string) { const value=this.objects.get(key); await Promise.resolve(); return value?{text:async()=>value.value,etag:value.etag,customMetadata:value.customMetadata}:null; }
  async put(key:string,value:string,options:any={}) {
    const current=this.objects.get(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches!==current?.etag) return null;
    if (options.onlyIf?.etagDoesNotMatch==='*' && current) return null;
    const fail=key===this.failKey; const mode=this.failMode;
    if (fail) { this.failKey=''; if (mode==='before') throw new Error('Synthetic write failure before save'); }
    const saved={value,etag:String(++this.revision),customMetadata:options.customMetadata}; this.objects.set(key,saved);
    if (fail && mode==='after') throw new Error('Synthetic acknowledgement lost after durable save');
    return {etag:saved.etag};
  }
}
const raw=new MemoryBucket(), env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:'synthetic-return-secret',SUPABASE_SECRET_KEY:'synthetic-service',ORA_R2_COMPRESSION_ENABLED:'1',VITE_SUPABASE_URL:'https://return-fixture.supabase.co'};
configureCloudflareData(env);
const simple=(id:string,wb:string,qty=5,extra={})=>({id,order_number:'TEST-'+id,waybill_number:wb,courier_name:'Fardar',stock_allocated:true,stock_status:'Allocated',
  order_status:'Shipped',dispatch_status:'Handed Over',invoice_locked:true,invoice_number:'INV-'+id,invoice_generated_at:'2026-10-01T00:00:00Z',
  call_center_status:'Confirmed',items:[{product_id:'mat',sku:'MAT',product_name:'Mat',quantity:qty}],...extra});
const orders=[simple('partial','WB-PARTIAL'),simple('variant','WB-VARIANT',2,{items:[{product_id:'variant',variant_id:'blue',sku:'BLUE',product_name:'Colour item',variant_name:'Blue',quantity:2}]}),
  simple('bundle','WB-BUNDLE',2,{items:[{product_id:'bundle',sku:'BUNDLE',product_name:'Two item bundle',product_type:'bundle',quantity:2,bundle_components:[
    {product_id:'a',sku:'A',product_name:'Component A',quantity_per_bundle:2},{product_id:'b',sku:'B',product_name:'Component B',quantity_per_bundle:1}]}]}),
  simple('unallocated','WB-UNALLOCATED',2,{stock_allocated:false}),simple('legacy','WB-LEGACY',2,{return_status:'Verified',return_received_at:'2026-10-01T00:00:00Z'}),
  simple('old','WB-NEW',2,{waybill_history:[{old_waybill:'WB-OLD',new_waybill:'WB-NEW'}]}),
  simple('fail-before','WB-FAIL-BEFORE'),simple('fail-after','WB-FAIL-AFTER'),simple('fail-order','WB-FAIL-ORDER')];
await importRecovery(dataBucket(env)!,{format:'ora-r2-recovery-v1',orders,
  admin_users:[{id:'admin',role:'admin',display_name:'Uploader',is_active:true},
    {id:'receiver',role:'staff',display_name:'Vinodya fixture',permissions:['returns'],is_active:true},
    {id:'viewer',role:'staff',permissions:['returns','level:returns:view'],is_active:true},
    {id:'special',role:'staff',permissions:['returns','level:returns:view','action:return_process'],is_active:true},
    {id:'other',role:'staff',permissions:['orders'],is_active:true},{id:'disabled',role:'staff',permissions:['returns'],is_active:false}],
  admin_data_store:[{key:'storefront-state-v1',payload:{version:1,updated_at:'2026-10-01T00:00:00Z',categories:[],settings:{},products:[
    {id:'mat',sku:'MAT',name_en:'Mat',stock_quantity:10},{id:'variant',sku:'VARIANT',name_en:'Colour item',product_type:'variant',stock_quantity:7,variants:[{id:'blue',sku:'BLUE',option_value:'Blue',stock_quantity:2},{id:'red',sku:'RED',option_value:'Red',stock_quantity:5}]},
    {id:'a',sku:'A',name_en:'Component A',stock_quantity:0},{id:'b',sku:'B',name_en:'Component B',stock_quantity:0},{id:'bundle',sku:'BUNDLE',product_type:'bundle',stock_quantity:0},
  ]}}],courier_waybills:orders.map(o=>({waybill_number:o.waybill_number,status:'Used',assigned_order_number:o.order_number})),tables:{}});
const active=(await activeData(dataBucket(env)!))!, adminKey=active.prefix+'admin_data_store.json', orderKey=active.prefix+'order_snapshots.json';
const token=(id:string)=>{const payload=Buffer.from(JSON.stringify({sub:id,exp:Date.now()+3600000})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update(payload).digest('base64url');};
const call=async(path:string,method='GET',body?:any,staff='admin')=>{
  const response=await withR2DataFallback(new Request('https://fixture'+path,{method,headers:{authorization:'Bearer '+token(staff),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{},async()=>new Response('Unexpected Node bridge',{status:599}));
  return {status:response.status,body:await response.json() as any};
};
const csv=(waybills:string[])=>'ID,Waybill ID,Order ID,Parcel Type,Weight,Recipient Name,Recipient Address,Recipient Mobile(s),City,Returned Date,Reason\r\n'+waybills.map((wb,i)=>[i+1,wb,wb,'','0.3','Synthetic fixture','"Address, with comma"','','Fixture city','',''].join(',')).join('\r\n');
const stock=async()=>(await readDataTable(env,'admin_data_store')).find(row=>row.key==='storefront-state-v1')!.payload;
const product=async(id:string)=>(await stock()).products.find((p:any)=>p.id===id);
const getSheet=async(id='368000')=>(await call('/api/returns/sheets/'+id)).body.sheet;
const receipt=(sheet:any,wb:string,good:number,operation=crypto.randomUUID(),damaged=0)=>{
  const parcel=sheet.parcels.find((p:any)=>p.waybill===wb);
  return {operation_id:operation,waybill:wb,expected_revision:parcel.revision,items:parcel.items.map((item:any)=>({id:item.id,good_qty:good,damaged_qty:damaged,not_received:good+damaged===0})),notes:''};
};
const receive=(input:any,id='368000',staff='receiver')=>call('/api/returns/sheets/'+id+'/receive','POST',input,staff);
const importInput={filename:'368000.csv',csv:csv(['WB-PARTIAL','WB-VARIANT','WB-BUNDLE','WB-UNALLOCATED','WB-LEGACY','WB-OLD','WB-UNKNOWN'])};
assert.equal(parseReturnCsv('368000 (1).csv','\uFEFF'+importInput.csv).id,'368000');
assert.throws(()=>parseReturnCsv('returns.csv',importInput.csv));
assert.throws(()=>parseReturnCsv('368000.csv',csv(['WB-PARTIAL','WB-PARTIAL'])));
assert.throws(()=>parseReturnCsv('368000.csv','Waybill ID,Order ID\n"unfinished,x'));
const multiline=parseReturnCsv('9.csv','Waybill ID,Order ID,Reason\r\nWB-ONE,WB-ONE,"Line one\nLine two, with ""quotes"""');assert.equal(multiline.source[0].reason,'Line one\nLine two, with "quotes"');
const uploads=process.env.RETURN_CSV_INPUT_DIR;
if(uploads)for(const [name,count] of [['368000',20],['368001',32],['368002',1],['368319',20]] as const)assert.equal(parseReturnCsv(name+'.csv',fs.readFileSync(uploads+'/'+name+'.csv','utf8')).source.length,count);
assert.deepEqual(physicalReturnItems(orders[2]).map(item=>item.expected_qty),[4,2]);
assert.equal((await call('/api/returns/sheets','GET',undefined,'other')).status,403);
assert.equal((await call('/api/returns/sheets','GET',undefined,'disabled')).status,401);
assert.equal((await call('/api/returns/sheets','POST',importInput,'receiver')).status,403);
assert.equal((await call('/api/returns/sheets','GET',undefined,'viewer')).status,200);
assert.equal((await call('/api/returns/scan','POST',{waybill:'WB-PARTIAL'},'viewer')).status,403);
const before=JSON.stringify(await stock());
const preview=await call('/api/returns/preview','POST',importInput);assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.summary.parcels,7);assert.equal(preview.body.summary.review_parcels,4);
assert.equal((await call('/api/returns/sheets')).body.total,0,'Preview must not persist a sheet');
const imported=await call('/api/returns/sheets','POST',importInput);assert.equal(imported.status,200,JSON.stringify(imported.body));
assert.equal(JSON.stringify(await stock()),before,'CSV upload cannot move stock');
assert.equal((await call('/api/returns/sheets','POST',importInput)).body.unchanged,true);
assert.equal((await call('/api/returns/sheets','POST',{...importInput,filename:'368001.csv'})).status,409,'Waybill cannot belong to a second sheet');
assert.equal((await call('/api/returns/sheets','POST',{...importInput,csv:csv(['WB-PARTIAL'])})).status,409,'An existing sheet cannot be replaced');
assert.equal((await call('/api/returns/sheets?search=368000','GET',undefined,'receiver')).body.total,1);
assert.equal((await call('/api/returns/sheets?search=NOPE')).body.total,0);
assert.equal((await receive(receipt(await getSheet(),'WB-PARTIAL',4))).status,409,'No receipt before scan');
assert.equal((await call('/api/returns/scan','POST',{waybill:'WB-PARTIAL'},'special')).status,200);
assert.equal(JSON.stringify(await stock()),before,'Scan cannot move stock');
const partialInput=receipt(await getSheet(),'WB-PARTIAL',4);
const partial=await receive(partialInput);assert.equal(partial.status,200,JSON.stringify(partial.body));assert.equal((await product('mat')).stock_quantity,14);
assert.equal(partial.body.sheet.parcels[0].items[0].expected_qty-partial.body.sheet.parcels[0].items[0].good_qty,1);
assert.equal((await receive(partialInput)).body.unchanged,true);assert.equal((await product('mat')).stock_quantity,14,'Retry cannot duplicate stock');
assert.equal((await receive({...partialInput,items:partialInput.items.map((item:any)=>({...item,good_qty:1}))})).status,409,'Same operation cannot change quantities');
const fresh=await getSheet(), one=receipt(fresh,'WB-PARTIAL',1), two=receipt(fresh,'WB-PARTIAL',1);
const parallel=await Promise.all([receive(one),receive(two)]);assert.deepEqual(parallel.map(result=>result.status).sort(),[200,409]);assert.equal((await product('mat')).stock_quantity,15,'Two staff with the same revision cannot both add stock');
await call('/api/returns/scan','POST',{waybill:'WB-VARIANT'},'receiver');await call('/api/returns/scan','POST',{waybill:'WB-BUNDLE'},'receiver');
const variantInput=receipt(await getSheet(),'WB-VARIANT',1,crypto.randomUUID(),1);
const bundleInput=receipt(await getSheet(),'WB-BUNDLE',0);
bundleInput.items[0]={...bundleInput.items[0],good_qty:3,damaged_qty:1,not_received:false};bundleInput.items[1]={...bundleInput.items[1],good_qty:1,not_received:false};
const separate=await Promise.all([receive(variantInput),receive(bundleInput)]);assert.ok(separate.every(result=>result.status===200),JSON.stringify(separate));
const variant=await product('variant');assert.equal(variant.variants[0].stock_quantity,3);assert.equal(variant.variants[1].stock_quantity,5);assert.equal(variant.stock_quantity,8);
assert.equal((await product('a')).stock_quantity,3);assert.equal((await product('b')).stock_quantity,1);assert.equal((await product('bundle')).stock_quantity,0);
const missing=receipt(await getSheet(),'WB-BUNDLE',0);assert.equal((await receive(missing)).status,200);assert.equal((await product('b')).stock_quantity,1);
assert.equal((await receive(receipt(await getSheet(),'WB-BUNDLE',3))).status,409,'Quantity cannot exceed expected');
for(const wb of ['WB-UNALLOCATED','WB-LEGACY','WB-OLD']){
  await call('/api/returns/scan','POST',{waybill:wb},'receiver');assert.equal((await receive(receipt(await getSheet(),wb,1))).status,409);
}
const status=await call('/api/returns/sheets/368000');assert.equal(status.body.summary.good_qty,10);assert.equal(status.body.summary.damaged_qty,2);assert.equal(status.body.summary.confirmed_items,4);
const current=(await readDataTable(env,'order_snapshots')).find(row=>row.order_id==='partial')!.payload;
assert.equal(current.return_sheet_id,'368000');assert.equal(current.return_status,'Verified');assert.equal(current.invoice_number,'INV-partial');assert.equal(current.stock_allocated,true);
const stale={...orders[0]};const preserved=await call('/api/orders/partial','PUT',{order:stale});assert.equal(preserved.status,200);assert.equal(preserved.body.order.return_status,'Verified');
assert.equal((await call('/api/orders/partial','PUT',{order:{...stale,items:[{...stale.items[0],quantity:10}]}})).status,409);
assert.equal((await call('/api/orders/partial','DELETE')).status,409);
const sdkHeaders={'content-type':'application/json',apikey:env.SUPABASE_SECRET_KEY,prefer:'resolution=merge-duplicates,return=representation'};
const sdk=await cloudflareDataFetch(env.VITE_SUPABASE_URL+'/rest/v1/order_snapshots?on_conflict=order_id',{method:'POST',headers:sdkHeaders,body:JSON.stringify({order_id:'partial',order_number:stale.order_number,payload:stale})});
assert.equal(sdk.status,200);assert.equal((await sdk.json())[0].payload.return_status,'Verified');
assert.equal((await cloudflareDataFetch(env.VITE_SUPABASE_URL+'/rest/v1/order_snapshots?order_id=eq.partial',{method:'DELETE',headers:sdkHeaders})).status,409);
const cancelMirror=await call('/api/orders/partial','PUT',{order:{...stale,order_status:'Cancelled',is_test_order:true}});assert.equal(cancelMirror.status,200);assert.equal(cancelMirror.body.order.order_status,'Shipped');assert.equal(cancelMirror.body.order.is_test_order,undefined);
assert.equal((await call('/api/orders/redispatch-waybill','POST',{order_id:'partial',old_waybill:'WB-PARTIAL',new_waybill:'WB-OTHER'})).status,409);
const adminState=(await call('/api/admin/storefront/state')).body.state;
assert.equal(adminState.return_inventory.stockHistory.reduce((sum:number,row:any)=>sum+row.quantity,0),10);
assert.equal(adminState.return_inventory.returnRecords.length,3);
assert.equal((await call('/api/storefront/state')).body.state.return_inventory,undefined,'Public storefront must not expose staff receipts');
assert.equal((await call('/api/admin/storefront/state','PUT',{...JSON.parse(before),expected_version:1})).status,409,'An old catalog cannot overwrite received stock');

for(const [id,wb,key,mode] of [['368010','WB-FAIL-BEFORE',adminKey,'before'],['368011','WB-FAIL-AFTER',adminKey,'after'],['368012','WB-FAIL-ORDER',orderKey,'before']] as const){
  assert.equal((await call('/api/returns/sheets','POST',{filename:id+'.csv',csv:csv([wb])})).status,200);
  await call('/api/returns/scan','POST',{waybill:wb},'receiver');const input=receipt(await getSheet(id),wb,4);const initial=(await product('mat')).stock_quantity;
  raw.failKey=key;raw.failMode=mode;
  const failed=await receive(input,id);assert.equal(failed.status,503,JSON.stringify(failed.body));
  assert.equal((await product('mat')).stock_quantity,initial+(key===adminKey && mode==='before'?0:4));
  const retry=await receive(input,id);assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal((await product('mat')).stock_quantity,initial+4);
  assert.equal((await receive(input,id)).body.unchanged,true);assert.equal((await product('mat')).stock_quantity,initial+4);
}
// Production purchase-ledger adjustments identify exact variants even when a
// variant label is a substring of another option. Raw tsc does not see this patch.
const source=fs.readFileSync('src/context/StoreContext.tsx','utf8');
const patched=purchaseHistoryStockDurabilityPatch().transform(source,process.cwd()+'/src/context/StoreContext.tsx')!.code;
const adjustment=patched.slice(patched.indexOf('const exactAdjustmentNet='),patched.indexOf('    setProducts(current=>{',patched.indexOf('const exactAdjustmentNet=')));
const ledger=transformSync('(() => {'+adjustment+'return [exactAdjustmentNet(product,blue),exactAdjustmentNet(product,light)];})()',{loader:'ts'}).code;
assert.deepEqual(Array.from(vm.runInNewContext(ledger,{stockHistory:[{id:'return-stock:fixture:variant::light',product_id:'variant',variant_id:'light',product_name:'Light Blue',change_type:'Increase',quantity:3}],product:{id:'variant'},blue:{id:'blue',option_value:'Blue'},light:{id:'light',option_value:'Light Blue'}})),[0,3]);
console.log('PASS: return CSV preview/import, sheet search, shared receiving permissions, partial/variant/bundle quantities, damaged/pending items, concurrent receipts, lost acknowledgements, durable stock/history and old-flow guards.');
