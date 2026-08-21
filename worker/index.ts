import { httpServerHandler } from 'cloudflare:node';
import { waitUntil } from 'cloudflare:workers';
import app from '../server';

// Express remains the source of truth for order persistence/auth/business rules.
// This Worker only guarantees the final Google Sheet mirror after a durable save.
(globalThis as any).__ORA_WAIT_UNTIL__ = waitUntil;

app.listen(3000);
const nodeHandler: any = httpServerHandler({ port: 3000 });
const nativeFetch = globalThis.fetch.bind(globalThis);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const makeJsonResponse = (data: unknown, original: Response) => new Response(JSON.stringify(data), {
  status: original.status,
  statusText: original.statusText,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

type SheetRuntime = {
  supabaseUrl: string;
  supabaseKey: string;
  webhook: string;
};

const parseJsonText = async (response: Response) => {
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { text, data };
};

const getSheetRuntime = async (envValue: unknown): Promise<SheetRuntime> => {
  const env = (envValue || {}) as Record<string, string | undefined>;
  const supabaseUrl = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase server configuration is missing.');

  const response = await nativeFetch(
    `${supabaseUrl}/rest/v1/admin_data_store?key=eq.storefront-state-v1&select=payload`,
    {
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        accept: 'application/json',
      },
    },
  );
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read shared Store Settings (${response.status}).`);
  const settings = rows?.[0]?.payload?.settings || {};
  const webhook = String(settings?.google_sheet_webhook_url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook)) {
    throw new Error('Shared Google Sheet Web App URL is missing or invalid.');
  }
  return { supabaseUrl, supabaseKey, webhook };
};

const postAppsScript = async (runtime: SheetRuntime, payload: Record<string, any>) => {
  const response = await nativeFetch(runtime.webhook, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain;charset=utf-8',
      accept: 'application/json,text/plain,*/*',
    },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const { text, data } = await parseJsonText(response);
  if (!response.ok) throw new Error(`Google Apps Script HTTP ${response.status}: ${text.slice(0, 240)}`);
  if (!text || !Object.keys(data || {}).length) throw new Error(`Google Apps Script returned non-JSON: ${text.slice(0, 240)}`);
  if (data?.ok === false || String(data?.status || '').toLowerCase() === 'error') {
    throw new Error(data?.message || data?.error || 'Google Apps Script returned an error.');
  }
  return data;
};

const markPersistedOrder = async (runtime: SheetRuntime, order: any) => {
  const id = String(order?.id || '').trim();
  if (!id) return;
  const response = await nativeFetch(
    `${runtime.supabaseUrl}/rest/v1/order_snapshots?order_id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: runtime.supabaseKey,
        authorization: `Bearer ${runtime.supabaseKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ payload: order, updated_at: new Date().toISOString() }),
    },
  );
  if (!response.ok) throw new Error(`Could not update durable order sync state (${response.status}).`);
};

const confirmPhysicalOrderRows = async (runtime: SheetRuntime, orderNumber: string, expectedRows: number) => {
  const check = await postAppsScript(runtime, { action: 'read_order', orderId: orderNumber });
  const rows = Number(check?.rows || 0);
  if (check?.found !== true || rows < Math.max(1, expectedRows)) {
    throw new Error(`Google Sheet read-back failed for ${orderNumber}. Expected ${Math.max(1, expectedRows)} row(s), found ${rows}.`);
  }
  return check;
};

const syncSavedOrder = async (runtime: SheetRuntime, order: any) => {
  const orderNumber = String(order?.order_number || '').trim();
  if (!orderNumber) throw new Error('Saved order has no order number.');
  const itemCount = Array.isArray(order?.items) && order.items.length ? order.items.length : 1;

  // Send the durable final order snapshot. Clean V1 owns row layout only;
  // it does not recalculate website prices/discounts/offers.
  const result = await postAppsScript(runtime, { action: 'sync_orders', order });
  if (String(result?.status || '') !== 'orders_synced' || Number(result?.rows || 0) < itemCount) {
    throw new Error(`Google Sheet sync did not confirm all rows for ${orderNumber}.`);
  }

  const physical = await confirmPhysicalOrderRows(runtime, orderNumber, itemCount);
  const syncedAt = new Date().toISOString();
  const syncedOrder = {
    ...order,
    is_synced_google_sheets: true,
    synced_at: syncedAt,
    sheet_sync_verified_at: syncedAt,
  };
  await markPersistedOrder(runtime, syncedOrder);

  return {
    syncedOrder,
    sheetSync: {
      ok: true,
      confirmed: true,
      status: result.status,
      version: result.version || null,
      rows: Number(physical?.rows || result?.rows || itemCount),
      synced: Number(result?.synced || 1),
      spreadsheet_id: physical?.spreadsheet_id || result?.spreadsheet_id || null,
      spreadsheet_name: physical?.spreadsheet_name || result?.spreadsheet_name || null,
      path: 'clean-v1-worker-confirmed',
    },
  };
};

const guaranteeNewOrderSheetSync = async (request: Request, env: unknown, response: Response): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/orders' || !response.ok) return response;

  let data: any = {};
  try { data = await response.clone().json(); } catch { return response; }
  const order = data?.order;
  if (!order) return response;

  // Respect server eligibility. Never trust a historical is_synced_google_sheets flag
  // as proof that a physical Sheet row still exists.
  const shouldMirror = data?.sheet_sync?.queued === true || data?.sheet_sync?.ok === true;
  if (!shouldMirror) return response;

  try {
    const runtime = await getSheetRuntime(env);
    const { syncedOrder, sheetSync } = await syncSavedOrder(runtime, order);
    return makeJsonResponse({ ...data, order: syncedOrder, sheet_sync: sheetSync }, response);
  } catch (error: any) {
    const unsyncedOrder = { ...order, is_synced_google_sheets: false, synced_at: undefined };
    try {
      const runtime = await getSheetRuntime(env);
      await markPersistedOrder(runtime, unsyncedOrder);
    } catch {}
    return makeJsonResponse({
      ...data,
      order: unsyncedOrder,
      sheet_sync: {
        ok: false,
        confirmed: false,
        error: String(error?.message || error || 'Google Sheet sync failed.'),
        path: 'clean-v1-worker-confirmed',
      },
    }, response);
  }
};

const sheetDiagnostic = async (request: Request, env: unknown): Promise<Response | null> => {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/google-sheets/diagnostic') return null;
  try {
    const runtime = await getSheetRuntime(env);
    if (url.searchParams.get('write') !== '1') {
      const health = await postAppsScript(runtime, { action: 'health' });
      return json({
        ok: true,
        stage: 'clean_v1_health',
        apps_script_status: health?.status || null,
        apps_script_version: health?.version || null,
        spreadsheet_id: health?.spreadsheet_id || null,
        spreadsheet_name: health?.spreadsheet_name || null,
      });
    }

    const id = `ORA-DIAG-${Date.now()}`;
    const order = {
      id: `diag-${Date.now()}`,
      order_number: id,
      customer_name: 'O-RA CLEAN V1 DIAGNOSTIC',
      phone: '0770000000',
      whatsapp: '0770000000',
      address: 'SAFE TO DELETE',
      city: 'Colombo',
      district: 'Colombo',
      order_source: 'Website',
      payment_method: 'COD',
      subtotal: 1,
      delivery_fee: 0,
      special_offer_discount: 0,
      total_amount: 1,
      created_at: new Date().toISOString(),
      call_center_status: 'Pending',
      items: [{ product_name: 'Clean V1 Diagnostic', main_sku: 'DIAG-001', sku: 'DIAG-001', variant_name: '', quantity: 1, unit_price: 1, subtotal: 1 }],
    };
    const result = await postAppsScript(runtime, { action: 'sync_orders', order });
    const physical = await confirmPhysicalOrderRows(runtime, id, 1);
    return json({
      ok: true,
      stage: 'clean_v1_write_verified',
      diagnostic_order_id: id,
      apps_script_status: result?.status || null,
      apps_script_version: result?.version || null,
      rows: physical?.rows || 0,
      spreadsheet_id: physical?.spreadsheet_id || result?.spreadsheet_id || null,
      spreadsheet_name: physical?.spreadsheet_name || result?.spreadsheet_name || null,
    });
  } catch (error: any) {
    return json({ ok: false, stage: 'clean_v1_error', error: String(error?.message || error || 'Unknown Google Sheet error.') }, 500);
  }
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const diagnostic = await sheetDiagnostic(request, env);
    if (diagnostic) return diagnostic;

    const response = await nodeHandler.fetch(request, env, ctx);
    return guaranteeNewOrderSheetSync(request, env, response);
  },
};
