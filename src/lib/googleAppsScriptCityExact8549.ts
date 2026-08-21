export const GOOGLE_APPS_SCRIPT_CITY_EXACT_8549 = String.raw`
// ============================================================
// O-RA STORE - EXACT COURIER CITY MASTER PATCH
// Keeps every courier CSV row. NO de-duplication, merging or renaming.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Exact City 8549';
var ORA_CITY_MASTER_SPREADSHEET_ID = '17bwEyB0kSHgUKiUWHRDgbzeUHIjsJYINkfbUhbqFy8M';
var ORA_CITY_MASTER_EXPECTED_DATA_ROWS = 8549;
var ORA_CITY_SEARCH_HEADER = 'Search (City | District)';

function oraInstallExactCityList_(ss) {
  var master = SpreadsheetApp.openById(ORA_CITY_MASTER_SPREADSHEET_ID);
  var source = master.getSheets()[0];
  var lastRow = source.getLastRow();
  if (lastRow < 2) throw new Error('Courier city master is empty.');

  // Read A:B exactly as imported from the courier CSV. No Set, no seen map,
  // no sort, no trim-based merge and no duplicate removal.
  var values = source.getRange(1, 1, lastRow, 2).getDisplayValues();
  var dataRows = values.length - 1;
  if (dataRows !== ORA_CITY_MASTER_EXPECTED_DATA_ROWS) {
    throw new Error('Courier city master row count changed. Expected ' + ORA_CITY_MASTER_EXPECTED_DATA_ROWS + ', found ' + dataRows + '.');
  }

  var sh = ss.getSheetByName(ORA_CITY_TAB) || ss.insertSheet(ORA_CITY_TAB);
  if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
  if (sh.getMaxColumns() < 3) sh.insertColumnsAfter(sh.getMaxColumns(), 3 - sh.getMaxColumns());
  sh.clearContents();
  sh.getRange(1, 1, values.length, 2).setValues(values);

  // A:B remain the untouched courier list. C is only a searchable display label.
  sh.getRange(1, 3).setValue(ORA_CITY_SEARCH_HEADER);
  var labels = [];
  for (var i = 1; i < values.length; i++) {
    labels.push([oraStr_(values[i][0]) + ' | ' + oraStr_(values[i][1])]);
  }
  if (labels.length) sh.getRange(2, 3, labels.length, 1).setValues(labels);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.autoResizeColumns(1, 3);
  return dataRows;
}

function oraExactCitySheet_(ss) {
  var sh = ss.getSheetByName(ORA_CITY_TAB);
  if (!sh || sh.getLastRow() !== ORA_CITY_MASTER_EXPECTED_DATA_ROWS + 1 || sh.getLastColumn() < 3) {
    oraInstallExactCityList_(ss);
    sh = ss.getSheetByName(ORA_CITY_TAB);
  }
  return sh;
}

var oraSetupValidationsExactCityBase_ = oraSetupValidations_;
oraSetupValidations_ = function(ss, sh, startRow, count) {
  // Keep every existing order/item/product validation from Clean V1.
  oraSetupValidationsExactCityBase_(ss, sh, startRow, count);
  if (!count) return;
  var hm = oraHeaderMap_(sh);
  if (!hm['City']) return;
  var citySh = oraExactCitySheet_(ss);
  if (!citySh || citySh.getLastRow() < 2) return;

  // Dropdown source is City | District, one option for EVERY courier row.
  // Google Sheets filters this dropdown while the user types in the City cell.
  sh.getRange(startRow, hm['City'], count, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(citySh.getRange(2, 3, citySh.getLastRow() - 1, 1), true)
      .setAllowInvalid(true)
      .build()
  );
};

function oraApplySelectedCityPair_(sh, row, hm, entered) {
  var text = oraStr_(entered).trim();
  if (!text) {
    if (hm['District']) sh.getRange(row, hm['District']).clearContent();
    return;
  }
  var ss = sh.getParent();
  var citySh = oraExactCitySheet_(ss);
  var last = citySh.getLastRow();
  if (last < 2) return;

  // Preferred path: user picked the searchable City | District option.
  var labelCell = citySh.getRange(2, 3, last - 1, 1)
    .createTextFinder(text).matchEntireCell(true).findNext();
  if (labelCell) {
    var r = labelCell.getRow();
    var city = oraStr_(citySh.getRange(r, 1).getDisplayValue());
    var district = oraStr_(citySh.getRange(r, 2).getDisplayValue());
    sh.getRange(row, hm['City']).setValue(city);
    if (hm['District']) sh.getRange(row, hm['District']).setValue(district);
    return;
  }

  // If a plain city name was entered, auto-fill only when every matching row
  // points to the same district. Same city name across different districts is
  // intentionally NOT guessed; the user must choose City | District.
  var matches = citySh.getRange(2, 1, last - 1, 1)
    .createTextFinder(text).matchEntireCell(true).findAll();
  if (!matches || !matches.length || !hm['District']) return;
  var districtKey = null, districtValue = '';
  for (var i = 0; i < matches.length; i++) {
    var d = oraStr_(citySh.getRange(matches[i].getRow(), 2).getDisplayValue());
    var key = oraKey_(d);
    if (districtKey === null) { districtKey = key; districtValue = d; }
    else if (districtKey !== key) return;
  }
  sh.getRange(row, hm['District']).setValue(districtValue);
}

var onEditExactCityBase_ = onEdit;
onEdit = function(e) {
  try { onEditExactCityBase_(e); } catch (baseErr) {}
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (ORA_ORDER_SHEETS.indexOf(sh.getName()) < 0 || e.range.getRow() < 2) return;
    var hm = oraHeaderMap_(sh);
    if (!hm['City'] || e.range.getColumn() !== hm['City']) return;
    oraApplySelectedCityPair_(sh, e.range.getRow(), hm, e.range.getDisplayValue());
  } catch (err) {
    try { e.range.setNote('City/District error: ' + err.message); } catch (ignore) {}
  }
};

function oraWriteSinhalaGuideExactCity_(ss) {
  var sh = ss.getSheetByName(ORA_GUIDE_TAB) || ss.insertSheet(ORA_GUIDE_TAB);
  sh.clear();
  var rows = [
    ['O-RA STORE - GOOGLE SHEETS CLEAN V1','සිංහල භාවිත මාර්ගෝපදේශය'],
    ['Order Tabs','Website orders = CALL CENTER ORDERS / Facebook = FACEBOOK ORDERS / TikTok = TIKTOK ORDERS'],
    ['Order Action','PENDING = තවම තීරණය කර නැත. CONFIRM ORDER = ඇණවුම තහවුරු කරන්න. CANCEL ENTIRE ORDER = සම්පූර්ණ ඇණවුම අවලංගු කරන්න.'],
    ['Item Action','KEEP ITEM = item එක තබාගන්න. CANCEL ITEM = තෝරාගත් item එක පමණක් අවලංගු කරන්න.'],
    ['Multi Item','එක Order ID එකට items ගණන අනුව rows කිහිපයක් ලැබේ. Order-level විස්තර පළමු row එකේ පමණි.'],
    ['City / District','City cell එකේ අකුරු කිහිපයක් type කළාම City | District options filter වේ. නිවැරදි option එක තෝරාගත් විට City සහ District columns දෙකම auto-fill වේ.'],
    ['Courier City Master','CITY LIST හි courier CSV rows 8,549 එකක්වත් delete / merge / de-duplicate කරන්නේ නැත. එකම City නම වෙන District වල තිබුණත් සියල්ල තබාගනී.'],
    ['Qty / Price','Qty වෙනස් කළ විට Line Total සහ Order Total නැවත ගණනය වේ. Website එකෙන් එන final price/discount values sync වේ.'],
    ['Delete Order','System Delete භාවිතා කළ විට එම Order ID එකේ rows සියල්ල ඉවත් වේ.'],
    ['Clear Orders','System Clear භාවිතා කරන්න. Live order rows Google Sheet එකෙන් manually delete නොකරන්න.'],
    ['Product Change','Change Item To එකෙන් product/variant තෝරා Apply Item Change checkbox එක tick කරන්න.'],
    ['Sync Status','Google Sheet row එක physically write වී read-back verify වුණාට පස්සේ පමණක් system එක synced ලෙස සැලකේ.']
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold').setFontSize(14);
  sh.getRange(1, 1, rows.length, 2).setWrap(true).setVerticalAlignment('top');
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(2, 700);
}

var setupOraGoogleSheetsCleanV1ExactCityBase_ = setupOraGoogleSheetsCleanV1;
setupOraGoogleSheetsCleanV1 = function() {
  var result = setupOraGoogleSheetsCleanV1ExactCityBase_();
  var ss = SpreadsheetApp.getActiveSpreadsheet() || oraTarget_();
  var count = oraInstallExactCityList_(ss);
  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (sh && sh.getLastRow() > 1) oraSetupValidations_(ss, sh, 2, sh.getLastRow() - 1);
  }
  oraWriteSinhalaGuideExactCity_(ss);
  SpreadsheetApp.flush();
  result.city_rows = count;
  result.city_master_exact = count === ORA_CITY_MASTER_EXPECTED_DATA_ROWS;
  result.version = ORA_VERSION;
  return result;
};
setupOraCallCenterSheet = function() { return setupOraGoogleSheetsCleanV1(); };
`;
