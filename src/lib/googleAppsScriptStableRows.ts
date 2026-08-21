export const GOOGLE_APPS_SCRIPT_STABLE_ROWS = String.raw`
// ============================================================
// O-RA STORE - STABLE ROWS / NO VISUAL JUMP PATCH
// Keeps order rows in place and prevents column/row auto-resize flicker.
// Loaded after Clean V1 + Exact City + Call Center UX.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Exact City 8549 + Stable Call Center Rows';

// Clean V1 used autoResizeColumns() every time an order was written. That made
// the sheet visibly jump while new orders were syncing. Keep widths controlled
// only by oraApplyCallCenterView_ instead.
oraEnsureOrderSheet_ = function(ss, name) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  oraEnsureColumns_(sh, ORA_ORDER_HEADERS.length);
  sh.getRange(1, 1, 1, ORA_ORDER_HEADERS.length).setValues([ORA_ORDER_HEADERS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, ORA_ORDER_HEADERS.length).setFontWeight('bold');
  return sh;
};

function oraStableOrderRows_(sh, orderId) {
  var hm = oraHeaderMap_(sh), idCol = hm['Order ID'];
  if (!idCol || sh.getLastRow() < 2) return [];
  var ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getDisplayValues();
  var rows = [];
  for (var i = 0; i < ids.length; i++) {
    if (oraKey_(ids[i][0]) === oraKey_(orderId)) rows.push(i + 2);
  }
  return rows;
}

function oraStableRowsAreContiguous_(rows) {
  if (!rows || rows.length < 2) return true;
  for (var i = 1; i < rows.length; i++) if (rows[i] !== rows[i - 1] + 1) return false;
  return true;
}

// Website City + District are used on the FIRST sync. After the order exists in
// the Sheet, Call Center may correct City/District manually. Preserve that exact
// Sheet location on later resyncs so the website original does not overwrite a
// Call Center correction.
function oraCaptureExistingLocation_(sh, orderId) {
  var hm = oraHeaderMap_(sh);
  var rows = oraStableOrderRows_(sh, orderId);
  if (!rows.length) return { exists: false, city: '', district: '' };
  var row = rows[0];
  return {
    exists: true,
    city: hm['City'] ? oraStr_(sh.getRange(row, hm['City']).getDisplayValue()) : '',
    district: hm['District'] ? oraStr_(sh.getRange(row, hm['District']).getDisplayValue()) : ''
  };
}

function oraBuildStableOrderValues_(sh, o, prior, priorLocation) {
  var hm = oraHeaderMap_(sh), rows = [], now = new Date();
  priorLocation = priorLocation || { exists: false, city: '', district: '' };
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
    set('City', first ? (priorLocation.exists ? priorLocation.city : o.city) : '');
    set('District', first ? (priorLocation.exists ? priorLocation.district : o.district) : '');
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
  return rows;
}

// Replace the old delete-then-append behaviour. If an order already exists in
// this source tab, overwrite the same block. Only insert/delete the difference
// when the item count itself changes.
oraWriteOrder_ = function(ss, o) {
  var sh = oraEnsureOrderSheet_(ss, oraSheetName_(o.source));
  var prior = oraCaptureActions_(sh, o.id);
  var priorLocation = oraCaptureExistingLocation_(sh, o.id);
  var values = oraBuildStableOrderValues_(sh, o, prior, priorLocation);
  if (!values.length) return 0;

  var oldRows = oraStableOrderRows_(sh, o.id);
  var start = 0;

  if (oldRows.length && oraStableRowsAreContiguous_(oldRows)) {
    start = oldRows[0];
    var oldCount = oldRows.length;
    try { sh.getRange(start, 1, oldCount, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(-8); } catch (e) {}

    if (values.length > oldCount) {
      sh.insertRowsAfter(start + oldCount - 1, values.length - oldCount);
    } else if (values.length < oldCount) {
      sh.deleteRows(start + values.length, oldCount - values.length);
    }
  } else if (oldRows.length) {
    // Safety fallback for an already-corrupted/non-contiguous block: remove only
    // those rows, then write back at the first old position instead of the bottom.
    start = oldRows[0];
    for (var d = oldRows.length - 1; d >= 0; d--) sh.deleteRow(oldRows[d]);
    var insertAt = Math.min(start, sh.getLastRow() + 1);
    if (insertAt <= sh.getLastRow()) sh.insertRowsBefore(insertAt, values.length);
    start = insertAt;
  } else {
    start = sh.getLastRow() + 1;
  }

  sh.getRange(start, 1, values.length, ORA_ORDER_HEADERS.length).setValues(values);
  oraSetupValidations_(ss, sh, start, values.length);

  try {
    var dataRange = sh.getRange(start, 1, values.length, ORA_ORDER_HEADERS.length);
    dataRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setVerticalAlignment('middle');
    sh.setRowHeightsForced(start, values.length, 34);
  } catch (e) {}

  // Every order gets its own collapsible row group, including single-item orders.
  try { sh.getRange(start, 1, values.length, ORA_ORDER_HEADERS.length).shiftRowGroupDepth(1); } catch (e) {}
  try { oraStyleOrderBlock_(sh, start, values.length); } catch (e) {}
  return values.length;
};

// Extend the existing Call Center view with fixed row sizing. This is also run
// during setup so old rows stop expanding because of long address/preview text.
var oraApplyCallCenterViewStableBase_ = oraApplyCallCenterView_;
oraApplyCallCenterView_ = function(sh) {
  oraApplyCallCenterViewStableBase_(sh);
  if (!sh) return;
  try { sh.setRowHeight(1, 38); } catch (e) {}
  if (sh.getLastRow() > 1) {
    var count = sh.getLastRow() - 1;
    try {
      sh.getRange(2, 1, count, ORA_ORDER_HEADERS.length)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
        .setVerticalAlignment('middle');
      sh.setRowHeightsForced(2, count, 34);
    } catch (e) {}
  }
};

var setupOraGoogleSheetsCleanV1StableBase_ = setupOraGoogleSheetsCleanV1;
setupOraGoogleSheetsCleanV1 = function() {
  var result = setupOraGoogleSheetsCleanV1StableBase_();
  var ss = SpreadsheetApp.getActiveSpreadsheet() || oraTarget_();
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (sh) oraApplyCallCenterView_(sh);
  }
  SpreadsheetApp.flush();
  result.version = ORA_VERSION;
  result.stable_rows = true;
  return result;
};
setupOraCallCenterSheet = function() { return setupOraGoogleSheetsCleanV1(); };
`;