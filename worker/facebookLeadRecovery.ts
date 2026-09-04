type Env = Record<string, any>;
type WorkerLike = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };

type RecoverySummary = {
  page_id: string;
  forms_checked: number;
  recent_leads_seen: number;
  replayed: number;
  failed: number;
  errors: string[];
  at: string;
};

const text = (env: Env, key: string) => String(env?.[key] || '').trim();

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

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

const signBody = async (secret: string, body: string) => {
  if (!secret) return '';
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return `sha256=${hex(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))}`;
};

const writeRecoveryLog = async (env: Env, summary: RecoverySummary) => {
  try {
    const supabaseUrl = text(env, 'VITE_SUPABASE_URL').replace(/\/$/, '');
    const supabaseKey = text(env, 'SUPABASE_SECRET_KEY') || text(env, 'SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) return;
    const url = `${supabaseUrl}/rest/v1/admin_data_store?on_conflict=key`;
    await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{
        key: 'facebook-lead-recovery-log-v1',
        payload: summary,
        updated_at: summary.at,
      }]),
    });
  } catch {
    // Recovery logging must never block lead recovery.
  }
};

/**
 * Safety net for Meta Lead Ads. The live webhook remains the primary path.
 * This recovery scan replays recent lead IDs through the exact same order handler.
 * Existing platform_lead_id dedupe prevents duplicate orders.
 */
export const recoverRecentFacebookLeads = async (
  baseWorker: WorkerLike,
  envValue: unknown,
  ctx: unknown,
): Promise<RecoverySummary> => {
  const env = (envValue || {}) as Env;
  const summary: RecoverySummary = {
    page_id: '',
    forms_checked: 0,
    recent_leads_seen: 0,
    replayed: 0,
    failed: 0,
    errors: [],
    at: new Date().toISOString(),
  };

  if (text(env, 'META_LEADS_AUTO_ENABLED') === '0') {
    summary.errors.push('META_LEADS_AUTO_ENABLED is disabled.');
    await writeRecoveryLog(env, summary);
    return summary;
  }

  try {
    const me = await graph(env, 'me', { fields: 'id,name' });
    const pageId = String(me?.id || '').trim();
    if (!pageId) throw new Error('Meta Page ID could not be resolved from the Page token.');
    summary.page_id = pageId;

    const forms = await graph(env, `${pageId}/leadgen_forms`, { fields: 'id,name,status', limit: '100' });
    const productForms = (Array.isArray(forms?.data) ? forms.data : [])
      .filter((form: any) => /(?:^|[^A-Z0-9])R\d{4,}(?=$|[^A-Z0-9])/i.test(String(form?.name || '')))
      .slice(0, 100);
    summary.forms_checked = productForms.length;

    const cutoff = Date.now() - 72 * 60 * 60 * 1000;

    for (const form of productForms) {
      const formId = String(form?.id || '').trim();
      if (!formId) continue;

      let leads: any;
      try {
        leads = await graph(env, `${formId}/leads`, { fields: 'id,created_time', limit: '100' });
      } catch (error: any) {
        summary.failed += 1;
        summary.errors.push(`Form ${formId}: ${String(error?.message || error)}`);
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
            id: pageId,
            time: Math.floor(Date.now() / 1000),
            changes: [{ field: 'leadgen', value: { leadgen_id: leadId, form_id: formId, page_id: pageId } }],
          }],
        });
        const signature = await signBody(text(env, 'META_WEBHOOK_APP_SECRET'), body);
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (signature) headers['x-hub-signature-256'] = signature;

        try {
          const response = await baseWorker.fetch(new Request('https://ora.internal/api/integrations/meta/webhook', {
            method: 'POST', headers, body,
          }), envValue, ctx);
          if (response.ok) {
            summary.replayed += 1;
          } else {
            summary.failed += 1;
            const detail = await response.text().catch(() => '');
            summary.errors.push(`Lead ${leadId}: HTTP ${response.status}${detail ? ` ${detail.slice(0, 160)}` : ''}`);
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
  await writeRecoveryLog(env, summary);
  console.log(`[O-RA Meta recovery] forms=${summary.forms_checked}, recent=${summary.recent_leads_seen}, replayed=${summary.replayed}, failed=${summary.failed}`);
  return summary;
};
