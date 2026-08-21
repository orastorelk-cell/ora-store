export const GOOGLE_APPS_SCRIPT_BULK_FAST = String.raw`
// ============================================================
// O-RA STORE - FAST BULK LEAD APPEND
// FB/TikTok CSV imports can contain many independent orders. The normal
// stable-row writer is deliberately thorough for updates, but scanning the
// whole Sheet several times for every brand-new lead makes a large import
// unnecessarily expensive. New orders are appended in one block per source;
// existing orders still use the normal update-safe writer.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Fast Bulk Leads';

var oraSyncOrdersBulkFastBase_ = oraSyncOrders_;

function oraExistingOrderKeys_(sh) {
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var hm = oraHeaderMap_(sh), idCol = hm['Order ID'];
  if (!idCol) return out;
  var ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    var key = oraKey_(ids[i][0]);
    if (key) out[key] = true;
  }
  return out;
}

function oraAppendNewOrdersFast_(ss, sh, orders) {
  if (!orders || !orders.length) return 0;
  var allRows = [], blocks = [];
  var emptyPrior = { orderAction:'PENDING', cancelReason:'', items:{} };
  var emptyLocation = { exists:false, city:'', district:'' };

  for (var i = 0; i < orders.length; i++) {
    var values = oraBuildStableOrderValues_(sh, orders[i], emptyPrior, emptyLocation);
    if (!values.length) continue;
    blocks.push({ offset:allRows.length, count:values.length });
    for (var r = 0; r < values.length; r++) allRows.push(values[r]);
  }
  if (!allRows.length) return 0;

  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, allRows.length, ORA_ORDER_HEADERS.length).setValues(allRows);

  // Apply final validation/chip/city logic once for the entire imported block.
  oraSetupValidations_(ss, sh, start, allRows.length);
  try {
    sh.getRange(start, 1, allRows.length, ORA_ORDER_HEADERS.length)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
      .setVerticalAlignment('middle');
    sh.setRowHeightsForced(start, allRows.length, 34);
  } catch (e) {}
  try { if (typeof oraApplyMoneyFormat_ === 'function') oraApplyMoneyFormat_(sh, start, allRows.length); } catch (e) {}

  // Preserve the existing visual rule: every order, including single-item
  // orders, is its own group and keeps the normal Call Center block styling.
  for (var b = 0; b < blocks.length; b++) {
    var blockStart = start + blocks[b].offset;
    var count = blocks[b].count;
    try { sh.getRange(blockStart, 1, count, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(1); } catch (e) {}
    try { if (typeof oraStyleOrderBlock_ === 'function') oraStyleOrderBlock_(sh, blockStart, count); } catch (e) {}
    try { if (typeof oraPaintActionRows_ === 'function') oraPaintActionRows_(sh, blockStart, count); } catch (e) {}
  }
  return allRows.length;
}

// Optimise only true multi-order calls. Single order, resync, product changes,
// cancellation actions and stable in-place updates continue through the exact
// existing writer unchanged.
oraSyncOrders_ = function(body) {
  var orders = oraNormalizeOrders_(body);
  if (orders.length <= 1) return oraSyncOrdersBulkFastBase_(body);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = oraTarget_(), rows = 0;
    var bySheet = {};
    for (var i = 0; i < orders.length; i++) {
      var sheetName = oraSheetName_(orders[i].source);
      if (!bySheet[sheetName]) bySheet[sheetName] = [];
      bySheet[sheetName].push(orders[i]);
    }

    for (var sheetName in bySheet) {
      var sh = oraEnsureOrderSheet_(ss, sheetName);
      var existing = oraExistingOrderKeys_(sh);
      var fresh = [], updates = [];
      var sourceOrders = bySheet[sheetName];
      for (var j = 0; j < sourceOrders.length; j++) {
        if (existing[oraKey_(sourceOrders[j].id)]) updates.push(sourceOrders[j]);
        else fresh.push(sourceOrders[j]);
      }

      // Brand-new lead orders are the common bulk-import case.
      rows += oraAppendNewOrdersFast_(ss, sh, fresh);

      // Rare re-import/resync case: keep all existing action/location/update
      // protection by using the normal final oraWriteOrder_ wrapper chain.
      for (var u = 0; u < updates.length; u++) rows += oraWriteOrder_(ss, updates[u]);
    }

    SpreadsheetApp.flush();
    return {
      ok:true,
      status:'orders_synced',
      synced:orders.length,
      rows:rows,
      existing:0,
      bulk_fast:true,
      version:ORA_VERSION,
      spreadsheet_id:ss.getId(),
      spreadsheet_name:ss.getName()
    };
  } finally {
    lock.releaseLock();
  }
};
`;
