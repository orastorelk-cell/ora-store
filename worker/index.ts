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
// Cloudflare can receive the Apps Script response headers promptly while the
// redirected Google response body remains slow/stalled. server.ts used to wait
// for response.text(), hit its AbortController timeout, and report a false Sheet
// timeout even though Apps Script had already executed the doPost request.
//
// For sync_orders we therefore treat a successful HTTP response as acceptance,
// cancel the unused response body, and return the small JSON contract server.ts
// already expects. Delete/clear keep their legacy payload normalization below.
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

const orderPayloadStats = (body: any) => {
  const groups = body?.groups && typeof body.groups === "object" ? body.groups : {};
  let rows = 0;
  const ids = new Set<string>();
  for (const value of Object.values(groups)) {
    if (!Array.isArray(value)) continue;
    rows += value.length;
    for (const row of value as any[]) {
      const id = String(row?.["Order ID"] || row?.order_id || row?.order_number || "").trim();
      if (id) ids.add(id.toUpperCase());
    }
  }
  return { rows, synced: ids.size };
};

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

  // Order sync is the critical path. Apps Script executions were completing, but
  // Cloudflare then waited on Google's response body until the 20 s server timeout.
  // Do not consume that body. HTTP 2xx means the Web App accepted/executed the POST.
  if (String(body?.action || "").toLowerCase() === "sync_orders") {
    const response = await nativeFetch(input, init);
    if (!response.ok) return response;
    const stats = orderPayloadStats(body);
    try { await response.body?.cancel(); } catch {}
    return makeJsonResponse({
      ok: true,
      status: "orders_synced",
      synced: stats.synced,
      existing: 0,
      rows: stats.rows,
      edge_confirmed: true,
    }, response);
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

export default httpServerHandler({ port: 3000 });