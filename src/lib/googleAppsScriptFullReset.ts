export const GOOGLE_APPS_SCRIPT_FULL_RESET = String.raw`
// ============================================================
// O-RA STORE - FULL RESET SHEET CLEANUP
// Full system reset clears every old order row while preserving
// headers, CITY LIST, PRODUCT CATALOG, guide and connection setup.
// Loaded after Stable Rows patch.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Exact City 8549 + Stable Rows + Full Reset';

function oraClearDeletedOrderHistory_() {
  var ss = oraTarget_();
  var sh = ss.getSheetByName(ORA_DELETED_TAB);
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var count = last - 1;
  sh.deleteRows(2, count);
  try {
    if (sh.getMaxColumns() < ORA_ORDER_HEADERS.length) oraEnsureColumns_(sh, ORA_ORDER_HEADERS.length);
    sh.getRange(1, 1, 1, ORA_ORDER_HEADERS.length).setValues([ORA_ORDER_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } catch (e) {}
  return count;
}

var doPostFullResetBase_ = doPost;
doPost = function(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = oraStr_(body.action || body.payload_type).trim().toLowerCase();
    if (action === 'clear_live_start_data' || action === 'clear_orders') {
      var removedActive = oraClearAllOperationalOrderRows_();
      var removedDeleted = oraClearDeletedOrderHistory_();
      SpreadsheetApp.flush();
      return oraJson_({
        ok: true,
        status: 'orders_cleared',
        removed: removedActive + removedDeleted,
        removed_active: removedActive,
        removed_deleted_history: removedDeleted,
        version: ORA_VERSION
      });
    }
  } catch (err) {
    return oraJson_({ ok: false, status: 'error', version: ORA_VERSION, message: err && err.message ? err.message : String(err) });
  }
  return doPostFullResetBase_(e);
};
`;
