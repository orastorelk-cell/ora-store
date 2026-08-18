import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "20mb" }));

// -----------------------------------------------------------------------------
// Shared Admin / Staff account store
// -----------------------------------------------------------------------------
// Local development fallback: one server-side JSON file shared by every browser
// that opens the same localhost server. Live Cloudflare deployments persist data in Supabase.
const isCloudflareRuntime = process.env.CLOUDFLARE_WORKERS === '1';
const isLiveServerlessRuntime = isCloudflareRuntime;
const runtimeName = isCloudflareRuntime ? 'cloudflare' : 'local';
const staffDataDir = isLiveServerlessRuntime ? path.join('/tmp', 'ora-data') : path.join(process.cwd(), '.ora-data');
const staffDataFile = path.join(staffDataDir, 'staff-accounts.json');
const fardarCitiesFile = path.join(staffDataDir, 'fardar-cities.json');
const fardarCityMappingsFile = path.join(staffDataDir, 'fardar-city-mappings.json');
const orderSnapshotsFile = path.join(staffDataDir, 'order-snapshots.json');
const reviewsFile = path.join(staffDataDir, 'customer-reviews.json');
const productRequestsFile = path.join(staffDataDir, 'product-requests.json');
const adminDataFile = path.join(staffDataDir, 'admin-data-store.json');
const uploadsDir = path.join(staffDataDir, 'uploads');
const staffSessionSecret = process.env.STAFF_SESSION_SECRET || process.env.ABUSE_HASH_SALT || 'ora-local-staff-session-change-in-production';

interface ServerStaffAccount {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: 'admin' | 'staff';
  permissions: string[];
  is_active: boolean;
  password_hash: string;
  created_at: string;
  updated_at?: string;
}

const normalizeUsername = (v: unknown) => String(v || '').trim().toLowerCase();
const hashPassword = (password: string, salt = crypto.randomBytes(16).toString('hex')) => {
  // Cloudflare Workers Free has a tight per-request CPU budget. For that runtime
  // use a fast server-secret HMAC password verifier; the DB hash is useless
  // without STAFF_SESSION_SECRET. Local Node development keeps scrypt.
  if (isCloudflareRuntime) {
    const digest = crypto.createHmac('sha256', staffSessionSecret).update(`${salt}:${password}`).digest('hex');
    return `cfhmac:${salt}:${digest}`;
  }
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};
const verifyPassword = (password: string, stored: string) => {
  try {
    const value = String(stored || '');
    if (value.startsWith('cfhmac:')) {
      const [, salt, expected] = value.split(':');
      if (!salt || !expected) return false;
      const actual = crypto.createHmac('sha256', staffSessionSecret).update(`${salt}:${password}`).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
    }
    const [salt, expected] = value.split(':');
    if (!salt || !expected) return false;
    const actual = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
};
const publicStaff = (u: ServerStaffAccount) => ({
  id: u.id,
  username: u.username,
  name: u.display_name,
  email: u.email || '',
  role: u.role,
  permissions: u.role === 'admin' ? undefined : (u.permissions || []),
  is_active: u.is_active !== false,
  created_at: u.created_at,
});

const getSupabaseAdmin = () => {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes('your-project') || key.includes('your-secret') || key.includes('your-service-role')) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

app.get('/api/health', async (_req, res) => {
  const sb = getSupabaseAdmin();
  if (!sb) return res.status(503).json({ ok:false, runtime:runtimeName, supabase:false, error:'Supabase server configuration is missing.' });
  try {
    const { error } = await sb.from('admin_data_store').select('key').limit(1);
    if (error) throw error;
    return res.json({ ok:true, runtime:runtimeName, supabase:true });
  } catch (e:any) {
    return res.status(503).json({ ok:false, runtime:runtimeName, supabase:true, error:e?.message || 'Supabase connection failed.' });
  }
});


const ensureOraDataDirs = () => {
  if (!fs.existsSync(staffDataDir)) fs.mkdirSync(staffDataDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
};
if (!isLiveServerlessRuntime) {
  ensureOraDataDirs();
  app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', immutable: false }));
}

const readJsonArray = (file: string): any[] => {
  try {
    ensureOraDataDirs();
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const writeJsonArray = (file: string, rows: any[]) => {
  ensureOraDataDirs();
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
};
const readAdminDataLocal = (): Record<string, any> => {
  try {
    ensureOraDataDirs();
    if (!fs.existsSync(adminDataFile)) fs.writeFileSync(adminDataFile, '{}', 'utf8');
    const parsed = JSON.parse(fs.readFileSync(adminDataFile, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};
const writeAdminDataLocal = (data: Record<string, any>) => {
  ensureOraDataDirs();
  fs.writeFileSync(adminDataFile, JSON.stringify(data, null, 2), 'utf8');
};

const membershipForCount = (count: number) => {
  if (count >= 20) return 'VIP MEMBER';
  if (count >= 11) return 'GOLD MEMBER';
  if (count >= 6) return 'SILVER MEMBER';
  if (count >= 3) return 'BRONZE MEMBER';
  return 'NEW CUSTOMER';
};

const getCustomerAuthUser = async (req: express.Request) => {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch { return null; }
};

const localDefaults = (): ServerStaffAccount[] => {
  const now = new Date().toISOString();
  return [
    { id: 'usr-1', username: 'admin', display_name: 'Super Admin', email: 'admin@orastore.lk', role: 'admin', permissions: [], is_active: true, password_hash: hashPassword(process.env.ORA_SUPER_ADMIN_PASSWORD || 'admin123'), created_at: now },
    { id: 'usr-2', username: 'staff', display_name: 'Call Center Staff', email: 'staff@orastore.lk', role: 'staff', permissions: ['orders','delivery','dispatch','customers','sheets'], is_active: true, password_hash: hashPassword(process.env.ORA_DEFAULT_STAFF_PASSWORD || 'staff123'), created_at: now },
  ];
};

const readLocalStaff = (): ServerStaffAccount[] => {
  try {
    if (!fs.existsSync(staffDataDir)) fs.mkdirSync(staffDataDir, { recursive: true });
    if (!fs.existsSync(staffDataFile)) fs.writeFileSync(staffDataFile, JSON.stringify(localDefaults(), null, 2), 'utf8');
    const parsed = JSON.parse(fs.readFileSync(staffDataFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : localDefaults();
  } catch { return localDefaults(); }
};
const writeLocalStaff = (rows: ServerStaffAccount[]) => {
  if (!fs.existsSync(staffDataDir)) fs.mkdirSync(staffDataDir, { recursive: true });
  fs.writeFileSync(staffDataFile, JSON.stringify(rows, null, 2), 'utf8');
};

const dbRowToStaff = (r: any): ServerStaffAccount => ({
  id: String(r.id), username: String(r.username), display_name: String(r.display_name || r.name || r.username), email: String(r.email || ''),
  role: r.role === 'admin' ? 'admin' : 'staff', permissions: Array.isArray(r.permissions) ? r.permissions : [], is_active: r.is_active !== false,
  password_hash: String(r.password_hash || ''), created_at: String(r.created_at || new Date().toISOString()), updated_at: r.updated_at || undefined,
});
const getAllStaff = async (): Promise<ServerStaffAccount[]> => {
  const sb = getSupabaseAdmin();
  if (!sb) return readLocalStaff();
  try {
    const { data, error } = await sb.from('admin_users').select('id,username,display_name,email,role,permissions,is_active,password_hash,created_at,updated_at').order('created_at');
    if (error) throw error;
    const rows = (data || []).map(dbRowToStaff);
    if (!rows.length) {
      const defs = localDefaults().map(({id, ...u}) => ({ ...u }));
      const { data: seeded, error: seedErr } = await sb.from('admin_users').insert(defs).select('id,username,display_name,email,role,permissions,is_active,password_hash,created_at,updated_at');
      if (seedErr) throw seedErr;
      return (seeded || []).map(dbRowToStaff);
    }
    return rows;
  } catch (e) {
    console.warn('Shared staff Supabase unavailable, using local server store:', (e as any)?.message || e);
    return readLocalStaff();
  }
};
const saveStaffAccount = async (account: ServerStaffAccount) => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const row = { username: account.username, display_name: account.display_name, email: account.email, role: account.role, permissions: account.permissions, is_active: account.is_active, password_hash: account.password_hash, updated_at: new Date().toISOString() };
      if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(account.id)) {
        const { data, error } = await sb.from('admin_users').update(row).eq('id', account.id).select().single();
        if (error) throw error; return dbRowToStaff(data);
      }
      const { data, error } = await sb.from('admin_users').insert({ ...row, created_at: account.created_at }).select().single();
      if (error) throw error; return dbRowToStaff(data);
    } catch (e) { console.warn('Supabase staff save failed, using local store:', (e as any)?.message || e); }
  }
  const rows = readLocalStaff();
  const idx = rows.findIndex((u) => u.id === account.id || u.username === account.username);
  if (idx >= 0) rows[idx] = account; else rows.push(account);
  writeLocalStaff(rows); return account;
};
const deleteStaffAccountServer = async (id: string) => {
  const sb = getSupabaseAdmin();
  if (sb && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) {
    try { const { error } = await sb.from('admin_users').delete().eq('id', id); if (!error) return; } catch {}
  }
  writeLocalStaff(readLocalStaff().filter((u) => u.id !== id));
};

const signStaffToken = (u: ServerStaffAccount) => {
  const payload = Buffer.from(JSON.stringify({ sub: u.id, role: u.role, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', staffSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};
const verifyStaffToken = (token: string) => {
  try {
    const [payload, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', staffSessionSecret).update(payload).digest('base64url');
    if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data as { sub: string; role: 'admin' | 'staff'; exp: number };
  } catch { return null; }
};
const requireAdminSession = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifyStaffToken(token);
  if (!session) return res.status(401).json({ error: 'Login session required.' });
  const user = (await getAllStaff()).find((u) => u.id === session.sub && u.is_active !== false);
  if (!user) return res.status(401).json({ error: 'Account is disabled or missing.' });
  (req as any).staffSessionUser = user;
  next();
};
const requireSuperAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  await requireAdminSession(req, res, () => {
    if ((req as any).staffSessionUser?.role !== 'admin') return res.status(403).json({ error: 'Super Admin access required.' });
    next();
  });
};

const requireStaffPermission = (permission: string) => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  await requireAdminSession(req, res, () => {
    const user = (req as any).staffSessionUser as ServerStaffAccount | undefined;
    if (!user) return res.status(401).json({ error: 'Login session required.' });
    if (user.role === 'admin' || (user.permissions || []).includes(permission)) return next();
    return res.status(403).json({ error: `Permission required: ${permission}` });
  });
};

const requireStaffAnyPermission = (permissions: string[]) => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  await requireAdminSession(req, res, () => {
    const user = (req as any).staffSessionUser as ServerStaffAccount | undefined;
    if (!user) return res.status(401).json({ error: 'Login session required.' });
    if (user.role === 'admin' || permissions.some((permission) => (user.permissions || []).includes(permission))) return next();
    return res.status(403).json({ error: `Permission required: ${permissions.join(' or ')}` });
  });
};

app.post('/api/staff/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  // Local-only first-run bootstrap. Once the Super Admin account exists, the
  // saved password is authoritative; the default password is never a backdoor.
  const sb = getSupabaseAdmin();
  const localSuperAdminPassword = process.env.ORA_SUPER_ADMIN_PASSWORD || 'admin123';
  if (!sb && username === 'admin' && password === localSuperAdminPassword) {
    const rows = readLocalStaff();
    const existingAdmin = rows.find((u) => u.role === 'admin');
    if (!existingAdmin) {
      const admin = localDefaults()[0];
      rows.unshift(admin);
      writeLocalStaff(rows);
      return res.json({ user: publicStaff(admin), token: signStaffToken(admin) });
    }
  }

  const user = (await getAllStaff()).find((u) => u.username === username);
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid username or password.' });
  if (user.is_active === false) return res.status(403).json({ error: 'This account is disabled.' });
  return res.json({ user: publicStaff(user), token: signStaffToken(user) });
});


app.post('/api/staff/change-password', requireAdminSession, async (req,res) => {
  try {
    const user=(req as any).staffSessionUser as ServerStaffAccount | undefined;
    if(!user)return res.status(401).json({error:'Login session required.'});
    const currentPassword=String(req.body?.current_password||'');
    const newPassword=String(req.body?.new_password||'');
    if(!verifyPassword(currentPassword,user.password_hash))return res.status(400).json({error:'Current password is incorrect.'});
    if(newPassword.length<8)return res.status(400).json({error:'New password must be at least 8 characters.'});
    const saved=await saveStaffAccount({...user,password_hash:hashPassword(newPassword),updated_at:new Date().toISOString()});
    return res.json({ok:true,user:publicStaff(saved)});
  }catch(e:any){return res.status(500).json({error:e?.message||'Password could not be changed.'});}
});

const maskRecoveryEmail=(email:string)=>{
  const [name,domain]=String(email||'').split('@');
  if(!name||!domain)return '';
  return `${name.slice(0,1)}${'*'.repeat(Math.max(2,Math.min(6,name.length-1)))}@${domain}`;
};
const passwordHashFingerprint=(user:ServerStaffAccount)=>crypto.createHash('sha256').update(String(user.password_hash||'')).digest('base64url').slice(0,24);
const signPasswordResetToken=(user:ServerStaffAccount)=>{
  const payload=Buffer.from(JSON.stringify({purpose:'ora-super-admin-reset',sub:user.id,pwd:passwordHashFingerprint(user),exp:Date.now()+10*60*1000})).toString('base64url');
  const sig=crypto.createHmac('sha256',staffSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};
const verifyPasswordResetToken=(token:string)=>{
  try{
    const [payload,sig]=String(token||'').split('.');
    const expected=crypto.createHmac('sha256',staffSessionSecret).update(payload).digest('base64url');
    if(!sig||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(data?.purpose!=='ora-super-admin-reset'||!data?.sub||!data?.exp||Date.now()>Number(data.exp))return null;
    return data as {sub:string;pwd?:string;exp:number};
  }catch{return null;}
};

app.post('/api/staff/super-admin-recovery/request', async (req,res)=>{
  if(!allowPublicSubmission(req,'super-admin-recovery-request',3,15*60*1000))return res.status(429).json({error:'Too many recovery requests. Please wait and try again.'});
  try{
    const username=normalizeUsername(req.body?.username||'admin');
    const admin=(await getAllStaff()).find((user)=>user.role==='admin'&&user.is_active!==false&&user.username===username);
    if(!admin)return res.status(404).json({error:'Super Admin account was not found.'});
    const email=String(admin.email||'').trim().toLowerCase();
    if(!email||!email.includes('@'))return res.status(400).json({error:'A valid Super Admin recovery email is not saved yet. Sign in and set it from System Access first.'});
    const sb=getSupabaseAdmin();
    if(!sb)return res.status(503).json({error:'Email OTP recovery needs the live Supabase connection. It is unavailable in local-only mode.'});

    const {data:listData,error:listError}=await sb.auth.admin.listUsers({page:1,perPage:1000});
    if(listError)throw listError;
    let authUser=(listData?.users||[]).find((user:any)=>String(user.email||'').toLowerCase()===email);
    if(!authUser){
      const {data:createData,error:createError}=await sb.auth.admin.createUser({email,email_confirm:true,user_metadata:{ora_super_admin_recovery:true}});
      if(createError)throw createError;
      authUser=createData.user;
    }
    if(!authUser)throw new Error('Recovery email user could not be prepared.');
    const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
    if(error)throw error;
    return res.json({ok:true,masked_email:maskRecoveryEmail(email)});
  }catch(e:any){return res.status(500).json({error:e?.message||'Recovery code could not be sent.'});}
});

app.post('/api/staff/super-admin-recovery/verify', async (req,res)=>{
  if(!allowPublicSubmission(req,'super-admin-recovery-verify',8,15*60*1000))return res.status(429).json({error:'Too many code attempts. Please wait and try again.'});
  try{
    const username=normalizeUsername(req.body?.username||'admin');
    const token=String(req.body?.otp||'').trim();
    if(!/^\d{6,8}$/.test(token))return res.status(400).json({error:'Enter the verification code from Gmail.'});
    const admin=(await getAllStaff()).find((user)=>user.role==='admin'&&user.is_active!==false&&user.username===username);
    if(!admin)return res.status(404).json({error:'Super Admin account was not found.'});
    const email=String(admin.email||'').trim().toLowerCase();
    const sb=getSupabaseAdmin();
    if(!sb)return res.status(503).json({error:'Email OTP recovery is unavailable in local-only mode.'});
    const {error}=await sb.auth.verifyOtp({email,token,type:'email'});
    if(error)return res.status(400).json({error:'Verification code is invalid or expired.'});
    return res.json({ok:true,reset_token:signPasswordResetToken(admin)});
  }catch(e:any){return res.status(500).json({error:e?.message||'Verification failed.'});}
});

app.post('/api/staff/super-admin-recovery/reset', async (req,res)=>{
  if(!allowPublicSubmission(req,'super-admin-recovery-reset',6,15*60*1000))return res.status(429).json({error:'Too many reset attempts. Please wait and try again.'});
  try{
    const reset=verifyPasswordResetToken(String(req.body?.reset_token||''));
    if(!reset)return res.status(400).json({error:'Recovery session is invalid or expired. Request a new code.'});
    const newPassword=String(req.body?.new_password||'');
    if(newPassword.length<8)return res.status(400).json({error:'New password must be at least 8 characters.'});
    const admin=(await getAllStaff()).find((user)=>user.id===reset.sub&&user.role==='admin'&&user.is_active!==false);
    if(!admin)return res.status(404).json({error:'Super Admin account was not found.'});
    if(!reset.pwd || reset.pwd!==passwordHashFingerprint(admin))return res.status(400).json({error:'This recovery session was already used or is no longer valid. Request a new code.'});
    await saveStaffAccount({...admin,password_hash:hashPassword(newPassword),updated_at:new Date().toISOString()});
    return res.json({ok:true});
  }catch(e:any){return res.status(500).json({error:e?.message||'Password reset failed.'});}
});

app.get('/api/staff/accounts', requireSuperAdmin, async (_req, res) => res.json({ users: (await getAllStaff()).map(publicStaff) }));
app.post('/api/staff/accounts', requireSuperAdmin, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '').trim();
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if ((await getAllStaff()).some((u) => u.username === username)) return res.status(409).json({ error: 'Username already exists.' });
  const account: ServerStaffAccount = {
    id: `usr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, username, display_name: String(req.body?.name || username).trim(), email: String(req.body?.email || '').trim(),
    role: req.body?.role === 'admin' ? 'admin' : 'staff', permissions: Array.isArray(req.body?.permissions) ? req.body.permissions : [], is_active: req.body?.is_active !== false,
    password_hash: hashPassword(password), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const saved = await saveStaffAccount(account); return res.json({ user: publicStaff(saved) });
});
app.patch('/api/staff/accounts/:id', requireSuperAdmin, async (req, res) => {
  const rows = await getAllStaff(); const current = rows.find((u) => u.id === req.params.id);
  if (!current) return res.status(404).json({ error: 'Account not found.' });
  const nextUsername = req.body?.username !== undefined ? normalizeUsername(req.body.username) : current.username;
  if (!nextUsername) return res.status(400).json({ error: 'Username is required.' });
  if (rows.some((u) => u.id !== current.id && u.username === nextUsername)) return res.status(409).json({ error: 'Username already exists.' });
  const next: ServerStaffAccount = { ...current, username: nextUsername, display_name: req.body?.name !== undefined ? String(req.body.name).trim() : current.display_name, email: req.body?.email !== undefined ? String(req.body.email).trim() : current.email, role: req.body?.role === 'admin' ? 'admin' : (req.body?.role !== undefined ? 'staff' : current.role), permissions: Array.isArray(req.body?.permissions) ? req.body.permissions : current.permissions, is_active: req.body?.is_active !== undefined ? Boolean(req.body.is_active) : current.is_active, password_hash: String(req.body?.password || '').trim() ? hashPassword(String(req.body.password).trim()) : current.password_hash, updated_at: new Date().toISOString() };
  const saved = await saveStaffAccount(next); return res.json({ user: publicStaff(saved) });
});
app.delete('/api/staff/accounts/:id', requireSuperAdmin, async (req, res) => {
  const current = (await getAllStaff()).find((u) => u.id === req.params.id);
  if (!current) return res.status(404).json({ error: 'Account not found.' });
  if (current.role === 'admin') {
    const admins = (await getAllStaff()).filter((u) => u.role === 'admin' && u.is_active !== false);
    if (admins.length <= 1) return res.status(400).json({ error: 'The last Super Admin cannot be deleted.' });
  }
  await deleteStaffAccountServer(req.params.id); return res.json({ ok: true });
});







// -----------------------------------------------------------------------------
// Public media uploads (compressed client images only)
// Live: Supabase Storage. Local dev: .ora-data/uploads.
// -----------------------------------------------------------------------------
const publicSubmissionAttempts = new Map<string, number[]>();
const allowPublicSubmission = (req: express.Request, bucket: string, max: number, windowMs: number) => {
  const rawIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const key = crypto.createHash('sha256').update(`${staffSessionSecret}:${bucket}:${rawIp}`).digest('hex').slice(0, 28);
  const now = Date.now();
  const recent = (publicSubmissionAttempts.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  publicSubmissionAttempts.set(key, recent);
  return true;
};

const deleteStoredPublicImage = async (urlValue: unknown) => {
  const url = String(urlValue || '').trim();
  if (!url) return;
  if (url.startsWith('/uploads/')) {
    const file = path.basename(url);
    const full = path.join(uploadsDir, file);
    try { if (fs.existsSync(full)) fs.unlinkSync(full); } catch {}
    return;
  }
  const marker = '/storage/v1/object/public/ora-public-media/';
  const index = url.indexOf(marker);
  if (index >= 0) {
    const objectPath = decodeURIComponent(url.slice(index + marker.length).split('?')[0]);
    const sb = getSupabaseAdmin();
    if (sb && objectPath) { try { await sb.storage.from('ora-public-media').remove([objectPath]); } catch {} }
  }
};

app.post('/api/uploads/image', async (req, res) => {
  if (!allowPublicSubmission(req, 'media', 60, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many image uploads. Please try again later.' });
  try {
    const purpose = String(req.body?.purpose || 'public').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'public';
    const dataUrl = String(req.body?.dataUrl || '');
    const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return res.status(400).json({ error: 'Invalid image payload.' });
    const extRaw = match[1].toLowerCase();
    const ext = extRaw === 'jpg' ? 'jpeg' : extRaw;
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 750_000) return res.status(400).json({ error: 'Compressed image must be under 750 KB.' });
    const fileName = `${purpose}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const contentType = `image/${ext}`;

    const sb = getSupabaseAdmin();
    if (isLiveServerlessRuntime && !sb) {
      return res.status(503).json({ error: 'Live image storage requires Supabase service-role configuration.' });
    }
    if (sb) {
      const bucket = 'ora-public-media';
      try {
        const { error } = await sb.storage.from(bucket).upload(fileName, buffer, { contentType, cacheControl: '31536000', upsert: false });
        if (error && /bucket/i.test(error.message || '')) {
          await sb.storage.createBucket(bucket, { public: true, fileSizeLimit: 1_000_000, allowedMimeTypes: ['image/jpeg','image/png','image/webp'] });
          const retry = await sb.storage.from(bucket).upload(fileName, buffer, { contentType, cacheControl: '31536000', upsert: false });
          if (retry.error) throw retry.error;
        } else if (error) throw error;
        const { data } = sb.storage.from(bucket).getPublicUrl(fileName);
        if (data?.publicUrl) return res.json({ ok: true, url: data.publicUrl });
      } catch (e) {
        console.warn('Supabase public image upload failed:', (e as any)?.message || e);
        if (isLiveServerlessRuntime) return res.status(500).json({ error: 'Supabase image upload failed. Check the service-role key and Storage access.' });
      }
    }

    ensureOraDataDirs();
    fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
    return res.json({ ok: true, url: `/uploads/${fileName}` });
  } catch (e:any) {
    return res.status(500).json({ error: e?.message || 'Image upload failed.' });
  }
});

// -----------------------------------------------------------------------------
// Product reviews: public submit + approved read; staff/admin moderation.
// -----------------------------------------------------------------------------
const getAllReviewsServer = async (): Promise<any[]> => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('customer_reviews').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) { console.warn('Supabase reviews unavailable; using local fallback:', (e as any)?.message || e); }
  }
  return readJsonArray(reviewsFile).sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
};
const saveReviewServer = async (review:any) => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('customer_reviews').upsert(review, { onConflict: 'id' }).select().single();
      if (error) throw error;
      return data;
    } catch (e) { console.warn('Supabase review save failed; using local fallback:', (e as any)?.message || e); }
  }
  const rows = readJsonArray(reviewsFile);
  const idx = rows.findIndex((r:any)=>r.id===review.id);
  if (idx >= 0) rows[idx] = review; else rows.unshift(review);
  writeJsonArray(reviewsFile, rows);
  return review;
};
app.get('/api/reviews', async (req,res) => {
  const productId = String(req.query.productId || '').trim();
  const rows = (await getAllReviewsServer()).filter((r:any)=>r.status === 'Approved' && (!productId || String(r.product_id) === productId));
  return res.json({ reviews: rows.slice(0, 200) });
});
app.post('/api/reviews', async (req,res) => {
  if (!allowPublicSubmission(req, 'review', 12, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many review submissions. Please try again later.' });
  try {
    const rating = Math.max(1, Math.min(5, Number(req.body?.rating || 0)));
    const productId = String(req.body?.product_id || '').trim();
    const productName = String(req.body?.product_name || '').trim().slice(0, 255);
    const customerName = String(req.body?.customer_name || '').trim().slice(0, 120);
    const reviewText = String(req.body?.review_text || '').trim().slice(0, 1200);
    if (!productId || !productName || customerName.length < 2 || reviewText.length < 3) return res.status(400).json({ error: 'Product, name and review are required.' });
    const authUser = await getCustomerAuthUser(req);
    const review = {
      id: `rev-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      product_id: productId,
      product_name: productName,
      customer_name: customerName,
      rating,
      review_text: reviewText,
      image_url: String(req.body?.image_url || '').slice(0, 2000) || null,
      customer_auth_id: authUser?.id || null,
      status: 'Pending',
      created_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
    };
    await saveReviewServer(review);
    return res.json({ ok: true, review: { ...review, image_url: review.image_url || undefined } });
  } catch (e:any) { return res.status(500).json({ error: e?.message || 'Review could not be submitted.' }); }
});
app.get('/api/admin/reviews', requireAdminSession, async (_req,res) => res.json({ reviews: await getAllReviewsServer() }));
app.patch('/api/admin/reviews/:id', requireAdminSession, async (req,res) => {
  const rows = await getAllReviewsServer();
  const current = rows.find((r:any)=>r.id===req.params.id);
  if (!current) return res.status(404).json({ error: 'Review not found.' });
  const status = ['Pending','Approved','Rejected'].includes(String(req.body?.status)) ? String(req.body.status) : current.status;
  const actor = (req as any).staffSessionUser;
  const next = { ...current, status, reviewed_at: new Date().toISOString(), reviewed_by: actor?.display_name || actor?.username || 'Admin' };
  await saveReviewServer(next);
  return res.json({ ok: true, review: next });
});
app.delete('/api/admin/reviews/:id', requireAdminSession, async (req,res) => {
  const current = (await getAllReviewsServer()).find((r:any)=>r.id===req.params.id);
  const sb = getSupabaseAdmin();
  if (sb) {
    try { const { error } = await sb.from('customer_reviews').delete().eq('id', req.params.id); void error; } catch {}
  }
  writeJsonArray(reviewsFile, readJsonArray(reviewsFile).filter((r:any)=>r.id!==req.params.id));
  await deleteStoredPublicImage(current?.image_url);
  return res.json({ ok:true });
});

// -----------------------------------------------------------------------------
// New product demand requests (not orders).
// -----------------------------------------------------------------------------
const getAllProductRequestsServer = async (): Promise<any[]> => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('product_requests').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) { console.warn('Supabase product requests unavailable; using local fallback:', (e as any)?.message || e); }
  }
  return readJsonArray(productRequestsFile).sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
};
const saveProductRequestServer = async (request:any) => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('product_requests').upsert(request, { onConflict: 'id' }).select().single();
      if (error) throw error;
      return data;
    } catch (e) { console.warn('Supabase product request save failed; using local fallback:', (e as any)?.message || e); }
  }
  const rows = readJsonArray(productRequestsFile);
  const idx = rows.findIndex((r:any)=>r.id===request.id);
  if (idx >= 0) rows[idx] = request; else rows.unshift(request);
  writeJsonArray(productRequestsFile, rows);
  return request;
};
app.post('/api/product-requests', async (req,res) => {
  if (!allowPublicSubmission(req, 'product-request', 12, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many product suggestions. Please try again later.' });
  try {
    const productName = String(req.body?.product_name || '').trim().slice(0,255);
    if (productName.length < 2) return res.status(400).json({ error: 'Product name is required.' });
    const authUser = await getCustomerAuthUser(req);
    const request = {
      id: `preq-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      customer_auth_id: authUser?.id || null,
      customer_name: String(req.body?.customer_name || '').trim().slice(0,120) || null,
      contact: String(req.body?.contact || '').trim().slice(0,80) || null,
      product_name: productName,
      description: String(req.body?.description || '').trim().slice(0,1500) || null,
      product_link: String(req.body?.product_link || '').trim().slice(0,2000) || null,
      expected_price: Number(req.body?.expected_price || 0) > 0 ? Number(req.body.expected_price) : null,
      reference_image_url: String(req.body?.reference_image_url || '').slice(0,2000) || null,
      status: 'New',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await saveProductRequestServer(request);
    return res.json({ ok:true, request });
  } catch (e:any) { return res.status(500).json({ error: e?.message || 'Product request could not be submitted.' }); }
});
app.get('/api/admin/product-requests', requireAdminSession, async (_req,res) => res.json({ requests: await getAllProductRequestsServer() }));
app.patch('/api/admin/product-requests/:id', requireAdminSession, async (req,res) => {
  const rows = await getAllProductRequestsServer();
  const current = rows.find((r:any)=>r.id===req.params.id);
  if (!current) return res.status(404).json({ error: 'Product request not found.' });
  const status = ['New','Reviewed','Planned','Added','Rejected'].includes(String(req.body?.status)) ? String(req.body.status) : current.status;
  const next = { ...current, status, updated_at: new Date().toISOString() };
  await saveProductRequestServer(next);
  return res.json({ ok:true, request: next });
});
app.delete('/api/admin/product-requests/:id', requireAdminSession, async (req,res) => {
  const current = (await getAllProductRequestsServer()).find((r:any)=>r.id===req.params.id);
  const sb = getSupabaseAdmin();
  if (sb) {
    try { const { error } = await sb.from('product_requests').delete().eq('id', req.params.id); void error; } catch {}
  }
  writeJsonArray(productRequestsFile, readJsonArray(productRequestsFile).filter((r:any)=>r.id!==req.params.id));
  await deleteStoredPublicImage(current?.reference_image_url);
  return res.json({ ok:true });
});

// -----------------------------------------------------------------------------
// Small admin JSON data store. Used for normalized report imports only, never raw images.
// -----------------------------------------------------------------------------
const allowedAdminDataKeys = new Set(['ads-report-rows','assistant-chats','complaints','customer-notifications']);

const getSharedAdminPayload = async (key: string): Promise<any[]> => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('admin_data_store').select('payload').eq('key', key).maybeSingle();
      if (error) throw error;
      return Array.isArray(data?.payload) ? data.payload : [];
    } catch (e) { console.warn(`Supabase ${key} read failed; using local fallback:`, (e as any)?.message || e); }
  }
  const local = readAdminDataLocal()[key];
  return Array.isArray(local) ? local : [];
};

const saveSharedAdminPayload = async (key: string, payload: any[]) => {
  const trimmed = Array.isArray(payload) ? payload.slice(0, 600) : [];
  const encoded = JSON.stringify(trimmed);
  if (encoded.length > 2_000_000) throw new Error(`${key} data is too large.`);
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { error } = await sb.from('admin_data_store').upsert({ key, payload: trimmed, updated_at: new Date().toISOString() }, { onConflict:'key' });
      if (error) throw error;
      return;
    } catch (e) { console.warn(`Supabase ${key} save failed; using local fallback:`, (e as any)?.message || e); }
  }
  const store = readAdminDataLocal(); store[key] = trimmed; writeAdminDataLocal(store);
};


// -----------------------------------------------------------------------------
// Shared storefront state (catalog + categories + storefront settings).
// This is the authoritative source for every browser/device so customers never
// see stale demo/localStorage products, prices, offers or delivery settings.
// Local development uses .ora-data/admin-data-store.json; live uses the existing
// Supabase public.admin_data_store table when the service-role connection exists.
// -----------------------------------------------------------------------------
const storefrontStateKey = 'storefront-state-v1';
type SharedStorefrontState = {
  version: number;
  updated_at: string;
  products: any[];
  categories: any[];
  settings: Record<string, any>;
};

const readSharedStorefrontState = async (): Promise<SharedStorefrontState | null> => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('admin_data_store').select('payload').eq('key', storefrontStateKey).maybeSingle();
      if (error) throw error;
      const payload = data?.payload;
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.products) && Array.isArray(payload.categories)) {
        return {
          version: Math.max(1, Number(payload.version || 1)),
          updated_at: String(payload.updated_at || new Date(0).toISOString()),
          products: payload.products,
          categories: payload.categories,
          settings: payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings) ? payload.settings : {},
        };
      }
    } catch (e) { console.warn('Supabase storefront-state read failed; using local fallback:', (e as any)?.message || e); }
  }
  const payload = readAdminDataLocal()[storefrontStateKey];
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.products) && Array.isArray(payload.categories)) {
    return {
      version: Math.max(1, Number(payload.version || 1)),
      updated_at: String(payload.updated_at || new Date(0).toISOString()),
      products: payload.products,
      categories: payload.categories,
      settings: payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings) ? payload.settings : {},
    };
  }
  return null;
};

const writeSharedStorefrontState = async (input: {products:any[];categories:any[];settings:Record<string,any>}): Promise<SharedStorefrontState> => {
  const current = await readSharedStorefrontState();
  const next: SharedStorefrontState = {
    version: Math.max(1, Number(current?.version || 0) + 1),
    updated_at: new Date().toISOString(),
    products: Array.isArray(input.products) ? input.products.slice(0, 5000) : [],
    categories: Array.isArray(input.categories) ? input.categories.slice(0, 1000) : [],
    settings: input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings) ? input.settings : {},
  };
  const encoded = JSON.stringify(next);
  if (encoded.length > 15_000_000) throw new Error('Storefront catalog is too large. Use public image URLs instead of embedded image data.');
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { error } = await sb.from('admin_data_store').upsert({ key: storefrontStateKey, payload: next, updated_at: next.updated_at }, { onConflict:'key' });
      if (error) throw error;
      return next;
    } catch (e) { console.warn('Supabase storefront-state save failed; using local fallback:', (e as any)?.message || e); }
  }
  const store = readAdminDataLocal();
  store[storefrontStateKey] = next;
  writeAdminDataLocal(store);
  return next;
};

const publicStorefrontSettings = (raw: Record<string, any>) => {
  const out = { ...(raw || {}) };
  // Internal integration/admin fields must never be exposed through the public catalog endpoint.
  [
    'google_sheet_webhook_url', 'fardar_api_url', 'fardar_account_id', 'courier_api_enabled',
    'admin_secret_path',
  ].forEach((key) => delete out[key]);
  if (out.bank_details_saved !== true) {
    out.bank_name = '';
    out.bank_account_holder = '';
    out.bank_account_number = '';
    out.bank_branch = '';
  }
  return out;
};

app.get('/api/storefront/state', async (_req,res) => {
  try {
    const state = await readSharedStorefrontState();
    if (!state) return res.json({ initialized:false, state:null });
    return res.json({ initialized:true, state:{ ...state, settings: publicStorefrontSettings(state.settings) } });
  } catch (e:any) {
    return res.status(500).json({ error:e?.message || 'Storefront catalog could not be loaded.' });
  }
});

// Local-development bridge for older O-RA installs that already have the real
// catalog/settings in the Admin browser localStorage but do not yet have a
// server-side storefront snapshot. This endpoint is intentionally loopback-only
// and never works on the public/live domain. Once the snapshot exists, every
// Chrome profile reads the same server copy.
const isLoopbackRequest = (req: express.Request) => {
  const host = String(req.hostname || '').toLowerCase();
  const remote = String(req.socket?.remoteAddress || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || remote === '127.0.0.1' || remote === '::1' || remote.endsWith(':127.0.0.1');
};

app.put('/api/storefront/local-state', async (req,res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error:'Local storefront bridge is available only on localhost.' });
  try {
    const products = Array.isArray(req.body?.products) ? req.body.products : null;
    const categories = Array.isArray(req.body?.categories) ? req.body.categories : null;
    const settings = req.body?.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings) ? req.body.settings : null;
    if (!products || !categories || !settings) return res.status(400).json({ error:'Products, categories and settings are required.' });
    const state = await writeSharedStorefrontState({ products, categories, settings });
    return res.json({ ok:true, local_bridge:true, version:state.version, updated_at:state.updated_at });
  } catch (e:any) {
    return res.status(500).json({ error:e?.message || 'Local shared storefront state could not be saved.' });
  }
});

app.get('/api/admin/storefront/state', requireAdminSession, async (_req,res) => {
  try {
    const state = await readSharedStorefrontState();
    return res.json({ initialized:Boolean(state), state:state || null });
  } catch (e:any) {
    return res.status(500).json({ error:e?.message || 'Shared storefront state could not be loaded.' });
  }
});

app.put('/api/admin/storefront/state', requireAdminSession, async (req,res) => {
  try {
    const products = Array.isArray(req.body?.products) ? req.body.products : null;
    const categories = Array.isArray(req.body?.categories) ? req.body.categories : null;
    const settings = req.body?.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings) ? req.body.settings : null;
    if (!products || !categories || !settings) return res.status(400).json({ error:'Products, categories and settings are required.' });
    const state = await writeSharedStorefrontState({ products, categories, settings });
    return res.json({ ok:true, version:state.version, updated_at:state.updated_at });
  } catch (e:any) {
    return res.status(500).json({ error:e?.message || 'Shared storefront state could not be saved.' });
  }
});


// -----------------------------------------------------------------------------
// Server-side Google Sheet mirror
// -----------------------------------------------------------------------------
// IMPORTANT: the Google Apps Script URL is private storefront/admin configuration.
// Customer browsers never need it. Website orders are mirrored from the server so
// a fresh Chrome/device/network works exactly the same and the Admin PC does not
// need to be open after the site is deployed.
type OraSheetSyncResult = {
  ok: boolean;
  skipped?: boolean;
  synced?: number;
  existing?: number;
  rows?: number;
  error?: string;
};

const orderQtyOfferLabelServer = (order:any, settings:Record<string,any>) => {
  const qty=(Array.isArray(order?.items)?order.items:[]).reduce((sum:number,it:any)=>sum+Math.max(1,Number(it?.quantity||1)),0);
  const discount=Math.max(0,Number(order?.special_offer_discount||0));
  if(discount<=0) return 'No Qty Offer';
  if(settings?.multi_buy_discount_enabled){
    const tiers=[
      {min:Number(settings.multi_buy_tier1_min??2),max:Number(settings.multi_buy_tier1_max??3),rate:Number(settings.multi_buy_tier1_rate??5)},
      {min:Number(settings.multi_buy_tier2_min??4),max:Number(settings.multi_buy_tier2_max??5),rate:Number(settings.multi_buy_tier2_rate??7.5)},
      {min:Number(settings.multi_buy_tier3_min??6),max:Number(settings.multi_buy_tier3_max??10),rate:Number(settings.multi_buy_tier3_rate??10)},
    ];
    const tier=tiers.find(t=>qty>=t.min&&qty<=t.max&&t.rate>0);
    if(tier) return `Qty Offer ${tier.rate}% (${qty} items)`;
  }
  return `Order Offer Rs. ${Math.round(discount*100)/100}`;
};

const buildOrderSheetPayloadServer = (order:any, settings:Record<string,any>) => ({
  order_id:String(order?.order_number||''),
  order_number:String(order?.order_number||''),
  order_source:String(order?.order_source||'Website'),
  customer_name:String(order?.customer_name||''),
  phone:String(order?.phone||''),
  whatsapp:String(order?.whatsapp||order?.phone||''),
  address:String(order?.address||''),
  city:String(order?.city||''),
  created_at:String(order?.created_at||new Date().toISOString()),
  subtotal:Number(order?.subtotal||0),
  total_amount:Number(order?.total_amount||0),
  delivery_fee:Number(order?.delivery_fee||0),
  special_offer_discount:Number(order?.special_offer_discount||0),
  offer_label:orderQtyOfferLabelServer(order,settings),
  platform_lead_id:String(order?.platform_lead_id||''),
  call_center_status:String(order?.call_center_status||'Pending'),
  items:(Array.isArray(order?.items)?order.items:[]).map((it:any)=>({
    main_sku:String(it?.main_sku||it?.sku||''),
    variant_name:String(it?.variant_name||''),
    sku:String(it?.sku||''),
    product_name:String(it?.product_name||''),
    quantity:Math.max(1,Number(it?.quantity||1)),
    unit_price:Number(it?.unit_price||0),
  })),
});

const isOrderEligibleForSheetServer = (order:any) => {
  if(!order || order.order_source==='Manual Admin') return false;
  if(order.order_source==='Website' && order.payment_method==='Bank Payment' && order.payment_verification_status!=='Approved') return false;
  return true;
};

const postAppsScriptFastServer = async (webhookUrl:string, payload:any, timeoutMs=8000) => {
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(String(webhookUrl||'').trim())) {
    throw new Error('Google Sheet Web App URL is not configured on the shared server settings.');
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(webhookUrl,{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8','Accept':'application/json,text/plain,*/*'},
      body:JSON.stringify(payload),
      redirect:'follow',
      signal:controller.signal,
    });
    const text=await response.text();
    let parsed:any={};
    try{parsed=JSON.parse(text);}catch{}
    if(!response.ok) throw new Error(`Apps Script HTTP ${response.status}`);
    if(parsed?.status==='error') throw new Error(parsed?.message||'Apps Script returned an error.');
    return parsed;
  } finally { clearTimeout(timeout); }
};

const syncOrdersToGoogleSheetsServer = async (orders:any[]):Promise<OraSheetSyncResult> => {
  try{
    const state=await readSharedStorefrontState();
    const settings=(state?.settings&&typeof state.settings==='object')?state.settings:{};
    const webhook=String(settings?.google_sheet_webhook_url||'').trim();
    if(!webhook) return {ok:false,skipped:true,error:'Google Sheet Web App URL is not saved in shared Store Settings.'};
    const eligible=(Array.isArray(orders)?orders:[]).filter(isOrderEligibleForSheetServer);
    if(!eligible.length) return {ok:true,skipped:true,synced:0,existing:0,rows:0};
    const result=await postAppsScriptFastServer(webhook,{payload_type:'order_batch_sync',orders:eligible.map(o=>buildOrderSheetPayloadServer(o,settings))});
    if(String(result?.status||'')!=='orders_batch_synced') throw new Error(`Unexpected Apps Script status: ${String(result?.status||'empty')}`);
    return {ok:true,synced:Number(result?.synced||0),existing:Number(result?.existing||0),rows:Number(result?.rows||0)};
  }catch(e:any){
    return {ok:false,error:e?.name==='AbortError'?'Google Sheet sync timed out. Order is safely saved and can be re-synced.':(e?.message||'Google Sheet sync failed.')};
  }
};


// -----------------------------------------------------------------------------
// Privacy-friendly first-party storefront analytics.
// Stores only a salted browser-ID hash, daily unique counts and page-view totals.
// Staff/Admin previews are skipped by the storefront before this endpoint is called.
// -----------------------------------------------------------------------------
const visitorAnalyticsKey = 'visitor-analytics-v1';
type VisitorAnalyticsStore = {
  total_page_views: number;
  all_visitors: string[];
  days: Record<string, { page_views: number; visitors: string[] }>;
};

const emptyVisitorAnalytics = (): VisitorAnalyticsStore => ({ total_page_views: 0, all_visitors: [], days: {} });

const readVisitorAnalytics = async (): Promise<VisitorAnalyticsStore> => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('admin_data_store').select('payload').eq('key', visitorAnalyticsKey).maybeSingle();
      if (error) throw error;
      const payload = data?.payload;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return {
          total_page_views: Math.max(0, Number(payload.total_page_views || 0)),
          all_visitors: Array.isArray(payload.all_visitors) ? payload.all_visitors.map(String).slice(0, 50000) : [],
          days: payload.days && typeof payload.days === 'object' ? payload.days : {},
        };
      }
    } catch (e) { console.warn('Supabase visitor analytics read failed; using local fallback:', (e as any)?.message || e); }
  }
  const payload = readAdminDataLocal()[visitorAnalyticsKey];
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      total_page_views: Math.max(0, Number(payload.total_page_views || 0)),
      all_visitors: Array.isArray(payload.all_visitors) ? payload.all_visitors.map(String).slice(0, 50000) : [],
      days: payload.days && typeof payload.days === 'object' ? payload.days : {},
    };
  }
  return emptyVisitorAnalytics();
};

const writeVisitorAnalytics = async (payload: VisitorAnalyticsStore) => {
  const encoded = JSON.stringify(payload);
  if (encoded.length > 2_000_000) {
    // Keep long-term totals while pruning old daily detail first.
    const keys = Object.keys(payload.days || {}).sort();
    while (keys.length > 60 && JSON.stringify(payload).length > 1_700_000) {
      const key = keys.shift();
      if (key) delete payload.days[key];
    }
  }
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { error } = await sb.from('admin_data_store').upsert({ key: visitorAnalyticsKey, payload, updated_at: new Date().toISOString() }, { onConflict:'key' });
      if (error) throw error;
      return;
    } catch (e) { console.warn('Supabase visitor analytics save failed; using local fallback:', (e as any)?.message || e); }
  }
  const store = readAdminDataLocal();
  store[visitorAnalyticsKey] = payload;
  writeAdminDataLocal(store);
};

const colomboDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type:string) => parts.find((p)=>p.type===type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const analyticsDateKeys = (days: number) => {
  const out:string[] = [];
  const now = new Date();
  for (let i=0;i<days;i++) out.push(colomboDateKey(new Date(now.getTime() - i * 86400000)));
  return out;
};

app.post('/api/analytics/view', async (req,res) => {
  if (!allowPublicSubmission(req, 'storefront-analytics', 1200, 60 * 60 * 1000)) return res.status(429).json({ ok:false });
  try {
    const visitorId = String(req.body?.visitorId || '').trim().slice(0,160);
    const pagePath = String(req.body?.path || '/').trim().slice(0,300) || '/';
    if (visitorId.length < 8) return res.status(400).json({ error:'Visitor ID missing.' });
    if (pagePath === '/system' || pagePath === '/ora-manager' || pagePath.startsWith('/system/')) return res.json({ ok:true, ignored:true });

    const hash = crypto.createHash('sha256').update(`${staffSessionSecret}|visitor|${visitorId}`).digest('hex').slice(0,24);
    const data = await readVisitorAnalytics();
    const dayKey = colomboDateKey();
    const day = data.days[dayKey] && typeof data.days[dayKey] === 'object'
      ? data.days[dayKey]
      : { page_views:0, visitors:[] as string[] };

    data.total_page_views = Math.max(0, Number(data.total_page_views || 0)) + 1;
    day.page_views = Math.max(0, Number(day.page_views || 0)) + 1;
    if (!Array.isArray(day.visitors)) day.visitors = [];
    if (!day.visitors.includes(hash)) day.visitors.push(hash);
    if (!Array.isArray(data.all_visitors)) data.all_visitors = [];
    if (!data.all_visitors.includes(hash) && data.all_visitors.length < 50000) data.all_visitors.push(hash);
    data.days[dayKey] = day;

    // Keep detailed daily sets for 120 days; all-time unique count stays separate.
    const keep = new Set(analyticsDateKeys(120));
    Object.keys(data.days).forEach((key)=>{ if (!keep.has(key)) delete data.days[key]; });
    await writeVisitorAnalytics(data);
    return res.json({ ok:true });
  } catch (e:any) {
    return res.status(500).json({ error:e?.message || 'Analytics could not be saved.' });
  }
});

app.get('/api/admin/analytics', requireStaffPermission('overview'), async (_req,res) => {
  try {
    const data = await readVisitorAnalytics();
    const union = (keys:string[]) => {
      const set = new Set<string>();
      keys.forEach((key)=> (Array.isArray(data.days?.[key]?.visitors) ? data.days[key].visitors : []).forEach((id:string)=>set.add(String(id))));
      return set.size;
    };
    const today = colomboDateKey();
    return res.json({
      todayVisitors: union([today]),
      last7Visitors: union(analyticsDateKeys(7)),
      last30Visitors: union(analyticsDateKeys(30)),
      totalVisitors: Array.isArray(data.all_visitors) ? data.all_visitors.length : 0,
      totalPageViews: Math.max(0, Number(data.total_page_views || 0)),
      todayPageViews: Math.max(0, Number(data.days?.[today]?.page_views || 0)),
    });
  } catch (e:any) {
    return res.status(500).json({ error:e?.message || 'Analytics could not be loaded.' });
  }
});


// -----------------------------------------------------------------------------
// Customer notification feed. Free/no third-party push service required.
// Customers can opt into browser notifications; the storefront polls this small
// shared feed while the website/PWA is active and mirrors new rows as browser
// notifications. Notification history is also visible inside the storefront.
// -----------------------------------------------------------------------------
const compactCustomerNotifications = (rows: any[]) => (Array.isArray(rows) ? rows : [])
  .map((row:any)=>({
    id:String(row?.id||''),
    title:String(row?.title||'').slice(0,90),
    body:String(row?.body||'').slice(0,240),
    url:String(row?.url||'/').slice(0,500) || '/',
    created_at:String(row?.created_at||new Date().toISOString()),
    created_by:String(row?.created_by||''),
  }))
  .filter((row:any)=>row.id && row.title && row.body)
  .sort((a:any,b:any)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())
  .slice(0,200);

app.get('/api/customer-notifications', async (_req,res) => {
  const rows = compactCustomerNotifications(await getSharedAdminPayload('customer-notifications'));
  return res.json({ notifications: rows.slice(0,50) });
});

app.get('/api/admin/customer-notifications', requireStaffPermission('notifications'), async (_req,res) => {
  return res.json({ notifications: compactCustomerNotifications(await getSharedAdminPayload('customer-notifications')) });
});

app.post('/api/admin/customer-notifications', requireStaffPermission('notifications'), async (req,res) => {
  try {
    const title=String(req.body?.title||'').trim().slice(0,90);
    const body=String(req.body?.body||'').trim().slice(0,240);
    let url=String(req.body?.url||'/').trim().slice(0,500) || '/';
    if (!title || !body) return res.status(400).json({error:'Notification title and message are required.'});
    if (!/^\//.test(url) && !/^https:\/\//i.test(url)) url='/';
    const rows=compactCustomerNotifications(await getSharedAdminPayload('customer-notifications'));
    const user=(req as any).staffSessionUser as ServerStaffAccount | undefined;
    const notification={ id:`ntf-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, title, body, url, created_at:new Date().toISOString(), created_by:user?.username||'admin' };
    await saveSharedAdminPayload('customer-notifications',[notification,...rows].slice(0,200));
    return res.json({ok:true,notification});
  } catch(e:any){ return res.status(500).json({error:e?.message||'Notification could not be published.'}); }
});

app.delete('/api/admin/customer-notifications/:id', requireStaffPermission('notifications'), async (req,res) => {
  const rows=compactCustomerNotifications(await getSharedAdminPayload('customer-notifications'));
  await saveSharedAdminPayload('customer-notifications',rows.filter((row:any)=>row.id!==req.params.id));
  return res.json({ok:true});
});

const nextPublicRecordId = (prefix: string, rows: any[], width = 6) => {
  const max = (rows || []).reduce((m:number, row:any) => {
    const match = String(row?.id || '').match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
    return match ? Math.max(m, Number(match[1]) || 0) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
};

app.get('/api/admin-data/:key', requireAdminSession, async (req,res) => {
  const key = String(req.params.key || '');
  if (!allowedAdminDataKeys.has(key)) return res.status(404).json({ error: 'Unknown data key.' });
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('admin_data_store').select('payload').eq('key', key).maybeSingle();
      if (error) throw error;
      return res.json({ payload: data?.payload ?? [] });
    } catch (e) { console.warn('Supabase admin data read failed; using local fallback:', (e as any)?.message || e); }
  }
  return res.json({ payload: readAdminDataLocal()[key] ?? [] });
});
app.put('/api/admin-data/:key', requireAdminSession, async (req,res) => {
  const key = String(req.params.key || '');
  if (!allowedAdminDataKeys.has(key)) return res.status(404).json({ error: 'Unknown data key.' });
  const payload = req.body?.payload ?? [];
  const encoded = JSON.stringify(payload);
  if (encoded.length > 2_000_000) return res.status(413).json({ error: 'Report data is too large. Keep only normalized summary rows.' });
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { error } = await sb.from('admin_data_store').upsert({ key, payload, updated_at: new Date().toISOString() }, { onConflict:'key' });
      if (error) throw error;
      return res.json({ ok:true });
    } catch (e) { console.warn('Supabase admin data save failed; using local fallback:', (e as any)?.message || e); }
  }
  const store = readAdminDataLocal(); store[key] = payload; writeAdminDataLocal(store);
  return res.json({ ok:true });
});

// -----------------------------------------------------------------------------
// Google/Supabase customer profile + authenticated customer order history.
// Google display name is intentionally NOT copied to real_name.
// -----------------------------------------------------------------------------
app.get('/api/customer/profile', async (req,res) => {
  const user = await getCustomerAuthUser(req);
  const sb = getSupabaseAdmin();
  if (!user || !sb) return res.status(401).json({ error: 'Customer login required.' });
  const { data, error } = await sb.from('customer_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ profile: data || null, email: user.email || '' });
});
app.put('/api/customer/profile', async (req,res) => {
  const user = await getCustomerAuthUser(req);
  const sb = getSupabaseAdmin();
  if (!user || !sb) return res.status(401).json({ error: 'Customer login required.' });
  const realName = String(req.body?.real_name || '').trim().slice(0,150);
  const phone = String(req.body?.phone || '').replace(/\D/g,'').slice(0,20);
  if (realName.length < 2 || phone.length < 9) return res.status(400).json({ error: 'Real name and a valid phone number are required.' });
  const row = {
    user_id: user.id,
    email: String(user.email || ''),
    real_name: realName,
    phone,
    whatsapp: String(req.body?.whatsapp || '').replace(/\D/g,'').slice(0,20) || null,
    address: String(req.body?.address || '').trim().slice(0,500) || null,
    city: String(req.body?.city || '').trim().slice(0,120) || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from('customer_profiles').upsert(row, { onConflict:'user_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok:true, profile:data });
});
app.get('/api/customer/orders', async (req,res) => {
  const user = await getCustomerAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Customer login required.' });
  const all = await getOrderSnapshots();
  const rows = all
    .filter((o:any)=>String(o.customer_auth_id || '') === user.id)
    .sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
  const completedCount = rows.filter((o:any)=>o.order_status !== 'Cancelled' && (o.payment_status === 'Paid' || o.order_status === 'Delivered' || o.cod_payment_received)).length;
  return res.json({ orders: rows.slice(0,100), membership: { level: membershipForCount(completedCount), successful_orders: completedCount }, completed_orders: completedCount });
});

// -----------------------------------------------------------------------------
// Reliable Google Apps Script proxy
// -----------------------------------------------------------------------------
// Browser no-cors requests cannot confirm whether Apps Script actually received
// the order. Route Sheet writes through the local/server backend instead.
app.post('/api/google-sheets/proxy', async (req,res)=>{
  const webhookUrl=String(req.body?.webhookUrl || '').trim();
  const payload=req.body?.payload;
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhookUrl)){
    return res.status(400).json({ok:false,error:'Invalid Apps Script Web App URL.'});
  }
  if(!payload || typeof payload!=='object'){
    return res.status(400).json({ok:false,error:'Missing Sheet payload.'});
  }

  // Apps Script can occasionally finish the write but respond slowly. All O-RA
  // Sheet actions are idempotent/upsert-safe, so one retry avoids false 502s
  // without creating duplicate orders.
  const postOnce=async()=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(webhookUrl,{
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8','Accept':'application/json,text/plain,*/*'},
        body:JSON.stringify(payload),
        redirect:'follow',
        signal:controller.signal,
      });
      const text=await response.text();
      let parsed:any={};
      try{parsed=JSON.parse(text);}catch{}
      if(!response.ok) throw new Error(`Apps Script HTTP ${response.status}${text ? `: ${text.slice(0,220)}` : ''}`);
      if(parsed?.status==='error') throw new Error(parsed?.message || 'Apps Script returned an error.');
      return {parsed,text};
    } finally { clearTimeout(timeout); }
  };

  let lastError:any=null;
  for(let attempt=1;attempt<=1;attempt++){
    try{
      const result=await postOnce();
      return res.json({ok:true,result:result.parsed,raw:result.text.slice(0,500),attempt});
    }catch(e:any){
      lastError=e;
      if(attempt<1) await new Promise(resolve=>setTimeout(resolve,250));
    }
  }

  const message=lastError?.name==='AbortError'?'Apps Script request timed out.':(lastError?.message||'Google Sheet proxy failed.');
  // Return a normal JSON response so Chrome does not show a misleading red 502
  // when Apps Script is temporarily slow. Frontend still receives ok:false and
  // keeps the order marked unsynced for a later retry.
  return res.json({ok:false,error:message,retryable:true});
});

// -----------------------------------------------------------------------------
// Durable order snapshots
// -----------------------------------------------------------------------------
// Local development stores a full order snapshot in .ora-data/order-snapshots.json.
// When Supabase service-role access is configured, the same endpoint first tries
// public.order_snapshots (schema included in this update), then falls back locally.
const readOrderSnapshotsLocal = (): any[] => {
  try {
    if (!fs.existsSync(staffDataDir)) fs.mkdirSync(staffDataDir, { recursive: true });
    if (!fs.existsSync(orderSnapshotsFile)) fs.writeFileSync(orderSnapshotsFile, '[]', 'utf8');
    const rows = JSON.parse(fs.readFileSync(orderSnapshotsFile, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
};
const writeOrderSnapshotsLocal = (rows:any[]) => {
  if (!fs.existsSync(staffDataDir)) fs.mkdirSync(staffDataDir, { recursive: true });
  fs.writeFileSync(orderSnapshotsFile, JSON.stringify(rows, null, 2), 'utf8');
};
const getOrderSnapshots = async (): Promise<any[]> => {
  const sb=getSupabaseAdmin();
  if(sb){
    try{
      const {data,error}=await sb.from('order_snapshots').select('order_id,order_number,payload,created_at,updated_at').order('created_at',{ascending:false});
      if(error) throw error;
      return (data||[]).map((r:any)=>r.payload).filter(Boolean);
    }catch(e){ console.warn('order_snapshots Supabase unavailable; using local store:',(e as any)?.message||e); }
  }
  return readOrderSnapshotsLocal().sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
};
const saveOrderSnapshot = async (order:any) => {
  if(!order?.id || !order?.order_number) throw new Error('Invalid order snapshot');
  const now=new Date().toISOString();
  const sb=getSupabaseAdmin();
  if(sb){
    try{
      const row={order_id:String(order.id),order_number:String(order.order_number),payload:order,created_at:order.created_at||now,updated_at:now};
      const {error}=await sb.from('order_snapshots').upsert(row,{onConflict:'order_id'});
      if(error) throw error;
      return order;
    }catch(e){ console.warn('order_snapshots Supabase save failed; using local store:',(e as any)?.message||e); }
  }
  const rows=readOrderSnapshotsLocal();
  const idx=rows.findIndex((o:any)=>o.id===order.id || o.order_number===order.order_number);
  if(idx>=0) rows[idx]={...rows[idx],...order}; else rows.push(order);
  writeOrderSnapshotsLocal(rows);
  return order;
};

const saveOrderSnapshotsBatch = async (orders:any[]) => {
  const incoming=(Array.isArray(orders)?orders:[]).filter(o=>o?.id&&o?.order_number);
  if(!incoming.length) return [];
  const now=new Date().toISOString();
  const sb=getSupabaseAdmin();
  if(sb){
    try{
      const payload=incoming.map(order=>({
        order_id:String(order.id),order_number:String(order.order_number),payload:order,
        created_at:order.created_at||now,updated_at:now,
      }));
      const {error}=await sb.from('order_snapshots').upsert(payload,{onConflict:'order_id'});
      if(error) throw error;
      return incoming;
    }catch(e){ console.warn('order_snapshots batch Supabase save failed; using local store:',(e as any)?.message||e); }
  }
  const rows=readOrderSnapshotsLocal();
  const byId=new Map(rows.map((o:any)=>[String(o.id),o] as const));
  const byNo=new Map(rows.map((o:any)=>[String(o.order_number).toUpperCase(),o] as const));
  for(const order of incoming){
    const existing=byId.get(String(order.id))||byNo.get(String(order.order_number).toUpperCase());
    if(existing){
      const idx=rows.indexOf(existing);
      rows[idx]={...existing,...order};
      byId.set(String(order.id),rows[idx]);byNo.set(String(order.order_number).toUpperCase(),rows[idx]);
    }else{
      rows.push(order);byId.set(String(order.id),order);byNo.set(String(order.order_number).toUpperCase(),order);
    }
  }
  writeOrderSnapshotsLocal(rows);
  return incoming;
};

app.post('/api/orders', async (req,res)=>{
  try{
    const order=req.body?.order;
    const deferSheetSync=Boolean(req.body?.defer_sheet_sync);
    const waitSheetSync=Boolean(req.body?.wait_sheet_sync);
    if(!order?.id || !order?.order_number || !order?.customer_name || !Array.isArray(order?.items)) {
      return res.status(400).json({error:'Invalid order payload.'});
    }
    const customerAuthUser = await getCustomerAuthUser(req);
    if (customerAuthUser) {
      order.customer_auth_id = customerAuthUser.id;
      order.customer_email = String(customerAuthUser.email || '');
    } else {
      delete order.customer_auth_id;
      delete order.customer_email;
    }
    const existing=await getOrderSnapshots();
    const collision=existing.find((o:any)=>o.order_number===order.order_number && o.id!==order.id);
    if(collision){
      const prefix=String(order.order_number||'WEB-000000').split('-')[0] || 'WEB';
      const max=existing
        .filter((o:any)=>String(o.order_number||'').startsWith(prefix+'-'))
        .reduce((m:number,o:any)=>Math.max(m,Number(String(o.order_number).replace(/^.*-/,'').replace(/\D/g,''))||0),0);
      order.order_number=`${prefix}-${String(max+1).padStart(6,'0')}`;
    }

    // Durable order FIRST. Customer success is never shown before this checkpoint.
    await saveOrderSnapshot(order);

    const shouldSync=!deferSheetSync && isOrderEligibleForSheetServer(order);

    // Test-order buttons intentionally wait for Sheet confirmation so their success
    // message and the visible Sheet row stay in sync. Real customer orders do NOT
    // wait for Apps Script; they get the Order ID immediately after durable save.
    if(waitSheetSync && shouldSync){
      const sheetSync=await syncOrdersToGoogleSheetsServer([order]);
      if(sheetSync.ok){
        order.is_synced_google_sheets=true;
        order.synced_at=new Date().toISOString();
        await saveOrderSnapshot(order);
      }
      return res.json({ok:true,order,sheet_sync:sheetSync});
    }

    // Flush the HTTP response now. Continue the private Sheet mirror after the
    // customer has already received the Order ID. This removes the old 8-15 sec
    // "Processing Order..." wait while keeping the server (not the browser) in
    // charge of the private webhook.
    res.json({ok:true,order,sheet_sync:shouldSync?{ok:true,queued:true}:{ok:true,skipped:true}});

    if(shouldSync){
      const backgroundSheetSync=(async()=>{
        try{
          const sheetSync=await syncOrdersToGoogleSheetsServer([order]);
          if(sheetSync.ok){
            order.is_synced_google_sheets=true;
            order.synced_at=new Date().toISOString();
            await saveOrderSnapshot(order);
          }else{
            console.warn(`Google Sheet background sync did not confirm ${order.order_number}:`,sheetSync);
          }
        }catch(e:any){
          console.warn(`Google Sheet background sync failed for ${order.order_number}:`,e?.message||e);
        }
      })();

      const waitUntil=(globalThis as any).__ORA_WAIT_UNTIL__;
      if(typeof waitUntil==='function') waitUntil(backgroundSheetSync);
      else void backgroundSheetSync;
    }
    return;
  }catch(e:any){
    if(res.headersSent){
      console.error('Post-response order processing failed:',e?.message||e);
      return;
    }
    return res.status(500).json({error:e?.message||'Order save failed.'});
  }
});

// One request for large FB/TikTok imports. This avoids hundreds of browser ->
// server saves and hundreds of Apps Script calls. The server stores all orders,
// then mirrors the whole batch to Google Sheets in one request.
app.post('/api/admin/orders/bulk-import', requireStaffAnyPermission(['lead_import','orders']), async (req,res)=>{
  try{
    const incoming=Array.isArray(req.body?.orders)?req.body.orders.slice(0,1000):[];
    if(!incoming.length) return res.status(400).json({error:'No orders were supplied.'});
    const invalid=incoming.find((o:any)=>!o?.id||!o?.order_number||!o?.customer_name||!Array.isArray(o?.items)||!o.items.length);
    if(invalid) return res.status(400).json({error:`Invalid order payload: ${String(invalid?.order_number||invalid?.id||'unknown')}`});

    const existing=await getOrderSnapshots();
    const used=new Set(existing.map((o:any)=>String(o.order_number||'').toUpperCase()).filter(Boolean));
    const maxByPrefix:Record<string,number>={};
    for(const o of existing){
      const m=String(o.order_number||'').toUpperCase().match(/^([A-Z]+)-(\d+)$/);
      if(m) maxByPrefix[m[1]]=Math.max(maxByPrefix[m[1]]||0,Number(m[2]||0));
    }
    for(const order of incoming){
      let no=String(order.order_number||'').toUpperCase();
      const prefix=(no.split('-')[0]||'FB').toUpperCase();
      if(used.has(no)){
        maxByPrefix[prefix]=Math.max(maxByPrefix[prefix]||0,...Array.from(used).filter(v=>v.startsWith(prefix+'-')).map(v=>Number(v.replace(/^.*-/,'').replace(/\D/g,''))||0));
        no=`${prefix}-${String(++maxByPrefix[prefix]).padStart(6,'0')}`;
        order.order_number=no;
      }else{
        const n=Number(no.replace(/^.*-/,'').replace(/\D/g,''))||0;
        maxByPrefix[prefix]=Math.max(maxByPrefix[prefix]||0,n);
      }
      used.add(no);
    }

    await saveOrderSnapshotsBatch(incoming);
    const sheetSync=await syncOrdersToGoogleSheetsServer(incoming);
    if(sheetSync.ok){
      const syncedAt=new Date().toISOString();
      for(const order of incoming){
        if(isOrderEligibleForSheetServer(order)){
          order.is_synced_google_sheets=true;
          order.synced_at=syncedAt;
        }
      }
      await saveOrderSnapshotsBatch(incoming);
    }
    return res.json({ok:true,orders:incoming,sheet_sync:sheetSync});
  }catch(e:any){ return res.status(500).json({error:e?.message||'Bulk order import failed.'}); }
});

app.get('/api/orders', requireAdminSession, async (_req,res)=>{
  return res.json({orders:await getOrderSnapshots()});
});

app.post('/api/orders/invoice-download-status', requireAdminSession, async (req,res)=>{
  try{
    const orderIds=Array.from(new Set(
      (Array.isArray(req.body?.orderIds) ? req.body.orderIds : [])
        .map((v:any)=>String(v||'').trim())
        .filter(Boolean)
    )).slice(0,50) as string[];

    if(!orderIds.length){
      return res.status(400).json({error:'No invoice order IDs were provided.'});
    }

    const downloadedBy=String(req.body?.downloadedBy || 'Packing Staff').trim() || 'Packing Staff';
    const downloadedAt=new Date().toISOString();
    const idSet=new Set(orderIds);

    const current=await getOrderSnapshots();
    const matched=current.filter((o:any)=>idSet.has(String(o.id)));
    if(!matched.length){
      return res.status(404).json({error:'Invoice orders were not found in the durable order store.'});
    }

    const updated=matched.map((o:any)=>({
      ...o,
      invoice_pack_downloaded_at:downloadedAt,
      invoice_pack_downloaded_by:downloadedBy,
    }));

    // Persist every updated snapshot BEFORE responding to the browser.
    // Sequential writes are intentional for the local JSON fallback so that
    // simultaneous read/modify/write operations cannot lose another order update.
    for(const order of updated){
      await saveOrderSnapshot(order);
    }

    return res.json({
      ok:true,
      downloadedAt,
      updatedCount:updated.length,
      orders:updated,
    });
  }catch(e:any){
    return res.status(500).json({error:e?.message || 'Invoice download status could not be saved.'});
  }
});
app.put('/api/orders/:id', requireAdminSession, async (req,res)=>{
  try{
    const order=req.body?.order;
    if(!order || String(order.id)!==String(req.params.id)) return res.status(400).json({error:'Order ID mismatch.'});
    await saveOrderSnapshot(order);
    return res.json({ok:true});
  }catch(e:any){return res.status(500).json({error:e?.message||'Order update failed.'});}
});
app.delete('/api/orders/:id', requireSuperAdmin, async (req,res)=>{
  try{
    const id=String(req.params.id || '').trim();
    const reason=String(req.body?.reason || '').trim();
    if(reason.length < 3) return res.status(400).json({error:'Delete reason is required.'});
    const current=await getOrderSnapshots();
    const order=current.find((o:any)=>String(o.id)===id);
    if(!order) return res.status(404).json({error:'Order not found.'});
    if(order.order_status==='Shipped' || order.order_status==='Delivered' || order.dispatch_status==='Handed Over'){
      return res.status(409).json({error:'Shipped / delivered orders cannot be deleted.'});
    }

    const sb=getSupabaseAdmin();
    if(sb){
      try{
        const {error}=await sb.from('order_snapshots').delete().eq('order_id',id);
        if(error) throw error;
      }catch(e){
        console.warn('Supabase individual order delete failed; local fallback will still be cleared:',(e as any)?.message||e);
      }
    }
    writeOrderSnapshotsLocal(readOrderSnapshotsLocal().filter((o:any)=>String(o.id)!==id));

    let sheetSync:OraSheetSyncResult={ok:true,skipped:true};
    try{
      const state=await readSharedStorefrontState();
      const webhook=String(state?.settings?.google_sheet_webhook_url||'').trim();
      if(webhook && order.order_source!=='Manual Admin'){
        const result=await postAppsScriptFastServer(webhook,{payload_type:'order_delete',order_number:order.order_number,order_source:order.order_source,reason});
        sheetSync={ok:String(result?.status||'')==='order_deleted'};
      }
    }catch(e:any){ sheetSync={ok:false,error:e?.message||'Google Sheet delete failed.'}; }
    return res.json({ok:true,order_number:order.order_number,reason,sheet_sync:sheetSync});
  }catch(e:any){return res.status(500).json({error:e?.message||'Order delete failed.'});}
});
app.delete('/api/orders', requireSuperAdmin, async (_req,res)=>{
  const sb=getSupabaseAdmin();
  if(sb){
    try{
      const {error}=await sb.from('order_snapshots').delete().neq('order_id','__never__');
      if(error) throw error;
    }catch(e){ console.warn('Supabase order snapshot reset failed:',(e as any)?.message||e); }
  }
  writeOrderSnapshotsLocal([]);
  return res.json({ok:true});
});
app.delete('/api/operational-test-data', requireSuperAdmin, async (_req,res)=>{
  try {
    const beforeLocal = readOrderSnapshotsLocal().length;

    // Localhost authoritative test store: clear it immediately.
    writeOrderSnapshotsLocal([]);

    // Live/Supabase mirror: clear if configured.
    const sb=getSupabaseAdmin();
    if(sb){
      try{
        const {error}=await sb.from('order_snapshots').delete().neq('order_id','__never__');
        if(error) throw error;
      }catch(e){
        console.warn('Supabase operational reset failed:',(e as any)?.message||e);
      }
    }

    return res.json({
      ok:true,
      removed_local_orders:beforeLocal,
      remaining_local_orders:readOrderSnapshotsLocal().length
    });
  } catch (e:any) {
    return res.status(500).json({error:e?.message || 'Operational data clear failed.'});
  }
});


// Full live-start cleanup. Staff/admin accounts and configuration files are deliberately preserved.
app.delete('/api/live-start-reset', requireSuperAdmin, async (_req,res)=>{
  try {
    // Preserve the O-RA website/legal text, branding, invoice design and technical
    // storefront settings. Products/categories/orders are still cleared. Business
    // contact/bank/BR fields are intentionally blanked for the real live start.
    const storefrontBefore=await readSharedStorefrontState();
    const preservedSettings={...(storefrontBefore?.settings||{})};
    const resetSettings={
      ...preservedSettings,
      bank_name:'',bank_account_holder:'',bank_account_number:'',bank_branch:'',bank_details_saved:false,
      whatsapp_number:'',hotline_number:'',company_email:'',company_address:'',top_banner_phone:'',
      business_registration_enabled:false,business_registration_name:'',business_registration_number:'',business_registration_copy_url:'',
    };

    const removedLocalOrders=readOrderSnapshotsLocal().length;
    const removedLocalReviews=readJsonArray(reviewsFile).length;
    const removedLocalRequests=readJsonArray(productRequestsFile).length;
    writeOrderSnapshotsLocal([]);
    writeJsonArray(reviewsFile,[]);
    writeJsonArray(productRequestsFile,[]);
    writeAdminDataLocal({});

    const warnings:string[]=[];
    const sb=getSupabaseAdmin();
    if(sb){
      for(const table of ['order_snapshots','customer_reviews','product_requests','admin_data_store']){
        try{
          const column=table==='order_snapshots'?'order_id':table==='admin_data_store'?'key':'id';
          const {error}=await sb.from(table).delete().neq(column,'__never__');
          if(error) throw error;
        }catch(e:any){ warnings.push(`${table}: ${e?.message||'clear failed'}`); }
      }
    }

    try { await writeSharedStorefrontState({products:[],categories:[],settings:resetSettings}); }
    catch(e:any){ warnings.push(`storefront settings restore: ${e?.message||'failed'}`); }

    return res.json({ok:true,removed_local_orders:removedLocalOrders,removed_local_reviews:removedLocalReviews,removed_local_product_requests:removedLocalRequests,warnings});
  } catch(e:any){ return res.status(500).json({error:e?.message||'Full live-start reset failed.'}); }
});



// -----------------------------------------------------------------------------
// Shared Fardar city list + customer-city mappings
// -----------------------------------------------------------------------------
interface FardarCityRow { name: string; code?: string; }
interface FardarCityMappingRow { input_city: string; fardar_city: string; }
const normalizeCityKey = (v: unknown) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9\u0D80-\u0DFF]+/g, ' ').replace(/\s+/g, ' ').trim();
const getFardarCities = async (): Promise<FardarCityRow[]> => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('fardar_cities').select('name,code,district').order('name').limit(20000);
      if (error) throw error;
      return (data || []).map((r:any) => ({ name: String(r.name), code: r.code ? String(r.code) : undefined, district: r.district ? String(r.district) : undefined }));
    } catch (e) { console.warn('Fardar city list Supabase unavailable; using local store:', (e as any)?.message || e); }
  }
  return readJsonArray(fardarCitiesFile) as FardarCityRow[];
};
const replaceFardarCities = async (rows: FardarCityRow[]) => {
  const clean = Array.from(new Map(rows.map(r => [normalizeCityKey(r.name), { name: String(r.name || '').trim(), code: String(r.code || '').trim() || undefined, district: String(r.district || '').trim() || undefined }])).values()).filter(r => r.name);
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { error: delErr } = await sb.from('fardar_cities').delete().neq('name', '__never__');
      if (delErr) throw delErr;
      if (clean.length) {
        const { error } = await sb.from('fardar_cities').insert(clean);
        if (error) throw error;
      }
      return clean;
    } catch (e) { console.warn('Fardar city replace Supabase failed; using local store:', (e as any)?.message || e); }
  }
  writeJsonArray(fardarCitiesFile, clean); return clean;
};
const getFardarMappings = async (): Promise<FardarCityMappingRow[]> => {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb.from('fardar_city_mappings').select('input_city,fardar_city');
      if (error) throw error;
      return (data || []).map((r:any) => ({ input_city: String(r.input_city), fardar_city: String(r.fardar_city) }));
    } catch (e) { console.warn('Fardar city mapping Supabase unavailable; using local store:', (e as any)?.message || e); }
  }
  return readJsonArray(fardarCityMappingsFile) as FardarCityMappingRow[];
};
const saveFardarMapping = async (inputCity: string, fardarCity: string) => {
  const row = { input_city: String(inputCity || '').trim(), fardar_city: String(fardarCity || '').trim() };
  if (!row.input_city || !row.fardar_city) throw new Error('Both city values are required.');
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { error } = await sb.from('fardar_city_mappings').upsert({ ...row, input_key: normalizeCityKey(row.input_city) }, { onConflict: 'input_key' });
      if (error) throw error;
      return row;
    } catch (e) { console.warn('Fardar city mapping Supabase save failed; using local store:', (e as any)?.message || e); }
  }
  const rows = readJsonArray(fardarCityMappingsFile) as FardarCityMappingRow[];
  const key = normalizeCityKey(row.input_city);
  const idx = rows.findIndex(r => normalizeCityKey(r.input_city) === key);
  if (idx >= 0) rows[idx] = row; else rows.push(row);
  writeJsonArray(fardarCityMappingsFile, rows); return row;
};
app.get('/api/courier/fardar/cities', requireAdminSession, async (_req, res) => {
  res.json({ cities: await getFardarCities(), mappings: await getFardarMappings() });
});
app.post('/api/courier/fardar/cities/import', requireAdminSession, async (req, res) => {
  const rows = Array.isArray(req.body?.cities) ? req.body.cities : [];
  const saved = await replaceFardarCities(rows);
  res.json({ ok: true, count: saved.length, cities: saved });
});
// Public city search for checkout autocomplete (type 3+ letters)
app.get('/api/courier/fardar/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 20)));
    if (q.length < 2) return res.json({ ok: true, cities: [] });
    const cities = await getFardarCities();
    const matches = cities
      .filter((c: any) => String(c.city_name || c.name || c.city || '').toLowerCase().includes(q))
      .slice(0, limit)
      .map((c: any) => ({ city: String(c.city_name || c.name || c.city || '').trim(), district: String(c.district || c.code || '').trim() }));
    return res.json({ ok: true, total: cities.length, cities: matches });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'City search failed.' });
  }
});
app.post('/api/courier/fardar/city-mappings', requireAdminSession, async (req, res) => {
  try { const mapping = await saveFardarMapping(req.body?.input_city, req.body?.fardar_city); res.json({ ok: true, mapping }); }
  catch (e:any) { res.status(400).json({ error: e?.message || 'Could not save city mapping.' }); }
});

// Future-ready Fardar courier adapter.
// The storefront never receives the API secret. When Fardar issues access, configure only server env values.
const readFieldPath = (obj: any, fieldPath: string) => {
  return String(fieldPath || '').split('.').filter(Boolean).reduce((cur: any, key: string) => cur?.[key], obj);
};

const replaceTemplateValues = (value: any, values: Record<string, string | number>) => {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
    if (exact && values[exact[1]] !== undefined) return values[exact[1]];
    return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_m, key) => String(values[key] ?? ''));
  }
  if (Array.isArray(value)) return value.map((v) => replaceTemplateValues(v, values));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceTemplateValues(v, values)]));
  return value;
};

app.get('/api/courier/fardar/status', (_req, res) => {
  const configured = Boolean(process.env.FARDAR_API_URL && process.env.FARDAR_API_KEY);
  res.json({ configured, provider: 'Fardar', accountConfigured: Boolean(process.env.FARDAR_ACCOUNT_ID) });
});

app.post('/api/courier/fardar/waybill', async (req, res) => {
  const baseUrl = String(process.env.FARDAR_API_URL || '').replace(/\/$/, '');
  const apiKey = String(process.env.FARDAR_API_KEY || '');
  if (!baseUrl || !apiKey) return res.status(503).json({ error: 'Fardar API is not configured on the server.' });

  const order = req.body?.order || {};
  const values: Record<string, string | number> = {
    account_id: String(process.env.FARDAR_ACCOUNT_ID || ''),
    order_id: String(order.id || ''),
    order_number: String(order.order_number || ''),
    customer_name: String(order.customer_name || ''),
    phone: String(order.phone || ''),
    address: String(order.address || ''),
    city: String(order.fardar_city || order.city || ''),
    total_amount: Number(order.total_amount || 0),
    cod_amount: String(order.payment_method || '').toLowerCase().includes('cash') ? Number(order.total_amount || 0) : 0,
  };

  let payload: any = {
    account_id: values.account_id,
    reference: values.order_number,
    customer_name: values.customer_name,
    phone: values.phone,
    address: values.address,
    city: values.city,
    amount: values.cod_amount,
  };
  const template = String(process.env.FARDAR_REQUEST_TEMPLATE_JSON || '').trim();
  if (template) {
    try { payload = replaceTemplateValues(JSON.parse(template), values); }
    catch { return res.status(500).json({ error: 'FARDAR_REQUEST_TEMPLATE_JSON is invalid JSON.' }); }
  }

  const authHeader = String(process.env.FARDAR_AUTH_HEADER || 'Authorization');
  const authPrefix = String(process.env.FARDAR_AUTH_PREFIX ?? 'Bearer ');
  const pathPart = String(process.env.FARDAR_WAYBILL_PATH || '/waybills');
  try {
    const upstream = await fetch(`${baseUrl}${pathPart.startsWith('/') ? '' : '/'}${pathPart}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [authHeader]: `${authPrefix}${apiKey}` },
      body: JSON.stringify(payload),
    });
    const raw = await upstream.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!upstream.ok) return res.status(502).json({ error: 'Fardar API rejected the request.', status: upstream.status, details: data });
    const field = String(process.env.FARDAR_WAYBILL_RESPONSE_FIELD || 'waybill');
    const waybill = readFieldPath(data, field) ?? data?.waybill_number ?? data?.tracking_number ?? data?.awb;
    if (!waybill) return res.status(502).json({ error: `Fardar response did not contain a waybill at field: ${field}`, details: data });
    return res.json({ waybill: String(waybill), raw: data });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || 'Could not reach Fardar API.' });
  }
});

// Free fake-order protection: hashed IP signal + short-window rate limiting.
// No paid IP lookup service is used and raw IP addresses are not stored.
const orderAttempts = new Map<string, number[]>();
const recentOrderFingerprints = new Map<string, number>();
const abuseSalt = process.env.ABUSE_HASH_SALT || 'ora-local-abuse-salt-change-in-production';

const requestIpHash = (req: express.Request) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const rawIp = forwarded || req.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(`${abuseSalt}:${rawIp}`).digest('hex').slice(0, 24);
};

app.post('/api/order-guard', (req, res) => {
  const now = Date.now();
  const ipHash = requestIpHash(req);
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  const whatsapp = String(req.body?.whatsapp || '').replace(/\D/g, '');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!/^07\d{8}$/.test(phone)) return res.status(400).json({ allowed: false, message: 'Invalid Sri Lankan mobile number.' });

  const attempts = (orderAttempts.get(ipHash) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (attempts.length >= 5) {
    return res.status(429).json({ allowed: false, message: 'Too many order attempts from this connection. Please try again later.' });
  }
  attempts.push(now);
  orderAttempts.set(ipHash, attempts);

  const itemKey = items.map((i: any) => `${String(i.id)}:${Number(i.qty || 0)}`).sort().join('|');
  const fingerprint = crypto.createHash('sha256').update(`${phone}|${whatsapp}|${itemKey}`).digest('hex');
  const previous = recentOrderFingerprints.get(fingerprint);
  if (previous && now - previous < 10 * 60 * 1000) {
    return res.status(409).json({ allowed: false, message: 'A similar order was submitted recently. Duplicate order blocked.' });
  }
  recentOrderFingerprints.set(fingerprint, now);

  // Clean old fingerprints opportunistically.
  for (const [key, time] of recentOrderFingerprints) if (now - time > 30 * 60 * 1000) recentOrderFingerprints.delete(key);
  return res.json({ allowed: true, riskId: ipHash });
});

// Initialize Gemini Client safely
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// Admin-only Sinhala helper for product names/descriptions/item details.
// Existing English text is never overwritten; the UI only fills Sinhala fields
// when they are blank unless the admin explicitly presses Regenerate.
app.post('/api/admin/translate-sinhala', requireStaffAnyPermission(['add_product','combo_packs']), async (req,res) => {
  const texts = Array.isArray(req.body?.texts)
    ? req.body.texts.map((value:any) => String(value || '').trim()).slice(0, 12)
    : [];
  if (!texts.length || texts.every((value:string) => !value)) return res.status(400).json({ error: 'English text is required.' });
  if (texts.some((value:string) => value.length > 2500)) return res.status(400).json({ error: 'Translation text is too long.' });

  const ai = getGeminiClient();
  if (!ai) return res.status(503).json({ error: 'GEMINI_API_KEY is not configured, so automatic Sinhala translation is unavailable.' });

  try {
    const response:any = await ai.models.generateContent({
      model: String(process.env.GEMINI_ASSISTANT_MODEL || 'gemini-3.6-flash').trim(),
      contents: `Translate each English e-commerce product text into natural Sinhala for Sri Lankan customers.\nRules:\n- Keep brand names, model numbers, SKUs, technical abbreviations, measurements and units unchanged when appropriate.\n- Do not add marketing claims or information that is not in the English source.\n- Return one Sinhala translation for each input in the exact same order.\n- If an input is already a brand/model/code that should stay unchanged, return it unchanged.\n\nINPUTS: ${JSON.stringify(texts)}`,
      config: {
        temperature: 0.1,
        maxOutputTokens: 1800,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['translations'],
        },
      },
    });
    const raw = String(response?.text || response?.candidates?.[0]?.content?.parts?.map((part:any)=>part?.text || '').join('') || '').trim();
    const parsed = JSON.parse(raw || '{}');
    const translations = Array.isArray(parsed?.translations) ? parsed.translations.map((value:any)=>String(value || '').trim()) : [];
    if (translations.length !== texts.length) throw new Error('Translation result count mismatch.');
    return res.json({ translations });
  } catch (error:any) {
    console.warn('O-RA Sinhala translation failed:', error?.message || error);
    return res.status(502).json({ error: 'Automatic Sinhala translation failed. You can type Sinhala manually and try again later.' });
  }
});


// Admin-only helper that builds customer-facing Combo Pack copy from the exact
// selected component products. This route has a deterministic built-in fallback,
// so Combo content still auto-fills even if Gemini is unavailable or temporarily fails.
const cleanComboSentence = (value: unknown, max = 420) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const stop = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
  return `${(stop > Math.floor(max * 0.55) ? clipped.slice(0, stop + 1) : clipped).trim()}â€¦`;
};

const buildLocalComboContent = (components: any[]) => {
  const includeEn = components.map((row:any) => `${row.name}${row.variant ? ` (${row.variant})` : ''} Ã— ${row.quantity}`);
  const includeSi = components.map((row:any) => `${row.name_si || row.name}${row.variant ? ` (${row.variant})` : ''} Ã— ${row.quantity}`);

  const sourceEn = components.map((row:any) => {
    const desc = cleanComboSentence(row.description, 520);
    return desc ? `${row.name}: ${desc}` : '';
  }).filter(Boolean);
  const sourceSi = components.map((row:any) => {
    const desc = cleanComboSentence(row.description_si, 520);
    return desc ? `${row.name_si || row.name}: ${desc}` : '';
  }).filter(Boolean);

  const description_en = [
    `This Combo Pack includes ${includeEn.join(' + ')}.`,
    sourceEn.length ? sourceEn.join(' ') : 'The selected items are packed together as one convenient Combo Pack.',
  ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 5000);

  const description_si = [
    `à¶¸à·™à¶¸ Combo Pack à¶‘à¶šà¶§ ${includeSi.join(' + ')} à¶‡à¶­à·”à·…à¶­à·Š à·€à·š.`,
    sourceSi.length ? sourceSi.join(' ') : 'à¶­à·à¶»à·à¶œà¶­à·Š à¶·à·à¶«à·Šà¶© à¶‘à¶šà¶¸ à¶´à·„à·ƒà·” Combo Pack à¶‘à¶šà¶šà·Š à¶½à·™à·ƒ à¶‘à¶šà¶§ à·ƒà¶šà·ƒà·Š à¶šà¶» à¶‡à¶­.',
  ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 5000);

  const details:any[] = [];
  const seen = new Set<string>();
  const add = (row:any, labelEn:string, valueEn:string, labelSi?:string, valueSi?:string) => {
    const le = String(labelEn || '').trim();
    const ve = String(valueEn || '').trim();
    if (!le || !ve) return;
    const key = `${le.toLowerCase()}|${ve.toLowerCase()}`;
    if (seen.has(key) || details.length >= 10) return;
    seen.add(key);
    details.push({
      label_en: le.slice(0,120), value_en: ve.slice(0,500),
      label_si: String(labelSi || '').trim().slice(0,120), value_si: String(valueSi || '').trim().slice(0,500),
    });
  };

  for (const row of components) {
    const prefixEn = components.length > 1 ? `${row.short_name || row.name} ` : '';
    const prefixSi = components.length > 1 ? `${row.short_name_si || row.name_si || row.short_name || row.name} ` : '';
    if (row.brand) add(row, `${prefixEn}Brand`, row.brand, `${prefixSi}à·€à·™à·…à¶³ à¶±à·à¶¸à¶º`, row.brand);
    if (row.variant) add(row, `${prefixEn}Variant`, row.variant, `${prefixSi}à¶´à·Šâ€à¶»à¶·à·šà¶¯à¶º`, row.variant);
    for (const d of row.item_details || []) {
      add(row, `${prefixEn}${d.label}`, d.value, `${prefixSi}${d.label_si || d.label}`, d.value_si || d.value);
    }
    for (const d of row.specifications || []) {
      const value = `${d.value}${d.unit ? ` ${d.unit}` : ''}`.trim();
      add(row, `${prefixEn}${d.label}`, value, `${prefixSi}${d.label_si || d.label}`, `${d.value_si || d.value}${d.unit ? ` ${d.unit}` : ''}`.trim());
    }
  }

  return {
    description_en,
    description_si,
    item_details: details,
    combo_name_si: `${components.map((row:any) => row.short_name_si || row.name_si || row.short_name || row.name).join(' + ')} Combo Pack`,
    generation_mode: 'local',
  };
};

app.post('/api/admin/generate-combo-content', requireStaffPermission('combo_packs'), async (req,res) => {
  const rawComponents = Array.isArray(req.body?.components) ? req.body.components.slice(0, 8) : [];
  if (rawComponents.length < 2) return res.status(400).json({ error: 'Select at least 2 Combo Pack items first.' });

  const components = rawComponents.map((row:any) => ({
    code: String(row?.code || '').trim().slice(0, 80),
    name: String(row?.name || '').trim().slice(0, 220),
    name_si: String(row?.name_si || '').trim().slice(0, 220),
    short_name: String(row?.short_name || row?.name || '').trim().slice(0, 100),
    short_name_si: String(row?.short_name_si || row?.name_si || '').trim().slice(0, 100),
    quantity: Math.max(1, Math.min(50, Number(row?.quantity || 1))),
    variant: String(row?.variant || '').trim().slice(0, 220),
    brand: String(row?.brand || '').trim().slice(0, 120),
    description: String(row?.description || '').trim().slice(0, 3000),
    description_si: String(row?.description_si || '').trim().slice(0, 3000),
    item_details: Array.isArray(row?.item_details) ? row.item_details.slice(0, 16).map((detail:any) => ({
      label: String(detail?.label || '').trim().slice(0, 120),
      value: String(detail?.value || '').trim().slice(0, 300),
      label_si: String(detail?.label_si || '').trim().slice(0, 120),
      value_si: String(detail?.value_si || '').trim().slice(0, 300),
    })).filter((detail:any) => detail.label && detail.value) : [],
    specifications: Array.isArray(row?.specifications) ? row.specifications.slice(0, 16).map((detail:any) => ({
      label: String(detail?.label || '').trim().slice(0, 120),
      value: String(detail?.value || '').trim().slice(0, 300),
      unit: String(detail?.unit || '').trim().slice(0, 40),
      label_si: String(detail?.label_si || '').trim().slice(0, 120),
      value_si: String(detail?.value_si || '').trim().slice(0, 300),
    })).filter((detail:any) => detail.label && detail.value) : [],
  })).filter((row:any) => row.code && row.name);

  if (components.length < 2) return res.status(400).json({ error: 'Valid Combo Pack component details are required.' });

  const fallback = buildLocalComboContent(components);
  const ai = getGeminiClient();
  if (!ai) return res.json(fallback);

  try {
    const response:any = await ai.models.generateContent({
      model: String(process.env.GEMINI_ASSISTANT_MODEL || 'gemini-3.6-flash').trim(),
      contents: `Create concise English e-commerce content for one Combo Pack using ONLY the supplied component data.\n\nRules:\n- Do not invent specifications, warranty, compatibility, performance claims, materials, sizes or features.\n- Description must explain the usefulness of the items together and mention the included items naturally.\n- Keep the description practical and customer-friendly, about 70-150 words.\n- Return 2-10 useful item-detail rows only when supported by the source data.\n- For details that belong to only one component, prefix the label with a short recognizable component name.\n- Do not duplicate the separate Combo Pack Includes list as an item-detail row.\n- Keep model numbers, units, brands and technical abbreviations exact.\n- English only.\n\nCOMPONENTS: ${JSON.stringify(components)}`,
      config: {
        temperature: 0.2,
        maxOutputTokens: 2200,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description_en: { type: Type.STRING },
            item_details: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { label_en: { type: Type.STRING }, value_en: { type: Type.STRING } },
                required: ['label_en','value_en'],
              },
            },
          },
          required: ['description_en','item_details'],
        },
      },
    });

    const raw = String(response?.text || response?.candidates?.[0]?.content?.parts?.map((part:any)=>part?.text || '').join('') || '').trim();
    const parsed = JSON.parse(raw || '{}');
    const description_en = String(parsed?.description_en || '').trim().slice(0, 5000) || fallback.description_en;
    const aiDetails = (Array.isArray(parsed?.item_details) ? parsed.item_details : [])
      .slice(0, 10)
      .map((detail:any) => ({
        label_en: String(detail?.label_en || '').trim().slice(0, 120),
        value_en: String(detail?.value_en || '').trim().slice(0, 500),
      }))
      .filter((detail:any) => detail.label_en && detail.value_en);

    // Match locally sourced Sinhala values to AI labels where possible; the client
    // will still try exact English->Sinhala translation and fall back to these values.
    const item_details = (aiDetails.length ? aiDetails : fallback.item_details).map((detail:any, index:number) => ({
      ...detail,
      label_si: fallback.item_details[index]?.label_si || '',
      value_si: fallback.item_details[index]?.value_si || '',
    }));

    return res.json({
      description_en,
      description_si: fallback.description_si,
      item_details,
      combo_name_si: fallback.combo_name_si,
      generation_mode: 'gemini',
    });
  } catch (error:any) {
    console.warn('O-RA Combo AI enhancement failed; using built-in fallback:', error?.message || error);
    return res.json({ ...fallback, warning: 'AI enhancement unavailable; built-in Combo content was generated instead.' });
  }
});


// -----------------------------------------------------------------------------
// O-RA Customer Assistant (Gemini -> Groq -> built-in fallback)
// -----------------------------------------------------------------------------
const assistantRedact = (value: unknown) => String(value || '')
  .replace(/\b(?:\+?94|0)?7\d{8}\b/g, '[phone]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
  .replace(/\b\d{7,}\b/g, '[private-number]')
  .slice(0, 1200);


// -----------------------------------------------------------------------------
// Assistant human handoff inbox.
// Only escalated conversations are stored so free-tier storage is not wasted on
// ordinary AI/FAQ chats. Customer messages are redacted before persistence.
// -----------------------------------------------------------------------------
const assistantSessionId = (value: unknown) => String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
const assistantLanguageCode = (value: unknown) => value === 'si' || value === 'ta' ? String(value) : 'en';
const compactAssistantChatRows = (rows: any[]) => {
  const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
  return [...rows]
    .filter((row:any) => row?.status !== 'Resolved' || new Date(row.updated_at || row.created_at || 0).getTime() >= cutoff)
    .sort((a:any,b:any)=>new Date(b.updated_at||b.created_at||0).getTime()-new Date(a.updated_at||a.created_at||0).getTime())
    .slice(0, 500);
};

app.post('/api/assistant/handoff', async (req,res) => {
  if (!allowPublicSubmission(req, 'assistant-handoff', 40, 60 * 60 * 1000)) return res.status(429).json({ error:'Too many support messages. Please try again later.' });
  try {
    const sessionId = assistantSessionId(req.body?.sessionId);
    const message = assistantRedact(req.body?.message).trim();
    const language = assistantLanguageCode(req.body?.language);
    if (sessionId.length < 8 || message.length < 2) return res.status(400).json({ error:'A valid support session and message are required.' });
    const rows = await getSharedAdminPayload('assistant-chats');
    const now = new Date().toISOString();
    let chat = rows.find((row:any)=>row.session_id === sessionId && row.status !== 'Resolved');
    const sanitizedHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-6).map((m:any)=>({
      id: `m-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      role: m?.role === 'assistant' ? 'assistant' : 'customer',
      text: assistantRedact(m?.text),
      at: now,
      context_only: true,
    })) : [];
    if (!chat) {
      chat = {
        id: nextPublicRecordId('ACH', rows),
        session_id: sessionId,
        language,
        status: 'Needs Agent',
        order_number: String(req.body?.orderNumber || '').trim().toUpperCase().slice(0,40) || null,
        messages: [...sanitizedHistory, { id:`m-${Date.now()}-c`, role:'customer', text:message, at:now }],
        created_at: now,
        updated_at: now,
      };
      rows.unshift(chat);
    } else {
      chat.language = language;
      chat.status = 'Needs Agent';
      chat.updated_at = now;
      chat.messages = [...(Array.isArray(chat.messages) ? chat.messages : []), { id:`m-${Date.now()}-c`, role:'customer', text:message, at:now }].slice(-80);
    }
    await saveSharedAdminPayload('assistant-chats', compactAssistantChatRows(rows));
    return res.json({ ok:true, chatId:chat.id, status:chat.status });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Support handoff failed.' }); }
});

app.post('/api/assistant/handoff/:sessionId/message', async (req,res) => {
  if (!allowPublicSubmission(req, 'assistant-handoff-message', 60, 60 * 60 * 1000)) return res.status(429).json({ error:'Too many support messages. Please try again later.' });
  try {
    const sessionId = assistantSessionId(req.params.sessionId);
    const message = assistantRedact(req.body?.message).trim();
    if (sessionId.length < 8 || message.length < 1) return res.status(400).json({ error:'Message is required.' });
    const rows = await getSharedAdminPayload('assistant-chats');
    const chat = rows.find((row:any)=>row.session_id === sessionId && row.status !== 'Resolved');
    if (!chat) return res.status(404).json({ error:'Support conversation not found.' });
    const now = new Date().toISOString();
    chat.messages = [...(Array.isArray(chat.messages) ? chat.messages : []), { id:`m-${Date.now()}-c`, role:'customer', text:message, at:now }].slice(-80);
    chat.status = 'Needs Agent';
    chat.updated_at = now;
    await saveSharedAdminPayload('assistant-chats', compactAssistantChatRows(rows));
    return res.json({ ok:true });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Support message could not be saved.' }); }
});

app.get('/api/assistant/handoff/:sessionId', async (req,res) => {
  try {
    const sessionId = assistantSessionId(req.params.sessionId);
    if (sessionId.length < 8) return res.status(404).json({ error:'Support conversation not found.' });
    const rows = await getSharedAdminPayload('assistant-chats');
    const chat = rows.find((row:any)=>row.session_id === sessionId);
    if (!chat) return res.json({ ok:true, chat:null });
    const visibleMessages = (Array.isArray(chat.messages) ? chat.messages : [])
      .filter((m:any)=>!m.context_only)
      .map((m:any)=>({ id:String(m.id||''), role:m.role === 'agent' ? 'agent' : m.role === 'customer' ? 'customer' : 'assistant', text:String(m.text||''), at:m.at }));
    return res.json({ ok:true, chat:{ id:chat.id, status:chat.status, language:chat.language || 'en', order_number:chat.order_number || null, messages:visibleMessages, updated_at:chat.updated_at } });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Support conversation could not be loaded.' }); }
});

app.get('/api/admin/assistant-chats', requireStaffPermission('assistant_chats'), async (_req,res) => {
  const rows = await getSharedAdminPayload('assistant-chats');
  return res.json({ chats:compactAssistantChatRows(rows) });
});

app.post('/api/admin/assistant-chats/:id/reply', requireStaffPermission('assistant_chats'), async (req,res) => {
  try {
    const text = String(req.body?.message || '').trim().slice(0,1800);
    if (!text) return res.status(400).json({ error:'Reply is required.' });
    const rows = await getSharedAdminPayload('assistant-chats');
    const chat = rows.find((row:any)=>row.id === req.params.id);
    if (!chat) return res.status(404).json({ error:'Assistant chat not found.' });
    const user = (req as any).staffSessionUser as ServerStaffAccount;
    const now = new Date().toISOString();
    chat.messages = [...(Array.isArray(chat.messages) ? chat.messages : []), {
      id:`m-${Date.now()}-a`, role:'agent', text, at:now, agent_name:user?.display_name || user?.username || 'O-RA Agent'
    }].slice(-80);
    chat.status = 'Replied';
    chat.updated_at = now;
    chat.last_replied_by = user?.display_name || user?.username || 'O-RA Agent';
    await saveSharedAdminPayload('assistant-chats', compactAssistantChatRows(rows));
    return res.json({ ok:true, chat });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Reply could not be saved.' }); }
});

app.patch('/api/admin/assistant-chats/:id', requireStaffPermission('assistant_chats'), async (req,res) => {
  try {
    const status = ['Needs Agent','Replied','Resolved'].includes(String(req.body?.status)) ? String(req.body.status) : null;
    if (!status) return res.status(400).json({ error:'Invalid chat status.' });
    const rows = await getSharedAdminPayload('assistant-chats');
    const chat = rows.find((row:any)=>row.id === req.params.id);
    if (!chat) return res.status(404).json({ error:'Assistant chat not found.' });
    chat.status = status;
    chat.updated_at = new Date().toISOString();
    await saveSharedAdminPayload('assistant-chats', compactAssistantChatRows(rows));
    return res.json({ ok:true, chat });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Chat status could not be updated.' }); }
});

// -----------------------------------------------------------------------------
// Complaint case store. WhatsApp Cloud API can be connected later; the O-RA
// case-management workflow works locally now without paid services or new SQL.
// -----------------------------------------------------------------------------
const complaintStatuses = ['New','Checking','Waiting Customer','Return Requested','Return In Transit','Parcel Received','Refund Approved','Refund Completed','Resolved','Rejected'];
const complaintCategories = ['Wrong Item','Missing Item','Damaged Item','Delivery Issue','Payment Issue','Other Complaint'];
const compactComplaintRows = (rows:any[]) => [...rows]
  .sort((a:any,b:any)=>new Date(b.updated_at||b.created_at||0).getTime()-new Date(a.updated_at||a.created_at||0).getTime())
  .slice(0,500);

app.post('/api/complaints/intake', async (req,res) => {
  if (!allowPublicSubmission(req, 'complaint-intake', 20, 60 * 60 * 1000)) return res.status(429).json({ error:'Too many complaint submissions. Please try again later.' });
  try {
    const orderNumber = String(req.body?.order_number || '').trim().toUpperCase().slice(0,40);
    const description = String(req.body?.description || '').trim().slice(0,2200);
    if (!orderNumber || description.length < 4) return res.status(400).json({ error:'Order ID and complaint details are required.' });
    const rows = await getSharedAdminPayload('complaints');
    const now = new Date().toISOString();
    const category = complaintCategories.includes(String(req.body?.category)) ? String(req.body.category) : 'Other Complaint';
    const record = {
      id: nextPublicRecordId('CMP', rows),
      order_number: orderNumber,
      customer_name: String(req.body?.customer_name || '').trim().slice(0,150) || null,
      customer_phone: String(req.body?.customer_phone || '').replace(/[^0-9+]/g,'').slice(0,24) || null,
      source: ['WhatsApp','Website','Manual'].includes(String(req.body?.source)) ? String(req.body.source) : 'Website',
      language: assistantLanguageCode(req.body?.language),
      category,
      description,
      evidence_urls: Array.isArray(req.body?.evidence_urls) ? req.body.evidence_urls.map((x:any)=>String(x||'').slice(0,2000)).filter(Boolean).slice(0,6) : [],
      status: 'New',
      messages: [],
      created_at: now,
      updated_at: now,
    };
    rows.unshift(record);
    await saveSharedAdminPayload('complaints', compactComplaintRows(rows));
    return res.json({ ok:true, complaint:{ id:record.id, status:record.status } });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Complaint could not be submitted.' }); }
});

app.get('/api/admin/complaints', requireStaffPermission('complaints'), async (_req,res) => {
  return res.json({ complaints:compactComplaintRows(await getSharedAdminPayload('complaints')) });
});

app.post('/api/admin/complaints', requireStaffPermission('complaints'), async (req,res) => {
  try {
    const rows = await getSharedAdminPayload('complaints');
    const now = new Date().toISOString();
    const description = String(req.body?.description || '').trim().slice(0,2200);
    const orderNumber = String(req.body?.order_number || '').trim().toUpperCase().slice(0,40);
    if (!description || !orderNumber) return res.status(400).json({ error:'Order ID and complaint details are required.' });
    const record = {
      id: nextPublicRecordId('CMP', rows), order_number:orderNumber,
      customer_name:String(req.body?.customer_name||'').trim().slice(0,150)||null,
      customer_phone:String(req.body?.customer_phone||'').replace(/[^0-9+]/g,'').slice(0,24)||null,
      source:'Manual', language:'en',
      category:complaintCategories.includes(String(req.body?.category)) ? String(req.body.category) : 'Other Complaint',
      description, evidence_urls:[], status:'New', messages:[], created_at:now, updated_at:now,
    };
    rows.unshift(record); await saveSharedAdminPayload('complaints', compactComplaintRows(rows));
    return res.json({ ok:true, complaint:record });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Complaint could not be created.' }); }
});

app.patch('/api/admin/complaints/:id', requireStaffPermission('complaints'), async (req,res) => {
  try {
    const rows = await getSharedAdminPayload('complaints');
    const complaint = rows.find((row:any)=>row.id === req.params.id);
    if (!complaint) return res.status(404).json({ error:'Complaint not found.' });
    const nextStatus = complaintStatuses.includes(String(req.body?.status)) ? String(req.body.status) : complaint.status;
    const returnReceivedAt = String(req.body?.return_received_at || complaint.return_received_at || '').trim() || null;
    if (['Refund Approved','Refund Completed'].includes(nextStatus) && !returnReceivedAt) {
      return res.status(409).json({ error:'Confirm Parcel Received before approving a refund.' });
    }
    complaint.status = nextStatus;
    complaint.return_waybill = String(req.body?.return_waybill ?? complaint.return_waybill ?? '').trim().slice(0,120) || null;
    complaint.return_received_at = returnReceivedAt;
    complaint.return_condition_notes = String(req.body?.return_condition_notes ?? complaint.return_condition_notes ?? '').trim().slice(0,1600) || null;
    complaint.refund_amount = Number(req.body?.refund_amount ?? complaint.refund_amount ?? 0) || null;
    complaint.refund_method = String(req.body?.refund_method ?? complaint.refund_method ?? '').trim().slice(0,120) || null;
    complaint.refund_reference = String(req.body?.refund_reference ?? complaint.refund_reference ?? '').trim().slice(0,160) || null;
    complaint.refund_completed_at = nextStatus === 'Refund Completed' ? (complaint.refund_completed_at || new Date().toISOString()) : complaint.refund_completed_at || null;
    complaint.internal_notes = String(req.body?.internal_notes ?? complaint.internal_notes ?? '').trim().slice(0,2200) || null;
    complaint.updated_at = new Date().toISOString();
    await saveSharedAdminPayload('complaints', compactComplaintRows(rows));
    return res.json({ ok:true, complaint });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Complaint could not be updated.' }); }
});

app.post('/api/admin/complaints/:id/reply', requireStaffPermission('complaints'), async (req,res) => {
  try {
    const text = String(req.body?.message || '').trim().slice(0,1800);
    if (!text) return res.status(400).json({ error:'Reply is required.' });
    const rows = await getSharedAdminPayload('complaints');
    const complaint = rows.find((row:any)=>row.id === req.params.id);
    if (!complaint) return res.status(404).json({ error:'Complaint not found.' });
    const user = (req as any).staffSessionUser as ServerStaffAccount;
    const now = new Date().toISOString();
    complaint.messages = [...(Array.isArray(complaint.messages) ? complaint.messages : []), {
      id:`cm-${Date.now()}`, role:'agent', text, at:now, agent_name:user?.display_name || user?.username || 'O-RA Agent', delivery:'Pending WhatsApp Setup'
    }].slice(-80);
    complaint.updated_at = now;
    complaint.status = complaint.status === 'New' ? 'Checking' : complaint.status;
    await saveSharedAdminPayload('complaints', compactComplaintRows(rows));
    return res.json({ ok:true, complaint, delivery:'Pending WhatsApp Setup' });
  } catch (e:any) { return res.status(500).json({ error:e?.message || 'Complaint reply could not be saved.' }); }
});

const assistantBasicReply = (raw: string, lang = 'en') => {
  const text = String(raw || '').toLowerCase();
  const selected = lang === 'si' || lang === 'ta' ? lang : 'en';
  const replies = {
    en: {
      restricted: 'I canâ€™t help find or buy restricted or dangerous items. I can help with other O-RA products, orders, payments and delivery.',
      payment: 'For payment, use COD or Bank Transfer when it is published at checkout. If you already paid, use â€œPayment Doneâ€ and submit the Order ID plus receipt.',
      delivery: 'Use â€œTrack Orderâ€ and verify both the Order ID and the full phone number used for that order.',
      fallback: 'Smart AI is temporarily unavailable. Basic Support is still online â€” use Track Order, Payment Done, Payment Help or Delivery.',
    },
    si: {
      restricted: 'à·ƒà·“à¶¸à· à¶šà·… à·„à· à¶…à¶±à¶­à·”à¶»à·”à¶¯à·à¶ºà¶š à¶·à·à¶«à·Šà¶© à·ƒà·™à·€à·“à¶¸à¶§ à·„à· à¶¸à·’à¶½à¶¯à·“ à¶œà·à¶±à·“à¶¸à¶§ à¶¸à¶§ à¶‹à¶¯à·€à·Š à¶šà¶»à¶±à·Šà¶± à¶¶à·à·„à·. O-RA à·„à·’ à¶…à¶±à·™à¶šà·”à¶­à·Š à¶·à·à¶«à·Šà¶©, orders, payments à·ƒà·„ delivery à¶œà·à¶± à¶‹à¶¯à·€à·Š à¶šà¶»à¶±à·Šà¶± à¶´à·”à·…à·”à·€à¶±à·Š.',
      payment: 'Payment à·ƒà¶³à·„à· Checkout à¶‘à¶šà·š COD à·„à· publish à¶šà¶» à¶­à·’à¶¶à·š à¶±à¶¸à·Š Bank Transfer à¶·à·à·€à·’à¶­à· à¶šà¶»à¶±à·Šà¶±. Payment à¶šà¶»à¶½à· à¶±à¶¸à·Š â€œPayment Doneâ€ option à¶‘à¶šà·™à¶±à·Š Order ID à·ƒà·„ receipt à¶‘à¶š submit à¶šà¶»à¶±à·Šà¶±.',
      delivery: 'Delivery status à¶¶à¶½à¶±à·Šà¶± â€œTrack Orderâ€ à¶·à·à·€à·’à¶­à· à¶šà¶» Order ID à¶‘à¶š à·ƒà·„ à¶‘à¶¸ order à¶‘à¶šà¶§ à¶·à·à·€à·’à¶­à· à¶šà·… à·ƒà¶¸à·Šà¶´à·–à¶»à·Šà¶« Phone Number à¶‘à¶š à¶¯à·™à¶šà¶¸ verify à¶šà¶»à¶±à·Šà¶±.',
      fallback: 'Smart AI à¶­à·à·€à¶šà·à¶½à·’à¶šà·€ à¶½à¶¶à·à¶œà¶­ à¶±à·œà·„à·à¶š. Basic Support à¶­à·€à¶¸ online â€” Track Order, Payment Done, Payment Help à·„à· Delivery à¶·à·à·€à·’à¶­à· à¶šà¶»à¶±à·Šà¶±.',
    },
    ta: {
      restricted: 'à®•à®Ÿà¯à®Ÿà¯à®ªà¯à®ªà®Ÿà¯à®¤à¯à®¤à®ªà¯à®ªà®Ÿà¯à®Ÿ à®…à®²à¯à®²à®¤à¯ à®†à®ªà®¤à¯à®¤à®¾à®© à®ªà¯Šà®°à¯à®Ÿà¯à®•à®³à¯ˆà®¤à¯ à®¤à¯‡à®Ÿ à®…à®²à¯à®²à®¤à¯ à®µà®¾à®™à¯à®• à®‰à®¤à®µ à®®à¯à®Ÿà®¿à®¯à®¾à®¤à¯. à®®à®±à¯à®± O-RA à®ªà¯Šà®°à¯à®Ÿà¯à®•à®³à¯, orders, payments à®®à®±à¯à®±à¯à®®à¯ delivery à®•à¯à®±à®¿à®¤à¯à®¤à¯ à®‰à®¤à®µ à®®à¯à®Ÿà®¿à®¯à¯à®®à¯.',
      payment: 'à®•à®Ÿà¯à®Ÿà®£à®¤à¯à®¤à®¿à®±à¯à®•à¯ Checkout-à®²à¯ COD à®…à®²à¯à®²à®¤à¯ publish à®šà¯†à®¯à¯à®¯à®ªà¯à®ªà®Ÿà¯à®Ÿà®¿à®°à¯à®¨à¯à®¤à®¾à®²à¯ Bank Transfer à®ªà®¯à®©à¯à®ªà®Ÿà¯à®¤à¯à®¤à®µà¯à®®à¯. à®à®±à¯à®•à®©à®µà¯‡ payment à®šà¯†à®¯à¯à®¤à®¿à®°à¯à®¨à¯à®¤à®¾à®²à¯ â€œPayment Doneâ€ à®®à¯‚à®²à®®à¯ Order ID à®®à®±à¯à®±à¯à®®à¯ receipt-à® submit à®šà¯†à®¯à¯à®¯à®µà¯à®®à¯.',
      delivery: 'Delivery status à®ªà®¾à®°à¯à®•à¯à®• â€œTrack Orderâ€ à®ªà®¯à®©à¯à®ªà®Ÿà¯à®¤à¯à®¤à®¿ Order ID à®®à®±à¯à®±à¯à®®à¯ à®…à®¨à¯à®¤ order-à®•à¯à®•à¯ à®ªà®¯à®©à¯à®ªà®Ÿà¯à®¤à¯à®¤à®¿à®¯ à®®à¯à®´à¯ Phone Number à®‡à®°à®£à¯à®Ÿà¯ˆà®¯à¯à®®à¯ verify à®šà¯†à®¯à¯à®¯à®µà¯à®®à¯.',
      fallback: 'Smart AI à®¤à®±à¯à®•à®¾à®²à®¿à®•à®®à®¾à®• à®•à®¿à®Ÿà¯ˆà®•à¯à®•à®µà®¿à®²à¯à®²à¯ˆ. Basic Support à®‡à®©à¯à®©à¯à®®à¯ online â€” Track Order, Payment Done, Payment Help à®…à®²à¯à®²à®¤à¯ Delivery à®ªà®¯à®©à¯à®ªà®Ÿà¯à®¤à¯à®¤à®µà¯à®®à¯.',
    },
  } as const;
  const r = replies[selected];
  if (/\b(weapon|gun|firearm|ammo|ammunition|knife|blade|taser|pepper\s*spray)\b/i.test(text)) return r.restricted;
  if (/(payment|bank|cod|advance|à¶œà·™à·€|à¶¸à·”à¶¯à¶½à·Š|à®•à®Ÿà¯à®Ÿà®£à®®à¯|à®ªà®£à®®à¯)/i.test(text)) return r.payment;
  if (/(delivery|shipping|courier|à¶©à·’à¶½à·’à·€à¶»à·’|à¶¶à·™à¶¯à·à·„à·à¶»|à®Ÿà¯†à®²à®¿à®µà®°à®¿|à®µà®¿à®¨à®¿à®¯à¯‹à®•à®®à¯)/i.test(text)) return r.delivery;
  return r.fallback;
};

const getVerifiedPublicOrder = async (orderNumber: unknown, phoneLast4: unknown) => {
  const target = String(orderNumber || '').trim().toUpperCase();
  const last4 = String(phoneLast4 || '').replace(/\D/g, '').slice(-4);
  if (!target || last4.length !== 4) return null;
  const rows = await getOrderSnapshots();
  const order = rows.find((o:any) => String(o.order_number || '').trim().toUpperCase() === target);
  if (!order) return null;
  const phoneDigits = String(order.phone || '').replace(/\D/g, '');
  if (!phoneDigits.endsWith(last4)) return null;
  return order;
};

const normalizeAssistantPhone = (raw: unknown) => {
  let phone = String(raw || '').replace(/\D/g, '');
  if (phone.startsWith('0094') && phone.length >= 12) phone = `0${phone.slice(4)}`;
  else if (phone.startsWith('94') && phone.length === 11) phone = `0${phone.slice(2)}`;
  return phone;
};

const getVerifiedTrackedOrder = async (orderNumber: unknown, fullPhone: unknown) => {
  const target = String(orderNumber || '').trim().toUpperCase();
  const phone = normalizeAssistantPhone(fullPhone);
  if (!target || phone.length < 9) return null;
  const rows = await getOrderSnapshots();
  const order = rows.find((o:any) => String(o.order_number || '').trim().toUpperCase() === target);
  if (!order) return null;
  if (normalizeAssistantPhone(order.phone) !== phone) return null;
  return order;
};

const assistantSafeOrder = (order:any) => {
  const expectedPayment = order.is_advance_required && !order.advance_confirmed
    ? Number(order.advance_amount || 0)
    : Number(order.total_amount || 0);
  const verification = String(order.payment_verification_status || '');
  const receiptReceived = Boolean(order.bank_receipt_url);
  const blockedStatus = ['Cancelled', 'Shipped', 'Delivered'].includes(String(order.order_status || '')) || verification === 'Approved';
  const receiptAwaitingReview = receiptReceived && !['Rejected','Approved'].includes(verification);
  return {
    order_number: String(order.order_number || ''),
    customer_name: String(order.customer_name || ''),
    phone: String(order.phone || ''),
    address: String(order.address || ''),
    city: String(order.city || ''),
    status: String(order.order_status || 'Processing'),
    payment_method: String(order.payment_method || 'COD'),
    payment_status: String(order.payment_status || 'Pending'),
    payment_verification_status: order.payment_verification_status,
    payment_paid_type: order.payment_paid_type,
    advance_confirmed: Boolean(order.advance_confirmed),
    advance_amount: Number(order.advance_amount || 0),
    advance_percentage: Number(order.invoice_advance_percentage_snapshot || 0) || (Number(order.total_amount || 0) > 0 && Number(order.advance_amount || 0) > 0 ? Math.round((Number(order.advance_amount || 0) / Number(order.total_amount || 1)) * 100) : undefined),
    receipt_received: receiptReceived,
    delivery_status: order.delivery_status,
    tracking_status: order.tracking_status,
    waybill_number: order.waybill_number,
    invoice_generated: Boolean(order.invoice_locked || order.invoice_generated_at),
    packing_pdf_downloaded: Boolean(order.invoice_pack_downloaded_at),
    packing_pdf_downloaded_at: order.invoice_pack_downloaded_at ? String(order.invoice_pack_downloaded_at) : undefined,
    subtotal: Number(order.subtotal || 0),
    special_offer_discount: Number(order.special_offer_discount || 0),
    delivery_fee: Number(order.delivery_fee || 0),
    total_amount: Number(order.total_amount || 0),
    order_source: String(order.order_source || 'Website'),
    created_at: String(order.created_at || ''),
    expected_payment_amount: expectedPayment,
    is_advance_required: Boolean(order.is_advance_required),
    payment_eligible: String(order.payment_method || '') === 'Bank Payment' && !blockedStatus && !receiptAwaitingReview && order.payment_status !== 'Refunded',
    items: (Array.isArray(order.items) ? order.items : []).slice(0, 20).map((item:any) => ({
      name: String(item.product_name || item.sku || 'Item'),
      sku: String(item.sku || ''),
      main_sku: String(item.main_sku || item.sku || ''),
      variant_name: String(item.variant_name || ''),
      quantity: Math.max(1, Number(item.quantity || 1)),
      unit_price: Number(item.unit_price || 0),
      subtotal: Number(item.subtotal || 0),
    })),
  };
};


const recoverySourceName = (raw: unknown) => {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'website') return 'Website';
  if (s === 'facebook' || s === 'facebook ads') return 'Facebook Ads';
  if (s === 'tiktok' || s === 'tiktok ads') return 'TikTok Ads';
  return '';
};
const recoveryNameKey = (raw: unknown) => String(raw || '').trim().toLowerCase().replace(/\s+/g,' ');
const recoveryToken = (order:any) => {
  const body = Buffer.from(JSON.stringify({id:String(order.id||''), n:String(order.order_number||''), exp:Date.now()+10*60*1000})).toString('base64url');
  const sig = crypto.createHmac('sha256', staffSessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
};
const verifyRecoveryToken = (token: unknown) => {
  try {
    const parts=String(token||'').split('.'); if(parts.length!==2)return null;
    const expected=crypto.createHmac('sha256', staffSessionSecret).update(parts[0]).digest('base64url');
    if(parts[1].length!==expected.length || !crypto.timingSafeEqual(Buffer.from(parts[1]),Buffer.from(expected)))return null;
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(!data?.id || Number(data.exp||0)<Date.now())return null;
    return data;
  } catch { return null; }
};

app.post('/api/assistant/order-recovery/search', async (_req,res) => {
  return res.status(410).json({error:'Order recovery now requires Order ID + full phone number. Use Track Order.'});
});

app.post('/api/assistant/order-recovery/detail', async (_req,res) => {
  return res.status(410).json({error:'Order recovery now requires Order ID + full phone number. Use Track Order.'});
});

const assistantNameTokens = (raw: unknown) => String(raw || '')
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .split(/\s+/)
  .map((x)=>x.trim())
  .filter((x)=>x.length >= 2);

const assistantNameMatches = (storedName: unknown, suppliedName: unknown) => {
  const stored = new Set(assistantNameTokens(storedName));
  const supplied = assistantNameTokens(suppliedName);
  return supplied.length > 0 && supplied.some((part)=>stored.has(part));
};

app.post('/api/assistant/track-order-flex', async (req,res) => {
  if (!allowPublicSubmission(req, 'assistant-track-flex', 24, 60 * 60 * 1000)) return res.status(429).json({error:'Too many order checks. Please try again later.'});
  try {
    const method = String(req.body?.method || '').trim();
    const rows = await getOrderSnapshots();

    if (method === 'order_phone') {
      const order = await getVerifiedTrackedOrder(req.body?.orderNumber, req.body?.phone);
      if (!order) return res.status(404).json({error:'Order details could not be verified.'});
      return res.json({ok:true, order:assistantSafeOrder(order)});
    }

    if (method === 'phone_name') {
      const phone = normalizeAssistantPhone(req.body?.phone);
      const name = String(req.body?.name || '').trim();
      if (phone.length < 9 || assistantNameTokens(name).length === 0) return res.status(400).json({error:'Full phone number and customer name are required.'});
      const matches = rows
        .filter((o:any)=>normalizeAssistantPhone(o.phone)===phone && assistantNameMatches(o.customer_name,name))
        .sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime())
        .slice(0,5);
      if (!matches.length) return res.status(404).json({error:'No orders matched that phone number and customer name.'});
      return res.json({ok:true, orders:matches.map(assistantSafeOrder)});
    }

    if (method === 'order_name_last4') {
      const orderNo = String(req.body?.orderNumber || '').trim().toUpperCase();
      const last4 = String(req.body?.phoneLast4 || '').replace(/\D/g,'').slice(-4);
      const name = String(req.body?.name || '').trim();
      if (!orderNo || last4.length !== 4 || assistantNameTokens(name).length === 0) return res.status(400).json({error:'Order ID, customer name and last 4 phone digits are required.'});
      const order = rows.find((o:any)=>String(o.order_number||'').trim().toUpperCase()===orderNo);
      if (!order || !normalizeAssistantPhone(order.phone).endsWith(last4) || !assistantNameMatches(order.customer_name,name)) {
        return res.status(404).json({error:'Order details could not be verified.'});
      }
      return res.json({ok:true, order:assistantSafeOrder(order)});
    }

    return res.status(400).json({error:'Unknown verification method.'});
  } catch (e:any) {
    return res.status(500).json({error:e?.message || 'Order tracking check failed.'});
  }
});

app.post('/api/assistant/track-order', async (req,res) => {
  if (!allowPublicSubmission(req, 'assistant-track-secure', 20, 60 * 60 * 1000)) return res.status(429).json({error:'Too many order checks. Please try again later.'});
  try {
    const order = await getVerifiedTrackedOrder(req.body?.orderNumber, req.body?.phone);
    if (!order) return res.status(404).json({error:'Order details could not be verified. Check the Order ID and full phone number.'});
    return res.json({ok:true, order:assistantSafeOrder(order)});
  } catch (e:any) {
    return res.status(500).json({error:e?.message || 'Order tracking check failed.'});
  }
});

app.post('/api/assistant/order-status', async (req,res) => {
  if (!allowPublicSubmission(req, 'assistant-order', 30, 60 * 60 * 1000)) return res.status(429).json({error:'Too many order checks. Please try again later.'});
  try {
    const order = await getVerifiedPublicOrder(req.body?.orderNumber, req.body?.phoneLast4);
    if (!order) return res.status(404).json({error:'Order details could not be verified. Check the Order ID and last 4 phone digits.'});
    return res.json({ok:true, order:assistantSafeOrder(order)});
  } catch (e:any) { return res.status(500).json({error:e?.message || 'Order status check failed.'}); }
});

app.post('/api/assistant/payment-proof', async (req,res) => {
  if (!allowPublicSubmission(req, 'assistant-proof', 12, 60 * 60 * 1000)) return res.status(429).json({error:'Too many payment-proof attempts. Please try again later.'});
  try {
    const order = await getVerifiedPublicOrder(req.body?.orderNumber, req.body?.phoneLast4);
    if (!order) return res.status(404).json({error:'Order details could not be verified.'});
    if (String(order.payment_method || '') !== 'Bank Payment') return res.status(409).json({error:'This is a COD order. A bank-transfer receipt is not required.'});
    if (['Cancelled','Shipped','Delivered'].includes(String(order.order_status || ''))) return res.status(409).json({error:'This order can no longer accept a new payment proof.'});
    if (order.payment_verification_status === 'Approved') return res.status(409).json({error:'This payment is already approved.'});
    if (order.bank_receipt_url && order.payment_verification_status !== 'Rejected') return res.status(409).json({error:'A payment receipt is already waiting for verification.'});

    const receiptUrl = String(req.body?.receiptUrl || '').trim();
    if (!receiptUrl || receiptUrl.length > 2000) return res.status(400).json({error:'A valid receipt image is required.'});
    const a = req.body?.analysis && typeof req.body.analysis === 'object' ? req.body.analysis : {};
    const expected = order.is_advance_required && !order.advance_confirmed ? Number(order.advance_amount || 0) : Number(order.total_amount || 0);
    const detectedAmount = Number(a.detectedAmount || 0) || undefined;
    const amountMatch = Boolean(a.amountMatch && detectedAmount && expected > 0 && Math.abs(detectedAmount - expected) <= 1);
    const accountMatch = Boolean(a.accountMatch);
    const receiptLike = Boolean(a.receiptLike);
    const autoPassed = Boolean(receiptLike && accountMatch && amountMatch);
    const now = new Date().toISOString();

    const updated = {
      ...order,
      payment_method: 'Bank Payment',
      payment_status: 'Pending',
      payment_verification_status: autoPassed ? 'Auto Check Passed' : 'Needs Review',
      bank_receipt_url: receiptUrl,
      payment_detected_bank: String(a.detectedBank || '').slice(0,100) || undefined,
      payment_detected_amount: detectedAmount,
      payment_reference: String(a.detectedReference || '').slice(0,120) || undefined,
      payment_account_match: accountMatch,
      payment_amount_match: amountMatch,
      payment_receipt_like: receiptLike,
      payment_ocr_confidence: Math.max(0, Math.min(100, Number(a.confidence || 0))),
      payment_check_notes: `${String(a.notes || 'Receipt submitted from O-RA Assistant. Local OCR may be unavailable.').slice(0,600)} Final approval requires an admin to confirm the bank credit.`,
      order_status: 'Pending Payment',
      payment_reviewed_by: undefined,
      payment_reviewed_at: undefined,
      assistant_payment_submitted_at: now,
    };
    await saveOrderSnapshot(updated);
    return res.json({ok:true, status:updated.payment_verification_status, order:assistantSafeOrder(updated)});
  } catch (e:any) { return res.status(500).json({error:e?.message || 'Payment proof could not be saved.'}); }
});

const callGroqAssistant = async (prompt: string) => {
  const key = String(process.env.GROQ_API_KEY || '').trim();
  if (!key) return '';
  const model = String(process.env.GROQ_MODEL || 'openai/gpt-oss-20b').trim();
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role:'system', content:'You are O-RA Store customer support. Follow the supplied store-only rules exactly.' },
        { role:'user', content:prompt },
      ],
      temperature: 0.25,
      max_completion_tokens: 320,
    }),
  });
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
  const data:any = await response.json();
  return String(data?.choices?.[0]?.message?.content || '').trim();
};

app.post('/api/assistant/chat', async (req,res) => {
  if (!allowPublicSubmission(req, 'assistant-chat', 80, 60 * 60 * 1000)) return res.status(429).json({error:'Assistant request limit reached. Basic Support is still available.'});
  const rawMessage = String(req.body?.message || '').trim();
  if (!rawMessage) return res.status(400).json({error:'Message is required.'});
  const language = req.body?.language === 'si' || req.body?.language === 'ta' ? req.body.language : 'en';
  const ctx = req.body?.publicContext && typeof req.body.publicContext === 'object' ? req.body.publicContext : {};
  const products = Array.isArray(ctx.matchedProducts) ? ctx.matchedProducts.slice(0,10) : [];
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6).map((m:any)=>({role:m?.role === 'assistant' ? 'assistant' : 'user', text:assistantRedact(m?.text)})) : [];
  const safeMessage = assistantRedact(rawMessage);

  const selectedLanguageName = language === 'si' ? 'Sinhala' : language === 'ta' ? 'Tamil' : 'English';
  const prompt = `O-RA STORE CUSTOMER SUPPORT RULES\n- The customer selected ${selectedLanguageName}. Reply ONLY in ${selectedLanguageName}, even if the customer types another language. Keep product names, SKUs, order IDs and standard payment labels unchanged when needed.\n- Only discuss O-RA products, ordering, cart, payment methods, delivery, returns, reviews, product requests and safe customer order support.\n- Never reveal admin data, buying prices, supplier/source-shop notes, profit, Google Sheet data, other customers' data, API keys or system internals.\n- Never claim a bank payment is approved. Payment approval is always performed by an admin after checking the bank account.\n- If the user says they paid, tell them to use the Payment Done flow in O-RA Assistant and upload the receipt.\n- If the user asks for order-specific status, tell them to use Track Order; do not invent an order status.\n- Do not help locate, buy or use restricted/dangerous items.\n- Do not invent price or stock. Use only MATCHED PUBLIC PRODUCTS below.\n- Keep answers concise (normally 2-5 sentences).\n- If the customer asks something that cannot be answered confidently from these rules/public data, return exactly __NEEDS_AGENT__ and nothing else. Do not guess.\n\nPUBLIC STORE INFO\nStore: ${assistantRedact(ctx.storeName || 'O-RA')}\nFree delivery: ${Boolean(ctx.freeDelivery)}\nDelivery fee when applicable: Rs. ${Number(ctx.deliveryFee || 0)}\nAdvance rule: ${Number(ctx.advancePercentage || 50)}% when quantity rule applies above ${Number(ctx.advanceQtyThreshold || 4)} items\nBank transfer available: ${Boolean(ctx.bankTransferAvailable)}\nMatched public products: ${JSON.stringify(products).slice(0,5000)}\n\nRecent chat: ${JSON.stringify(history).slice(0,3500)}\nCustomer: ${safeMessage}`;

  let provider = 'basic';
  let reply = '';
  const ai = getGeminiClient();
  if (ai) {
    try {
      const model = String(process.env.GEMINI_ASSISTANT_MODEL || 'gemini-3.6-flash').trim();
      const response:any = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { temperature: 0.25, maxOutputTokens: 320 },
      });
      reply = String(response?.text || response?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text || '').join('') || '').trim();
      if (reply) provider = 'gemini';
    } catch (e:any) {
      console.warn('O-RA Assistant Gemini fallback:', e?.message || e);
    }
  }
  if (!reply) {
    try {
      reply = await callGroqAssistant(prompt);
      if (reply) provider = 'groq';
    } catch (e:any) {
      console.warn('O-RA Assistant Groq fallback:', e?.message || e);
    }
  }
  let needsAgent = false;
  if (reply && /__NEEDS_AGENT__/i.test(reply)) {
    reply = '';
    needsAgent = true;
  }
  if (!reply && !needsAgent) {
    const basicKnown = /(weapon|gun|firearm|ammo|ammunition|knife|blade|taser|pepper\s*spray|payment|bank|cod|advance|à¶œà·™à·€|à¶¸à·”à¶¯à¶½à·Š|à®•à®Ÿà¯à®Ÿà®£à®®à¯|à®ªà®£à®®à¯|delivery|shipping|courier|à¶©à·’à¶½à·’à·€à¶»à·’|à¶¶à·™à¶¯à·à·„à·à¶»|à®Ÿà¯†à®²à®¿à®µà®°à®¿|à®µà®¿à®¨à®¿à®¯à¯‹à®•à®®à¯)/i.test(rawMessage);
    if (basicKnown) reply = assistantBasicReply(rawMessage, language);
    else needsAgent = true;
  }
  return res.json({ok:true, reply, provider, needsAgent});
});

// API Endpoint: Verify Bank Transfer Receipt / Slip using Gemini Vision
app.post("/api/verify-slip", async (req, res) => {
  try {
    const { imageBase64, expectedAmount, expectedAccountNumber } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        isValid: false,
        rejectionReason: "No image data provided. (à¶»à·–à¶´ à¶»à·à¶¸à·”à·€à¶šà·Š à·ƒà¶´à¶ºà· à¶±à·œà¶¸à·à¶­)",
      });
    }

    // Extract base64 mime and pure data
    const matches = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    let mimeType = "image/png";
    let pureBase64 = imageBase64;

    if (matches && matches.length === 3) {
      mimeType = matches[1];
      pureBase64 = matches[2];
    }

    const ai = getGeminiClient();

    if (!ai) {
      // Fallback response if GEMINI_API_KEY is not configured
      return res.json({
        isValid: false,
        needsReview: true,
        autoCheckPassed: false,
        detectedBank: null,
        detectedAmount: null,
        detectedRef: null,
        confidenceScore: 0,
        rejectionReason: "Automatic receipt analysis is unavailable because GEMINI_API_KEY is not configured. Save the receipt for manual admin review.",
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: pureBase64,
            },
          },
          {
            text: `Analyze this image strictly as a Bank Payment Transfer Receipt, Deposit Slip, or Mobile Banking Confirmation screenshot in Sri Lanka.
            Determine if it is a genuine bank transfer receipt/slip or an invalid/unrelated photo (such as a random object, document, fake non-payment bill, or non-banking screenshot).

            Return a valid JSON object matching the requested schema.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isValid: {
              type: Type.BOOLEAN,
              description: "True if image is a valid bank transfer receipt or slip, false if invalid or non-receipt image.",
            },
            confidenceScore: {
              type: Type.NUMBER,
              description: "Confidence score between 0 and 100.",
            },
            detectedBank: {
              type: Type.STRING,
              description: "Name of detected bank or payment app e.g. Commercial Bank, BOC, Sampath, HNB, Frimi, EZ Cash, or null.",
            },
            detectedAmount: {
              type: Type.NUMBER,
              description: "Detected transferred amount as a number in LKR, without currency symbols, or null.",
            },
            detectedRef: {
              type: Type.STRING,
              description: "Detected reference or transaction number or null.",
            },
            destinationAccount: {
              type: Type.STRING,
              description: "Destination or credited account number visible on receipt, if present.",
            },
            rejectionReason: {
              type: Type.STRING,
              description: "If isValid is false, explain why in clear Sinhala and English.",
            },
          },
          required: ["isValid", "rejectionReason"],
        },
      },
    });

    const resultText = response.text ? response.text.trim() : "";
    if (!resultText) {
      return res.status(500).json({
        isValid: false,
        rejectionReason: "Could not read image content. Please re-upload a clear image.",
      });
    }

    const parsedResult = JSON.parse(resultText);
    const amount = typeof parsedResult.detectedAmount === 'number' ? parsedResult.detectedAmount : Number(String(parsedResult.detectedAmount || '').replace(/[^0-9.]/g, ''));
    const expected = Number(expectedAmount || 0);
    const amountMatches = expected > 0 && Number.isFinite(amount) ? amount + 0.01 >= expected : false;
    const normalize = (v: unknown) => String(v || '').replace(/\D/g, '');
    const expectedAcc = normalize(expectedAccountNumber);
    const detectedAcc = normalize(parsedResult.destinationAccount);
    const accountMatches = expectedAcc && detectedAcc ? (detectedAcc.endsWith(expectedAcc.slice(-6)) || expectedAcc.endsWith(detectedAcc.slice(-6))) : null;
    const hasReference = Boolean(String(parsedResult.detectedRef || '').trim());
    const autoCheckPassed = Boolean(parsedResult.isValid && amountMatches && hasReference && accountMatches !== false);
    return res.json({
      ...parsedResult,
      detectedAmount: Number.isFinite(amount) ? amount : null,
      amountMatches,
      accountMatches,
      hasReference,
      autoCheckPassed,
      needsReview: !autoCheckPassed,
      expectedAmount: expected,
    });
  } catch (err: any) {
    console.error("Error verifying payment slip:", err);
    return res.status(500).json({
      isValid: false,
      rejectionReason: "Failed to analyze receipt image. Please ensure image is clear and try again.",
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`O-RA Store Server running on http://0.0.0.0:${PORT}`);
  });
}
if (!isLiveServerlessRuntime) {
  startServer();
}

export default app;
