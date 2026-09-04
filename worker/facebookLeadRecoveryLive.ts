import { facebookLeadAutoHandler } from './facebookLeadAuto';

type Env = Record<string, any>;
type BaseWorker = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };
type KnownForm = { id: string; name: string };
type Candidate = { id: string; created: number; form: KnownForm };

type Summary = {
  at: string;
  phase: 'starting' | 'completed';
  page_id?: string;
  page_name?: string;
  forms_checked: number;
  cutoff?: string;
  candidates_seen: number;
  missing_found: number;
  orders_created: number;
  failed: number;
  subscription_ok?: boolean;
  errors: string[];
};

const KEY = 'facebook-lead-recovery-live-v1';
const RETRY_MS = 15_000;
const GRAPH_TIMEOUT_MS = 7000;
const CONCURRENCY = 2;

let nextRun = 0;
let running: Promise<void> | null = null;

const text = (env: Env, key: string) => String(env?.[key] || '').trim();
const db = (env: Env) => ({
  url: text(env, 'VITE_SUPABASE_URL').replace(/\/$/, ''),
  key: text(env, 'SUPABASE_SECRET_KEY') || text(env, 'SUPABASE_SERVICE_ROLE_KEY'),
});
const dbHeaders = (key: string) => ({
  apikey: key,
  authorization: `Bearer ${key}`,
  accept: 'application/json',
});

const graph = async (env: Env, path: string, params: Record<string, string> = {}, method = 'GET') => {
  const token = text(env, 'META_PAGE_ACCESS_TOKEN');
  const version = text(env, 'META_GRAPH_API_VERSION') || 'v26.0';
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is missing.');
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, '')}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('access_token', token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) throw new Error(data?.error?.message || `Meta Graph API ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const writeSummary = async (env: Env, summary: Summary) => {
  try {
    const runtime = db(env);
    if (!runtime.url || !runtime.key) return;
    await fetch(`${runtime.url}/rest/v1/admin_data_store?on_conflict=key`, {
      method: 'POST',
      headers: {
        ...dbHeaders(runtime.key),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{ key: KEY, payload: summary, updated_at: summary.at }]),
    });
  } catch {}
};

const readLatestFacebookTime = async (env: Env) => {
  const runtime = db(env);
  if (!runtime.url || !runtime.key) throw new Error('Supabase server configuration is missing.');
  const url = new URL(`${runtime.url}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'created_at,payload');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '500');
  const response = await fetch(url, { headers: dbHeaders(runtime.key) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read existing Facebook orders (${response.status}).`);
  for (const row of rows) {
    const payload = row?.payload || {};
    if (String(payload?.order_source || '') !== 'Facebook Ads') continue;
    const raw = String(payload?.platform_lead_created_at || payload?.created_at || row?.created_at || '');
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() - 72 * 60 * 60 * 1000;
};

const readExistingLeadIds = async (env: Env) => {
  const runtime = db(env);
  const ids = new Set<string>();
  if (!runtime.url || !runtime.key) return ids;
  const url = new URL(`${runtime.url}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '1500');
  const response = await fetch(url, { headers: dbHeaders(runtime.key) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) return ids;
  for (const row of rows) {
    const id = String(row?.payload?.platform_lead_id || '').trim();
    if (id) ids.add(id);
  }
  return ids;
};

const leadExists = async (env: Env, leadId: string) => {
  const runtime = db(env);
  if (!runtime.url || !runtime.key) return false;
  const url = new URL(`${runtime.url}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'order_number');
  url.searchParams.set('payload->>platform_lead_id', `eq.${leadId}`);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers: dbHeaders(runtime.key) });
  const rows: any[] = await response.json().catch(() => []);
  return response.ok && rows.length > 0;
};

const formsForPage = async (env: Env, pageId: string): Promise<KnownForm[]> => {
  const response = await graph(env, `${pageId}/leadgen_forms`, { fields: 'id,name', limit: '100' });
  return (Array.isArray(response?.data) ? response.data : [])
    .map((form: any) => ({ id: String(form?.id || '').trim(), name: String(form?.name || '').trim() }))
    .filter((form: KnownForm) => Boolean(form.id));
};

const ensureSubscription = async (env: Env, pageId: string) => {
  try {
    const response = await graph(env, `${pageId}/subscribed_apps`, { subscribed_fields: 'leadgen' }, 'POST');
    return response?.success === true;
  } catch {
    return false;
  }
};

const processCandidate = async (
  candidate: Candidate,
  pageId: string,
  envValue: unknown,
  baseWorker: BaseWorker,
) => {
  const body = JSON.stringify({
    object: 'page',
    entry: [{
      id: pageId,
      time: Math.floor(Date.now() / 1000),
      changes: [{ field: 'leadgen', value: {
        leadgen_id: candidate.id,
        form_id: candidate.form.id,
        page_id: pageId,
      } }],
    }],
  });

  // IMPORTANT: do not pass the outer ExecutionContext here. Passing it makes the
  // normal webhook handler queue another waitUntil job and return before the order
  // is actually created. A null context forces the handler to await the real order
  // + Google Sheet flow before this recovery marks the lead done.
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
};

const run = async (baseWorker: BaseWorker, envValue: unknown) => {
  const env = (envValue || {}) as Env;
  const summary: Summary = {
    at: new Date().toISOString(),
    phase: 'starting',
    forms_checked: 0,
    candidates_seen: 0,
    missing_found: 0,
    orders_created: 0,
    failed: 0,
    errors: [],
  };
  await writeSummary(env, summary);

  try {
    if (text(env, 'META_LEADS_AUTO_ENABLED') !== '1') throw new Error('META_LEADS_AUTO_ENABLED is not enabled.');

    const [page, cutoffMs, existingIds] = await Promise.all([
      graph(env, 'me', { fields: 'id,name' }),
      readLatestFacebookTime(env),
      readExistingLeadIds(env),
    ]);
    const pageId = String(page?.id || '').trim();
    if (!pageId) throw new Error('Current Page token did not return a Page ID.');
    summary.page_id = pageId;
    summary.page_name = String(page?.name || '').trim() || undefined;
    summary.cutoff = new Date(cutoffMs).toISOString();

    const forms = await formsForPage(env, pageId);
    summary.forms_checked = forms.length;
    summary.subscription_ok = await ensureSubscription(env, pageId);

    const sinceMs = cutoffMs - 60_000;
    const since = String(Math.floor(sinceMs / 1000));
    const perForm = await Promise.all(forms.map(async (form): Promise<Candidate[]> => {
      try {
        const response = await graph(env, `${form.id}/leads`, {
          fields: 'id,created_time',
          since,
          limit: '100',
        });
        return (Array.isArray(response?.data) ? response.data : [])
          .map((lead: any) => ({
            id: String(lead?.id || '').trim(),
            created: Date.parse(String(lead?.created_time || '')) || 0,
            form,
          }))
          .filter((lead: Candidate) => Boolean(lead.id) && lead.created >= sinceMs);
      } catch (error: any) {
        summary.failed += 1;
        summary.errors.push(`Form ${form.name || form.id}: ${String(error?.message || error)}`);
        return [];
      }
    }));

    const unique = new Map<string, Candidate>();
    for (const candidate of perForm.flat()) unique.set(candidate.id, candidate);
    const candidates = Array.from(unique.values()).sort((a, b) => a.created - b.created);
    summary.candidates_seen = candidates.length;
    const missing = candidates.filter((candidate) => !existingIds.has(candidate.id));
    summary.missing_found = missing.length;

    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= missing.length) return;
        const candidate = missing[index];
        try {
          await processCandidate(candidate, pageId, envValue, baseWorker);
          if (await leadExists(env, candidate.id)) {
            summary.orders_created += 1;
            existingIds.add(candidate.id);
          } else {
            summary.failed += 1;
            summary.errors.push(`Lead ${candidate.id}: no order was created.`);
          }
        } catch (error: any) {
          summary.failed += 1;
          summary.errors.push(`Lead ${candidate.id}: ${String(error?.message || error)}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, missing.length)) }, () => worker()));
  } catch (error: any) {
    summary.failed += 1;
    summary.errors.push(String(error?.message || error));
  }

  summary.phase = 'completed';
  summary.at = new Date().toISOString();
  summary.errors = summary.errors.slice(0, 25);
  await writeSummary(env, summary);
};

export const scheduleFacebookLeadRecoveryLive = (baseWorker: BaseWorker, envValue: unknown, ctx: unknown) => {
  const env = (envValue || {}) as Env;
  if (text(env, 'META_LEADS_AUTO_ENABLED') !== '1') return;
  const now = Date.now();
  if (running || now < nextRun) return;
  nextRun = now + RETRY_MS;
  running = run(baseWorker, envValue)
    .catch(() => undefined)
    .finally(() => { running = null; });
  const waitUntil = (ctx as any)?.waitUntil;
  if (typeof waitUntil === 'function') waitUntil.call(ctx, running);
};
