// ============================================================
// O-RA STORE - Google Sheets client bridge (V15.6)
// ------------------------------------------------------------
// ROOT-CAUSE FIX (V15.6): this file previously contained ONLY the
// Google Apps Script source code (meant to be pasted into the Sheet's
// Apps Script editor) with no `export` statements at all. Because
// StoreContext.tsx and AdminDashboard.tsx import real functions from
// this file (syncOrderToGoogleSheets, syncOrdersBatchToGoogleSheets,
// syncProductCatalogToGoogleSheets, clearGoogleSheetTestData,
// clearGoogleSheetLiveStartData, deleteOrderFromGoogleSheets,
// GOOGLE_APPS_SCRIPT_CODE), every one of those imports resolved to
// `undefined` at runtime. Vite/esbuild does not type-check on build,
// so the site still built and deployed, but any button/flow that
// called one of these functions failed silently with
// "X is not a function" the moment it ran in the browser.
//
// This file now has two clearly separated parts:
//
// 1) Real TypeScript functions (below) that the website/admin panel
//    calls directly to talk to the Google Sheet through the server's
//    /api/google-sheets/proxy route.
//
// 2) GOOGLE_APPS_SCRIPT_CODE (bottom of this file): the exact source
//    that must be pasted into the Google Sheet's Apps Script editor
//    (Extensions -> Apps Script) so the Sheet can receive these
//    requests. Admin Dashboard -> Google Sheets panel has a
//    "Copy code" button wired to this constant.
//
// IMPORTANT: editing this file does NOT change the already-deployed
// Google Apps Script project (that code lives on Google's servers,
// separate from this repo). After any change to
// GOOGLE_APPS_SCRIPT_CODE, an admin must:
//   1. Open the Google Sheet -> Extensions -> Apps Script
//   2. Select all existing code (Ctrl+A) and paste the new copied code
//   3. Save (Ctrl+S)
//   4. Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy
// The Web App URL itself does not change when you deploy a new version,
// so nothing needs to change in Store Settings.
// ============================================================

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

// All requests are routed through the server's /api/google-sheets/proxy so the
// browser doesn't have to deal with Apps Script's no-cors response, and we get
// a real success/failure confirmation instead of guessing.
async function postToAppsScript(webhookUrl: string, payload: Record<string, any>): Promise<{ ok: boolean; result?: any; error?: string }> {
  if (!isAppsScriptUrl(webhookUrl)) {
    return { ok: false, error: 'Google Sheet Web App URL is missing or is not a valid Apps Script /exec link.' };
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
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not reach the Google Sheet server proxy.' };
  }
}

// ------------------------------------------------------------
// Order row builder - kept in sync with buildOrderSheetRowServer()
// in server.ts and with the ORA_ORDER_HEADERS list inside the Apps
// Script embedded below.
// ------------------------------------------------------------

const orderQtyOfferLabel = (order: any, settings: Record<string, any>): string => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const qty = items.reduce((sum: number, it: any) => sum + Math.max(1, Number(it?.quantity || 1)), 0);
  const discount = Math.max(0, Number(order?.special_offer_discount || 0));
  if (discount <= 0) return 'No Qty Offer';
  if (settings?.multi_buy_discount_enabled) {
    const tiers = [
      { min: Number(settings.multi_buy_tier1_min ?? 2), max: Number(settings.multi_buy_tier1_max ?? 3), rate: Number(settings.multi_buy_tier1_rate ?? 5) },
      { min: Number(settings.multi_buy_tier2_min ?? 4), max: Number(settings.multi_buy_tier2_max ?? 5), rate: Number(settings.multi_buy_tier2_rate ?? 7.5) },
      { min: Number(settings.multi_buy_tier3_min ?? 6), max: Number(settings.multi_buy_tier3_max ?? 10), rate: Number(settings.multi_buy_tier3_rate ?? 10) },
    ];
    const tier = tiers.find(t => qty >= t.min && qty <= t.max && t.rate > 0);
    if (tier) return `Qty Offer ${tier.rate}% (${qty} items)`;
  }
  return `Order Offer Rs. ${Math.round(discount * 100) / 100}`;
};

const buildOrderSheetRow = (order: any, item: any, isFirst: boolean, settings: Record<string, any>) => ({
  'Order ID': String(order?.order_number || ''),
  'Customer Name': String(order?.customer_name || ''),
  'Phone Number': String(order?.phone || ''),
  'Address': String(order?.address || ''),
  'Item Name': String(item?.product_name || order?.items?.[0]?.product_name || ''),
  'Item Code': String(item?.sku || order?.items?.[0]?.sku || ''),
  'Qty': Math.max(1, Number(item?.quantity ?? 1)),
  'Unit Price (Rs)': Number(item?.unit_price ?? order?.items?.[0]?.unit_price ?? 0),
  'Final Total (Rs)': isFirst ? Number(order?.total_amount ?? 0) : 0,
  'Variant / Color': String(item?.variant_name || order?.items?.[0]?.variant_name || ''),
  'Order Action': 'PENDING',
  'Offer': orderQtyOfferLabel(order, settings),
  'Discount (Rs)': isFirst ? Number(order?.special_offer_discount || 0) : 0,
  'Source': String(order?.order_source || 'Website'),
  'Main Code': String(item?.main_sku || item?.sku || ''),
  'Line Total (Rs)': Math.max(1, Number(item?.quantity ?? 1)) * Number(item?.unit_price ?? 0),
  'Normal Total (Rs)': isFirst ? Number(order?.subtotal || 0) : 0,
  'Delivery Fee (Rs)': isFirst ? Number(order?.delivery_fee || 0) : 0,
  'WhatsApp Number': String(order?.whatsapp || order?.phone || ''),
  'Order Time': String(order?.created_at || new Date().toISOString()),
  'Imported Status': String(order?.call_center_status || 'Pending'),
  'City': String(order?.city || ''),
  'District': String(order?.district || ''),
});

const buildOrderGroups = (orders: any[], settings: Record<string, any>) => {
  const groups: Record<string, any[]> = {};
  for (const order of orders) {
    const source = String(order?.order_source || 'Website');
    if (!groups[source]) groups[source] = [];
    const items = Array.isArray(order?.items) && order.items.length ? order.items : [null];
    items.forEach((item: any, i: number) => {
      groups[source].push(buildOrderSheetRow(order, item, i === 0, settings));
    });
  }
  return groups;
};

// ------------------------------------------------------------
// Orders
// ------------------------------------------------------------

export async function syncOrderToGoogleSheets(order: any, webhookUrl: string, settings: Record<string, any>, _products?: any[]): Promise<SheetActionResult> {
  const res = await postToAppsScript(webhookUrl, { action: 'sync_orders', groups: buildOrderGroups([order], settings) });
  if (!res.ok) return { success: false, message: res.error || 'Google Sheet sync failed.' };
  const status = res.result?.status;
  if (status !== 'orders_synced' && status !== 'orders_batch_synced') {
    return { success: false, message: res.result?.error || `Unexpected Google Sheet response: ${status || 'empty'}` };
  }
  return { success: true, message: 'Order synced to Google Sheet.', synced: res.result?.synced, existing: res.result?.existing, rows: res.result?.rows };
}

export async function syncOrdersBatchToGoogleSheets(orders: any[], webhookUrl: string, settings: Record<string, any>): Promise<SheetActionResult> {
  if (!orders || !orders.length) return { success: true, message: 'Nothing to sync.', synced: 0 };
  const res = await postToAppsScript(webhookUrl, { action: 'sync_orders', groups: buildOrderGroups(orders, settings) });
  if (!res.ok) return { success: false, message: res.error || 'Google Sheet batch sync failed.' };
  const status = res.result?.status;
  if (status !== 'orders_synced' && status !== 'orders_batch_synced') {
    return { success: false, message: res.result?.error || `Unexpected Google Sheet response: ${status || 'empty'}` };
  }
  return { success: true, message: 'Orders synced to Google Sheet.', synced: res.result?.synced, existing: res.result?.existing, rows: res.result?.rows };
}

export async function deleteOrderFromGoogleSheets(orderId: string, webhookUrl: string): Promise<SheetActionResult> {
  const res = await postToAppsScript(webhookUrl, { action: 'delete_order', orderId });
  if (!res.ok) return { success: false, message: res.error || 'Google Sheet order delete failed.' };
  return { success: true, message: 'Order removed from Google Sheet.' };
}

// ------------------------------------------------------------
// Product catalog (feeds the "Change Item To" dropdown in the Sheet)
// ------------------------------------------------------------

export async function syncProductCatalogToGoogleSheets(products: any[], webhookUrl: string, _settings?: Record<string, any>): Promise<SheetActionResult> {
  const res = await postToAppsScript(webhookUrl, { action: 'catalog_sync', products });
  if (!res.ok) return { success: false, message: res.error || 'Google Sheet catalog sync failed.' };
  return { success: true, message: 'Product catalog synced to Google Sheet.', rows: res.result?.rows };
}

// ------------------------------------------------------------
// Clear / reset helpers
// ------------------------------------------------------------

export async function clearGoogleSheetTestData(webhookUrl: string): Promise<SheetActionResult> {
  const res = await postToAppsScript(webhookUrl, { action: 'clear_test_orders' });
  if (!res.ok) return { success: false, message: res.error || 'Could not clear test orders from the Google Sheet.' };
  return { success: true, message: 'Test orders cleared from Google Sheet.', removed: res.result?.removed };
}

export async function clearGoogleSheetLiveStartData(webhookUrl: string): Promise<SheetActionResult> {
  const res = await postToAppsScript(webhookUrl, { action: 'clear_live_start_data' });
  if (!res.ok) return { success: false, message: res.error || 'Could not clear the Google Sheet for live start.' };
  return { success: true, message: 'Google Sheet order data cleared for live start.', removed: res.result?.removed };
}

// ============================================================
// GOOGLE APPS SCRIPT SOURCE
// Paste this whole block into the Google Sheet's Apps Script editor.
// (Admin Dashboard -> Google Sheets panel -> "Copy code" button copies
// exactly this string.)
// ============================================================
export const GOOGLE_APPS_SCRIPT_CODE = `// ============================================================
// O-RA STORE - GOOGLE SHEET SYNC V15.6
// CITY LIST: A=City, B=District
// Existing order columns are NEVER cleared/reordered.
// ============================================================

var ORA_ORDER_HEADERS = ["Order ID","Customer Name","Phone Number","Address","Item Name","Item Code","Qty","Unit Price (Rs)","Final Total (Rs)","Variant / Color","Item Action","Order Action","Offer","Cancel Reason","Change Item To","Change Preview","Apply Item Change","Discount (Rs)","Source","Main Code","Line Total (Rs)","Normal Total (Rs)","Delivery Fee (Rs)","WhatsApp Number","Original Main Code","Original Variant / Color","Original Item Code","Original Item Name","Original Qty","Order Time","Lead ID","Imported Status","Last Sync","City","District"];

var ORA_CATALOG_HEADERS = ["Item Image","Main Code","Variant Code","Item Name","Variant / Color","Type","Selling Price (Rs)","Current Stock","Status","Image URL","Select Product / Variant","Last Updated"];

var ORA_ORDER_SHEETS = ["CALL CENTER ORDERS","FACEBOOK ORDERS","TIKTOK ORDERS"];
var ORA_DELETED_SHEET = "DELETED ORDERS";
var ORA_CITY_TAB = "CITY LIST";
var ORA_VERSION = "O-RA Store Google Sheet Sync V15.6";

function oraJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function oraCol_(h) {
  return ORA_ORDER_HEADERS.indexOf(h) + 1;
}

function oraOrderSheetName_(source) {
  var s = String(source || "").toLowerCase();
  if (s.indexOf("facebook") >= 0) return "FACEBOOK ORDERS";
  if (s.indexOf("tiktok") >= 0) return "TIKTOK ORDERS";
  return "CALL CENTER ORDERS";
}

function oraPick_(o, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = o ? o[keys[i]] : undefined;
    if (v !== undefined && v !== null && String(v) !== "") return v;
  }
  return "";
}

function oraNum_(v) {
  var n = Number(String(v || "0").replace(/[^0-9.-]/g, ""));
  return isFinite(n) ? n : 0;
}

function oraItemActionColor_(v) {
  return String(v || "").toUpperCase().indexOf("CANCEL") >= 0
    ? "#fecaca"
    : "#bbf7d0";
}

function oraOrderActionColor_(v) {
  var s = String(v || "").toUpperCase();
  if (s.indexOf("CONFIRM") >= 0) return "#bbf7d0";
  if (s.indexOf("CANCEL") >= 0) return "#fecaca";
  if (s.indexOf("NO ANSWER") >= 0) return "#fbcfe8";
  return "#bfdbfe";
}

function oraHasHeaders_(sh, headers) {
  if (!sh || sh.getLastRow() < 1) return false;
  var row = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(row[i] || "") !== headers[i]) return false;
  }
  return true;
}

/*
 IMPORTANT:
 Existing sheets are NEVER cleared.
 Existing columns are NEVER reordered.
 Existing City / District / Confirm / Cancel / Upload columns stay where they are.
 Only genuinely missing headers are appended at the end.
*/
function oraEnsureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);

  if (!sh) {
    sh = ss.insertSheet(name);

    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(
        sh.getMaxColumns(),
        headers.length - sh.getMaxColumns()
      );
    }

    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }

  var lc = Math.max(1, sh.getLastColumn());
  var current = sh.getRange(1, 1, 1, lc).getDisplayValues()[0];
  var seen = {};

  for (var i = 0; i < current.length; i++) {
    var h = String(current[i] || "").trim();
    if (h) seen[h] = i + 1;
  }

  var missing = [];

  for (var j = 0; j < headers.length; j++) {
    var wanted = headers[j];
    if (!seen[wanted]) missing.push(wanted);
  }

  if (missing.length) {
    var start = Math.max(1, sh.getLastColumn()) + 1;

    if (sh.getMaxColumns() < start + missing.length - 1) {
      sh.insertColumnsAfter(
        sh.getMaxColumns(),
        start + missing.length - 1 - sh.getMaxColumns()
      );
    }

    sh.getRange(1, start, 1, missing.length)
      .setValues([missing]);
  }

  return sh;
}

function oraFormatOrderSheet_(sh, startRow, count) {
  if (sh.getRange(1, 1).getBackground() !== "#111827") {

    sh.setFrozenRows(1);

    sh.getRange(
      1,
      1,
      1,
      ORA_ORDER_HEADERS.length
    )
      .setFontWeight("bold")
      .setBackground("#111827")
      .setFontColor("#ffffff")
      .setWrap(true);

    var widths = {
      "Order ID":100,
      "Customer Name":130,
      "Phone Number":94,
      "Address":155,
      "Item Name":165,
      "Item Code":92,
      "Qty":46,
      "Unit Price (Rs)":86,
      "Final Total (Rs)":92,
      "Variant / Color":105,
      "Item Action":105,
      "Order Action":120,
      "Offer":90,
      "Cancel Reason":125,
      "Change Item To":155,
      "Change Preview":165,
      "Apply Item Change":86,
      "City":110,
      "District":110
    };

    Object.keys(widths).forEach(function(h) {
      var c = oraCol_(h);
      if (c > 0) sh.setColumnWidth(c, widths[h]);
    });
  }

  if (startRow && count > 0) {

    sh.getRange(
      startRow,
      oraCol_("Qty"),
      count,
      1
    ).setNumberFormat("0");

    [
      "Unit Price (Rs)",
      "Final Total (Rs)",
      "Discount (Rs)",
      "Line Total (Rs)",
      "Normal Total (Rs)",
      "Delivery Fee (Rs)"
    ].forEach(function(h) {
      sh.getRange(
        startRow,
        oraCol_(h),
        count,
        1
      ).setNumberFormat("#,##0.00");
    });

    [
      "Phone Number",
      "WhatsApp Number",
      "Lead ID"
    ].forEach(function(h) {
      sh.getRange(
        startRow,
        oraCol_(h),
        count,
        1
      ).setNumberFormat("@");
    });
  }
}

function oraValidationsRange_(ss, sh, start, count) {

  if (count <= 0) return;

  sh.getRange(
    start,
    oraCol_("Qty"),
    count,
    1
  )
    .setDataValidation(
      SpreadsheetApp
        .newDataValidation()
        .requireNumberBetween(1, 99)
        .setAllowInvalid(false)
        .build()
    )
    .setNote(
      "Type a whole Qty from 1 to 99. Final Total updates automatically."
    );

  sh.getRange(
    start,
    oraCol_("Item Action"),
    count,
    1
  )
    .setDataValidation(
      SpreadsheetApp
        .newDataValidation()
        .requireValueInList(
          ["KEEP ITEM", "CANCEL ITEM"],
          true
        )
        .setAllowInvalid(false)
        .build()
    );

  sh.getRange(
    start,
    oraCol_("Order Action"),
    count,
    1
  )
    .setDataValidation(
      SpreadsheetApp
        .newDataValidation()
        .requireValueInList(
          [
            "PENDING",
            "NO ANSWER",
            "CONFIRM ORDER",
            "CANCEL ENTIRE ORDER"
          ],
          true
        )
        .setAllowInvalid(false)
        .build()
    );

  sh.getRange(
    start,
    oraCol_("Apply Item Change"),
    count,
    1
  )
    .setDataValidation(
      SpreadsheetApp
        .newDataValidation()
        .requireCheckbox()
        .build()
    );

  var cat = oraEnsureSheet_(
    ss,
    "PRODUCT CATALOG",
    ORA_CATALOG_HEADERS
  );

  var clr = cat.getLastRow();

  var changeRange = sh.getRange(
    start,
    oraCol_("Change Item To"),
    count,
    1
  );

  changeRange.clearDataValidations();

  if (clr > 1) {
    changeRange.setDataValidation(
      SpreadsheetApp
        .newDataValidation()
        .requireValueInRange(
          cat.getRange(2, 11, clr - 1, 1),
          true
        )
        .setAllowInvalid(false)
        .build()
    );
  }

  var mains = sh.getRange(
    start,
    oraCol_("Main Code"),
    count,
    1
  ).getDisplayValues();

  var byMain = {};

  if (clr > 1) {

    var catVals = cat.getRange(
      2,
      2,
      clr - 1,
      4
    ).getDisplayValues();

    for (var i = 0; i < catVals.length; i++) {

      var m = String(
        catVals[i][0] || ""
      ).trim().toUpperCase();

      var v = String(
        catVals[i][3] || ""
      ).trim();

      if (!m || !v) continue;

      if (!byMain[m]) byMain[m] = [];

      if (byMain[m].indexOf(v) < 0) {
        byMain[m].push(v);
      }
    }
  }

  var rules = [];

  for (var r = 0; r < count; r++) {

    var vals =
      byMain[
        String(
          mains[r][0] || ""
        ).trim().toUpperCase()
      ] || [];

    rules.push([
      vals.length
        ? SpreadsheetApp
            .newDataValidation()
            .requireValueInList(vals, true)
            .setAllowInvalid(false)
            .build()
        : null
    ]);
  }

  sh.getRange(
    start,
    oraCol_("Variant / Color"),
    count,
    1
  ).setDataValidations(rules);

  oraApplyCityDropdown_(
    ss,
    sh,
    start,
    count
  );
}

function oraEnsureCityTab_(ss) {

  var sh = ss.getSheetByName(
    ORA_CITY_TAB
  );

  if (!sh) {
    sh = ss.insertSheet(ORA_CITY_TAB);
  }

  if (
    String(
      sh.getRange(1, 1).getDisplayValue() || ""
    ) !== "City"
  ) {

    sh.getRange(1, 1)
      .setValue("City");

    sh.getRange(1, 2)
      .setValue("District");

    sh.getRange(1, 3)
      .setValue("City • District (auto)");

    sh.getRange(
      1,
      1,
      1,
      3
    )
      .setFontWeight("bold")
      .setBackground("#111827")
      .setFontColor("#ffffff");

    sh.setColumnWidth(1, 160);
    sh.setColumnWidth(2, 140);
    sh.setColumnWidth(3, 240);
  }

  return sh;
}

function oraEnsureCombined_(ss) {

  try {

    var cityTab =
      ss.getSheetByName(
        ORA_CITY_TAB
      );

    if (!cityTab) return;

    var last =
      cityTab.getLastRow();

    if (last < 2) return;

    var a =
      cityTab
        .getRange(
          2,
          1,
          last - 1,
          1
        )
        .getDisplayValues();

    var b =
      cityTab
        .getRange(
          2,
          2,
          last - 1,
          1
        )
        .getDisplayValues();

    var combined = [];

    for (var i = 0; i < a.length; i++) {

      var c =
        String(
          a[i][0] || ""
        ).trim();

      var d =
        String(
          b[i][0] || ""
        ).trim();

      combined.push([
        c
          ? (
              c +
              (
                d
                  ? " • " + d
                  : ""
              )
            )
          : ""
      ]);
    }

    var cRange =
      cityTab.getRange(
        2,
        3,
        Math.max(
          1,
          cityTab.getMaxRows() - 1
        ),
        1
      );

    cRange.clearContent();

    if (combined.length) {
      cityTab
        .getRange(
          2,
          3,
          combined.length,
          1
        )
        .setValues(combined);
    }

  } catch (e) {}
}

function oraApplyCityDropdown_(
  ss,
  sh,
  startRow,
  count
) {

  try {

    var cityTab =
      ss.getSheetByName(
        ORA_CITY_TAB
      );

    if (
      !cityTab ||
      !sh ||
      !startRow ||
      !count
    ) return;

    var last =
      cityTab.getLastRow();

    if (last < 2) return;

    var useCol = 3;

    if (
      cityTab.getLastColumn() < 3 ||
      !String(
        cityTab
          .getRange(2, 3)
          .getDisplayValue() || ""
      ).trim()
    ) {
      useCol = 1;
    }

    var src =
      cityTab.getRange(
        2,
        useCol,
        last - 1,
        1
      );

    var rng =
      sh.getRange(
        startRow,
        oraCol_("City"),
        count,
        1
      );

    rng.clearDataValidations();

    rng.setDataValidation(
      SpreadsheetApp
        .newDataValidation()
        .requireValueInRange(
          src,
          true
        )
        .setAllowInvalid(true)
        .build()
    );

  } catch (e) {}
}

function oraRebuildCityDropdowns() {

  var ss =
    SpreadsheetApp.getActiveSpreadsheet();

  oraEnsureCityTab_(ss);
  oraEnsureCombined_(ss);

  var total = 0;

  for (
    var i = 0;
    i < ORA_ORDER_SHEETS.length;
    i++
  ) {

    var sh =
      ss.getSheetByName(
        ORA_ORDER_SHEETS[i]
      );

    if (!sh) continue;

    var lr =
      sh.getLastRow();

    if (lr >= 2) {

      oraApplyCityDropdown_(
        ss,
        sh,
        2,
        lr - 1
      );

      total += lr - 1;
    }
  }

  SpreadsheetApp
    .getActive()
    .toast(
      "City dropdowns rebuilt from CITY LIST tab (" +
      total +
      " rows).",
      "O-RA",
      4
    );
}

function oraSearchCitiesFromTab_(q) {

  try {

    var ss =
      SpreadsheetApp.getActiveSpreadsheet();

    var cityTab =
      ss.getSheetByName(
        ORA_CITY_TAB
      );

    if (!cityTab) return [];

    var last =
      cityTab.getLastRow();

    if (last < 2) return [];

    var vals =
      cityTab
        .getRange(
          2,
          1,
          last - 1,
          2
        )
        .getDisplayValues();

    var query =
      String(q || "")
        .trim()
        .toLowerCase();

    if (query.length < 3) return [];

    var out = [];

    for (
      var i = 0;
      i < vals.length &&
      out.length < 200;
      i++
    ) {

      var city =
        String(
          vals[i][0] || ""
        ).trim();

      var district =
        String(
          vals[i][1] || ""
        ).trim();

      if (!city) continue;

      if (
        city
          .toLowerCase()
          .indexOf(query) < 0
      ) continue;

      out.push({
        city: city,
        district: district
      });
    }

    return out;

  } catch (e) {
    return [];
  }
}

function oraAppendOrders_(ss, orders) {

  var bySheet = {
    "CALL CENTER ORDERS": [],
    "FACEBOOK ORDERS": [],
    "TIKTOK ORDERS": []
  };

  for (
    var i = 0;
    i < orders.length;
    i++
  ) {

    var o = orders[i] || {};

    var id =
      String(
        oraPick_(
          o,
          [
            "orderId",
            "order_id",
            "order_number",
            "orderNo"
          ]
        )
      ).trim();

    if (!id) continue;

    bySheet[
      oraOrderSheetName_(
        oraPick_(
          o,
          [
            "source",
            "order_source"
          ]
        )
      )
    ].push(o);
  }

  var summary = {
    synced: 0,
    existing: 0,
    rows: 0
  };

  for (var sName in bySheet) {

    var list =
      bySheet[sName];

    if (!list.length) continue;

    var sh =
      oraEnsureSheet_(
        ss,
        sName,
        ORA_ORDER_HEADERS
      );

    var existing = {};

    var lr =
      sh.getLastRow();

    if (lr >= 2) {

      var ids =
        sh
          .getRange(
            2,
            oraCol_("Order ID"),
            lr - 1,
            1
          )
          .getDisplayValues();

      for (
        var x = 0;
        x < ids.length;
        x++
      ) {

        var k =
          String(
            ids[x][0] || ""
          )
            .trim()
            .toUpperCase();

        if (k) {
          existing[k] = true;
        }
      }
    }

    var rows = [];
    var seen = {};

    for (
      var j = 0;
      j < list.length;
      j++
    ) {

      var ob =
        list[j];

      var oid =
        String(
          oraPick_(
            ob,
            [
              "orderId",
              "order_id",
              "order_number",
              "orderNo"
            ]
          )
        ).trim();

      var key =
        oid.toUpperCase();

      if (
        existing[key] ||
        seen[key]
      ) {
        summary.existing++;
        continue;
      }

      seen[key] = true;

      var items =
        (
          Array.isArray(ob.items) &&
          ob.items.length
        )
          ? ob.items
          : [{}];

      var cust =
        String(
          oraPick_(
            ob,
            [
              "customerName",
              "customer_name"
            ]
          )
        );

      var phone =
        String(
          oraPick_(
            ob,
            [
              "phoneNumber",
              "phone_number",
              "phone"
            ]
          )
        );

      var addr =
        String(
          oraPick_(
            ob,
            ["address"]
          )
        );

      var offer =
        String(
          oraPick_(
            ob,
            [
              "offer",
              "offer_label"
            ]
          )
        ) ||
        "No Qty Offer";

      var discount =
        oraNum_(
          oraPick_(
            ob,
            [
              "discount",
              "discount_amount",
              "special_offer_discount"
            ]
          )
        );

      var delivery =
        oraNum_(
          oraPick_(
            ob,
            [
              "deliveryFee",
              "delivery_fee"
            ]
          )
        );

      var normalTotal =
        oraNum_(
          oraPick_(
            ob,
            [
              "normalTotal",
              "normal_total",
              "subtotal"
            ]
          )
        );

      var finalTotal =
        oraNum_(
          oraPick_(
            ob,
            [
              "finalTotal",
              "final_total",
              "total_amount"
            ]
          )
        );

      var orderTime =
        String(
          oraPick_(
            ob,
            [
              "orderTime",
              "order_time",
              "created_at"
            ]
          )
        ) ||
        new Date();

      var leadId =
        String(
          oraPick_(
            ob,
            [
              "leadId",
              "lead_id",
              "platform_lead_id"
            ]
          )
        );

      var impStatus =
        String(
          oraPick_(
            ob,
            [
              "importedStatus",
              "imported_status"
            ]
          )
        ) ||
        "New";

      var city =
        String(
          oraPick_(
            ob,
            ["city"]
          )
        );

      var district =
        String(
          oraPick_(
            ob,
            ["district"]
          )
        );

      var whatsapp =
        String(
          oraPick_(
            ob,
            [
              "whatsAppNumber",
              "whatsapp_number",
              "phone"
            ]
          )
        );

      var source =
        String(
          oraPick_(
            ob,
            [
              "source",
              "order_source"
            ]
          )
        ) ||
        "Website";

      for (
        var it = 0;
        it < items.length;
        it++
      ) {

        var itm =
          items[it] || {};

        var mainCode =
          String(
            oraPick_(
              itm,
              [
                "mainCode",
                "main_code",
                "main_sku",
                "sku"
              ]
            )
          );

        var variant =
          String(
            oraPick_(
              itm,
              [
                "variant",
                "variant_name",
                "variantColor"
              ]
            )
          );

        var itemCode =
          String(
            oraPick_(
              itm,
              [
                "itemCode",
                "item_code",
                "sku"
              ]
            )
          );

        var itemName =
          String(
            oraPick_(
              itm,
              [
                "itemName",
                "item_name",
                "product_name"
              ]
            )
          );

        var qty =
          Math.max(
            1,
            Math.round(
              oraNum_(
                oraPick_(
                  itm,
                  [
                    "qty",
                    "quantity"
                  ]
                )
              )
            )
          );

        var unit =
          oraNum_(
            oraPick_(
              itm,
              [
                "unitPrice",
                "unit_price"
              ]
            )
          );

        var line =
          Math.round(
            qty * unit * 100
          ) / 100;

        var first =
          it === 0;

        rows.push([
          oid,
          first ? cust : "",
          first ? phone : "",
          first ? addr : "",
          itemName,
          itemCode,
          qty,
          unit,
          first ? finalTotal : "",
          variant,
          "KEEP ITEM",
          first ? "PENDING" : "",
          offer,
          "",
          "",
          "",
          false,
          discount,
          source,
          mainCode,
          line,
          normalTotal,
          delivery,
          whatsapp,
          mainCode,
          variant,
          itemCode,
          itemName,
          qty,
          orderTime,
          leadId,
          impStatus,
          new Date(),
          first ? city : "",
          first ? district : ""
        ]);
      }

      summary.synced++;
      summary.rows += items.length;
    }

    if (!rows.length) continue;

    var startRow =
      Math.max(
        2,
        sh.getLastRow() + 1
      );

    sh.getRange(
      startRow,
      1,
      rows.length,
      ORA_ORDER_HEADERS.length
    ).setValues(rows);

    sh.getRange(
      startRow,
      1,
      rows.length,
      ORA_ORDER_HEADERS.length
    ).setBorder(
      true,
      true,
      true,
      true,
      false,
      false,
      "#94a3b8",
      SpreadsheetApp.BorderStyle.SOLID
    );

    var shades = [];
    var weights = [];
    var prevKey = "";

    for (
      var b = 0;
      b < rows.length;
      b++
    ) {

      var rk =
        String(rows[b][0])
          .trim()
          .toUpperCase();

      var cont =
        rk === prevKey;

      prevKey = rk;

      var base =
        cont
          ? "#ffffff"
          : "#f8fafc";

      var itemAct =
        String(
          rows[b][10] || ""
        );

      var orderAct =
        String(
          rows[b][11] || ""
        );

      var arr = [];

      for (
        var c = 0;
        c < ORA_ORDER_HEADERS.length;
        c++
      ) {

        if (c === 10) {
          arr.push(
            oraItemActionColor_(
              itemAct
            )
          );
        } else if (c === 11) {
          arr.push(
            oraOrderActionColor_(
              orderAct
            )
          );
        } else {
          arr.push(base);
        }
      }

      shades.push(arr);

      weights.push([
        cont
          ? "normal"
          : "bold"
      ]);
    }

    sh.getRange(
      startRow,
      1,
      rows.length,
      ORA_ORDER_HEADERS.length
    ).setBackgrounds(shades);

    sh.getRange(
      startRow,
      oraCol_("Order ID"),
      rows.length,
      1
    ).setFontWeights(weights);

    oraFormatOrderSheet_(
      sh,
      startRow,
      rows.length
    );

    oraValidationsRange_(
      ss,
      sh,
      startRow,
      rows.length
    );
  }

  return summary;
}
// ============================================================
// PART 2/3
// O-RA STORE - GOOGLE SHEET SYNC V15.6
// ============================================================

function doGet(e) {

  return oraJson_({
    ok: true,
    service: "O-RA Google Sheet Sync",
    version: ORA_VERSION,
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {

  try {

    if (
      !e ||
      !e.postData ||
      !e.postData.contents
    ) {
      return oraJson_({
        ok: false,
        error: "Missing POST body"
      });
    }

    var body =
      JSON.parse(
        e.postData.contents
      );
          console.log("ORA_DEBUG", JSON.stringify(body).slice(0, 3000));


    var action =
      String(
        body.action ||
        body.type ||
        ""
      ).trim();
          // ORA FIX: accept server payload_type format (no column changes)
    if (!action && body.payload_type) {
        var pt = String(body.payload_type || "").trim();
        if (pt === "orders_sync" || pt === "order_batch_sync" || pt === "order_sync") {
            action = "order_batch_sync";
        } else {
            action = pt;
        }
    }
    if (body.order) { body.orders = [body.order]; }
        var rawOrders = [];
    if (Array.isArray(body.orders)) { rawOrders = body.orders; }
    else if (body.order) { rawOrders = [body.order]; }
    else if (Array.isArray(body.order_rows)) { rawOrders = body.order_rows; }
    else if (body.order_row) { rawOrders = [body.order_row]; }
    else if (body.groups) { for (var gk in body.groups) { if (Array.isArray(body.groups[gk])) rawOrders = rawOrders.concat(body.groups[gk]); } }
    var normOrders = [];
    for (var ni = 0; ni < rawOrders.length; ni++) {
        var src = rawOrders[ni] || {};
        var id = src.order_id || src.order_number || src.orderId || src.orderNo || src['Order ID'] || '';
        if (!id) continue;
        var items = src.items || [];
        if (!items.length) {
            items = [{
                itemName: src['Item Name'] || src.item_name || src.product_name || src.name || '',
                itemCode: src['Item Code'] || src.item_code || src.sku || '',
                qty: src['Qty'] || src.qty || src.quantity || 1,
                unitPrice: src['Unit Price (Rs)'] || src.unit_price || src.price || 0,
                variantName: src['Variant / Color'] || src.variant_name || ''
            }];
        }
        for (var ii = 0; ii < items.length; ii++) {
            var it = items[ii] || {};
            var itemName = it.itemName || it.item_name || it.product_name || it.name || it['Item Name'] || '';
            var itemCode = it.itemCode || it.item_code || it.sku || it['Item Code'] || '';
            var qty = Number(it.qty || it.quantity || it['Qty'] || 1) || 1;
            var unitPrice = Number(it.unitPrice || it.unit_price || it.price || it['Unit Price (Rs)'] || 0) || 0;
            var lineTotal = Number(it.lineTotal || it.line_total || it['Line Total (Rs)'] || (qty * unitPrice)) || 0;
            var variantName = it.variantName || it.variant_name || it['Variant / Color'] || src['Variant / Color'] || '';
            normOrders.push({
                order_id: id,
                order_number: id,
                source: src.source || src.order_source || src['Source'] || 'Website',
                customer_name: src.customer_name || src.customerName || src['Customer Name'] || '',
                phone: src.phone || src.phone_number || src.phoneNumber || src['Phone Number'] || '',
                whatsapp: src.whatsapp || src.whatsAppNumber || src['WhatsApp Number'] || '',
                address: src.address || src['Address'] || '',
                city: src.city || src['City'] || '',
                district: src.district || src['District'] || '',
                itemName: itemName, item_name: itemName, 'Item Name': itemName, product_name: itemName, name: itemName,
                itemCode: itemCode, item_code: itemCode, sku: itemCode, 'Item Code': itemCode,
                qty: qty, quantity: qty, 'Qty': qty,
                unitPrice: unitPrice, unit_price: unitPrice, price: unitPrice, 'Unit Price (Rs)': unitPrice,
                variantName: variantName, variant_name: variantName, 'Variant / Color': variantName,
                lineTotal: lineTotal, line_total: lineTotal, 'Line Total (Rs)': lineTotal,
                total_amount: src.total_amount || src.total || src.finalTotal || src['Final Total (Rs)'] || lineTotal,
                final_total: src.total_amount || src.total || src.finalTotal || src['Final Total (Rs)'] || lineTotal,
                subtotal: src.subtotal || src.normalTotal || src['Normal Total (Rs)'] || 0,
                discount: src.discount || src['Discount (Rs)'] || 0,
                delivery_fee: src.delivery_fee || src.deliveryFee || src['Delivery Fee (Rs)'] || 0,
                created_at: src.created_at || src.orderTime || src['Order Time'] || '',
                order_time: src.created_at || src.orderTime || src['Order Time'] || '',
                call_center_status: src.call_center_status || src.importedStatus || src['Imported Status'] || 'Pending',
                imported_status: src.call_center_status || src.importedStatus || src['Imported Status'] || 'Pending',
                items: [{ itemName: itemName, item_name: itemName, product_name: itemName, name: itemName, itemCode: itemCode, item_code: itemCode, sku: itemCode, qty: qty, quantity: qty, unitPrice: unitPrice, unit_price: unitPrice, price: unitPrice, lineTotal: lineTotal, line_total: lineTotal, variant_name: variantName }]
            });
        }
    }
    body.orders = normOrders;
    if (!action && normOrders.length) { action = "order_batch_sync"; }
    console.log("ORA_DEBUG", SpreadsheetApp.getActiveSpreadsheet().getName(), JSON.stringify(body).slice(0, 3000));
    var ss =
      SpreadsheetApp
        .getActiveSpreadsheet();

    // --------------------------------------------------------
    // ORDER BATCH SYNC
    // --------------------------------------------------------

    if (
      action === "order_batch_sync" ||
      action === "orders_batch_sync" ||
      action === "sync_orders"
    ) {

      var orders =
        Array.isArray(body.orders)
          ? body.orders
          : [];

      if (!orders.length) {
        return oraJson_({
          ok: true,
          status: "orders_synced",
          synced: 0,
          rows: 0
        });
      }

      var result =
        oraAppendOrders_(
          ss,
          orders
        );

      return oraJson_({
        ok: true,
        status: "orders_synced",
        synced: result.synced,
        existing: result.existing,
        rows: result.rows,
        timestamp:
          new Date().toISOString()
      });
    }

    // --------------------------------------------------------
    // SINGLE ORDER SYNC
    // --------------------------------------------------------

    if (
      action === "order_sync" ||
      action === "sync_order"
    ) {

      var one =
        body.order ||
        body.data ||
        body;

      var resultOne =
        oraAppendOrders_(
          ss,
          [one]
        );

      return oraJson_({
        ok: true,
        status: "orders_synced",
        synced: resultOne.synced,
        existing: resultOne.existing,
        rows: resultOne.rows,
        timestamp:
          new Date().toISOString()
      });
    }

    // --------------------------------------------------------
    // PRODUCT CATALOG SYNC
    // (Fills the "PRODUCT CATALOG" tab used by the "Change Item To"
    // dropdown. Accepts either pre-built rows (body.items, keyed by
    // the exact ORA_CATALOG_HEADERS names) or raw product objects
    // (body.products, with nested .variants[]).)
    // --------------------------------------------------------

    if (
      action === "catalog_sync" ||
      action === "sync_catalog" ||
      action === "product_catalog_sync"
    ) {

      var catResult = oraSyncCatalog_(ss, body);

      return oraJson_({
        ok: true,
        status: "catalog_synced",
        rows: catResult.rows,
        timestamp: new Date().toISOString()
      });
    }

    // --------------------------------------------------------
    // DELETE SINGLE ORDER (called from the website admin panel)
    // --------------------------------------------------------

    if (
      action === "delete_order" ||
      action === "delete_order_by_id"
    ) {

      var delResult = oraDeleteOrderRequest_(body);

      return oraJson_(delResult);
    }

    // --------------------------------------------------------
    // CLEAR TEST ORDERS (rows starting with TEST- / WEB-TEST-)
    // --------------------------------------------------------

    if (
      action === "clear_test_orders" ||
      action === "clear_test_data"
    ) {

      var clearTestResult = oraClearTestOrders_();

      return oraJson_({
        ok: true,
        status: "test_orders_cleared",
        removed: clearTestResult.removed
      });
    }

    // --------------------------------------------------------
    // FULL LIVE-START DATA CLEAR (removes ALL order rows so the
    // shop can go live with a clean sheet; headers, City List and
    // Product Catalog structure are kept)
    // --------------------------------------------------------

    if (
      action === "clear_live_start_data"
    ) {

      var clearLiveResult = oraClearLiveStartData_();

      return oraJson_({
        ok: true,
        status: "live_start_data_cleared",
        removed: clearLiveResult.removed
      });
    }

    // --------------------------------------------------------
    // CITY SEARCH
    // --------------------------------------------------------

    if (
      action === "city_search" ||
      action === "search_city"
    ) {

      var q =
        String(
          body.query ||
          body.q ||
          body.city ||
          ""
        );

      return oraJson_({
        ok: true,
        status: "city_search",
        results:
          oraSearchCitiesFromTab_(q)
      });
    }

    // --------------------------------------------------------
    // CITY DROPDOWN REBUILD
    // --------------------------------------------------------

    if (
      action === "rebuild_city_dropdowns"
    ) {

      oraRebuildCityDropdowns();

      return oraJson_({
        ok: true,
        status:
          "city_dropdowns_rebuilt"
      });
    }

    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (
      action === "health" ||
      action === "ping"
    ) {

      return oraJson_({
        ok: true,
        status: "ok",
        version: ORA_VERSION,
        timestamp:
          new Date().toISOString()
      });
    }

    return oraJson_({
      ok: false,
      error:
        "Unknown action: " + action
    });

  } catch (err) {

    return oraJson_({
      ok: false,
      error:
        String(
          err &&
          err.message
            ? err.message
            : err
        )
    });
  }
}


// ============================================================
// CITY / DISTRICT AUTO APPLY
// ============================================================

function oraFindCityDistrict_(cityText) {

  var raw =
    String(
      cityText || ""
    ).trim();

  if (!raw) {
    return {
      city: "",
      district: ""
    };
  }

  // If dropdown value is "City • District"
  if (
    raw.indexOf("•") >= 0
  ) {

    var parts =
      raw.split("•");

    return {
      city:
        String(
          parts[0] || ""
        ).trim(),

      district:
        String(
          parts.slice(1).join("•") || ""
        ).trim()
    };
  }

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var cityTab =
    ss.getSheetByName(
      ORA_CITY_TAB
    );

  if (!cityTab) {
    return {
      city: raw,
      district: ""
    };
  }

  var last =
    cityTab.getLastRow();

  if (last < 2) {
    return {
      city: raw,
      district: ""
    };
  }

  var vals =
    cityTab
      .getRange(
        2,
        1,
        last - 1,
        2
      )
      .getDisplayValues();

  var target =
    raw.toLowerCase();

  for (
    var i = 0;
    i < vals.length;
    i++
  ) {

    var city =
      String(
        vals[i][0] || ""
      ).trim();

    var district =
      String(
        vals[i][1] || ""
      ).trim();

    if (
      city.toLowerCase() === target
    ) {

      return {
        city: city,
        district: district
      };
    }
  }

  return {
    city: raw,
    district: ""
  };
}


function oraApplyCityDistrictRow_(
  sh,
  row
) {

  if (!sh || row < 2) return;

  var cityCol =
    oraCol_("City");

  var districtCol =
    oraCol_("District");

  if (
    cityCol <= 0 ||
    districtCol <= 0
  ) return;

  var raw =
    String(
      sh.getRange(
        row,
        cityCol
      ).getDisplayValue() || ""
    ).trim();

  if (!raw) return;

  var found =
    oraFindCityDistrict_(
      raw
    );

  // IMPORTANT:
  // City column receives ONLY City.
  // District column receives ONLY District.
  sh.getRange(
    row,
    cityCol
  ).setValue(
    found.city
  );

  sh.getRange(
    row,
    districtCol
  ).setValue(
    found.district
  );
}


// ============================================================
// ORDER ACTION / ITEM ACTION HELPERS
// ============================================================

function oraSetOrderActionColor_(
  sh,
  row
) {

  if (!sh || row < 2) return;

  var col =
    oraCol_("Order Action");

  if (col <= 0) return;

  var value =
    String(
      sh.getRange(
        row,
        col
      ).getDisplayValue() || ""
    );

  sh.getRange(
    row,
    col
  ).setBackground(
    oraOrderActionColor_(
      value
    )
  );
}


function oraSetItemActionColor_(
  sh,
  row
) {

  if (!sh || row < 2) return;

  var col =
    oraCol_("Item Action");

  if (col <= 0) return;

  var value =
    String(
      sh.getRange(
        row,
        col
      ).getDisplayValue() || ""
    );

  sh.getRange(
    row,
    col
  ).setBackground(
    oraItemActionColor_(
      value
    )
  );
}


// ============================================================
// SAFE CITY / DISTRICT REPAIR
// ============================================================

function repairCityDistrictColumns() {

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var cityTab =
    oraEnsureCityTab_(ss);

  oraEnsureCombined_(ss);

  /*
   IMPORTANT:
   This does NOT clear any order sheet.
   It does NOT reorder columns.
   It does NOT delete existing columns.
   It only adds missing City / District columns
   at the END if they do not already exist.
  */

  var repaired = [];

  for (
    var i = 0;
    i < ORA_ORDER_SHEETS.length;
    i++
  ) {

    var name =
      ORA_ORDER_SHEETS[i];

    var sh =
      ss.getSheetByName(name);

    if (!sh) continue;

    var last =
      Math.max(
        1,
        sh.getLastColumn()
      );

    var headers =
      sh
        .getRange(
          1,
          1,
          1,
          last
        )
        .getDisplayValues()[0];

    var hasCity = false;
    var hasDistrict = false;

    for (
      var h = 0;
      h < headers.length;
      h++
    ) {

      var hv =
        String(
          headers[h] || ""
        ).trim();

      if (hv === "City")
        hasCity = true;

      if (hv === "District")
        hasDistrict = true;
    }

    var add = [];

    if (!hasCity)
      add.push("City");

    if (!hasDistrict)
      add.push("District");

    if (add.length) {

      var start =
        sh.getLastColumn() + 1;

      if (
        sh.getMaxColumns() <
        start + add.length - 1
      ) {

        sh.insertColumnsAfter(
          sh.getMaxColumns(),
          start +
            add.length -
            1 -
            sh.getMaxColumns()
        );
      }

      sh.getRange(
        1,
        start,
        1,
        add.length
      ).setValues([add]);
    }

    var lr =
      sh.getLastRow();

    if (lr >= 2) {

      oraApplyCityDropdown_(
        ss,
        sh,
        2,
        lr - 1
      );

      repaired.push(
        name +
        ": " +
        sh.getLastColumn() +
        " columns"
      );
    }
  }

  SpreadsheetApp
    .getActive()
    .toast(
      "City / District repaired safely. Existing columns were not removed or moved.",
      "O-RA",
      5
    );

  Logger.log(
    repaired.join("\n")
  );
}


// ============================================================
// CITY LIST IMPORT / REBUILD
// ============================================================

function refreshCityListCombined() {

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  oraEnsureCityTab_(ss);
  oraEnsureCombined_(ss);
  oraRebuildCityDropdowns();

  SpreadsheetApp
    .getActive()
    .toast(
      "CITY LIST combined values and order dropdowns refreshed.",
      "O-RA",
      5
    );
}


// ============================================================
// BASIC SETUP
// ============================================================

function setupOraCallCenterSheet() {

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  oraEnsureCityTab_(ss);
  oraEnsureCombined_(ss);

  for (
    var i = 0;
    i < ORA_ORDER_SHEETS.length;
    i++
  ) {

    var sh =
      oraEnsureSheet_(
        ss,
        ORA_ORDER_SHEETS[i],
        ORA_ORDER_HEADERS
      );

    oraFormatOrderSheet_(
      sh,
      0,
      0
    );

    var lr =
      sh.getLastRow();

    if (lr >= 2) {

      oraValidationsRange_(
        ss,
        sh,
        2,
        lr - 1
      );
    }
  }

  oraRebuildCityDropdowns();

  SpreadsheetApp
    .getActive()
    .toast(
      "O-RA setup completed safely.",
      "O-RA",
      5
    );
}


// ============================================================
// WEB ORDER CITY / DISTRICT UPDATE
// ============================================================

function applyCityDistrictToAllOrders() {

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var total = 0;

  for (
    var s = 0;
    s < ORA_ORDER_SHEETS.length;
    s++
  ) {

    var sh =
      ss.getSheetByName(
        ORA_ORDER_SHEETS[s]
      );

    if (!sh) continue;

    var lr =
      sh.getLastRow();

    if (lr < 2) continue;

    var cityCol =
      oraCol_("City");

    var districtCol =
      oraCol_("District");

    if (
      cityCol <= 0 ||
      districtCol <= 0
    ) continue;

    var cities =
      sh.getRange(
        2,
        cityCol,
        lr - 1,
        1
      ).getDisplayValues();

    var output = [];

    for (
      var r = 0;
      r < cities.length;
      r++
    ) {

      var found =
        oraFindCityDistrict_(
          cities[r][0]
        );

      output.push([
        found.city,
        found.district
      ]);

      if (
        found.city ||
        found.district
      ) {
        total++;
      }
    }

    sh.getRange(
      2,
      cityCol,
      output.length,
      2
    ).setValues(
      output
    );
  }

  SpreadsheetApp
    .getActive()
    .toast(
      "City / District applied to " +
      total +
      " rows.",
      "O-RA",
      5
    );
}


// ============================================================
// DELETE ORDER -> DELETED ORDERS
// ============================================================

function oraEnsureDeletedSheet_(ss) {

  var sh =
    ss.getSheetByName(
      ORA_DELETED_SHEET
    );

  if (!sh) {

    sh =
      ss.insertSheet(
        ORA_DELETED_SHEET
      );
  }

  return sh;
}


function oraDeleteOrderById_(
  orderId
) {

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var target =
    String(
      orderId || ""
    ).trim();

  if (!target) {
    return {
      ok: false,
      error: "Missing order ID"
    };
  }

  var deleted =
    oraEnsureDeletedSheet_(
      ss
    );

  var moved = 0;

  for (
    var s = 0;
    s < ORA_ORDER_SHEETS.length;
    s++
  ) {

    var sh =
      ss.getSheetByName(
        ORA_ORDER_SHEETS[s]
      );

    if (!sh) continue;

    var lr =
      sh.getLastRow();

    if (lr < 2) continue;

    var idCol =
      oraCol_("Order ID");

    var ids =
      sh.getRange(
        2,
        idCol,
        lr - 1,
        1
      ).getDisplayValues();

    for (
      var r = ids.length - 1;
      r >= 0;
      r--
    ) {

      if (
        String(
          ids[r][0] || ""
        ).trim() !== target
      ) continue;

      var row =
        r + 2;

      var last =
        sh.getLastColumn();

      var values =
        sh.getRange(
          row,
          1,
          1,
          last
        ).getValues()[0];

      if (
        deleted.getLastRow() === 0
      ) {

        var headers =
          sh.getRange(
            1,
            1,
            1,
            last
          ).getValues()[0];

        deleted
          .getRange(
            1,
            1,
            1,
            headers.length
          )
          .setValues([
            headers
          ]);
      }

      var destRow =
        deleted.getLastRow() + 1;

      deleted
        .getRange(
          destRow,
          1,
          1,
          values.length
        )
        .setValues([
          values
        ]);

      sh.deleteRow(row);

      moved++;
    }
  }

  return {
    ok: true,
    deleted: moved,
    orderId: target
  };
}


// ============================================================
// DELETE / CLEAR ENDPOINTS
// ============================================================

function oraDeleteOrderRequest_(body) {

  var id =
    oraPick_(
      body,
      [
        "orderId",
        "order_id",
        "id"
      ]
    );

  return oraDeleteOrderById_(
    id
  );
}


// ============================================================
// PRODUCT CATALOG SYNC (feeds the "Change Item To" dropdown)
// ============================================================

function oraFlattenCatalogProducts_(products) {

  var rows = [];
  var now = new Date().toISOString();

  for (var i = 0; i < products.length; i++) {

    var p = products[i] || {};
    var mainCode = String(p.sku || p.main_sku || "");
    var name = String(p.name_en || p.name || "");
    var img = (Array.isArray(p.images) && p.images.length) ? String(p.images[0]) : "";
    var type = String(p.product_type || "");
    var variants = Array.isArray(p.variants) ? p.variants : [];

    if (!variants.length) {
      rows.push([
        img,
        mainCode,
        mainCode,
        name,
        "",
        type,
        oraNum_(p.selling_price),
        oraNum_(p.stock_quantity),
        String(p.status || ""),
        img,
        name,
        now
      ]);
      continue;
    }

    for (var v = 0; v < variants.length; v++) {

      var vv = variants[v] || {};
      var variantCode = String(vv.sku || "");
      var variantName = String(vv.option_value || "");
      var label = variantName ? (name + " - " + variantName) : name;

      rows.push([
        vv.image || img,
        mainCode,
        variantCode,
        name,
        variantName,
        type,
        oraNum_(vv.selling_price),
        oraNum_(vv.stock_quantity),
        String(vv.status || p.status || ""),
        vv.image || img,
        label,
        now
      ]);
    }
  }

  return rows;
}

function oraSyncCatalog_(ss, body) {

  var sh = oraEnsureSheet_(
    ss,
    "PRODUCT CATALOG",
    ORA_CATALOG_HEADERS
  );

  var rows = [];

  if (Array.isArray(body.items) && body.items.length) {

    for (var i = 0; i < body.items.length; i++) {
      var it = body.items[i] || {};
      rows.push(
        ORA_CATALOG_HEADERS.map(function(h) {
          return it[h] !== undefined && it[h] !== null ? it[h] : "";
        })
      );
    }

  } else if (Array.isArray(body.products)) {

    rows = oraFlattenCatalogProducts_(body.products);
  }

  // The Product Catalog is a system-managed reference sheet (not an
  // order sheet), so it is safe to fully rebuild its data rows on
  // every sync -- this keeps prices/stock/dropdowns always accurate
  // without needing complex per-row diffing.
  var lr = sh.getLastRow();
  if (lr > 1) {
    sh.getRange(2, 1, lr - 1, ORA_CATALOG_HEADERS.length).clearContent();
  }

  if (rows.length) {
    sh.getRange(2, 1, rows.length, ORA_CATALOG_HEADERS.length).setValues(rows);
  }

  sh.getRange(1, 1, 1, ORA_CATALOG_HEADERS.length)
    .setFontWeight("bold")
    .setBackground("#111827")
    .setFontColor("#ffffff")
    .setWrap(true);

  return { rows: rows.length };
}


// ============================================================
// FULL LIVE-START DATA CLEAR
// ============================================================

function oraClearLiveStartData_() {

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var removed = 0;
  var allSheets = ORA_ORDER_SHEETS.concat([ORA_DELETED_SHEET]);

  for (var s = 0; s < allSheets.length; s++) {

    var sh = ss.getSheetByName(allSheets[s]);
    if (!sh) continue;

    var lr = sh.getLastRow();
    if (lr < 2) continue;

    removed += (lr - 1);
    sh.deleteRows(2, lr - 1);
  }

  return { ok: true, removed: removed };
}


function oraClearTestOrders_() {

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var removed = 0;

  for (
    var s = 0;
    s < ORA_ORDER_SHEETS.length;
    s++
  ) {

    var sh =
      ss.getSheetByName(
        ORA_ORDER_SHEETS[s]
      );

    if (!sh) continue;

    var lr =
      sh.getLastRow();

    if (lr < 2) continue;

    var idCol =
      oraCol_("Order ID");

    var ids =
      sh.getRange(
        2,
        idCol,
        lr - 1,
        1
      ).getDisplayValues();

    for (
      var r = ids.length - 1;
      r >= 0;
      r--
    ) {

      var id =
        String(
          ids[r][0] || ""
        ).trim();

      if (
        id.toUpperCase()
          .indexOf("TEST-") === 0 ||
        id.toUpperCase()
          .indexOf("WEB-TEST-") === 0
      ) {

        sh.deleteRow(
          r + 2
        );

        removed++;
      }
    }
  }

  return {
    ok: true,
    removed: removed
  };
}
// ============================================================
// PART 3/3
// ============================================================

function onEdit(e) {

  try {

    if (!e || !e.range) return;

    var sh =
      e.range.getSheet();

    var name =
      sh.getName();

    var row =
      e.range.getRow();

    var col =
      e.range.getColumn();

    if (row < 2) return;

    // --------------------------------------------------------
    // CITY COLUMN
    // City -> District
    // --------------------------------------------------------

    if (
      ORA_ORDER_SHEETS.indexOf(name) >= 0 &&
      col === oraCol_("City")
    ) {

      oraApplyCityDistrictRow_(
        sh,
        row
      );

      return;
    }

    // --------------------------------------------------------
    // ITEM ACTION
    // --------------------------------------------------------

    if (
      ORA_ORDER_SHEETS.indexOf(name) >= 0 &&
      col === oraCol_("Item Action")
    ) {

      oraSetItemActionColor_(
        sh,
        row
      );

      return;
    }

    // --------------------------------------------------------
    // ORDER ACTION
    // ONLY FIRST ROW OF EACH ORDER
    // --------------------------------------------------------

    if (
      ORA_ORDER_SHEETS.indexOf(name) >= 0 &&
      col === oraCol_("Order Action")
    ) {

      oraSetOrderActionColor_(
        sh,
        row
      );

      return;
    }

    // --------------------------------------------------------
    // CITY LIST EDIT
    // Rebuild combined City • District values
    // --------------------------------------------------------

    if (
      name === ORA_CITY_TAB &&
      (
        col === 1 ||
        col === 2
      )
    ) {

      oraEnsureCombined_(
        SpreadsheetApp
          .getActiveSpreadsheet()
      );

      oraRebuildCityDropdowns();

      return;
    }

  } catch (err) {

    console.log(
      "onEdit error:",
      err
    );
  }
}


// ============================================================
// INSTALLABLE EDIT HANDLER
// ============================================================

function onEditInstalled(e) {

  try {

    if (!e || !e.range) return;

    var sh =
      e.range.getSheet();

    var name =
      sh.getName();

    var row =
      e.range.getRow();

    var col =
      e.range.getColumn();

    if (row < 2) return;

    if (
      ORA_ORDER_SHEETS.indexOf(name) >= 0 &&
      col === oraCol_("City")
    ) {

      oraApplyCityDistrictRow_(
        sh,
        row
      );

      return;
    }

    if (
      ORA_ORDER_SHEETS.indexOf(name) >= 0 &&
      col === oraCol_("Item Action")
    ) {

      oraSetItemActionColor_(
        sh,
        row
      );

      return;
    }

    if (
      ORA_ORDER_SHEETS.indexOf(name) >= 0 &&
      col === oraCol_("Order Action")
    ) {

      oraSetOrderActionColor_(
        sh,
        row
      );

      return;
    }

    if (
      name === ORA_CITY_TAB &&
      (
        col === 1 ||
        col === 2
      )
    ) {

      var ss =
        SpreadsheetApp
          .getActiveSpreadsheet();

      oraEnsureCombined_(ss);
      oraRebuildCityDropdowns();

      return;
    }

  } catch (err) {

    console.log(
      "onEditInstalled error:",
      err
    );
  }
}


// ============================================================
// INSTALL TRIGGER
// ============================================================

function installOraTrigger() {

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  var triggers =
    ScriptApp
      .getProjectTriggers();

  for (
    var i = 0;
    i < triggers.length;
    i++
  ) {

    if (
      triggers[i]
        .getHandlerFunction() ===
      "onEditInstalled"
    ) {

      ScriptApp
        .deleteTrigger(
          triggers[i]
        );
    }
  }

  ScriptApp
    .newTrigger(
      "onEditInstalled"
    )
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  SpreadsheetApp
    .getActive()
    .toast(
      "O-RA edit trigger installed.",
      "O-RA",
      5
    );
}


// ============================================================
// TEST ORDER CLEANUP
// ============================================================

function clearAllTestOrderData() {

  var result =
    oraClearTestOrders_();

  SpreadsheetApp
    .getActive()
    .toast(
      "Removed " +
      result.removed +
      " test order rows.",
      "O-RA",
      5
    );

  return result;
}


// ============================================================
// MANUAL ORDER DELETE
// ============================================================

function deleteOrderFromSheet() {

  var ui =
    SpreadsheetApp
      .getUi();

  var response =
    ui.prompt(
      "Delete Order",
      "Enter Order ID:",
      ui.ButtonSet.OK_CANCEL
    );

  if (
    response.getSelectedButton() !==
    ui.Button.OK
  ) {
    return;
  }

  var id =
    String(
      response.getResponseText() || ""
    ).trim();

  if (!id) return;

  var result =
    oraDeleteOrderById_(
      id
    );

  ui.alert(
    result.ok
      ? (
          "Order deleted: " +
          result.deleted
        )
      : (
          "Delete failed: " +
          result.error
        )
  );
}


// ============================================================
// CITY SEARCH TEST
// ============================================================

function testCitySearch() {

  var ui =
    SpreadsheetApp.getUi();

  var response =
    ui.prompt(
      "City Search",
      "Type at least 3 letters:",
      ui.ButtonSet.OK_CANCEL
    );

  if (
    response.getSelectedButton() !==
    ui.Button.OK
  ) {
    return;
  }

  var q =
    response.getResponseText();

  var results =
    oraSearchCitiesFromTab_(
      q
    );

  if (!results.length) {

    ui.alert(
      "No matching cities found."
    );

    return;
  }

  var text = "";

  for (
    var i = 0;
    i < Math.min(
      results.length,
      50
    );
    i++
  ) {

    text +=
      (
        i + 1
      ) +
      ". " +
      results[i].city +
      " • " +
      results[i].district +
      "\n";
  }

  ui.alert(
    "City Search Results\n\n" +
    text
  );
}


// ============================================================
// FULL SAFE SETUP
// ============================================================

function setupOraFinalSafe() {

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  // Never clear existing order sheets.
  // Never reorder existing columns.
  // Never remove City/District.
  // Never remove Confirm/Cancel/Upload columns.

  oraEnsureCityTab_(ss);

  oraEnsureCombined_(ss);

  for (
    var i = 0;
    i < ORA_ORDER_SHEETS.length;
    i++
  ) {

    var sh =
      oraEnsureSheet_(
        ss,
        ORA_ORDER_SHEETS[i],
        ORA_ORDER_HEADERS
      );

    oraFormatOrderSheet_(
      sh,
      0,
      0
    );

    var lr =
      sh.getLastRow();

    if (lr >= 2) {

      oraValidationsRange_(
        ss,
        sh,
        2,
        lr - 1
      );
    }
  }

  oraRebuildCityDropdowns();

  SpreadsheetApp
    .getActive()
    .toast(
      "O-RA FINAL SAFE SETUP completed. Existing columns were preserved.",
      "O-RA",
      6
    );
}


// ============================================================
// WEBHOOK / ORDER TEST
// ============================================================

function testWebhookHealth() {

  var result = {
    ok: true,
    version: ORA_VERSION,
    sheets: [],
    cityList: false
  };

  var ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  result.cityList =
    !!ss.getSheetByName(
      ORA_CITY_TAB
    );

  for (
    var i = 0;
    i < ORA_ORDER_SHEETS.length;
    i++
  ) {

    var sh =
      ss.getSheetByName(
        ORA_ORDER_SHEETS[i]
      );

    result.sheets.push({
      name:
        ORA_ORDER_SHEETS[i],
      exists:
        !!sh,
      rows:
        sh
          ? Math.max(
              0,
              sh.getLastRow() - 1
            )
          : 0,
      columns:
        sh
          ? sh.getLastColumn()
          : 0
    });
  }

  SpreadsheetApp
    .getUi()
    .alert(
      JSON.stringify(
        result,
        null,
        2
      )
    );

  return result;
}


// ============================================================
// END OF O-RA GOOGLE APPS SCRIPT V15.6
// ============================================================
`;
