export const GOOGLE_APPS_SCRIPT_WEBSITE_SPEED = String.raw`
// ============================================================
// O-RA STORE - FAST WEBSITE ORDER APPEND
// New Website orders are appended with one value write and one batched
// validation/style pass. Existing-order resyncs keep the proven stable writer
// so Call Center edits, actions and corrected City/District values are preserved.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Fast Website Orders V1';

var oraWriteOrderWebsiteStableBase_ = oraWriteOrder_;

oraWriteOrder_ = function(ss, o) {
  var sheetName = oraSheetName_(o.source);

  // FB/TikTok already use the dedicated bulk-speed path. Keep their single-row
  // repair/resync writer untouched as well.
  if (sheetName !== 'CALL CENTER ORDERS') {
    return oraWriteOrderWebsiteStableBase_(ss, o);
  }

  var sh = oraEnsureOrderSheet_(ss, sheetName);
  var existingRows = oraStableOrderRows_(sh, o.id);

  // A resync may contain actions or manually corrected location data. Delegate
  // it to the existing stable writer, which is deliberately conservative.
  if (existingRows.length) {
    return oraWriteOrderWebsiteStableBase_(ss, o);
  }

  var prior = {
    orderAction: 'PENDING',
    cancelReason: '',
    giftWrap: '',
    wrappingCost: '',
    items: {}
  };
  var location = { exists: false, city: '', district: '' };
  var values = oraBuildStableOrderValues_(sh, o, prior, location);
  if (!values.length) return 0;

  var start = sh.getLastRow() + 1;

  // One physical write makes every item row visible together. The bulk helper
  // installs City/Variant/Action dropdowns, currency formats, row grouping and
  // block styling without rerunning the expensive full-sheet view wrappers.
  sh.getRange(start, 1, values.length, ORA_ORDER_HEADERS.length).setValues(values);
  oraBulkSetupFreshRows_(ss, sh, start, values.length, [
    { offset: 0, count: values.length }
  ]);
  oraApplyMoneyFormat_(sh, start, values.length);

  return values.length;
};
`;
