export const GOOGLE_APPS_SCRIPT_ORDER_DETAILS = String.raw`
// ============================================================
// O-RA STORE - ORDER DETAILS READBACK
// Lets authenticated app flows read the current City/District values
// from the live call-center Sheet without changing any order logic.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Order Details Readback';

function oraOrderDetails_(orderId) {
  var ss = oraTarget_();
  var key = oraKey_(orderId);
  if (!key) return { ok:false, status:'error', message:'Order ID is required.', version:ORA_VERSION };

  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (!sh || sh.getLastRow() < 2) continue;
    var hm = oraHeaderMap_(sh);
    if (!hm['Order ID']) continue;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
    for (var r = 0; r < vals.length; r++) {
      if (oraKey_(vals[r][hm['Order ID'] - 1]) !== key) continue;
      return {
        ok:true,
        status:'order_details_read',
        order_id:orderId,
        sheet:ORA_ORDER_SHEETS[i],
        city:hm['City'] ? oraStr_(vals[r][hm['City'] - 1]) : '',
        district:hm['District'] ? oraStr_(vals[r][hm['District'] - 1]) : '',
        customer_name:hm['Customer Name'] ? oraStr_(vals[r][hm['Customer Name'] - 1]) : '',
        version:ORA_VERSION,
        spreadsheet_id:ss.getId(),
        spreadsheet_name:ss.getName()
      };
    }
  }

  return {
    ok:true,
    status:'order_details_read',
    order_id:orderId,
    found:false,
    city:'',
    district:'',
    version:ORA_VERSION,
    spreadsheet_id:ss.getId(),
    spreadsheet_name:ss.getName()
  };
}

var doPostOrderDetailsBase_ = doPost;
doPost = function(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = oraStr_(body.action || body.payload_type).trim().toLowerCase();
    if (action === 'order_details' || action === 'read_order_details') {
      return oraJson_(oraOrderDetails_(oraStr_(body.orderId || body.order_id || body.order_number).trim()));
    }
  } catch (ignore) {}
  return doPostOrderDetailsBase_(e);
};
`;
