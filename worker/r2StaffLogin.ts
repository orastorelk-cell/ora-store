import { Buffer } from 'node:buffer';
import { readDataTable } from './cloudflareData';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ora-storage': 'cloudflare-r2' },
});
const publicStaff = (user: any) => ({
  id: String(user.id), username: String(user.username), name: String(user.display_name || user.name || user.username),
  email: String(user.email || ''), role: user.role === 'admin' ? 'admin' : 'staff',
  permissions: user.role === 'admin' ? undefined : (Array.isArray(user.permissions) ? user.permissions : []),
  is_active: user.is_active !== false, created_at: String(user.created_at || ''),
});

// Keep the saved account/hash and the existing 12-hour session format. Normal
// Cloudflare sign-in should not start Express and round-trip through PostgREST.
export const r2StaffLoginHandler = async (request: Request, env: any): Promise<Response | null> => {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/staff/login') return null;
  const body: any = await request.clone().json().catch(() => null);
  if (typeof body?.username !== 'string' || typeof body?.password !== 'string' ||
      body.username.length > 254 || body.password.length > 4096) return json({ error: 'Username and password are required.' }, 400);
  const username = body.username.trim().toLowerCase();
  const user = (await readDataTable(env, 'admin_users')).find(user => String(user.username) === username);
  if (!user) return json({ error: 'Invalid username or password.' }, 401);
  const hash = String(user.password_hash || '');
  // Preserve legacy scrypt account compatibility in the existing server route.
  if (!hash.startsWith('cfhmac:')) return null;
  const [, salt, digest] = hash.split(':');
  if (!salt || !/^[a-f0-9]{64}$/i.test(digest || '')) return json({ error: 'Invalid username or password.' }, 401);
  const secret = String(env?.STAFF_SESSION_SECRET || env?.ABUSE_HASH_SALT || '');
  if (!secret) throw new Error('Staff session configuration is unavailable.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify', 'sign']);
  const valid = await crypto.subtle.verify('HMAC', key, Buffer.from(digest, 'hex'), new TextEncoder().encode(salt + ':' + body.password));
  if (!valid) return json({ error: 'Invalid username or password.' }, 401);
  if (user.is_active === false) return json({ error: 'This account is disabled.' }, 403);
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
