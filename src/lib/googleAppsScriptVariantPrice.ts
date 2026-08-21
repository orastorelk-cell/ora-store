export const GOOGLE_APPS_SCRIPT_VARIANT_PRICE = String.raw`
// ============================================================
// O-RA STORE - VARIANT / COLOR + IMMEDIATE PRICE PATCH
// Same-product variant dropdowns and immediate price/total updates.
// Loaded after Clean V1 + City + Call Center UX + Stable Rows + Full Reset.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Variant Price Live';

function oraVariantCatalogRows_(ss, mainCode) {
  var cat = ss.getSheetByName(ORA_CATALOG_TAB);
  if (!cat || cat.getLastRow() < 2) return [];
  var wanted = oraKey_(mainCode);
  if (!wanted) return [];
  var vals = cat.getRange(2, 1, cat.getLastRow() - 1, ORA_CATALOG_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var main = oraStr_(vals[i][1]).trim();
    if (oraKey_(main) !== wanted) continue;
    var variant = oraStr_(vals[i][4]).trim();
    if (!variant) continue;
    out.push({
      main: main,
      code: oraStr_(vals[i][2]).trim(),
      name: oraStr_(vals[i][3]).trim(),
      variant: variant,
      price: oraRound_(vals[i][6]),
      stock: oraNum_(vals[i][7]),
      status: oraStr_(vals[i][8]).trim(),
      choice: oraStr_(vals[i][10]).trim()
    });
  }
  return out;
}

function oraSetVariantDropdownForRow_(ss, sh, row) {
  if (!ss || !sh || row < 2) return;
  var hm = oraHeaderMap_(sh);
  if (!hm['Variant / Color']) return;
  var main = hm['Main Code'] ? oraStr_(sh.getRange(row, hm['Main Code']).getDisplayValue()).trim() : '';
  var cell = sh.getRange(row, hm['Variant / Color']);
  var variants = oraVariantCatalogRows_(ss, main);
  if (!variants.length) {
    try { cell.clearDataValidations(); } catch (e) {}
    return;
  }
  var labels = [], seen = {};
  for (var i = 0; i < variants.length; i++) {
    var label = variants[i].variant;
    var key = oraKey_(label);
    if (!label || seen[key]) continue;
    seen[key] = true;
    labels.push(label);
  }
  if (!labels.length) {
    try { cell.clearDataValidations(); } catch (e) {}
    return;
  }
  cell.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(labels, true)
      .setAllowInvalid(false)
      .setHelpText('Me item eke color / variant ekak thoranna. Price auto update wenawa.')
      .build()
  );
}

function oraApplyVariantChoice_(ss, sh, row) {
  var hm = oraHeaderMap_(sh);
  if (!hm['Variant / Color'] || !hm['Main Code']) return false;
  var main = oraStr_(sh.getRange(row, hm['Main Code']).getDisplayValue()).trim();
  var chosen = oraStr_(sh.getRange(row, hm['Variant / Color']).getDisplayValue()).trim();
  if (!main || !chosen) return false;
  var variants = oraVariantCatalogRows_(ss, main), match = null;
  for (var i = 0; i < variants.length; i++) {
    if (oraKey_(variants[i].variant) === oraKey_(chosen)) { match = variants[i]; break; }
  }
  if (!match) return false;

  var qty = hm['Qty'] ? Math.max(1, Math.round(oraNum_(sh.getRange(row, hm['Qty']).getValue()))) : 1;
  if (hm['Item Code']) sh.getRange(row, hm['Item Code']).setValue(match.code);
  if (hm['Item Name'] && match.name) sh.getRange(row, hm['Item Name']).setValue(match.name);
  if (hm['Unit Price (Rs)']) sh.getRange(row, hm['Unit Price (Rs)']).setValue(match.price);
  if (hm['Line Total (Rs)']) sh.getRange(row, hm['Line Total (Rs)']).setValue(oraRound_(qty * match.price));
  if (hm['Change Preview']) {
    sh.getRange(row, hm['Change Preview']).setValue(
      match.code + ' | ' + match.name + ' | ' + match.variant + ' | Rs. ' + match.price
    );
  }
  var orderId = hm['Order ID'] ? sh.getRange(row, hm['Order ID']).getDisplayValue() : '';
  if (orderId) oraRecalcOrder_(sh, orderId);
  return true;
}

// Existing validation setup still handles Item Action, Order Action, item-change
// dropdown and city. Add a row-specific same-Main-Code Variant / Color dropdown.
var oraSetupValidationsVariantBase_ = oraSetupValidations_;
oraSetupValidations_ = function(ss, sh, startRow, count) {
  oraSetupValidationsVariantBase_(ss, sh, startRow, count);
  for (var i = 0; i < count; i++) oraSetVariantDropdownForRow_(ss, sh, startRow + i);
};

// Existing item-change helper already reads the selected PRODUCT CATALOG row and
// writes Item Code / Item Name / Variant / Selling Price / Line Total, then
// recalculates the order. Wrap it so the new item's own variant dropdown is
// refreshed immediately after the item is changed.
var oraApplyItemChangeVariantBase_ = oraApplyItemChange_;
oraApplyItemChange_ = function(ss, sh, row) {
  oraApplyItemChangeVariantBase_(ss, sh, row);
  oraSetVariantDropdownForRow_(ss, sh, row);
};

// Make both edits immediate:
// 1) Variant / Color selection -> variant SKU + price + line total + order total.
// 2) Change Item To selection -> apply immediately; no second checkbox click needed.
var onEditVariantPriceBase_ = onEdit;
onEdit = function(e) {
  try {
    if (e && e.range) {
      var sh = e.range.getSheet();
      if (ORA_ORDER_SHEETS.indexOf(sh.getName()) >= 0 && e.range.getRow() >= 2) {
        var hm = oraHeaderMap_(sh), row = e.range.getRow(), col = e.range.getColumn();
        if (hm['Variant / Color'] && col === hm['Variant / Color']) {
          oraApplyVariantChoice_(sh.getParent(), sh, row);
          return;
        }
        if (hm['Change Item To'] && col === hm['Change Item To']) {
          if (oraStr_(e.value).trim()) oraApplyItemChange_(sh.getParent(), sh, row);
          return;
        }
      }
    }
  } catch (err) {
    try { e.range.setNote('O-RA variant/item change error: ' + err.message); } catch (ignore) {}
    return;
  }
  return onEditVariantPriceBase_(e);
};
`;
