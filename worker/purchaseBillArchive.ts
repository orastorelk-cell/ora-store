import { dataBucket } from './cloudflareData';
type Row=Record<string,any>;
type ArchiveObject={key:string;size:number;uploaded?:Date;customMetadata?:Record<string,string>};
type MediaR2={list:(args:{prefix:string;limit:number;cursor?:string})=>Promise<{objects:ArchiveObject[];truncated:boolean;cursor?:string}>};
const result=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const REVIEW_KEY='ora-data/purchase-bill-archive-review-v1.json';
const validPhotoKey=(key:unknown):key is string=>typeof key==='string'&&/^media\/purchase-bill\/\d{4}\/\d{2}\/\d{2}\/[0-9a-z-]+\.(?:jpg|jpeg|png|webp)$/i.test(key);
const readReview=async(bucket:any)=>{
  const object=await bucket.get(REVIEW_KEY);if(!object)return {object,reviewed:{} as Record<string,any>};
  const parsed=JSON.parse(await object.text());
  if(parsed?.format!=='ora-purchase-bill-archive-review-v1'||!parsed.reviewed||typeof parsed.reviewed!=='object'||Array.isArray(parsed.reviewed))throw new Error('Purchase bill review marks are unreadable.');
  return {object,reviewed:parsed.reviewed as Record<string,any>};
};
/** Review marks live in private encrypted R2 data; original images and purchases are untouched. */
export const purchaseBillArchiveHandler=async(request:Request,env:unknown,user:Row)=>{
  if(user.role!=='admin')return result({error:'Super Admin access required.'},403);
  const privateBucket=dataBucket(env);
  if(!privateBucket)return result({error:'Private archive review storage is unavailable.'},503);
  if(request.method==='POST'){
    const body:any=await request.json().catch(()=>null);
    if(!validPhotoKey(body?.key)||!['already_entered','pending'].includes(body?.status))return result({error:'Invalid bill review update.'},400);
    try{
      for(let attempt=0;attempt<3;attempt++){
        const {object,reviewed}=await readReview(privateBucket);
        if(body.status==='already_entered')reviewed[body.key]={status:'already_entered',updated_at:new Date().toISOString(),updated_by:String(user.id)};
        else delete reviewed[body.key];
        const saved=await privateBucket.put(REVIEW_KEY,JSON.stringify({format:'ora-purchase-bill-archive-review-v1',reviewed}),{
          httpMetadata:{contentType:'application/json',cacheControl:'no-store'},customMetadata:{oraData:'1'},
          onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}
        });
        if(saved)return result({ok:true,key:body.key,status:body.status});
      }
      return result({error:'Another archive review changed at the same time. Reload the bill list and retry.'},409);
    }catch(error:any){return result({error:error?.message||'Could not save the bill review mark.'},503);}
  }
  if(request.method!=='GET')return result({error:'Unsupported archive review action.'},405);
  const bucket=(env as any)?.ORA_MEDIA_R2 as MediaR2|undefined;
  if(!bucket||typeof bucket.list!=='function')return result({error:'Original image archive unavailable in this Cloudflare environment.'},503);
  const cursor=new URL(request.url).searchParams.get('cursor')||'';
  if(cursor.length>1000)return result({error:'Invalid cursor.'},400);
  try{
    const list=await bucket.list({prefix:'media/purchase-bill/',limit:100,...(cursor?{cursor}:{})});
    const {reviewed}=await readReview(privateBucket);
    const photos=list.objects.filter(o=>/^media\/purchase-bill\/\d{4}\/\d{2}\/\d{2}\/[0-9a-z-]+\.(?:jpg|jpeg|png|webp)$/i.test(o.key))
      .map(o=>({key:o.key,url:'/api/media/'+o.key,size:o.size,
        uploaded_at:o.customMetadata?.uploadedAt||o.uploaded?.toISOString?.()||null,
        review_status:reviewed[o.key]?.status==='already_entered'?'already_entered':'pending'}));
    return result({ok:true,photos,next_cursor:list.truncated?list.cursor||null:null});
  }catch(err:any){return result({error:'Could not list original R2 purchase-bill photos: '+String(err?.message||err)},503);}
};
