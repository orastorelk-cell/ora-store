export const GOOGLE_APPS_SCRIPT_BULK_FAST = String.raw`
// ============================================================
// O-RA STORE - FAST + SAFE BULK LEAD SYNC
// FB/TikTok CSV imports can contain today + previous-day leads.
// Existing Lead IDs are checked ONCE, duplicates are skipped, and every fresh
// order is appended in one block per source instead of one expensive Sheet write
// per order. Existing/resync orders still use the stable writer.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Fast Lead-ID Bulk Sync';

var oraSyncOrdersFastLeadBase_ = oraSyncOrders_;

function oraBulkExistingLeadState_(sh) {
  var out = { orders:{}, leads:{} };
  if (!sh || sh.getLastRow() < 2) return out;
  var hm = oraHeaderMap_(sh);
  var idCol = hm['Order ID'], leadCol = hm['Lead ID'];
  if (!idCol && !leadCol) return out;

  // One Sheet read only. Store row counts too, so idempotent bulk retries can
  // report the already-physical rows without rewriting them.
  var width = Math.max(idCol || 1, leadCol || 1);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, width).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    var id = idCol ? oraKey_(vals[i][idCol - 1]) : '';
    var lead = leadCol ? oraKey_(vals[i][leadCol - 1]) : '';
    if (id) out.orders[id] = Number(out.orders[id] || 0) + 1;
    if (lead) out.leads[lead] = id || true;
  }
  return out;
}

function oraBulkCatalogVariantMap_(ss) {
  var map = {};
  var cat = ss.getSheetByName(ORA_CATALOG_TAB);
  if (!cat || cat.getLastRow() < 2) return map;
  var vals = cat.getRange(2, 1, cat.getLastRow() - 1, ORA_CATALOG_HEADERS.length).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    var main = oraKey_(vals[i][1]);
    var variant = oraStr_(vals[i][4]).trim();
    if (!main || !variant) continue;
    if (!map[main]) map[main] = [];
    var exists = false;
    for (var j = 0; j < map[main].length; j++) {
      if (oraKey_(map[main][j]) === oraKey_(variant)) { exists = true; break; }
    }
    if (!exists) map[main].push(variant);
  }
  return map;
}

function oraBulkSetupFreshRows_(ss, sh, startRow, rowCount, blocks) {
  if (!rowCount) return;
  var hm = oraHeaderMap_(sh);

  // Common dropdowns are installed range-at-once. This avoids running the full
  // validation wrapper chain once for every lead.
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
    sh.getRange(startRow, hm['Change Item To'], rowCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInRange(cat.getRange(2, 11, cat.getLastRow() - 1, 1), true)
        .setAllowInvalid(true)
        .build()
    );
  }

  if (hm['City']) {
    var city = null;
    try { city = typeof oraExactCitySheet_ === 'function' ? oraExactCitySheet_(ss) : ss.getSheetByName(ORA_CITY_TAB); } catch (e) { city = ss.getSheetByName(ORA_CITY_TAB); }
    if (city && city.getLastRow() > 1) {
      var cityCol = city.getLastColumn() >= 3 ? 3 : 1;
      sh.getRange(startRow, hm['City'], rowCount, 1).setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInRange(city.getRange(2, cityCol, city.getLastRow() - 1, 1), true)
          .setAllowInvalid(true)
          .build()
      );
    }
  }

  // Variant choices need a per-main-code rule, but the PRODUCT CATALOG itself is
  // read only once for the whole CSV import.
  if (hm['Variant / Color'] && hm['Main Code']) {
    var variantMap = oraBulkCatalogVariantMap_(ss);
    var mains = sh.getRange(startRow, hm['Main Code'], rowCount, 1).getDisplayValues();
    var ruleCache = {};
    for (var r = 0; r < mains.length; r++) {
      var mainKey = oraKey_(mains[r][0]);
      var options = variantMap[mainKey] || [];
      var cell = sh.getRange(startRow + r, hm['Variant / Color']);
      if (!options.length) {
        try { cell.clearDataValidations(); } catch (e) {}
        continue;
      }
      if (!ruleCache[mainKey]) {
        ruleCache[mainKey] = SpreadsheetApp.newDataValidation()
          .requireValueInList(options, true)
          .setAllowInvalid(false)
          .setHelpText('Me item eke color / variant ekak thoranna. Price auto update wenawa.')
          .build();
      }
      cell.setDataValidation(ruleCache[mainKey]);
    }
  }

  // New lead rows always start KEEP ITEM / PENDING, so paint them by whole
  // ranges instead of two individual formatting calls per row.
  try {
    if (hm['Item Action']) sh.getRange(startRow, hm['Item Action'], rowCount, 1)
      .setFontWeight('bold').setFontColor('#137333').setHorizontalAlignment('center').setVerticalAlignment('middle');
    if (hm['Order Action']) sh.getRange(startRow, hm['Order Action'], rowCount, 1)
      .setFontWeight('bold').setFontColor('#B06000').setHorizontalAlignment('center').setVerticalAlignment('middle');
  } catch (e) {}

  try {
    sh.getRange(startRow, 1, rowCount, ORA_ORDER_HEADERS.length)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
      .setVerticalAlignment('middle');
    sh.setRowHeightsForced(startRow, rowCount, 34);
  } catch (e) {}
  try { if (typeof oraApplyMoneyFormat_ === 'function') oraApplyMoneyFormat_(sh, startRow, rowCount); } catch (e) {}

  // Preserve the existing visual separation/grouping, but do it only after the
  // complete block is written. No whole-Sheet scan/resize is run per order.
  for (var b = 0; b < blocks.length; b++) {
    var blockStart = startRow + blocks[b].offset;
    var count = blocks[b].count;
    try { sh.getRange(blockStart, 1, count, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(1); } catch (e) {}
    try { if (typeof oraStyleOrderBlock_ === 'function') oraStyleOrderBlock_(sh, blockStart, count); } catch (e) {}
  }
}

function oraBulkAppendFreshOrders_(ss, sh, orders) {
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
  sh.getRange(start, 1, allRows.length, ORA_ORDER_HEADERS.length).setValues(allRows);
  oraBulkSetupFreshRows_(ss, sh, start, allRows.length, blocks);
  return { rows:allRows.length, orders:blocks.length };
}

// Multi-order CSV import path:
// 1) normalize the whole CSV payload once
// 2) read existing Order IDs + Lead IDs once per source Sheet
// 3) skip duplicate Lead IDs / idempotent already-existing orders
// 4) append every genuinely fresh order in ONE setValues() block per source
// Existing/resync orders are rare and keep the exact stable writer semantics.
oraSyncOrders_ = function(body) {
  var orders = oraNormalizeOrders_(body);
  if (orders.length <= 1) return oraSyncOrdersFastLeadBase_(body);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = oraTarget_();
    var bySheet = {};
    for (var i = 0; i < orders.length; i++) {
      var sheetName = oraSheetName_(orders[i].source);
      if (!bySheet[sheetName]) bySheet[sheetName] = [];
      bySheet[sheetName].push(orders[i]);
    }

    var totalRows = 0;
    var totalSynced = 0;
    var totalExisting = 0;
    var duplicateLeads = 0;

    for (var name in bySheet) {
      var sh = oraEnsureOrderSheet_(ss, name);
      var state = oraBulkExistingLeadState_(sh);
      var fresh = [];
      var updates = [];
      var seenBatchLeads = {};
      var sourceOrders = bySheet[name];

      for (var j = 0; j < sourceOrders.length; j++) {
        var o = sourceOrders[j];
        var idKey = oraKey_(o.id);
        var leadKey = oraKey_(o.leadId);

        // Primary duplicate rule requested for FB/TikTok: platform Lead ID.
        // This handles CSV files containing both today and yesterday.
        if (leadKey && (state.leads[leadKey] || seenBatchLeads[leadKey])) {
          duplicateLeads++;
          totalExisting++;
          totalSynced++;
          // If this exact Order ID already exists physically, include its row
          // count in the idempotent response used by the Worker verifier.
          totalRows += Number(state.orders[idKey] || Math.max(1, (o.items || []).length));
          continue;
        }
        if (leadKey) seenBatchLeads[leadKey] = true;

        if (idKey && state.orders[idKey]) {
          // Rare explicit resync/update: preserve actions/location via stable writer.
          updates.push(o);
          continue;
        }
        fresh.push(o);
      }

      var appended = oraBulkAppendFreshOrders_(ss, sh, fresh);
      totalRows += appended.rows;
      totalSynced += appended.orders;

      for (var u = 0; u < updates.length; u++) {
        totalRows += Number(oraWriteOrder_(ss, updates[u]) || 0);
        totalSynced++;
        totalExisting++;
      }
    }

    SpreadsheetApp.flush();
    return {
      ok:true,
      status:'orders_synced',
      synced:totalSynced,
      rows:totalRows,
      existing:totalExisting,
      duplicate_leads:duplicateLeads,
      bulk_fast:true,
      lead_id_dedupe:true,
      version:ORA_VERSION,
      spreadsheet_id:ss.getId(),
      spreadsheet_name:ss.getName()
    };
  } finally {
    lock.releaseLock();
  }
};
`;
