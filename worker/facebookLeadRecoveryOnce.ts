import { facebookLeadAutoHandler } from './facebookLeadAuto';

type Env = Record<string, any>;
type BaseWorker = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };
type KnownForm = { id: string; name: string };

type RecoverySummary = {
  at: string;
  page_id?: string;
  page_name?: string;
  forms_checked: number;
  recent_leads_seen: number;
  replayed: number;
  failed: number;
  errors: string[];
};

const RECOVERY_KEY = 'facebook-lead-recovery-once-v3';
const RECOVERY_WINDOW_MS = 72 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

let nextAttemptAt = 0;
let inFlight: Promise<void> | null = null;

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

const graph = async (env: Env, path: string, params: Record<string, string> = {}) => {
  const token = text(env, 'META_PAGE_ACCESS_TOKEN');
  const version = text(env, 'META_GRAPH_API_VERSION') || 'v26.0';
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is missing.');
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, '')}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error?.message || `Meta Graph API ${response.status}`);
  return data;
};

const readKnownForms = async (env: Env): Promise<KnownForm[]> => {
  const db = runtime(env);
  if (!db.url || !db.key) throw new Error('Supabase server configuration is missing.');
  const url = new URL(`${db.url}/rest/v1/admin_data_store`);
  url.searchParams.set('key', 'eq.facebook-lead-auto-log-v1');
  url.searchParams.set('select', 'payload');
  const response = await fetch(url, { headers: headers(db.key) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read Facebook form history (${response.status}).`);

  const events = Array.isArray(rows?.[0]?.payload?.events) ? rows[0].payload.events : [];
  const forms = new Map<string, KnownForm>();
  for (const event of events) {
    const id = String(event?.form_id || '').trim();
    const name = String(event?.form_name || '').trim();
    if (id && name) forms.set(id, { id, name });
  }
  return Array.from(forms.values()).slice(0, 50);
};

const writeSummary = async (env: Env, summary: RecoverySummary) => {
  try {
    const db = runtime(env);
    if (!db.url || !db.key) return;
    await fetch(`${db.url}/rest/v1/admin_data_store?on_conflict=key`, {
      method: 'POST',
      headers: {
        ...headers(db.key),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{
        key: RECOVERY_KEY,
        payload: summary,
        updated_at: summary.at,
      }]),
    });
  } catch {
    // Recovery diagnostics must never affect normal store traffic.
  }
};

const runRecovery = async (baseWorker: BaseWorker, envValue: unknown, ctx: unknown) => {
  const env = (envValue || {}) as Env;
  const summary: RecoverySummary = {
    at: new Date().toISOString(),
    forms_checked: 0,
    recent_leads_seen: 0,
    replayed: 0,
    failed: 0,
    errors: [],
  };

  try {
    if (text(env, 'META_LEADS_AUTO_ENABLED') !== '1') throw new Error('META_LEADS_AUTO_ENABLED is not enabled.');

    const page = await graph(env, 'me', { fields: 'id,name' });
    summary.page_id = String(page?.id || '').trim() || undefined;
    summary.page_name = String(page?.name || '').trim() || undefined;

    const forms = await readKnownForms(env);
    summary.forms_checked = forms.length;
    if (!forms.length) throw new Error('No known Facebook lead forms were found.');

    const cutoff = Date.now() - RECOVERY_WINDOW_MS;
    for (const form of forms) {
      let leads: any;
      try {
        leads = await graph(env, `${form.id}/leads`, { fields: 'id,created_time', limit: '100' });
      } catch (error: any) {
        summary.failed += 1;
        summary.errors.push(`Form ${form.name} (${form.id}): ${String(error?.message || error)}`);
        continue;
      }

      for (const lead of Array.isArray(leads?.data) ? leads.data : []) {
        const leadId = String(lead?.id || '').trim();
        const created = Date.parse(String(lead?.created_time || ''));
        if (!leadId || !Number.isFinite(created) || created < cutoff) continue;
        summary.recent_leads_seen += 1;

        const body = JSON.stringify({
          object: 'page',
          entry: [{
            id: summary.page_id || '',
            time: Math.floor(Date.now() / 1000),
            changes: [{ field: 'leadgen', value: {
              leadgen_id: leadId,
              form_id: form.id,
              page_id: summary.page_id || '',
            } }],
          }],
        });

        try {
          const response = await facebookLeadAutoHandler(
            new Request('https://ora.internal/api/integrations/facebook-leads/webhook', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body,
            }),
            envValue,
            ctx,
            baseWorker,
          );
          if (response?.ok) summary.replayed += 1;
          else {
            summary.failed += 1;
            summary.errors.push(`Lead ${leadId}: recovery webhook did not complete.`);
          }
        } catch (error: any) {
          summary.failed += 1;
          summary.errors.push(`Lead ${leadId}: ${String(error?.message || error)}`);
        }
      }
    }
  } catch (error: any) {
    summary.failed += 1;
    summary.errors.push(String(error?.message || error));
  }

  summary.at = new Date().toISOString();
  summary.errors = summary.errors.slice(0, 20);
  await writeSummary(env, summary);
};

export const scheduleFacebookLeadRecoveryOnce = (
  baseWorker: BaseWorker,
  envValue: unknown,
  ctx: unknown,
) => {
  const env = (envValue || {}) as Env;
  if (text(env, 'META_LEADS_AUTO_ENABLED') !== '1') return;

  const now = Date.now();
  if (inFlight || now < nextAttemptAt) return;
  nextAttemptAt = now + RETRY_INTERVAL_MS;

  inFlight = runRecovery(baseWorker, envValue, ctx)
    .catch(() => undefined)
    .finally(() => { inFlight = null; });

  const waitUntil = (ctx as any)?.waitUntil;
  if (typeof waitUntil === 'function') waitUntil.call(ctx, inFlight);
};
