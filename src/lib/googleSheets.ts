import { GOOGLE_APPS_SCRIPT_CODE_CLEAN_V1 } from './googleAppsScriptCleanV1';
import { GOOGLE_APPS_SCRIPT_CITY_EXACT_8549 } from './googleAppsScriptCityExact8549';
import { GOOGLE_APPS_SCRIPT_CALL_CENTER_UX } from './googleAppsScriptCallCenterUX';
import { GOOGLE_APPS_SCRIPT_STABLE_ROWS } from './googleAppsScriptStableRows';
import { GOOGLE_APPS_SCRIPT_FULL_RESET } from './googleAppsScriptFullReset';
import { GOOGLE_APPS_SCRIPT_VARIANT_PRICE } from './googleAppsScriptVariantPrice';
import { GOOGLE_APPS_SCRIPT_ACTION_CHIPS } from './googleAppsScriptActionChips';
import { GOOGLE_APPS_SCRIPT_PRICE_FORMAT } from './googleAppsScriptPriceFormat';
import { GOOGLE_APPS_SCRIPT_ORDER_DETAILS } from './googleAppsScriptOrderDetails';
import { GOOGLE_APPS_SCRIPT_BULK_FAST } from './googleAppsScriptBulkFast';
import { GOOGLE_APPS_SCRIPT_BULK_SPEED_V2 } from './googleAppsScriptBulkSpeedV2';
import { GOOGLE_APPS_SCRIPT_WEBSITE_SPEED } from './googleAppsScriptWebsiteSpeed';
import { GOOGLE_APPS_SCRIPT_CATALOG_IMAGE } from './googleAppsScriptCatalogImage';

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

const sheetQtyOfferRules = (settings: Record<string, any>) => JSON.stringify({
  enabled: settings?.multi_buy_discount_enabled !== false,
  tiers: [
    { min:Number(settings?.multi_buy_tier1_min ?? 2), max:Number(settings?.multi_buy_tier1_max ?? 3), rate:Number(settings?.multi_buy_tier1_rate ?? 5) },
    { min:Number(settings?.multi_buy_tier2_min ?? 4), max:Number(settings?.multi_buy_tier2_max ?? 5), rate:Number(settings?.multi_buy_tier2_rate ?? 7.5) },
    { min:Number(settings?.multi_buy_tier3_min ?? 6), max:Number(settings?.multi_buy_tier3_max ?? 10), rate:Number(settings?.multi_buy_tier3_rate ?? 10), openEnded:true },
  ],
});

const sheetWrappingFee = (order:any, settings:Record<string,any>) => {
  if(order?.gift_wrap_selected) return Math.max(0,roundMoney(order?.gift_wrap_fee || settings?.gift_wrap_fee || 0));
  return settings?.gift_wrap_enabled ? Math.max(0,roundMoney(settings?.gift_wrap_fee || 0)) : 0;
};

const buildOrderSheetRow = (order: any, item: any, isFirst: boolean, settings:Record<string,any>) => {
  const qty = Math.max(1, Number(item?.quantity ?? 1));
  const unitPrice = roundMoney(item?.unit_price ?? 0);
  const lineTotal = roundMoney(item?.subtotal ?? qty * unitPrice);
  const actualSellingTotal = roundMoney(
    (Array.isArray(order?.items) ? order.items : []).reduce(
      (sum:number, row:any) => {
        const rowQty=Math.max(1,Number(row?.quantity ?? 1));
        const regularUnit=roundMoney(row?.regular_unit_price ?? row?.unit_price ?? 0);
        return sum + regularUnit * rowQty;
      },
      0,
    ),
  );
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
    'Normal Total (Rs)': isFirst ? actualSellingTotal : '',
    'Delivery Fee (Rs)': isFirst ? roundMoney(order?.delivery_fee || 0) : '',
    'Final Total (Rs)': isFirst ? roundMoney(order?.total_amount || 0) : '',
    'Gift Wrap': isFirst ? (order?.gift_wrap_selected ? 'YES' : 'NO') : '',
    'Wrapping Cost (Rs)': isFirst ? sheetWrappingFee(order,settings) : '',
    'Qty Offer Rules': isFirst ? sheetQtyOfferRules(settings) : '',
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

const buildOrderGroups = (orders: any[], settings:Record<string,any>) => {
  const groups: Record<string, any[]> = {};
  for (const order of orders || []) {
    const source = String(order?.order_source || 'Website');
    if (!groups[source]) groups[source] = [];
    const items = Array.isArray(order?.items) && order.items.length ? order.items : [{}];
    items.forEach((item: any, index: number) => {
      groups[source].push(buildOrderSheetRow(order, item, index === 0, settings));
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
  settings: Record<string, any>,
  _products?: any[],
): Promise<SheetActionResult> {
  const posted = await postToAppsScript(webhookUrl, { action: 'sync_orders', groups: buildOrderGroups([order],settings) });
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
  settings: Record<string, any>,
): Promise<SheetActionResult> {
  if (!orders?.length) return { success: true, message: 'Nothing to sync.', synced: 0, rows: 0 };
  const posted = await postToAppsScript(webhookUrl, { action: 'sync_orders', groups: buildOrderGroups(orders,settings) });
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

export const GOOGLE_APPS_SCRIPT_CODE = `${GOOGLE_APPS_SCRIPT_CODE_CLEAN_V1}\n\n${GOOGLE_APPS_SCRIPT_CITY_EXACT_8549}\n\n${GOOGLE_APPS_SCRIPT_CALL_CENTER_UX}\n\n${GOOGLE_APPS_SCRIPT_STABLE_ROWS}\n\n${GOOGLE_APPS_SCRIPT_FULL_RESET}\n\n${GOOGLE_APPS_SCRIPT_VARIANT_PRICE}\n\n${GOOGLE_APPS_SCRIPT_ACTION_CHIPS}\n\n${GOOGLE_APPS_SCRIPT_PRICE_FORMAT}\n\n${GOOGLE_APPS_SCRIPT_ORDER_DETAILS}\n\n${GOOGLE_APPS_SCRIPT_BULK_FAST}\n\n${GOOGLE_APPS_SCRIPT_BULK_SPEED_V2}\n\n${GOOGLE_APPS_SCRIPT_WEBSITE_SPEED}\n\n${GOOGLE_APPS_SCRIPT_CATALOG_IMAGE}`;
