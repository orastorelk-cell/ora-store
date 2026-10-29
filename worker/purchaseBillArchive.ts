type Row=Record<string,any>;
type ArchiveObject={key:string;size:number;uploaded?:Date;customMetadata?:Record<string,string>};
type MediaR2={list:(args:{prefix:string;limit:number;cursor?:string})=>Promise<{objects:ArchiveObject[];truncated:boolean;cursor?:string}>};
const result=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
/** Read-only; R2 uploads and historical purchasing data are kept independent. */
export const purchaseBillArchiveHandler=async(request:Request,env:unknown,user:Row)=>{
  if(user.role!=='admin')return result({error:'Super Admin access required.'},403);
  if(request.method!=='GET')return result({error:'Read-only archive.'},405);
  const bucket=(env as any)?.ORA_MEDIA_R2 as MediaR2|undefined;
  if(!bucket||typeof bucket.list!=='function')return result({error:'Original image archive unavailable in this Cloudflare environment.'},503);
  const cursor=new URL(request.url).searchParams.get('cursor')||'';
  if(cursor.length>1000)return result({error:'Invalid cursor.'},400);
  try{
    const list=await bucket.list({prefix:'media/purchase-bill/',limit:100,...(cursor?{cursor}:{})});
    const photos=list.objects.filter(o=>/^media\/purchase-bill\/\d{4}\/\d{2}\/\d{2}\/[0-9a-z-]+\.(?:jpg|jpeg|png|webp)$/i.test(o.key))
      .map(o=>({key:o.key,url:'/api/media/'+o.key,size:o.size,
        uploaded_at:o.customMetadata?.uploadedAt||o.uploaded?.toISOString?.()||null}));
    return result({ok:true,photos,next_cursor:list.truncated?list.cursor||null:null});
  }catch(err:any){return result({error:'Could not list original R2 purchase-bill photos: '+String(err?.message||err)},503);}
};
