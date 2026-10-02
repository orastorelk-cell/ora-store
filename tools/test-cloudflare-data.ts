import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ACTIVE_KEY, activeData, configureCloudflareData, cloudflareDataFetch, dataBucket, importRecovery } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';

class MemoryBucket {
  objects=new Map<string,{value:string;etag:string;customMetadata:any}>();
  revision=0;
  failKey='';
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
const env={ORA_MEDIA_R2:rawBucket,VITE_SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:secret,STAFF_SESSION_SECRET:sessionSecret};
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
assert([...rawBucket.objects.values()].every(object=>JSON.parse(object.value).format==='ora-aes-gcm-v1'),'Private records and backups must be encrypted');

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
  rawBucket.failKey=active.prefix+'order_snapshots.json';
  const failed=await request('/api/orders/order-1','PUT',{order:fixture.orders[0]},token);
  assert.equal(failed.status,500,'A failed R2 write must never return success');rawBucket.failKey='';
  const saved=rawBucket.objects.get(active.prefix+'order_snapshots.json')!;
  rawBucket.objects.set(active.prefix+'order_snapshots.json',{...saved,value:'corrupt'});
  const invalid=await request('/api/orders','GET',undefined,token);
  assert.equal(invalid.status,503,'Corrupt storage must not be shown as an empty database');
  rawBucket.objects.set(active.prefix+'order_snapshots.json',saved);
  const denied=await withR2DataFallback(new Request('https://test/api/cloudflare-recovery/import',{method:'POST',body:JSON.stringify(fixture)}),env,{},async()=>new Response('unreachable'));
  assert.equal(denied.status,410,'One-time imports are disabled after recovery');
}finally{server.close();}

// An incomplete staged import never switches the live source.
const failing=new MemoryBucket();failing.failKey=ACTIVE_KEY;
await assert.rejects(()=>importRecovery(failing,fixture));
assert.equal(await activeData(failing),null);
console.log('PASS: R2 recovery, SDK reads/writes/counts, concurrency, unique IDs, backups, auth, bulk import, invoice/waybill locks, corruption and failed-write handling.');
