type Env = Record<string, any>;
type WorkerLike = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };

type KnownForm = {
  id: string;
  name: string;
  page_id?: string;
  page_name?: string;
  access_token?: string;
};

type RecoverySummary = {
  forms_checked: number;
  recent_leads_seen: number;
  replayed: number;
  failed: number;
  errors: string[];
  at: string;
  pages?: Array<{ id: string; name: string; forms: number }>;
  forms?: Array<{ id: string; name: string; page_id?: string; page_name?: string }>;
};

const text = (env: Env, key: string) => String(env?.[key] || '').trim();

const graphWithToken = async (
  env: Env,
  token: string,
  path: string,
  params: Record<string, string> = {},
) => {
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

const graph = async (env: Env, path: string, params: Record<string, string> = {}) =>
  graphWithToken(env, text(env, 'META_PAGE_ACCESS_TOKEN'), path, params);

const supabaseRuntime = (env: Env) => ({
  url: text(env, 'VITE_SUPABASE_URL').replace(/\/$/, ''),
  key: text(env, 'SUPABASE_SECRET_KEY') || text(env, 'SUPABASE_SERVICE_ROLE_KEY'),
});

const readKnownForms = async (env: Env): Promise<KnownForm[]> => {
  const runtime = supabaseRuntime(env);
  if (!runtime.url || !runtime.key) throw new Error('Supabase server configuration is missing.');
  const url = new URL(`${runtime.url}/rest/v1/admin_data_store`);
  url.searchParams.set('key', 'eq.facebook-lead-auto-log-v1');
  url.searchParams.set('select', 'payload');
  const response = await fetch(url, {
    headers: { apikey: runtime.key, authorization: `Bearer ${runtime.key}`, accept: 'application/json' },
  });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read Facebook form history (${response.status}).`);
  const events = Array.isArray(rows?.[0]?.payload?.events) ? rows[0].payload.events : [];
  const forms = new Map<string, KnownForm>();
  for (const event of events) {
    const id = String(event?.form_id || '').trim();
    const name = String(event?.form_name || '').trim();
    if (id && /(?:^|[^A-Z0-9])R\d{4,}(?=$|[^A-Z0-9])/i.test(name)) forms.set(id, { id, name });
  }
  return Array.from(forms.values()).slice(0, 100);
};

const discoverAccessibleForms = async (
  env: Env,
  summary: RecoverySummary,
): Promise<KnownForm[]> => {
  const rootToken = text(env, 'META_PAGE_ACCESS_TOKEN');
  if (!rootToken) throw new Error('META_PAGE_ACCESS_TOKEN is missing.');

  const targets = new Map<string, KnownForm>();
  const pageDiagnostics: Array<{ id: string; name: string; forms: number }> = [];

  // If the configured token is a User token, /me/accounts returns every Page the
  // user can manage plus a Page token for each one. Scan all of them so changing
  // the Page used by an ad cannot silently stop recovery.
  try {
    const accounts = await graphWithToken(env, rootToken, 'me/accounts', {
      fields: 'id,name,access_token',
      limit: '100',
    });

    const pages = Array.isArray(accounts?.data) ? accounts.data : [];
    if (pages.length) {
      for (const page of pages) {
        const pageId = String(page?.id || '').trim();
        const pageName = String(page?.name || '').trim();
        const pageToken = String(page?.access_token || '').trim();
        if (!pageId || !pageToken) continue;

        try {
          const formsResponse = await graphWithToken(env, pageToken, `${pageId}/leadgen_forms`, {
            fields: 'id,name',
            limit: '100',
          });
          const forms = Array.isArray(formsResponse?.data) ? formsResponse.data : [];
          pageDiagnostics.push({ id: pageId, name: pageName, forms: forms.length });
          for (const form of forms) {
            const id = String(form?.id || '').trim();
            const name = String(form?.name || '').trim() || `Form ${id}`;
            if (id) targets.set(id, {
              id,
              name,
              page_id: pageId,
              page_name: pageName,
              access_token: pageToken,
            });
          }
        } catch (error: any) {
          summary.errors.push(`Page ${pageName || pageId}: ${String(error?.message || error)}`);
        }
      }

      summary.pages = pageDiagnostics;
      if (targets.size) return Array.from(targets.values());
    }
  } catch {
    // A Page token cannot list /me/accounts. Fall through and treat it as a Page token.
  }

  // Page-token mode: discover forms only for the Page represented by the token.
  const page = await graphWithToken(env, rootToken, 'me', { fields: 'id,name' });
  const pageId = String(page?.id || '').trim();
  const pageName = String(page?.name || '').trim();
  if (!pageId) throw new Error('Configured Meta token did not return a Page ID.');

  const formsResponse = await graphWithToken(env, rootToken, `${pageId}/leadgen_forms`, {
    fields: 'id,name',
    limit: '100',
  });
  const forms = Array.isArray(formsResponse?.data) ? formsResponse.data : [];
  summary.pages = [{ id: pageId, name: pageName, forms: forms.length }];

  for (const form of forms) {
    const id = String(form?.id || '').trim();
    const name = String(form?.name || '').trim() || `Form ${id}`;
    if (id) targets.set(id, {
      id,
      name,
      page_id: pageId,
      page_name: pageName,
      access_token: rootToken,
    });
  }
  return Array.from(targets.values());
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
    const runtime = supabaseRuntime(env);
    if (!runtime.url || !runtime.key) return;
    await fetch(`${runtime.url}/rest/v1/admin_data_store?on_conflict=key`, {
      method: 'POST',
      headers: {
        apikey: runtime.key,
        authorization: `Bearer ${runtime.key}`,
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
    // Logging must never block recovery.
  }
};

export const recoverRecentFacebookLeads = async (
  baseWorker: WorkerLike,
  envValue: unknown,
  ctx: unknown,
): Promise<RecoverySummary> => {
  const env = (envValue || {}) as Env;
  const summary: RecoverySummary = {
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
    let productForms: KnownForm[] = [];

    try {
      productForms = await discoverAccessibleForms(env, summary);
    } catch (error: any) {
      summary.errors.push(`Page/form discovery: ${String(error?.message || error)}`);
    }

    if (!productForms.length) {
      try {
        productForms = await readKnownForms(env);
      } catch (error: any) {
        summary.errors.push(`Historic form fallback: ${String(error?.message || error)}`);
      }
    }

    summary.forms_checked = productForms.length;
    summary.forms = productForms.slice(0, 50).map(({ id, name, page_id, page_name }) => ({
      id, name, page_id, page_name,
    }));
    if (!productForms.length) throw new Error('No Facebook lead forms are accessible to the configured Meta token.');

    const cutoff = Date.now() - 72 * 60 * 60 * 1000;

    for (const form of productForms) {
      let leads: any;
      const formToken = form.access_token || text(env, 'META_PAGE_ACCESS_TOKEN');
      try {
        leads = await graphWithToken(env, formToken, `${form.id}/leads`, {
          fields: 'id,created_time',
          limit: '100',
        });
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
            id: form.page_id || '',
            time: Math.floor(Date.now() / 1000),
            changes: [{ field: 'leadgen', value: {
              leadgen_id: leadId,
              form_id: form.id,
              page_id: form.page_id || '',
            } }],
          }],
        });
        const signature = await signBody(text(env, 'META_WEBHOOK_APP_SECRET'), body);
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (signature) headers['x-hub-signature-256'] = signature;

        try {
          const replayEnv = form.access_token
            ? { ...env, META_PAGE_ACCESS_TOKEN: form.access_token }
            : envValue;
          const response = await baseWorker.fetch(new Request('https://ora.internal/api/integrations/facebook-leads/webhook', {
            method: 'POST', headers, body,
          }), replayEnv, ctx);
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
  summary.errors = summary.errors.slice(0, 30);
  await writeRecoveryLog(env, summary);
  console.log(`[O-RA Meta recovery] pages=${summary.pages?.length || 0}, forms=${summary.forms_checked}, recent=${summary.recent_leads_seen}, replayed=${summary.replayed}, failed=${summary.failed}`);
  return summary;
};
