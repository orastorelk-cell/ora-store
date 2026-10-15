import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ACTIVE_KEY,dataBucket,readDataTable,readDataTableWire,replaceDataTable,mutateDataTable,configureCloudflareData,cloudflareDataFetch } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { staffJsonRequest } from '../src/lib/staffRequest';

class MemoryBucket {
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>();revision=0;guard=false;failShard=false;loseManifestAck=false;writes:{key:string;bytes:number}[]=[];
  async get(key:string){const object=this.objects.get(key);return object?{...object,text:async()=>object.value}:null;}
  async put(key:string,value:string,options:any={}){
    if(this.guard){assert(!key.endsWith('/order_snapshots.json'),'A live order write must never rewrite the recovered history');assert(value.length<100000,'A small order save must not upload the full history');this.writes.push({key,bytes:value.length});}
    if(this.failShard&&key.includes('/order-changes-v1/')){this.failShard=false;throw new Error('Synthetic interrupted shard upload');}
    const previous=this.objects.get(key),condition=options.onlyIf;
    if(condition?.etagMatches&&condition.etagMatches!==previous?.etag||condition?.etagDoesNotMatch==='*'&&previous)return null;
    const etag=String(++this.revision);this.objects.set(key,{value,etag,customMetadata:options.customMetadata});
    if(this.loseManifestAck&&key.endsWith('/order-changes-v1.json')){this.loseManifestAck=false;throw new Error('503 lost manifest acknowledgment');}
    return {etag};
  }
}
const raw=new MemoryBucket(),env={ORA_MEDIA_R2:raw,STAFF_SESSION_SECRET:'journal-'+crypto.randomUUID(),ORA_R2_COMPRESSION_ENABLED:'1',VITE_SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'synthetic-service-key'};
const bucket=dataBucket(env)!,prefix='ora-data/generations/journal-test/';
const history=Array.from({length:3000},(_,i)=>({order_id:'old-'+i,order_number:'FB-'+String(i+1).padStart(6,'0'),created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',
  payload:{id:'old-'+i,order_number:'FB-'+String(i+1).padStart(6,'0'),customer_name:'Historical Buyer '+i,phone:'0711111111',created_at:'2026-01-01T00:00:00Z',order_status:'Delivered',invoice_number:'OLD-INV-'+i,waybill_number:'OLD-WB-'+i,stock_allocated:true,items:[],notes:'පැරණි order history 🩵 '+crypto.randomBytes(1600).toString('hex')}}));
await bucket.put(ACTIVE_KEY,JSON.stringify({format:'ora-r2-tables-v2',prefix}));
await bucket.put(prefix+'order_snapshots.json',JSON.stringify(history));
await bucket.put(prefix+'__sequences.json',JSON.stringify(['WEB','FB','TK','MAN'].map(id=>({id,value:id==='FB'?3000:0}))));
await bucket.put(prefix+'admin_data_store.json',JSON.stringify([{key:'storefront-state-v1',payload:{products:[{id:'p1',sku:'P1',selling_price:100,stock_quantity:10}],categories:[],settings:{}}}]));
const base=raw.objects.get(prefix+'order_snapshots.json')!;raw.guard=true;
const order={id:'ord-'+crypto.randomUUID(),order_source:'Website',customer_name:'Journal Buyer',phone:'0770000000',whatsapp:'0770000000',address:'Fixture Road No 10',city:'Naiwala',payment_method:'COD',subtotal:100,delivery_fee:250,total_amount:350,items:[{product_id:'p1',quantity:1,unit_price:100,subtotal:100}]};
const submit=()=>withR2DataFallback(new Request('https://store.test/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({order})}),env,{},async()=>{throw new Error('Native website save must not start Express');});
raw.loseManifestAck=true;
assert.equal((await submit()).status,200,'A lost commit acknowledgment is recovered using the original order ID');
assert.equal((await submit()).status,200);
let rows=await readDataTable(env,'order_snapshots');assert.equal(rows.length,3001);assert.equal(rows.filter(row=>row.order_id===order.id).length,1);
assert.equal(raw.objects.get(prefix+'order_snapshots.json'),base,'The encrypted recovered history is preserved byte-for-byte');
assert.equal(JSON.stringify(rows.find(row=>row.order_id==='old-42')),JSON.stringify(history[42]));
const failedRevision=raw.objects.get(prefix+'order-changes-v1.json')!.etag;raw.failShard=true;
await assert.rejects(replaceDataTable(env,'order_snapshots',current=>({rows:current.map(row=>['old-4','old-9'].includes(row.order_id)?{...row,payload:{...row.payload,notes:'must not partially appear'}}:row),result:true})),/interrupted/);
assert.equal(raw.objects.get(prefix+'order-changes-v1.json')!.etag,failedRevision);
rows=await readDataTable(env,'order_snapshots');assert.equal(rows.find(row=>row.order_id==='old-4')!.payload.notes,history[4].payload.notes);
await Promise.all(Array.from({length:4},(_,i)=>replaceDataTable(env,'order_snapshots',current=>({rows:current.map(row=>row.order_id==='old-'+i?{...row,payload:{...row.payload,call_center_note:'concurrent-'+i}}:row),result:true}))));
rows=await readDataTable(env,'order_snapshots');for(let i=0;i<4;i++)assert.equal(rows.find(row=>row.order_id==='old-'+i)!.payload.call_center_note,'concurrent-'+i);
await mutateDataTable(env,'order_snapshots',current=>{current.splice(current.findIndex(row=>row.order_id==='old-20'),1);const saved=current.find(row=>row.order_id===order.id)!;saved.payload.is_synced_google_sheets=true;});
const coldEnv={...env,ORA_MEDIA_R2:{get:raw.get.bind(raw),put:raw.put.bind(raw)}};
rows=await readDataTable(coldEnv,'order_snapshots');assert.equal(rows.length,3000);assert(!rows.some(row=>row.order_id==='old-20'),'Deleted historical rows cannot resurrect on a cold read');
assert.equal(rows.find(row=>row.order_id===order.id)!.payload.is_synced_google_sheets,true);
const wire=await readDataTableWire(coldEnv,'order_snapshots');assert.deepEqual(JSON.parse(await wire.text()),rows);assert.equal(Number(wire.customMetadata!.oraCount),3000);
const journalWire=await readDataTableWire(coldEnv,'order_snapshots',true);
assert.equal(await journalWire.text(),JSON.stringify(history),'Staff reads forward the untouched serialized history without rebuilding it');
const network=globalThis.fetch;
try{
  globalThis.fetch=async(_url:any,options:any)=>{assert.equal(options.headers.get('x-ora-order-journal'),'1');return Response.json({snapshots:history,snapshot_changes:JSON.parse(journalWire.changes!),snapshot_count:journalWire.count});};
  const browser=await staffJsonRequest('/api/orders?format=snapshots');assert.deepEqual(browser.snapshots,rows);
  globalThis.fetch=async()=>Response.json({snapshots:history,snapshot_changes:[],snapshot_count:1});
  await assert.rejects(staffJsonRequest('/api/orders?format=snapshots'),/could not be verified/,'A partial history cannot replace the staff order list');
}finally{globalThis.fetch=network;}
configureCloudflareData(coldEnv);
const sdkRead=await cloudflareDataFetch(env.VITE_SUPABASE_URL+'/rest/v1/order_snapshots?order_id=eq.'+order.id,{headers:{apikey:env.SUPABASE_SECRET_KEY}});
assert.equal((await sdkRead.json())[0].payload.is_synced_google_sheets,true,'Legacy server reads see the same committed journal');
assert.equal(raw.objects.get(prefix+'order_snapshots.json'),base);
assert(raw.writes.every(write=>write.bytes<100000));
const backup=(await bucket.get('ora-data/backups-v2/order_snapshots/'+Math.floor(Date.now()/3600000)%168+'.json'))!;
assert.equal(JSON.parse(await backup.text()).format,'ora-order-checkpoint-v1');
console.log('PASS: 3000-order history preserved; bounded encrypted writes, lost-ack idempotency, atomic interrupted uploads, concurrent edits, tombstones, cold reads, wire versions, server adapter and small hourly checkpoints.');
