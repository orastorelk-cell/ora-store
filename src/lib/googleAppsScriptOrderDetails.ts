export const GOOGLE_APPS_SCRIPT_ORDER_DETAILS = String.raw`
// ============================================================
// O-RA STORE - ORDER DETAILS READBACK
// Lets authenticated app flows read current Call Center Sheet values
// without changing any order, stock, price, waybill or packing state.
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

function oraInvoiceRepairDetails_(orderId) {
  var ss = oraTarget_();
  var key = oraKey_(orderId);
  if (!key) return { ok:false, status:'error', message:'Order ID is required.', version:ORA_VERSION };

  for (var i = 0; i < ORA_ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if (!sh || sh.getLastRow() < 2) continue;
    var hm = oraHeaderMap_(sh);
    if (!hm['Order ID']) continue;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
    var matched = [];
    for (var r = 0; r < vals.length; r++) {
      if (oraKey_(vals[r][hm['Order ID'] - 1]) === key) matched.push(vals[r]);
    }
    if (!matched.length) continue;

    var firstValue = function(header) {
      var col = hm[header];
      if (!col) return '';
      for (var x = 0; x < matched.length; x++) {
        var value = oraStr_(matched[x][col - 1]).trim();
        if (value) return value;
      }
      return '';
    };

    var items = [];
    for (var m = 0; m < matched.length; m++) {
      var row = matched[m];
      items.push({
        item_code:hm['Item Code'] ? oraStr_(row[hm['Item Code'] - 1]).trim() : '',
        item_name:hm['Item Name'] ? oraStr_(row[hm['Item Name'] - 1]).trim() : '',
        variant:hm['Variant / Color'] ? oraStr_(row[hm['Variant / Color'] - 1]).trim() : '',
        qty:hm['Qty'] ? oraNum_(row[hm['Qty'] - 1]) : 1,
        unit_price:hm['Unit Price (Rs)'] ? oraNum_(row[hm['Unit Price (Rs)'] - 1]) : 0,
        line_total:hm['Line Total (Rs)'] ? oraNum_(row[hm['Line Total (Rs)'] - 1]) : 0,
        item_action:hm['Item Action'] ? oraStr_(row[hm['Item Action'] - 1]).trim() : ''
      });
    }

    return {
      ok:true,
      status:'invoice_repair_details_read',
      order_id:orderId,
      sheet:ORA_ORDER_SHEETS[i],
      city:firstValue('City'),
      district:firstValue('District'),
      normal_total:oraNum_(firstValue('Normal Total (Rs)')),
      offer:firstValue('Offer'),
      discount:oraNum_(firstValue('Discount (Rs)')),
      delivery_fee:oraNum_(firstValue('Delivery Fee (Rs)')),
      gift_wrap:firstValue('Gift Wrap'),
      wrapping_cost:oraNum_(firstValue('Wrapping Cost (Rs)')),
      final_total:oraNum_(firstValue('Final Total (Rs)')),
      items:items,
      version:ORA_VERSION,
      spreadsheet_id:ss.getId(),
      spreadsheet_name:ss.getName()
    };
  }

  return {
    ok:false,
    status:'invoice_repair_details_read',
    order_id:orderId,
    found:false,
    items:[],
    message:'No Google Sheet rows were found for this order.',
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
    if (action === 'invoice_repair_details' || action === 'read_invoice_repair_details') {
      return oraJson_(oraInvoiceRepairDetails_(oraStr_(body.orderId || body.order_id || body.order_number).trim()));
    }
  } catch (ignore) {}
  return doPostOrderDetailsBase_(e);
};
`;
