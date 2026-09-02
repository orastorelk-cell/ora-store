import baseWorker from './indexBase';
import { facebookLeadAutoHandler } from './facebookLeadAuto';

// Final safety net for FB/TikTok bulk imports.
// The normal worker/server path remains the primary path. Only when that path
// reports an unconfirmed/partial Sheet sync do we verify and repair each returned
// durable order individually. This prevents a batch from silently leaving only
// the first lead visible in Google Sheets while avoiding duplicate writes when
// the normal batch already succeeded.

type SheetRuntime = {
  supabaseUrl: string;
  supabaseKey: string;
  webhook: string;
};

type R2LikeBucket = {
  put: (key: string, value: ArrayBuffer | ArrayBufferView, options?: any) => Promise<any>;
  get: (key: string) => Promise<any>;
};

type WorkersAiLike = {
  run: (model: string, input: Record<string, any>) => Promise<any>;
};

const nativeFetch = globalThis.fetch.bind(globalThis);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const jsonResponseLike = (data: unknown, original: Response) => new Response(JSON.stringify(data), {
  status: original.status,
  statusText: original.statusText,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const parseJsonResponse = async (response: Response) => {
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { text, data };
};

// -----------------------------------------------------------------------------
// Optional Cloudflare R2 media layer.
//
// Safe deployment rule: if ORA_MEDIA_R2 is not bound, nothing changes and the
// existing Express/Supabase upload path handles the request. Once the binding is
// attached to an existing R2 bucket, new compressed public images are written to
// R2 and served through this Worker under /api/media/*.
// -----------------------------------------------------------------------------
const mediaBucket = (envValue: unknown): R2LikeBucket | null => {
  const env = (envValue || {}) as Record<string, any>;
  const bucket = env.ORA_MEDIA_R2;
  return bucket && typeof bucket.put === 'function' && typeof bucket.get === 'function' ? bucket as R2LikeBucket : null;
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
  try { body = await request.clone().json(); }
  catch { return json({ error: 'Invalid image upload payload.' }, 400); }

  const purpose = safeMediaPurpose(body?.purpose);
  const dataUrl = String(body?.dataUrl || '');
  const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return json({ error: 'Invalid image payload.' }, 400);

  const extRaw = match[1].toLowerCase();
  const ext = extRaw === 'jpg' ? 'jpeg' : extRaw;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 750_000) {
    return json({ error: 'Compressed image must be under 750 KB.' }, 400);
  }

  const now = new Date();
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const fileExt = ext === 'jpeg' ? 'jpg' : ext;
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const key = `media/${purpose}/${y}/${m}/${d}/${Date.now()}-${token}.${fileExt}`;
  const contentType = `image/${ext}`;

  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      purpose,
      uploadedAt: now.toISOString(),
      oraArchiveEligibleAfterDays: '21',
    },
  });

  return json({
    ok: true,
    url: `/api/media/${key}`,
    storage: 'r2',
    key,
  });
};

// -----------------------------------------------------------------------------
// Sinhala translation fallback.
//
// The Express route keeps the existing staff permission/auth checks and tries
// Gemini first. Only if that already-authorized route returns a server/provider
// error do we use the Cloudflare Workers AI binding. This avoids exposing a new
// unauthenticated AI endpoint while removing the hard GEMINI_API_KEY dependency.
// -----------------------------------------------------------------------------
const workersAiSinhalaFallback = async (
  request: Request,
  envValue: unknown,
  originalResponse: Response,
): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/translate-sinhala') return originalResponse;
  if (originalResponse.status < 500) return originalResponse;

  const env = (envValue || {}) as Record<string, any>;
  const ai = env.AI as WorkersAiLike | undefined;
  if (!ai || typeof ai.run !== 'function') return originalResponse;

  let payload: any = {};
  try { payload = await request.json(); } catch { return originalResponse; }
  const texts = Array.isArray(payload?.texts)
    ? payload.texts.map((value: any) => String(value || '').trim()).slice(0, 12)
    : [];
  if (!texts.length || texts.every((value: string) => !value)) return originalResponse;
  if (texts.some((value: string) => value.length > 2500)) return originalResponse;

  try {
    const numbered = texts.map((value: string, index: number) => `${index + 1}. ${JSON.stringify(value)}`).join('\n');
    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        {
          role: 'system',
          content: 'You are a Sinhala e-commerce translator for Sri Lankan customers. Translate English product names and product descriptions into natural, clear Sinhala. Keep brand names, model numbers, SKUs, technical abbreviations, measurements and units unchanged when appropriate. Do not invent claims or details. Return ONLY valid JSON in this exact shape: {"translations":["..."]}. Keep exactly one translation for each source text and preserve the original order.',
        },
        {
          role: 'user',
          content: `Translate these ${texts.length} texts to Sinhala:\n${numbered}`,
        },
      ],
      temperature: 0.15,
      max_tokens: 1800,
    });

    const raw = String(result?.response ?? result?.result?.response ?? result?.text ?? '').trim();
    if (!raw) return originalResponse;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    const translations = Array.isArray(parsed?.translations)
      ? parsed.translations.map((value: any) => String(value || '').trim())
      : [];
    if (translations.length !== texts.length || translations.some((value: string) => !value)) return originalResponse;

    return json({ translations, provider: 'cloudflare-workers-ai' });
  } catch (error) {
    console.warn('Cloudflare Workers AI Sinhala fallback failed:', error);
    return originalResponse;
  }
};

const getSheetRuntime = async (envValue: unknown): Promise<SheetRuntime> => {
  const env = (envValue || {}) as Record<string, string | undefined>;
  const supabaseUrl = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase server configuration is missing.');

  const response = await nativeFetch(
    `${supabaseUrl}/rest/v1/admin_data_store?key=eq.storefront-state-v1&select=payload`,
    {
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        accept: 'application/json',
      },
    },
  );
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read shared Store Settings (${response.status}).`);
  const settings = rows?.[0]?.payload?.settings || {};
  const webhook = String(settings?.google_sheet_webhook_url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook)) {
    throw new Error('Shared Google Sheet Web App URL is missing or invalid.');
  }
  return { supabaseUrl, supabaseKey, webhook };
};

const isTransientSheetError = (message: string) => /Service Spreadsheets failed while accessing document|Internal error|Service unavailable|timed out|timeout|temporarily unavailable/i.test(message);

const postAppsScript = async (runtime: SheetRuntime, payload: Record<string, any>) => {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await nativeFetch(runtime.webhook, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain;charset=utf-8',
          accept: 'application/json,text/plain,*/*',
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });
      const { text, data } = await parseJsonResponse(response);
      if (!response.ok) throw new Error(`Google Apps Script HTTP ${response.status}: ${text.slice(0, 240)}`);
      if (!text || !Object.keys(data || {}).length) throw new Error(`Google Apps Script returned non-JSON: ${text.slice(0, 240)}`);
      if (data?.ok === false || String(data?.status || '').toLowerCase() === 'error') {
        throw new Error(data?.message || data?.error || 'Google Apps Script returned an error.');
      }
      return data;
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error || 'Google Apps Script call failed.'));
      if (!isTransientSheetError(lastError.message) || attempt >= 3) throw lastError;
      await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 350 : 900));
    }
  }
  throw lastError || new Error('Google Apps Script call failed.');
};

const expectedRows = (order: any) => Math.max(1, Array.isArray(order?.items) && order.items.length ? order.items.length : 1);

const physicalOrder = async (runtime: SheetRuntime, order: any) => {
  const orderNumber = String(order?.order_number || '').trim();
  if (!orderNumber) throw new Error('Bulk order has no order number.');
  const check = await postAppsScript(runtime, { action: 'read_order', orderId: orderNumber });
  return {
    found: check?.found === true,
    rows: Number(check?.rows || 0),
    raw: check,
  };
};

const markPersistedOrder = async (runtime: SheetRuntime, order: any) => {
  const id = String(order?.id || '').trim();
  if (!id) return;
  const response = await nativeFetch(
    `${runtime.supabaseUrl}/rest/v1/order_snapshots?order_id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: runtime.supabaseKey,
        authorization: `Bearer ${runtime.supabaseKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ payload: order, updated_at: new Date().toISOString() }),
    },
  );
  if (!response.ok) throw new Error(`Could not update durable bulk order sync state (${response.status}).`);
};

const repairBulkSheetSync = async (request: Request, env: unknown, response: Response): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/orders/bulk-import' || !response.ok) return response;

  let data: any = {};
  try { data = await response.clone().json(); } catch { return response; }
  const orders: any[] = Array.isArray(data?.orders) ? data.orders : [];
  if (!orders.length) return response;

  // The primary path already performed physical verification. Do not touch a
  // successful batch again; this is deliberately a failure/partial-write repair.
  if (data?.sheet_sync?.ok === true && data?.sheet_sync?.confirmed === true) return response;

  try {
    const runtime = await getSheetRuntime(env);
    const syncedAt = new Date().toISOString();
    const repairedOrders: any[] = [];
    let repaired = 0;
    let totalRows = 0;

    for (const order of orders) {
      const need = expectedRows(order);
      let physical = await physicalOrder(runtime, order);

      if (!physical.found || physical.rows < need) {
        const result = await postAppsScript(runtime, { action: 'sync_orders', order });
        const status = String(result?.status || '');
        if (status !== 'orders_synced' || Number(result?.rows || 0) < need || Number(result?.synced || 0) < 1) {
          throw new Error(`Google Sheet did not confirm ${String(order?.order_number || '')}.`);
        }
        physical = await physicalOrder(runtime, order);
        if (!physical.found || physical.rows < need) {
          throw new Error(`Physical Sheet read-back failed for ${String(order?.order_number || '')}. Expected ${need}, found ${physical.rows}.`);
        }
        repaired++;
      }

      totalRows += physical.rows;
      const syncedOrder = {
        ...order,
        is_synced_google_sheets: true,
        synced_at: syncedAt,
        sheet_sync_verified_at: syncedAt,
      };
      await markPersistedOrder(runtime, syncedOrder);
      repairedOrders.push(syncedOrder);
    }

    return jsonResponseLike({
      ...data,
      orders: repairedOrders,
      sheet_sync: {
        ok: true,
        confirmed: true,
        status: 'orders_synced',
        synced: repairedOrders.length,
        rows: totalRows,
        repaired,
        path: 'clean-v1-worker-per-order-repair',
      },
    }, response);
  } catch (error: any) {
    return jsonResponseLike({
      ...data,
      sheet_sync: {
        ok: false,
        confirmed: false,
        error: String(error?.message || error || 'Bulk Google Sheet repair failed.'),
        path: 'clean-v1-worker-per-order-repair',
      },
    }, response);
  }
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const facebookLeadResponse = await facebookLeadAutoHandler(request, env, ctx, baseWorker);
    if (facebookLeadResponse) return facebookLeadResponse;

    const mediaResponse = await r2MediaHandler(request, env);
    if (mediaResponse) return mediaResponse;

    // Clone before Express consumes the request body. The fallback is only used
    // after Express has already authenticated/authorized the translation route.
    const fallbackRequest = request.clone();
    const response = await baseWorker.fetch(request, env, ctx);

    const translatedResponse = await workersAiSinhalaFallback(fallbackRequest, env, response);
    if (translatedResponse !== response) return translatedResponse;

    return repairBulkSheetSync(request, env, response);
  },
};
