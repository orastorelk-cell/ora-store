import { createClient } from "@supabase/supabase-js";

const STOREFRONT_STATE_KEY = "storefront-state-v1";
const PULL_LIMIT = 100;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
  },
});

const envText = (env: any, key: string) => String(env?.[key] ?? (globalThis as any)?.process?.env?.[key] ?? "").trim();

const getSupabase = (env: any) => {
  const url = envText(env, "VITE_SUPABASE_URL");
  const key = envText(env, "SUPABASE_SECRET_KEY") || envText(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || url.includes("your-project") || key.includes("your-secret") || key.includes("your-service-role")) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

const deploymentIdFromWebhook = (value: unknown) => {
  const match = String(value || "").trim().match(/^https:\/\/script\.google\.com\/macros\/s\/([^/]+)\/exec(?:\?.*)?$/i);
  return match?.[1] || "";
};

const loadPrivateStorefront = async (sb: any) => {
  const { data, error } = await sb.from("admin_data_store").select("payload").eq("key", STOREFRONT_STATE_KEY).maybeSingle();
  if (error) throw error;
  const payload = data?.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
};

const authenticateSheet = async (request: Request, sb: any) => {
  const state = await loadPrivateStorefront(sb);
  const webhook = String(state?.settings?.google_sheet_webhook_url || "").trim();
  const expected = deploymentIdFromWebhook(webhook);
  const supplied = String(request.headers.get("x-ora-sheet-key") || "").trim();
  return { ok: Boolean(expected && supplied && supplied === expected), state };
};

const eligibleForSheet = (order: any) => {
  if (!order || order.order_source === "Manual Admin") return false;
  if (order.order_source === "Website" && order.payment_method === "Bank Payment" && order.payment_verification_status !== "Approved") return false;
  return true;
};

export async function handleSheetPullRequest(request: Request, env: any): Promise<Response | null> {
  const url = new URL(request.url);
  const isPull = url.pathname === "/api/google-sheets/pull";
  const isAck = url.pathname === "/api/google-sheets/pull-ack";
  const isCatalog = url.pathname === "/api/google-sheets/catalog-pull";
  if (!isPull && !isAck && !isCatalog) return null;

  const sb = getSupabase(env);
  if (!sb) return json({ ok: false, error: "Live Supabase connection is unavailable for Sheet pull sync." }, 503);

  try {
    const auth = await authenticateSheet(request, sb);
    if (!auth.ok) return json({ ok: false, error: "Invalid Google Sheet pull key." }, 403);

    if (isCatalog) {
      if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
      return json({
        ok: true,
        status: "catalog_available",
        catalog_version: Math.max(0, Number(auth.state?.version || 0)),
        products: Array.isArray(auth.state?.products) ? auth.state.products.slice(0, 5000) : [],
      });
    }

    if (isPull) {
      if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
      const { data, error } = await sb
        .from("order_snapshots")
        .select("order_id,order_number,payload,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const orders = (data || [])
        .map((row: any) => row?.payload)
        .filter((order: any) => order && eligibleForSheet(order) && order.is_synced_google_sheets !== true)
        .slice(0, PULL_LIMIT);

      return json({
        ok: true,
        status: orders.length ? "orders_available" : "pull_empty",
        count: orders.length,
        orders,
        order_numbers: orders.map((order: any) => String(order.order_number || "")).filter(Boolean),
        catalog_version: Math.max(0, Number(auth.state?.version || 0)),
        server_time: new Date().toISOString(),
      });
    }

    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
    const body: any = await request.json().catch(() => ({}));
    const wanted = Array.from(new Set(
      (Array.isArray(body?.order_numbers) ? body.order_numbers : [])
        .map((value: any) => String(value || "").trim())
        .filter(Boolean)
    )).slice(0, PULL_LIMIT) as string[];
    if (!wanted.length) return json({ ok: true, status: "ack_empty", updated: 0 });

    const { data, error } = await sb
      .from("order_snapshots")
      .select("order_id,order_number,payload,created_at,updated_at")
      .in("order_number", wanted);
    if (error) throw error;

    const syncedAt = new Date().toISOString();
    const rows = (data || []).filter((row: any) => row?.payload && eligibleForSheet(row.payload)).map((row: any) => ({
      order_id: row.order_id,
      order_number: row.order_number,
      payload: { ...row.payload, is_synced_google_sheets: true, synced_at: syncedAt },
      created_at: row.created_at || row.payload?.created_at || syncedAt,
      updated_at: syncedAt,
    }));

    if (rows.length) {
      const { error: upsertError } = await sb.from("order_snapshots").upsert(rows, { onConflict: "order_id" });
      if (upsertError) throw upsertError;
    }
    return json({ ok: true, status: "acknowledged", updated: rows.length, synced_at: syncedAt });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Google Sheet pull sync failed." }, 500);
  }
}
