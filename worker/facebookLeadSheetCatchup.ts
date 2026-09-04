type Env = Record<string, any>;

type Runtime = {
  url: string;
  key: string;
  webhook: string;
};

const KEY = 'facebook-lead-sheet-catchup-v1';
const MAX_PER_RUN = 5;
const RETRY_AFTER_MS = 30_000;
let running: Promise<void> | null = null;
let nextRunAt = 0;

const text = (env: Env, key: string) => String(env?.[key] || '').trim();
const dbHeaders = (key: string) => ({
  apikey: key,
  authorization: `Bearer ${key}`,
  accept: 'application/json',
});

const getRuntime = async (env: Env): Promise<Runtime> => {
  const url = text(env, 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const key = text(env, 'SUPABASE_SECRET_KEY') || text(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase server configuration is missing.');

  const response = await fetch(`${url}/rest/v1/admin_data_store?key=eq.storefront-state-v1&select=payload`, {
    headers: dbHeaders(key),
  });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read Store Settings (${response.status}).`);
  const webhook = String(rows?.[0]?.payload?.settings?.google_sheet_webhook_url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook)) {
    throw new Error('Google Sheet Web App URL is missing or invalid.');
  }
  return { url, key, webhook };
};

const postAppsScript = async (webhook: string, payload: Record<string, any>) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain;charset=utf-8',
        accept: 'application/json,text/plain,*/*',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok) throw new Error(`Google Apps Script HTTP ${response.status}.`);
    if (!raw || !Object.keys(data || {}).length) throw new Error('Google Apps Script returned an empty response.');
    if (data?.ok === false || String(data?.status || '').toLowerCase() === 'error') {
      throw new Error(data?.message || data?.error || 'Google Apps Script returned an error.');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const readRecentUnsyncedFacebookOrders = async (runtime: Runtime) => {
  const url = new URL(`${runtime.url}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '30');
  const response = await fetch(url, { headers: dbHeaders(runtime.key) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read recent orders (${response.status}).`);
  return rows
    .map((row) => row?.payload)
    .filter((order) => order && String(order.order_source || '') === 'Facebook Ads' && order.is_synced_google_sheets !== true)
    .slice(0, MAX_PER_RUN);
};

const markSynced = async (runtime: Runtime, order: any) => {
  const id = String(order?.id || '').trim();
  if (!id) throw new Error('Order ID is missing.');
  const now = new Date().toISOString();
  const syncedOrder = {
    ...order,
    is_synced_google_sheets: true,
    synced_at: now,
    sheet_sync_verified_at: now,
  };
  const response = await fetch(`${runtime.url}/rest/v1/order_snapshots?order_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      ...dbHeaders(runtime.key),
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ payload: syncedOrder, updated_at: now }),
  });
  if (!response.ok) throw new Error(`Could not persist Sheet sync state (${response.status}).`);
};

const syncAndVerifyOrder = async (runtime: Runtime, order: any) => {
  const orderNumber = String(order?.order_number || '').trim();
  if (!orderNumber) throw new Error('Order number is missing.');
  const expectedRows = Math.max(1, Array.isArray(order?.items) ? order.items.length : 1);

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await postAppsScript(runtime.webhook, { action: 'sync_orders', order });
      if (String(result?.status || '') !== 'orders_synced' || Number(result?.rows || 0) < expectedRows) {
        throw new Error(`Sheet sync did not confirm all rows for ${orderNumber}.`);
      }
      const physical = await postAppsScript(runtime.webhook, { action: 'read_order', orderId: orderNumber });
      if (physical?.found !== true || Number(physical?.rows || 0) < expectedRows) {
        throw new Error(`Sheet read-back did not find ${orderNumber}.`);
      }
      await markSynced(runtime, order);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Sheet sync failed.'));
};

const writeSummary = async (runtime: Runtime, payload: Record<string, unknown>) => {
  try {
    const at = new Date().toISOString();
    await fetch(`${runtime.url}/rest/v1/admin_data_store?on_conflict=key`, {
      method: 'POST',
      headers: {
        ...dbHeaders(runtime.key),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{ key: KEY, payload: { at, ...payload }, updated_at: at }]),
    });
  } catch {}
};

const run = async (envValue: unknown) => {
  const env = (envValue || {}) as Env;
  const runtime = await getRuntime(env);
  const orders = await readRecentUnsyncedFacebookOrders(runtime);
  const attempted: string[] = [];
  const errors: string[] = [];
  let synced = 0;

  for (const order of orders) {
    const orderNumber = String(order?.order_number || '').trim();
    if (!orderNumber) continue;
    attempted.push(orderNumber);
    try {
      await syncAndVerifyOrder(runtime, order);
      synced += 1;
    } catch (error: any) {
      errors.push(`${orderNumber}: ${String(error?.message || error)}`);
    }
  }

  await writeSummary(runtime, {
    attempted,
    synced,
    failed: errors.length,
    errors: errors.slice(0, 10),
  });
};

export const scheduleFacebookLeadSheetCatchup = (envValue: unknown, ctx: unknown) => {
  const now = Date.now();
  if (running || now < nextRunAt) return;
  nextRunAt = now + RETRY_AFTER_MS;
  running = run(envValue).catch(() => undefined).finally(() => { running = null; });
  const waitUntil = (ctx as any)?.waitUntil;
  if (typeof waitUntil === 'function') waitUntil.call(ctx, running);
};