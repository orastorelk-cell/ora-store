import type { Order, Product, ProductVariant, StoreSettings } from '../src/types';
import {
  buildOrderItemSnapshot,
  displayUnitPrice,
  findProductSelection,
  normalizedProductType,
} from '../src/lib/productVariants';

type Env = Record<string, any>;

type Runtime = {
  supabaseUrl: string;
  supabaseKey: string;
};

type LeadEvent = {
  leadgen_id: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  adgroup_id?: string;
};

type BaseWorker = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response>;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const envText = (env: Env, key: string) => String(env?.[key] || '').trim();

const getRuntime = (env: Env): Runtime => {
  const supabaseUrl = envText(env, 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const supabaseKey = envText(env, 'SUPABASE_SECRET_KEY') || envText(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase server configuration is missing.');
  return { supabaseUrl, supabaseKey };
};

const supabaseHeaders = (runtime: Runtime) => ({
  apikey: runtime.supabaseKey,
  authorization: `Bearer ${runtime.supabaseKey}`,
  accept: 'application/json',
});

const readStorefront = async (runtime: Runtime): Promise<{ products: Product[]; settings: StoreSettings }> => {
  const url = new URL(`${runtime.supabaseUrl}/rest/v1/admin_data_store`);
  url.searchParams.set('key', 'eq.storefront-state-v1');
  url.searchParams.set('select', 'payload');
  const response = await fetch(url, { headers: supabaseHeaders(runtime) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read storefront state (${response.status}).`);
  const payload = rows?.[0]?.payload || {};
  return {
    products: Array.isArray(payload?.products) ? payload.products : [],
    settings: (payload?.settings && typeof payload.settings === 'object') ? payload.settings : {} as StoreSettings,
  };
};

const readExistingLeadOrder = async (runtime: Runtime, leadId: string): Promise<any | null> => {
  const url = new URL(`${runtime.supabaseUrl}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'order_id,order_number,payload');
  url.searchParams.set('payload->>platform_lead_id', `eq.${leadId}`);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers: supabaseHeaders(runtime) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not check Facebook Lead ID history (${response.status}).`);
  return rows?.[0]?.payload || null;
};

const normalizePhone = (value: unknown) =>
  String(value || '').replace(/\D/g, '').replace(/^94(?=7\d{8}$)/, '0');

const fingerprint = (phone: string, item: Order['items'][number]) =>
  `${normalizePhone(phone)}::${item.product_id}:${item.variant_id || 'base'}:${Math.max(1, Number(item.quantity || 1))}`;

const readRecentDuplicate = async (
  runtime: Runtime,
  phone: string,
  item: Order['items'][number],
): Promise<any | null> => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = new URL(`${runtime.supabaseUrl}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('created_at', `gte.${cutoff}`);
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '500');
  const response = await fetch(url, { headers: supabaseHeaders(runtime) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) return null;
  const target = fingerprint(phone, item);
  return rows
    .map((row) => row?.payload)
    .find((order) => {
      if (!order || order.order_status === 'Cancelled') return false;
      const first = Array.isArray(order.items) ? order.items[0] : null;
      if (!first) return false;
      const existing = String(order.duplicate_fingerprint || fingerprint(String(order.phone || ''), first));
      return existing === target;
    }) || null;
};

const appendLog = async (
  runtime: Runtime,
  entry: Record<string, unknown>,
) => {
  try {
    const key = 'facebook-lead-auto-log-v1';
    const readUrl = new URL(`${runtime.supabaseUrl}/rest/v1/admin_data_store`);
    readUrl.searchParams.set('key', `eq.${key}`);
    readUrl.searchParams.set('select', 'payload');
    const currentResponse = await fetch(readUrl, { headers: supabaseHeaders(runtime) });
    const rows: any[] = await currentResponse.json().catch(() => []);
    const current = Array.isArray(rows?.[0]?.payload?.events) ? rows[0].payload.events : [];
    const events = [{ at: new Date().toISOString(), ...entry }, ...current].slice(0, 100);

    const writeUrl = new URL(`${runtime.supabaseUrl}/rest/v1/admin_data_store`);
    writeUrl.searchParams.set('on_conflict', 'key');
    await fetch(writeUrl, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(runtime),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{
        key,
        payload: { events },
        updated_at: new Date().toISOString(),
      }]),
    });
  } catch {
    // Logging must never block or mutate the normal store/order paths.
  }
};

const graphGet = async (env: Env, path: string, fields: string) => {
  const accessToken = envText(env, 'META_PAGE_ACCESS_TOKEN');
  const version = envText(env, 'META_GRAPH_API_VERSION');
  if (!accessToken) throw new Error('META_PAGE_ACCESS_TOKEN is not configured.');
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('META_GRAPH_API_VERSION is not configured (example: vXX.X).');

  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(path)}`);
  url.searchParams.set('fields', fields);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Meta Graph API ${response.status}`);
  }
  return data;
};

const graphListGet = async (env: Env, path: string, fields: string, limit = 100) => {
  const accessToken = envText(env, 'META_PAGE_ACCESS_TOKEN');
  const version = envText(env, 'META_GRAPH_API_VERSION');
  if (!accessToken) throw new Error('META_PAGE_ACCESS_TOKEN is not configured.');
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('META_GRAPH_API_VERSION is not configured (example: vXX.X).');

  const safePath = String(path || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  const url = new URL(`https://graph.facebook.com/${version}/${safePath}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('limit', String(Math.max(1, Math.min(100, limit))));
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Meta Graph API ${response.status}`);
  }
  return data;
};

const normalizeFieldName = (value: unknown) =>
  String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const metaFieldMap = (fieldData: any[]) => {
  const rows = new Map<string, string>();
  for (const field of Array.isArray(fieldData) ? fieldData : []) {
    const name = normalizeFieldName(field?.name);
    const values = Array.isArray(field?.values) ? field.values : [];
    if (name) rows.set(name, String(values?.[0] ?? '').trim());
  }
  return rows;
};

const pickField = (map: Map<string, string>, names: string[]) => {
  for (const name of names) {
    const exact = map.get(name);
    if (exact) return exact;
  }
  for (const [key, value] of map.entries()) {
    if (value && names.some((name) => key.includes(name))) return value;
  }
  return '';
};

const parseQuantity = (value: string) => {
  const match = String(value || '').match(/\d+/);
  const qty = match ? Number(match[0]) : 0;
  return Number.isFinite(qty) ? Math.min(99, Math.max(0, qty)) : 0;
};

const detectItemCode = (formName: unknown) => {
  const match = String(formName || '').toUpperCase().match(/(?:^|[^A-Z0-9])(R\d{4,})(?=$|[^A-Z0-9])/);
  return match?.[1] || '';
};

const multiBuyRate = (qty: number, settings: StoreSettings) => {
  if (settings.multi_buy_discount_enabled === false || qty <= 1) return 0;
  const t1Min = Math.max(2, Number(settings.multi_buy_tier1_min ?? 2));
  const t1Max = Math.max(t1Min, Number(settings.multi_buy_tier1_max ?? 3));
  const t1Rate = Math.max(0, Math.min(100, Number(settings.multi_buy_tier1_rate ?? 5)));
  const t2Min = Math.max(t1Max + 1, Number(settings.multi_buy_tier2_min ?? 4));
  const t2Max = Math.max(t2Min, Number(settings.multi_buy_tier2_max ?? 5));
  const t2Rate = Math.max(0, Math.min(100, Number(settings.multi_buy_tier2_rate ?? 7.5)));
  const t3Min = Math.max(t2Max + 1, Number(settings.multi_buy_tier3_min ?? 6));
  const t3Rate = Math.max(0, Math.min(100, Number(settings.multi_buy_tier3_rate ?? 10)));
  if (qty >= t1Min && qty <= t1Max) return t1Rate;
  if (qty >= t2Min && qty <= t2Max) return t2Rate;
  if (qty >= t3Min) return t3Rate;
  return 0;
};

const buildPendingLeadItem = (
  products: Product[],
  settings: StoreSettings,
  code: string,
  variantValue: string,
  quantity: number,
): Order['items'][number] => {
  const selection = findProductSelection(products, code, variantValue);
  if (!selection) throw new Error(`Product ${code} was not found in the O-RA catalog.`);

  if (normalizedProductType(selection.product) === 'variant' && !selection.variant) {
    // Match the current CSV lead-import behavior: a pending lead may carry the
    // main code only. Call Center can choose the exact variant during confirmation.
    const unitPrice = displayUnitPrice(selection.product, settings);
    return {
      product_id: selection.product.id,
      product_name: selection.product.name_en,
      sku: selection.product.sku,
      main_sku: selection.product.sku,
      variant_name: variantValue || undefined,
      product_type: 'variant',
      buying_price: Number(selection.product.buying_price || 0),
      unit_price: unitPrice,
      quantity,
      subtotal: unitPrice * quantity,
      image: selection.product.images?.[0],
    };
  }

  return buildOrderItemSnapshot(
    selection.product,
    quantity,
    settings,
    selection.variant as ProductVariant | undefined,
    products,
  );
};

const buildFacebookOrder = async (
  runtime: Runtime,
  lead: any,
  form: any,
  event: LeadEvent,
): Promise<Order> => {
  const { products, settings } = await readStorefront(runtime);
  const code = detectItemCode(form?.name);
  if (!code) throw new Error(`Form name "${String(form?.name || '')}" does not start with a valid R item code.`);

  const fields = metaFieldMap(lead?.field_data);
  const customerName = pickField(fields, ['full_name', 'customer_name', 'name']);
  const phone = pickField(fields, ['phone_number', 'phone', 'mobile_number', 'mobile']);
  const whatsapp = pickField(fields, ['whatsapp_number', 'whatsapp_phone', 'whatsapp', 'wa_number']) || phone;
  const address = pickField(fields, ['full_address', 'customer_address', 'address', 'street_address']);
  const city = pickField(fields, ['city', 'town']);
  const district = pickField(fields, ['district']);
  const variantValue = pickField(fields, ['selected_color', 'color', 'colour', 'variant', 'option']);
  const quantityRaw = pickField(fields, ['quantity', 'qty']);
  const quantity = parseQuantity(quantityRaw);
  const note = pickField(fields, ['notes', 'note', 'message', 'comment']);

  if (!customerName) throw new Error('Customer name is missing in the Facebook lead.');
  if (!phone) throw new Error('Phone number is missing in the Facebook lead.');
  if (!address) throw new Error('Address is missing in the Facebook lead.');
  if (!city) throw new Error('City is missing in the Facebook lead.');
  if (quantity < 1) throw new Error('Quantity is missing or invalid in the Facebook lead.');

  const item = buildPendingLeadItem(products, settings, code, variantValue, quantity);
  const subtotal = Number(item.subtotal || 0);
  const internalDeliveryFee = Math.max(0, Number(settings.delivery_fee || 0));
  const deliveryFee = settings.free_delivery_enabled ? 0 : internalDeliveryFee;
  const discountRate = multiBuyRate(quantity, settings);
  const specialOfferDiscount = Math.round(subtotal * (discountRate / 100) * 100) / 100;
  const totalAmount = Math.round(Math.max(0, subtotal - specialOfferDiscount + deliveryFee));
  const threshold = Math.max(0, Number(settings.advance_qty_threshold ?? 4));
  const pct = Math.min(100, Math.max(1, Number(settings.advance_percentage ?? 50)));
  const importedAt = new Date().toISOString();
  const createdAt = String(lead?.created_time || importedAt);
  const duplicate = await readRecentDuplicate(runtime, phone, item);
  const duplicateFingerprint = fingerprint(phone, item);
  const safeLeadId = String(lead?.id || event.leadgen_id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);

  return {
    id: `fb-lead-${safeLeadId}`,
    order_number: 'FB-000000',
    customer_name: customerName,
    phone,
    whatsapp,
    address,
    city,
    district: district || undefined,
    payment_method: 'COD',
    payment_status: 'Pending',
    order_status: 'New Orders',
    items: [item],
    subtotal,
    delivery_fee: deliveryFee,
    internal_delivery_fee: internalDeliveryFee,
    delivery_included_in_item_price: Boolean(settings.free_delivery_enabled),
    special_offer_discount: specialOfferDiscount,
    gift_wrap_selected: false,
    gift_wrap_fee: 0,
    total_amount: totalAmount,
    is_advance_required: quantity > threshold,
    advance_amount: quantity > threshold ? Math.round(totalAmount * pct / 100) : 0,
    advance_confirmed: false,
    order_source: 'Facebook Ads',
    is_synced_google_sheets: false,
    call_center_status: 'Pending',
    stock_status: 'Waiting for Stock',
    stock_allocated: false,
    is_duplicate_order: Boolean(duplicate),
    duplicate_of_order_id: duplicate?.id,
    duplicate_fingerprint: duplicateFingerprint,
    dispatch_status: 'Not Scanned',
    notes: [
      'Facebook Auto Lead',
      `Form: ${String(form?.name || '')}`,
      event.ad_id ? `Ad ID: ${event.ad_id}` : '',
      note,
    ].filter(Boolean).join(' | '),
    created_at: createdAt,
    platform_lead_id: String(lead?.id || event.leadgen_id),
    platform_lead_created_at: createdAt,
    lead_import_key: `facebook ads::lead::${String(lead?.id || event.leadgen_id)}`.toLowerCase(),
    lead_imported_at: importedAt,
  };
};

const callOrderSave = async (
  baseWorker: BaseWorker,
  request: Request,
  env: unknown,
  ctx: unknown,
  order: Order,
) => {
  const url = new URL('/api/orders', request.url);
  const body = JSON.stringify({ order, wait_sheet_sync: true });
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  const inner = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(bodyBytes),
      'x-ora-integration': 'facebook-leads',
    },
    body,
  });
  const response = await baseWorker.fetch(inner, env, ctx);
  const data: any = await response.clone().json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const preflight = `id=${Boolean(order?.id)} no=${Boolean(order?.order_number)} name=${Boolean(order?.customer_name)} items=${Array.isArray(order?.items)} count=${Array.isArray(order?.items) ? order.items.length : 0}`;
    throw new Error(`${data?.error || `O-RA order save failed (${response.status}).`} [${preflight}]`);
  }
  return data;
};

const retryExistingUnsyncedOrder = async (
  baseWorker: BaseWorker,
  request: Request,
  env: unknown,
  ctx: unknown,
  order: any,
) => {
  if (!order || order.is_synced_google_sheets === true) return { skipped: true, order };
  return callOrderSave(baseWorker, request, env, ctx, order as Order);
};

const processLead = async (
  event: LeadEvent,
  request: Request,
  env: Env,
  ctx: unknown,
  baseWorker: BaseWorker,
) => {
  const runtime = getRuntime(env);
  const existing = await readExistingLeadOrder(runtime, event.leadgen_id);
  if (existing) {
    const retry = await retryExistingUnsyncedOrder(baseWorker, request, env, ctx, existing);
    await appendLog(runtime, {
      lead_id: event.leadgen_id,
      result: existing.is_synced_google_sheets === true ? 'duplicate_ignored' : 'duplicate_sheet_retry',
      order_number: existing.order_number || '',
      sheet_ok: retry?.sheet_sync?.ok ?? existing.is_synced_google_sheets === true,
    });
    return;
  }

  const lead = await graphGet(env, event.leadgen_id, 'id,created_time,field_data,form_id');
  const formId = String(event.form_id || lead?.form_id || '').trim();
  if (!formId) throw new Error('Facebook webhook/lead did not include a Form ID.');
  const form = await graphGet(env, formId, 'id,name');
  const code = detectItemCode(form?.name);

  try {
    const order = await buildFacebookOrder(runtime, lead, form, event);
    const saved = await callOrderSave(baseWorker, request, env, ctx, order);
    await appendLog(runtime, {
      lead_id: event.leadgen_id,
      form_id: formId,
      form_name: String(form?.name || ''),
      item_code: code,
      result: saved?.sheet_sync?.ok === false ? 'order_saved_sheet_pending' : 'order_saved',
      order_number: saved?.order?.order_number || '',
      sheet_ok: saved?.sheet_sync?.ok !== false,
    });
  } catch (error: any) {
    await appendLog(runtime, {
      lead_id: event.leadgen_id,
      form_id: formId,
      form_name: String(form?.name || ''),
      item_code: code,
      result: 'blocked_no_order_created',
      error: String(error?.message || error || 'Facebook lead import failed.').slice(0, 500),
    });
    throw error;
  }
};

const extractLeadEvents = (body: any): LeadEvent[] => {
  const out: LeadEvent[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (String(change?.field || '') !== 'leadgen') continue;
      const value = change?.value || {};
      const leadgenId = String(value?.leadgen_id || '').trim();
      if (!leadgenId) continue;
      out.push({
        leadgen_id: leadgenId,
        form_id: String(value?.form_id || '').trim() || undefined,
        page_id: String(value?.page_id || entry?.id || '').trim() || undefined,
        ad_id: String(value?.ad_id || '').trim() || undefined,
        adgroup_id: String(value?.adgroup_id || '').trim() || undefined,
      });
    }
  }
  return Array.from(new Map(out.map((event) => [event.leadgen_id, event])).values()).slice(0, 50);
};

const readAllExistingFacebookLeadIds = async (runtime: Runtime) => {
  const url = new URL(`${runtime.supabaseUrl}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '2000');
  const response = await fetch(url, { headers: supabaseHeaders(runtime) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read existing Facebook Lead IDs (${response.status}).`);
  return new Set(
    rows
      .map((row) => String(row?.payload?.platform_lead_id || '').trim())
      .filter(Boolean),
  );
};

const TEMP_BACKFILL_PAGE_ID = '1299145169953538';
const TEMP_BACKFILL_CUTOFF_MS = Date.parse('2026-09-02T07:29:40.780Z');

const runTemporaryFacebookBackfill = async (
  request: Request,
  env: Env,
  ctx: unknown,
  baseWorker: BaseWorker,
) => {
  const runtime = getRuntime(env);
  const formResponse = await graphListGet(
    env,
    `${TEMP_BACKFILL_PAGE_ID}/leadgen_forms`,
    'id,name,status',
    100,
  );
  const forms = (Array.isArray(formResponse?.data) ? formResponse.data : [])
    .filter((form: any) => detectItemCode(form?.name));

  const events = new Map<string, LeadEvent>();
  for (const form of forms) {
    const formId = String(form?.id || '').trim();
    if (!formId) continue;
    const leadResponse = await graphListGet(
      env,
      `${formId}/leads`,
      'id,created_time,form_id',
      100,
    );
    for (const lead of Array.isArray(leadResponse?.data) ? leadResponse.data : []) {
      const leadId = String(lead?.id || '').trim();
      const createdMs = Date.parse(String(lead?.created_time || ''));
      if (!leadId || !Number.isFinite(createdMs) || createdMs < TEMP_BACKFILL_CUTOFF_MS) continue;
      events.set(leadId, {
        leadgen_id: leadId,
        form_id: String(lead?.form_id || formId).trim() || formId,
        page_id: TEMP_BACKFILL_PAGE_ID,
      });
    }
  }

  const ordered = Array.from(events.values()).sort((a, b) => a.leadgen_id.localeCompare(b.leadgen_id));
  const existingLeadIds = await readAllExistingFacebookLeadIds(runtime);
  const missing = ordered.filter((event) => !existingLeadIds.has(event.leadgen_id));
  const batch = missing.slice(0, 2);

  let imported = 0;
  let failed = 0;
  const failures: Array<{ lead_id: string; error: string }> = [];

  for (const event of batch) {
    try {
      await processLead(event, request, env, ctx, baseWorker);
      imported += 1;
    } catch (error: any) {
      failed += 1;
      failures.push({
        lead_id: event.leadgen_id,
        error: String(error?.message || error || 'Backfill failed.').slice(0, 500),
      });
    }
  }

  const remaining = Math.max(0, missing.length - imported);
  return {
    ok: failed === 0,
    mode: 'temporary_real_lead_backfill',
    cutoff: new Date(TEMP_BACKFILL_CUTOFF_MS).toISOString(),
    forms_checked: forms.length,
    lead_candidates: ordered.length,
    already_in_system: ordered.length - missing.length,
    attempted_this_run: batch.length,
    imported_this_run: imported,
    failed_this_run: failed,
    remaining,
    run_again: remaining > 0,
    failures,
  };
};

export const facebookLeadAutoHandler = async (
  request: Request,
  envValue: unknown,
  ctx: unknown,
  baseWorker: BaseWorker,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const webhookPath = '/api/integrations/facebook-leads/webhook';
  const statusPath = '/api/integrations/facebook-leads/status';
  const backfillPath = '/api/integrations/facebook-leads/backfill-20260903';
  const backfillAllPath = '/api/integrations/facebook-leads/backfill-all-20260903';
  const env = (envValue || {}) as Env;

  if (request.method === 'GET' && url.pathname === backfillAllPath) {
    const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>O-RA Facebook Backfill</title></head>
<body style="font-family:Arial,sans-serif;padding:24px;max-width:760px;margin:auto">
  <h2>O-RA Facebook Lead Backfill</h2>
  <p id="status">Starting…</p>
  <pre id="log" style="white-space:pre-wrap;background:#f6f6f6;padding:16px;border-radius:10px"></pre>
  <script>
    (async () => {
      const status = document.getElementById('status');
      const log = document.getElementById('log');
      let runs = 0;
      while (runs < 20) {
        runs += 1;
        status.textContent = 'Importing missing Facebook leads… run ' + runs;
        const res = await fetch('/api/integrations/facebook-leads/backfill-20260903', { cache:'no-store' });
        const data = await res.json().catch(() => ({ ok:false, error:'Invalid response' }));
        log.textContent += JSON.stringify(data) + '\\n';
        if (!res.ok || data.failed_this_run > 0 || data.ok === false) {
          status.textContent = 'Stopped because an error occurred.';
          return;
        }
        if (!data.run_again || Number(data.remaining || 0) <= 0) {
          status.textContent = 'DONE — all missing leads were processed.';
          return;
        }
        await new Promise(r => setTimeout(r, 700));
      }
      status.textContent = 'Stopped after safety limit.';
    })().catch((error) => {
      document.getElementById('status').textContent = 'Stopped because an error occurred.';
      document.getElementById('log').textContent += String(error);
    });
  </script>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  if (request.method === 'GET' && url.pathname === backfillPath) {
    try {
      const result = await runTemporaryFacebookBackfill(request, env, ctx, baseWorker);
      return json(result, result.ok ? 200 : 207);
    } catch (error: any) {
      return json({
        ok: false,
        mode: 'temporary_real_lead_backfill',
        error: String(error?.message || error || 'Backfill failed.').slice(0, 500),
      }, 500);
    }
  }

  if (request.method === 'GET' && url.pathname === statusPath) {
    return json({
      ok: true,
      integration: 'facebook-leads',
      auto_import_enabled: envText(env, 'META_LEADS_AUTO_ENABLED') === '1',
      verify_token_configured: Boolean(envText(env, 'META_LEADS_VERIFY_TOKEN')),
      access_token_configured: Boolean(envText(env, 'META_PAGE_ACCESS_TOKEN')),
      graph_version_configured: /^v\d+\.\d+$/.test(envText(env, 'META_GRAPH_API_VERSION')),
      webhook_path: webhookPath,
      temporary_backfill_available: true,
    });
  }

  if (url.pathname !== webhookPath) return null;

  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode') || '';
    const token = url.searchParams.get('hub.verify_token') || '';
    const challenge = url.searchParams.get('hub.challenge') || '';
    const configured = envText(env, 'META_LEADS_VERIFY_TOKEN');
    if (mode === 'subscribe' && configured && token === configured) {
      return new Response(challenge, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return json({ error: configured ? 'Facebook webhook verification failed.' : 'Facebook webhook verify token is not configured.' }, configured ? 403 : 503);
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const body: any = await request.clone().json().catch(() => null);
  if (!body || String(body?.object || '') !== 'page') {
    return json({ received: true, ignored: true, reason: 'Not a Facebook Page webhook.' });
  }

  const events = extractLeadEvents(body);
  if (!events.length) return json({ received: true, lead_events: 0 });

  // Hard safety gate: deployment alone cannot create a single order.
  if (envText(env, 'META_LEADS_AUTO_ENABLED') !== '1') {
    return json({ received: true, lead_events: events.length, auto_import: false });
  }

  // Do not acknowledge an enabled-but-broken configuration as healthy.
  const missing = [
    !envText(env, 'META_PAGE_ACCESS_TOKEN') ? 'META_PAGE_ACCESS_TOKEN' : '',
    !/^v\d+\.\d+$/.test(envText(env, 'META_GRAPH_API_VERSION')) ? 'META_GRAPH_API_VERSION' : '',
  ].filter(Boolean);
  if (missing.length) return json({ error: `Facebook Auto Lead is enabled but missing: ${missing.join(', ')}` }, 503);

  const job = (async () => {
    for (const event of events) {
      try {
        await processLead(event, request, env, ctx, baseWorker);
      } catch (error) {
        console.error('Facebook Auto Lead processing failed:', event.leadgen_id, error);
      }
    }
  })();

  const waitUntil = (ctx as any)?.waitUntil;
  if (typeof waitUntil === 'function') {
    waitUntil.call(ctx, job);
    return json({ received: true, lead_events: events.length, auto_import: true, processing: 'background' });
  }

  await job;
  return json({ received: true, lead_events: events.length, auto_import: true, processing: 'completed' });
};
