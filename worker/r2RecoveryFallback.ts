
type Env = Record<string, any>;
type R2ObjectLike = { text: () => Promise<string> };
type R2BucketLike = {
  get: (key:string) => Promise<R2ObjectLike | null>;
  put: (key:string, value:string, options?:any) => Promise<any>;
};
type StaffSession = { sub:string; role:'admin'|'staff'; exp:number };

const ORDERS_KEY='ora-data/orders-v1.json';
const ADMIN_DATA_KEY='ora-data/admin-data-v1.json';
const USERS_KEY='ora-data/admin-users-v1.json';
const WAYBILLS_KEY='ora-data/courier-waybills-v1.json';
const META_KEY='ora-data/meta-v1.json';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});

const bucketFor=(envValue:unknown):R2BucketLike|null=>{
  const bucket=(envValue as Env)?.ORA_MEDIA_R2;
  return bucket && typeof bucket.get==='function' && typeof bucket.put==='function' ? bucket as R2BucketLike : null;
};

const readJson=async<T>(bucket:R2BucketLike,key:string,fallback:T):Promise<T>=>{
  const object=await bucket.get(key);
  if(!object)return fallback;
  try{return JSON.parse(await object.text()) as T;}catch{return fallback;}
};

const writeJson=async(bucket:R2BucketLike,key:string,value:unknown)=>{
  await bucket.put(key,JSON.stringify(value),{
    httpMetadata:{contentType:'application/json',cacheControl:'no-store'},
    customMetadata:{oraData:'1',updatedAt:new Date().toISOString()},
  });
};

const b64urlBytes=(value:string)=>{
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const binary=atob(padded);
  const out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
  return out;
};

const bytesB64url=(bytes:Uint8Array)=>{
  let binary='';
  for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};

const hmac=async(secret:string,payload:string)=>{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)));
};

const verifySession=async(request:Request,envValue:unknown):Promise<StaffSession|null>=>{
  try{
    const token=String(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
    const parts=token.split('.');
    const payload=parts[0],sig=parts[1];
    if(!payload||!sig)return null;
    const env=envValue as Env;
    const secret=String(env?.STAFF_SESSION_SECRET || env?.ABUSE_HASH_SALT || 'ora-local-staff-session-change-in-production');
    const expected=await hmac(secret,payload);
    const actual=b64urlBytes(sig);
    if(actual.length!==expected.length)return null;
    let diff=0;for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];
    if(diff!==0)return null;
    const session=JSON.parse(new TextDecoder().decode(b64urlBytes(payload))) as StaffSession;
    if(!session?.sub||!session?.exp||Date.now()>Number(session.exp))return null;
    return session;
  }catch{return null;}
};

const signSession=async(user:any,envValue:unknown)=>{
  const env=envValue as Env;
  const secret=String(env?.STAFF_SESSION_SECRET || env?.ABUSE_HASH_SALT || 'ora-local-staff-session-change-in-production');
  const payload=bytesB64url(new TextEncoder().encode(JSON.stringify({
    sub:String(user.id),role:user.role==='admin'?'admin':'staff',exp:Date.now()+12*60*60*1000
  })));
  const sig=bytesB64url(await hmac(secret,payload));
  return payload+'.'+sig;
};

const hex=(bytes:Uint8Array)=>Array.from(bytes).map(v=>v.toString(16).padStart(2,'0')).join('');

const verifyPassword=async(password:string,stored:string,envValue:unknown)=>{
  const value=String(stored||'');
  if(!value.startsWith('cfhmac:'))return false;
  const parts=value.split(':');
  const salt=parts[1],expected=parts[2];
  if(!salt||!expected)return false;
  const env=envValue as Env;
  const secret=String(env?.STAFF_SESSION_SECRET || env?.ABUSE_HASH_SALT || 'ora-local-staff-session-change-in-production');
  return hex(await hmac(secret,salt+':'+password))===expected.toLowerCase();
};

const publicStaff=(u:any)=>({
  id:String(u.id),username:String(u.username),name:String(u.display_name||u.username),email:String(u.email||''),
  role:u.role==='admin'?'admin':'staff',permissions:u.role==='admin'?undefined:(Array.isArray(u.permissions)?u.permissions:[]),
  is_active:u.is_active!==false,created_at:u.created_at,
});

const adminPayload=(rows:any[],key:string)=>rows.find((row:any)=>String(row?.key||'')===key)?.payload;

const setAdminPayload=(rows:any[],key:string,payload:any)=>{
  const now=new Date().toISOString();
  const index=rows.findIndex((row:any)=>String(row?.key||'')===key);
  const record={key,payload,updated_at:now};
  if(index>=0)rows[index]=record;else rows.push(record);
  return rows;
};

const publicStorefront=(state:any)=>{
  if(!state||typeof state!=='object')return state;
  const settings={...(state.settings||{})};
  ['google_sheet_webhook_url','fardar_api_url','fardar_account_id','courier_api_enabled','admin_secret_path'].forEach(k=>delete settings[k]);
  if(settings.bank_details_saved!==true){
    settings.bank_name='';settings.bank_account_holder='';settings.bank_account_number='';settings.bank_branch='';
  }
  return {...state,settings};
};

const orderVersion=(orders:any[])=>{
  let latest='';
  for(const order of orders){
    const value=String(order?.updated_at||order?.created_at||'');
    if(!value)continue;
    if(!latest||new Date(value).getTime()>new Date(latest).getTime())latest=value;
  }
  return {count:orders.length,updated_at:latest};
};

const normalizeOrderNumber=(orders:any[],order:any)=>{
  const source=String(order?.order_source||'Website');
  const prefix=source==='Facebook Ads'?'FB':source==='TikTok Ads'?'TK':source==='Manual Admin'?'MAN':'WEB';
  const requested=String(order?.order_number||'').trim().toUpperCase();
  const collision=orders.some((row:any)=>String(row?.order_number||'').toUpperCase()===requested && String(row?.id)!==String(order?.id));
  if(new RegExp('^'+prefix+'-\\d{6,}$').test(requested)&&!collision)return requested;
  const max=orders.reduce((m:number,row:any)=>{
    const hit=String(row?.order_number||'').match(new RegExp('^'+prefix+'-(\\d+)$','i'));
    return hit?Math.max(m,Number(hit[1])):m;
  },0);
  return prefix+'-'+String(max+1).padStart(6,'0');
};

const saveOrderR2=async(bucket:R2BucketLike,order:any)=>{
  const orders=await readJson<any[]>(bucket,ORDERS_KEY,[]);
  const normalized={...order,order_number:normalizeOrderNumber(orders,order),updated_at:new Date().toISOString()};
  const next=[normalized,...orders.filter((row:any)=>String(row?.id)!==String(normalized.id)&&String(row?.order_number)!==String(normalized.order_number))]
    .sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
  await writeJson(bucket,ORDERS_KEY,next);
  await writeJson(bucket,META_KEY,{active:true,updated_at:new Date().toISOString(),orders:next.length,mode:'cloudflare-r2'});
  return normalized;
};

const RECOVERY_HTML = "<!doctype html>\n<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>O-RA Cloudflare Recovery</title>\n<style>\nbody{font-family:Arial,sans-serif;background:#0b1020;color:#fff;max-width:760px;margin:40px auto;padding:24px}\n.card{background:#151c30;border:1px solid #2a3552;border-radius:18px;padding:24px}\ninput,button{width:100%;box-sizing:border-box;padding:14px;border-radius:10px;margin-top:10px}\ninput{background:#0b1020;color:#fff;border:1px solid #3b4a70}\nbutton{background:#fff;color:#111;border:0;font-weight:700;cursor:pointer}\nsmall{color:#aeb8d0}.ok{color:#7df0a7}.bad{color:#ff9b9b}\n</style></head><body><div class=\"card\"><h2>O-RA Cloudflare R2 Recovery</h2>\n<p>This restores the encrypted O-RA snapshot into the existing Cloudflare R2 bucket.</p>\n<small>You must be logged in to O-RA System as Super Admin in this browser.</small>\n<input id=\"key\" placeholder=\"Recovery key (64 hex characters)\">\n<button id=\"restore\">Restore to Cloudflare R2</button>\n<p id=\"status\"></p></div>\n<script>\nconst b64bytes=s=>{const bin=atob(s);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out};\nconst hexBytes=h=>new Uint8Array((h.match(/../g)||[]).map(x=>parseInt(x,16)));\nconst rotl=(v,n)=>((v<<n)|(v>>>(32-n)))>>>0;\nconst qr=(s,a,b,c,d)=>{s[a]=(s[a]+s[b])>>>0;s[d]^=s[a];s[d]=rotl(s[d],16);s[c]=(s[c]+s[d])>>>0;s[b]^=s[c];s[b]=rotl(s[b],12);s[a]=(s[a]+s[b])>>>0;s[d]^=s[a];s[d]=rotl(s[d],8);s[c]=(s[c]+s[d])>>>0;s[b]^=s[c];s[b]=rotl(s[b],7)};\nconst u32=(b,o)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;\nconst put32=(o,p,v)=>{o[p]=v&255;o[p+1]=(v>>>8)&255;o[p+2]=(v>>>16)&255;o[p+3]=(v>>>24)&255};\nconst chacha=(input,key,nonce)=>{const out=new Uint8Array(input.length),cons=new Uint32Array([0x61707865,0x3320646e,0x79622d32,0x6b206574]);for(let off=0,ctr=1;off<input.length;off+=64,ctr=(ctr+1)>>>0){const st=new Uint32Array(16);st.set(cons);for(let i=0;i<8;i++)st[4+i]=u32(key,i*4);st[12]=ctr;st[13]=u32(nonce,0);st[14]=u32(nonce,4);st[15]=u32(nonce,8);const x=new Uint32Array(st);for(let r=0;r<10;r++){qr(x,0,4,8,12);qr(x,1,5,9,13);qr(x,2,6,10,14);qr(x,3,7,11,15);qr(x,0,5,10,15);qr(x,1,6,11,12);qr(x,2,7,8,13);qr(x,3,4,9,14)}const block=new Uint8Array(64);for(let i=0;i<16;i++)put32(block,i*4,(x[i]+st[i])>>>0);const n=Math.min(64,input.length-off);for(let i=0;i<n;i++)out[off+i]=input[off+i]^block[i]}return out};\nconst params=new URLSearchParams(location.hash.replace(/^#/,''));\nif(params.get('key'))document.getElementById('key').value=params.get('key');\ndocument.getElementById('restore').onclick=async()=>{\n const status=document.getElementById('status');status.className='';status.textContent='Reading encrypted snapshot...';\n try{\n  const keyText=document.getElementById('key').value.trim();\n  if(!/^[0-9a-f]{64}$/i.test(keyText))throw new Error('Recovery key is invalid.');\n  const token=localStorage.getItem('ora_staff_session_token')||'';\n  if(!token)throw new Error('Login to /system as Super Admin first.');\n  const enc=await fetch('/recovery/ora-data-20261002.enc.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Encrypted snapshot not deployed yet.');return r.json()});\n  const plain=chacha(b64bytes(enc.data),hexBytes(keyText),b64bytes(enc.nonce));\n  const bundle=JSON.parse(new TextDecoder().decode(plain));\n  status.textContent='Uploading '+(bundle.orders||[]).length+' orders to R2...';\n  const res=await fetch('/api/cloudflare-recovery/import',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify(bundle)});\n  const data=await res.json().catch(()=>({}));\n  if(!res.ok)throw new Error(data.error||'R2 import failed.');\n  status.className='ok';status.textContent='RESTORED: '+data.orders+' orders. Open /system and refresh.';\n }catch(e){status.className='bad';status.textContent=String(e&&e.message||e)}\n};\n</script></body></html>";

const recoveryHandler=async(request:Request,envValue:unknown):Promise<Response|null>=>{
  const url=new URL(request.url);
  const bucket=bucketFor(envValue);

  if(url.pathname==='/system/recovery'&&request.method==='GET'){
    return new Response(RECOVERY_HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }

  if(!bucket)return null;

  if(url.pathname==='/api/cloudflare-recovery/import'&&request.method==='POST'){
    const session=await verifySession(request,envValue);
    if(!session||session.role!=='admin')return json({error:'Super Admin login required.'},401);
    let bundle:any={};
    try{bundle=await request.json();}catch{return json({error:'Invalid recovery payload.'},400);}
    if(bundle?.format!=='ora-r2-recovery-v1'||!Array.isArray(bundle.orders)||!Array.isArray(bundle.admin_data_store)||!Array.isArray(bundle.admin_users)){
      return json({error:'Invalid O-RA recovery bundle.'},400);
    }
    await Promise.all([
      writeJson(bucket,ORDERS_KEY,bundle.orders),
      writeJson(bucket,ADMIN_DATA_KEY,bundle.admin_data_store),
      writeJson(bucket,USERS_KEY,bundle.admin_users),
      writeJson(bucket,WAYBILLS_KEY,Array.isArray(bundle.courier_waybills)?bundle.courier_waybills:[]),
    ]);
    await writeJson(bucket,META_KEY,{
      active:true,mode:'cloudflare-r2',restored_at:new Date().toISOString(),
      exported_at:bundle.exported_at,orders:bundle.orders.length
    });
    return json({
      ok:true,storage:'cloudflare-r2',orders:bundle.orders.length,
      admin_data_store:bundle.admin_data_store.length,admin_users:bundle.admin_users.length,
      waybills:Array.isArray(bundle.courier_waybills)?bundle.courier_waybills.length:0
    });
  }

  if(url.pathname==='/api/cloudflare-recovery/status'&&request.method==='GET'){
    const session=await verifySession(request,envValue);
    if(!session)return json({error:'Login required.'},401);
    const meta=await readJson<any>(bucket,META_KEY,{active:false});
    return json({ok:true,...meta});
  }

  return null;
};

const r2Direct=async(request:Request,envValue:unknown):Promise<Response|null>=>{
  const bucket=bucketFor(envValue);
  if(!bucket)return null;
  const meta=await readJson<any>(bucket,META_KEY,{active:false});
  if(meta?.active!==true)return null;

  const url=new URL(request.url);
  const path=url.pathname;

  if(request.method==='GET'&&path==='/api/storefront/state'){
    const rows=await readJson<any[]>(bucket,ADMIN_DATA_KEY,[]);
    const state=adminPayload(rows,'storefront-state-v1');
    return json({initialized:Boolean(state),state:state?publicStorefront(state):null});
  }

  if(request.method==='GET'&&path==='/api/storefront/version'){
    const rows=await readJson<any[]>(bucket,ADMIN_DATA_KEY,[]);
    const state=adminPayload(rows,'storefront-state-v1');
    return json({initialized:Boolean(state),updated_at:String(state?.updated_at||'')});
  }

  if(request.method==='POST'&&path==='/api/staff/login'){
    let body:any={};
    try{body=await request.json();}catch{}
    const users=await readJson<any[]>(bucket,USERS_KEY,[]);
    const username=String(body?.username||'').trim().toLowerCase();
    const user=users.find((u:any)=>String(u?.username||'').trim().toLowerCase()===username);
    if(!user||!(await verifyPassword(String(body?.password||''),String(user?.password_hash||''),envValue))){
      return json({error:'Invalid username or password.'},401);
    }
    if(user.is_active===false)return json({error:'This account is disabled.'},403);
    return json({user:publicStaff(user),token:await signSession(user,envValue)});
  }

  const session=await verifySession(request,envValue);
  const staffPath=
    (request.method==='GET'&&path==='/api/orders')||
    path==='/api/orders/version'||
    path.startsWith('/api/admin')||
    path.startsWith('/api/staff/');
  if(staffPath&&!session)return json({error:'Login session required.'},401);

  if(request.method==='POST'&&path==='/api/staff/session/refresh'&&session){
    const users=await readJson<any[]>(bucket,USERS_KEY,[]);
    const user=users.find((u:any)=>String(u.id)===session.sub&&u.is_active!==false);
    if(!user)return json({error:'Account is disabled or missing.'},401);
    return json({ok:true,token:await signSession(user,envValue)});
  }

  if(request.method==='GET'&&path==='/api/staff/accounts'&&session?.role==='admin'){
    const users=await readJson<any[]>(bucket,USERS_KEY,[]);
    return json({users:users.map(publicStaff)});
  }

  if(request.method==='GET'&&path==='/api/orders'&&session){
    const orders=await readJson<any[]>(bucket,ORDERS_KEY,[]);
    return json({orders});
  }

  if(request.method==='GET'&&path==='/api/orders/version'&&session){
    return json(orderVersion(await readJson<any[]>(bucket,ORDERS_KEY,[])));
  }

  const orderPut=path.match(/^\/api\/orders\/([^/]+)$/);
  if(request.method==='PUT'&&orderPut&&session){
    let body:any={};
    try{body=await request.json();}catch{}
    const incoming=body?.order;
    const id=decodeURIComponent(orderPut[1]);
    if(!incoming||String(incoming.id)!==id)return json({error:'Order ID mismatch.'},400);
    const saved=await saveOrderR2(bucket,incoming);
    return json({ok:true,order:saved,waybill_preserved:false,storage:'cloudflare-r2'});
  }

  if(request.method==='GET'&&path==='/api/admin/storefront/state'&&session){
    const rows=await readJson<any[]>(bucket,ADMIN_DATA_KEY,[]);
    const state=adminPayload(rows,'storefront-state-v1');
    return json({initialized:Boolean(state),state:state||null});
  }

  if(request.method==='PUT'&&path==='/api/admin/storefront/state'&&session){
    let body:any={};
    try{body=await request.json();}catch{}
    if(!Array.isArray(body?.products)||!Array.isArray(body?.categories)||!body?.settings||typeof body.settings!=='object'){
      return json({error:'Products, categories and settings are required.'},400);
    }
    const rows=await readJson<any[]>(bucket,ADMIN_DATA_KEY,[]);
    const current=adminPayload(rows,'storefront-state-v1')||{};
    const state={
      version:Math.max(1,Number(current?.version||0)+1),
      updated_at:new Date().toISOString(),
      products:body.products,categories:body.categories,settings:body.settings
    };
    await writeJson(bucket,ADMIN_DATA_KEY,setAdminPayload(rows,'storefront-state-v1',state));
    return json({ok:true,version:state.version,updated_at:state.updated_at,storage:'cloudflare-r2'});
  }

  const adminData=path.match(/^\/api\/admin-data\/([^/]+)$/);
  if(adminData&&session){
    const key=decodeURIComponent(adminData[1]);
    const rows=await readJson<any[]>(bucket,ADMIN_DATA_KEY,[]);
    if(request.method==='GET')return json({payload:adminPayload(rows,key)??null});
    if(request.method==='PUT'){
      let body:any={};
      try{body=await request.json();}catch{}
      await writeJson(bucket,ADMIN_DATA_KEY,setAdminPayload(rows,key,body?.payload));
      return json({ok:true,storage:'cloudflare-r2'});
    }
  }

  if(request.method==='GET'&&path==='/api/admin/complaints'&&session){
    const rows=await readJson<any[]>(bucket,ADMIN_DATA_KEY,[]);
    const value=adminPayload(rows,'complaints');
    return json({complaints:Array.isArray(value)?value:[]});
  }

  if(request.method==='GET'&&path==='/api/admin/assistant-chats'&&session){
    const rows=await readJson<any[]>(bucket,ADMIN_DATA_KEY,[]);
    const value=adminPayload(rows,'assistant-chats');
    return json({chats:Array.isArray(value)?value:[]});
  }

  return null;
};

const r2PublicOrderFallback=async(request:Request,envValue:unknown,response:Response):Promise<Response>=>{
  if(response.ok)return response;
  const bucket=bucketFor(envValue);
  if(!bucket)return response;
  const meta=await readJson<any>(bucket,META_KEY,{active:false});
  if(meta?.active!==true)return response;

  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/api/orders')return response;

  let body:any={};
  try{body=await request.json();}catch{return response;}
  const order=body?.order;
  if(!order?.id||!order?.order_number)return response;

  try{
    const saved=await saveOrderR2(bucket,order);
    return json({
      ok:true,order:saved,storage:'cloudflare-r2',
      sheet_sync:{ok:false,queued:false,error:'Supabase unavailable; order saved safely in Cloudflare R2.'}
    });
  }catch{
    return response;
  }
};

export const withR2DataFallback=async(
  request:Request,
  env:unknown,
  ctx:any,
  next:()=>Promise<Response>,
):Promise<Response>=>{
  const recovery=await recoveryHandler(request,env);
  if(recovery)return recovery;

  const direct=await r2Direct(request.clone(),env);
  if(direct)return direct;

  const fallbackCopy=request.clone();
  const response=await next();
  return r2PublicOrderFallback(fallbackCopy,env,response);
};
