import { Buffer } from 'node:buffer';

type MediaBucket={get(key:string):Promise<any>;head?(key:string):Promise<any>;put(key:string,value:ArrayBufferView,options?:any):Promise<any>};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

export const r2MediaHandler=async(request:Request,env:any,ctx?:any):Promise<Response|null>=>{
  const bucket=env?.ORA_MEDIA_R2 as MediaBucket;
  if(!bucket?.get||!bucket?.put)return null;
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname.startsWith('/api/media/')){
    let key:string;
    try{key=url.pathname.slice('/api/media/'.length).split('/').map(part=>decodeURIComponent(part)).join('/');}
    catch{return new Response('Invalid image path',{status:400});}
    if(!key.startsWith('media/')||key.includes('..'))return new Response('Not found',{status:404});
    // Only immutable public catalog/branding files enter the edge cache. Order
    // receipts, purchases, damage photos and all operational JSON keep their paths.
    const publicImage=key.startsWith('media/product/')||key.startsWith('media/branding/');
    const cache=publicImage?(globalThis as any).caches?.default:undefined;
    const cacheUrl=new URL(url);cacheUrl.search='';
    const cacheKey=new Request(cacheUrl.toString());
    const conditional=(response:Response)=>{
      const etag=response.headers.get('etag');
      const tags=(request.headers.get('if-none-match')||'').split(',').map(tag=>tag.trim().replace(/^W\//,''));
      return etag&&(tags.includes(etag)||tags.includes('*'))?new Response(null,{status:304,headers:response.headers}):response;
    };
    if(cache){
      try{
        const cached=await cache.match(cacheKey);
        if(cached){const headers=new Headers(cached.headers);headers.set('x-ora-media-cache','HIT');return conditional(new Response(cached.body,{status:cached.status,headers}));}
      }catch{}
    }
    const object=await bucket.get(key);if(!object)return new Response('Not found',{status:404});
    const headers=new Headers();try{object.writeHttpMetadata?.(headers);}catch{}
    if(!headers.has('content-type'))headers.set('content-type','application/octet-stream');
    if(!headers.has('cache-control'))headers.set('cache-control','public, max-age=31536000, immutable');
    if(object.httpEtag)headers.set('etag',object.httpEtag);
    headers.set('x-ora-storage','r2');
    if(Number.isSafeInteger(object.size)&&object.size>=0)headers.set('content-length',String(object.size));
    headers.set('x-ora-media-cache',publicImage?'MISS':'BYPASS');
    const response=new Response(object.body,{headers});
    if(cache&&ctx?.waitUntil)ctx.waitUntil(cache.put(cacheKey,response.clone()).catch(()=>undefined));
    return conditional(response);
  }
  if(request.method!=='POST'||url.pathname!=='/api/uploads/image')return null;
  const body:any=await request.clone().json().catch(()=>null);
  if(!body)return json({error:'Invalid image upload payload.'},400);
  const purpose=String(body.purpose||'public').replace(/[^a-z0-9-]/gi,'').slice(0,40)||'public';
  const match=String(body.dataUrl||'').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if(!match)return json({error:'Invalid image payload.'},400);
  const ext=match[1].toLowerCase()==='jpg'?'jpeg':match[1].toLowerCase(),bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>750_000)return json({error:'Compressed image must be under 750 KB.'},400);
  const fileExt=ext==='jpeg'?'jpg':ext,now=new Date();
  const shared=purpose==='product'||purpose==='branding';
  // Only public catalog/branding assets share identical bytes. Customer receipts
  // and other private submissions retain their separate random upload paths.
  const digest=shared?Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'):'';
  const date=now.toISOString().slice(0,10).replaceAll('-','/');
  const key=shared?`media/${purpose}/sha256/${digest}.${fileExt}`:`media/${purpose}/${date}/${Date.now()}-${crypto.randomUUID().replace(/-/g,'').slice(0,16)}.${fileExt}`;
  const existing=shared?await (bucket.head?bucket.head(key):bucket.get(key)):null;
  if(!existing)await bucket.put(key,bytes,{
    httpMetadata:{contentType:`image/${ext}`,cacheControl:'public, max-age=31536000, immutable'},
    customMetadata:{purpose,uploadedAt:now.toISOString(),oraArchiveEligibleAfterDays:'21'},
    ...(shared?{onlyIf:{etagDoesNotMatch:'*'}}:{}),
  });
  return json({ok:true,url:`/api/media/${key}`,storage:'r2',key});
};
