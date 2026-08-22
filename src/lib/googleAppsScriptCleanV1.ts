export const GOOGLE_APPS_SCRIPT_CODE_CLEAN_V1 = String.raw`// ============================================================
// O-RA STORE - GOOGLE SHEETS CLEAN V1
// Single-file integration. No legacy V16/V17/V18 dependencies.
// ============================================================

var ORA_VERSION = 'O-RA Store Google Sheets Clean V1';
var ORA_TARGET_KEY = 'ORA_CLEAN_TARGET_SPREADSHEET_ID';
var ORA_ORDER_SHEETS = ['CALL CENTER ORDERS', 'FACEBOOK ORDERS', 'TIKTOK ORDERS'];
var ORA_CATALOG_TAB = 'PRODUCT CATALOG';
var ORA_CITY_TAB = 'CITY LIST';
var ORA_DELETED_TAB = 'DELETED ORDERS';
var ORA_GUIDE_TAB = 'GOOGLE SHEETS GUIDE';

var ORA_ORDER_HEADERS = [
  'Order ID','Customer Name','Phone Number','WhatsApp Number','Address','City','District',
  'Item Name','Main Code','Item Code','Variant / Color','Qty','Unit Price (Rs)','Line Total (Rs)',
  'Offer','Discount (Rs)','Normal Total (Rs)','Delivery Fee (Rs)','Final Total (Rs)',
  'Item Action','Order Action','Cancel Reason','Change Item To','Change Preview','Apply Item Change',
  'Source','Order Time','Lead ID','Imported Status','Last Sync',
  'Original Main Code','Original Variant / Color','Original Item Code','Original Item Name','Original Qty',
  'Gift Wrap','Wrapping Cost (Rs)','Qty Offer Rules'
];

var ORA_CATALOG_HEADERS = [
  'Item Image','Main Code','Variant Code','Item Name','Variant / Color','Type',
  'Selling Price (Rs)','Current Stock','Status','Image URL','Select Product / Variant','Last Updated'
];

function oraJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function oraStr_(v) { return v == null ? '' : String(v); }
function oraKey_(v) { return oraStr_(v).trim().toUpperCase(); }
function oraNum_(v) {
  var n = Number(oraStr_(v).replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? n : 0;
}
function oraPick_(obj, names) {
  for (var i = 0; i < names.length; i++) {
    if (obj && obj[names[i]] !== undefined && obj[names[i]] !== null && oraStr_(obj[names[i]]) !== '') return obj[names[i]];
  }
  return '';
}
function oraRound_(n) { return Math.round(oraNum_(n) * 100) / 100; }
function oraYes_(v) {
  return ['YES','TRUE','1','ON','ADD WRAP','GIFT WRAP'].indexOf(oraKey_(v)) >= 0;
}
function oraSheetName_(source) {
  var s = oraStr_(source).toLowerCase();
  if (s.indexOf('facebook') >= 0) return 'FACEBOOK ORDERS';
  if (s.indexOf('tiktok') >= 0) return 'TIKTOK ORDERS';
  return 'CALL CENTER ORDERS';
}
function oraTarget_() {
  var id = PropertiesService.getScriptProperties().getProperty(ORA_TARGET_KEY);
  if (!id) throw new Error('Google Sheet is not initialized. Open the new target Sheet and run setupOraGoogleSheetsCleanV1 once.');
  return SpreadsheetApp.openById(id);
}
function oraHeaderMap_(sh) {
  var vals = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0];
  var map = {};
  for (var i = 0; i < vals.length; i++) map[oraStr_(vals[i])] = i + 1;
  return map;
}
function oraEnsureColumns_(sh, count) {
  if (sh.getMaxColumns() < count) sh.insertColumnsAfter(sh.getMaxColumns(), count - sh.getMaxColumns());
}
function oraEnsureOrderSheet_(ss, name) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  oraEnsureColumns_(sh, ORA_ORDER_HEADERS.length);
  sh.getRange(1, 1, 1, ORA_ORDER_HEADERS.length).setValues([ORA_ORDER_HEADERS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, ORA_ORDER_HEADERS.length).setFontWeight('bold');
  sh.autoResizeColumns(1, Math.min(ORA_ORDER_HEADERS.length, 30));
  return sh;
}
function oraEnsureCatalog_(ss) {
  var sh = ss.getSheetByName(ORA_CATALOG_TAB) || ss.insertSheet(ORA_CATALOG_TAB);
  oraEnsureColumns_(sh, ORA_CATALOG_HEADERS.length);
  sh.getRange(1, 1, 1, ORA_CATALOG_HEADERS.length).setValues([ORA_CATALOG_HEADERS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, ORA_CATALOG_HEADERS.length).setFontWeight('bold');
  return sh;
}
function oraEnsureGuide_(ss) {
  var sh = ss.getSheetByName(ORA_GUIDE_TAB) || ss.insertSheet(ORA_GUIDE_TAB);
  sh.clear();
  var rows = [
    ['O-RA STORE - GOOGLE SHEETS CLEAN V1',''],
    ['Order tabs','CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS'],
    ['Order Action','PENDING / CONFIRM ORDER / CANCEL ENTIRE ORDER'],
    ['Item Action','KEEP ITEM / CANCEL ITEM'],
    ['Multi item','One order = multiple rows with the same Order ID. Order-level values stay on first row only.'],
    ['Delete/Clear','System delete removes every row for the Order ID. Clear removes all order rows, not catalog/city.'],
    ['Important','Do not manually delete live order rows. Use system delete/clear so sync state stays correct.']
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.autoResizeColumns(1, 2);
}
function oraSetupValidations_(ss, sh, startRow, count) {
  if (!count) return;
  var hm = oraHeaderMap_(sh);
  if (hm['Item Action']) {
    sh.getRange(startRow, hm['Item Action'], count, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['KEEP ITEM','CANCEL ITEM'], true).setAllowInvalid(false).build()
    );
  }
  if (hm['Order Action']) {
    sh.getRange(startRow, hm['Order Action'], count, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['PENDING','CONFIRM ORDER','CANCEL ENTIRE ORDER'], true).setAllowInvalid(false).build()
    );
  }
  if (hm['Apply Item Change']) sh.getRange(startRow, hm['Apply Item Change'], count, 1).insertCheckboxes();
  if (hm['Gift Wrap']) {
    sh.getRange(startRow, hm['Gift Wrap'], count, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['NO','YES'], true).setAllowInvalid(false).build()
    );
  }
  var cat = ss.getSheetByName(ORA_CATALOG_TAB);
  if (cat && cat.getLastRow() > 1 && hm['Change Item To']) {
    sh.getRange(startRow, hm['Change Item To'], count, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange(2, 11, cat.getLastRow() - 1, 1), true).setAllowInvalid(true).build()
    );
  }
  var city = ss.getSheetByName(ORA_CITY_TAB);
  if (city && city.getLastRow() > 1 && hm['City']) {
    sh.getRange(startRow, hm['City'], count, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(city.getRange(2, 1, city.getLastRow() - 1, 1), true).setAllowInvalid(true).build()
    );
  }
}

function setupOraGoogleSheetsCleanV1() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the NEW target Google Sheet before running setup.');
  PropertiesService.getScriptProperties().setProperty(ORA_TARGET_KEY, ss.getId());
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) oraEnsureOrderSheet_(ss, ORA_ORDER_SHEETS[i]);
  oraEnsureCatalog_(ss);
  if (!ss.getSheetByName(ORA_CITY_TAB)) ss.insertSheet(ORA_CITY_TAB);
  if (!ss.getSheetByName(ORA_DELETED_TAB)) ss.insertSheet(ORA_DELETED_TAB);
  oraEnsureGuide_(ss);
  SpreadsheetApp.flush();
  return { ok: true, status: 'setup_complete', version: ORA_VERSION, spreadsheet_id: ss.getId(), spreadsheet_name: ss.getName() };
}
function setupOraCallCenterSheet() { return setupOraGoogleSheetsCleanV1(); }

function oraFlattenIncoming_(body) {
  var flat = [];
  if (body && body.groups) {
    for (var g in body.groups) if (Array.isArray(body.groups[g])) {
      for (var gi = 0; gi < body.groups[g].length; gi++) {
        var gr = body.groups[g][gi] || {};
        if (!gr.Source && !gr.source && !gr.order_source) gr.Source = g;
        flat.push(gr);
      }
    }
  }
  if (Array.isArray(body && body.orders)) flat = flat.concat(body.orders);
  if (body && body.order) flat.push(body.order);
  if (Array.isArray(body && body.order_rows)) flat = flat.concat(body.order_rows);
  if (body && body.order_row) flat.push(body.order_row);
  return flat;
}
function oraNormalizeOrders_(body) {
  var flat = oraFlattenIncoming_(body);
  var grouped = {}, keys = [];
  for (var i = 0; i < flat.length; i++) {
    var src = flat[i] || {};
    var id = oraStr_(oraPick_(src, ['Order ID','order_number','orderId','order_id','orderNo'])).trim();
    if (!id) continue;
    var key = oraKey_(id);
    if (!grouped[key]) {
      grouped[key] = {
        id: id,
        source: oraStr_(oraPick_(src, ['Source','order_source','source']) || 'Website'),
        customer: oraStr_(oraPick_(src, ['Customer Name','customer_name','customerName'])),
        phone: oraStr_(oraPick_(src, ['Phone Number','phone','phone_number','phoneNumber'])),
        whatsapp: oraStr_(oraPick_(src, ['WhatsApp Number','whatsapp','whatsapp_number']) || oraPick_(src, ['Phone Number','phone'])),
        address: oraStr_(oraPick_(src, ['Address','address'])),
        city: oraStr_(oraPick_(src, ['City','city'])),
        district: oraStr_(oraPick_(src, ['District','district'])),
        offer: oraStr_(oraPick_(src, ['Offer','offer','offer_label'])),
        discount: oraRound_(oraPick_(src, ['Discount (Rs)','special_offer_discount','discount'])),
        normalTotal: oraRound_(oraPick_(src, ['Normal Total (Rs)','subtotal','normal_total'])),
        delivery: oraRound_(oraPick_(src, ['Delivery Fee (Rs)','delivery_fee','deliveryFee'])),
        finalTotal: oraRound_(oraPick_(src, ['Final Total (Rs)','total_amount','final_total','total'])),
        orderTime: oraStr_(oraPick_(src, ['Order Time','created_at','order_time'])),
        leadId: oraStr_(oraPick_(src, ['Lead ID','platform_lead_id','lead_id'])),
        importedStatus: oraStr_(oraPick_(src, ['Imported Status','call_center_status','imported_status']) || 'Pending'),
        giftWrap: oraYes_(oraPick_(src, ['Gift Wrap','gift_wrap','gift_wrap_selected'])) ? 'YES' : 'NO',
        wrappingCost: oraRound_(oraPick_(src, ['Wrapping Cost (Rs)','sheet_wrapping_cost','wrapping_cost','gift_wrap_fee','wrappingFee'])),
        qtyOfferRules: oraStr_(oraPick_(src, ['Qty Offer Rules','sheet_qty_offer_rules','qty_offer_rules','qtyOfferRules'])),
        items: []
      };
      keys.push(key);
    }
    var o = grouped[key];
    var nested = Array.isArray(src.items) && src.items.length ? src.items : null;
    var list = nested || [src];
    for (var j = 0; j < list.length; j++) {
      var it = list[j] || {};
      var qty = Math.max(1, Math.round(oraNum_(oraPick_(it, ['Qty','quantity','qty']) || 1)));
      var unit = oraRound_(oraPick_(it, ['Unit Price (Rs)','unit_price','unitPrice','price']));
      var line = oraRound_(oraPick_(it, ['Line Total (Rs)','subtotal','line_total','lineTotal']));
      if (!line && unit) line = oraRound_(qty * unit);
      o.items.push({
        name: oraStr_(oraPick_(it, ['Item Name','product_name','item_name','name'])),
        main: oraStr_(oraPick_(it, ['Main Code','main_sku','main_code','sku'])),
        code: oraStr_(oraPick_(it, ['Item Code','sku','item_code'])),
        variant: oraStr_(oraPick_(it, ['Variant / Color','variant_name','variant','variantColor'])),
        qty: qty,
        unit: unit,
        line: line
      });
    }
  }
  var out = [];
  for (var k = 0; k < keys.length; k++) out.push(grouped[keys[k]]);
  return out;
}

function oraCaptureActions_(sh, orderId) {
  var out = { orderAction: 'PENDING', cancelReason: '', giftWrap:'', wrappingCost:'', items: {} };
  if (sh.getLastRow() < 2) return out;
  var hm = oraHeaderMap_(sh);
  if (!hm['Order ID']) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    if (oraKey_(vals[i][hm['Order ID'] - 1]) !== oraKey_(orderId)) continue;
    if (hm['Order Action'] && vals[i][hm['Order Action'] - 1]) out.orderAction = vals[i][hm['Order Action'] - 1];
    if (hm['Cancel Reason'] && vals[i][hm['Cancel Reason'] - 1]) out.cancelReason = vals[i][hm['Cancel Reason'] - 1];
    if (hm['Gift Wrap'] && vals[i][hm['Gift Wrap'] - 1] && !out.giftWrap) out.giftWrap = vals[i][hm['Gift Wrap'] - 1];
    if (hm['Wrapping Cost (Rs)'] && vals[i][hm['Wrapping Cost (Rs)'] - 1] && out.wrappingCost === '') out.wrappingCost = vals[i][hm['Wrapping Cost (Rs)'] - 1];
    var itemKey = oraKey_((hm['Item Code'] ? vals[i][hm['Item Code'] - 1] : '') + '|' + (hm['Variant / Color'] ? vals[i][hm['Variant / Color'] - 1] : ''));
    if (itemKey && hm['Item Action'] && vals[i][hm['Item Action'] - 1]) out.items[itemKey] = vals[i][hm['Item Action'] - 1];
  }
  return out;
}
function oraDeleteOrderRows_(sh, orderId, moveToDeleted) {
  if (sh.getLastRow() < 2) return 0;
  var hm = oraHeaderMap_(sh), idCol = hm['Order ID'];
  if (!idCol) return 0;
  var ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getDisplayValues();
  var deleted = null, removed = 0;
  if (moveToDeleted) {
    deleted = sh.getParent().getSheetByName(ORA_DELETED_TAB) || sh.getParent().insertSheet(ORA_DELETED_TAB);
    if (deleted.getLastRow() === 0) deleted.getRange(1, 1, 1, ORA_ORDER_HEADERS.length).setValues([ORA_ORDER_HEADERS]);
  }
  for (var i = ids.length - 1; i >= 0; i--) {
    if (oraKey_(ids[i][0]) !== oraKey_(orderId)) continue;
    var row = i + 2;
    if (deleted) {
      var values = sh.getRange(row, 1, 1, ORA_ORDER_HEADERS.length).getValues();
      deleted.getRange(deleted.getLastRow() + 1, 1, 1, ORA_ORDER_HEADERS.length).setValues(values);
    }
    sh.deleteRow(row);
    removed++;
  }
  return removed;
}
function oraWriteOrder_(ss, o) {
  var sh = oraEnsureOrderSheet_(ss, oraSheetName_(o.source));
  var prior = oraCaptureActions_(sh, o.id);
  oraDeleteOrderRows_(sh, o.id, false);
  var hm = oraHeaderMap_(sh), rows = [], now = new Date();
  for (var i = 0; i < o.items.length; i++) {
    var it = o.items[i], first = i === 0, row = [];
    for (var c = 0; c < ORA_ORDER_HEADERS.length; c++) row.push('');
    function set(name, value) { if (hm[name]) row[hm[name] - 1] = value; }
    var itemKey = oraKey_(it.code + '|' + it.variant);
    set('Order ID', o.id);
    set('Customer Name', first ? o.customer : '');
    set('Phone Number', first ? o.phone : '');
    set('WhatsApp Number', first ? o.whatsapp : '');
    set('Address', first ? o.address : '');
    set('City', first ? o.city : '');
    set('District', first ? o.district : '');
    set('Item Name', it.name);
    set('Main Code', it.main || it.code);
    set('Item Code', it.code);
    set('Variant / Color', it.variant);
    set('Qty', it.qty);
    set('Unit Price (Rs)', it.unit);
    set('Line Total (Rs)', it.line);
    set('Offer', first ? o.offer : '');
    set('Discount (Rs)', first ? o.discount : '');
    set('Normal Total (Rs)', first ? o.normalTotal : '');
    set('Delivery Fee (Rs)', first ? o.delivery : '');
    set('Final Total (Rs)', first ? o.finalTotal : '');
    set('Gift Wrap', first ? (prior.giftWrap || o.giftWrap || 'NO') : '');
    set('Wrapping Cost (Rs)', first ? (prior.wrappingCost !== '' ? prior.wrappingCost : o.wrappingCost) : '');
    set('Qty Offer Rules', first ? o.qtyOfferRules : '');
    set('Item Action', prior.items[itemKey] || 'KEEP ITEM');
    set('Order Action', first ? (prior.orderAction || 'PENDING') : '');
    set('Cancel Reason', first ? prior.cancelReason : '');
    set('Source', o.source);
    set('Order Time', first ? o.orderTime : '');
    set('Lead ID', first ? o.leadId : '');
    set('Imported Status', first ? o.importedStatus : '');
    set('Last Sync', now);
    set('Original Main Code', it.main || it.code);
    set('Original Variant / Color', it.variant);
    set('Original Item Code', it.code);
    set('Original Item Name', it.name);
    set('Original Qty', it.qty);
    rows.push(row);
  }
  if (!rows.length) return 0;
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, ORA_ORDER_HEADERS.length).setValues(rows);
  oraSetupValidations_(ss, sh, start, rows.length);
  if (rows.length > 1) {
    try { sh.getRange(start, 1, rows.length, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(1); } catch (e) {}
  }
  return rows.length;
}
function oraSyncOrders_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = oraTarget_(), orders = oraNormalizeOrders_(body), rows = 0;
    for (var i = 0; i < orders.length; i++) rows += oraWriteOrder_(ss, orders[i]);
    SpreadsheetApp.flush();
    return { ok: true, status: 'orders_synced', synced: orders.length, rows: rows, existing: 0, version: ORA_VERSION, spreadsheet_id: ss.getId(), spreadsheet_name: ss.getName() };
  } finally { lock.releaseLock(); }
}

function oraCatalogRows_(products) {
  var rows = [], now = new Date();
  products = Array.isArray(products) ? products : [];
  for (var i = 0; i < products.length; i++) {
    var p = products[i] || {};
    var main = oraStr_(p.sku || p.main_sku), name = oraStr_(p.name_en || p.name), type = oraStr_(p.product_type || 'normal');
    var image = Array.isArray(p.images) && p.images.length ? oraStr_(p.images[0]) : '';
    var variants = Array.isArray(p.variants) && p.variants.length ? p.variants : null;
    if (variants) {
      for (var v = 0; v < variants.length; v++) {
        var x = variants[v] || {}, code = oraStr_(x.sku || main), variant = oraStr_(x.option_value || x.variant_name);
        var price = oraRound_((x.discount_enabled !== false && oraNum_(x.discount_price) > 0) ? x.discount_price : x.selling_price);
        var img = oraStr_(x.image || image);
        rows.push([img ? '=IFERROR(IMAGE("' + img.replace(/"/g, '""') + '",4,60,60),"")' : '', main, code, name, variant, 'Variant', price, oraNum_(x.stock_quantity), oraStr_(x.status || p.status || 'Active'), img, code + ' | ' + name + (variant ? ' | ' + variant : ''), now]);
      }
    } else {
      var price2 = oraRound_((p.discount_enabled !== false && oraNum_(p.discount_price) > 0) ? p.discount_price : p.selling_price);
      rows.push([image ? '=IFERROR(IMAGE("' + image.replace(/"/g, '""') + '",4,60,60),"")' : '', main, main, name, '', type, price2, oraNum_(p.stock_quantity), oraStr_(p.status || 'Active'), image, main + ' | ' + name, now]);
    }
  }
  return rows;
}
function oraSyncCatalog_(body) {
  var ss = oraTarget_(), sh = oraEnsureCatalog_(ss), rows = oraCatalogRows_(body.products || []);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, ORA_CATALOG_HEADERS.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, ORA_CATALOG_HEADERS.length).setValues(rows);
  if (rows.length) sh.setRowHeights(2, rows.length, 65);
  SpreadsheetApp.flush();
  return { ok: true, status: 'catalog_synced', rows: rows.length, version: ORA_VERSION };
}
function oraDeleteOrderEverywhere_(orderId, moveToDeleted) {
  var ss = oraTarget_(), removed = 0;
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (sh) removed += oraDeleteOrderRows_(sh, orderId, moveToDeleted);
  }
  SpreadsheetApp.flush();
  return removed;
}
function oraClearByPredicate_(predicate) {
  var ss = oraTarget_(), removed = 0;
  for (var s = 0; s < ORA_ORDER_SHEETS.length; s++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[s]);
    if (!sh || sh.getLastRow() < 2) continue;
    var hm = oraHeaderMap_(sh), idCol = hm['Order ID'];
    if (!idCol) continue;
    var ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getDisplayValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (!predicate(oraStr_(ids[i][0]))) continue;
      sh.deleteRow(i + 2); removed++;
    }
  }
  SpreadsheetApp.flush();
  return removed;
}
function oraOrderExists_(orderId) {
  var ss = oraTarget_(), rows = 0, sheets = [];
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (!sh || sh.getLastRow() < 2) continue;
    var hm = oraHeaderMap_(sh), idCol = hm['Order ID'];
    if (!idCol) continue;
    var ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getDisplayValues();
    var count = 0;
    for (var r = 0; r < ids.length; r++) if (oraKey_(ids[r][0]) === oraKey_(orderId)) count++;
    if (count) { rows += count; sheets.push({ sheet: ORA_ORDER_SHEETS[i], rows: count }); }
  }
  return { ok: true, status: 'order_checked', order_id: orderId, found: rows > 0, rows: rows, sheets: sheets, spreadsheet_id: ss.getId(), spreadsheet_name: ss.getName(), version: ORA_VERSION };
}
function oraGetActions_(orderId) {
  var ss = oraTarget_(), result = [];
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (!sh || sh.getLastRow() < 2) continue;
    var hm = oraHeaderMap_(sh), vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
    for (var r = 0; r < vals.length; r++) {
      if (oraKey_(vals[r][hm['Order ID'] - 1]) !== oraKey_(orderId)) continue;
      result.push({
        sheet: ORA_ORDER_SHEETS[i], order_id: orderId,
        item_code: hm['Item Code'] ? vals[r][hm['Item Code'] - 1] : '',
        variant: hm['Variant / Color'] ? vals[r][hm['Variant / Color'] - 1] : '',
        item_action: hm['Item Action'] ? vals[r][hm['Item Action'] - 1] : '',
        order_action: hm['Order Action'] ? vals[r][hm['Order Action'] - 1] : '',
        cancel_reason: hm['Cancel Reason'] ? vals[r][hm['Cancel Reason'] - 1] : ''
      });
    }
  }
  return { ok: true, status: 'actions_read', order_id: orderId, rows: result };
}

function oraFindOrderFirstRow_(sh, orderId) {
  var hm = oraHeaderMap_(sh), idCol = hm['Order ID'];
  if (!idCol || sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (oraKey_(ids[i][0]) === oraKey_(orderId)) return i + 2;
  return 0;
}
function oraRecalcOrder_(sh, orderId) {
  if (sh.getLastRow() < 2) return;
  var hm = oraHeaderMap_(sh), idCol = hm['Order ID'];
  if (!idCol) return;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var normal = 0, totalQty = 0, firstRow = 0;
  for (var i = 0; i < vals.length; i++) {
    if (oraKey_(vals[i][idCol - 1]) !== oraKey_(orderId)) continue;
    if (!firstRow) firstRow = i + 2;
    var itemAction = hm['Item Action'] ? oraKey_(vals[i][hm['Item Action'] - 1]) : 'KEEP ITEM';
    if (itemAction === 'CANCEL ITEM') continue;
    normal += oraNum_(hm['Line Total (Rs)'] ? vals[i][hm['Line Total (Rs)'] - 1] : 0);
    totalQty += Math.max(1,Math.round(oraNum_(hm['Qty'] ? vals[i][hm['Qty'] - 1] : 1)));
  }
  if (!firstRow) return;
  var rules = { enabled:false, tiers:[] };
  if (hm['Qty Offer Rules']) {
    try { rules = JSON.parse(oraStr_(sh.getRange(firstRow, hm['Qty Offer Rules']).getValue()) || '{}'); } catch (ignore) {}
  }
  var rate = 0, tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  if (rules.enabled !== false && totalQty > 1) {
    for (var t = 0; t < tiers.length; t++) {
      var tier = tiers[t] || {}, min = Math.max(2,oraNum_(tier.min)), max = Math.max(min,oraNum_(tier.max));
      if (totalQty >= min && (tier.openEnded === true || totalQty <= max)) { rate = Math.max(0,Math.min(100,oraNum_(tier.rate))); break; }
    }
  }
  var discount = oraRound_(normal * rate / 100);
  var delivery = hm['Delivery Fee (Rs)'] ? oraNum_(sh.getRange(firstRow, hm['Delivery Fee (Rs)']).getValue()) : 0;
  var wrapChoice = hm['Gift Wrap'] ? sh.getRange(firstRow, hm['Gift Wrap']).getDisplayValue() : 'NO';
  var wrapCost = hm['Wrapping Cost (Rs)'] ? Math.max(0,oraNum_(sh.getRange(firstRow, hm['Wrapping Cost (Rs)']).getValue())) : 0;
  var wrapping = oraYes_(wrapChoice) ? wrapCost : 0;
  discount = Math.min(Math.max(0, discount), normal);
  var total = Math.max(0, oraRound_(normal - discount + delivery + wrapping));
  if (hm['Offer']) sh.getRange(firstRow, hm['Offer']).setValue(rate > 0 ? ('Qty Offer ' + rate + '% (' + totalQty + ' items)') : 'No Qty Offer');
  if (hm['Discount (Rs)']) sh.getRange(firstRow, hm['Discount (Rs)']).setValue(discount);
  if (hm['Normal Total (Rs)']) sh.getRange(firstRow, hm['Normal Total (Rs)']).setValue(oraRound_(normal));
  if (hm['Final Total (Rs)']) sh.getRange(firstRow, hm['Final Total (Rs)']).setValue(total);
}
function oraApplyItemChange_(ss, sh, row) {
  var hm = oraHeaderMap_(sh), choice = hm['Change Item To'] ? oraStr_(sh.getRange(row, hm['Change Item To']).getDisplayValue()) : '';
  if (!choice) return;
  var cat = ss.getSheetByName(ORA_CATALOG_TAB);
  if (!cat || cat.getLastRow() < 2) throw new Error('PRODUCT CATALOG is empty. Sync products first.');
  var vals = cat.getRange(2, 1, cat.getLastRow() - 1, ORA_CATALOG_HEADERS.length).getValues();
  var match = null;
  for (var i = 0; i < vals.length; i++) if (oraStr_(vals[i][10]) === choice) { match = vals[i]; break; }
  if (!match) throw new Error('Selected product was not found in PRODUCT CATALOG.');
  var qty = hm['Qty'] ? Math.max(1, Math.round(oraNum_(sh.getRange(row, hm['Qty']).getValue()))) : 1;
  var price = oraRound_(match[6]);
  if (hm['Main Code']) sh.getRange(row, hm['Main Code']).setValue(match[1]);
  if (hm['Item Code']) sh.getRange(row, hm['Item Code']).setValue(match[2]);
  if (hm['Item Name']) sh.getRange(row, hm['Item Name']).setValue(match[3]);
  if (hm['Variant / Color']) sh.getRange(row, hm['Variant / Color']).setValue(match[4]);
  if (hm['Unit Price (Rs)']) sh.getRange(row, hm['Unit Price (Rs)']).setValue(price);
  if (hm['Line Total (Rs)']) sh.getRange(row, hm['Line Total (Rs)']).setValue(oraRound_(qty * price));
  if (hm['Change Preview']) sh.getRange(row, hm['Change Preview']).setValue(match[2] + ' | ' + match[3] + (match[4] ? ' | ' + match[4] : '') + ' | Rs. ' + price);
  if (hm['Apply Item Change']) sh.getRange(row, hm['Apply Item Change']).setValue(false);
  var orderId = hm['Order ID'] ? sh.getRange(row, hm['Order ID']).getDisplayValue() : '';
  if (orderId) oraRecalcOrder_(sh, orderId);
}
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), name = sh.getName();
    if (ORA_ORDER_SHEETS.indexOf(name) < 0 || e.range.getRow() < 2) return;
    var hm = oraHeaderMap_(sh), col = e.range.getColumn(), row = e.range.getRow();
    var orderId = hm['Order ID'] ? sh.getRange(row, hm['Order ID']).getDisplayValue() : '';
    if (!orderId) return;
    if (hm['Order Action'] && col === hm['Order Action']) {
      var first = oraFindOrderFirstRow_(sh, orderId);
      if (first && first !== row) {
        sh.getRange(first, hm['Order Action']).setValue(e.value || 'PENDING');
        e.range.clearContent();
        row = first;
      }
      var action = oraKey_(sh.getRange(row, hm['Order Action']).getDisplayValue());
      if (hm['Imported Status']) {
        if (action === 'CONFIRM ORDER') sh.getRange(row, hm['Imported Status']).setValue('Confirmed');
        else if (action === 'CANCEL ENTIRE ORDER') sh.getRange(row, hm['Imported Status']).setValue('Cancelled');
        else sh.getRange(row, hm['Imported Status']).setValue('Pending');
      }
    }
    if (hm['Item Action'] && col === hm['Item Action']) oraRecalcOrder_(sh, orderId);
    if ((hm['Gift Wrap'] && col === hm['Gift Wrap']) || (hm['Wrapping Cost (Rs)'] && col === hm['Wrapping Cost (Rs)'])) oraRecalcOrder_(sh, orderId);
    if (hm['Qty'] && col === hm['Qty']) {
      var qty = Math.max(1, Math.round(oraNum_(e.range.getValue())));
      e.range.setValue(qty);
      if (hm['Unit Price (Rs)'] && hm['Line Total (Rs)']) {
        var unit = oraNum_(sh.getRange(row, hm['Unit Price (Rs)']).getValue());
        sh.getRange(row, hm['Line Total (Rs)']).setValue(oraRound_(qty * unit));
      }
      oraRecalcOrder_(sh, orderId);
    }
    if (hm['Apply Item Change'] && col === hm['Apply Item Change'] && e.value === 'TRUE') oraApplyItemChange_(sh.getParent(), sh, row);
  } catch (err) {
    try { e.range.setNote('O-RA Sheet error: ' + err.message); } catch (ignore) {}
  }
}

function doGet() {
  try {
    var ss = oraTarget_();
    return oraJson_({ ok: true, status: 'ok', version: ORA_VERSION, spreadsheet_id: ss.getId(), spreadsheet_name: ss.getName() });
  } catch (e) {
    return oraJson_({ ok: false, status: 'error', version: ORA_VERSION, message: e.message });
  }
}
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = oraStr_(body.action || body.payload_type).trim().toLowerCase();
    if (action === 'health') return doGet();
    if (action === 'sync_orders' || action === 'orders_sync' || action === 'order_sync') return oraJson_(oraSyncOrders_(body));
    if (action === 'catalog_sync' || action === 'sync_catalog') return oraJson_(oraSyncCatalog_(body));
    if (action === 'delete_order' || action === 'order_delete') {
      var orderId = oraStr_(body.orderId || body.order_id || body.order_number).trim();
      var removed = orderId ? oraDeleteOrderEverywhere_(orderId, true) : 0;
      return oraJson_({ ok: true, status: 'order_deleted', removed: removed, deleted: removed, order_id: orderId, version: ORA_VERSION });
    }
    if (action === 'clear_test_orders') {
      var removedTest = oraClearByPredicate_(function(id) { return /^(WEB-TEST-|TEST-FB-|TEST-TK-|ORA-DIAG-)/i.test(id); });
      return oraJson_({ ok: true, status: 'test_orders_cleared', removed: removedTest, version: ORA_VERSION });
    }
    if (action === 'clear_live_start_data' || action === 'clear_orders') {
      var removedAll = oraClearByPredicate_(function(id) { return !!oraStr_(id).trim(); });
      return oraJson_({ ok: true, status: 'orders_cleared', removed: removedAll, version: ORA_VERSION });
    }
    if (action === 'order_exists' || action === 'read_order') return oraJson_(oraOrderExists_(oraStr_(body.orderId || body.order_id || body.order_number)));
    if (action === 'get_actions') return oraJson_(oraGetActions_(oraStr_(body.orderId || body.order_id || body.order_number)));
    return oraJson_({ ok: false, status: 'error', version: ORA_VERSION, message: 'Unknown action: ' + action });
  } catch (err) {
    return oraJson_({ ok: false, status: 'error', version: ORA_VERSION, message: err && err.message ? err.message : String(err) });
  }
}
`;
