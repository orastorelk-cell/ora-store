import { httpServerHandler } from "cloudflare:node";
import { waitUntil } from "cloudflare:workers";
import app from "../server";

// Keep Cloudflare background execution available for non-order background work.
(globalThis as any).__ORA_WAIT_UNTIL__ = waitUntil;

// -----------------------------------------------------------------------------
// Google Apps Script compatibility bridge
// -----------------------------------------------------------------------------
// Keep only the legacy delete/clear payload normalization here. Order sync must
// use the real Apps Script response; never synthesize a fake success response.
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
    headers: { "content-type": "application/json; charset=utf-8" },
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

  if (!responseMode) return nativeFetch(input, init);

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

  if (!response.ok || parsed?.ok === false) return makeJsonResponse(parsed, response);

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

// Real/test orders both use the server's existing synchronous Sheet-confirmation
// path. The request body is rewritten only to set wait_sheet_sync=true.
export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/api/orders") {
        const payload: any = await request.clone().json().catch(() => null);
        if (payload && typeof payload === "object" && payload.order) {
          payload.wait_sheet_sync = true;
          const headers = new Headers(request.headers);
          headers.set("content-type", "application/json");
          // The JSON body length changed after adding wait_sheet_sync. Reusing the
          // browser's old Content-Length makes the Node/Express body parser reject
          // the request with a bare HTTP 400 before /api/orders can run.
          headers.delete("content-length");
          const confirmedRequest = new Request(request.url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });
          return nodeHandler.fetch(confirmedRequest, env, ctx);
        }
      }
    } catch {
      // Fall through to the normal app handler; never block order persistence
      // because the edge compatibility layer could not inspect a request.
    }
    return nodeHandler.fetch(request, env, ctx);
  },
};
