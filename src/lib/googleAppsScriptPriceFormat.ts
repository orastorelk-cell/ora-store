export const GOOGLE_APPS_SCRIPT_PRICE_FORMAT = String.raw`
// ============================================================
// O-RA STORE - MONEY DISPLAY FORMAT
// Keeps numeric values numeric while displaying them as currency.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Currency Format';

function oraApplyMoneyFormat_(sh, startRow, count) {
  if (!sh || !count || startRow < 2) return;
  var hm = oraHeaderMap_(sh);
  var moneyHeaders = [
    'Unit Price (Rs)',
    'Line Total (Rs)',
    'Discount (Rs)',
    'Normal Total (Rs)',
    'Delivery Fee (Rs)',
    'Wrapping Cost (Rs)',
    'Final Total (Rs)'
  ];
  for (var i = 0; i < moneyHeaders.length; i++) {
    var col = hm[moneyHeaders[i]];
    if (!col) continue;
    try { sh.getRange(startRow, col, count, 1).setNumberFormat('Rs. #,##0.00'); } catch (e) {}
  }
  if (hm['Qty']) {
    try { sh.getRange(startRow, hm['Qty'], count, 1).setNumberFormat('0'); } catch (e) {}
  }
}

var oraWriteOrderMoneyBase_ = oraWriteOrder_;
oraWriteOrder_ = function(ss, o) {
  var written = oraWriteOrderMoneyBase_(ss, o);
  if (written > 0) {
    var sh = oraEnsureOrderSheet_(ss, oraSheetName_(o.source));
    var start = oraFindOrderFirstRow_(sh, o.id);
    if (start) oraApplyMoneyFormat_(sh, start, written);
  }
  return written;
};

var setupOraGoogleSheetsCleanV1MoneyBase_ = setupOraGoogleSheetsCleanV1;
setupOraGoogleSheetsCleanV1 = function() {
  var result = setupOraGoogleSheetsCleanV1MoneyBase_();
  var ss = SpreadsheetApp.getActiveSpreadsheet() || oraTarget_();
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (sh && sh.getLastRow() > 1) oraApplyMoneyFormat_(sh, 2, sh.getLastRow() - 1);
  }
  var catalog = ss.getSheetByName(ORA_CATALOG_TAB);
  if (catalog && catalog.getLastRow() > 1) {
    try { catalog.getRange(2, 7, catalog.getLastRow() - 1, 1).setNumberFormat('Rs. #,##0.00'); } catch (e) {}
  }
  // Earlier setup layers already flush the structural changes. A final formatting
  // flush can occasionally throw a transient Google Sheets service error even
  // though the upgrade succeeded, so retry once without reporting a false failure.
  try { SpreadsheetApp.flush(); }
  catch (firstFlushError) {
    Utilities.sleep(500);
    try { SpreadsheetApp.flush(); } catch (ignoredFlushError) {}
  }
  result.version = ORA_VERSION;
  result.currency_format = true;
  return result;
};
setupOraCallCenterSheet = function() { return setupOraGoogleSheetsCleanV1(); };
`;
