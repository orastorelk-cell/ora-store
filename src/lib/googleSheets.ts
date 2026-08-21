import { GOOGLE_APPS_SCRIPT_CODE_CLEAN_V1 } from './googleAppsScriptCleanV1';

const APPS_SCRIPT_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i;

export type SheetActionResult = {
  success: boolean;
  message: string;
  synced?: number;
  existing?: number;
  rows?: number;
  removed?: number;
  status?: string;
  version?: string;
};

const isAppsScriptUrl = (url?: string) => APPS_SCRIPT_URL_PATTERN.test(String(url || '').trim());

async function postToAppsScript(
  webhookUrl: string,
  payload: Record<string, any>,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  if (!isAppsScriptUrl(webhookUrl)) {
    return { ok: false, error: 'Google Sheet Web App URL is missing or invalid.' };
  }
  try {
    const response = await fetch('/api/google-sheets/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: String(webhookUrl).trim(), payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      return { ok: false, error: data?.error || `Google Sheet request failed (${response.status}).` };
    }
    const result = data?.result || {};
    if (result?.ok === false || String(result?.status || '').toLowerCase() === 'error') {
      return { ok: false, error: result?.message || result?.error || 'Google Sheet returned an error.' };
    }
    return { ok: true, result };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Could not reach the Google Sheet server proxy.' };
  }
}

const roundMoney = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;

const orderQtyOfferLabel = (order: any): string => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const totalQty = items.reduce(
    (sum: number, item: any) => sum + Math.max(1, Number(item?.quantity || 1)),
    0,
  );
  const discount = Math.max(0, roundMoney(order?.special_offer_discount || order?.discount || 0));
  return discount > 0 ? `Qty Offer Rs. ${discount} (${totalQty} items)` : 'No Qty Offer';
};

const buildOrderSheetRow = (order: any, item: any, isFirst: boolean) => {
  const qty = Math.max(1, Number(item?.quantity ?? 1));
  const unitPrice = roundMoney(item?.unit_price ?? 0);
  const lineTotal = roundMoney(item?.subtotal ?? qty * unitPrice);
  return {
    'Order ID': String(order?.order_number || ''),
    'Customer Name': isFirst ? String(order?.customer_name || '') : '',
    'Phone Number': isFirst ? String(order?.phone || '') : '',
    'WhatsApp Number': isFirst ? String(order?.whatsapp || order?.phone || '') : '',
    'Address': isFirst ? String(order?.address || '') : '',
    'City': isFirst ? String(order?.city || '') : '',
    'District': isFirst ? String(order?.district || '') : '',
    'Item Name': String(item?.product_name || ''),
    'Main Code': String(item?.main_sku || item?.sku || ''),
    'Item Code': String(item?.sku || ''),
    'Variant / Color': String(item?.variant_name || ''),
    'Qty': qty,
    'Unit Price (Rs)': unitPrice,
    'Line Total (Rs)': lineTotal,
    'Offer': isFirst ? orderQtyOfferLabel(order) : '',
    'Discount (Rs)': isFirst ? roundMoney(order?.special_offer_discount || order?.discount || 0) : '',
    'Normal Total (Rs)': isFirst ? roundMoney(order?.subtotal || 0) : '',
    'Delivery Fee (Rs)': isFirst ? roundMoney(order?.delivery_fee || 0) : '',
    'Final Total (Rs)': isFirst ? roundMoney(order?.total_amount || 0) : '',
    'Item Action': 'KEEP ITEM',
    'Order Action': isFirst ? 'PENDING' : '',
    'Cancel Reason': '',
    'Change Item To': '',
    'Change Preview': '',
    'Apply Item Change': false,
    'Source': String(order?.order_source || 'Website'),
    'Order Time': isFirst ? String(order?.created_at || new Date().toISOString()) : '',
    'Lead ID': isFirst ? String(order?.platform_lead_id || '') : '',
    'Imported Status': isFirst ? String(order?.call_center_status || 'Pending') : '',
    'Original Main Code': String(item?.main_sku || item?.sku || ''),
    'Original Variant / Color': String(item?.variant_name || ''),
    'Original Item Code': String(item?.sku || ''),
    'Original Item Name': String(item?.product_name || ''),
    'Original Qty': qty,
  };
};

const buildOrderGroups = (orders: any[]) => {
  const groups: Record<string, any[]> = {};
  for (const order of orders || []) {
    const source = String(order?.order_source || 'Website');
    if (!groups[source]) groups[source] = [];
    const items = Array.isArray(order?.items) && order.items.length ? order.items : [{}];
    items.forEach((item: any, index: number) => {
      groups[source].push(buildOrderSheetRow(order, item, index === 0));
    });
  }
  return groups;
};

const expectStatus = (result: any, allowed: string[]) => {
  const status = String(result?.status || '');
  return allowed.includes(status) ? null : (result?.message || result?.error || `Unexpected Google Sheet response: ${status || 'empty'}`);
};

export async function syncOrderToGoogleSheets(
  order: any,
  webhookUrl: string,
  _settings: Record<string, any>,
  _products?: any[],
): Promise<SheetActionResult> {
  const posted = await postToAppsScript(webhookUrl, { action: 'sync_orders', groups: buildOrderGroups([order]) });
  if (!posted.ok) return { success: false, message: posted.error || 'Google Sheet sync failed.' };
  const err = expectStatus(posted.result, ['orders_synced']);
  if (err) return { success: false, message: err };
  const rows = Number(posted.result?.rows || 0);
  if (rows < 1) return { success: false, message: 'Google Sheet accepted the request but wrote 0 rows.' };
  return {
    success: true,
    message: 'Order synced to Google Sheet.',
    synced: Number(posted.result?.synced || 0),
    existing: Number(posted.result?.existing || 0),
    rows,
    status: posted.result?.status,
    version: posted.result?.version,
  };
}

export async function syncOrdersBatchToGoogleSheets(
  orders: any[],
  webhookUrl: string,
  _settings: Record<string, any>,
): Promise<SheetActionResult> {
  if (!orders?.length) return { success: true, message: 'Nothing to sync.', synced: 0, rows: 0 };
  const posted = await postToAppsScript(webhookUrl, { action: 'sync_orders', groups: buildOrderGroups(orders) });
  if (!posted.ok) return { success: false, message: posted.error || 'Google Sheet batch sync failed.' };
  const err = expectStatus(posted.result, ['orders_synced']);
  if (err) return { success: false, message: err };
  const rows = Number(posted.result?.rows || 0);
  if (rows < 1) return { success: false, message: 'Google Sheet accepted the batch but wrote 0 rows.' };
  return {
    success: true,
    message: 'Orders synced to Google Sheet.',
    synced: Number(posted.result?.synced || 0),
    existing: Number(posted.result?.existing || 0),
    rows,
    status: posted.result?.status,
    version: posted.result?.version,
  };
}

export async function deleteOrderFromGoogleSheets(orderId: string, webhookUrl: string): Promise<SheetActionResult> {
  const posted = await postToAppsScript(webhookUrl, { action: 'delete_order', orderId: String(orderId || '').trim() });
  if (!posted.ok) return { success: false, message: posted.error || 'Google Sheet order delete failed.' };
  const err = expectStatus(posted.result, ['order_deleted']);
  if (err) return { success: false, message: err };
  const removed = Number(posted.result?.removed ?? posted.result?.deleted ?? 0);
  return { success: true, message: 'Order removed from Google Sheet.', removed, status: posted.result?.status, version: posted.result?.version };
}

export async function syncProductCatalogToGoogleSheets(
  products: any[],
  webhookUrl: string,
  _settings?: Record<string, any>,
): Promise<SheetActionResult> {
  const posted = await postToAppsScript(webhookUrl, { action: 'catalog_sync', products });
  if (!posted.ok) return { success: false, message: posted.error || 'Google Sheet catalog sync failed.' };
  const err = expectStatus(posted.result, ['catalog_synced']);
  if (err) return { success: false, message: err };
  return { success: true, message: 'Product catalog synced to Google Sheet.', rows: Number(posted.result?.rows || 0), status: posted.result?.status, version: posted.result?.version };
}

export async function clearGoogleSheetTestData(webhookUrl: string): Promise<SheetActionResult> {
  const posted = await postToAppsScript(webhookUrl, { action: 'clear_test_orders' });
  if (!posted.ok) return { success: false, message: posted.error || 'Could not clear test orders from Google Sheet.' };
  const err = expectStatus(posted.result, ['test_orders_cleared']);
  if (err) return { success: false, message: err };
  return { success: true, message: 'Test orders cleared from Google Sheet.', removed: Number(posted.result?.removed || 0), status: posted.result?.status, version: posted.result?.version };
}

export async function clearGoogleSheetLiveStartData(webhookUrl: string): Promise<SheetActionResult> {
  const posted = await postToAppsScript(webhookUrl, { action: 'clear_live_start_data' });
  if (!posted.ok) return { success: false, message: posted.error || 'Could not clear Google Sheet order data.' };
  const err = expectStatus(posted.result, ['orders_cleared']);
  if (err) return { success: false, message: err };
  return { success: true, message: 'Google Sheet order data cleared.', removed: Number(posted.result?.removed || 0), status: posted.result?.status, version: posted.result?.version };
}

export const GOOGLE_APPS_SCRIPT_CODE = GOOGLE_APPS_SCRIPT_CODE_CLEAN_V1;
