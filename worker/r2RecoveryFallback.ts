import { activeData, configureCloudflareData, dataBucket } from './cloudflareData';

type Env = Record<string, any>;
type StaffSession = { sub:string; role:'admin'|'staff'; exp:number };
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

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
    const secret=String(env?.STAFF_SESSION_SECRET || env?.ABUSE_HASH_SALT || '');
    if(!secret)return null;
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

const RECOVERY_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>O-RA Cloudflare Recovery</title><style>body{font-family:Arial,sans-serif;background:#0b1020;color:white;max-width:760px;margin:40px auto;padding:24px}.card{background:#151c30;border:1px solid #2a3552;border-radius:18px;padding:24px}button,a{display:block;margin-top:16px;color:inherit}button{padding:14px;border-radius:10px;border:0;cursor:pointer}pre{white-space:pre-wrap}</style></head><body><div class=\"card\"><h2>O-RA Cloudflare data</h2><p>Recovery is complete. System data now saves in Cloudflare R2.</p><p>The temporary snapshot and one-time import have been removed to protect live data.</p><a href=\"/system\">Open O-RA System</a><button id=\"check\">Check Cloudflare data</button><pre id=\"status\">Sign in to /system first to check the current order count.</pre></div><script>history.replaceState(null,'',location.pathname);document.getElementById('check').onclick=async()=>{const out=document.getElementById('status');try{const token=localStorage.getItem('ora_staff_session_token')||'';if(!token)throw new Error('Sign in to /system first.');const r=await fetch('/api/cloudflare-recovery/status',{headers:{authorization:'Bearer '+token},cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Cloudflare status could not be read.');out.textContent='Storage: '+d.mode+'\\nOrders: '+d.orders+'\\nRecovery active: '+d.active;}catch(e){out.textContent=e.message||String(e)}};</script></body></html>";

const recoveryHandler=async(request:Request,envValue:unknown):Promise<Response|null>=>{
  const url=new URL(request.url);
  const bucket=dataBucket(envValue);

  if(url.pathname==='/system/recovery'&&request.method==='GET'){
    return new Response(RECOVERY_HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }

  if(!bucket && url.pathname.startsWith('/api/cloudflare-recovery/'))return json({error:'Cloudflare R2 binding is unavailable.'},503);
  if(!bucket)return null;

  if(url.pathname==='/api/cloudflare-recovery/import')return json({error:'Recovery is complete. Imports are disabled to protect live Cloudflare data.'},410);

  if(url.pathname==='/api/cloudflare-recovery/status'&&request.method==='GET'){
    const session=await verifySession(request,envValue);
    if(!session)return json({error:'Login required.'},401);
    const active=await activeData(bucket);
    if(!active)return json({ok:true,active:false});
    const users=JSON.parse(await (await bucket.get(active.prefix+'admin_users.json'))!.text());
    if(!users.some((u:any)=>String(u.id)===session.sub && u.is_active!==false))return json({error:'Account is disabled or missing.'},401);
    const orders=JSON.parse(await (await bucket.get(active.prefix+'order_snapshots.json'))!.text());
    return json({ok:true,active:true,mode:'cloudflare-r2',orders:orders.length,restored_at:active.restored_at,counts:active.counts});
  }

  return null;
};

export const withR2DataFallback=async(request:Request,env:unknown,_ctx:any,next:()=>Promise<Response>):Promise<Response>=>{
  configureCloudflareData(env);
  try {
    const recovery=await recoveryHandler(request,env);
    if(recovery)return recovery;
    return await next();
  }catch(e:any){return json({error:e?.message||'Cloudflare data recovery failed.'},503);}
};
