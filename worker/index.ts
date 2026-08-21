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

export default httpServerHandler({ port: 3000 });