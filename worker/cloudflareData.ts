// Private R2 persistence for the existing server repository. Business rules and
// authorization stay in Express; this implements only the REST queries it uses.
import { Buffer } from 'node:buffer';
import { constants as zlibConstants, gzip, gunzip } from 'node:zlib';
type Row = Record<string, any>;
export type DataBucket = {
  get(key: string): Promise<{ text(): Promise<string>; etag: string; customMetadata?: Record<string,string> } | null>;
  put(key: string, value: string, options?: any): Promise<{ etag: string } | null>;
  compact?(key:string):Promise<'compacted'|'skipped'|'conflict'>;
};
type Runtime = Record<string, any>;
export const ACTIVE_KEY = 'ora-data/active-v2.json';
const META_KEY = 'ora-data/meta-v1.json';
const primaryKeys: Record<string,string> = {
  order_snapshots:'order_id', admin_data_store:'key', admin_users:'id', courier_waybills:'waybill_number',
  fardar_cities:'id', fardar_city_mappings:'input_key', customer_profiles:'user_id',
  customer_reviews:'id', product_requests:'id', activity_logs:'id', blocked_customers:'id',
  categories:'id', customers:'id', dispatch_events:'id', order_abuse_events:'id',
  order_items:'id', orders:'id', products:'id', purchase_orders:'id', stock_history:'id', store_settings:'id',
};
const legacyKeys: Record<string,string> = {
  order_snapshots:'ora-data/orders-v1.json', admin_data_store:'ora-data/admin-data-v1.json',
  admin_users:'ora-data/admin-users-v1.json', courier_waybills:'ora-data/courier-waybills-v1.json',
};
// These two originals were recovered byte-for-byte from the repository and
// checked against storage.objects ETags before being uploaded to R2.
const recoveredBrandImages=new Map<string,string>([
  ['https://xoipahpyxatdafhqkzcr.supabase.co/storage/v1/object/public/ora-public-media/branding-1786881008119-eafc5b2520.png','/api/media/media/branding/2026/10/02/1790916184720-b7eef2808f2e4990.png'],
  ['https://xoipahpyxatdafhqkzcr.supabase.co/storage/v1/object/public/ora-public-media/branding-1786925282175-19bb77b878.png','/api/media/media/branding/2026/10/02/1790916182739-cae1090f295a44e7.png'],
]);
const migratedBrandPrefixes=new Set<string>();
export const resolveKnownBrandImages=(settings:Record<string,any>)=>{
  const next={...settings};
  for(const field of ['website_logo','black_logo']){
    const original=recoveredBrandImages.get(next[field]);if(original)next[field]=original;
  }
  return next;
};
let runtime: Runtime | undefined;
const networkFetch = globalThis.fetch.bind(globalThis);
export const configureCloudflareData = (env: unknown) => { runtime = env as Runtime; };
export const compressionEnabled=(env:unknown)=>String((env as Runtime)?.ORA_R2_COMPRESSION_ENABLED||'')==='1';
const gzipFast=(bytes:Uint8Array)=>new Promise<Buffer>((resolve,reject)=>gzip(bytes,{level:zlibConstants.Z_BEST_SPEED},(error,result)=>error?reject(error):resolve(result)));
const unzip=(bytes:Uint8Array)=>new Promise<Buffer>((resolve,reject)=>gunzip(bytes,(error,result)=>error?reject(error):resolve(result)));
const encryptedBuckets=new WeakMap<object,{secret:string;compress:boolean;bucket:DataBucket}>();
export const dataBucket = (env: unknown = runtime): DataBucket | null => {
  const bucket = (env as Runtime)?.ORA_MEDIA_R2;
  if(!bucket?.get || !bucket?.put)return null;
  const secret=String((env as Runtime)?.STAFF_SESSION_SECRET||(env as Runtime)?.ABUSE_HASH_SALT||'');
  const compress=compressionEnabled(env);
  if(!secret)throw new Error('A private STAFF_SESSION_SECRET is required for Cloudflare data storage.');
  const existing=encryptedBuckets.get(bucket);
  if(existing?.secret===secret&&existing.compress===compress)return existing.bucket;
  const key=crypto.subtle.digest('SHA-256',new TextEncoder().encode('ora-r2-data-v2:'+secret))
    .then(bytes=>crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']));
  const decode=async(path:string,text:string)=>{
    const envelope=JSON.parse(text);
    if(['ora-aes-gcm-v1','ora-aes-gcm-v2'].includes(envelope?.format)) {
      const compressed=envelope.format==='ora-aes-gcm-v2';
      if(compressed&&envelope.encoding!=='gzip')throw new Error('Unsupported private data encoding.');
      const context=compressed?path+'\nora-aes-gcm-v2:gzip':path;
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:new TextEncoder().encode(context)},await key,Buffer.from(envelope.data,'base64'));
      return new TextDecoder().decode(compressed?await unzip(new Uint8Array(plain)):plain);
    }
    if(Object.values(legacyKeys).includes(path)||path===META_KEY)return text;
    throw new Error('Unencrypted or corrupt Cloudflare data: '+path);
  };
  const encode=async(path:string,value:string)=>{
    let plain:Uint8Array=new TextEncoder().encode(value),compressed=false;
    // Native level-1 gzip keeps CPU work low. Tiny/incompressible objects stay
    // v1, so compression must make the stored envelope meaningfully smaller.
    if(compress&&plain.byteLength>=1024){
      const packed=await gzipFast(plain);
      if(packed.byteLength+96<plain.byteLength){plain=new Uint8Array(packed);compressed=true;}
    }
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const context=compressed?path+'\nora-aes-gcm-v2:gzip':path;
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},await key,plain);
    return {compressed,text:JSON.stringify({format:compressed?'ora-aes-gcm-v2':'ora-aes-gcm-v1',...(compressed?{encoding:'gzip'}:{}),iv:Buffer.from(iv).toString('base64'),data:Buffer.from(encrypted).toString('base64')})};
  };
  const wrapped:DataBucket={
    async get(path) {
      const object=await bucket.get(path);if(!object)return null;
      return {etag:object.etag,customMetadata:object.customMetadata,text:async()=>{
        return decode(path,await object.text());
      }};
    },
    async put(path,value,settings) {
      return bucket.put(path,(await encode(path,value)).text,settings);
    },
    async compact(path){
      if(!compress)return 'skipped';
      const object=await bucket.get(path);if(!object)return 'skipped';
      const original=await object.text();if(JSON.parse(original)?.format!=='ora-aes-gcm-v1')return 'skipped';
      const value=await decode(path,original),packed=await encode(path,value);
      if(!packed.compressed)return 'skipped';
      // Check the exact Unicode/JSON string before touching the durable object.
      if(await decode(path,packed.text)!==value)throw new Error('Lossless data compression verification failed.');
      const saved=await bucket.put(path,packed.text,{httpMetadata:{contentType:'application/json',cacheControl:'no-store'},customMetadata:object.customMetadata,onlyIf:{etagMatches:object.etag}});
      return saved?'compacted':'conflict';
    },
  };
  encryptedBuckets.set(bucket,{secret,compress,bucket:wrapped});return wrapped;
};
const options = { httpMetadata:{contentType:'application/json',cacheControl:'no-store'}, customMetadata:{oraData:'1'} };
const parsedCaches = new WeakMap<DataBucket,Map<string,{etag:string;value:any;text:string}>>();
const parsedObject = async (bucket: DataBucket, key: string) => {
  const object = await bucket.get(key);
  if (!object) return null;
  let cache=parsedCaches.get(bucket);
  if(!cache){cache=new Map();parsedCaches.set(bucket,cache);}
  const cached=cache.get(key);
  if(cached?.etag===object.etag)return {object,value:cached.value,text:cached.text};
  // Corruption and read failures must never be converted into an empty database.
  const text=await object.text(),value=JSON.parse(text);
  if(cache.size>=48)cache.delete(cache.keys().next().value!);
  cache.set(key,{etag:object.etag,value,text});
  return { object, value, text };
};
const response = (value: unknown, status = 200, extra: Record<string,string> = {}) => new Response(
  status === 204 ? null : JSON.stringify(value),
  {status,headers:{'content-type':'application/json','cache-control':'no-store','x-ora-storage':'cloudflare-r2',...extra}},
);
class DataError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

export const activeData = async (bucket: DataBucket) => {
  const active = await parsedObject(bucket, ACTIVE_KEY);
  if (active) {
    if (active.value?.format !== 'ora-r2-tables-v2' || !/^ora-data\/generations\/[a-zA-Z0-9-]+\/$/.test(active.value.prefix)) {
      throw new DataError('Cloudflare data manifest is invalid.');
    }
    return active.value as {format:string;prefix:string;restored_at:string;counts:Record<string,number>};
  }
  return null;
};

const orderRows = (orders: Row[]) => orders.map(order => ({
  order_id:String(order.id), order_number:String(order.order_number), payload:order,
  created_at:order.created_at, updated_at:order.updated_at || order.created_at,
}));

// Stage every table before switching one atomic manifest. A failed upload leaves
// the previous source untouched. Repeating Restore never overwrites newer orders.
export const importRecovery = async (bucket: DataBucket, bundle: any) => {
  const existing = await activeData(bucket);
  if (existing) return {...existing,already_restored:true};
  if (bundle?.format !== 'ora-r2-recovery-v1' || !Array.isArray(bundle.orders) || !bundle.orders.length ||
      !Array.isArray(bundle.admin_users) || !bundle.admin_users.some((u:Row) => u.role==='admin' && u.is_active!==false) ||
      !Array.isArray(bundle.admin_data_store) || !bundle.admin_data_store.some((r:Row) => r.key==='storefront-state-v1')) {
    throw new DataError('The complete O-RA recovery bundle is required.',400);
  }
  const legacyMeta = await parsedObject(bucket,META_KEY);
  const tables: Record<string,Row[]> = {};
  for (const table of Object.keys(primaryKeys)) tables[table] = Array.isArray(bundle.tables?.[table]) ? bundle.tables[table] : [];
  tables.order_snapshots = orderRows(bundle.orders);
  tables.admin_users = bundle.admin_users;
  tables.admin_data_store = bundle.admin_data_store;
  tables.courier_waybills = Array.isArray(bundle.courier_waybills) ? bundle.courier_waybills : [];
  // When migrating an already restored v1 installation, keep its live writes.
  if (legacyMeta?.value?.active === true) {
    for (const [table,key] of Object.entries(legacyKeys)) {
      const old = await parsedObject(bucket,key);
      if (!old || !Array.isArray(old.value)) throw new DataError('Existing R2 data is incomplete; restore stopped.');
      tables[table] = table==='order_snapshots' ? orderRows(old.value) : old.value;
    }
  }
  for (const [table,rows] of Object.entries(tables)) {
    const pk = primaryKeys[table];
    if (rows.some(row => !row || row[pk] == null) || new Set(rows.map(row=>String(row[pk]))).size !== rows.length) {
      throw new DataError('Invalid or duplicate recovery records in '+table,400);
    }
  }
  const prefix = 'ora-data/generations/'+crypto.randomUUID()+'/';
  const counts: Record<string,number> = {};
  // Limit concurrent R2 calls; the import also fits Workers subrequest limits.
  const entries = Object.entries(tables);
  for(let offset=0;offset<entries.length;offset+=4) {
    await Promise.all(entries.slice(offset,offset+4).map(async ([table,rows]) => {
      const written = await bucket.put(prefix+table+'.json',JSON.stringify(rows),options);
      if(!written) throw new DataError('Recovery upload failed for '+table);
      counts[table] = rows.length;
    }));
  }
  const manifest = {format:'ora-r2-tables-v2',prefix,restored_at:new Date().toISOString(),exported_at:bundle.exported_at,counts};
  const written = await bucket.put(ACTIVE_KEY,JSON.stringify(manifest),{...options,onlyIf:{etagDoesNotMatch:'*'}});
  if(!written) {
    const winner = await activeData(bucket);
    if(!winner) throw new DataError('Recovery activation failed.');
    return {...winner,already_restored:true};
  }
  return manifest;
};

const tableState = async (bucket: DataBucket, prefix: string, table: string) => {
  const state = await parsedObject(bucket,prefix+table+'.json');
  if (!state || !Array.isArray(state.value)) throw new DataError('Cloudflare table is missing or invalid: '+table);
  return {rows:state.value as Row[],etag:state.object.etag,text:state.text};
};
const preserveHourlyBackup = async (bucket:DataBucket,table:string,rows:Row[],serialized?:string) => {
  // Seven days of hourly slots, bounded independently of traffic and order count.
  const hour = Math.floor(Date.now()/3_600_000);
  const key = 'ora-data/backups-v2/'+table+'/'+(hour%168)+'.json';
  const old = await bucket.get(key);
  if (old?.customMetadata?.hour === String(hour)) return;
  await bucket.put(key,serialized??JSON.stringify(rows),{...options,
    customMetadata:{oraData:'1',hour:String(hour),createdAt:new Date().toISOString()},
    onlyIf:old ? {etagMatches:old.etag} : {etagDoesNotMatch:'*'},
  });
};
const mutateTable = async <T>(bucket:DataBucket,prefix:string,table:string,change:(rows:Row[])=>T):Promise<T> => {
  for(let attempt=0;attempt<8;attempt++) {
    const state = await tableState(bucket,prefix,table);
    const before = state.text;
    // A failed CAS or write must never modify a cached successful read.
    const rows=JSON.parse(before) as Row[];
    const result = change(rows);
    const after=JSON.stringify(rows);
    if(before===after)return result;
    if (table !== '__sequences') await preserveHourlyBackup(bucket,table,state.rows,before);
    const saved = await bucket.put(prefix+table+'.json',after,{...options,customMetadata:{oraData:'1',oraCount:String(rows.length),oraUpdatedAt:new Date().toISOString()},onlyIf:{etagMatches:state.etag}});
    if(saved) return result;
  }
  throw new DataError('Concurrent Cloudflare writes; refresh and retry.',409);
};

// Internal Worker access avoids serializing and parsing the entire operational
// database through both the PostgREST SDK and the Node bridge on each CSV row.
export const readDataTable=async(env:unknown,table:string):Promise<Row[]>=>{
  if(!primaryKeys[table])throw new DataError('Unknown Cloudflare table.',400);
  const bucket=dataBucket(env);if(!bucket)throw new DataError('Cloudflare R2 binding is unavailable.');
  const active=await activeData(bucket);if(!active)throw new DataError('Cloudflare recovery is required.');
  return (await tableState(bucket,active.prefix,table)).rows;
};
// Ship already-serialized snapshots to the browser instead of parsing and
// serializing the full order history inside the Free Worker's CPU budget.
export const readDataTableWire=async(env:unknown,table:string)=>{
  if(!primaryKeys[table])throw new DataError('Unknown Cloudflare table.',400);
  const bucket=dataBucket(env);if(!bucket)throw new DataError('Cloudflare R2 binding is unavailable.');
  const active=await activeData(bucket);if(!active)throw new DataError('Cloudflare recovery is required.');
  const object=await bucket.get(active.prefix+table+'.json');
  if(!object)throw new DataError('Cloudflare table is missing: '+table);
  return object;
};
export const mutateDataTable=async<T>(env:unknown,table:string,change:(rows:Row[])=>T):Promise<T>=>{
  if(!primaryKeys[table])throw new DataError('Unknown Cloudflare table.',400);
  const bucket=dataBucket(env);if(!bucket)throw new DataError('Cloudflare R2 binding is unavailable.');
  const active=await activeData(bucket);if(!active)throw new DataError('Cloudflare recovery is required.');
  return mutateTable(bucket,active.prefix,table,change);
};

// Immutable callers replace only the changed records. A catalog save must not
// clone, parse, sort and stringify all unrelated admin records several times.
// Returning the original rows is a read-only acknowledgment with no R2 write.
export const replaceDataTable=async<T>(env:unknown,table:string,change:(rows:readonly Row[])=>{rows:readonly Row[];result:T}):Promise<T>=>{
  if(!primaryKeys[table])throw new DataError('Unknown Cloudflare table.',400);
  const bucket=dataBucket(env);if(!bucket)throw new DataError('Cloudflare R2 binding is unavailable.');
  const active=await activeData(bucket);if(!active)throw new DataError('Cloudflare recovery is required.');
  for(let attempt=0;attempt<8;attempt++){
    const state=await tableState(bucket,active.prefix,table),next=change(state.rows);
    if(next.rows===state.rows)return next.result;
    const after=JSON.stringify(next.rows);
    if(after===state.text)return next.result;
    await preserveHourlyBackup(bucket,table,state.rows,state.text);
    const saved=await bucket.put(active.prefix+table+'.json',after,{...options,customMetadata:{oraData:'1',oraCount:String(next.rows.length),oraUpdatedAt:new Date().toISOString()},onlyIf:{etagMatches:state.etag}});
    if(saved)return next.result;
  }
  throw new DataError('Concurrent Cloudflare writes; refresh and retry.',409);
};
const recoverKnownBrandImages=async(bucket:DataBucket,prefix:string)=>{
  if(migratedBrandPrefixes.has(prefix))return;
  const state=await tableState(bucket,prefix,'admin_data_store');
  const settings=state.rows.find(row=>row.key==='storefront-state-v1')?.payload?.settings;
  if(settings && ['website_logo','black_logo'].some(field=>recoveredBrandImages.get(settings[field]))) {
    await mutateTable(bucket,prefix,'admin_data_store',rows=>{
      const row=rows.find(row=>row.key==='storefront-state-v1');if(!row?.payload?.settings)return;
      let changed=false;
      for(const field of ['website_logo','black_logo']) {
        const url=recoveredBrandImages.get(row.payload.settings[field]);
        if(url){row.payload.settings[field]=url;changed=true;}
      }
      if(changed){row.updated_at=new Date().toISOString();row.payload.updated_at=row.updated_at;row.payload.version=Number(row.payload.version||1)+1;}
    });
  }
  migratedBrandPrefixes.add(prefix);
};
const fieldValue = (row:Row,field:string) => field.split(/->>?/).reduce((value,key)=>value?.[key],row as any);
const compare = (a:any,b:any) => a===b ? 0 : a==null ? -1 : b==null ? 1 : a>b ? 1 : -1;
const filterMatch = (row:Row,field:string,expression:string) => {
  const dot = expression.indexOf('.'), operator=expression.slice(0,dot), value=expression.slice(dot+1);
  const actual=fieldValue(row,field), text=String(actual);
  switch(operator) {
    case 'eq': return text===value;
    case 'neq': return text!==value;
    case 'is': return value==='null' ? actual==null : text===value;
    case 'in': return value.slice(1,-1).split(',').map(v=>v.replace(/^"|"$/g,'')).includes(text);
    case 'gte': return compare(actual,value)>=0;
    case 'gt': return compare(actual,value)>0;
    case 'lte': return compare(actual,value)<=0;
    case 'lt': return compare(actual,value)<0;
    case 'ilike': {
      const pattern=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.');
      return new RegExp('^'+pattern+'$','i').test(text);
    }
    default: throw new DataError('Unsupported Cloudflare query operator: '+operator,400);
  }
};
const matches = (row:Row,params:URLSearchParams) => {
  for(const [field,expression] of params) {
    if(['select','order','limit','offset','on_conflict','columns'].includes(field)) continue;
    if (!filterMatch(row,field,expression)) return false;
  }
  return true;
};
const project = (rows:Row[],select:string|null) => !select || select==='*' ? rows : rows.map(row => {
  const output:Row={};
  for(const field of select.split(',')) output[field]=fieldValue(row,field);
  return output;
});

const rpc = async (request:Request,bucket:DataBucket,prefix:string,name:string) => {
  if(!['next_ora_order_number','reset_ora_order_number_sequences'].includes(name)) {
    return response({message:'This operation still needs Supabase: '+name,code:'ORA_UNSUPPORTED_RPC'},501);
  }
  const key=prefix+'__sequences.json';
  if(!await bucket.get(key)) {
    const {rows}=await tableState(bucket,prefix,'order_snapshots');
    const initial=['WEB','FB','TK','MAN'].map(prefix=>({id:prefix,value:rows.reduce((max,row)=>{
      const match=String(row.order_number||'').match(new RegExp('^'+prefix+'-(\\d+)$'));
      return match ? Math.max(max,Number(match[1])) : max;
    },0)}));
    await bucket.put(key,JSON.stringify(initial),{...options,onlyIf:{etagDoesNotMatch:'*'}});
  }
  if(name==='reset_ora_order_number_sequences') {
    await mutateTable(bucket,prefix,'__sequences',rows=>{for(const row of rows)row.value=0;});
    return response(null);
  }
  const body:any=await request.json();
  const orderPrefix=String(body.p_prefix||'');
  if(!['WEB','FB','TK','MAN'].includes(orderPrefix)) return response({message:'Invalid order prefix.'},400);
  const number=await mutateTable(bucket,prefix,'__sequences',rows=>{
    const row=rows.find(r=>r.id===orderPrefix)!; row.value=Number(row.value)+1;
    return orderPrefix+'-'+String(row.value).padStart(6,'0');
  });
  return response(number);
};

// Called ONLY from server-side clients with the configured service credential.
// Never expose this adapter as an HTTP endpoint or intercept customer JWTs.
export const cloudflareDataFetch: typeof fetch = async (input,init) => {
  const url=new URL(input instanceof Request ? input.url : String(input));
  const origin=String(runtime?.VITE_SUPABASE_URL||'').replace(/\/$/,'');
  if(!runtime || url.origin!==origin || !url.pathname.startsWith('/rest/v1/')) return networkFetch(input,init);
  const request=new Request(input,init);
  const secret=String(runtime.SUPABASE_SECRET_KEY||runtime.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!secret || request.headers.get('apikey')!==secret) return networkFetch(input,init);
  if(url.pathname==='/rest/v1/rpc/ora_storage_usage_by_bucket')return networkFetch(input,init);
  const bucket=dataBucket();
  try {
    if(!bucket) throw new DataError('Cloudflare R2 binding is unavailable.');
    const active=await activeData(bucket);
    if(!active) throw new DataError('Restore the O-RA recovery snapshot into Cloudflare R2 first.');
    const resource=decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    if(resource==='admin_data_store')await recoverKnownBrandImages(bucket,active.prefix);
    if(resource.startsWith('rpc/')) return await rpc(request,bucket,active.prefix,resource.slice(4));
    if(!primaryKeys[resource]) return response({message:'Unsupported Cloudflare table: '+resource},501);
    let rows:Row[];
    if(['GET','HEAD'].includes(request.method)) {
      rows=(await tableState(bucket,active.prefix,resource)).rows.filter(row=>matches(row,url.searchParams));
    } else {
      const body:any=request.method==='DELETE' ? null : await request.json();
      rows=await mutateTable(bucket,active.prefix,resource,current=>{
        let changed:Row[]=[];
        if(request.method==='POST') {
          const incoming=Array.isArray(body)?body:[body];
          const pk=url.searchParams.get('on_conflict')||primaryKeys[resource];
          if(pk.includes(',')) throw new DataError('Compound conflict keys are not supported.',400);
          const upsert=String(request.headers.get('prefer')||'').includes('resolution=merge-duplicates');
          for(const value of incoming) {
            const row={...value};
            if(resource==='admin_data_store' && row.key==='storefront-state-v1' && row.payload?.settings){
              row.payload={...row.payload,settings:{...row.payload.settings}};
              for(const field of ['website_logo','black_logo']){
                const url=recoveredBrandImages.get(row.payload.settings[field]);if(url)row.payload.settings[field]=url;
              }
            }
            if(row[pk]==null && pk==='id')row.id=crypto.randomUUID();
            if(row[pk]==null)throw new DataError('Missing record key for '+resource,400);
            const at=current.findIndex(item=>String(item[pk])===String(row[pk]));
            if(resource==='admin_data_store'&&row.key==='storefront-state-v1'&&current.some(item=>String(item.key).startsWith('order-cancel-stock-v1:')&&['pending','stock_saved'].includes(item.payload?.phase))){
              throw new DataError('An order cancellation is restoring stock. Retry after it completes.',409);
            }
            if(at>=0 && !upsert)throw new DataError('Duplicate record in '+resource,409);
            if(resource==='order_snapshots' && current.some(item=>item.order_number===row.order_number && item.order_id!==row.order_id)) {
              throw new DataError('Order number is already reserved.',409);
            }
            if(resource==='admin_users' && current.some(item=>item.username===row.username && item.id!==row.id)) {
              throw new DataError('Username already exists.',409);
            }
            if(resource==='courier_waybills' && at>=0 && ['Assigned','Used','Cancelled'].includes(current[at].status) &&
               current[at].assigned_order_number && current[at].assigned_order_number!==row.assigned_order_number) {
              throw new DataError('Waybill is already locked to another order.',409);
            }
            const saved=at>=0 ? {...current[at],...row} : row;
            if(resource==='order_snapshots'&&at>=0&&current[at].payload?.cancel_stock_restore?.operation_id){
              saved.payload=current[at].payload;
            }
            if(resource==='courier_waybills'&&at>=0&&current[at].status==='Cancelled'&&current[at].permanently_retired===true){
              Object.assign(saved,current[at]);
            }
            if(at>=0)current[at]=saved;else current.push(saved);
            changed.push(saved);
          }
        } else if(request.method==='PATCH' || request.method==='DELETE') {
          for(let i=current.length-1;i>=0;i--) if(matches(current[i],url.searchParams)) {
            if((resource==='order_snapshots'&&current[i].payload?.cancel_stock_restore?.operation_id)||
              (resource==='courier_waybills'&&current[i].status==='Cancelled'&&current[i].permanently_retired===true)){
              throw new DataError('The cancelled order and retired waybill must remain locked in history.',409);
            }
            if(resource==='admin_data_store'&&current[i].key==='storefront-state-v1'&&current.some(item=>String(item.key).startsWith('order-cancel-stock-v1:')&&['pending','stock_saved'].includes(item.payload?.phase))){
              throw new DataError('An order cancellation is restoring stock. Retry after it completes.',409);
            }
            if(request.method==='DELETE')changed.unshift(...current.splice(i,1));
            else {current[i]={...current[i],...body};changed.unshift(current[i]);}
          }
        } else throw new DataError('Unsupported Cloudflare method.',405);
        return changed;
      });
      if(!String(request.headers.get('prefer')||'').includes('return=representation')) return response(null,204);
    }
    const total=rows.length;
    for(const spec of (url.searchParams.get('order')||'').split(',').reverse()) {
      if(!spec)continue;
      const [field,direction]=spec.split('.'); rows.sort((a,b)=>compare(fieldValue(a,field),fieldValue(b,field))*(direction==='desc'?-1:1));
    }
    const offset=Math.max(0,Number(url.searchParams.get('offset')||0));
    const limit=url.searchParams.has('limit')?Math.max(0,Number(url.searchParams.get('limit'))):rows.length;
    rows=project(rows.slice(offset,offset+limit),url.searchParams.get('select'));
    const headers={'content-range':rows.length?`${offset}-${offset+rows.length-1}/${total}`:`*/${total}`};
    if(request.method==='HEAD')return new Response(null,{status:200,headers});
    if(request.headers.get('accept')?.includes('application/vnd.pgrst.object+json')) {
      if(rows.length!==1)return response({message:'Expected exactly one record.',code:'PGRST116',details:`The result contains ${rows.length} rows`},406,headers);
      return response(rows[0],200,headers);
    }
    return response(rows,200,headers);
  } catch(error:any) {
    return response({message:error?.message||'Cloudflare durable storage failed.',code:'ORA_R2_ERROR'},error?.status||503);
  }
};
