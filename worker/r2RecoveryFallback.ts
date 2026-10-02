import { RECOVERY_BUNDLE_SHA256, RECOVERY_KEY_SHA256 } from './recoveryFingerprint';
import { activeData, configureCloudflareData, dataBucket, importRecovery } from './cloudflareData';

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

const RECOVERY_HTML = "<!doctype html>\n<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>O-RA Cloudflare Recovery</title>\n<style>\nbody{font-family:Arial,sans-serif;background:#0b1020;color:#fff;max-width:760px;margin:40px auto;padding:24px}\n.card{background:#151c30;border:1px solid #2a3552;border-radius:18px;padding:24px}\ninput,button{width:100%;box-sizing:border-box;padding:14px;border-radius:10px;margin-top:10px}\ninput{background:#0b1020;color:#fff;border:1px solid #3b4a70}\nbutton{background:#fff;color:#111;border:0;font-weight:700;cursor:pointer}\nsmall{color:#aeb8d0}.ok{color:#7df0a7}.bad{color:#ff9b9b}\n</style></head><body><div class=\"card\"><h2>O-RA Cloudflare R2 Recovery</h2>\n<p>This restores the encrypted O-RA snapshot into the existing Cloudflare R2 bucket.</p>\n<small>Use the recovery key to restore the verified snapshot once. Existing live R2 data is never replaced.</small>\n<input id=\"key\" type=\"password\" placeholder=\"Recovery key (64 hex characters)\">\n<button id=\"restore\">Restore to Cloudflare R2</button>\n<p id=\"status\"></p></div>\n<script>\nconst b64bytes=s=>{const bin=atob(s);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out};\nconst hexBytes=h=>new Uint8Array((h.match(/../g)||[]).map(x=>parseInt(x,16)));\nconst rotl=(v,n)=>((v<<n)|(v>>>(32-n)))>>>0;\nconst qr=(s,a,b,c,d)=>{s[a]=(s[a]+s[b])>>>0;s[d]^=s[a];s[d]=rotl(s[d],16);s[c]=(s[c]+s[d])>>>0;s[b]^=s[c];s[b]=rotl(s[b],12);s[a]=(s[a]+s[b])>>>0;s[d]^=s[a];s[d]=rotl(s[d],8);s[c]=(s[c]+s[d])>>>0;s[b]^=s[c];s[b]=rotl(s[b],7)};\nconst u32=(b,o)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;\nconst put32=(o,p,v)=>{o[p]=v&255;o[p+1]=(v>>>8)&255;o[p+2]=(v>>>16)&255;o[p+3]=(v>>>24)&255};\nconst chacha=(input,key,nonce)=>{const out=new Uint8Array(input.length),cons=new Uint32Array([0x61707865,0x3320646e,0x79622d32,0x6b206574]);for(let off=0,ctr=1;off<input.length;off+=64,ctr=(ctr+1)>>>0){const st=new Uint32Array(16);st.set(cons);for(let i=0;i<8;i++)st[4+i]=u32(key,i*4);st[12]=ctr;st[13]=u32(nonce,0);st[14]=u32(nonce,4);st[15]=u32(nonce,8);const x=new Uint32Array(st);for(let r=0;r<10;r++){qr(x,0,4,8,12);qr(x,1,5,9,13);qr(x,2,6,10,14);qr(x,3,7,11,15);qr(x,0,5,10,15);qr(x,1,6,11,12);qr(x,2,7,8,13);qr(x,3,4,9,14)}const block=new Uint8Array(64);for(let i=0;i<16;i++)put32(block,i*4,(x[i]+st[i])>>>0);const n=Math.min(64,input.length-off);for(let i=0;i<n;i++)out[off+i]=input[off+i]^block[i]}return out};\nconst params=new URLSearchParams(location.hash.replace(/^#/,''));\nif(params.get('key'))document.getElementById('key').value=params.get('key');\ndocument.getElementById('restore').onclick=async()=>{\n const status=document.getElementById('status');status.className='';status.textContent='Reading encrypted snapshot...';\n try{\n  const keyText=document.getElementById('key').value.trim();\n  if(!/^[0-9a-f]{64}$/i.test(keyText))throw new Error('Recovery key is invalid.');\n  const token=localStorage.getItem('ora_staff_session_token')||'';\n  const enc=await fetch('/recovery/ora-data-20261002.enc.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Encrypted snapshot not deployed yet.');return r.json()});\n  const plain=chacha(b64bytes(enc.data),hexBytes(keyText),b64bytes(enc.nonce));\n  const bundle=JSON.parse(new TextDecoder().decode(plain));\n  status.textContent='Uploading '+(bundle.orders||[]).length+' orders to R2...';\n  const res=await fetch('/api/cloudflare-recovery/import',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify({bundle,recovery_key:keyText})});\n  const data=await res.json().catch(()=>({}));\n  if(!res.ok)throw new Error(data.error||'R2 import failed.');\n  status.className='ok';status.textContent='RESTORED: '+data.orders+' orders. Open /system and refresh.';\n }catch(e){status.className='bad';status.textContent=String(e&&e.message||e)}\n};\n</script></body></html>";

const recoveryHandler=async(request:Request,envValue:unknown):Promise<Response|null>=>{
  const url=new URL(request.url);
  const bucket=dataBucket(envValue);

  if(url.pathname==='/system/recovery'&&request.method==='GET'){
    return new Response(RECOVERY_HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }

  if(!bucket && url.pathname.startsWith('/api/cloudflare-recovery/'))return json({error:'Cloudflare R2 binding is unavailable.'},503);
  if(!bucket)return null;

  if(url.pathname==='/api/cloudflare-recovery/import'&&request.method==='POST'){
    const session=await verifySession(request,envValue);
    let input:any={};
    try{input=await request.json();}catch{return json({error:'Invalid recovery payload.'},400);}
    const bundle=input?.bundle||input;
    const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
    // A key-holder can activate only this exact snapshot, once. This does not
    // grant an admin session or permission to change any existing R2 records.
    const key=String(input?.recovery_key||'').trim().toLowerCase();
    const scopedRecovery=/^[0-9a-f]{64}$/.test(key) && await sha(key)===RECOVERY_KEY_SHA256 &&
      await sha(JSON.stringify(bundle))===RECOVERY_BUNDLE_SHA256;
    if(!scopedRecovery && (!session || session.role!=='admin'))return json({error:'Super Admin login or the valid recovery key is required.'},401);
    if(bundle?.format!=='ora-r2-recovery-v1'||!Array.isArray(bundle.orders)||!Array.isArray(bundle.admin_data_store)||!Array.isArray(bundle.admin_users)){
      return json({error:'Invalid O-RA recovery bundle.'},400);
    }
    const active=await activeData(bucket);
    const users=active ? JSON.parse(await (await bucket.get(active.prefix+'admin_users.json'))!.text()) : bundle.admin_users;
    if(!scopedRecovery && !users.some((u:any)=>String(u.id)===session?.sub && u.role==='admin' && u.is_active!==false)) {
      return json({error:'An active Super Admin session is required.'},403);
    }
    const restored=await importRecovery(bucket,bundle);
    return json({ok:true,storage:'cloudflare-r2',orders:restored.counts.order_snapshots,
      admin_data_store:restored.counts.admin_data_store,admin_users:restored.counts.admin_users,
      waybills:restored.counts.courier_waybills,cities:restored.counts.fardar_cities,
      already_restored:('already_restored' in restored && restored.already_restored)});
  }

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
