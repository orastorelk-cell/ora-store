import {
  normalizedProductType,
  regularDisplayUnitPrice,
} from '../src/lib/productVariants';
import {
  calculateRoundSpecialOffer,
  roundSpecialOfferEnabledForProduct,
  roundSpecialOfferPercentForSelection,
} from '../src/lib/roundSpecialOffer';

type Env = Record<string, any>;

type Runtime = {
  url: string;
  key: string;
  webhook: string;
  products: any[];
  settings: any;
};

const KEY = 'facebook-lead-sheet-catchup-v1';
const MAX_PER_RUN = 10;
const RETRY_AFTER_MS = 30_000;
const OFFER_SNAPSHOT_START_MS = Date.parse('2026-09-04T13:30:00.000Z');
const OFFER_SNAPSHOT_VERSION = 2;
let running: Promise<void> | null = null;
let nextRunAt = 0;

const text = (env: Env, key: string) => String(env?.[key] || '').trim();
const normalizeSku = (value: unknown) => String(value || '').trim().toUpperCase();
const dbHeaders = (key: string) => ({
  apikey: key,
  authorization: `Bearer ${key}`,
  accept: 'application/json',
});

const getRuntime = async (env: Env): Promise<Runtime> => {
  const url = text(env, 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const key = text(env, 'SUPABASE_SECRET_KEY') || text(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase server configuration is missing.');

  const response = await fetch(`${url}/rest/v1/admin_data_store?key=eq.storefront-state-v1&select=payload`, {
    headers: dbHeaders(key),
  });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read Store Settings (${response.status}).`);
  const payload = rows?.[0]?.payload || {};
  const webhook = String(payload?.settings?.google_sheet_webhook_url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook)) {
    throw new Error('Google Sheet Web App URL is missing or invalid.');
  }
  return {
    url,
    key,
    webhook,
    products: Array.isArray(payload?.products) ? payload.products : [],
    settings: payload?.settings && typeof payload.settings === 'object' ? payload.settings : {},
  };
};

const postAppsScript = async (webhook: string, payload: Record<string, any>) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain;charset=utf-8',
        accept: 'application/json,text/plain,*/*',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok) throw new Error(`Google Apps Script HTTP ${response.status}.`);
    if (!raw || !Object.keys(data || {}).length) throw new Error('Google Apps Script returned an empty response.');
    if (data?.ok === false || String(data?.status || '').toLowerCase() === 'error') {
      throw new Error(data?.message || data?.error || 'Google Apps Script returned an error.');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const readRecentFacebookOrdersNeedingWork = async (runtime: Runtime) => {
  const url = new URL(`${runtime.url}/rest/v1/order_snapshots`);
  url.searchParams.set('select', 'created_at,payload');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '60');
  const response = await fetch(url, { headers: dbHeaders(runtime.key) });
  const rows: any[] = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Could not read recent orders (${response.status}).`);

  return rows
    .map((row) => ({ order: row?.payload, rowCreatedAt: String(row?.created_at || '') }))
    .filter(({ order, rowCreatedAt }) => {
      if (!order || String(order.order_source || '') !== 'Facebook Ads') return false;
      const createdMs = Date.parse(String(order?.created_at || rowCreatedAt || ''));
      const needsOfferSnapshot = Number.isFinite(createdMs)
        && createdMs >= OFFER_SNAPSHOT_START_MS
        && Number(order?.facebook_offer_snapshot_version || 0) < OFFER_SNAPSHOT_VERSION;
      const needsSheetSync = order.is_synced_google_sheets !== true;
      return needsOfferSnapshot || needsSheetSync;
    })
    .slice(0, MAX_PER_RUN);
};

const findProductSelectionForOrderItem = (runtime: Runtime, item: any) => {
  const mainSku = normalizeSku(item?.main_sku || item?.sku);
  const itemSku = normalizeSku(item?.sku);
  const product = runtime.products.find((candidate: any) => {
    if (normalizeSku(candidate?.sku) === mainSku) return true;
    return Array.isArray(candidate?.variants)
      && candidate.variants.some((variant: any) => normalizeSku(variant?.sku) === itemSku);
  });
  if (!product) return { product: null, variant: null };
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variant = variants.find((candidate: any) => String(candidate?.id || '') === String(item?.variant_id || ''))
    || variants.find((candidate: any) => normalizeSku(candidate?.sku) === itemSku)
    || null;
  return { product, variant };
};

const applyFacebookOfferSnapshot = (runtime: Runtime, order: any) => {
  const createdMs = Date.parse(String(order?.created_at || ''));
  if (!Number.isFinite(createdMs) || createdMs < OFFER_SNAPSHOT_START_MS) {
    return { order, changed: false, marked: false };
  }
  if (Number(order?.facebook_offer_snapshot_version || 0) >= OFFER_SNAPSHOT_VERSION) {
    return { order, changed: false, marked: true };
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) {
    return {
      order: { ...order, facebook_offer_snapshot_version: OFFER_SNAPSHOT_VERSION },
      changed: false,
      marked: true,
    };
  }

  let changed = false;
  const nextItems = items.map((item: any) => {
    const { product, variant } = findProductSelectionForOrderItem(runtime, item);
    if (!product) return item;

    const unitPrice = Math.max(0, Number(item?.unit_price || 0));
    if (!(unitPrice > 0)) return item;

    const savedRegular = Math.max(unitPrice, Number(regularDisplayUnitPrice(product, runtime.settings, variant || undefined) || 0));
    const existingOfferActive = savedRegular > unitPrice + 0.001;
    const autoOffer = calculateRoundSpecialOffer({
      currentPrice: unitPrice,
      enabled: normalizedProductType(product) !== 'bundle' && roundSpecialOfferEnabledForProduct(product),
      percent: roundSpecialOfferPercentForSelection(product, variant || undefined),
      freeDeliveryEnabled: Boolean(runtime.settings?.free_delivery_enabled),
      hasExistingDiscount: existingOfferActive,
    });
    const regularUnitPrice = autoOffer.active ? autoOffer.regularPrice : savedRegular;
    const savingPerUnit = Math.max(0, Math.round((regularUnitPrice - unitPrice) * 100) / 100);

    const oldRegular = Math.max(0, Number(item?.regular_unit_price || unitPrice));
    const oldSaving = Math.max(0, Number(item?.supplier_offer_discount_per_unit || 0));
    if (Math.abs(oldRegular - regularUnitPrice) > 0.001 || Math.abs(oldSaving - savingPerUnit) > 0.001) changed = true;

    return {
      ...item,
      regular_unit_price: regularUnitPrice,
      supplier_offer_discount_per_unit: savingPerUnit,
    };
  });

  const now = new Date().toISOString();
  return {
    order: {
      ...order,
      items: nextItems,
      facebook_offer_snapshot_version: OFFER_SNAPSHOT_VERSION,
      facebook_offer_snapshot_at: now,
      ...(changed ? { is_synced_google_sheets: false, synced_at: undefined, sheet_sync_verified_at: undefined } : {}),
    },
    changed,
    marked: true,
  };
};

const persistOrder = async (runtime: Runtime, order: any) => {
  const id = String(order?.id || '').trim();
  if (!id) throw new Error('Order ID is missing.');
  const response = await fetch(`${runtime.url}/rest/v1/order_snapshots?order_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      ...dbHeaders(runtime.key),
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ payload: order, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Could not persist Facebook order snapshot (${response.status}).`);
};

const markSynced = async (runtime: Runtime, order: any) => {
  const now = new Date().toISOString();
  const syncedOrder = {
    ...order,
    is_synced_google_sheets: true,
    synced_at: now,
    sheet_sync_verified_at: now,
  };
  await persistOrder(runtime, syncedOrder);
};

const syncAndVerifyOrder = async (runtime: Runtime, order: any) => {
  const orderNumber = String(order?.order_number || '').trim();
  if (!orderNumber) throw new Error('Order number is missing.');
  const expectedRows = Math.max(1, Array.isArray(order?.items) ? order.items.length : 1);

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await postAppsScript(runtime.webhook, { action: 'sync_orders', order });
      if (String(result?.status || '') !== 'orders_synced' || Number(result?.rows || 0) < expectedRows) {
        throw new Error(`Sheet sync did not confirm all rows for ${orderNumber}.`);
      }
      const physical = await postAppsScript(runtime.webhook, { action: 'read_order', orderId: orderNumber });
      if (physical?.found !== true || Number(physical?.rows || 0) < expectedRows) {
        throw new Error(`Sheet read-back did not find ${orderNumber}.`);
      }
      await markSynced(runtime, order);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Sheet sync failed.'));
};

const writeSummary = async (runtime: Runtime, payload: Record<string, unknown>) => {
  try {
    const at = new Date().toISOString();
    await fetch(`${runtime.url}/rest/v1/admin_data_store?on_conflict=key`, {
      method: 'POST',
      headers: {
        ...dbHeaders(runtime.key),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{ key: KEY, payload: { at, ...payload }, updated_at: at }]),
    });
  } catch {}
};

const run = async (envValue: unknown) => {
  const env = (envValue || {}) as Env;
  const runtime = await getRuntime(env);
  const rows = await readRecentFacebookOrdersNeedingWork(runtime);
  const attempted: string[] = [];
  const repairedOffers: string[] = [];
  const errors: string[] = [];
  let synced = 0;

  for (const row of rows) {
    const original = row.order;
    const orderNumber = String(original?.order_number || '').trim();
    if (!orderNumber) continue;
    attempted.push(orderNumber);
    try {
      const prepared = applyFacebookOfferSnapshot(runtime, original);
      if (prepared.marked && Number(original?.facebook_offer_snapshot_version || 0) < OFFER_SNAPSHOT_VERSION) {
        await persistOrder(runtime, prepared.order);
      }
      if (prepared.changed) repairedOffers.push(orderNumber);
      await syncAndVerifyOrder(runtime, prepared.order);
      synced += 1;
    } catch (error: any) {
      errors.push(`${orderNumber}: ${String(error?.message || error)}`);
    }
  }

  await writeSummary(runtime, {
    attempted,
    repaired_offers: repairedOffers,
    synced,
    failed: errors.length,
    errors: errors.slice(0, 10),
  });
};

export const scheduleFacebookLeadSheetCatchup = (envValue: unknown, ctx: unknown) => {
  const now = Date.now();
  if (running || now < nextRunAt) return;
  nextRunAt = now + RETRY_AFTER_MS;
  running = run(envValue).catch(() => undefined).finally(() => { running = null; });
  const waitUntil = (ctx as any)?.waitUntil;
  if (typeof waitUntil === 'function') waitUntil.call(ctx, running);
};