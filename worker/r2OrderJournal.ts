import type { DataBucket } from './cloudflareData';

type Row=Record<string,any>;
type ObjectState={value:any;text:string;object:{etag:string;customMetadata?:Record<string,string>}};
type Access={read:(key:string)=>Promise<ObjectState|null>;cache:(key:string,etag:string,text:string,value:any)=>void};
type Manifest={format:'ora-order-changes-v1';commit_id:string;count:number;updated_at:string;shards:Record<string,string>};
const options={httpMetadata:{contentType:'application/json',cacheControl:'no-store'},customMetadata:{oraData:'1'}};
const caches=new WeakMap<DataBucket,Map<string,{revision:string;rows:Row[];shards:Map<string,Row[]>;text?:string}>>();
const shardFor=(id:string)=>{let hash=2166136261;for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619);return String((hash>>>0)%16);};
const invalid=()=>{throw new Error('Cloudflare order journal is missing or invalid.');};
const loadManifest=async(prefix:string,access:Access)=>{
  const path=prefix+'order-changes-v1.json',saved=await access.read(path);
  const manifest:Manifest|null=saved?.value||null;
  if(saved&&(!manifest||manifest.format!=='ora-order-changes-v1'||!manifest.shards||typeof manifest.shards!=='object'||Array.isArray(manifest.shards)||
    !Number.isSafeInteger(manifest.count)||manifest.count<0||!Number.isFinite(Date.parse(manifest.updated_at))||
    Object.entries(manifest.shards).some(([shard,key])=>!/^([0-9]|1[0-5])$/.test(shard)||typeof key!=='string'||!key.startsWith(prefix+'order-changes-v1/'+shard+'/')||!/^\d{13}-[a-f0-9-]+\.json$/.test(key.split('/').pop()||''))))invalid();
  return {path,saved,manifest};
};

// Send the untouched JSON plus small changes to updated staff browsers. This
// preserves the cheap cold-read path without re-serializing historical orders.
export const readOrderJournalWire=async(bucket:DataBucket,prefix:string,base:NonNullable<Awaited<ReturnType<DataBucket['get']>>>,access:Access)=>{
  const {saved,manifest}=await loadManifest(prefix,access),texts:string[]=[];
  const entries=Object.values(manifest?.shards||{});
  for(let offset=0;offset<entries.length;offset+=4){
    const batch=await Promise.all(entries.slice(offset,offset+4).map(async path=>{
      const part=await bucket.get(path);if(!part)invalid();const text=await part!.text();if(!text.startsWith('[')||!text.endsWith(']'))invalid();return text.slice(1,-1);
    }));texts.push(...batch.filter(Boolean));
  }
  return {...base,etag:saved?base.etag+':'+saved.object.etag:base.etag,customMetadata:manifest?{oraCount:String(manifest.count),oraUpdatedAt:manifest.updated_at}:base.customMetadata,
    changes:'['+texts.join(',')+']',count:manifest?.count};
};

// The recovered history stays intact. New/changed orders live in 16 small
// encrypted shards, published by ONE conditional manifest write. A failed shard
// upload or a lost CAS cannot expose a partial multi-order packing operation.
export const readOrderJournal=async(bucket:DataBucket,prefix:string,base:ObjectState,access:Access)=>{
  const {path,saved,manifest}=await loadManifest(prefix,access);
  const revision=saved?base.object.etag+':'+saved.object.etag:base.object.etag;
  let cache=caches.get(bucket);if(!cache){cache=new Map();caches.set(bucket,cache);}
  let merged=cache.get(prefix);
  const shards=merged?.revision===revision?merged.shards:new Map<string,Row[]>(),changes=new Map<string,Row|null>();
  const entries=merged?.revision===revision?[]:Object.entries(manifest?.shards||{});
  // Stay within Workers' concurrent connection limit, including other jobs.
  for(let offset=0;offset<entries.length;offset+=4)await Promise.all(entries.slice(offset,offset+4).map(async([shard,key])=>{
    const part=await access.read(key);if(!part||!Array.isArray(part.value))invalid();
    const rows=part!.value as Row[],seen=new Set<string>();
    for(const row of rows){const id=String(row?.order_id||'');if(!id||seen.has(id)||shardFor(id)!==shard||row.deleted!==true&&!row.payload)invalid();seen.add(id);changes.set(id,row.deleted===true?null:row);}
    shards.set(shard,rows);
  }));
  if(merged?.revision!==revision){
    const remaining=new Map(changes),rows:Row[]=[];
    for(const row of base.value as Row[]){const id=String(row.order_id);if(remaining.has(id)){const replacement=remaining.get(id);if(replacement)rows.push(replacement);remaining.delete(id);}else rows.push(row);}
    for(const row of remaining.values())if(row)rows.push(row);
    if(manifest&&rows.length!==manifest.count)invalid();
    merged={revision,rows,shards,...(!saved?{text:base.text}:{})};cache.set(prefix,merged);
    if(cache.size>2)cache.delete(cache.keys().next().value!);
  }
  return {rows:merged!.rows,etag:revision,get text(){return merged!.text??(merged!.text=JSON.stringify(merged!.rows));},
    journal:{path,saved,manifest,base,shards,access},customMetadata:manifest?{oraCount:String(manifest.count),oraUpdatedAt:manifest.updated_at}:base.object.customMetadata};
};

export const writeOrderJournal=async(bucket:DataBucket,prefix:string,state:Awaited<ReturnType<typeof readOrderJournal>>,rows:readonly Row[])=>{
  const previous=new Map(state.rows.map(row=>[String(row.order_id),row])),changed=new Map<string,Row|null>(),seen=new Set<string>();
  for(const row of rows){
    const id=String(row.order_id||'');if(!id||seen.has(id))throw new Error('Invalid or duplicate order identity.');seen.add(id);
    const old=previous.get(id);if(old!==row&&(!old||JSON.stringify(old)!==JSON.stringify(row)))changed.set(id,row);
    previous.delete(id);
  }
  for(const id of previous.keys())changed.set(id,null);
  if(!changed.size)return true;
  const {journal}=state,now=new Date().toISOString(),commit=crypto.randomUUID(),shards={...journal.manifest?.shards};
  const updates=new Map<string,Map<string,Row>>();
  for(const [id,row] of changed){const shard=shardFor(id);let part=updates.get(shard);if(!part){part=new Map((journal.shards.get(shard)||[]).map(row=>[String(row.order_id),row]));updates.set(shard,part);}part.set(id,row||{order_id:id,deleted:true});}
  for(const [shard,part] of updates){
    const path=prefix+'order-changes-v1/'+shard+'/'+Date.now()+'-'+commit+'.json',value=Array.from(part.values()),text=JSON.stringify(value);
    const saved=await bucket.put(path,text,{...options,onlyIf:{etagDoesNotMatch:'*'}});if(!saved)throw new Error('Order shard could not be saved. Retry this same order.');
    journal.access.cache(path,saved.etag,text,value);shards[shard]=path;
  }
  // Checkpoints reference immutable shards and the untouched recovered history.
  // Saving the first order of the hour never copies/encrypts all old orders.
  const hour=Math.floor(Date.now()/3_600_000),backup='ora-data/backups-v2/order_snapshots/'+hour%168+'.json',old=await bucket.get(backup);
  if(old?.customMetadata?.hour!==String(hour))await bucket.put(backup,JSON.stringify({format:'ora-order-checkpoint-v1',base_key:prefix+'order_snapshots.json',base_etag:journal.base.object.etag,changes:journal.manifest,count:state.rows.length,created_at:now}),
    {...options,customMetadata:{oraData:'1',hour:String(hour),createdAt:now},onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}});
  const manifest:Manifest={format:'ora-order-changes-v1',commit_id:commit,count:rows.length,updated_at:now,shards},text=JSON.stringify(manifest);
  const saved=await bucket.put(journal.path,text,{...options,customMetadata:{oraData:'1',oraCount:String(rows.length),oraUpdatedAt:now},onlyIf:journal.saved?{etagMatches:journal.saved.object.etag}:{etagDoesNotMatch:'*'}});
  if(!saved)return false;
  journal.access.cache(journal.path,saved.etag,text,manifest);
  return true;
};
