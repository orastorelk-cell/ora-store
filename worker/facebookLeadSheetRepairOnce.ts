import { facebookLeadAutoHandler } from './facebookLeadAuto';

type Env = Record<string, any>;
type BaseWorker = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };

const LEAD_ID = '2534229293719612';
const FORM_ID = '1767601941151988';
const PAGE_ID = '1299145169953538';
const KEY = 'facebook-lead-sheet-repair-fb67-v1';
let running: Promise<void> | null = null;
let finished = false;

const text = (env: Env, key: string) => String(env?.[key] || '').trim();
const runtime = (env: Env) => ({
  url: text(env, 'VITE_SUPABASE_URL').replace(/\/$/, ''),
  key: text(env, 'SUPABASE_SECRET_KEY') || text(env, 'SUPABASE_SERVICE_ROLE_KEY'),
});
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' });

const readOrder = async (env: Env) => {
  const db = runtime(env);
  if (!db.url || !db.key) return null;
  const url = new URL(`${db.url}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('payload->>platform_lead_id', `eq.${LEAD_ID}`);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers: headers(db.key) });
  const rows: any[] = await response.json().catch(() => []);
  return response.ok ? rows?.[0]?.payload || null : null;
};

const writeResult = async (env: Env, payload: Record<string, unknown>) => {
  try {
    const db = runtime(env);
    if (!db.url || !db.key) return;
    await fetch(`${db.url}/rest/v1/admin_data_store?on_conflict=key`, {
      method: 'POST',
      headers: { ...headers(db.key), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ key: KEY, payload, updated_at: new Date().toISOString() }]),
    });
  } catch {}
};

const run = async (baseWorker: BaseWorker, envValue: unknown) => {
  const env = (envValue || {}) as Env;
  try {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: PAGE_ID, time: Math.floor(Date.now() / 1000), changes: [{ field: 'leadgen', value: {
        leadgen_id: LEAD_ID,
        form_id: FORM_ID,
        page_id: PAGE_ID,
      } }] }],
    });
    await facebookLeadAutoHandler(
      new Request('https://ora.internal/api/integrations/facebook-leads/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      envValue,
      null,
      baseWorker,
    );
    const order = await readOrder(env);
    finished = order?.is_synced_google_sheets === true;
    await writeResult(env, {
      at: new Date().toISOString(),
      order_number: order?.order_number || '',
      sheet_synced: finished,
    });
  } catch (error: any) {
    await writeResult(env, { at: new Date().toISOString(), sheet_synced: false, error: String(error?.message || error) });
  }
};

export const scheduleFacebookLeadSheetRepairOnce = (baseWorker: BaseWorker, envValue: unknown, ctx: unknown) => {
  if (finished || running) return;
  running = run(baseWorker, envValue).finally(() => { running = null; });
  const waitUntil = (ctx as any)?.waitUntil;
  if (typeof waitUntil === 'function') waitUntil.call(ctx, running);
};
