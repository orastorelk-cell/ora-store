import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import { ACTIVE_KEY, activeData, configureCloudflareData, cloudflareDataFetch, dataBucket, importRecovery } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { facebookLeadAuditHandler } from '../worker/facebookLeadAudit';
import { compactR2StorageOnce } from '../worker/r2StorageCompression';
import { r2MediaHandler } from '../worker/r2PublicMedia';
import { canonicalJson, saveConfirmCsvDecisions, confirmCsvRequestWithRetry, validConfirmCsvEntries } from '../src/lib/confirmCsvSave';
import { transformSync } from 'esbuild';
import { auditConfirmCsvOrders } from '../src/lib/confirmCsvAudit';
import { applyInvoiceQueue, invoiceComplete, invoiceReady, saveInvoiceQueue } from '../src/lib/invoiceQueue';
import { utf8CsvBlob, fardarParcelDescription, parseCsv } from '../src/lib/csv';

class MemoryBucket {
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>();
  revision=0;
  failKey='';
  async list({prefix='',limit=1000,cursor=''}={}){
    const all=[...this.objects.keys()].filter(key=>key.startsWith(prefix)&&key>cursor).sort();
    const keys=all.slice(0,limit);return {objects:keys.map(key=>({key})),truncated:all.length>keys.length,cursor:keys.at(-1)};
  }
  async get(key:string) {
    const value=this.objects.get(key);
    await Promise.resolve();
    return value ? {text:async()=>value.value,etag:value.etag,customMetadata:value.customMetadata} : null;
  }
  async put(key:string,value:string,options:any={}) {
    if(key===this.failKey)throw new Error('simulated durable write failure');
    const existing=this.objects.get(key),condition=options.onlyIf;
    if(condition?.etagMatches && condition.etagMatches!==existing?.etag)return null;
    if(condition?.etagDoesNotMatch==='*' && existing)return null;
    const next={value,etag:String(++this.revision),customMetadata:options.customMetadata};
    this.objects.set(key,next);return {etag:next.etag};
  }
}
const rawBucket=new MemoryBucket();
const secret='test-service-secret',sessionSecret='test-session-secret';
const env={ORA_MEDIA_R2:rawBucket,VITE_SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:secret,STAFF_SESSION_SECRET:sessionSecret,ORA_R2_COMPRESSION_ENABLED:'1'};
configureCloudflareData(env);
const bucket=dataBucket(env)!;
const sdk=createClient(env.VITE_SUPABASE_URL,secret,{global:{fetch:cloudflareDataFetch},db:{retry:false},auth:{persistSession:false,autoRefreshToken:false}});
const passwordHash='cfhmac:salt:'+crypto.createHmac('sha256',sessionSecret).update('salt:test-password').digest('hex');
const adminId='10000000-0000-0000-0000-000000000001',staffId='10000000-0000-0000-0000-000000000002';
const fixture={format:'ora-r2-recovery-v1',exported_at:'2026-10-02T00:00:00Z',
  orders:[{id:'order-1',order_number:'FB-000440',customer_name:'Test',created_at:'2026-10-01T00:00:00Z',invoice_locked:true,waybill_number:'LOCK-1',invoice_pack_batch_id:'PACK-RESTOCK-1',stock_allocated:true,items:[]}],
  admin_users:[{id:adminId,username:'admin',display_name:'Admin',role:'admin',password_hash:passwordHash,is_active:true},{id:staffId,username:'staff',role:'staff',password_hash:passwordHash,is_active:true,permissions:['overview']}],
  admin_data_store:[{key:'storefront-state-v1',updated_at:'2026-10-01T00:00:00Z',payload:{version:1,updated_at:'2026-10-01T00:00:00Z',products:[{id:'p1',sku:'R1'}],categories:[{id:'c1'}],settings:{google_sheet_webhook_url:'',admin_secret_path:'private',website_logo:'https://xoipahpyxatdafhqkzcr.supabase.co/storage/v1/object/public/ora-public-media/branding-1786881008119-eafc5b2520.png'}}}],
  courier_waybills:[{waybill_number:'LOCK-1',status:'Assigned',assigned_order_number:'FB-000440'}],
  tables:{fardar_cities:[{id:'city-1',name:'Colombo',district:'Colombo',code:'1'}]},
};

const before=await sdk.from('order_snapshots').select('*');
assert(before.error,'Missing recovery must fail instead of returning []');
await importRecovery(bucket,fixture);
const active=(await activeData(bucket))!;
const version=await sdk.from('order_snapshots').select('updated_at',{count:'exact'}).order('updated_at',{ascending:false}).limit(1);
assert.equal(version.error,null);assert.equal(version.count,1);
assert.equal((await sdk.from('admin_users').select('id,role').eq('id',adminId).single()).data?.role,'admin');
assert.equal((await sdk.from('customer_profiles').select('*').eq('user_id','missing').maybeSingle()).data,null);
assert.equal((await sdk.from('fardar_cities').select('name,district').ilike('name','%lomb%')).data?.[0]?.name,'Colombo');

// Parallel writes must retry against new ETags rather than erase each other.
const inserted=await Promise.all(Array.from({length:5},(_,i)=>sdk.from('order_snapshots').upsert({order_id:'parallel-'+i,order_number:'WEB-'+i,payload:{id:'parallel-'+i,platform_lead_id:'lead-'+i},created_at:'2026-10-02T00:00:00Z',updated_at:'2026-10-02T00:00:00Z'},{onConflict:'order_id'})));
assert(inserted.every(result=>!result.error));
assert.equal((await sdk.from('order_snapshots').select('*')).data?.length,6);
assert.equal((await sdk.from('order_snapshots').select('payload').eq('payload->>platform_lead_id','lead-3')).data?.length,1);
const reserved=await Promise.all(Array.from({length:5},()=>sdk.rpc('next_ora_order_number',{p_prefix:'FB'})));
assert(reserved.every(result=>!result.error));assert.equal(new Set(reserved.map(result=>result.data)).size,5);
assert(reserved.some(result=>result.data==='FB-000441'));
const collision=await sdk.from('courier_waybills').upsert({waybill_number:'LOCK-1',status:'Assigned',assigned_order_number:'FB-NEW'},{onConflict:'waybill_number'});
assert(collision.error,'An assigned waybill cannot be reused');
const duplicate=await sdk.from('order_snapshots').upsert({order_id:'different',order_number:'FB-000440',payload:{}},{onConflict:'order_id'});
assert(duplicate.error,'Order number uniqueness must survive parallel inserts');
assert.equal((await importRecovery(bucket,fixture)).counts.order_snapshots,1);
assert.equal((await sdk.from('order_snapshots').select('*')).data?.length,6,'Repeat restore cannot overwrite newer orders');
assert([...rawBucket.objects.keys()].some(key=>key.startsWith('ora-data/backups-v2/order_snapshots/')));
assert([...rawBucket.objects.values()].every(object=>['ora-aes-gcm-v1','ora-aes-gcm-v2'].includes(JSON.parse(object.value).format)),'Private records and backups must be encrypted');

// Test the existing Express routes against R2, including auth and protected data.
process.env.CLOUDFLARE_WORKERS='1';process.env.VITE_SUPABASE_URL=env.VITE_SUPABASE_URL;
process.env.SUPABASE_SECRET_KEY=secret;process.env.STAFF_SESSION_SECRET=sessionSecret;
const app=(await import('../server')).default;
const server=app.listen(0);const address=server.address() as {port:number};
const base='http://127.0.0.1:'+address.port;
const request=async(path:string,method='GET',body?:any,token='')=>{
  const result=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:result.status,body:await result.json()};
};
try {
  assert.equal((await request('/api/orders')).status,401);
  const login=await request('/api/staff/login','POST',{username:'admin',password:'test-password'});
  assert.equal(login.status,200);const token=login.body.token;
  const staff=await request('/api/staff/login','POST',{username:'staff',password:'test-password'});
  assert.equal((await request('/api/admin/orders/bulk-import','POST',{orders:[]},staff.body.token)).status,403);
  assert.equal((await request('/api/orders','GET',undefined,token)).body.orders.length,6);
  const fast=async(path:string,method='GET',body?:any,auth=token)=>withR2DataFallback(new Request('https://test'+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+auth},...(body?{body:JSON.stringify(body)}:{})}),env,{},async()=>new Response('Unexpected Node bridge call',{status:599}));
  assert.equal((await fast('/api/orders')).status,200);
  assert.equal((await (await fast('/api/orders/version')).json()).count,6);
  assert.equal((await fast('/api/orders','GET',undefined,'invalid')).status,401);
  assert.equal((await fast('/api/orders/delivered-csv','POST',{entries:[]},staff.body.token)).status,403);
  const shipped={...fixture.orders[0],order_status:'Shipped',delivery_status:'Shipped',tracking_status:'Shipped',internal_delivery_fee:250};
  await sdk.from('order_snapshots').upsert({order_id:shipped.id,order_number:shipped.order_number,payload:shipped},{onConflict:'order_id'});
  const report={entries:[{waybill:'LOCK-1',order_number:'FB-000440',delivered_at:'2026-10-02T01:00:00Z',delivery_fee:0}]};
  const delivered=await fast('/api/orders/delivered-csv','POST',report);
  assert.equal(delivered.status,200);assert.equal((await delivered.json()).updated,1);
  const durable=(await sdk.from('order_snapshots').select('payload').eq('order_id','order-1').single()).data?.payload;
  assert.equal(durable.order_status,'Delivered');assert.equal(durable.delivery_status,'Delivered');assert.equal(durable.tracking_status,'Delivered');
  assert.equal(durable.internal_delivery_fee,0);assert.equal(durable.invoice_locked,true);assert.equal(durable.stock_allocated,true);assert.equal(durable.waybill_number,'LOCK-1');
  assert.equal(durable.invoice_pack_batch_id,'PACK-RESTOCK-1');
  assert.equal((await (await fast('/api/orders/delivered-csv','POST',report)).json()).alreadyDelivered,1);
  assert.equal((await sdk.from('order_snapshots').select('payload').eq('order_id','order-1').single()).data?.payload.fardar_tracking_history.length,1);
  assert.equal((await (await fast('/api/orders/delivered-csv','POST',{entries:[{waybill:'LOCK-1',order_number:'FB-OTHER'}]})).json()).mismatch,1);
  const badBatch=await fast('/api/orders/delivered-csv','POST',{entries:Array(21).fill({waybill:'LOCK-1'})});assert.equal(badBatch.status,400);
  const stale=await request('/api/orders/order-1','PUT',{order:{...fixture.orders[0],invoice_locked:false,waybill_number:'',stock_allocated:false,invoice_pack_batch_id:undefined}},token);
  assert.equal(stale.status,200);assert.equal(stale.body.order.waybill_number,'LOCK-1');
  assert.equal(stale.body.order.invoice_locked,true);assert.equal(stale.body.order.stock_allocated,true);
  assert.equal(stale.body.order.invoice_pack_batch_id,'PACK-RESTOCK-1');
  const storefront=await request('/api/storefront/state');
  assert.equal(storefront.body.state.products.length,1);
  assert.equal(storefront.body.state.settings.admin_secret_path,undefined);
  assert(storefront.body.state.settings.website_logo.startsWith('/api/media/media/branding/'),'Known original logo must load from R2');
  assert.equal((await request('/api/admin-data/arbitrary-key','PUT',{payload:[]},token)).status,404);
  assert.equal((await request('/api/admin/packing-expenses','PUT',{expenses:[{id:'e1',expense_date:'2026-10-02',material_name:'Tape',quantity:2,unit_cost:5}]},token)).status,200);
  const newOrder={id:'imported',order_number:'FB-000900',customer_name:'Synthetic',phone:'0770000000',address:'Test',city:'Colombo',order_source:'Facebook Ads',payment_method:'COD',items:[{product_id:'p1',product_name:'Test',quantity:1,unit_price:5,subtotal:5}],created_at:new Date().toISOString()};
  const bulk=await request('/api/admin/orders/bulk-import','POST',{orders:[newOrder]},token);
  assert.equal(bulk.status,200,JSON.stringify(bulk.body));assert((await sdk.from('order_snapshots').select('*').eq('order_id','imported')).data?.length);

  // Website reads/saves/session refresh take the direct Worker path. An ordinary
  // login/retry with an identical catalog must not rewrite the entire data table.
  assert.equal((await fast('/api/admin/storefront/state','GET',undefined,'invalid')).status,401);
  const privateState:any=await (await fast('/api/admin/storefront/state')).json();
  const site=privateState.state,adminKey=active.prefix+'admin_data_store.json';
  const unrelatedBefore=JSON.parse(await (await bucket.get(adminKey))!.text()).filter((row:any)=>row.key!=='storefront-state-v1');
  const siteInput={products:site.products,categories:site.categories,settings:{...site.settings,store_name:'R2 Test Store',
    google_sheet_webhook_url:'',admin_secret_path:'private-test',fardar_api_url:'private-api',fardar_account_id:'private-account',
    bank_details_saved:false,bank_account_number:'not-public'},expected_version:site.version};
  const firstSite:any=await (await fast('/api/admin/storefront/state','PUT',siteInput)).json();
  assert.equal(firstSite.ok,true);assert.equal(firstSite.version,site.version+1);
  const firstSiteEtag=rawBucket.objects.get(adminKey)!.etag;
  const repeatSite:any=await (await fast('/api/admin/storefront/state','PUT',siteInput)).json();
  assert.equal(repeatSite.unchanged,true);assert.equal(repeatSite.version,firstSite.version);
  assert.equal(rawBucket.objects.get(adminKey)!.etag,firstSiteEtag,'An acknowledged website-save retry must not write again');
  assert.deepEqual(JSON.parse(await (await bucket.get(adminKey))!.text()).filter((row:any)=>row.key!=='storefront-state-v1'),unrelatedBefore);
  const publicSite:any=await (await fast('/api/storefront/state','GET',undefined,'')).json();
  assert.equal(publicSite.state.settings.store_name,'R2 Test Store');
  for(const field of ['google_sheet_webhook_url','admin_secret_path','fardar_api_url','fardar_account_id','courier_api_enabled'])assert.equal(publicSite.state.settings[field],undefined);
  assert.equal(publicSite.state.settings.bank_account_number,'');
  assert.equal((await fast('/api/admin/storefront/state','PUT',{...siteInput,settings:{...siteInput.settings,store_name:'Stale'}})).status,409);
  rawBucket.failKey=adminKey;
  assert.equal((await fast('/api/admin/storefront/state','PUT',{...siteInput,expected_version:firstSite.version,settings:{...siteInput.settings,store_name:'Must not save'}})).status,503);
  rawBucket.failKey='';
  assert.equal((await (await fast('/api/admin/storefront/state')).json() as any).state.settings.store_name,'R2 Test Store');
  const refreshed:any=await (await fast('/api/staff/session/refresh','POST')).json();
  assert.equal(refreshed.ok,true);assert.equal((await fast('/api/orders','GET',undefined,refreshed.token)).status,200);
  assert.equal((await fast('/api/staff/session/refresh','POST',undefined,'invalid')).status,401);
  await sdk.from('admin_users').update({is_active:false}).eq('id',staffId);
  assert.equal((await fast('/api/staff/session/refresh','POST',undefined,staff.body.token)).status,401);
  await sdk.from('admin_users').update({is_active:true}).eq('id',staffId);

  // A blank URL from an older admin browser cannot clear a working integration.
  const currentSiteRows=JSON.parse(await (await bucket.get(adminKey))!.text());
  currentSiteRows.find((row:any)=>row.key==='storefront-state-v1').payload.settings.google_sheet_webhook_url='https://script.google.com/macros/s/fixture/exec';
  await bucket.put(adminKey,JSON.stringify(currentSiteRows));
  const preserveWebhook:any=await (await fast('/api/admin/storefront/state','PUT',{...siteInput,expected_version:firstSite.version})).json();
  assert.equal(preserveWebhook.unchanged,true);
  assert.equal((await (await fast('/api/admin/storefront/state')).json() as any).state.settings.google_sheet_webhook_url,'https://script.google.com/macros/s/fixture/exec');
  // No ctx.waitUntil is supplied in this fixture: no external Sheet request occurs.

  // Execute the production Confirm parser after every Vite business-rule patch.
  // Reproduce 12 orders with 7 already committed, a failed R2 write, and a lost
  // successful response. Retrying must retain the first seven packing groups.
  const confirmOrders=Array.from({length:12},(_,i)=>({id:'confirm-'+i,order_number:'FB-'+String(2000+i).padStart(6,'0'),
    customer_name:'Test Customer',phone:'0770000000',address:'Test Address',city:'Colombo',district:'Colombo',
    order_source:'Facebook Ads',order_status:'New Orders',call_center_status:'Pending',notes:'Original note',
    items:[{product_id:'p1',product_name:'Test Product',sku:'R1',main_sku:'R1',quantity:1,unit_price:100,subtotal:100,buying_price:50}],
    subtotal:100,delivery_fee:250,total_amount:350,gift_wrap_selected:false,gift_wrap_fee:0,is_advance_required:false,advance_amount:0,
    stock_allocated:false,created_at:'2026-10-02T00:00:00Z'}));
  await sdk.from('order_snapshots').upsert(confirmOrders.map(order=>({order_id:order.id,order_number:order.order_number,payload:order})),{onConflict:'order_id'});
  const viteConfig=(await (await import('vite')).loadConfigFromFile({command:'build',mode:'production'}))!.config as any;
  let contextCode=fs.readFileSync('src/context/StoreContext.tsx','utf8');
  for(const plugin of viteConfig.plugins.flat(Infinity)){
    if(plugin?.name?.startsWith('ora-')&&typeof plugin.transform==='function'){
      const result=await plugin.transform(contextCode,'/repo/src/context/StoreContext.tsx');
      if(result)contextCode=typeof result==='string'?result:result.code;
    }
  }
  const parserStart=contextCode.indexOf('  const importConfirmedOrdersCsv = async');
  const parserEnd=contextCode.indexOf('  const importWebsiteConfirmedCsv',parserStart);
  assert(parserStart>=0&&parserEnd>parserStart);
  let confirmRequests=0,readFailure=false,writeFailure=false,loseAcknowledgment=false,committedEtag='';
  const currentOrderKey=active.prefix+'order_snapshots.json';
  const confirmStaffRequest=async(path:string,options:any={})=>{
    if(path==='/api/orders'&&readFailure){readFailure=false;const error:any=new Error('simulated read 503');error.status=503;throw error;}
    if(path.endsWith('/confirm-csv')){confirmRequests++;if(writeFailure){writeFailure=false;rawBucket.failKey=currentOrderKey;}}
    const response=await fast(path,options.method||'GET',options.body?JSON.parse(options.body):undefined);
    rawBucket.failKey='';const data:any=await response.json();
    if(!response.ok){const error:any=new Error(data.error);error.status=response.status;throw error;}
    if(path.endsWith('/confirm-csv')&&loseAcknowledgment){loseAcknowledgment=false;committedEtag=rawBucket.objects.get(currentOrderKey)!.etag;const error:any=new Error('response lost after commit');error.status=503;throw error;}
    return data;
  };
  let displayedOrders:any[]=confirmOrders;
  const storage=new Map<string,string>([['ora_orders',JSON.stringify(confirmOrders)]]);
  const parserScope:any={canonicalJson,
    saveConfirmCsvDecisions:(entries:any,request:any)=>saveConfirmCsvDecisions(entries,request,async()=>{}),
    confirmCsvRequestWithRetry:(request:any,url:string,options:any)=>confirmCsvRequestWithRetry(request,url,options,async()=>{}),
    getStaffSessionToken:()=>token,sharedStaffRequest:confirmStaffRequest,orders:confirmOrders,
    products:[{id:'p1',sku:'R1',name_en:'Test Product'}],settings:{free_delivery_enabled:false,delivery_fee:250,advance_qty_threshold:4,advance_percentage:50},
    findProductSelection:(products:any[])=>({product:products[0]}),normalizedProductType:()=>'simple',
    getMultiBuyDiscountRate:()=>0,buildOrderItemSnapshot:()=>{throw new Error('Existing item price should be preserved.');},
    localStorage:{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value)},
    setOrders:(updater:any)=>{displayedOrders=updater(displayedOrders);},console};
  const parser=transformSync(contextCode.slice(parserStart,parserEnd)+'\nglobalThis.runConfirm=importConfirmedOrdersCsv;',{loader:'ts',target:'es2022'}).code;
  vm.runInNewContext(parser,parserScope);
  const confirmCsv=(count:number)=>['Order ID,Item Code,Qty,Order Action,Customer Name,Address,City,District,Reason',
    ...confirmOrders.slice(0,count).map(order=>`${order.order_number},R1,1,CONFIRM ORDER,Test Customer,Test Address,Colombo,Colombo,Verified`)].join('\n');
  const seven=await parserScope.runConfirm(confirmCsv(7),undefined,'FIRST-SEVEN');
  assert.equal(seven.confirmedCount,7);assert.equal(seven.errors.length,0);
  const firstSeven=(await sdk.from('order_snapshots').select('payload').in('order_id',confirmOrders.slice(0,7).map(order=>order.id))).data!.map(row=>canonicalJson(row.payload));
  readFailure=true;writeFailure=true;loseAcknowledgment=true;confirmRequests=0;
  const twelve=await parserScope.runConfirm(confirmCsv(12),undefined,'RETRY-TWELVE');
  assert.equal(twelve.confirmedCount,12);assert.equal(twelve.errors.length,0);assert.equal(confirmRequests,3);
  assert.equal(rawBucket.objects.get(currentOrderKey)!.etag,committedEtag,'Lost-response retry must not write a second snapshot');
  const confirmedRows=(await sdk.from('order_snapshots').select('payload').in('order_id',confirmOrders.map(order=>order.id))).data!;
  assert.equal(confirmedRows.length,12);assert(confirmedRows.every(row=>row.payload.call_center_status==='Confirmed'&&row.payload.order_status==='Processing'));
  assert.deepEqual(confirmedRows.slice(0,7).map(row=>canonicalJson(row.payload)),firstSeven,'Previously committed orders retain all fields exactly');
  assert(confirmedRows.slice(7).every(row=>row.payload.confirm_upload_batch_id==='RETRY-TWELVE'));
  assert(displayedOrders.every(order=>order.call_center_status==='Confirmed'),'Only verified server results update the UI');
  const auditExpected=confirmOrders.map(order=>({order_number:order.order_number,decision:'Confirmed',items:[{sku:'R1',quantity:1,variant:''}]}));
  const auditEtag=rawBucket.objects.get(currentOrderKey)!.etag;
  const savedAudit:any=await (await fast('/api/orders/confirm-csv/check','POST',{orders:auditExpected})).json();
  assert.equal(savedAudit.verified_orders,12);assert.equal(savedAudit.unverified_orders,0);
  assert.equal(rawBucket.objects.get(currentOrderKey)!.etag,auditEtag,'Confirm audit is read-only');
  assert(!JSON.stringify(savedAudit).includes('0770000000'));assert(!JSON.stringify(savedAudit).includes('Test Address'));
  assert.equal((await fast('/api/orders/confirm-csv/check','POST',{orders:auditExpected},'invalid')).status,401);
  assert.equal((await fast('/api/orders/confirm-csv/check','POST',{orders:[auditExpected[0],auditExpected[0]]})).status,400);
  const variantAudit=auditConfirmCsvOrders([{order_number:'FB-TEST',call_center_status:'Confirmed',order_status:'Processing',items:[{sku:'COMBO',quantity:4,variant_name:'Blue'},{sku:'COMBO',quantity:1,variant_name:'Red'}]}],
    [{order_number:'FB-TEST',decision:'Confirmed',items:[{sku:'COMBO',quantity:2,variant:'Blue'},{sku:'COMBO',quantity:3,variant:'Red'}]}]);
  assert.equal(variantAudit.verified_orders,0,'Correct total quantity with wrong per-variant quantities must fail');

  // Reproduce nine Fardar-ready parcels with seven existing invoices and two
  // missing/incomplete records. Complete records and their waybills are immutable.
  const invoiceOrders=Array.from({length:9},(_,i)=>({
    ...confirmOrders[0],id:'invoice-test-'+i,order_number:'FB-'+String(9000+i).padStart(6,'0'),
    call_center_status:'Confirmed',order_status:'Processing',stock_allocated:true,stock_status:'Allocated',
    stock_allocated_at:'2026-10-02T01:03:00Z',call_center_updated_at:'2026-10-02T01:00:00Z',confirm_upload_batch_id:'PACK-CONFIRM-NEW',
    waybill_number:'INVOICE-WB-'+i,invoice_number:'INV-EXISTING-'+i,
    ...(i<7?{invoice_locked:true,invoice_generated_at:'2026-10-02T01:04:00Z',invoice_generated_by:'Earlier staff',invoice_pack_batch_id:'PACK-FIRST-SEVEN',
      invoice_pack_downloaded_at:'2026-10-02T01:05:00Z',invoice_pack_download_set_date:'2026-10-02',invoice_pack_download_set_number:4,
      fardar_csv_exported_at:'2026-10-02T01:06:00Z',fardar_csv_exported_waybill:'INVOICE-WB-'+i}:i===8?{invoice_locked:true}:{}),
  }));
  await sdk.from('order_snapshots').upsert(invoiceOrders.map(order=>({order_id:order.id,order_number:order.order_number,payload:order})),{onConflict:'order_id'});
  await sdk.from('courier_waybills').upsert(invoiceOrders.map(order=>({waybill_number:order.waybill_number,status:'Assigned',assigned_order_number:order.order_number})),{onConflict:'waybill_number'});
  const ids=invoiceOrders.map(order=>order.id),lockedBefore=invoiceOrders.slice(0,7).map(canonicalJson);
  const waybillBefore=canonicalJson((await sdk.from('courier_waybills').select('*')).data);
  let invoiceRequests=0,loseInvoiceResponse=true,invoiceCommittedEtag='';
  const invoiceRequest=async(path:string,options?:RequestInit)=>{
    invoiceRequests++;
    if(invoiceRequests===1)rawBucket.failKey=currentOrderKey;
    const response=await fast(path,options?.method||'GET',options?.body?JSON.parse(String(options.body)):undefined);
    rawBucket.failKey='';const data:any=await response.json();
    if(!response.ok){const error:any=new Error(data.error);error.status=response.status;throw error;}
    if(loseInvoiceResponse){loseInvoiceResponse=false;invoiceCommittedEtag=rawBucket.objects.get(currentOrderKey)!.etag;const error:any=new Error('lost invoice acknowledgment');error.status=503;throw error;}
    return data;
  };
  const ensured=await saveInvoiceQueue(ids,'PACK-AUTO-NEW',invoiceRequest,true,async()=>{});
  assert.equal(invoiceRequests,3);assert.equal(ensured.orders.length,9);assert.deepEqual(ensured.errors,[]);
  assert(ensured.orders.every(invoiceComplete));
  assert.equal(rawBucket.objects.get(currentOrderKey)!.etag,invoiceCommittedEtag,'Lost invoice acknowledgment must replay without another write');
  assert.deepEqual(ensured.orders.slice(0,7).map(canonicalJson),lockedBefore,'Seven original invoices/downloads/exports must remain byte-for-byte identical');
  assert(ensured.orders.slice(7).every(order=>order.invoice_pack_batch_id==='PACK-CONFIRM-NEW'));
  for(let i=7;i<9;i++)for(const field of ['items','subtotal','total_amount','stock_allocated','stock_status','stock_allocated_at','waybill_number','invoice_number']){
    assert.equal(canonicalJson([ensured.orders[i][field]]),canonicalJson([(invoiceOrders[i] as any)[field]]),'Invoice repair must not change '+field);
  }
  assert.equal(canonicalJson((await sdk.from('courier_waybills').select('*')).data),waybillBefore,'Invoice queue never writes or reassigns a waybill');
  const repeatInvoice:any=await (await fast('/api/orders/invoices/ensure','POST',{order_ids:ids,batch_id:'PACK-DIFFERENT-RETRY'})).json();
  assert(repeatInvoice.results.every((result:any)=>result.status==='already_saved'));
  assert.equal(rawBucket.objects.get(currentOrderKey)!.etag,invoiceCommittedEtag);
  assert.equal((await fast('/api/orders/invoices/ensure','POST',{order_ids:ids,batch_id:'PACK-NEW'},'invalid')).status,401);
  assert.equal((await fast('/api/orders/invoices/ensure','POST',{order_ids:[ids[0],ids[0]],batch_id:'PACK-NEW'})).status,400);
  assert.equal((await fast('/api/orders/invoices/ensure','POST',{order_ids:ids,batch_id:'arbitrary'})).status,400);
  const blocked=applyInvoiceQueue([{...invoiceOrders[7],order_status:'Cancelled'}],[ids[7]],'PACK-NEW',{},'Staff');
  assert.equal(blocked.results[0].status,'failed');assert.equal(blocked.updatedOrders.length,0);
  const conflict=applyInvoiceQueue([invoiceOrders[7],{...invoiceOrders[8],waybill_number:invoiceOrders[7].waybill_number}],[ids[7]],'PACK-NEW',{},'Staff');
  assert.equal(conflict.results[0].status,'failed');
  const missingInvoiceOrder=applyInvoiceQueue(invoiceOrders,['does-not-exist'],'PACK-NEW',{},'Staff');assert.equal(missingInvoiceOrder.results[0].status,'failed');
  const registryConflict=applyInvoiceQueue([invoiceOrders[7]],[ids[7]],'PACK-NEW',{},'Staff',[
    {waybill_number:invoiceOrders[7].waybill_number,status:'Used',assigned_order_number:'OTHER-ORDER'}]);
  assert.equal(registryConflict.results[0].status,'failed');
  const concurrentInvoices=[0,1].map(index=>({...invoiceOrders[7],id:'invoice-cas-'+index,order_number:'FB-'+String(9100+index).padStart(6,'0'),
    waybill_number:'CAS-INVOICE-WB-'+index,invoice_number:undefined}));
  await sdk.from('order_snapshots').upsert(concurrentInvoices.map(order=>({order_id:order.id,order_number:order.order_number,payload:order})),{onConflict:'order_id'});
  const invoiceCasResults=await Promise.all(concurrentInvoices.map(order=>fast('/api/orders/invoices/ensure','POST',{order_ids:[order.id],batch_id:'PACK-CAS-NEW'})));
  assert(invoiceCasResults.every(response=>response.status===200));
  const invoiceCasRows=(await sdk.from('order_snapshots').select('payload').in('order_id',concurrentInvoices.map(order=>order.id))).data!;
  assert(invoiceCasRows.every(row=>invoiceComplete(row.payload)),'Concurrent staff invoice saves retain each other');
  const localInvoiceFallback=await request('/api/orders/invoices/ensure','POST',{order_ids:ids,batch_id:'PACK-LOCAL-REPLAY'},token);
  assert.equal(localInvoiceFallback.status,200);assert(localInvoiceFallback.body.results.every((result:any)=>result.status==='already_saved'));

  // Execute both production queue paths after ALL Vite patches. Failed requests
  // must not set local invoice flags, and a subsequent run must be allowed.
  const autoStart=contextCode.indexOf('  // AUTO INVOICE QUEUE: publish only'),autoEnd=contextCode.indexOf('  const updateOrderStatus',autoStart);
  const manualStart=contextCode.indexOf('  const markInvoicesGenerated = async'),manualEnd=contextCode.indexOf('  const markInvoiceBatchDownloaded',manualStart);
  assert(autoStart>=0&&manualStart>=0);
  let localInvoiceOrders:any[]=JSON.parse(JSON.stringify(invoiceOrders)),rejectQueue=true,scheduledRetry=0;
  const effects:Array<()=>void>=[],inFlight={current:new Set()},retryTimer={current:null};
  const queueScope:any={invoiceReady,invoiceComplete,adminUser:{id:adminId,name:'Admin'},sharedStoreReady:true,orders:localInvoiceOrders,
    autoInvoiceReadyRef:inFlight,invoiceQueueRetryTimerRef:retryTimer,invoiceQueueRetry:0,getStaffSessionToken:()=>token,
    useEffect:(callback:any)=>effects.push(callback),window:{setTimeout:()=>{scheduledRetry++;return 10;}},setInvoiceQueueRetry:()=>{},
    sharedStaffRequest:async(path:string,options?:RequestInit)=>{if(rejectQueue){const error:any=new Error('503');error.status=503;throw error;}const response=await fast(path,options?.method||'GET',options?.body?JSON.parse(String(options.body)):undefined);return response.json();},
    saveInvoiceQueue:(a:any,b:any,c:any,d?:any)=>saveInvoiceQueue(a,b,c,d,async()=>{}),
    setOrders:(update:any)=>{localInvoiceOrders=update(localInvoiceOrders);},refreshOrdersFromServer:async()=>{},logActivity:()=>{},console:{warn:()=>{}},
  };
  vm.runInNewContext(transformSync(contextCode.slice(autoStart,autoEnd).replace('void saveInvoiceQueue','globalThis.autoQueuePromise=saveInvoiceQueue')+
    contextCode.slice(manualStart,manualEnd)+'\nglobalThis.runManualInvoice=markInvoicesGenerated;',{loader:'ts',target:'es2022'}).code,queueScope);
  await assert.rejects(queueScope.runManualInvoice(ids));assert.deepEqual(localInvoiceOrders,invoiceOrders);
  effects[0]();await queueScope.autoQueuePromise;assert.deepEqual(localInvoiceOrders,invoiceOrders);assert.equal(inFlight.current.size,0);assert.equal(scheduledRetry,1);
  rejectQueue=false;effects[0]();await queueScope.autoQueuePromise;assert(localInvoiceOrders.every(invoiceComplete));
  assert.deepEqual(localInvoiceOrders.slice(0,7).map(canonicalJson),lockedBefore);
  const malformed=(await saveInvoiceQueue([ids[0]],'PACK-NEW',async()=>({ok:true,results:[{id:ids[0],order_number:invoiceOrders[0].order_number,status:'saved',order:{id:ids[0],order_number:invoiceOrders[0].order_number}}]}),false,async()=>{}).then(()=>false,()=>true));
  assert(malformed,'An incomplete invoice acknowledgment must never count as saved');

  const checkedInvoices=auditConfirmCsvOrders(ensured.orders,ensured.orders.map(order=>({order_number:order.order_number,decision:'Confirmed',items:[{sku:'R1',quantity:1,variant:''}]})));
  assert.equal(checkedInvoices.invoice_ready_orders,9);assert.equal(checkedInvoices.saved_invoice_orders,9);assert.equal(checkedInvoices.missing_invoice_orders,0);
  const plainDescription=fardarParcelDescription([{sku:'R0047',product_name:'Masala Spice   Box â€“ 7 Compartment',quantity:1}]);
  assert.equal(plainDescription,'R0047 Masala Spice Box – 7 Compartment x1');
  const csvBytes=new Uint8Array(await utf8CsvBlob('Parcel Description\n"'+plainDescription+'"').arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0,3)],[239,187,191],'CSV must identify its encoding to Excel');
  assert.equal(parseCsv(new TextDecoder().decode(csvBytes)).rows[0]['Parcel Description'],plainDescription);
  assert.equal(fardarParcelDescription([{sku:'R1',product_name:'ළදරු භාණ්ඩ',variant_name:'නිල්',quantity:2}]),'R1 ළදරු භාණ්ඩ - නිල් x2');

  let dashboardCode=fs.readFileSync('src/components/admin/AdminDashboard.tsx','utf8');
  for(const plugin of viteConfig.plugins.flat(Infinity))if(plugin?.name?.startsWith('ora-')&&typeof plugin.transform==='function'){
    const result=await plugin.transform(dashboardCode,'/repo/src/components/admin/AdminDashboard.tsx');if(result)dashboardCode=typeof result==='string'?result:result.code;
  }
  assert(dashboardCode.includes('selectedOrders.filter(o => invoiceReady(o) && invoiceComplete(o))'));
  assert(dashboardCode.includes('const generated = await markInvoicesGenerated(selectedInvoiceIds'));
  assert(dashboardCode.includes('Fardar Upload CSV ({fardarBatchReady.length})'));
  assert(dashboardCode.includes('Retry Missing Invoices'));
  assert(dashboardCode.includes('{pendingInvoiceSavePanel}'));
  assert(dashboardCode.includes('const desc = fardarParcelDescription(o.items)'));
  assert(dashboardCode.includes("const blob = utf8CsvBlob([header.join(','),...rows].join('\\n'))"));

  const original=confirmedRows[7].payload;
  const correction={id:original.id,order_number:original.order_number,expected:canonicalJson(original),patch:{call_center_status:'Confirmed',order_status:'Processing',items:original.items,customer_name:'Corrected'},clear_fields:[]};
  assert(validConfirmCsvEntries([correction]));
  assert.equal((await fast('/api/orders/confirm-csv','POST',{entries:[correction]},'invalid')).status,401);
  assert.equal((await fast('/api/orders/confirm-csv','POST',{entries:[{...correction,patch:{...correction.patch,waybill_number:'NEW'}}]})).status,400);
  assert.equal((await fast('/api/orders/confirm-csv','POST',{entries:[correction,correction]})).status,400);
  assert.equal((await fast('/api/orders/confirm-csv','POST',{entries:Array(21).fill(correction)})).status,400);
  // Another staff member edits/locks the order between read and CAS. The retry
  // must inspect the newer durable order and reject the stale Confirm decision.
  const originalPut=rawBucket.put.bind(rawBucket);let race=true;
  rawBucket.put=async(key,value,options)=>{
    if(key===currentOrderKey&&race){
      race=false;const rows=JSON.parse(await (await bucket.get(key))!.text());
      const row=rows.find((row:any)=>row.order_id===original.id);row.payload.invoice_locked=true;row.payload.stock_allocated=true;row.payload.waybill_number='STAFF-LOCK';
      await bucket.put(key,JSON.stringify(rows),{onlyIf:{etagMatches:rawBucket.objects.get(key)!.etag}});
    }
    return originalPut(key,value,options);
  };
  const raced:any=await (await fast('/api/orders/confirm-csv','POST',{entries:[correction]})).json();
  rawBucket.put=originalPut;
  assert.equal(raced.results[0].status,'failed');assert.match(raced.results[0].error,/locked/);
  const locked=(await sdk.from('order_snapshots').select('payload').eq('order_id',original.id).single()).data!.payload;
  assert.equal(locked.customer_name,'Test Customer');assert.equal(locked.invoice_locked,true);assert.equal(locked.stock_allocated,true);assert.equal(locked.waybill_number,'STAFF-LOCK');
  const staleCorrection={...correction,id:confirmedRows[8].payload.id,order_number:confirmedRows[8].payload.order_number,expected:canonicalJson({...confirmedRows[8].payload,phone:'stale'})};
  const conflicted:any=await (await fast('/api/orders/confirm-csv','POST',{entries:[staleCorrection]})).json();
  assert.equal(conflicted.results[0].status,'failed');assert.match(conflicted.results[0].error,/changed/);
  const missing={...correction,id:'does-not-exist'};
  assert.equal((await (await fast('/api/orders/confirm-csv','POST',{entries:[missing]})).json() as any).results[0].status,'failed');
  const fullPaid=await parserScope.runConfirm(confirmCsv(1),undefined,'PAID-GROUP','full_paid');
  assert.equal(fullPaid.confirmedCount,1);assert.equal(fullPaid.errors.length,0);
  const paid=(await sdk.from('order_snapshots').select('payload').eq('order_id',confirmOrders[0].id).single()).data!.payload;
  assert.equal(paid.payment_method,'Bank Payment');assert.equal(paid.payment_status,'Paid');assert.equal(paid.payment_received_amount,350);assert.equal(paid.invoice_payment_label_snapshot,'FULLY PAID');
  const advanceCsv=confirmCsv(2).split('\n').filter((_,i)=>i!==1).join('\n');
  assert.equal((await parserScope.runConfirm(advanceCsv,undefined,'ADVANCE-GROUP','advance_50')).confirmedCount,1);
  const advance=(await sdk.from('order_snapshots').select('payload').eq('order_id',confirmOrders[1].id).single()).data!.payload;
  assert.equal(advance.payment_received_amount,175);assert.equal(advance.advance_amount,175);assert.equal(advance.advance_confirmed,true);
  const cancelCsv='Order ID,Item Code,Qty,Order Action\n'+confirmOrders[2].order_number+',R1,1,CANCEL ENTIRE ORDER';
  assert.equal((await parserScope.runConfirm(cancelCsv)).confirmedCount,1);
  const cancelEtag=rawBucket.objects.get(currentOrderKey)!.etag;
  assert.equal((await parserScope.runConfirm(cancelCsv)).ignoredCount,1);
  assert.equal(rawBucket.objects.get(currentOrderKey)!.etag,cancelEtag,'Repeated cancellation must not rewrite history');
  let unauthorizedAttempts=0;
  const notAuthorized=await saveConfirmCsvDecisions([correction],async()=>{unauthorizedAttempts++;const error:any=new Error('Login required');error.status=401;throw error;},async()=>{});
  assert.equal(unauthorizedAttempts,1);assert.equal(notAuthorized.saved.size,0);assert.equal(notAuthorized.errors.length,1);
  let malformedAttempts=0;
  const unverified=await saveConfirmCsvDecisions([correction],async()=>{malformedAttempts++;return {ok:true,results:[]};},async()=>{});
  assert.equal(malformedAttempts,4);assert.equal(unverified.saved.size,0);assert.equal(unverified.errors.length,1);

  // Run the actual isolated CSV page's script against the authenticated Worker
  // handlers. This covers parsing, batching, transient read failure and re-upload.
  const csvOrders=Array.from({length:21},(_,i)=>({id:'csv-'+i,order_number:'FB-CSV-'+i,order_status:'Shipped',waybill_number:'CSV-'+i,invoice_locked:true,stock_allocated:true,items:[],created_at:new Date().toISOString()}));
  await sdk.from('order_snapshots').upsert(csvOrders.map(order=>({order_id:order.id,order_number:order.order_number,payload:order})),{onConflict:'order_id'});
  const elements=new Map<string,any>();
  const element=(id:string)=>{if(!elements.has(id))elements.set(id,{style:{},textContent:'',handlers:new Map(),addEventListener(event:string,handler:any){this.handlers.set(event,handler);}});return elements.get(id);};
  const pageScript=fs.readFileSync('public/delivered-upload.html','utf8').match(/<script>([\s\S]*?)<\/script>/)![1];
  let transient=true,postedBatches=0;
  vm.runInNewContext(pageScript,{document:{getElementById:element},localStorage:{getItem:()=>token},setTimeout:(callback:any)=>{callback();return 0;},fetch:async(path:string,options:any={})=>{
    if(transient&&path==='/api/orders'){transient=false;return new Response(JSON.stringify({error:'temporary read failure'}),{status:503});}
    if(path.endsWith('/delivered-csv')){postedBatches++;assert(JSON.parse(options.body).entries.length<=20);}
    return withR2DataFallback(new Request('https://test'+path,options),env,{},async()=>new Response('Unexpected route',{status:599}));
  }});
  const csv='WAYBILL ID,DELIVERY STATUS,ORDER ID,DELIVERY FEE\n'+csvOrders.map(order=>order.waybill_number+',Delivered,'+order.order_number+',0').join('\n')+'\nCSV-0,Delivered,FB-CSV-0,0\nCSV-1,In Transit,FB-CSV-1,0';
  element('csvFile').handlers.get('change')({target:{files:[{name:'synthetic.csv',text:async()=>csv}]}});
  await element('uploadBtn').handlers.get('click')();
  assert.equal(postedBatches,2);assert(element('message').textContent.includes('Updated Shipped → Delivered: 21'),element('message').textContent);
  await element('uploadBtn').handlers.get('click')();
  assert(element('message').textContent.includes('Already Delivered: 21'));
  const csvSaved=(await sdk.from('order_snapshots').select('payload').eq('order_id','csv-0').single()).data?.payload;
  assert.equal(csvSaved.internal_delivery_fee,0);assert.equal(csvSaved.invoice_locked,true);assert.equal(csvSaved.stock_allocated,true);assert.equal(csvSaved.fardar_tracking_history.length,1);

  const auditNow=new Date().toISOString(),since=new Date(Date.now()-60000).toISOString();
  await sdk.from('order_snapshots').upsert({order_id:'imported',order_number:newOrder.order_number,payload:{...newOrder,platform_lead_id:'audit-lead'}},{onConflict:'order_id'});
  const auditRequest=(auth:string)=>new Request('https://test/api/admin/facebook-leads/audit',{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify({since,until:auditNow})});
  assert.equal((await facebookLeadAuditHandler(auditRequest('invalid'),env))!.status,401);
  assert.equal((await facebookLeadAuditHandler(auditRequest(staff.body.token),env))!.status,403);
  const metaFetch:any=async(input:any)=>{const url=new URL(String(input));return new Response(JSON.stringify(url.pathname.endsWith('/me')?{id:'page'}:url.pathname.endsWith('/leadgen_forms')?{data:[{id:'form-1',name:'Test form'}]}:{data:[{id:'audit-lead',created_time:auditNow},{id:'missing-lead',created_time:auditNow}]}));};
  const audited=await facebookLeadAuditHandler(auditRequest(token),{...env,META_PAGE_ACCESS_TOKEN:'synthetic-token'},metaFetch);
  const audit:any=await audited!.json();assert(audit.done);assert.equal(audit.leads.length,2);assert.equal(audit.leads[0].order_number,newOrder.order_number);assert.equal(audit.leads[1].order_number,null);

  // Exercise the actual audit page through all 38 forms, Meta pagination and
  // physical Sheet checks. An intermediate report must never look final.
  const auditOrders=[newOrder,{...newOrder,id:'audit-order-2',order_number:'FB-AUDIT-2',platform_lead_id:'late-lead',items:[{quantity:1},{quantity:1}]}];
  await sdk.from('order_snapshots').upsert({order_id:'audit-order-2',order_number:'FB-AUDIT-2',payload:auditOrders[1]},{onConflict:'order_id'});
  await sdk.from('admin_data_store').upsert({...fixture.admin_data_store[0],payload:{...fixture.admin_data_store[0].payload,settings:{google_sheet_webhook_url:'https://script.google.com/macros/s/synthetic/exec'}}},{onConflict:'key'});
  const forms=Array.from({length:38},(_,i)=>({id:'form-'+String(i).padStart(2,'0'),name:'Form '+i}));
  const fullMetaFetch:any=async(input:any,options:any={})=>{
    const url=new URL(String(input));
    if(url.hostname==='script.google.com'){
      const body=JSON.parse(options.body);assert.equal(body.action,'read_order');assert.deepEqual(Object.keys(body).sort(),['action','orderId']);
      return new Response(JSON.stringify({ok:true,status:'order_checked',found:true,rows:1}));
    }
    assert.equal(options.headers.authorization,'Bearer synthetic-token');
    if(url.pathname.endsWith('/me'))return Response.json({id:'page'});
    if(url.pathname.endsWith('/leadgen_forms'))return Response.json(url.searchParams.has('after')?{data:forms.slice(20)}:{data:forms.slice(0,20),paging:{next:'present',cursors:{after:'forms-page-2'}}});
    const id=url.pathname.split('/').at(-2);
    if(id==='form-00'||id==='form-10')return Response.json({data:[{id:'audit-lead',created_time:auditNow}]});
    if(id==='form-18')return Response.json({data:[{id:'missing-lead',created_time:auditNow}]});
    if(id==='form-37')return Response.json(url.searchParams.has('after')?{data:[{id:'late-lead',created_time:auditNow}]}:{data:[],paging:{next:'present',cursors:{after:'leads-page-2'}}});
    return Response.json({data:[{id:'old-lead',created_time:'2020-01-01T00:00:00Z'}]});
  };
  const auditPageScript=fs.readFileSync('public/fb-lead-audit.html','utf8').match(/<script>([\s\S]*?)<\/script>/)![1];
  const runAuditPage=async(fetchPage:any)=>{
    const els=new Map<string,any>();let intervals=0,cleared=0,copied='';
    const el=(id:string)=>{if(!els.has(id))els.set(id,{textContent:'',value:'',disabled:id==='copy',focus(){},select(){}});return els.get(id);};
    vm.runInNewContext(auditPageScript,{document:{getElementById:el},localStorage:{getItem:()=>token},AbortController,navigator:{clipboard:{writeText:async(value:string)=>{copied=value;}}},setInterval:()=>++intervals,clearInterval:()=>{cleared++;},setTimeout:(callback:any,ms:number)=>{if(ms<45000)queueMicrotask(callback);return 0;},clearTimeout:()=>{},fetch:async(path:string,options:any)=>{
      assert.equal(el('copy').disabled,true,'Copy final report is unavailable while the audit runs');
      const intermediate=JSON.parse(el('report').value);assert.equal(intermediate.status,'running');assert.equal(intermediate.complete,false);assert.equal(intermediate.checked_at,null);
      return fetchPage(path,options);
    }});
    await el('run').onclick();assert.equal(intervals,cleared,'Progress heartbeat stops on success and failure');assert.equal(el('run').disabled,false);assert.equal(el('copy').disabled,false);
    await el('copy').onclick();assert.equal(copied,el('report').value);
    return {report:JSON.parse(el('report').value),status:el('status').textContent};
  };
  let retryCount=0;const offsets:number[]=[];
  const fullPage=await runAuditPage(async(path:string,options:any)=>{
    if(retryCount++===0)return new Response('Temporary upstream failure',{status:503});
    const body=JSON.parse(options.body);if(body.action!=='sheet')offsets.push(body.offset);
    return facebookLeadAuditHandler(new Request('https://test'+path,options),{...env,META_PAGE_ACCESS_TOKEN:'synthetic-token'},fullMetaFetch);
  });
  assert.equal(fullPage.report.complete,true);assert.equal(fullPage.report.status,'complete');assert.equal(fullPage.report.phase,'finished');
  assert.equal(fullPage.report.forms_checked,38);assert.equal(fullPage.report.total_forms,38);assert.equal(fullPage.report.sheet_orders_checked,2);
  assert.deepEqual(offsets,Array.from({length:19},(_,i)=>i*2));assert.equal(fullPage.report.leads.length,3,'Duplicate leads across forms are deduplicated');
  assert.deepEqual(fullPage.report.summary,{facebook_leads:3,system_matched:2,missing_in_system:1,missing_or_partial_in_sheet:1});
  assert(fullPage.status.includes('Audit complete.'));assert(fullPage.status.includes('38 / 38'));
  const failedPage=await runAuditPage(async()=>new Response('Source unavailable',{status:503}));
  assert.equal(failedPage.report.complete,false);assert.equal(failedPage.report.status,'incomplete');assert.equal(failedPage.report.forms_checked,0);assert.equal(failedPage.report.errors.length,1);
  const truncatedPage=await runAuditPage(async()=>Response.json({ok:true,total_forms:38,forms_checked:0,next_offset:0,form_list:'forms',leads:[],errors:[],done:false}));
  assert.equal(truncatedPage.report.complete,false);assert.equal(truncatedPage.report.errors.length,1,'No-progress responses must terminate instead of loop forever');
  const partialSourcePage=await runAuditPage(async(path:string,options:any)=>facebookLeadAuditHandler(new Request('https://test'+path,options),{...env,META_PAGE_ACCESS_TOKEN:'synthetic-token'},async(input:any,init:any)=>String(input).includes('/form-18/leads')?Response.json({error:{code:4}},{status:429}):fullMetaFetch(input,init)));
  assert.equal(partialSourcePage.report.forms_checked,38);assert.equal(partialSourcePage.report.complete,false);assert.equal(partialSourcePage.report.status,'incomplete');assert.equal(partialSourcePage.report.errors.length,1,'A failed source form prevents an all-clear result');
  const partialSheetPage=await runAuditPage(async(path:string,options:any)=>{
    if(JSON.parse(options.body).action==='sheet')return Response.json({ok:true,results:[]});
    return facebookLeadAuditHandler(new Request('https://test'+path,options),{...env,META_PAGE_ACCESS_TOKEN:'synthetic-token'},fullMetaFetch);
  });
  assert.equal(partialSheetPage.report.complete,false);assert.equal(partialSheetPage.report.errors.length,1,'Missing Sheet read-back results must prevent completion');
  const sourceFailure=await facebookLeadAuditHandler(auditRequest(token),{...env,META_PAGE_ACCESS_TOKEN:'synthetic-token'},async()=>{throw new Error('private details');});
  assert.equal(sourceFailure!.status,503);assert(!(await sourceFailure!.text()).includes('private details'));
  rawBucket.failKey=active.prefix+'order_snapshots.json';
  const failed=await request('/api/orders/order-1','PUT',{order:fixture.orders[0]},token);
  assert.equal(failed.status,500,'A failed R2 write must never return success');rawBucket.failKey='';
  const saved=rawBucket.objects.get(active.prefix+'order_snapshots.json')!;
  rawBucket.objects.set(active.prefix+'order_snapshots.json',{...saved,value:'corrupt',etag:String(++rawBucket.revision)});
  const invalid=await request('/api/orders','GET',undefined,token);
  assert.equal(invalid.status,503,'Corrupt storage must not be shown as an empty database');
  assert.equal((await fast('/api/orders')).status,503,'Fast reads must also fail on new corrupt data');
  rawBucket.objects.set(active.prefix+'order_snapshots.json',saved);
  const denied=await withR2DataFallback(new Request('https://test/api/cloudflare-recovery/import',{method:'POST',body:JSON.stringify(fixture)}),env,{},async()=>new Response('unreachable'));
  assert.equal(denied.status,410,'One-time imports are disabled after recovery');
}finally{server.close();}

// An incomplete staged import never switches the live source.
const failing=new MemoryBucket();failing.failKey=ACTIVE_KEY;
await assert.rejects(()=>importRecovery(failing,fixture));
assert.equal(await activeData(failing),null);

// Lossless encrypted codec: old readers-with-compression-disabled still decode
// v2; Unicode, zero values, lock fields and every byte of JSON survive unchanged.
const codecRaw=new MemoryBucket(),codecEnv={...env,ORA_MEDIA_R2:codecRaw};
const legacyCodec=dataBucket({...codecEnv,ORA_R2_COMPRESSION_ENABLED:'0'})!;
const codec=dataBucket(codecEnv)!;
const sample=JSON.stringify(Array.from({length:440},(_,i)=>({...fixture.orders[0],id:'sample-'+i,order_number:'FB-'+String(i+1).padStart(6,'0'),waybill_number:'SAMPLE-'+i,customer_name:'පරීක්ෂණය 🩵 '+i,delivery_fee:0,stock_allocated:true,extra:null,note:'Synthetic '+crypto.randomBytes(32).toString('hex'),items:[{id:crypto.randomUUID(),product_id:'sample-product-'+i%55,quantity:i%4+1,unit_price:1090,subtotal:1090*(i%4+1)}]})));
const sampleKey='ora-data/generations/test/order_snapshots.json',backupKey='ora-data/backups-v2/order_snapshots/1.json';
await legacyCodec.put(sampleKey,sample,{customMetadata:{oraData:'1',hour:'123'}});
const oldBytes=Buffer.byteLength(codecRaw.objects.get(sampleKey)!.value);
assert.equal(await codec.compact!(sampleKey),'compacted');
const compacted=codecRaw.objects.get(sampleKey)!;
assert.equal(JSON.parse(compacted.value).format,'ora-aes-gcm-v2');assert.deepEqual(compacted.customMetadata,{oraData:'1',hour:'123'});
assert.equal(await (await codec.get(sampleKey))!.text(),sample);assert.equal(await (await legacyCodec.get(sampleKey))!.text(),sample);
assert(Buffer.byteLength(compacted.value)<oldBytes/3,'Representative order snapshots must shrink meaningfully');
await codec.put(backupKey,sample);assert.equal(await (await codec.get(backupKey))!.text(),sample);
codecRaw.objects.set('ora-data/generations/test/moved.json',compacted);
await assert.rejects(()=>(codec.get('ora-data/generations/test/moved.json')).then(object=>object!.text()),'Ciphertext remains bound to its object path');
const changedFormat={...JSON.parse(compacted.value),format:'ora-aes-gcm-v1'};
codecRaw.objects.set(sampleKey,{...compacted,value:JSON.stringify(changedFormat),etag:'tampered'});
await assert.rejects(()=>(codec.get(sampleKey)).then(object=>object!.text()),'The compression encoding is authenticated');
codecRaw.objects.set(sampleKey,compacted);
await codec.put('ora-data/generations/test/small.json','[]');assert.equal(JSON.parse(codecRaw.objects.get('ora-data/generations/test/small.json')!.value).format,'ora-aes-gcm-v1');
assert.equal(await codec.compact!(sampleKey),'skipped','Already compressed data is not rewritten');

const concurrentSample=sample+'\n';await legacyCodec.put(sampleKey,sample);
const originalPut=codecRaw.put.bind(codecRaw);let interleaved=true;
codecRaw.put=async(key,value,settings)=>{
  if(key===sampleKey&&interleaved&&settings?.onlyIf?.etagMatches){interleaved=false;await legacyCodec.put(sampleKey,concurrentSample);}
  return originalPut(key,value,settings);
};
assert.equal(await codec.compact!(sampleKey),'conflict');assert.equal(await (await codec.get(sampleKey))!.text(),concurrentSample,'Encoding migration cannot overwrite a concurrent staff edit');
assert.equal(await codec.compact!(sampleKey),'compacted');assert.equal(await (await codec.get(sampleKey))!.text(),concurrentSample);

const migrationRaw=new MemoryBucket(),migrationEnv={...env,ORA_MEDIA_R2:migrationRaw};
const migrationLegacy=dataBucket({...migrationEnv,ORA_R2_COMPRESSION_ENABLED:'0'})!;
await importRecovery(migrationLegacy,{...fixture,orders:JSON.parse(sample)});
const migrationActive=(await activeData(migrationLegacy))!;
await migrationLegacy.put(backupKey,sample,{customMetadata:{hour:'123'}});
const beforeMigration=await (await migrationLegacy.get(migrationActive.prefix+'order_snapshots.json'))!.text();
for(let i=0;i<25;i++)await compactR2StorageOnce(migrationEnv);
const migrationCodec=dataBucket(migrationEnv)!;
assert.equal(await (await migrationCodec.get(migrationActive.prefix+'order_snapshots.json'))!.text(),beforeMigration);
assert.equal(JSON.parse(migrationRaw.objects.get(backupKey)!.value).format,'ora-aes-gcm-v2');
assert.equal(JSON.parse(await (await migrationCodec.get('ora-data/compression-progress-v1.json'))!.text()).stage,'done');
const migrationRevision=migrationRaw.revision;await compactR2StorageOnce(migrationEnv);assert.equal(migrationRaw.revision,migrationRevision,'Completed compaction does not rewrite checkpoints');

// Exact public image bytes are reused for duplicate catalog/branding uploads;
// customer submissions keep unique paths, and private data is never served.
const mediaObjects=new Map<string,Buffer>();let mediaWrites=0;
const mediaBucket={get:async(key:string)=>mediaObjects.has(key)?{body:mediaObjects.get(key)}:null,put:async(key:string,value:any,settings:any)=>{if(settings.onlyIf?.etagDoesNotMatch==='*'&&mediaObjects.has(key))return null;mediaObjects.set(key,Buffer.from(value));mediaWrites++;return {etag:'test'};}};
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2LsAAAAASUVORK5CYII=','base64');
const upload=async(purpose:string)=>{
  const request=new Request('https://test/api/uploads/image',{method:'POST',body:JSON.stringify({purpose,dataUrl:'data:image/png;base64,'+image.toString('base64')})});
  return (await (await r2MediaHandler(request,{ORA_MEDIA_R2:mediaBucket}))!.json()) as any;
};
const mediaResults=await Promise.all(Array.from({length:5},()=>upload('product')));
assert.equal(new Set(mediaResults.map(result=>result.url)).size,1);assert.equal(mediaWrites,1);assert.deepEqual(mediaObjects.get(mediaResults[0].key),image);
assert.notEqual((await upload('branding')).url,mediaResults[0].url);
assert.notEqual((await upload('payment-receipt')).url,(await upload('payment-receipt')).url);
assert.equal((await r2MediaHandler(new Request('https://test/api/media/ora-data/active-v2.json'),{ORA_MEDIA_R2:mediaBucket}))!.status,404);
console.log('Compression fixture:',JSON.stringify({legacy_bytes:oldBytes,compressed_bytes:Buffer.byteLength(compacted.value),saved_percent:Number((100*(1-Buffer.byteLength(compacted.value)/oldBytes)).toFixed(1))}));
console.log('PASS: Confirm CSV production parser (12 orders/7 already saved, 503 retries, lost response, packing/history, CAS staff locks, stale/missing orders, paid/advance/cancel and strict acknowledgments); native website save/version conflict/replay/public settings/session refresh; invoice queue (9 ready/7 existing, failed/lost-response retries, existing locks/history, production auto/manual acknowledgment and UTF-8 CSV); read-only Confirm/invoice audit; R2 encryption/compression, media dedup, backups/auth, Delivered CSV, Facebook audit and failed writes.');
