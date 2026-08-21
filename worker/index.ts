import baseWorker from './indexBase';

// Final safety net for FB/TikTok bulk imports.
// The normal worker/server path remains the primary path. Only when that path
// reports an unconfirmed/partial Sheet sync do we verify and repair each returned
// durable order individually. This prevents a batch from silently leaving only
// the first lead visible in Google Sheets while avoiding duplicate writes when
// the normal batch already succeeded.

type SheetRuntime = {
  supabaseUrl: string;
  supabaseKey: string;
  webhook: string;
};

const nativeFetch = globalThis.fetch.bind(globalThis);

const jsonResponseLike = (data: unknown, original: Response) => new Response(JSON.stringify(data), {
  status: original.status,
  statusText: original.statusText,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const parseJsonResponse = async (response: Response) => {
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

const isTransientSheetError = (message: string) => /Service Spreadsheets failed while accessing document|Internal error|Service unavailable|timed out|timeout|temporarily unavailable/i.test(message);

const postAppsScript = async (runtime: SheetRuntime, payload: Record<string, any>) => {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await nativeFetch(runtime.webhook, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain;charset=utf-8',
          accept: 'application/json,text/plain,*/*',
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });
      const { text, data } = await parseJsonResponse(response);
      if (!response.ok) throw new Error(`Google Apps Script HTTP ${response.status}: ${text.slice(0, 240)}`);
      if (!text || !Object.keys(data || {}).length) throw new Error(`Google Apps Script returned non-JSON: ${text.slice(0, 240)}`);
      if (data?.ok === false || String(data?.status || '').toLowerCase() === 'error') {
        throw new Error(data?.message || data?.error || 'Google Apps Script returned an error.');
      }
      return data;
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error || 'Google Apps Script call failed.'));
      if (!isTransientSheetError(lastError.message) || attempt >= 3) throw lastError;
      await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 350 : 900));
    }
  }
  throw lastError || new Error('Google Apps Script call failed.');
};

const expectedRows = (order: any) => Math.max(1, Array.isArray(order?.items) && order.items.length ? order.items.length : 1);

const physicalOrder = async (runtime: SheetRuntime, order: any) => {
  const orderNumber = String(order?.order_number || '').trim();
  if (!orderNumber) throw new Error('Bulk order has no order number.');
  const check = await postAppsScript(runtime, { action: 'read_order', orderId: orderNumber });
  return {
    found: check?.found === true,
    rows: Number(check?.rows || 0),
    raw: check,
  };
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
  if (!response.ok) throw new Error(`Could not update durable bulk order sync state (${response.status}).`);
};

const repairBulkSheetSync = async (request: Request, env: unknown, response: Response): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/orders/bulk-import' || !response.ok) return response;

  let data: any = {};
  try { data = await response.clone().json(); } catch { return response; }
  const orders: any[] = Array.isArray(data?.orders) ? data.orders : [];
  if (!orders.length) return response;

  // The primary path already performed physical verification. Do not touch a
  // successful batch again; this is deliberately a failure/partial-write repair.
  if (data?.sheet_sync?.ok === true && data?.sheet_sync?.confirmed === true) return response;

  try {
    const runtime = await getSheetRuntime(env);
    const syncedAt = new Date().toISOString();
    const repairedOrders: any[] = [];
    let repaired = 0;
    let totalRows = 0;

    for (const order of orders) {
      const need = expectedRows(order);
      let physical = await physicalOrder(runtime, order);

      if (!physical.found || physical.rows < need) {
        const result = await postAppsScript(runtime, { action: 'sync_orders', order });
        const status = String(result?.status || '');
        if (status !== 'orders_synced' || Number(result?.rows || 0) < need || Number(result?.synced || 0) < 1) {
          throw new Error(`Google Sheet did not confirm ${String(order?.order_number || '')}.`);
        }
        physical = await physicalOrder(runtime, order);
        if (!physical.found || physical.rows < need) {
          throw new Error(`Physical Sheet read-back failed for ${String(order?.order_number || '')}. Expected ${need}, found ${physical.rows}.`);
        }
        repaired++;
      }

      totalRows += physical.rows;
      const syncedOrder = {
        ...order,
        is_synced_google_sheets: true,
        synced_at: syncedAt,
        sheet_sync_verified_at: syncedAt,
      };
      await markPersistedOrder(runtime, syncedOrder);
      repairedOrders.push(syncedOrder);
    }

    return jsonResponseLike({
      ...data,
      orders: repairedOrders,
      sheet_sync: {
        ok: true,
        confirmed: true,
        status: 'orders_synced',
        synced: repairedOrders.length,
        rows: totalRows,
        repaired,
        path: 'clean-v1-worker-per-order-repair',
      },
    }, response);
  } catch (error: any) {
    return jsonResponseLike({
      ...data,
      sheet_sync: {
        ok: false,
        confirmed: false,
        error: String(error?.message || error || 'Bulk Google Sheet repair failed.'),
        path: 'clean-v1-worker-per-order-repair',
      },
    }, response);
  }
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const response = await baseWorker.fetch(request, env, ctx);
    return repairBulkSheetSync(request, env, response);
  },
};