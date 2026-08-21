export const GOOGLE_APPS_SCRIPT_V17_COMPAT = String.raw`
// ============================================================
// O-RA STORE - V17.2 DIRECT ORDER WRITER
// Emergency-stable path: accept every known payload shape and write rows directly.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheet Sync V17.2 Direct';

function oraCompatNum_(v){var n=Number(v==null?0:v);return isFinite(n)?n:0;}
function oraCompatOrderRows_(order){
  order=order&&typeof order==='object'?order:{};
  var items=Array.isArray(order.items)&&order.items.length?order.items:[{}],rows=[];
  for(var i=0;i<items.length;i++){
    var it=items[i]||{},first=i===0,qty=Math.max(1,Number(it.quantity!=null?it.quantity:(it.qty!=null?it.qty:1))||1);
    var unit=oraCompatNum_(it.unit_price!=null?it.unit_price:(it.price!=null?it.price:0));
    var line=oraCompatNum_(it.subtotal!=null?it.subtotal:(it.line_total!=null?it.line_total:qty*unit));
    var orderDiscount=oraCompatNum_(order.special_offer_discount!=null?order.special_offer_discount:order.discount);
    var totalQty=0;for(var q=0;q<items.length;q++)totalQty+=Math.max(1,Number(items[q]&&items[q].quantity||1)||1);
    rows.push({
      'Order ID':oraStr_(order.order_number||order.order_id||order.id),
      'Customer Name':first?oraStr_(order.customer_name||order.customer):'',
      'Phone Number':first?oraStr_(order.phone||order.phone_number):'',
      'Address':first?oraStr_(order.address):'',
      'Item Name':oraStr_(it.product_name||it.item_name||it.name),
      'Item Code':oraStr_(it.sku||it.item_code||it.code),
      'Qty':qty,
      'Unit Price (Rs)':unit,
      'Final Total (Rs)':first?oraCompatNum_(order.total_amount!=null?order.total_amount:order.total):'',
      'Variant / Color':oraStr_(it.variant_name||it.variant||it.variant_value),
      'Item Action':oraStr_(it.item_action)||'KEEP ITEM',
      'Order Action':first?(oraStr_(order.order_action)||'PENDING'):'',
      'Offer':first?(oraStr_(order.offer)||(orderDiscount>0?('Qty Offer Rs. '+orderDiscount+' ('+totalQty+' items)'):'No Qty Offer')):'',
      'Discount (Rs)':first?orderDiscount:0,
      'Source':oraStr_(order.order_source||order.source||'Website'),
      'Main Code':oraStr_(it.main_sku||it.main_code||it.sku||it.item_code),
      'Line Total (Rs)':line,
      'Normal Total (Rs)':first?oraCompatNum_(order.subtotal!=null?order.subtotal:order.normal_total):'',
      'Delivery Fee (Rs)':first?oraCompatNum_(order.delivery_fee):'',
      'WhatsApp Number':first?oraStr_(order.whatsapp||order.whatsapp_number||order.phone):'',
      'Original Main Code':oraStr_(it.main_sku||it.main_code||it.sku||it.item_code),
      'Original Variant / Color':oraStr_(it.variant_name||it.variant||it.variant_value),
      'Original Item Code':oraStr_(it.sku||it.item_code||it.code),
      'Original Item Name':oraStr_(it.product_name||it.item_name||it.name),
      'Original Qty':qty,
      'Order Time':first?oraStr_(order.created_at||order.order_time||new Date().toISOString()):'',
      'Imported Status':first?oraStr_(order.call_center_status||order.imported_status||'Pending'):'',
      'City':first?oraStr_(order.city):'',
      'District':first?oraStr_(order.district):''
    });
  }
  return rows;
}

var oraGroupPayloadV17Base_ = oraGroupPayload_;
oraGroupPayload_ = function(body){
  body=body&&typeof body==='object'?body:{};
  var direct=oraGroupPayloadV17Base_(body);
  if(direct&&direct.length)return direct;
  var list=[];
  if(Array.isArray(body.orders))list=body.orders;
  else if(body.order&&typeof body.order==='object')list=[body.order];
  else if(Array.isArray(body.order_rows))list=body.order_rows;
  else if(body.order_row&&typeof body.order_row==='object')list=[body.order_row];
  else if(Array.isArray(body.rows))list=body.rows;
  if(!list.length)return [];
  var groups={};
  for(var i=0;i<list.length;i++){
    var entry=list[i]||{},source=oraStr_(entry['Source']||entry.order_source||entry.source||'Website');
    if(!groups[source])groups[source]=[];
    if(Array.isArray(entry.items)&&entry.items.length){var built=oraCompatOrderRows_(entry);for(var b=0;b<built.length;b++)groups[source].push(built[b]);}
    else groups[source].push(entry);
  }
  return oraGroupPayloadV17Base_({groups:groups});
};

// Direct writer deliberately avoids delete/group/validation/action-preservation work.
// First priority is guaranteed order arrival. Those extras run only after this path is stable.
oraSyncOrders_ = function(body){
  try{
    var ss=oraSpreadsheet_();
    var orders=oraGroupPayload_(body);
    if(!orders.length)return {ok:false,status:'orders_sync_empty',error:'No valid order rows received.',synced:0,rows:0};
    var written=0;
    for(var i=0;i<orders.length;i++){
      var order=orders[i]||{},sh=oraEnsureSheet_(ss,oraSheetNameForSource_(order.source),ORA_ORDER_HEADERS),out=[];
      for(var r=0;r<(order.rows||[]).length;r++){
        var incoming=order.rows[r]||{},row=[];
        for(var h=0;h<ORA_ORDER_HEADERS.length;h++){
          var header=ORA_ORDER_HEADERS[h];
          row.push(Object.prototype.hasOwnProperty.call(incoming,header)?incoming[header]:'');
        }
        if(!row[0])row[0]=oraStr_(order.id);
        if(!row[10])row[10]='KEEP ITEM';
        if(r===0&&!row[11])row[11]='PENDING';
        row[31]=new Date();
        out.push(row);
      }
      if(!out.length)continue;
      var start=sh.getLastRow()+1;
      sh.getRange(start,1,out.length,ORA_ORDER_HEADERS.length).setValues(out);
      written+=out.length;
    }
    SpreadsheetApp.flush();
    return {ok:true,status:'orders_synced',synced:orders.length,existing:0,rows:written,version:ORA_VERSION};
  }catch(err){
    return {ok:false,status:'orders_sync_failed',error:oraStr_(err&&err.message?err.message:err),version:ORA_VERSION};
  }
};

doPost = function(e){
  try{
    var body=e&&e.postData&&e.postData.contents?JSON.parse(e.postData.contents):{};
    var action=oraStr_(body.action||body.type||body.payload_type||body.payloadType).trim().toLowerCase();
    var result;
    if(action==='sync_orders'||action==='orders_sync'||action==='order_sync'||action==='orders_batch_sync'||action==='order_batch_sync'||action==='sync_order'||action==='order_upsert'||action==='orders_upsert')result=oraSyncOrders_(body);
    else if(action==='delete_order'||action==='order_delete')result=oraDeleteOrder_(body);
    else if(action==='clear_test_orders'||action==='website_test_orders_clear'||action==='test_orders_clear')result=oraClearTests_();
    else if(action==='clear_live_start_data'||action==='clear_orders'||action==='clear_all_orders'||action==='operational_clear')result=oraClearAll_();
    else if(action==='catalog_sync'||action==='sync_catalog')result=oraCatalogSync_(body);
    else result={ok:false,status:'unknown_action',error:'Unknown action: '+action,receivedKeys:Object.keys(body||{})};
    return oraJson_(result);
  }catch(err){return oraJson_({ok:false,status:'error',error:oraStr_(err&&err.message?err.message:err),version:ORA_VERSION});}
};
`;
