import { httpServerHandler } from "cloudflare:node";
import { waitUntil } from "cloudflare:workers";
import app from "../server";

// Make Cloudflare background execution available to the Express routes.
// This lets the customer receive the Order ID immediately while tasks
// such as Google Sheet sync continue safely in the background.
(globalThis as any).__ORA_WAIT_UNTIL__ = waitUntil;

// -----------------------------------------------------------------------------
// Google Apps Script compatibility bridge
// -----------------------------------------------------------------------------
// The live server currently sends two legacy payload_type values that the
// deployed V15.x Apps Script does not understand directly:
//   order_delete      -> delete_order
//   operational_clear -> clear_live_start_data
//
// Keep the server/API contract unchanged, but normalize only requests going to
// the saved Google Apps Script /exec endpoint. The response is normalized back
// to the status names the server already expects. This avoids fake-success UI
// states while preserving the existing Sheet, City/District and Test Order code.
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

// Production diagnostic. No webhook URL or secret is returned.
// Default mode is read-only health. Add ?write=1 to send one disposable
// production-shaped sync_orders row through the exact saved /exec endpoint.
const sheetDiagnostic = async (request: Request, envValue: unknown): Promise<Response | null> => {
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.pathname !== "/api/google-sheets/diagnostic") return null;

  const env = (envValue || {}) as Record<string, string | undefined>;
  const supabaseUrl = String(env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const supabaseKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !supabaseKey) {
    return json({ ok: false, stage: "supabase_config", error: "Supabase server configuration is missing." }, 503);
  }

  try {
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
    if (!stateResponse.ok) {
      return json({ ok: false, stage: "supabase_settings_read", supabase_http: stateResponse.status, error: "Could not read shared Store Settings." }, 502);
    }

    const webhook = String(stateRows?.[0]?.payload?.settings?.google_sheet_webhook_url || "").trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook)) {
      return json({ ok: false, stage: "webhook_setting", supabase: true, webhook_configured: false, error: "Shared Google Sheet /exec URL is missing or invalid." }, 409);
    }

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

    const appsResponse = await nativeFetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=utf-8",
        accept: "application/json,text/plain,*/*",
      },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    const appsText = await appsResponse.text();
    let appsData: any = {};
    try { appsData = appsText ? JSON.parse(appsText) : {}; } catch {}

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
    return json({ ok: false, stage: "diagnostic_exception", error: String(error?.message || error || "Unknown diagnostic error") }, 500);
  }
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const diagnostic = await sheetDiagnostic(request, env);
    if (diagnostic) return diagnostic;
    return nodeHandler.fetch(request, env, ctx);
  },
};
