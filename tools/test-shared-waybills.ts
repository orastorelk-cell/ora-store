import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { importRecovery, dataBucket, activeData, readDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { r2AssignWaybill } from '../worker/r2Waybills';

class MemoryBucket{
  objects=new Map<string,any>();revision=0;failKey='';
  async get(key:string){const row=this.objects.get(key);return row?{etag:row.etag,text:async()=>row.text,customMetadata:row.meta}:null;}
  async put(key:string,text:string,options:any={}){
    if(this.failKey===key)throw Error('simulated interrupted order commit');
    const old=this.objects.get(key);
    if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches||options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;
    const row={text,meta:options.customMetadata,etag:String(++this.revision)};this.objects.set(key,row);return {etag:row.etag};
  }
}
const raw=new MemoryBucket(),secret='shared-waybill-synthetic-secret';
const env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:secret,ORA_R2_COMPRESSION_ENABLED:'1'};
const now='2026-10-03T12:00:00.000Z';
const makeOrder=(id:string)=>({id,order_number:'FB-'+id,call_center_status:'Confirmed',order_status:'Processing',stock_allocated:true,stock_status:'Allocated',stock_allocated_at:now,call_center_updated_at:now,confirm_upload_batch_id:'PACK-UPLOAD-7',items:[{sku:'TEST',quantity:1}],created_at:now});
const existing=Array.from({length:4},(_,i)=>({...makeOrder('saved-'+i),waybill_number:'180000'+i,invoice_locked:true,invoice_number:'INV-'+i,invoice_generated_at:now,invoice_pack_batch_id:'PACK-UPLOAD-7',invoice_pack_downloaded_at:now}));
const missing=[makeOrder('431'),makeOrder('435')],waiting={...makeOrder('432'),stock_allocated:false,stock_status:'Waiting for Stock'};
await importRecovery(dataBucket(env)!,{format:'ora-r2-recovery-v1',orders:[...existing,...missing,waiting],
  admin_users:[{id:'admin',role:'admin',is_active:true}],admin_data_store:[{key:'storefront-state-v1',payload:{version:1,products:[{id:'test',stock_quantity:0}],categories:[],settings:{}}}],
  courier_waybills:[...existing.map(o=>({waybill_number:o.waybill_number,status:'Assigned',assigned_order_number:o.order_number})),
    {waybill_number:'18160523',status:'Cancelled',permanently_retired:true},{waybill_number:'18160544',status:'Cancelled',permanently_retired:true},
    {waybill_number:'18160613',status:'Available',courier_name:'Fardar',imported_at:now},{waybill_number:'18160614',status:'Available',courier_name:'Fardar',imported_at:now}]});
const originalExisting=JSON.stringify(existing),originalProducts=JSON.stringify((await readDataTable(env,'admin_data_store'))[0].payload.products);
const payload=Buffer.from(JSON.stringify({sub:'admin',role:'admin',exp:Date.now()+3600000})).toString('base64url');
const token=payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url');
const request=async(path:string,method='GET',body?:any,auth=token)=>withR2DataFallback(new Request('https://synthetic'+path,{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{},async()=>new Response('Unexpected legacy bridge',{status:599}));
assert.equal((await request('/api/courier/waybills','GET',undefined,'invalid')).status,401);
const wire:any=await (await request('/api/orders?format=snapshots')).json();assert.equal(wire.snapshots.length,7);assert.equal(wire.snapshots[4].payload.id,'431');
const report:any=await (await request('/api/orders/fulfilment-status?orders=FB-431,FB-435,FB-432')).json();assert.equal(report.pool.available,2);assert.deepEqual(report.orders.map((o:any)=>o.reason),['Waiting for waybill','Waiting for waybill','Waiting for stock']);
const manifest=(await activeData(dataBucket(env)!))!;
raw.failKey=manifest.prefix+'order_snapshots.json';
await assert.rejects(r2AssignWaybill(env,'431'),/interrupted order commit/);
const reservation=(await readDataTable(env,'courier_waybills')).find(r=>r.assigned_order_number==='FB-431')!;
assert.equal(reservation.waybill_number,'18160613');
raw.failKey='';
const first=await r2AssignWaybill(env,'431');assert.equal(first.waybill_number,reservation.waybill_number,'Lost commit retries must resume the same waybill');
const simultaneous=await Promise.all([r2AssignWaybill(env,'435'),r2AssignWaybill(env,'435')]);assert.equal(new Set(simultaneous.map(o=>o.waybill_number)).size,1);assert.equal(simultaneous[0].waybill_number,'18160614');
await assert.rejects(r2AssignWaybill(env,'432'),/allocate stock/);
const saved:any=await (await request('/api/orders/invoices/ensure','POST',{order_ids:['431','435'],batch_id:'PACK-RECOVERY-test',automatic:true})).json();assert.equal(saved.results.filter((r:any)=>r.status==='saved').length,2);
const repeated:any=await (await request('/api/orders/invoices/ensure','POST',{order_ids:['431','435'],batch_id:'PACK-RECOVERY-again',automatic:true})).json();assert(repeated.results.every((r:any)=>r.status==='already_saved'));
const all=(await readDataTable(env,'order_snapshots')).map(r=>r.payload);assert.equal(JSON.stringify(all.slice(0,4)),originalExisting);assert.equal(new Set(all.map(o=>o.waybill_number).filter(Boolean)).size,6);
assert.equal(JSON.stringify((await readDataTable(env,'admin_data_store'))[0].payload.products),originalProducts,'Retrying invoices/waybills must never deduct stock again');
await request('/api/courier/waybills/import','POST',{records:[{waybill_number:'18160523',status:'Available'},{waybill_number:'18160544',status:'Available'},{waybill_number:'18160613',status:'Available'}]});
const pool=(await readDataTable(env,'courier_waybills'));assert.equal(pool.find(r=>r.waybill_number==='18160523')!.status,'Cancelled');assert.equal(pool.find(r=>r.waybill_number==='18160544')!.status,'Cancelled');assert.equal(pool.find(r=>r.waybill_number==='18160613')!.status,'Assigned');
assert.equal((await (await request('/api/orders/version')).json()).count,7);
const imported:any=await (await request('/api/courier/waybills/import','POST',{records:[{waybill_number:'18160615',status:'Available',courier_name:'Fardar'}]})).json();assert.equal(imported.added,1);
assert.equal((await (await request('/api/courier/waybills/import','POST',{records:[{waybill_number:'18160615',status:'Available'}]})).json()).added,0);
console.log('PASS: 7 confirmed orders / 4 existing invoices / 2 missing waybills / 1 stock shortage; interrupted commit resumes same reservation; concurrent retries do not duplicate waybills or invoices; retired waybills stay locked; stock and existing invoices unchanged; authenticated shared pool and lightweight order reads.');
