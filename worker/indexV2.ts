import baseWorker from './indexBase';

type R2LikeBucket = {
  put: (key: string, value: ArrayBuffer | ArrayBufferView, options?: any) => Promise<any>;
  get: (key: string) => Promise<any>;
};

type WorkersAiLike = {
  run: (model: string, input: Record<string, any>) => Promise<any>;
};

type SheetRuntime = { supabaseUrl: string; supabaseKey: string; webhook: string };

const nativeFetch = globalThis.fetch.bind(globalThis);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const jsonResponseLike = (data: unknown, original: Response) => new Response(JSON.stringify(data), {
  status: original.status,
  statusText: original.statusText,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const parseJsonResponse = async (response: Response) => {
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { text, data };
};

// -----------------------------------------------------------------------------
// R2 public-media layer. If the binding is unavailable the existing server path
// remains the fallback, so storage configuration can never break live uploads.
// -----------------------------------------------------------------------------
const mediaBucket = (envValue: unknown): R2LikeBucket | null => {
  const env = (envValue || {}) as Record<string, any>;
  const bucket = env.ORA_MEDIA_R2;
  return bucket && typeof bucket.put === 'function' && typeof bucket.get === 'function' ? bucket : null;
};

const safeMediaPurpose = (value: unknown) =>
  String(value || 'public').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'public';

const r2MediaHandler = async (request: Request, envValue: unknown): Promise<Response | null> => {
  const bucket = mediaBucket(envValue);
  if (!bucket) return null;
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname.startsWith('/api/media/')) {
    const rawKey = url.pathname.slice('/api/media/'.length);
    const key = rawKey.split('/').map(part => decodeURIComponent(part)).join('/');
    if (!key || key.includes('..')) return new Response('Not found', { status: 404 });
    const object = await bucket.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    try { object.writeHttpMetadata?.(headers); } catch {}
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=31536000, immutable');
    if (object.httpEtag) headers.set('etag', object.httpEtag);
    headers.set('x-ora-storage', 'r2');
    return new Response(object.body, { headers });
  }

  if (request.method !== 'POST' || url.pathname !== '/api/uploads/image') return null;
  let body: any = {};
  try { body = await request.clone().json(); } catch { return json({ error: 'Invalid image upload payload.' }, 400); }
  const purpose = safeMediaPurpose(body?.purpose);
  const dataUrl = String(body?.dataUrl || '');
  const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return json({ error: 'Invalid image payload.' }, 400);
  const extRaw = match[1].toLowerCase();
  const ext = extRaw === 'jpg' ? 'jpeg' : extRaw;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 750_000) return json({ error: 'Compressed image must be under 750 KB.' }, 400);

  const now = new Date();
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const fileExt = ext === 'jpeg' ? 'jpg' : ext;
  const key = `media/${purpose}/${y}/${m}/${d}/${Date.now()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${fileExt}`;
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: `image/${ext}`, cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { purpose, uploadedAt: now.toISOString(), oraArchiveEligibleAfterDays: '21' },
  });
  return json({ ok: true, url: `/api/media/${key}`, storage: 'r2', key });
};

// -----------------------------------------------------------------------------
// Sinhala translation fallback. The base server still performs the existing
// staff authorization. We only take over after an authenticated server/provider
// failure (for example no GEMINI_API_KEY).
// -----------------------------------------------------------------------------
const GENERIC_PRODUCT_WORDS = new Set([
  'item','items','product','products','toilet','cleaner','cleaning','bathroom','floor','wash','liquid','soap','shampoo','cream','lotion','gel','spray','powder','bottle','water','kids','kid','baby','adult','men','women','set','pack','piece','pieces','pcs','large','small','mini','premium','new','original','home','kitchen','car','phone','mobile','speaker','bluetooth','wireless','charger','cable','bag','shoe','shoes','watch','toy','toys','brush','mop','holder','rack','box','container'
]);

const likelyBrandTokens = (source: string) => {
  const words = source.match(/[A-Za-z][A-Za-z0-9+.-]*/g) || [];
  return words.filter((word) => {
    const low = word.toLowerCase();
    if (GENERIC_PRODUCT_WORDS.has(low)) return false;
    if (/^\d/.test(word)) return true;
    if (/[0-9]/.test(word) || /[A-Z].*[A-Z]/.test(word.slice(1))) return true;
    return word.length >= 4;
  }).slice(0, 5);
};

const translationLooksSafe = (source: string, translated: string) => {
  if (!translated.trim()) return false;
  for (const token of likelyBrandTokens(source)) {
    if (!translated.toLowerCase().includes(token.toLowerCase())) return false;
  }
  return true;
};

const parseTranslations = (raw: string, count: number) => {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    const values = Array.isArray(parsed?.translations) ? parsed.translations.map((v:any) => String(v || '').trim()) : [];
    return values.length === count ? values : [];
  } catch { return []; }
};

const workersAiTranslate = async (ai: WorkersAiLike, texts: string[], strictRetry = false) => {
  const numbered = texts.map((value, index) => `${index + 1}. ${JSON.stringify(value)}`).join('\n');
  const result = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      {
        role: 'system',
        content: `You translate e-commerce product names and descriptions from English to natural Sinhala used by Sri Lankan customers.\n\nNON-NEGOTIABLE RULES:\n- NEVER translate, invent, alter or replace brand names, model names, SKUs, sizes, units or technical abbreviations. Keep those exact Latin tokens unchanged.\n- Example: "Harpic" -> "Harpic".\n- Example: "Harpic Toilet Cleaner" -> "Harpic වැසිකිළි පිරිසිදුකාරකය".\n- Example: "Dettol Antiseptic Liquid" must keep "Dettol" unchanged.\n- Translate only the descriptive/generic product words into clear everyday Sinhala.\n- Do not create poetic, religious, family, ceremonial or unrelated Sinhala words.\n- Descriptions must preserve the exact meaning and must not add claims or features.\n- Keep one output per input, same order.\n- Return ONLY JSON: {"translations":["..."]}.\n${strictRetry ? '- A previous answer failed brand-preservation validation. Be especially literal and conservative.' : ''}`,
      },
      { role: 'user', content: `Translate these ${texts.length} e-commerce texts:\n${numbered}` },
    ],
    temperature: 0.05,
    max_tokens: 1800,
  });
  const raw = String(result?.response ?? result?.result?.response ?? result?.text ?? '').trim();
  return parseTranslations(raw, texts.length);
};

const workersAiSinhalaFallback = async (request: Request, envValue: unknown, originalResponse: Response): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/translate-sinhala' || originalResponse.status < 500) return originalResponse;
  const env = (envValue || {}) as Record<string, any>;
  const ai = env.AI as WorkersAiLike | undefined;
  if (!ai || typeof ai.run !== 'function') return originalResponse;

  let payload: any = {};
  try { payload = await request.clone().json(); } catch { return originalResponse; }
  const texts = Array.isArray(payload?.texts) ? payload.texts.map((v:any) => String(v || '').trim()).slice(0, 12) : [];
  if (!texts.length || texts.every((v:string) => !v) || texts.some((v:string) => v.length > 2500)) return originalResponse;

  // A single brand/model token should never be hallucinated into unrelated Sinhala.
  const direct = texts.map((source:string) => {
    const words = source.match(/[A-Za-z][A-Za-z0-9+.-]*/g) || [];
    return words.length === 1 && likelyBrandTokens(source).length === 1 ? source : '';
  });
  const pendingIndexes = direct.map((v,i) => v ? -1 : i).filter(i => i >= 0);
  if (!pendingIndexes.length) return json({ translations: direct, provider: 'cloudflare-workers-ai-safe-brand' });

  try {
    const pendingTexts = pendingIndexes.map(i => texts[i]);
    let translated = await workersAiTranslate(ai, pendingTexts, false);
    let safe = translated.length === pendingTexts.length && translated.every((value, i) => translationLooksSafe(pendingTexts[i], value));
    if (!safe) {
      translated = await workersAiTranslate(ai, pendingTexts, true);
      safe = translated.length === pendingTexts.length && translated.every((value, i) => translationLooksSafe(pendingTexts[i], value));
    }
    if (!safe) {
      // Never write nonsense Sinhala. If AI cannot safely preserve a brand/model,
      // retain the English source so the admin can edit manually instead.
      translated = pendingTexts.map((source, i) => translationLooksSafe(source, translated[i] || '') ? translated[i] : source);
    }
    const final = [...direct];
    pendingIndexes.forEach((originalIndex, i) => { final[originalIndex] = translated[i] || texts[originalIndex]; });
    return json({ translations: final, provider: 'cloudflare-workers-ai-70b-safe' });
  } catch (error) {
    console.warn('Cloudflare Workers AI Sinhala fallback failed:', error);
    return originalResponse;
  }
};

// -----------------------------------------------------------------------------
// Fast FB/TikTok batch Sheet fallback. The primary server path already sends one
// batch. If it reports a Sheet failure, retry the WHOLE returned batch once/twice
// instead of the old per-order read/write loop. This is much faster and the Apps
// Script bulk writer itself uses one setValues() block per source.
// -----------------------------------------------------------------------------
const getSheetRuntime = async (envValue: unknown): Promise<SheetRuntime> => {
  const env = (envValue || {}) as Record<string, string | undefined>;
  const supabaseUrl = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase server configuration is missing.');
  const response = await nativeFetch(`${supabaseUrl}/rest/v1/admin_data_store?key=eq.storefront-state-v1&select=payload`, {
    headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}`, accept: 'application/json' },
  });
  const rows:any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read shared Store Settings (${response.status}).`);
  const webhook = String(rows?.[0]?.payload?.settings?.google_sheet_webhook_url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook)) throw new Error('Shared Google Sheet Web App URL is missing or invalid.');
  return { supabaseUrl, supabaseKey, webhook };
};

const postAppsScript = async (webhook: string, payload: Record<string, any>) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await nativeFetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8', accept: 'application/json,text/plain,*/*' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    const { text, data } = await parseJsonResponse(response);
    if (!response.ok) throw new Error(`Google Apps Script HTTP ${response.status}: ${text.slice(0, 200)}`);
    if (!text || !Object.keys(data || {}).length) throw new Error('Google Apps Script returned an empty/non-JSON response.');
    if (data?.ok === false || String(data?.status || '').toLowerCase() === 'error') throw new Error(data?.message || data?.error || 'Google Apps Script returned an error.');
    return data;
  } finally { clearTimeout(timer); }
};

const expectedRows = (orders:any[]) => orders.reduce((sum, order) => sum + Math.max(1, Array.isArray(order?.items) ? order.items.length : 1), 0);

const markOrdersSyncedBatch = async (runtime: SheetRuntime, orders:any[]) => {
  if (!orders.length) return;
  const now = new Date().toISOString();
  const rows = orders.map((order:any) => ({
    order_id: String(order.id),
    payload: { ...order, is_synced_google_sheets:true, synced_at:now, sheet_sync_verified_at:now },
    updated_at: now,
  }));
  const response = await nativeFetch(`${runtime.supabaseUrl}/rest/v1/order_snapshots?on_conflict=order_id`, {
    method:'POST',
    headers:{
      apikey:runtime.supabaseKey,
      authorization:`Bearer ${runtime.supabaseKey}`,
      'content-type':'application/json',
      prefer:'resolution=merge-duplicates,return=minimal',
    },
    body:JSON.stringify(rows),
  });
  if (!response.ok) console.warn('Could not batch-mark Sheet sync state:', response.status);
};

const fastBulkSheetFallback = async (request: Request, env: unknown, response: Response): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/orders/bulk-import' || !response.ok) return response;
  let data:any = {};
  try { data = await response.clone().json(); } catch { return response; }
  const orders:any[] = Array.isArray(data?.orders) ? data.orders : [];
  if (!orders.length || data?.sheet_sync?.ok === true) return response;

  try {
    const runtime = await getSheetRuntime(env);
    const needRows = expectedRows(orders);
    let result:any = null;
    let lastError:any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await postAppsScript(runtime.webhook, { action:'sync_orders', orders });
        const synced = Number(result?.synced || 0);
        const rows = Number(result?.rows || 0);
        if (String(result?.status || '') === 'orders_synced' && synced >= orders.length && rows >= needRows) break;
        throw new Error(`Batch Sheet count mismatch: expected ${orders.length} orders/${needRows} rows, got ${synced}/${rows}.`);
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    if (!result || String(result?.status || '') !== 'orders_synced' || Number(result?.synced || 0) < orders.length || Number(result?.rows || 0) < needRows) throw lastError || new Error('Google Sheet batch retry failed.');
    await markOrdersSyncedBatch(runtime, orders);
    const now = new Date().toISOString();
    const syncedOrders = orders.map((order:any) => ({ ...order, is_synced_google_sheets:true, synced_at:now, sheet_sync_verified_at:now }));
    return jsonResponseLike({
      ...data,
      orders:syncedOrders,
      sheet_sync:{
        ok:true,
        confirmed:true,
        status:'orders_synced',
        synced:Number(result.synced || orders.length),
        rows:Number(result.rows || needRows),
        existing:Number(result.existing || 0),
        duplicate_leads:Number(result.duplicate_leads || 0),
        path:'clean-v1-worker-fast-batch-retry',
      },
    }, response);
  } catch (error:any) {
    return jsonResponseLike({
      ...data,
      sheet_sync:{
        ...(data?.sheet_sync || {}),
        ok:false,
        confirmed:false,
        error:String(error?.message || error || 'Fast bulk Sheet retry failed.'),
        path:'clean-v1-worker-fast-batch-retry',
      },
    }, response);
  }
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const mediaResponse = await r2MediaHandler(request, env);
    if (mediaResponse) return mediaResponse;

    // Clone once before baseWorker consumes the body. The clones are used only
    // for post-response translation/bulk handling.
    const translationRequest = request.clone();
    const bulkRequest = request.clone();
    const response = await baseWorker.fetch(request, env, ctx);
    const translated = await workersAiSinhalaFallback(translationRequest, env, response);
    if (translated !== response) return translated;
    return fastBulkSheetFallback(bulkRequest, env, response);
  },
};
