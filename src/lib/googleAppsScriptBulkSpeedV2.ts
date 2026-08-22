export const GOOGLE_APPS_SCRIPT_BULK_SPEED_V2 = String.raw`
// ============================================================
// O-RA STORE - BULK LEAD SPEED V3.2
// FB/TikTok: narrow duplicate scan + one block write + immediate flush.
// No row grouping/borders for lead tabs, including fallback repair writes.
// Website/CALL CENTER keeps the existing grouping/border behaviour.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Bulk Lead Speed V3.2';

function oraIsWebsiteOrderSheet_(sh) {
  return !!sh && sh.getName() === 'CALL CENTER ORDERS';
}

// The older fast layer read every column from Order ID through Lead ID for every
// existing row. On large FB/TikTok tabs that becomes expensive. Read only the two
// columns actually needed for idempotency and Lead-ID duplicate protection.
oraBulkExistingLeadState_ = function(sh) {
  var out = { orders:{}, leads:{} };
  if (!sh || sh.getLastRow() < 2) return out;
  var hm = oraHeaderMap_(sh);
  var idCol = hm['Order ID'], leadCol = hm['Lead ID'];
  if (!idCol && !leadCol) return out;

  var rowCount = sh.getLastRow() - 1;
  var ids = idCol ? sh.getRange(2, idCol, rowCount, 1).getDisplayValues() : [];
  var leads = leadCol ? sh.getRange(2, leadCol, rowCount, 1).getDisplayValues() : [];
  for (var i = 0; i < rowCount; i++) {
    var id = idCol ? oraKey_(ids[i][0]) : '';
    var lead = leadCol ? oraKey_(leads[i][0]) : '';
    if (id) out.orders[id] = Number(out.orders[id] || 0) + 1;
    if (lead) out.leads[lead] = id || true;
  }
  return out;
};

var oraBulkSetupFreshRowsWebsiteBase_ = oraBulkSetupFreshRows_;
oraBulkSetupFreshRows_ = function(ss, sh, startRow, rowCount, blocks) {
  if (!rowCount) return;

  // Website/CALL CENTER keeps the complete existing visual/validation behaviour,
  // including grouping and order borders for multi-item order management.
  if (oraIsWebsiteOrderSheet_(sh)) {
    return oraBulkSetupFreshRowsWebsiteBase_(ss, sh, startRow, rowCount, blocks);
  }

  // FB/TikTok leads are single-row operational records. Install only the useful
  // editing rules after the already-flushed value write. No grouping, no borders,
  // no per-order styling and no whole-sheet view formatting.
  var hm = oraHeaderMap_(sh);

  if (hm['Item Action']) {
    sh.getRange(startRow, hm['Item Action'], rowCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(['KEEP ITEM','CANCEL ITEM'], true)
        .setAllowInvalid(false)
        .setHelpText('KEEP ITEM = keep this item. CANCEL ITEM = cancel only this item.')
        .build()
    );
  }
  if (hm['Order Action']) {
    sh.getRange(startRow, hm['Order Action'], rowCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(['PENDING','CONFIRM ORDER','CANCEL ENTIRE ORDER'], true)
        .setAllowInvalid(false)
        .setHelpText('PENDING / CONFIRM ORDER / CANCEL ENTIRE ORDER')
        .build()
    );
  }
  if (hm['Apply Item Change']) {
    try { sh.getRange(startRow, hm['Apply Item Change'], rowCount, 1).insertCheckboxes(); } catch (e) {}
  }

  var cat = ss.getSheetByName(ORA_CATALOG_TAB);
  if (cat && cat.getLastRow() > 1 && hm['Change Item To']) {
    try {
      sh.getRange(startRow, hm['Change Item To'], rowCount, 1).setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInRange(cat.getRange(2, 11, cat.getLastRow() - 1, 1), true)
          .setAllowInvalid(true)
          .build()
      );
    } catch (e) {}
  }

  if (hm['City']) {
    var city = null;
    try { city = typeof oraExactCitySheet_ === 'function' ? oraExactCitySheet_(ss) : ss.getSheetByName(ORA_CITY_TAB); }
    catch (e) { city = ss.getSheetByName(ORA_CITY_TAB); }
    if (city && city.getLastRow() > 1) {
      var cityCol = city.getLastColumn() >= 3 ? 3 : 1;
      try {
        sh.getRange(startRow, hm['City'], rowCount, 1).setDataValidation(
          SpreadsheetApp.newDataValidation()
            .requireValueInRange(city.getRange(2, cityCol, city.getLastRow() - 1, 1), true)
            .setAllowInvalid(true)
            .build()
        );
      } catch (e) {}
    }
  }

  // Variant rules remain available, but are applied per contiguous Main Code run
  // instead of one Spreadsheet service call for every lead row.
  if (hm['Variant / Color'] && hm['Main Code']) {
    var variantMap = oraBulkCatalogVariantMap_(ss);
    var mains = sh.getRange(startRow, hm['Main Code'], rowCount, 1).getDisplayValues();
    var ruleCache = {};
    var runStart = 0;
    while (runStart < mains.length) {
      var mainKey = oraKey_(mains[runStart][0]);
      var runEnd = runStart + 1;
      while (runEnd < mains.length && oraKey_(mains[runEnd][0]) === mainKey) runEnd++;
      var runCount = runEnd - runStart;
      var target = sh.getRange(startRow + runStart, hm['Variant / Color'], runCount, 1);
      var options = variantMap[mainKey] || [];
      try {
        if (!options.length) {
          target.clearDataValidations();
        } else {
          if (!ruleCache[mainKey]) {
            ruleCache[mainKey] = SpreadsheetApp.newDataValidation()
              .requireValueInList(options, true)
              .setAllowInvalid(false)
              .setHelpText('Me item eke color / variant ekak thoranna. Price auto update wenawa.')
              .build();
          }
          target.setDataValidation(ruleCache[mainKey]);
        }
      } catch (e) {}
      runStart = runEnd;
    }
  }

  // Keep the currency display that Call Center expects, but avoid row/group style.
  try { if (typeof oraApplyMoneyFormat_ === 'function') oraApplyMoneyFormat_(sh, startRow, rowCount); } catch (e) {}
};

// Google Sheets can automatically extend an existing row group/border when rows
// are appended directly under it. Lead tabs must always remain flat. One range
// operation removes any inherited/stale row grouping and custom borders. Website
// orders are explicitly excluded.
function oraFlattenLeadSheet_(sh) {
  if (!sh || oraIsWebsiteOrderSheet_(sh) || sh.getLastRow() < 2) return;
  var count = sh.getLastRow() - 1;
  var range = sh.getRange(2, 1, count, ORA_ORDER_HEADERS.length);
  try { range.shiftRowGroupDepth(-8); } catch (e) {}
  try { range.setBorder(false, false, false, false, false, false); } catch (e) {}
}

oraBulkAppendFreshOrders_ = function(ss, sh, orders) {
  if (!orders || !orders.length) return { rows:0, orders:0 };
  var allRows = [], blocks = [];
  var emptyPrior = { orderAction:'PENDING', cancelReason:'', items:{} };
  var emptyLocation = { exists:false, city:'', district:'' };

  for (var i = 0; i < orders.length; i++) {
    var values = oraBuildStableOrderValues_(sh, orders[i], emptyPrior, emptyLocation);
    if (!values.length) continue;
    blocks.push({ offset:allRows.length, count:values.length });
    for (var r = 0; r < values.length; r++) allRows.push(values[r]);
  }
  if (!allRows.length) return { rows:0, orders:0 };

  var start = sh.getLastRow() + 1;

  // All fresh FB/TikTok orders in this source tab are physically written in ONE
  // setValues call. Flush immediately so they appear together, not one by one.
  sh.getRange(start, 1, allRows.length, ORA_ORDER_HEADERS.length).setValues(allRows);
  SpreadsheetApp.flush();

  // Flatten lead tabs after values are already visible. This also removes an old
  // inherited group like the first-row group seen in the live FB test.
  if (!oraIsWebsiteOrderSheet_(sh)) oraFlattenLeadSheet_(sh);

  // Editing rules are secondary and run only after the complete batch is visible.
  oraBulkSetupFreshRows_(ss, sh, start, allRows.length, blocks);
  return { rows:allRows.length, orders:blocks.length };
};

// Borders are a Website/CALL CENTER concept only. Prevent any later stable writer
// or fallback layer from painting FB/TikTok lead rows.
if (typeof oraStyleOrderBlock_ === 'function') {
  var oraStyleOrderBlockSpeedV3Base_ = oraStyleOrderBlock_;
  oraStyleOrderBlock_ = function(sh, startRow, count) {
    if (!oraIsWebsiteOrderSheet_(sh)) return;
    return oraStyleOrderBlockSpeedV3Base_(sh, startRow, count);
  };
}

// The safety/repair path can re-sync one lead at a time through the stable writer.
// That older writer creates a row group before it returns. Flatten the lead tab
// immediately afterwards; Website orders continue through the untouched writer.
if (typeof oraWriteOrder_ === 'function') {
  var oraWriteOrderSpeedV32Base_ = oraWriteOrder_;
  oraWriteOrder_ = function(ss, o) {
    var written = oraWriteOrderSpeedV32Base_(ss, o);
    if (written > 0) {
      var sh = oraEnsureOrderSheet_(ss, oraSheetName_(o.source));
      if (!oraIsWebsiteOrderSheet_(sh)) oraFlattenLeadSheet_(sh);
    }
    return written;
  };
}

// Regroup existing orders only on the Website/CALL CENTER tab. If this helper is
// invoked for a lead tab during cleanup/setup, remove row-group depth and leave it
// as a flat single-row list.
if (typeof oraRegroupExistingOrders_ === 'function') {
  var oraRegroupExistingOrdersSpeedV3Base_ = oraRegroupExistingOrders_;
  oraRegroupExistingOrders_ = function(sh) {
    if (oraIsWebsiteOrderSheet_(sh)) return oraRegroupExistingOrdersSpeedV3Base_(sh);
    oraFlattenLeadSheet_(sh);
  };
}
`;
