export const GOOGLE_APPS_SCRIPT_ACCESS_RETRY = String.raw`
// ============================================================
// O-RA STORE - TRANSIENT GOOGLE SHEETS ACCESS RETRY
// Google Apps Script occasionally throws:
// "Service Spreadsheets failed while accessing document with ID ..."
// Retry only the spreadsheet-open step. All order writes remain idempotent.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Sheet Access Retry';

var oraTargetAccessRetryBase_ = oraTarget_;
oraTarget_ = function() {
  var lastErr = null;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      return oraTargetAccessRetryBase_();
    } catch (err) {
      lastErr = err;
      var message = oraStr_(err && err.message ? err.message : err);
      var transientAccess = /Service Spreadsheets failed while accessing document|Internal error|Service unavailable|Timed out/i.test(message);
      if (!transientAccess || attempt >= 3) throw err;
      Utilities.sleep(attempt === 1 ? 350 : 900);
    }
  }
  throw lastErr || new Error('Google Sheet could not be opened.');
};
`;
