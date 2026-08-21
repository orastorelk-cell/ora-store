export const GOOGLE_APPS_SCRIPT_ACTION_CHIPS = String.raw`
// ============================================================
// O-RA STORE - ACTION DROPDOWN CHIP VISUALS
// Keeps the exact action values used by the system while making
// the modern Google Sheets dropdown UI visually status-oriented.
// Loaded last, after all order/action behaviour patches.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Action Chips';

function oraActionChipColor_(value) {
  var v = oraKey_(value);
  if (v === 'KEEP ITEM' || v === 'CONFIRM ORDER') return '#137333';
  if (v === 'CANCEL ITEM' || v === 'CANCEL ENTIRE ORDER') return '#C5221F';
  if (v === 'PENDING') return '#B06000';
  return '#3C4043';
}

function oraPaintActionCell_(cell) {
  if (!cell) return;
  var value = oraStr_(cell.getDisplayValue()).trim();
  try {
    cell
      .setFontWeight('bold')
      .setFontColor(oraActionChipColor_(value))
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  } catch (e) {}
}

function oraPaintActionRows_(sh, startRow, count) {
  if (!sh || !count) return;
  var hm = oraHeaderMap_(sh);
  for (var i = 0; i < count; i++) {
    var row = startRow + i;
    if (hm['Item Action']) oraPaintActionCell_(sh.getRange(row, hm['Item Action']));
    if (hm['Order Action']) oraPaintActionCell_(sh.getRange(row, hm['Order Action']));
  }
}

// Rebuild the two action validations with the exact raw values expected by all
// existing Sheet, CSV and backend logic. Modern Google Sheets renders list
// dropdowns as chips by default; no emoji/prefix is added to the stored value.
var oraSetupValidationsActionChipBase_ = oraSetupValidations_;
oraSetupValidations_ = function(ss, sh, startRow, count) {
  oraSetupValidationsActionChipBase_(ss, sh, startRow, count);
  if (!count) return;
  var hm = oraHeaderMap_(sh);
  if (hm['Item Action']) {
    sh.getRange(startRow, hm['Item Action'], count, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(['KEEP ITEM','CANCEL ITEM'], true)
        .setAllowInvalid(false)
        .setHelpText('KEEP ITEM = keep this item. CANCEL ITEM = cancel only this item.')
        .build()
    );
  }
  if (hm['Order Action']) {
    sh.getRange(startRow, hm['Order Action'], count, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(['PENDING','CONFIRM ORDER','CANCEL ENTIRE ORDER'], true)
        .setAllowInvalid(false)
        .setHelpText('PENDING / CONFIRM ORDER / CANCEL ENTIRE ORDER')
        .build()
    );
  }
  oraPaintActionRows_(sh, startRow, count);
};

// New/resynced orders get the same chip/dropdown visual immediately.
var oraWriteOrderActionChipBase_ = oraWriteOrder_;
oraWriteOrder_ = function(ss, o) {
  var written = oraWriteOrderActionChipBase_(ss, o);
  if (written > 0) {
    var sh = oraEnsureOrderSheet_(ss, oraSheetName_(o.source));
    var start = oraFindOrderFirstRow_(sh, o.id);
    if (start) oraPaintActionRows_(sh, start, written);
  }
  return written;
};

// Repaint after Item Action / Order Action edits. The previous onEdit chain runs
// first, so all existing cancel/recalc/status logic remains authoritative.
var onEditActionChipBase_ = onEdit;
onEdit = function(e) {
  var result = onEditActionChipBase_(e);
  try {
    if (!e || !e.range) return result;
    var sh = e.range.getSheet();
    if (ORA_ORDER_SHEETS.indexOf(sh.getName()) < 0 || e.range.getRow() < 2) return result;
    var hm = oraHeaderMap_(sh), col = e.range.getColumn();
    if (col !== hm['Item Action'] && col !== hm['Order Action']) return result;
    var orderId = hm['Order ID'] ? sh.getRange(e.range.getRow(), hm['Order ID']).getDisplayValue() : '';
    var first = orderId ? oraFindOrderFirstRow_(sh, orderId) : 0;
    if (!first) first = e.range.getRow();
    var rows = oraStableOrderRows_(sh, orderId);
    if (rows && rows.length) {
      for (var i = 0; i < rows.length; i++) oraPaintActionRows_(sh, rows[i], 1);
    } else {
      oraPaintActionRows_(sh, first, 1);
    }
  } catch (ignore) {}
  return result;
};

// Setup also upgrades any already-existing order rows.
var setupOraGoogleSheetsCleanV1ActionChipBase_ = setupOraGoogleSheetsCleanV1;
setupOraGoogleSheetsCleanV1 = function() {
  var result = setupOraGoogleSheetsCleanV1ActionChipBase_();
  var ss = SpreadsheetApp.getActiveSpreadsheet() || oraTarget_();
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (!sh || sh.getLastRow() < 2) continue;
    oraSetupValidations_(ss, sh, 2, sh.getLastRow() - 1);
    oraPaintActionRows_(sh, 2, sh.getLastRow() - 1);
  }
  SpreadsheetApp.flush();
  result.version = ORA_VERSION;
  result.action_chips = true;
  return result;
};
setupOraCallCenterSheet = function() { return setupOraGoogleSheetsCleanV1(); };
`;
