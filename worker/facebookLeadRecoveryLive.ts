import { facebookLeadAutoHandler } from './facebookLeadAuto';

type Env = Record<string, any>;
type BaseWorker = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };
type KnownForm = { id: string; name: string };
type Candidate = { id: string; created: number; form: KnownForm };

type RecoveryState = {
  next_form_index?: number;
  form_last_checked?: Record<string, string>;
  subscription_checked_at?: string;
  subscription_ok?: boolean;
};

type Summary = {
  at: string;
  phase: 'starting' | 'forms_ready' | 'candidates_ready' | 'completed';
  page_id?: string;
  page_name?: string;
  forms_checked: number;
  forms_scanned_this_run?: number;
  selected_forms?: string[];
  candidates_seen: number;
  orders_created: number;
  failed: number;
  subscription_ok?: boolean;
  errors: string[];
};

const KEY = 'facebook-lead-recovery-live-v1';
const STATE_KEY = 'facebook-lead-recovery-state-v2';

// The webhook is the primary real-time path. Recovery is only a safety net.
// Scanning every form every minute was enough to hit Meta's Page leadgen quota.
const FORMS_PER_RUN = 3;
const INITIAL_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const OVERLAP_MS = 5 * 60 * 1000;
const SUBSCRIPTION_RECHECK_MS = 24 * 60 * 60 * 1000;
const GRAPH_TIMEOUT_MS = 6500;

let running: Promise<void> | null = null;

const text = (env: Env, key: string) => String(env?.[key] || '').trim();
const db = (env: Env) => ({
  url: text(env, 'VITE_SUPABASE_URL').replace(/\/$/, ''),
  key: text(env, 'SUPABASE_SECRET_KEY') || text(env, 'SUPABASE_SERVICE_ROLE_KEY'),
});
const dbHeaders = (key: string) => ({ apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' });

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
    if (!response.ok || data?.error) {
      const code = data?.error?.code ? ` (#${data.error.code})` : '';
      throw new Error(`${data?.error?.message || `Meta Graph API ${response.status}`}${code}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const writePayload = async (env: Env, keyName: string, payload: Record<string, unknown>) => {
  const runtime = db(env);
  if (!runtime.url || !runtime.key) return;
  const at = new Date().toISOString();
  await fetch(`${runtime.url}/rest/v1/admin_data_store?on_conflict=key`, {
    method: 'POST',
    headers: {
      ...dbHeaders(runtime.key),
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{ key: keyName, payload, updated_at: at }]),
  });
};

const writeSummary = async (env: Env, summary: Summary) => {
  try {
    await writePayload(env, KEY, summary as unknown as Record<string, unknown>);
  } catch {
    // Summary logging must never block lead recovery.
  }
};

const readState = async (env: Env): Promise<RecoveryState> => {
  const runtime = db(env);
  if (!runtime.url || !runtime.key) throw new Error('Supabase server configuration is missing.');

  const url = new URL(`${runtime.url}/rest/v1/admin_data_store`);
  url.searchParams.set('key', `eq.${STATE_KEY}`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, { headers: dbHeaders(runtime.key) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read Facebook recovery state (${response.status}).`);
  const payload = rows?.[0]?.payload;
  return payload && typeof payload === 'object' ? payload as RecoveryState : {};
};

const writeState = async (env: Env, state: RecoveryState) => {
  await writePayload(env, STATE_KEY, state as unknown as Record<string, unknown>);
};

const formsForPage = async (env: Env, pageId: string): Promise<KnownForm[]> => {
  const response = await graph(env, `${pageId}/leadgen_forms`, { fields: 'id,name', limit: '100' });
  return (Array.isArray(response?.data) ? response.data : [])
    .map((form: any) => ({ id: String(form?.id || '').trim(), name: String(form?.name || '').trim() }))
    .filter((form: KnownForm) => Boolean(form.id))
    .sort((a: KnownForm, b: KnownForm) => a.id.localeCompare(b.id));
};

const readLeadOrder = async (env: Env, leadId: string) => {
  const runtime = db(env);
  const url = new URL(`${runtime.url}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('payload->>platform_lead_id', `eq.${leadId}`);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers: dbHeaders(runtime.key) });
  const rows: any[] = await response.json().catch(() => []);
  return response.ok ? (rows?.[0]?.payload || null) : null;
};

const needsExistingComboVariantRepair = (order: any) => {
  const item = Array.isArray(order?.items) ? order.items[0] : null;
  return Boolean(
    order &&
    order.call_center_status === 'Pending' &&
    order.order_status !== 'Cancelled' &&
    item?.product_type === 'bundle' &&
    !String(item?.variant_name || '').trim()
  );
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
      changes: [{
        field: 'leadgen',
        value: {
          leadgen_id: candidate.id,
          form_id: candidate.form.id,
          page_id: pageId,
        },
      }],
    }],
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
};

const ensureSubscription = async (env: Env, pageId: string) => {
  try {
    const response = await graph(env, `${pageId}/subscribed_apps`, { subscribed_fields: 'leadgen' }, 'POST');
    return response?.success === true;
  } catch {
    return false;
  }
};

const selectForms = (forms: KnownForm[], startIndex: number) => {
  if (!forms.length) return [] as KnownForm[];
  const count = Math.min(FORMS_PER_RUN, forms.length);
  const selected: KnownForm[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    selected.push(forms[(startIndex + offset) % forms.length]);
  }
  return selected;
};

const run = async (baseWorker: BaseWorker, envValue: unknown) => {
  const env = (envValue || {}) as Env;
  const startedAtMs = Date.now();
  const summary: Summary = {
    at: new Date(startedAtMs).toISOString(),
    phase: 'starting',
    forms_checked: 0,
    candidates_seen: 0,
    orders_created: 0,
    failed: 0,
    errors: [],
  };
  await writeSummary(env, summary);

  try {
    if (text(env, 'META_LEADS_AUTO_ENABLED') !== '1') {
      throw new Error('META_LEADS_AUTO_ENABLED is not enabled.');
    }

    const [page, state] = await Promise.all([
      graph(env, 'me', { fields: 'id,name' }),
      readState(env),
    ]);

    const pageId = String(page?.id || '').trim();
    if (!pageId) throw new Error('Current Page token did not return a Page ID.');

    summary.page_id = pageId;
    summary.page_name = String(page?.name || '').trim() || undefined;

    const forms = await formsForPage(env, pageId);
    summary.forms_checked = forms.length;

    const rawIndex = Math.max(0, Math.floor(Number(state.next_form_index || 0)));
    const startIndex = forms.length ? rawIndex % forms.length : 0;
    const selected = selectForms(forms, startIndex);

    summary.forms_scanned_this_run = selected.length;
    summary.selected_forms = selected.map((form) => form.name || form.id);
    summary.phase = 'forms_ready';
    summary.at = new Date().toISOString();
    await writeSummary(env, summary);

    const perFormChecked = {
      ...(state.form_last_checked && typeof state.form_last_checked === 'object'
        ? state.form_last_checked
        : {}),
    };

    for (const form of selected) {
      let formSucceeded = true;
      const priorMs = Date.parse(String(perFormChecked[form.id] || ''));
      const baseSinceMs = Number.isFinite(priorMs)
        ? priorMs
        : startedAtMs - INITIAL_LOOKBACK_MS;
      const sinceMs = Math.max(0, baseSinceMs - OVERLAP_MS);

      let candidates: Candidate[] = [];
      try {
        const response = await graph(env, `${form.id}/leads`, {
          fields: 'id,created_time',
          since: String(Math.floor(sinceMs / 1000)),
          limit: '100',
        });

        candidates = (Array.isArray(response?.data) ? response.data : [])
          .map((lead: any) => ({
            id: String(lead?.id || '').trim(),
            created: Date.parse(String(lead?.created_time || '')) || 0,
            form,
          }))
          .filter((lead: Candidate) => Boolean(lead.id) && lead.created >= sinceMs)
          .sort((a: Candidate, b: Candidate) => a.created - b.created);
      } catch (error: any) {
        formSucceeded = false;
        summary.failed += 1;
        summary.errors.push(`Form ${form.name || form.id}: ${String(error?.message || error)}`);
      }

      summary.candidates_seen += candidates.length;

      if (formSucceeded) {
        for (const candidate of candidates) {
          try {
            const existing = await readLeadOrder(env, candidate.id);
            if (existing && !needsExistingComboVariantRepair(existing)) continue;

            await processCandidate(candidate, pageId, envValue, baseWorker);
            const after = await readLeadOrder(env, candidate.id);

            if (!existing && after) {
              summary.orders_created += 1;
            } else if (existing && after && !needsExistingComboVariantRepair(after)) {
              // Existing pending combo was repaired from its original Meta answer.
            } else if (!after) {
              formSucceeded = false;
              summary.failed += 1;
              summary.errors.push(`Lead ${candidate.id}: no order was created.`);
            }
          } catch (error: any) {
            formSucceeded = false;
            summary.failed += 1;
            summary.errors.push(`Lead ${candidate.id}: ${String(error?.message || error)}`);
          }
        }
      }

      // Only advance this form's checkpoint after every candidate in the window
      // is safely present in O-RA. If one lead fails, the same window is retried
      // on the next rotation instead of silently skipping that lead forever.
      if (formSucceeded) {
        perFormChecked[form.id] = new Date(startedAtMs).toISOString();
      }
    }

    state.form_last_checked = perFormChecked;
    state.next_form_index = forms.length
      ? (startIndex + selected.length) % forms.length
      : 0;

    const lastSubscriptionCheck = Date.parse(String(state.subscription_checked_at || ''));
    if (!Number.isFinite(lastSubscriptionCheck) || startedAtMs - lastSubscriptionCheck >= SUBSCRIPTION_RECHECK_MS) {
      state.subscription_ok = await ensureSubscription(env, pageId);
      state.subscription_checked_at = new Date().toISOString();
    }
    summary.subscription_ok = state.subscription_ok;

    await writeState(env, state);
  } catch (error: any) {
    summary.failed += 1;
    summary.errors.push(String(error?.message || error));
  }

  summary.phase = 'completed';
  summary.at = new Date().toISOString();
  summary.errors = summary.errors.slice(0, 25);
  await writeSummary(env, summary);
};

export const scheduleFacebookLeadRecoveryLive = (
  baseWorker: BaseWorker,
  envValue: unknown,
  ctx: unknown,
) => {
  const env = (envValue || {}) as Env;
  if (text(env, 'META_LEADS_AUTO_ENABLED') !== '1' || running) return;

  running = run(baseWorker, envValue)
    .catch(() => undefined)
    .finally(() => { running = null; });

  const waitUntil = (ctx as any)?.waitUntil;
  if (typeof waitUntil === 'function') waitUntil.call(ctx, running);
};
