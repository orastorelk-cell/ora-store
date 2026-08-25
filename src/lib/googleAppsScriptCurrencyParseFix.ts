export const GOOGLE_APPS_SCRIPT_CURRENCY_PARSE_FIX = String.raw`
// ============================================================
// O-RA STORE - SAFE CURRENCY PARSER
// Handles display-formatted values such as "Rs. 1,590" correctly.
// Existing numeric inputs remain unchanged.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Safe Currency Parser';
oraNum_ = function(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var raw = oraStr_(v).trim().replace(/,/g, '');
  var match = raw.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/);
  var n = match ? Number(match[0]) : 0;
  return isFinite(n) ? n : 0;
};
`;
