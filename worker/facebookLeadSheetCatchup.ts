type Env = Record<string, any>;
type BaseWorker = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };

const KEY = 'facebook-lead-sheet-catchup-v1';
const MAX_PER_RUN = 5;
let running: Promise<void> | null = null;

const text = (env: Env, key: string) => String(env?.[key] || '').trim();
const runtime = (env: Env) => ({
  url: text(env, 'VITE_SUPABASE_URL').replace(/\/$/, ''),
  key: text(env, 'SUPABASE_SECRET_KEY') || text(env, 'SUPABASE_SERVICE_ROLE_KEY'),
});
const headers = (key: string) => ({
  apikey: key,
  authorization: `Bearer ${key}`,
  accept: 'application/json',
});

const readRecentUnsyncedFacebookOrders = async (env: Env) => {
  const db = runtime(env);
  if (!db.url || !db.key) throw new Error('Supabase server configuration is missing.');
  const url = new URL(`${db.url}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '30');
  const response = await fetch(url, { headers: headers(db.key) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read recent orders (${response.status}).`);
  return rows
    .map((row) => row?.payload)
    .filter((order) => order && String(order.order_source || '') === 'Facebook Ads' && order.is_synced_google_sheets !== true)
    .slice(0, MAX_PER_RUN);
};

const writeSummary = async (env: Env, payload: Record<string, unknown>) => {
  try {
    const db = runtime(env);
    if (!db.url || !db.key) return;
    const at = new Date().toISOString();
    await fetch(`${db.url}/rest/v1/admin_data_store?on_conflict=key`, {
      method: 'POST',
      headers: {
        ...headers(db.key),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{ key: KEY, payload: { at, ...payload }, updated_at: at }]),
    });
  } catch {}
};

const syncOrder = async (baseWorker: BaseWorker, envValue: unknown, order: any) => {
  const body = JSON.stringify({ order });
  const response = await baseWorker.fetch(
    new Request('https://ora.internal/api/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(body).byteLength),
        'x-ora-integration': 'facebook-leads',
      },
      body,
    }),
    envValue,
    null,
  );
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true || data?.sheet_sync?.ok !== true || data?.sheet_sync?.confirmed !== true) {
    throw new Error(data?.sheet_sync?.error || data?.error || `Facebook Sheet verification failed (${response.status}).`);
  }
};

const run = async (baseWorker: BaseWorker, envValue: unknown) => {
  const env = (envValue || {}) as Env;
  const orders = await readRecentUnsyncedFacebookOrders(env);
  let synced = 0;
  const errors: string[] = [];
  const attempted: string[] = [];

  for (const order of orders) {
    const orderNumber = String(order?.order_number || '').trim();
    if (!orderNumber) continue;
    attempted.push(orderNumber);
    try {
      await syncOrder(baseWorker, envValue, order);
      synced += 1;
    } catch (error: any) {
      errors.push(`${orderNumber}: ${String(error?.message || error)}`);
    }
  }

  await writeSummary(env, {
    attempted,
    synced,
    failed: errors.length,
    errors: errors.slice(0, 10),
  });
};

export const scheduleFacebookLeadSheetCatchup = (baseWorker: BaseWorker, envValue: unknown, ctx: unknown) => {
  if (running) return;
  running = run(baseWorker, envValue).catch(async (error: any) => {
    await writeSummary((envValue || {}) as Env, { attempted: [], synced: 0, failed: 1, errors: [String(error?.message || error)] });
  }).finally(() => { running = null; });
  const waitUntil = (ctx as any)?.waitUntil;
  if (typeof waitUntil === 'function') waitUntil.call(ctx, running);
};
