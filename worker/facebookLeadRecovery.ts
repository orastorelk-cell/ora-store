type Env = Record<string, any>;
type WorkerLike = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };

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

/**
 * Recovery path for Meta Lead Ads.
 * The normal webhook remains the primary path. Every run asks Meta for recent leads
 * and replays only recent Rxxxx product-form lead IDs through the existing webhook
 * handler. Existing lead IDs are already deduplicated by facebookLeadAuto.ts, so this
 * safely fills webhook gaps without changing normal order/sheet logic.
 */
export const recoverRecentFacebookLeads = async (
  baseWorker: WorkerLike,
  envValue: unknown,
  ctx: unknown,
) => {
  const env = (envValue || {}) as Env;
  if (text(env, 'META_LEADS_AUTO_ENABLED') === '0') return;

  const me = await graph(env, 'me', { fields: 'id,name' });
  const pageId = String(me?.id || '').trim();
  if (!pageId) throw new Error('Meta Page ID could not be resolved from the Page token.');

  const forms = await graph(env, `${pageId}/leadgen_forms`, { fields: 'id,name,status', limit: '100' });
  const productForms = (Array.isArray(forms?.data) ? forms.data : [])
    .filter((form: any) => /(?:^|[^A-Z0-9])R\d{4,}(?=$|[^A-Z0-9])/i.test(String(form?.name || '')))
    .slice(0, 100);

  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  let replayed = 0;

  for (const form of productForms) {
    const formId = String(form?.id || '').trim();
    if (!formId) continue;
    const leads = await graph(env, `${formId}/leads`, { fields: 'id,created_time', limit: '100' });
    for (const lead of Array.isArray(leads?.data) ? leads.data : []) {
      const leadId = String(lead?.id || '').trim();
      const created = Date.parse(String(lead?.created_time || ''));
      if (!leadId || !Number.isFinite(created) || created < cutoff) continue;

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

      const response = await baseWorker.fetch(new Request('https://ora.internal/api/integrations/meta/webhook', {
        method: 'POST', headers, body,
      }), envValue, ctx);
      if (response.ok) replayed += 1;
    }
  }

  console.log(`[O-RA Meta recovery] checked ${productForms.length} forms, replayed ${replayed} recent lead event(s).`);
};
