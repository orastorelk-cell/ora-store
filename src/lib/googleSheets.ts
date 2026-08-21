import { GOOGLE_APPS_SCRIPT_CODE_V16 } from './googleAppsScriptV16';
import { GOOGLE_APPS_SCRIPT_HOTFIX_V162 } from './googleAppsScriptHotfixV162';
import { GOOGLE_APPS_SCRIPT_HOTFIX_V163 } from './googleAppsScriptHotfixV163';
import { GOOGLE_APPS_SCRIPT_HOTFIX_V163_CITY } from './googleAppsScriptHotfixV163City';
import { GOOGLE_APPS_SCRIPT_HOTFIX_V164 } from './googleAppsScriptHotfixV164';
import { GOOGLE_APPS_SCRIPT_HOTFIX_V165 } from './googleAppsScriptHotfixV165';
import { GOOGLE_APPS_SCRIPT_PULL_V18 } from './googleAppsScriptPullV18';

const APPS_SCRIPT_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i;

export type SheetActionResult = {
  success: boolean;
  message: string;
  synced?: number;
  existing?: number;
  rows?: number;
  removed?: number;
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
      body: JSON.stringify({ webhookUrl, payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      return { ok: false, error: data?.error || `Google Sheet request failed (${response.status}).` };
    }
    const result = data?.result || {};
    if (result?.ok === false) {
      return { ok: false, error: result?.error || 'Google Sheet returned an error.' };
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

const buildOrderSheetRow = (
  order: any,
  item: any,
  isFirst: boolean,
) => {
  const qty = Math.max(1, Number(item?.quantity ?? 1));
  const unitPrice = roundMoney(item?.unit_price ?? 0);
  const lineTotal = roundMoney(item?.subtotal ?? qty * unitPrice);
  return {
    'Order ID': String(order?.order_number || ''),
    'Customer Name': isFirst ? String(order?.customer_name || '') : '',
    'Phone Number': isFirst ? String(order?.phone || '') : '',
    'Address': isFirst ? String(order?.address || '') : '',
    'Item Name': String(item?.product_name || ''),
    'Item Code': String(item?.sku || ''),
    'Qty': qty,
    'Unit Price (Rs)': unitPrice,
    'Final Total (Rs)': isFirst ? roundMoney(order?.total_amount || 0) : '',
    'Variant / Color': String(item?.variant_name || ''),
    'Item Action': 'KEEP ITEM',
    'Order Action': isFirst ? 'PENDING' : '',
    'Offer': isFirst ? orderQtyOfferLabel(order) : '',
    'Discount (Rs)': isFirst ? roundMoney(order?.special_offer_discount || order?.discount || 0) : '',
    'Source': String(order?.order_source || 'Website'),
    'Main Code': String(item?.main_sku || item?.sku || ''),
    'Line Total (Rs)': lineTotal,
    'Normal Total (Rs)': isFirst ? roundMoney(order?.subtotal || 0) : '',
    'Delivery Fee (Rs)': isFirst ? roundMoney(order?.delivery_fee || 0) : '',
    'WhatsApp Number': isFirst ? String(order?.whatsapp || order?.phone || '') : '',
    'Original Main Code': String(item?.main_sku || item?.sku || ''),
    'Original Variant / Color': String(item?.variant_name || ''),
    'Original Item Code': String(item?.sku || ''),
    'Original Item Name': String(item?.product_name || ''),
    'Original Qty': qty,
    'Order Time': isFirst ? String(order?.created_at || new Date().toISOString()) : '',
    'Lead ID': isFirst ? String(order?.platform_lead_id || '') : '',
    'Imported Status': isFirst ? String(order?.call_center_status || 'Pending') : '',
    'City': isFirst ? String(order?.city || '') : '',
    'District': isFirst ? String(order?.district || '') : '',
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

export async function syncOrderToGoogleSheets(
  order: any,
  webhookUrl: string,
  _settings: Record<string, any>,
  _products?: any[],
): Promise<SheetActionResult> {
  const result = await postToAppsScript(webhookUrl, {
    action: 'sync_orders',
    groups: buildOrderGroups([order]),
  });
  if (!result.ok) return { success: false, message: result.error || 'Google Sheet sync failed.' };
  const status = String(result.result?.status || '');
  if (!['orders_synced', 'orders_batch_synced'].includes(status)) {
    return { success: false, message: result.result?.error || `Unexpected Google Sheet response: ${status || 'empty'}` };
  }
  return {
    success: true,
    message: 'Order synced to Google Sheet.',
    synced: Number(result.result?.synced || 0),
    existing: Number(result.result?.existing || 0),
    rows: Number(result.result?.rows || 0),
  };
}

export async function syncOrdersBatchToGoogleSheets(
  orders: any[],
  webhookUrl: string,
  _settings: Record<string, any>,
): Promise<SheetActionResult> {
  if (!orders?.length) return { success: true, message: 'Nothing to sync.', synced: 0, rows: 0 };
  const result = await postToAppsScript(webhookUrl, {
    action: 'sync_orders',
    groups: buildOrderGroups(orders),
  });
  if (!result.ok) return { success: false, message: result.error || 'Google Sheet batch sync failed.' };
  const status = String(result.result?.status || '');
  if (!['orders_synced', 'orders_batch_synced'].includes(status)) {
    return { success: false, message: result.result?.error || `Unexpected Google Sheet response: ${status || 'empty'}` };
  }
  return {
    success: true,
    message: 'Orders synced to Google Sheet.',
    synced: Number(result.result?.synced || 0),
    existing: Number(result.result?.existing || 0),
    rows: Number(result.result?.rows || 0),
  };
}

export async function deleteOrderFromGoogleSheets(
  orderId: string,
  webhookUrl: string,
): Promise<SheetActionResult> {
  const result = await postToAppsScript(webhookUrl, {
    action: 'delete_order',
    orderId: String(orderId || '').trim(),
  });
  if (!result.ok) return { success: false, message: result.error || 'Google Sheet order delete failed.' };
  const removed = Number(result.result?.removed ?? result.result?.deleted ?? 0);
  return { success: true, message: 'Order removed from Google Sheet.', removed };
}

export async function syncProductCatalogToGoogleSheets(
  products: any[],
  webhookUrl: string,
  _settings?: Record<string, any>,
): Promise<SheetActionResult> {
  const result = await postToAppsScript(webhookUrl, { action: 'catalog_sync', products });
  if (!result.ok) return { success: false, message: result.error || 'Google Sheet catalog sync failed.' };
  return {
    success: true,
    message: 'Product catalog synced to Google Sheet.',
    rows: Number(result.result?.rows || 0),
  };
}

export async function clearGoogleSheetTestData(webhookUrl: string): Promise<SheetActionResult> {
  const result = await postToAppsScript(webhookUrl, { action: 'clear_test_orders' });
  if (!result.ok) return { success: false, message: result.error || 'Could not clear test orders from Google Sheet.' };
  return {
    success: true,
    message: 'Test orders cleared from Google Sheet.',
    removed: Number(result.result?.removed || 0),
  };
}

export async function clearGoogleSheetLiveStartData(webhookUrl: string): Promise<SheetActionResult> {
  const result = await postToAppsScript(webhookUrl, { action: 'clear_live_start_data' });
  if (!result.ok) return { success: false, message: result.error || 'Could not clear Google Sheet order data.' };
  return {
    success: true,
    message: 'Google Sheet order data cleared.',
    removed: Number(result.result?.removed || 0),
  };
}

export const GOOGLE_APPS_SCRIPT_CODE = `${GOOGLE_APPS_SCRIPT_CODE_V16}\n\n${GOOGLE_APPS_SCRIPT_HOTFIX_V162}\n\n${GOOGLE_APPS_SCRIPT_HOTFIX_V163}\n\n${GOOGLE_APPS_SCRIPT_HOTFIX_V163_CITY}\n\n${GOOGLE_APPS_SCRIPT_HOTFIX_V164}\n\n${GOOGLE_APPS_SCRIPT_HOTFIX_V165}\n\n${GOOGLE_APPS_SCRIPT_PULL_V18}`;