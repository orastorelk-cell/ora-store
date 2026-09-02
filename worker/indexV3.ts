import fastWorker from './indexV2';
import { facebookLeadAutoHandler } from './facebookLeadAuto';

type WorkersAiLike = { run: (model: string, input: Record<string, any>) => Promise<any> };
type R2UsageBucket = {
  list: (options?: { limit?: number; cursor?: string }) => Promise<{
    objects?: Array<{ size?: number }>;
    truncated?: boolean;
    cursor?: string;
  }>;
};

const SINHALA_RE = /[\u0D80-\u0DFF]/;
const KNOWN_BRANDS = new Set([
  'harpic','dettol','dove','lux','nivea','vaseline','colgate','pepsodent','lifebuoy','sunlight','vim','comfort','surf','signal',
  'samsung','xiaomi','huawei','apple','sony','philips','panasonic','anker','baseus','ugreen','ora','o-ra'
]);
const GENERIC_NAME_WORDS = new Set([
  'toilet','cleaner','cleaning','bathroom','floor','wash','liquid','soap','shampoo','cream','lotion','gel','spray','powder','bottle','water',
  'kids','kid','baby','adult','men','women','set','pack','piece','pieces','pcs','large','small','mini','premium','new','original','home','kitchen',
  'car','phone','mobile','speaker','bluetooth','wireless','charger','cable','bag','shoe','shoes','watch','toy','toys','brush','mop','holder','rack',
  'box','container','portable','smart','electric','rechargeable','multi','purpose','stainless','steel','plastic','wooden','digital','automatic','item','product'
]);

const words = (value:string) => value.match(/[A-Za-z][A-Za-z0-9+.-]*/g) || [];
const protectedTokens = (source:string) => {
  const ws = words(source);
  const out:string[] = [];
  for (let i=0;i<ws.length;i++) {
    const token = ws[i];
    const low = token.toLowerCase();
    if (KNOWN_BRANDS.has(low) || /\d/.test(token) || /^[A-Z0-9]{2,}$/.test(token)) out.push(token);
  }
  // For short product names, an unknown first title word is usually the brand.
  if (ws.length > 1 && ws.length <= 8) {
    const first = ws[0];
    if (!GENERIC_NAME_WORDS.has(first.toLowerCase()) && /^[A-Z]/.test(first) && !out.some(x=>x.toLowerCase()===first.toLowerCase())) out.unshift(first);
  }
  return out.slice(0,6);
};

const needsRepair = (source:string, translated:string) => {
  const src = source.trim();
  const tr = translated.trim();
  if (!src) return false;
  const ws = words(src);
  if (ws.length === 1 && protectedTokens(src).length) return tr.toLowerCase() !== src.toLowerCase();
  if (!tr) return true;
  if (ws.length > 1 && !SINHALA_RE.test(tr)) return true;
  if (ws.length > 1 && tr.toLowerCase() === src.toLowerCase()) return true;
  for (const token of protectedTokens(src)) if (!tr.toLowerCase().includes(token.toLowerCase())) return true;
  return false;
};

const parseJson = (raw:string, count:number) => {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const list = Array.isArray(parsed?.translations) ? parsed.translations.map((v:any)=>String(v||'').trim()) : [];
    return list.length === count ? list : [];
  } catch { return []; }
};

const repairTranslations = async (ai:WorkersAiLike, sources:string[]) => {
  const result = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages:[
      {role:'system',content:`Translate English e-commerce text into natural, everyday Sinhala for Sri Lankan shoppers.\nRULES:\n1. Brand/model/SKU/technical tokens must remain EXACTLY in English. Never translate or invent a Sinhala version of a brand.\n2. "Harpic" -> "Harpic".\n3. "Harpic Toilet Cleaner" -> "Harpic වැසිකිළි පිරිසිදුකාරකය".\n4. "Dettol Antiseptic Liquid" must keep Dettol exactly.\n5. Generic product words should be translated naturally, not word-for-word nonsense.\n6. Descriptions must keep the original meaning only; do not invent features or claims.\n7. Never output unrelated words about family, religion, ceremonies, people or places.\n8. Return ONLY JSON exactly like {"translations":["..."]}.`},
      {role:'user',content:sources.map((s,i)=>`${i+1}. ${JSON.stringify(s)}`).join('\n')}
    ],
    temperature:0,
    max_tokens:1800,
  });
  return parseJson(String(result?.response ?? result?.result?.response ?? result?.text ?? '').trim(), sources.length);
};

const storageJson = (data:unknown, status=200) => new Response(JSON.stringify(data), {
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
});

const verifyStorageAdmin = async (request:Request, envValue:unknown) => {
  const env = (envValue || {}) as Record<string, any>;
  const token = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  try {
    const secret = String(env.STAFF_SESSION_SECRET || env.ABUSE_HASH_SALT || 'ora-local-staff-session-change-in-production');
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name:'HMAC', hash:'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      key,
      Buffer.from(signature, 'base64url'),
      new TextEncoder().encode(payload),
    );
    if (!valid) return null;

    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?:string; role?:string; exp?:number };
    if (!session?.sub || Number(session.exp || 0) < Date.now()) return null;

    const supabaseUrl = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const supabaseKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseUrl || !supabaseKey) return null;
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/admin_users?id=eq.${encodeURIComponent(session.sub)}&is_active=eq.true&select=id,role&limit=1`,
      { headers:{ apikey:supabaseKey, authorization:`Bearer ${supabaseKey}`, accept:'application/json' } },
    );
    const users:any[] = await userResponse.json().catch(()=>[]);
    if (!userResponse.ok || users?.[0]?.role !== 'admin') return null;
    return { supabaseUrl, supabaseKey };
  } catch {
    return null;
  }
};

const readR2Usage = async (bucket:R2UsageBucket) => {
  let usedBytes = 0;
  let objectCount = 0;
  let cursor:string|undefined;
  for (let page=0; page<200; page+=1) {
    const result = await bucket.list({ limit:1000, ...(cursor ? { cursor } : {}) });
    const objects = Array.isArray(result?.objects) ? result.objects : [];
    objectCount += objects.length;
    for (const object of objects) usedBytes += Math.max(0, Number(object?.size || 0));
    if (!result?.truncated || !result?.cursor) break;
    cursor = result.cursor;
  }
  return { usedBytes, objectCount };
};

const storageUsageHandler = async (request:Request, envValue:unknown):Promise<Response|null> => {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/admin/storage-usage') return null;
  const runtime = await verifyStorageAdmin(request, envValue);
  if (!runtime) return storageJson({ ok:false, error:'Super Admin login required.' }, 401);

  const env = (envValue || {}) as Record<string, any>;
  const r2Bucket = env.ORA_MEDIA_R2 as R2UsageBucket | undefined;
  if (!r2Bucket || typeof r2Bucket.list !== 'function') return storageJson({ ok:false, error:'Cloudflare R2 storage binding is unavailable.' }, 503);

  try {
    const [r2, supabaseResponse] = await Promise.all([
      readR2Usage(r2Bucket),
      fetch(`${runtime.supabaseUrl}/rest/v1/rpc/ora_storage_usage_by_bucket`, {
        method:'POST',
        headers:{
          apikey:runtime.supabaseKey,
          authorization:`Bearer ${runtime.supabaseKey}`,
          'content-type':'application/json',
          accept:'application/json',
        },
        body:'{}',
      }),
    ]);
    const supabaseRows:any[] = await supabaseResponse.json().catch(()=>[]);
    if (!supabaseResponse.ok) throw new Error('Supabase Storage usage could not be read.');
    const supabaseUsed = supabaseRows.reduce((sum,row)=>sum + Math.max(0,Number(row?.total_bytes || 0)),0);
    const supabaseCount = supabaseRows.reduce((sum,row)=>sum + Math.max(0,Number(row?.object_count || 0)),0);

    const r2FreeLimit = 10 * 1024 * 1024 * 1024;
    const supabaseFreeLimit = 1 * 1024 * 1024 * 1024;
    return storageJson({
      ok:true,
      updated_at:new Date().toISOString(),
      storages:[
        {
          id:'cloudflare-r2',
          name:'Cloudflare R2',
          provider:'Cloudflare',
          bucket:'ora-store-images',
          used_bytes:r2.usedBytes,
          object_count:r2.objectCount,
          free_limit_bytes:r2FreeLimit,
          remaining_free_bytes:Math.max(0,r2FreeLimit-r2.usedBytes),
        },
        {
          id:'supabase-storage',
          name:'Supabase Storage',
          provider:'Supabase',
          bucket:supabaseRows.length === 1 ? String(supabaseRows[0]?.bucket_name || 'ora-public-media') : `${supabaseRows.length} bucket(s)`,
          used_bytes:supabaseUsed,
          object_count:supabaseCount,
          free_limit_bytes:supabaseFreeLimit,
          remaining_free_bytes:Math.max(0,supabaseFreeLimit-supabaseUsed),
        },
      ],
    });
  } catch (error:any) {
    return storageJson({ ok:false, error:String(error?.message || 'Storage usage could not be read.') }, 500);
  }
};

export default {
  async fetch(request:Request, env:unknown, ctx:unknown) {
    const leadResponse = await facebookLeadAutoHandler(request, env, ctx, fastWorker);
    if (leadResponse) return leadResponse;

    const storageResponse = await storageUsageHandler(request, env);
    if (storageResponse) return storageResponse;

    const url = new URL(request.url);
    const requestCopy = request.clone();
    const response = await fastWorker.fetch(request, env, ctx);
    if (requestCopy.method !== 'POST' || url.pathname !== '/api/admin/translate-sinhala' || !response.ok) return response;

    let payload:any = {}, data:any = {};
    try { payload = await requestCopy.json(); data = await response.clone().json(); } catch { return response; }
    const sources = Array.isArray(payload?.texts) ? payload.texts.map((v:any)=>String(v||'').trim()) : [];
    const translations = Array.isArray(data?.translations) ? data.translations.map((v:any)=>String(v||'').trim()) : [];
    if (!sources.length || sources.length !== translations.length) return response;

    const badIndexes = sources.map((s:string,i:number)=>needsRepair(s,translations[i])?i:-1).filter((i:number)=>i>=0);
    if (!badIndexes.length) return response;

    const ai = (env as any)?.AI as WorkersAiLike | undefined;
    if (!ai || typeof ai.run !== 'function') return response;
    try {
      const repairSources = badIndexes.map((i:number)=>sources[i]);
      const repaired = await repairTranslations(ai, repairSources);
      if (repaired.length !== repairSources.length) return response;
      const final = [...translations];
      badIndexes.forEach((originalIndex:number,i:number)=>{
        const source = sources[originalIndex];
        const candidate = repaired[i] || '';
        if (!needsRepair(source,candidate)) final[originalIndex]=candidate;
        else if (words(source).length === 1 && protectedTokens(source).length) final[originalIndex]=source;
      });
      return new Response(JSON.stringify({...data,translations:final,provider:'cloudflare-workers-ai-70b-quality-gated'}),{
        status:200,
        headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
      });
    } catch (error) {
      console.warn('Sinhala quality repair failed:', error);
      return response;
    }
  }
};
