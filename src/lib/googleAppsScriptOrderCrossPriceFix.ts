export const GOOGLE_APPS_SCRIPT_ORDER_CROSS_PRICE_FIX = String.raw`
// ============================================================
// O-RA STORE - ORDER CROSS PRICE + CALL CENTER MATH FIX
// Sheet display rule:
//   Unit Price / Line Total = crossed/reference price when active,
//   otherwise actual selling price.
//   Normal Total = reference totals.
//   Discount = Special Offer + Qty Offer.
//   Final Total = actual payable amount.
// Existing orders can be repaired safely with repairExistingOrderPricingOnly().
// No order rows are deleted/reordered and stock/status/waybill fields are untouched.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Order Cross Price V2';

function oraOrderPricingKey_(code, variant) {
  return oraKey_(oraStr_(code).trim() + '|' + oraStr_(variant).trim());
}

function oraCatalogOrderPricingMap_() {
  var out = {};
  var ss = oraTarget_();
  var sh = ss.getSheetByName(ORA_CATALOG_TAB);
  if (!sh || sh.getLastRow() < 2) return out;
  var hm = oraHeaderMap_(sh);
  var sellingCol = hm['Selling Price (Rs)'];
  var crossedCol = hm['Crossed Price (Rs)'];
  var mainCol = hm['Main Code'];
  var variantCodeCol = hm['Variant Code'];
  var variantNameCol = hm['Variant / Color'];
  if (!sellingCol || (!mainCol && !variantCodeCol)) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();

  function put(code, variant, actual, reference) {
    var c = oraStr_(code).trim();
    if (!c) return;
    var a = Math.max(0, oraNum_(actual));
    var r = Math.max(a, Math.max(0, oraNum_(reference)));
    var exact = oraOrderPricingKey_(c, variant);
    var plain = oraOrderPricingKey_(c, '');
    out[exact] = { actual:a, reference:r };
    if (!out[plain]) out[plain] = { actual:a, reference:r };
  }

  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var actual = oraNum_(row[sellingCol - 1]);
    var crossed = crossedCol ? oraNum_(row[crossedCol - 1]) : 0;
    var reference = crossed > actual ? crossed : actual;
    var variantName = variantNameCol ? row[variantNameCol - 1] : '';
    var variantCode = variantCodeCol ? row[variantCodeCol - 1] : '';
    var mainCode = mainCol ? row[mainCol - 1] : '';
    if (variantCode) put(variantCode, variantName, actual, reference);
    if (mainCode) put(mainCode, variantName, actual, reference);
  }
  return out;
}

function oraIncomingOrderPricingMap_(body) {
  var byOrder = {};
  var flat = oraFlattenIncoming_(body || {});
  for (var i = 0; i < flat.length; i++) {
    var src = flat[i] || {};
    var orderId = oraKey_(oraPick_(src, ['Order ID','order_number','orderId','order_id','orderNo']));
    if (!orderId) continue;
    if (!byOrder[orderId]) byOrder[orderId] = {};
    var list = Array.isArray(src.items) && src.items.length ? src.items : [src];
    for (var j = 0; j < list.length; j++) {
      var it = list[j] || {};
      var code = oraStr_(oraPick_(it, ['sku','item_code','Item Code','main_sku','Main Code']));
      var variant = oraStr_(oraPick_(it, ['variant_name','variant','Variant / Color']));
      var hasActual = it.unit_price !== undefined || it.unitPrice !== undefined || it.price !== undefined;
      var actual = hasActual ? oraNum_(oraPick_(it, ['unit_price','unitPrice','price'])) : 0;
      var hasRegular = it.regular_unit_price !== undefined || it.supplier_offer_discount_per_unit !== undefined;
      var regular = Math.max(
        actual,
        hasRegular ? oraNum_(it.regular_unit_price) : 0,
        hasRegular ? actual + Math.max(0, oraNum_(it.supplier_offer_discount_per_unit)) : 0
      );
      if (!code || (!hasActual && !hasRegular)) continue;
      byOrder[orderId][oraOrderPricingKey_(code, variant)] = {
        actual: actual,
        reference: regular,
        explicit_reference: hasRegular
      };
      byOrder[orderId][oraOrderPricingKey_(code, '')] = byOrder[orderId][oraOrderPricingKey_(code, variant)];
    }
  }
  return byOrder;
}

function oraReadPricingRules_(value) {
  var rules = {};
  try { rules = JSON.parse(oraStr_(value) || '{}'); } catch (ignore) { rules = {}; }
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) rules = {};
  if (!rules.actual_prices || typeof rules.actual_prices !== 'object') rules.actual_prices = {};
  if (!rules.reference_prices || typeof rules.reference_prices !== 'object') rules.reference_prices = {};
  return rules;
}

function oraQtyOfferRateFromRules_(rules, totalQty) {
  var rate = 0;
  var tiers = Array.isArray(rules && rules.tiers) ? rules.tiers : [];
  if (rules && rules.enabled !== false && totalQty > 1) {
    for (var t = 0; t < tiers.length; t++) {
      var tier = tiers[t] || {};
      var min = Math.max(2, oraNum_(tier.min));
      var max = Math.max(min, oraNum_(tier.max));
      if (totalQty >= min && (tier.openEnded === true || totalQty <= max)) {
        rate = Math.max(0, Math.min(100, oraNum_(tier.rate)));
        break;
      }
    }
  }
  return rate;
}

function oraOfferLabelFromParts_(specialDiscount, qtyDiscount, totalQty) {
  var parts = [];
  specialDiscount = Math.max(0, oraRound_(specialDiscount));
  qtyDiscount = Math.max(0, oraRound_(qtyDiscount));
  if (specialDiscount > 0) parts.push('Special Offer Rs. ' + specialDiscount);
  if (qtyDiscount > 0) parts.push('Qty Offer Rs. ' + qtyDiscount + ' (' + totalQty + ' items)');
  return parts.length ? parts.join(' + ') : 'No Offer';
}

var oraNormalizeOrdersCrossPriceBase_ = oraNormalizeOrders_;
oraNormalizeOrders_ = function(body) {
  var out = oraNormalizeOrdersCrossPriceBase_(body);
  var catalog = oraCatalogOrderPricingMap_();
  var incoming = oraIncomingOrderPricingMap_(body || {});

  for (var i = 0; i < out.length; i++) {
    var order = out[i] || {};
    var orderKey = oraKey_(order.id);
    var incomingMap = incoming[orderKey] || {};
    var rules = oraReadPricingRules_(order.qtyOfferRules);
    var actualPrices = rules.actual_prices;
    var referencePrices = rules.reference_prices;
    var actualProductsTotal = 0;
    var normalTotal = 0;
    var totalQty = 0;

    for (var j = 0; j < order.items.length; j++) {
      var item = order.items[j] || {};
      var key = oraOrderPricingKey_(item.code || item.main, item.variant);
      var plainKey = oraOrderPricingKey_(item.code || item.main, '');
      var snap = incomingMap[key] || incomingMap[plainKey];
      var cat = catalog[key] || catalog[plainKey] || catalog[oraOrderPricingKey_(item.main, item.variant)] || catalog[oraOrderPricingKey_(item.main, '')];
      var currentUnit = Math.max(0, oraNum_(item.unit));
      var actual = Math.max(0, oraNum_(actualPrices[key]));
      if (!(actual > 0)) actual = snap && snap.actual > 0 ? snap.actual : (cat && cat.actual > 0 ? cat.actual : currentUnit);

      var reference = Math.max(0, oraNum_(referencePrices[key]));
      if (!(reference > 0)) {
        if (snap && snap.explicit_reference && snap.reference > 0) reference = snap.reference;
        else if (cat && cat.reference > 0) reference = cat.reference;
        else if (snap && snap.reference > 0) reference = snap.reference;
        else reference = currentUnit;
      }
      reference = Math.max(actual, reference);

      actualPrices[key] = actual;
      referencePrices[key] = reference;
      if (plainKey !== key) {
        if (!actualPrices[plainKey]) actualPrices[plainKey] = actual;
        if (!referencePrices[plainKey]) referencePrices[plainKey] = reference;
      }

      var qty = Math.max(1, Math.round(oraNum_(item.qty || 1)));
      item.unit = oraRound_(reference);
      item.line = oraRound_(reference * qty);
      actualProductsTotal += actual * qty;
      normalTotal += reference * qty;
      totalQty += qty;
    }

    actualProductsTotal = oraRound_(actualProductsTotal);
    normalTotal = oraRound_(normalTotal);
    var delivery = Math.max(0, oraNum_(order.delivery));
    var wrapping = oraYes_(order.giftWrap) ? Math.max(0, oraNum_(order.wrappingCost)) : 0;
    var finalTotal = Math.max(0, oraNum_(order.finalTotal));
    var specialDiscount = Math.max(0, oraRound_(normalTotal - actualProductsTotal));
    var combinedDiscount = finalTotal > 0
      ? Math.max(0, oraRound_(normalTotal + delivery + wrapping - finalTotal))
      : Math.max(specialDiscount, Math.max(0, oraNum_(order.discount)));
    var qtyDiscount = Math.max(0, oraRound_(combinedDiscount - specialDiscount));

    order.normalTotal = normalTotal;
    order.discount = combinedDiscount;
    order.offer = oraOfferLabelFromParts_(specialDiscount, qtyDiscount, totalQty);
    rules.actual_prices = actualPrices;
    rules.reference_prices = referencePrices;
    order.qtyOfferRules = JSON.stringify(rules);
  }
  return out;
};

// Recalculate only pricing columns when Call Center edits Qty, Item Action,
// Gift Wrap, or applies an item change. Historical actual/reference prices are
// stored in the existing hidden Qty Offer Rules cell so later catalog changes do
// not rewrite the order's price snapshot.
oraRecalcOrder_ = function(sh, orderId) {
  if (!sh || sh.getLastRow() < 2) return;
  var hm = oraHeaderMap_(sh);
  var idCol = hm['Order ID'];
  if (!idCol) return;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    if (oraKey_(values[i][idCol - 1]) === oraKey_(orderId)) rows.push({ index:i + 2, values:values[i] });
  }
  if (!rows.length) return;

  var firstRow = rows[0].index;
  var rules = oraReadPricingRules_(hm['Qty Offer Rules'] ? sh.getRange(firstRow, hm['Qty Offer Rules']).getDisplayValue() : '');
  var actualPrices = rules.actual_prices;
  var referencePrices = rules.reference_prices;
  var catalog = oraCatalogOrderPricingMap_();
  var actualProductsTotal = 0;
  var normalTotal = 0;
  var totalQty = 0;

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var vals = row.values;
    var code = hm['Item Code'] ? vals[hm['Item Code'] - 1] : '';
    var main = hm['Main Code'] ? vals[hm['Main Code'] - 1] : code;
    var variant = hm['Variant / Color'] ? vals[hm['Variant / Color'] - 1] : '';
    var key = oraOrderPricingKey_(code || main, variant);
    var plainKey = oraOrderPricingKey_(code || main, '');
    var cat = catalog[key] || catalog[plainKey] || catalog[oraOrderPricingKey_(main, variant)] || catalog[oraOrderPricingKey_(main, '')];
    var currentUnit = hm['Unit Price (Rs)'] ? Math.max(0, oraNum_(vals[hm['Unit Price (Rs)'] - 1])) : 0;
    var actual = Math.max(0, oraNum_(actualPrices[key]));
    if (!(actual > 0)) actual = cat && cat.actual > 0 ? cat.actual : currentUnit;
    var reference = Math.max(0, oraNum_(referencePrices[key]));
    if (!(reference > 0)) reference = cat && cat.reference > 0 ? cat.reference : currentUnit;
    reference = Math.max(actual, reference);
    actualPrices[key] = actual;
    referencePrices[key] = reference;
    if (plainKey !== key) {
      if (!actualPrices[plainKey]) actualPrices[plainKey] = actual;
      if (!referencePrices[plainKey]) referencePrices[plainKey] = reference;
    }

    var qty = Math.max(1, Math.round(oraNum_(hm['Qty'] ? vals[hm['Qty'] - 1] : 1)));
    if (hm['Unit Price (Rs)']) sh.getRange(row.index, hm['Unit Price (Rs)']).setValue(oraRound_(reference));
    if (hm['Line Total (Rs)']) sh.getRange(row.index, hm['Line Total (Rs)']).setValue(oraRound_(reference * qty));

    var itemAction = hm['Item Action'] ? oraKey_(vals[hm['Item Action'] - 1]) : 'KEEP ITEM';
    if (itemAction === 'CANCEL ITEM') continue;
    actualProductsTotal += actual * qty;
    normalTotal += reference * qty;
    totalQty += qty;
  }

  actualProductsTotal = oraRound_(actualProductsTotal);
  normalTotal = oraRound_(normalTotal);
  var rate = oraQtyOfferRateFromRules_(rules, totalQty);
  var qtyDiscount = Math.min(actualProductsTotal, Math.max(0, oraRound_(actualProductsTotal * rate / 100)));
  var specialDiscount = Math.max(0, oraRound_(normalTotal - actualProductsTotal));
  var combinedDiscount = oraRound_(specialDiscount + qtyDiscount);
  var delivery = hm['Delivery Fee (Rs)'] ? Math.max(0, oraNum_(sh.getRange(firstRow, hm['Delivery Fee (Rs)']).getDisplayValue())) : 0;
  var giftWrap = hm['Gift Wrap'] ? sh.getRange(firstRow, hm['Gift Wrap']).getDisplayValue() : 'NO';
  var wrapCost = hm['Wrapping Cost (Rs)'] ? Math.max(0, oraNum_(sh.getRange(firstRow, hm['Wrapping Cost (Rs)']).getDisplayValue())) : 0;
  var wrapping = oraYes_(giftWrap) ? wrapCost : 0;
  var finalTotal = Math.max(0, oraRound_(normalTotal - combinedDiscount + delivery + wrapping));

  if (hm['Offer']) sh.getRange(firstRow, hm['Offer']).setValue(oraOfferLabelFromParts_(specialDiscount, qtyDiscount, totalQty));
  if (hm['Discount (Rs)']) sh.getRange(firstRow, hm['Discount (Rs)']).setValue(combinedDiscount);
  if (hm['Normal Total (Rs)']) sh.getRange(firstRow, hm['Normal Total (Rs)']).setValue(normalTotal);
  if (hm['Final Total (Rs)']) sh.getRange(firstRow, hm['Final Total (Rs)']).setValue(finalTotal);
  rules.actual_prices = actualPrices;
  rules.reference_prices = referencePrices;
  if (hm['Qty Offer Rules']) sh.getRange(firstRow, hm['Qty Offer Rules']).setValue(JSON.stringify(rules));
  try { if (typeof oraApplyMoneyFormat_ === 'function') oraApplyMoneyFormat_(sh, firstRow, rows.length); } catch (ignore) {}
}

function oraRepairExistingSheetPricing_(sh) {
  if (!sh || sh.getLastRow() < 2) return { orders:0, rows:0 };
  var hm = oraHeaderMap_(sh);
  if (!hm['Order ID'] || !hm['Unit Price (Rs)'] || !hm['Line Total (Rs)']) return { orders:0, rows:0 };
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  var groups = {};
  var orderIds = [];
  for (var i = 0; i < values.length; i++) {
    var id = oraStr_(values[i][hm['Order ID'] - 1]).trim();
    if (!id) continue;
    var key = oraKey_(id);
    if (!groups[key]) { groups[key] = []; orderIds.push(id); }
    groups[key].push({ index:i + 2, values:values[i] });
  }

  var catalog = oraCatalogOrderPricingMap_();
  var repairedRows = 0;
  for (var o = 0; o < orderIds.length; o++) {
    var orderId = orderIds[o];
    var rows = groups[oraKey_(orderId)] || [];
    if (!rows.length) continue;
    var firstRow = rows[0].index;
    var rules = oraReadPricingRules_(hm['Qty Offer Rules'] ? sh.getRange(firstRow, hm['Qty Offer Rules']).getDisplayValue() : '');
    var actualPrices = rules.actual_prices;
    var referencePrices = rules.reference_prices;

    // Capture the CURRENT pre-repair Unit Price as the historical actual selling
    // price only when this order has never been price-snapshotted before.
    for (var r = 0; r < rows.length; r++) {
      var vals = rows[r].values;
      var code = hm['Item Code'] ? vals[hm['Item Code'] - 1] : '';
      var main = hm['Main Code'] ? vals[hm['Main Code'] - 1] : code;
      var variant = hm['Variant / Color'] ? vals[hm['Variant / Color'] - 1] : '';
      var key = oraOrderPricingKey_(code || main, variant);
      var plainKey = oraOrderPricingKey_(code || main, '');
      var currentUnit = Math.max(0, oraNum_(vals[hm['Unit Price (Rs)'] - 1]));
      var cat = catalog[key] || catalog[plainKey] || catalog[oraOrderPricingKey_(main, variant)] || catalog[oraOrderPricingKey_(main, '')];
      if (!(oraNum_(actualPrices[key]) > 0)) actualPrices[key] = currentUnit > 0 ? currentUnit : (cat ? cat.actual : 0);
      if (!(oraNum_(referencePrices[key]) > 0)) referencePrices[key] = cat && cat.reference > 0 ? Math.max(actualPrices[key], cat.reference) : actualPrices[key];
      if (plainKey !== key) {
        if (!actualPrices[plainKey]) actualPrices[plainKey] = actualPrices[key];
        if (!referencePrices[plainKey]) referencePrices[plainKey] = referencePrices[key];
      }
    }

    rules.actual_prices = actualPrices;
    rules.reference_prices = referencePrices;
    if (hm['Qty Offer Rules']) sh.getRange(firstRow, hm['Qty Offer Rules']).setValue(JSON.stringify(rules));
    oraRecalcOrder_(sh, orderId);
    repairedRows += rows.length;
  }
  return { orders:orderIds.length, rows:repairedRows };
}

function repairExistingOrderPricingOnly() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = oraTarget_();
    var names = ORA_ORDER_SHEETS.slice();
    if (ss.getSheetByName('WEBSITE ORDERS') && names.indexOf('WEBSITE ORDERS') < 0) names.push('WEBSITE ORDERS');
    var totalOrders = 0;
    var totalRows = 0;
    var sheets = [];
    for (var i = 0; i < names.length; i++) {
      var sh = ss.getSheetByName(names[i]);
      if (!sh) continue;
      var result = oraRepairExistingSheetPricing_(sh);
      totalOrders += result.orders;
      totalRows += result.rows;
      sheets.push({ sheet:names[i], orders:result.orders, rows:result.rows });
    }
    SpreadsheetApp.flush();
    return { ok:true, status:'sheet_pricing_repaired', orders:totalOrders, rows:totalRows, sheets:sheets, version:ORA_VERSION };
  } finally {
    lock.releaseLock();
  }
}

var doPostOrderCrossPriceBase_ = doPost;
doPost = function(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = oraStr_(body.action || body.payload_type).trim().toLowerCase();
    if (action === 'repair_sheet_pricing' || action === 'repair_existing_order_pricing') {
      return oraJson_(repairExistingOrderPricingOnly());
    }
  } catch (ignore) {}
  return doPostOrderCrossPriceBase_(e);
};
`;
