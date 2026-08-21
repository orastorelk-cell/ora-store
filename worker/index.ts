import { httpServerHandler } from "cloudflare:node";
import { waitUntil } from "cloudflare:workers";
import app from "../server";

// Make Cloudflare background execution available to the Express routes.
(globalThis as any).__ORA_WAIT_UNTIL__ = waitUntil;

// -----------------------------------------------------------------------------
// Google Apps Script compatibility bridge
// -----------------------------------------------------------------------------
const nativeFetch = globalThis.fetch.bind(globalThis);

const isGoogleAppsScriptExec = (input: RequestInfo | URL) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/i.test(url);
};

const makeJsonResponse = (data: unknown, original: Response) => new Response(
  JSON.stringify(data),
  {
    status: original.status,
    statusText: original.statusText,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  },
);

(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!isGoogleAppsScriptExec(input) || !init?.body || typeof init.body !== "string") {
    return nativeFetch(input, init);
  }

  let body: any;
  try {
    body = JSON.parse(init.body);
  } catch {
    return nativeFetch(input, init);
  }

  let responseMode: "delete" | "clear" | null = null;

  if (body?.payload_type === "order_delete") {
    responseMode = "delete";
    body = {
      action: "delete_order",
      orderId: String(body.order_number || body.orderId || body.order_id || "").trim(),
      reason: String(body.reason || "").trim(),
    };
  } else if (body?.payload_type === "operational_clear") {
    responseMode = "clear";
    body = { action: "clear_live_start_data" };
  }

  if (!responseMode) {
    return nativeFetch(input, init);
  }

  const response = await nativeFetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { ok: false, error: text || "Invalid Google Sheet response." };
  }

  if (!response.ok || parsed?.ok === false) {
    return makeJsonResponse(parsed, response);
  }

  if (responseMode === "delete") {
    const removed = Number(parsed?.deleted ?? parsed?.removed ?? 0);
    return makeJsonResponse({
      ...parsed,
      ok: true,
      status: "order_deleted",
      deleted: removed,
      removed,
    }, response);
  }

  const removed = Number(parsed?.removed ?? parsed?.deleted ?? 0);
  return makeJsonResponse({
    ...parsed,
    ok: true,
    status: "operational_cleared",
    removed,
  }, response);
};

app.listen(3000);
const nodeHandler: any = httpServerHandler({ port: 3000 });

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

type SheetRuntime = {
  supabaseUrl: string;
  supabaseKey: string;
  webhook: string;
  settings: Record<string, any>;
};

const getSheetRuntime = async (envValue: unknown): Promise<SheetRuntime> => {
  const env = (envValue || {}) as Record<string, string | undefined>;
  const supabaseUrl = String(env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const supabaseKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase server configuration is missing.");

  const stateResponse = await nativeFetch(
    `${supabaseUrl}/rest/v1/admin_data_store?key=eq.storefront-state-v1&select=payload`,
    {
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
        accept: "application/json",
      },
    },
  );
  const stateText = await stateResponse.text();
  let stateRows: any[] = [];
  try { stateRows = stateText ? JSON.parse(stateText) : []; } catch {}
  if (!stateResponse.ok) throw new Error(`Could not read shared Store Settings (${stateResponse.status}).`);

  const payload = stateRows?.[0]?.payload || {};
  const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
  const webhook = String(settings?.google_sheet_webhook_url || "").trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook)) {
    throw new Error("Shared Google Sheet /exec URL is missing or invalid.");
  }
  return { supabaseUrl, supabaseKey, webhook, settings };
};

const parseAppsScriptResponse = async (response: Response) => {
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { text, data };
};

const quantityOfferLabel = (order: any, settings: Record<string, any>) => {
  const qty = (Array.isArray(order?.items) ? order.items : [])
    .reduce((sum: number, item: any) => sum + Math.max(1, Number(item?.quantity || 1)), 0);
  const discount = Math.max(0, Number(order?.special_offer_discount || 0));
  if (discount <= 0) return "No Qty Offer";
  if (settings?.multi_buy_discount_enabled) {
    const tiers = [
      { min:Number(settings.multi_buy_tier1_min ?? 2), max:Number(settings.multi_buy_tier1_max ?? 3), rate:Number(settings.multi_buy_tier1_rate ?? 5) },
      { min:Number(settings.multi_buy_tier2_min ?? 4), max:Number(settings.multi_buy_tier2_max ?? 5), rate:Number(settings.multi_buy_tier2_rate ?? 7.5) },
      { min:Number(settings.multi_buy_tier3_min ?? 6), max:Number(settings.multi_buy_tier3_max ?? 10), rate:Number(settings.multi_buy_tier3_rate ?? 10) },
    ];
    const tier = tiers.find((row) => qty >= row.min && qty <= row.max && row.rate > 0);
    if (tier) return `Qty Offer ${tier.rate}% (${qty} items)`;
  }
  return `Order Offer Rs. ${Math.round(discount * 100) / 100}`;
};

const getPersistedOrder = async (runtime: SheetRuntime, orderId: string): Promise<any | null> => {
  const response = await nativeFetch(
    `${runtime.supabaseUrl}/rest/v1/order_snapshots?order_id=eq.${encodeURIComponent(orderId)}&select=payload`,
    {
      headers: {
        apikey: runtime.supabaseKey,
        authorization: `Bearer ${runtime.supabaseKey}`,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) return null;
  const rows: any[] = await response.json().catch(() => []);
  return rows?.[0]?.payload || null;
};

const savePersistedOrder = async (runtime: SheetRuntime, order: any) => {
  const response = await nativeFetch(
    `${runtime.supabaseUrl}/rest/v1/order_snapshots?order_id=eq.${encodeURIComponent(String(order?.id || ""))}`,
    {
      method: "PATCH",
      headers: {
        apikey: runtime.supabaseKey,
        authorization: `Bearer ${runtime.supabaseKey}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({ payload: order, updated_at: new Date().toISOString() }),
    },
  );
  if (!response.ok) throw new Error(`Could not mark Google Sheet sync in durable order store (${response.status}).`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The Express route intentionally responds before its background Sheet mirror finishes.
// On the live Worker that background path has proven unreliable. We do not rewrite the
// incoming /api/orders body. Instead, after the durable server save succeeds, wait briefly
// for the existing background mirror to confirm. Only if it still has not confirmed do we
// send the saved final order object through the already-proven V17 sync_orders path.
const guaranteeOrderSheetSync = async (request: Request, envValue: unknown, response: Response): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/orders" || !response.ok) return response;

  let data: any = {};
  try { data = await response.clone().json(); } catch { return response; }
  const order = data?.order;
  if (!order || data?.sheet_sync?.queued !== true) return response;

  try {
    const runtime = await getSheetRuntime(envValue);

    // Give the server's existing waitUntil mirror up to four seconds to finish first.
    // This avoids racing two writers when the normal background path is healthy.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(1000);
      const persisted = await getPersistedOrder(runtime, String(order.id || ""));
      if (persisted?.is_synced_google_sheets === true) {
        return makeJsonResponse({
          ...data,
          order: persisted,
          sheet_sync: { ok:true, synced:1, confirmed:true, path:"server-background" },
        }, response);
      }
    }

    // Background did not confirm. Use the exact saved order values; V17 builds the
    // rows, line totals, multi-item layout and target tab. We only supply the offer
    // label because it is a display field, not a second pricing calculation.
    const orderForSheet = {
      ...order,
      offer: quantityOfferLabel(order, runtime.settings),
    };
    const appsResponse = await nativeFetch(runtime.webhook, {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=utf-8",
        accept: "application/json,text/plain,*/*",
      },
      body: JSON.stringify({ action:"sync_orders", order:orderForSheet }),
      redirect: "follow",
    });
    const { data: appsData } = await parseAppsScriptResponse(appsResponse);
    const sheetOk = appsResponse.ok
      && appsData?.ok !== false
      && ["orders_synced", "orders_batch_synced"].includes(String(appsData?.status || ""));

    if (!sheetOk) {
      return makeJsonResponse({
        ...data,
        sheet_sync: {
          ok:false,
          error: appsData?.message || appsData?.error || `Google Apps Script sync failed (${appsResponse.status}).`,
          status: appsData?.status || null,
          version: appsData?.version || null,
          path:"worker-confirmed-fallback",
        },
      }, response);
    }

    const syncedAt = new Date().toISOString();
    const syncedOrder = {
      ...order,
      is_synced_google_sheets: true,
      synced_at: syncedAt,
    };
    await savePersistedOrder(runtime, syncedOrder);

    return makeJsonResponse({
      ...data,
      order: syncedOrder,
      sheet_sync: {
        ok:true,
        synced:Number(appsData?.synced || 1),
        rows:Number(appsData?.rows || 0),
        existing:Number(appsData?.existing || 0),
        status:appsData?.status || "orders_synced",
        version:appsData?.version || null,
        confirmed:true,
        path:"worker-confirmed-fallback",
      },
    }, response);
  } catch (error: any) {
    // The order is already durably saved. Return it, but never pretend Sheet success.
    return makeJsonResponse({
      ...data,
      sheet_sync: {
        ok:false,
        error:String(error?.message || error || "Google Sheet confirmation failed."),
        path:"worker-confirmed-fallback",
      },
    }, response);
  }
};

// Production diagnostic. No webhook URL or secret is returned.
// Default mode is read-only health. Add ?write=1 to send one disposable
// production-shaped sync_orders row through the exact saved /exec endpoint.
const sheetDiagnostic = async (request: Request, envValue: unknown): Promise<Response | null> => {
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.pathname !== "/api/google-sheets/diagnostic") return null;

  try {
    const runtime = await getSheetRuntime(envValue);
    const doWrite = requestUrl.searchParams.get("write") === "1";
    const diagnosticOrderId = `ORA-DIAG-${Date.now()}`;
    const payload = doWrite
      ? {
          action: "sync_orders",
          groups: {
            Website: [{
              "Order ID": diagnosticOrderId,
              "Customer Name": "O-RA DIAGNOSTIC - SAFE TO DELETE",
              "Phone Number": "0770000000",
              "Address": "SYSTEM DIAGNOSTIC ROW",
              "Item Name": "Google Sheet Write Diagnostic",
              "Item Code": "DIAG-001",
              "Qty": 1,
              "Unit Price (Rs)": 1,
              "Final Total (Rs)": 1,
              "Variant / Color": "",
              "Item Action": "KEEP ITEM",
              "Order Action": "PENDING",
              "Offer": "No Qty Offer",
              "Discount (Rs)": 0,
              "Source": "Website",
              "Main Code": "DIAG-001",
              "Line Total (Rs)": 1,
              "Normal Total (Rs)": 1,
              "Delivery Fee (Rs)": 0,
              "WhatsApp Number": "0770000000",
              "Order Time": new Date().toISOString(),
              "Imported Status": "Pending",
              "City": "Colombo",
              "District": "Colombo",
            }],
          },
        }
      : { action: "health" };

    const appsResponse = await nativeFetch(runtime.webhook, {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=utf-8",
        accept: "application/json,text/plain,*/*",
      },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    const { text: appsText, data: appsData } = await parseAppsScriptResponse(appsResponse);
    const appsOk = appsResponse.ok && appsData?.ok !== false && String(appsData?.status || "") !== "error";
    return json({
      ok: appsOk,
      stage: doWrite
        ? (appsOk ? "google_sheet_write" : "google_sheet_write_error")
        : (appsOk ? "google_apps_script" : "google_apps_script_error"),
      diagnostic_order_id: doWrite ? diagnosticOrderId : undefined,
      supabase: true,
      webhook_configured: true,
      apps_script_http: appsResponse.status,
      apps_script_ok: appsData?.ok ?? null,
      apps_script_status: appsData?.status ?? null,
      apps_script_version: appsData?.version ?? null,
      apps_script_message: appsData?.message ?? appsData?.error ?? null,
      synced: appsData?.synced ?? null,
      rows: appsData?.rows ?? null,
      existing: appsData?.existing ?? null,
      response_is_json: Boolean(appsText && Object.keys(appsData || {}).length),
    }, appsOk ? 200 : 502);
  } catch (error: any) {
    return json({ ok:false, stage:"diagnostic_exception", error:String(error?.message || error || "Unknown diagnostic error") }, 500);
  }
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const diagnostic = await sheetDiagnostic(request, env);
    if (diagnostic) return diagnostic;

    const response = await nodeHandler.fetch(request, env, ctx);
    return guaranteeOrderSheetSync(request, env, response);
  },
};
