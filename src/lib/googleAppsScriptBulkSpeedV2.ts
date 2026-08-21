export const GOOGLE_APPS_SCRIPT_BULK_SPEED_V2 = String.raw`
// ============================================================
// O-RA STORE - BULK LEAD SPEED V2
// Values are written in one block and FLUSHED immediately so FB/TikTok leads
// become visible in Google Sheets before non-critical validation/format work.
// Single-item lead rows avoid per-order grouping/style calls entirely.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Bulk Lead Speed V2';

oraBulkSetupFreshRows_ = function(ss, sh, startRow, rowCount, blocks) {
  if (!rowCount) return;
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
    sh.getRange(startRow, hm['Change Item To'], rowCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInRange(cat.getRange(2, 11, cat.getLastRow() - 1, 1), true)
        .setAllowInvalid(true)
        .build()
    );
  }

  if (hm['City']) {
    var city = null;
    try { city = typeof oraExactCitySheet_ === 'function' ? oraExactCitySheet_(ss) : ss.getSheetByName(ORA_CITY_TAB); }
    catch (e) { city = ss.getSheetByName(ORA_CITY_TAB); }
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

  // CSV imports normally use one selected Item Code for all rows. Apply one
  // validation per contiguous Main Code run instead of one validation call per row.
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

  // Most FB/TikTok leads are one row. Styling/grouping every single row is very
  // expensive and does not add useful grouping. Preserve it only for true
  // multi-item orders where visual grouping matters.
  for (var b = 0; b < blocks.length; b++) {
    var count = blocks[b].count;
    if (count <= 1) continue;
    var blockStart = startRow + blocks[b].offset;
    try { sh.getRange(blockStart, 1, count, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(1); } catch (e) {}
    try { if (typeof oraStyleOrderBlock_ === 'function') oraStyleOrderBlock_(sh, blockStart, count); } catch (e) {}
  }
};

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
  sh.getRange(start, 1, allRows.length, ORA_ORDER_HEADERS.length).setValues(allRows);

  // Critical speed point: make all new order values physically visible now.
  SpreadsheetApp.flush();

  // Non-critical UI rules are range-based and run after the physical write.
  oraBulkSetupFreshRows_(ss, sh, start, allRows.length, blocks);
  return { rows:allRows.length, orders:blocks.length };
};
`;
