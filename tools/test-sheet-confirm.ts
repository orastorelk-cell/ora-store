import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfigFromFile } from 'vite';
import { ACTIVE_KEY, activeData, dataBucket, importRecovery, readDataTable, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { advanceSheetConfirmJob, scheduleSheetConfirm } from '../worker/r2SheetConfirm';
import { SHEET_CONFIRM_API, SHEET_CONFIRM_CONTROL_KEY } from '../src/lib/sheetConfirmState';
import { readSheetDecisions } from '../src/lib/sheetConfirmRows';
import { canonicalJson } from '../src/lib/confirmCsvSave';
import { invoiceComplete } from '../src/lib/invoiceQueue';
import { returnPackingCsv } from '../src/lib/returnExports';
import { parseCsv } from '../src/lib/csv';
import { prepareOrderSnapshotUpdate } from '../src/lib/orderSnapshotUpdate';

class MemoryBucket{
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>();revision=0;failKey='';failAfter=false;
  async get(key:string){const object=this.objects.get(key);await Promise.resolve();return object?{etag:object.etag,customMetadata:object.customMetadata,text:async()=>object.value}:null;}
  async put(key:string,value:string,options:any={}){
    const old=this.objects.get(key);if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==old?.etag)return null;
    if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;
    const fail=key===this.failKey;if(fail&&!this.failAfter){this.failKey='';throw new Error('Synthetic lost storage response');}
    const next={value,etag:String(++this.revision),customMetadata:options.customMetadata};this.objects.set(key,next);
    if(fail){this.failKey='';throw new Error('Synthetic lost storage response');}return {etag:next.etag};
  }
}
const headers=['Order ID','Customer Name','Address','City','District','Main Code','Item Code','Variant / Color','Qty','Unit Price (Rs)','Line Total (Rs)','Item Action','Order Action','Cancel Reason','Gift Wrap','Wrapping Cost (Rs)','Imported Status','Last Sync'];
const line=(id:string,code='MAT',variant='',action='CONFIRM ORDER',qty='1',item='KEEP ITEM')=>[id,'Fixture customer','Address with\nnew line','Colombo','Colombo',code,code,variant,qty,'2000','2000',item,action,'','NO','0','Confirmed',''];
const initial=(number:string,extra:any={})=>({id:number,order_number:number,created_at:'2026-10-10T08:00:00Z',customer_name:'Fixture customer',phone:'0770000000',whatsapp:'0770000000',address:'Old address',city:'Colombo',district:'Colombo',order_source:number.startsWith('FB')?'Facebook Ads':number.startsWith('TK')?'TikTok Ads':'Website',payment_method:'COD',call_center_status:'Pending',order_status:'New Orders',stock_allocated:false,stock_status:'Waiting for Stock',subtotal:100,delivery_fee:250,total_amount:350,gift_wrap_selected:false,gift_wrap_fee:0,items:[{product_id:'mat',product_name:'Fixture mat',sku:'MAT',main_sku:'MAT',quantity:1,unit_price:100,subtotal:100,buying_price:50}],...extra});
const watch={id:'watch',sku:'WATCH',name_en:'Fixture watch',product_type:'variant',selling_price:1500,buying_price:600,stock_quantity:15,status:'Active',images:[],variants:[
  {id:'blue',sku:'WATCH-BLUE',option_value:'Light Blue',selling_price:1500,buying_price:600,stock_quantity:5,status:'Active'},
  {id:'purple',sku:'WATCH-PURPLE',option_value:'Light Purple',selling_price:1500,buying_price:600,stock_quantity:5,status:'Active'},
  {id:'green',sku:'WATCH-GREEN',option_value:'Light Green',selling_price:1500,buying_price:600,stock_quantity:5,status:'Active'},
]};
const products=[watch,{id:'mat',sku:'MAT',name_en:'Fixture mat',product_type:'simple',stock_quantity:10,status:'Active',selling_price:100,buying_price:50,images:[]},{id:'empty',sku:'EMPTY',name_en:'Fixture empty',stock_quantity:0,status:'Out of Stock',selling_price:100,buying_price:50,images:[]}];
const fixture=async(extra:{orders?:any[];rows?:string[][];tabs?:[string,string[][]][]}={})=>{
  const raw=new MemoryBucket(),env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:'sheet-fixture-only',ORA_R2_COMPRESSION_ENABLED:'1'};
  const watchItem={product_id:'watch',variant_id:'green',product_name:'Fixture watch',variant_name:'Light Green',sku:'WATCH-GREEN',main_sku:'WATCH',product_type:'variant',quantity:1,unit_price:1150,subtotal:1150,regular_unit_price:2000,supplier_offer_discount_per_unit:850,buying_price:600};
  const locked=initial('FB-000005',{call_center_status:'Confirmed',order_status:'Processing',stock_allocated:true,stock_status:'Allocated',waybill_number:'OLD-WB-5',invoice_locked:true,invoice_number:'INV-FB-000005',invoice_pack_batch_id:'PACK-OLD-5',invoice_generated_at:'2026-10-09T10:00:00Z',invoice_pack_downloaded_at:'2026-10-09T10:10:00Z',fardar_csv_exported_at:'2026-10-09T10:10:00Z'});
  const orders=extra.orders||[initial('FB-000001',{items:[watchItem],subtotal:1150,total_amount:1400,delivery_rebalance_qty_offer:true,delivery_rebalance_amount_snapshot:50,delivery_visible_fee_snapshot:250}),initial('WEB-000002'),initial('TK-000003'),initial('FB-000004'),locked,initial('FB-000006',{items:[{product_id:'empty',product_name:'Fixture empty',sku:'EMPTY',main_sku:'EMPTY',quantity:1,unit_price:100,subtotal:100}]}),initial('FB-000007',{call_center_status:'Confirmed',order_status:'Processing'})];
  const rows=extra.rows||[headers,line('FB-000001','WATCH-GREEN','Light Blue'),line('FB-000001','WATCH','light_purple',''),line('WEB-000002'),line('TK-000003','MAT','','CANCEL ENTIRE ORDER'),line('FB-000004','MAT','','PENDING'),line('FB-000005'),line('FB-000006','EMPTY'),line('FB-000007')];
  const tabs=new Map(extra.tabs||[['CALL CENTER ORDERS',rows]]),colors=new Map<string,any>();let reads=0,writes=0,tokens=0,failWrite=false;let onRead:(()=>Promise<void>)|undefined;
  const spreadsheet='fixtureSpreadsheet_'+crypto.randomUUID().replace(/-/g,''),suffix=crypto.randomUUID().slice(0,8);
  const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const account={type:'service_account',client_email:'ora@fixture-'+suffix+'.iam.gserviceaccount.com',private_key:rsa.privateKey.export({type:'pkcs8',format:'pem'}).toString(),private_key_id:suffix};
  const network:typeof fetch=async(input:any,init:any={})=>{
    const url=new URL(String(input));
    if(url.hostname==='oauth2.googleapis.com'){
      tokens++;const assertion=new URLSearchParams(String(init.body)).get('assertion')!,parts=assertion.split('.');
      assert(crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),rsa.publicKey,Buffer.from(parts[2],'base64url')),'Google JWT must be signed by the key');
      const claim=JSON.parse(Buffer.from(parts[1],'base64url').toString());assert.equal(claim.iss,account.client_email);assert.equal(claim.scope,'https://www.googleapis.com/auth/spreadsheets');
      return Response.json({access_token:'fixture-access-'+suffix,expires_in:3600});
    }
    assert.equal(url.hostname,'sheets.googleapis.com','Tests must never contact live services');assert.equal(init.headers.authorization,'Bearer fixture-access-'+suffix);
    if(url.pathname.endsWith('/values:batchGet')){
      reads++;if(onRead)await onRead();
      return Response.json({valueRanges:url.searchParams.getAll('ranges').map(range=>({range,values:tabs.get(range.match(/^'([^']+)'!/)![1])}))});
    }
    if(url.pathname.endsWith(':batchUpdate')){
      writes++;const body=JSON.parse(init.body);assert(Array.isArray(body.requests));
      // Apply the complete request before losing an acknowledgment, to prove
      // repeating a successful Google color update does not re-import invoices.
      for(const request of body.requests){
        const value=request.repeatCell,range=value.range,tab=Array.from(tabs.values())[range.sheetId-1];
        assert(tab);
        if(value.fields==='userEnteredFormat.backgroundColor')colors.set((range.sheetId===1?'':range.sheetId+'/')+String(range.startRowIndex),value.cell.userEnteredFormat.backgroundColor);
        else if(value.fields==='userEnteredValue')tab[range.startRowIndex][range.startColumnIndex]=value.cell.userEnteredValue.stringValue;
        else assert.fail('Only background and acknowledgment cells can be written');
      }
      if(failWrite){failWrite=false;return Response.json({error:{message:'fixture failure'}},{status:503});}
      return Response.json({spreadsheetId:spreadsheet,replies:body.requests.map(()=>({}))});
    }
    return Response.json({spreadsheetId:spreadsheet,properties:{title:'Fixture Sheet'},sheets:Array.from(tabs.keys()).map((title,i)=>({properties:{sheetId:i+1,title,gridProperties:{columnCount:headers.length,rowCount:1000}}}))});
  };
  const hash='cfhmac:salt:'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update('salt:fixture-password').digest('hex');
  await importRecovery(dataBucket(env)!,{format:'ora-r2-recovery-v1',orders,admin_users:[{id:'admin',role:'admin',username:'admin',password_hash:hash,is_active:true},{id:'staff',role:'staff',permissions:['confirm_upload'],is_active:true},{id:'viewer',role:'staff',permissions:['confirm_upload','level:confirm_upload:view'],is_active:true},{id:'other',role:'staff',permissions:['overview'],is_active:true}],
    admin_data_store:[{key:'storefront-state-v1',payload:{version:1,products:structuredClone(products),categories:[],settings:{delivery_fee:250,free_delivery_enabled:false,multi_buy_discount_enabled:true,advance_qty_threshold:4,advance_percentage:50,fardar_parcel_type:'Parcel'}}}],courier_waybills:[{waybill_number:'OLD-WB-5',status:'Assigned',assigned_order_number:'FB-000005'},...Array.from({length:150},(_,i)=>({waybill_number:'WB-'+String(i+1).padStart(8,'0'),status:'Available',courier_name:'Fardar',imported_at:'2026-10-10T08:00:00Z'}))],tables:{}});
  const active=(await activeData(dataBucket(env)!))!;
  const token=(user='admin')=>{const payload=Buffer.from(JSON.stringify({sub:user,exp:Date.now()+3600000})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',env.STAFF_SESSION_SECRET).update(payload).digest('base64url');};
  const call=async(path:string,body?:any,user='admin')=>{
    const response=await withR2DataFallback(new Request('https://fixture'+(path.startsWith('/api/')?path:SHEET_CONFIRM_API+path),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',authorization:user==='none'?'invalid':'Bearer '+token(user)},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{},async()=>new Response('Unexpected Node bridge',{status:599}));
    return {status:response.status,data:await response.json() as any};
  };
  const request=async(path:string,body?:unknown)=>{const response=await call(path,body);assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};
  const currentOrders=async()=>(await readDataTable(env,'order_snapshots')).map(row=>row.payload);
  const admin=()=>readDataTable(env,'admin_data_store');
  const connect=()=>request('/connection',{spreadsheet_id:spreadsheet,service_account:account});
  const view=async(id:string)=>(await request('/jobs/'+id)).job;
  const finish=async(id:string)=>{
    for(let step=0;step<12;step++){
      await advanceSheetConfirmJob(env,id);const job=await view(id);
      if(['complete','blocked','sheet_update_failed'].includes(job.phase))return job;
      if(job.error)await request('/jobs/'+id+'/retry',{});
    }assert.fail('The saved job did not finish');
  };
  return {raw,env,active,account,spreadsheet,network,tabs,colors,call,request,currentOrders,admin,connect,view,finish,setOnRead:(value:any)=>{onRead=value;},readCount:()=>reads,writeCount:()=>writes,setFailColor:()=>{failWrite=true;}};
};
const originalFetch=globalThis.fetch;
try{
  const f=await fixture();globalThis.fetch=f.network;
  assert.equal((await f.call('/connection',undefined,'none')).status,401);
  assert.equal((await f.call('/connection',undefined,'other')).status,403);
  assert.equal((await f.call('/connection',{spreadsheet_id:f.spreadsheet,service_account:f.account},'staff')).status,403);
  assert.equal((await f.call('/jobs',{operation_id:crypto.randomUUID()},'viewer')).status,403);
  const connection=await f.connect();assert(connection.connection.connected);
  assert(!JSON.stringify(connection).includes(f.account.private_key));assert(!JSON.stringify(await f.request('/connection')).includes('BEGIN PRIVATE KEY'));
  assert((await f.admin()).every(row=>!JSON.stringify(row.payload).includes('BEGIN PRIVATE KEY')));
  const before=await f.currentOrders(),oldLocked=canonicalJson(before.find(order=>order.order_number==='FB-000005')),oldPending=canonicalJson(before.find(order=>order.order_number==='FB-000004'));
  const id=crypto.randomUUID();await f.request('/jobs',{operation_id:id});
  const same=await Promise.all([f.request('/jobs',{operation_id:crypto.randomUUID()}),f.request('/jobs',{operation_id:id})]);
  assert(same.every(result=>result.job.operation_id===id),'Double press / another tab must join the same active job');
  await advanceSheetConfirmJob(f.env,id);
  const intermediate=await f.currentOrders();
  assert(intermediate.filter(order=>order.sheet_confirm_import).every(order=>!invoiceComplete(order)),'All decisions must save before any new invoice starts');
  assert.equal(f.writeCount(),0,'Sheet cannot be marked processed before decisions/invoices finish');
  assert.equal((await f.call('/api/orders/invoices/ensure',{order_ids:['FB-000001'],batch_id:'PACK-OTHER',automatic:true})).status,409,'Existing invoice automation must respect the Sheet hold');
  assert.equal((await f.call('/api/orders/waybill/assign',{order_id:'FB-000001'})).status,409);
  await Promise.all([advanceSheetConfirmJob(f.env,id),advanceSheetConfirmJob(f.env,id)]);
  const status=await f.finish(id);assert.equal(status.phase,'complete');assert.equal(status.counts.pending,1);assert.equal(status.counts.cancelled,1);assert.equal(status.counts.invoices,3);assert.equal(status.counts.stock,1);
  const after=await f.currentOrders(),packed=after.filter(order=>order.invoice_pack_batch_id==='PACK-SHEET-'+id);
  assert.equal(packed.length,3);assert(packed.every(invoiceComplete));assert.equal(new Set(packed.map(order=>order.waybill_number)).size,3);
  assert(packed.every(order=>!order.fardar_csv_exported_at&&!order.invoice_pack_downloaded_at),'Creating invoices is not a download acknowledgment');
  assert.equal(canonicalJson(after.find(order=>order.order_number==='FB-000005')),oldLocked,'Old invoices / waybills stay byte-for-byte intact');
  assert.equal(canonicalJson(after.find(order=>order.order_number==='FB-000004')),oldPending,'Pending order is never imported');
  const changed=after.find(order=>order.order_number==='FB-000001');assert.deepEqual(changed.items.map((item:any)=>item.variant_id),['blue','purple']);assert(changed.items.every((item:any)=>item.unit_price===1150));assert.equal(changed.total_amount,2390);assert.equal(changed.address,'Address with\nnew line');
  const catalog=(await f.admin()).find(row=>row.key==='storefront-state-v1')!.payload.products;
  assert.deepEqual(catalog[0].variants.map((variant:any)=>variant.stock_quantity),[4,4,5]);assert.equal(catalog[1].stock_quantity,8);
  assert.equal(after.find(order=>order.order_number==='TK-000003').order_status,'Cancelled');
  assert.equal(after.find(order=>order.order_number==='FB-000006').stock_allocated,false);
  assert(after.every(order=>!order.sheet_confirm_hold));
  assert(f.colors.has('1')&&f.colors.has('2'));assert(!f.colors.has('5'),'Pending rows must not get success colours');
  const files=await f.request('/jobs/'+id+'/files');assert.equal(files.orders.length,3);assert.equal(parseCsv(returnPackingCsv(files.orders,files.settings)).rows.length,3);
  const csv=returnPackingCsv(files.orders,files.settings);assert.equal(csv.charCodeAt(0),0xfeff);assert(csv.includes('2390'));
  await f.request('/jobs/'+id+'/downloaded',{});await f.request('/jobs/'+id+'/downloaded',{});
  const downloaded=await f.currentOrders();assert(downloaded.filter(order=>order.invoice_pack_batch_id==='PACK-SHEET-'+id).every(order=>order.fardar_csv_exported_at&&order.invoice_pack_downloaded_at));
  const savedStock=canonicalJson((await f.admin()).find(row=>row.key==='storefront-state-v1')!.payload.products);
  await f.request('/jobs',{operation_id:id});await f.finish(id);assert.equal(canonicalJson((await f.admin()).find(row=>row.key==='storefront-state-v1')!.payload.products),savedStock);
  const repeat=crypto.randomUUID();await f.request('/jobs',{operation_id:repeat});const repeated=await f.finish(repeat);assert.equal(repeated.counts.invoices,0,'Repeating the button cannot duplicate existing invoices');
  assert.equal(canonicalJson((await f.admin()).find(row=>row.key==='storefront-state-v1')!.payload.products),savedStock);
  assert([...f.raw.objects.values()].every(object=>['ora-aes-gcm-v1','ora-aes-gcm-v2'].includes(JSON.parse(object.value).format)),'Keys and jobs must stay encrypted');
  const stale=prepareOrderSnapshotUpdate(changed,before.find(order=>order.order_number===changed.order_number),[]).order;
  assert.deepEqual(stale.items,changed.items);assert.equal(stale.call_center_status,'Confirmed');
  assert.equal(prepareOrderSnapshotUpdate(changed,{...changed,order_status:'Shipped'},[]).order.order_status,'Shipped','Sheet receipts must allow normal dispatch progress');

  // A later bad row blocks the WHOLE import, not just the row or its invoice.
  const invalid=await fixture({orders:[initial('WEB-000001'),initial('WEB-000002')],rows:[headers,line('WEB-000001'),line('WEB-000002','MAT','','CONFIRM ORDER','0')]});globalThis.fetch=invalid.network;await invalid.connect();
  const invalidBefore=canonicalJson(await invalid.currentOrders()),invalidId=crypto.randomUUID();await invalid.request('/jobs',{operation_id:invalidId});const bad=await invalid.finish(invalidId);
  assert.equal(bad.phase,'blocked');assert.equal(canonicalJson(await invalid.currentOrders()),invalidBefore);assert.equal(invalid.writeCount(),0);
  invalid.tabs.get('CALL CENTER ORDERS')![2][8]='1';await invalid.request('/jobs/'+invalidId+'/retry',{});assert.equal((await invalid.finish(invalidId)).counts.invoices,2);

  // Editing and adding a variant row during import must prevent an old invoice.
  const edited=await fixture({orders:[initial('WEB-000001')],rows:[headers,line('WEB-000001')]});globalThis.fetch=edited.network;await edited.connect();const editId=crypto.randomUUID();await edited.request('/jobs',{operation_id:editId});
  edited.setOnRead(async()=>{if(edited.readCount()===3)edited.tabs.get('CALL CENTER ORDERS')![1][8]='2';});
  const blocked=await edited.finish(editId);assert.equal(blocked.phase,'blocked');assert(!(await edited.currentOrders()).some(invoiceComplete));
  assert((await edited.admin()).find(row=>row.key===SHEET_CONFIRM_CONTROL_KEY)!.payload.invoice_hold);
  edited.setOnRead(undefined);await edited.request('/jobs/'+editId+'/retry',{});assert.equal((await edited.finish(editId)).counts.invoices,1);assert.equal((await edited.currentOrders())[0].items[0].quantity,2);

  // Lost R2 response after committing all decisions resumes those same records.
  const lost=await fixture({orders:[initial('WEB-000001')],rows:[headers,line('WEB-000001')]});globalThis.fetch=lost.network;await lost.connect();const lostId=crypto.randomUUID();await lost.request('/jobs',{operation_id:lostId});lost.raw.failKey=lost.active.prefix+'order_snapshots.json';lost.raw.failAfter=true;
  assert.equal((await lost.finish(lostId)).counts.invoices,1);assert.equal((await lost.admin()).find(row=>row.key==='storefront-state-v1')!.payload.products[1].stock_quantity,9);

  // Cron alone completes accepted work while the browser is closed. A lost
  // Google color response can retry without reserving or deducting stock again.
  const offline=await fixture({orders:[initial('WEB-000001')],rows:[headers,line('WEB-000001')]});globalThis.fetch=offline.network;await offline.connect();const offlineId=crypto.randomUUID();await offline.request('/jobs',{operation_id:offlineId});offline.setFailColor();
  for(let step=0;step<8;step++){
    const pending:Promise<any>[]=[];scheduleSheetConfirm(offline.env,{waitUntil:(promise:Promise<any>)=>pending.push(promise)});await Promise.all(pending);
    const job=(await offline.request('/jobs/'+offlineId)).job;if(job.phase==='complete')break;if(job.error)await offline.request('/jobs/'+offlineId+'/retry',{});
  }
  assert.equal((await offline.view(offlineId)).phase,'complete');assert.equal((await offline.currentOrders()).filter(invoiceComplete).length,1);assert.equal((await offline.admin()).find(row=>row.key==='storefront-state-v1')!.payload.products[1].stock_quantity,9);assert(offline.writeCount()>=2);

  const manyOrders=Array.from({length:75},(_,i)=>initial('WEB-'+String(i+1).padStart(6,'0')));
  const many=await fixture({orders:manyOrders,rows:[headers,...manyOrders.map(order=>line(order.order_number))]});globalThis.fetch=many.network;await many.connect();
  await replaceDataTable(many.env,'admin_data_store',rows=>({rows:rows.map(row=>row.key==='storefront-state-v1'?{...row,payload:{...row.payload,products:row.payload.products.map((product:any)=>product.id==='mat'?{...product,stock_quantity:100}:product)}}:row),result:null}));
  const manyId=crypto.randomUUID();await many.request('/jobs',{operation_id:manyId});assert.equal((await many.finish(manyId)).counts.invoices,75);
  const manyFiles=await many.request('/jobs/'+manyId+'/files');assert.equal(manyFiles.orders.length,75);assert.equal(new Set(manyFiles.orders.map((order:any)=>order.invoice_pack_batch_id)).size,1);assert.equal(parseCsv(returnPackingCsv(manyFiles.orders,manyFiles.settings)).rows.length,75);

  const multi=await fixture({orders:[initial('WEB-000001'),initial('FB-000002'),initial('TK-000003')],tabs:[['CALL CENTER ORDERS',[headers,line('WEB-000001')]],['FACEBOOK ORDERS',[headers,line('FB-000002')]],['TIKTOK ORDERS',[headers,line('TK-000003','MAT','','CANCEL ENTIRE ORDER')]]]});globalThis.fetch=multi.network;await multi.connect();
  const multiId=crypto.randomUUID();await multi.request('/jobs',{operation_id:multiId});const multiDone=await multi.finish(multiId);assert.equal(multiDone.counts.invoices,2);assert.equal(multiDone.counts.cancelled,1);assert.equal(multi.colors.size,3);

  const wrongVariant=await fixture({orders:[initial('WEB-000001')],rows:[headers,line('WEB-000001','WATCH-BLUE','Unknown Color')]});globalThis.fetch=wrongVariant.network;await wrongVariant.connect();const wrongId=crypto.randomUUID();await wrongVariant.request('/jobs',{operation_id:wrongId});assert.equal((await wrongVariant.finish(wrongId)).phase,'blocked');assert(!(await wrongVariant.currentOrders()).some(invoiceComplete));

  const conflicting=await readSheetDecisions([{sheetId:1,title:'Fixture',columnCount:headers.length,values:[headers,line('WEB-000001'),line('WEB-000001','MAT','','CANCEL ENTIRE ORDER')]}]);assert(conflicting.errors.length);assert.equal(conflicting.decisions.length,0);
  const config=(await loadConfigFromFile({command:'build',mode:'production'}))!.config as any;let dashboard=fs.readFileSync('src/components/admin/AdminDashboard.tsx','utf8');
  for(const plugin of config.plugins.flat(Infinity)){if(plugin?.name?.startsWith('ora-')&&typeof plugin.transform==='function'){const result=await plugin.transform(dashboard,'/repo/src/components/admin/AdminDashboard.tsx');if(result)dashboard=typeof result==='string'?result:result.code;}}
  const section=dashboard.slice(dashboard.indexOf("{activeTab === 'confirm_upload'"),dashboard.indexOf('      {/* TAB 5: GOOGLE SHEETS SYNC */}'));assert(section.includes('<SheetConfirmUploadPanel />'));
  assert(fs.readFileSync('worker/indexV3FacebookAuto.ts','utf8').includes('scheduleSheetConfirm(env,ctx)'));
  console.log('PASS: encrypted Google connection / JWT / permissions; atomic all-order import; authoritative variant and new rows with historical prices; pending and existing invoices preserved; one stock-safe batch + one Fardar CSV; conflict and lost-response retries; browser-closed cron; success-only Sheet colours; production button and download acknowledgments.');
}finally{globalThis.fetch=originalFetch;}
