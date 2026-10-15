import { Buffer } from 'node:buffer';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { readDataTable, replaceDataTable } from './cloudflareData';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ora-storage': 'cloudflare-r2' },
});
const publicStaff = (user: any) => ({
  id: String(user.id), username: String(user.username), name: String(user.display_name || user.name || user.username),
  email: String(user.email || ''), role: user.role === 'admin' ? 'admin' : 'staff',
  permissions: user.role === 'admin' ? undefined : (Array.isArray(user.permissions) ? user.permissions : []),
  is_active: user.is_active !== false, created_at: String(user.created_at || ''),
});

const legacyPasswordMatches = async (password: string, stored: string) => {
  const parts=stored.split(':');
  if(parts.length!==2||!parts[0]||parts[0].length>254||!/^[a-f0-9]{128}$/i.test(parts[1]))return false;
  const derived=await new Promise<Buffer>((resolve,reject)=>scrypt(password,parts[0],64,(error,key)=>error?reject(error):resolve(key)));
  return timingSafeEqual(derived,Buffer.from(parts[1],'hex'));
};
const passwordMatches=async(password:string,hash:string,key:CryptoKey)=>{
  if(!hash.startsWith('cfhmac:'))return legacyPasswordMatches(password,hash);
  const parts=hash.split(':'),salt=parts[1],digest=parts[2];
  if(parts.length!==3||!salt||!/^[a-f0-9]{64}$/i.test(digest||''))return false;
  return crypto.subtle.verify('HMAC',key,Buffer.from(digest,'hex'),new TextEncoder().encode(salt+':'+password));
};

// Keep the saved account/hash and the existing 12-hour session format. Normal
// Cloudflare sign-in should not start Express and round-trip through PostgREST.
export const r2StaffLoginHandler = async (request: Request, env: any): Promise<Response | null> => {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/staff/login') return null;
  const body: any = await request.clone().json().catch(() => null);
  if (typeof body?.username !== 'string' || typeof body?.password !== 'string' ||
      body.username.length > 254 || body.password.length > 4096) return json({ error: 'Username and password are required.' }, 400);
  const username = body.username.trim().toLowerCase();
  let user = (await readDataTable(env, 'admin_users')).find(user => String(user.username).trim().toLowerCase() === username);
  if (!user) return json({ error: 'Invalid username or password.' }, 401);
  const hash = String(user.password_hash || '');
  const secret = String(env?.STAFF_SESSION_SECRET || env?.ABUSE_HASH_SALT || '');
  if (!secret) throw new Error('Staff session configuration is unavailable.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify', 'sign']);
  const legacy=!hash.startsWith('cfhmac:');
  const valid=await passwordMatches(body.password,hash,key);
  if (!valid) return json({ error: 'Invalid username or password.' }, 401);
  if (user.is_active === false) return json({ error: 'This account is disabled.' }, 403);
  if(legacy){
    // Verify the original scrypt password once, without the Express/Supabase
    // bridge or synchronous crypto. Preserve the password, ID and permissions;
    // upgrade only its verifier to the format already used by Worker accounts.
    const salt=Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
    const digest=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(salt+':'+body.password))).toString('hex');
    let migrated:any=null;
    try{
      migrated=await replaceDataTable<any>(env,'admin_users',rows=>{
        const current=rows.find(row=>String(row.id)===String(user.id));
        if(!current||current.password_hash!==hash||current.is_active===false)return {rows,result:null};
        const updated={...current,password_hash:`cfhmac:${salt}:${digest}`,updated_at:new Date().toISOString()};
        return {rows:rows.map(row=>row===current?updated:row),result:updated};
      });
    }catch{
      // A verifier upgrade is optional maintenance. A failed write must not lock
      // out a verified, still-active account or fall back to an unsafe default.
    }
    if(migrated)user=migrated;
    else{
      const current=(await readDataTable(env,'admin_users')).find(row=>String(row.id)===String(user.id));
      // Another successful login can migrate the same password concurrently.
      // A real password reset must still invalidate the old password.
      if(!current||current.password_hash!==hash&&!await passwordMatches(body.password,String(current.password_hash||''),key))return json({error:'Account changed during sign-in. Please sign in again.'},401);
      if(current.is_active===false)return json({error:'This account is disabled.'},403);
      user=current;
    }
  }
  const payload = Buffer.from(JSON.stringify({ sub: String(user.id), role: user.role === 'admin' ? 'admin' : 'staff', exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return json({ user: publicStaff(user), token: payload + '.' + signature });
};

export const r2StaffAccountsHandler = async (request: Request, env: unknown, verifyStaff: (request: Request, env: unknown) => Promise<any>): Promise<Response | null> => {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/api/staff/accounts') return null;
  const user = await verifyStaff(request, env);
  if (!user) return json({ error: 'Login session required.' }, 401);
  if (user.role !== 'admin') return json({ error: 'Super Admin access required.' }, 403);
  return json({ users: (await readDataTable(env, 'admin_users')).map(publicStaff) });
};
