export const GOOGLE_APPS_SCRIPT_CALL_CENTER_UX = String.raw`
// ============================================================
// O-RA STORE - CALL CENTER UX + TEST CLEANUP
// Runs after Clean V1 + Exact City patch.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Exact City 8549 + Call Center UX';

function oraCallCenterHiddenHeaders_() {
  return [
    'Main Code',
    'Discount (Rs)',
    'Normal Total (Rs)',
    'Delivery Fee (Rs)',
    'Source',
    'Lead ID',
    'Imported Status',
    'Last Sync',
    'Original Main Code',
    'Original Variant / Color',
    'Original Item Code',
    'Original Item Name',
    'Original Qty'
  ];
}

function oraApplyCallCenterView_(sh) {
  if (!sh) return;
  var hm = oraHeaderMap_(sh);
  try { sh.showColumns(1, Math.min(sh.getMaxColumns(), ORA_ORDER_HEADERS.length)); } catch (e) {}
  var hidden = oraCallCenterHiddenHeaders_();
  for (var i = 0; i < hidden.length; i++) {
    var col = hm[hidden[i]];
    if (col) try { sh.hideColumns(col); } catch (e) {}
  }
  try { sh.setFrozenRows(1); } catch (e) {}
  try { sh.setFrozenColumns(1); } catch (e) {}
  try {
    var widths = {
      'Order ID': 125, 'Customer Name': 170, 'Phone Number': 115, 'WhatsApp Number': 115,
      'Address': 230, 'City': 180, 'District': 120, 'Item Name': 190, 'Item Code': 110,
      'Variant / Color': 120, 'Qty': 55, 'Unit Price (Rs)': 95, 'Line Total (Rs)': 100,
      'Offer': 140, 'Final Total (Rs)': 110, 'Item Action': 115, 'Order Action': 150,
      'Cancel Reason': 180, 'Change Item To': 200, 'Change Preview': 220,
      'Apply Item Change': 120, 'Order Time': 145
    };
    for (var key in widths) if (hm[key]) sh.setColumnWidth(hm[key], widths[key]);
  } catch (e) {}
  try {
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, ORA_ORDER_HEADERS.length).setVerticalAlignment('middle');
  } catch (e) {}
}

function oraStyleOrderBlock_(sh, startRow, count) {
  if (!sh || !count) return;
  try {
    var range = sh.getRange(startRow, 1, count, ORA_ORDER_HEADERS.length);
    range.setBorder(true, null, true, null, null, null, '#475569', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  } catch (e) {}
  try {
    var hm = oraHeaderMap_(sh);
    if (hm['Order ID']) sh.getRange(startRow, hm['Order ID']).setFontWeight('bold');
  } catch (e) {}
}

function oraRegroupExistingOrders_(sh) {
  if (!sh || sh.getLastRow() < 2) return;
  var hm = oraHeaderMap_(sh), idCol = hm['Order ID'];
  if (!idCol) return;
  var count = sh.getLastRow() - 1;
  try { sh.getRange(2, 1, count, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(-8); } catch (e) {}
  var ids = sh.getRange(2, idCol, count, 1).getDisplayValues();
  var start = 0;
  while (start < ids.length) {
    var id = oraKey_(ids[start][0]);
    if (!id) { start++; continue; }
    var end = start;
    while (end + 1 < ids.length && oraKey_(ids[end + 1][0]) === id) end++;
    var rows = end - start + 1;
    try { sh.getRange(start + 2, 1, rows, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(1); } catch (e) {}
    oraStyleOrderBlock_(sh, start + 2, rows);
    start = end + 1;
  }
}

var oraWriteOrderCallCenterBase_ = oraWriteOrder_;
oraWriteOrder_ = function(ss, o) {
  var sh = oraEnsureOrderSheet_(ss, oraSheetName_(o.source));
  var before = sh.getLastRow();
  var written = oraWriteOrderCallCenterBase_(ss, o);
  if (written > 0) {
    var start = before + 1;
    if (written === 1) {
      try { sh.getRange(start, 1, 1, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(1); } catch (e) {}
    }
    oraStyleOrderBlock_(sh, start, written);
    oraApplyCallCenterView_(sh);
  }
  return written;
};

function oraTestRowMarker_(hm, row) {
  function value(name) { return hm[name] ? oraStr_(row[hm[name] - 1]) : ''; }
  var id = value('Order ID').trim();
  var lead = value('Lead ID').trim();
  var customer = value('Customer Name').trim();
  var address = value('Address').trim();
  if (/^(WEB-TEST-|ORA-DIAG-)/i.test(id)) return true;
  if (/^TEST-(FB|TK)-/i.test(lead)) return true;
  if (/^(TEST CUSTOMER|TEST MULTI ITEM CUSTOMER|TEST LEAD CUSTOMER)$/i.test(customer)) return true;
  if (/TEST ADDRESS\s*-?\s*DO NOT DISPATCH/i.test(address)) return true;
  return false;
}

function oraClearTestRowsBySource_(source) {
  var ss = oraTarget_(), removed = 0;
  var wanted = oraStr_(source || '').toLowerCase();
  for (var s = 0; s < ORA_ORDER_SHEETS.length; s++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[s]);
    if (!sh || sh.getLastRow() < 2) continue;
    if (wanted) {
      if (wanted.indexOf('website') >= 0 && ORA_ORDER_SHEETS[s] !== 'CALL CENTER ORDERS') continue;
      if (wanted.indexOf('facebook') >= 0 && ORA_ORDER_SHEETS[s] !== 'FACEBOOK ORDERS') continue;
      if (wanted.indexOf('tiktok') >= 0 && ORA_ORDER_SHEETS[s] !== 'TIKTOK ORDERS') continue;
    }
    var hm = oraHeaderMap_(sh);
    if (!hm['Order ID']) continue;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
    var testIds = {};
    for (var i = 0; i < vals.length; i++) {
      if (oraTestRowMarker_(hm, vals[i])) {
        var markedId = oraKey_(vals[i][hm['Order ID'] - 1]);
        if (markedId) testIds[markedId] = true;
      }
    }
    for (var r = vals.length - 1; r >= 0; r--) {
      var id = oraKey_(vals[r][hm['Order ID'] - 1]);
      if (!id || !testIds[id]) continue;
      sh.deleteRow(r + 2);
      removed++;
    }
    oraRegroupExistingOrders_(sh);
    oraApplyCallCenterView_(sh);
  }
  SpreadsheetApp.flush();
  return removed;
}

var doPostCallCenterBase_ = doPost;
doPost = function(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = oraStr_(body.action || body.payload_type).trim().toLowerCase();

    if (action === 'clear_test_orders' || action === 'operational_clear') {
      var removed = oraClearTestRowsBySource_(body.source || body.order_source || '');
      return oraJson_({
        ok: true,
        status: action === 'operational_clear' ? 'operational_cleared' : 'test_orders_cleared',
        removed: removed,
        version: ORA_VERSION
      });
    }

    if ((action === 'delete_order' || action === 'order_delete') && /delete test order/i.test(oraStr_(body.reason || ''))) {
      var orderId = oraStr_(body.orderId || body.order_id || body.order_number).trim();
      var removedExact = orderId ? oraDeleteOrderEverywhere_(orderId, true) : 0;
      var removedTests = oraClearTestRowsBySource_(body.order_source || body.source || '');
      return oraJson_({
        ok: true,
        status: 'order_deleted',
        removed: removedExact + removedTests,
        deleted: removedExact + removedTests,
        order_id: orderId,
        test_cleanup: removedTests,
        version: ORA_VERSION
      });
    }
  } catch (err) {
    return oraJson_({ ok: false, status: 'error', version: ORA_VERSION, message: err && err.message ? err.message : String(err) });
  }
  return doPostCallCenterBase_(e);
};

var setupOraGoogleSheetsCleanV1CallCenterBase_ = setupOraGoogleSheetsCleanV1;
setupOraGoogleSheetsCleanV1 = function() {
  var result = setupOraGoogleSheetsCleanV1CallCenterBase_();
  var ss = SpreadsheetApp.getActiveSpreadsheet() || oraTarget_();
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (!sh) continue;
    oraRegroupExistingOrders_(sh);
    oraApplyCallCenterView_(sh);
  }
  SpreadsheetApp.flush();
  result.version = ORA_VERSION;
  result.call_center_view = true;
  return result;
};
setupOraCallCenterSheet = function() { return setupOraGoogleSheetsCleanV1(); };
`;
