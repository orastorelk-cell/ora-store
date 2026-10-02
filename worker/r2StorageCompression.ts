import { activeData, compressionEnabled, dataBucket } from './cloudflareData';

const PROGRESS_KEY='ora-data/compression-progress-v1.json';
const TABLES=['order_snapshots','admin_data_store','admin_users','courier_waybills','fardar_cities','fardar_city_mappings','customer_profiles','customer_reviews','product_requests','activity_logs','blocked_customers','categories','customers','dispatch_events','order_abuse_events','order_items','orders','products','purchase_orders','stock_history','store_settings'];

// One object per cron run. Current data and bounded old backups shrink gradually
// without a bulk rewrite in a customer/admin request. Every rewrite uses CAS.
export const compactR2StorageOnce=async(env:any)=>{
  if(!compressionEnabled(env))return;
  const bucket=dataBucket(env),raw=env?.ORA_MEDIA_R2;
  if(!bucket?.compact||typeof raw?.list!=='function')return;
  const active=await activeData(bucket);if(!active)return;
  const saved=await bucket.get(PROGRESS_KEY);
  let progress=saved?JSON.parse(await saved.text()):null;
  if(progress?.generation!==active.prefix)progress={generation:active.prefix,stage:'live',next_table:0,cursor:''};
  if(progress.stage==='done')return;
  if(progress.stage==='live'){
    if(!Number.isInteger(progress.next_table)||progress.next_table<0||progress.next_table>=TABLES.length)throw new Error('Storage compression checkpoint is invalid.');
    if(await bucket.compact(active.prefix+TABLES[progress.next_table]+'.json')==='conflict')return;
    progress.next_table++;
    if(progress.next_table>=TABLES.length)progress.stage='backups';
  }else if(progress.stage==='backups'){
    const page=await raw.list({prefix:'ora-data/backups-v2/',limit:1,...(progress.cursor?{cursor:progress.cursor}:{})});
    for(const object of page.objects||[]){
      const match=String(object.key).match(/^ora-data\/backups-v2\/([a-z_]+)\/(\d+)\.json$/);
      if(match&&TABLES.includes(match[1])&&Number(match[2])<168&&await bucket.compact(object.key)==='conflict')return;
    }
    if(page.truncated&&!page.cursor)throw new Error('Storage compression listing is incomplete.');
    progress.cursor=page.cursor||'';
    if(!page.truncated)progress.stage='done';
  }else throw new Error('Storage compression checkpoint is invalid.');
  await bucket.put(PROGRESS_KEY,JSON.stringify(progress),{httpMetadata:{contentType:'application/json',cacheControl:'no-store'},customMetadata:{oraData:'1'},onlyIf:saved?{etagMatches:saved.etag}:{etagDoesNotMatch:'*'}});
};
