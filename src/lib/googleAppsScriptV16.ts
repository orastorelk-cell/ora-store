export const GOOGLE_APPS_SCRIPT_CODE_V16 = String.raw`// ============================================================
// O-RA STORE - GOOGLE SHEET SYNC V16
// Multi-item safe • update-safe • delete/clear safe
// Existing CITY LIST / order tabs are preserved.
// ============================================================

var ORA_VERSION = "O-RA Store Google Sheet Sync V16";
var ORA_ORDER_HEADERS = [
  "Order ID","Customer Name","Phone Number","Address","Item Name","Item Code","Qty","Unit Price (Rs)","Final Total (Rs)",
  "Variant / Color","Item Action","Order Action","Offer","Cancel Reason","Change Item To","Change Preview","Apply Item Change",
  "Discount (Rs)","Source","Main Code","Line Total (Rs)","Normal Total (Rs)","Delivery Fee (Rs)","WhatsApp Number",
  "Original Main Code","Original Variant / Color","Original Item Code","Original Item Name","Original Qty","Order Time","Lead ID",
  "Imported Status","Last Sync","City","District"
];
var ORA_ORDER_SHEETS = ["CALL CENTER ORDERS","FACEBOOK ORDERS","TIKTOK ORDERS"];
var ORA_DELETED_SHEET = "DELETED ORDERS";
var ORA_CITY_TAB = "CITY LIST";

function oraJson_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function oraCol_(name){return ORA_ORDER_HEADERS.indexOf(name)+1;}
function oraNum_(v){var n=Number(String(v==null?"":v).replace(/[^0-9.-]/g,""));return isFinite(n)?n:0;}
function oraStr_(v){return v==null?"":String(v);}
function oraPick_(o,names){for(var i=0;i<names.length;i++){var v=o?o[names[i]]:undefined;if(v!==undefined&&v!==null&&String(v)!=="")return v;}return "";}
function oraKey_(v){return String(v||"").trim().toUpperCase();}
function oraSheetName_(source){var s=String(source||"").toLowerCase();if(s.indexOf("facebook")>=0)return "FACEBOOK ORDERS";if(s.indexOf("tiktok")>=0)return "TIKTOK ORDERS";return "CALL CENTER ORDERS";}

function oraEnsureSheet_(ss,name){
  var sh=ss.getSheetByName(name);
  if(!sh)sh=ss.insertSheet(name);
  var lastCol=Math.max(1,sh.getLastColumn());
  var headers=sh.getLastRow()>=1?sh.getRange(1,1,1,lastCol).getDisplayValues()[0]:[];
  for(var i=0;i<ORA_ORDER_HEADERS.length;i++){
    if(headers.indexOf(ORA_ORDER_HEADERS[i])<0){
      var col=sh.getLastColumn()+1;
      if(sh.getMaxColumns()<col)sh.insertColumnAfter(sh.getMaxColumns());
      sh.getRange(1,col).setValue(ORA_ORDER_HEADERS[i]);
      headers.push(ORA_ORDER_HEADERS[i]);
    }
  }
  if(sh.getLastRow()<1)sh.getRange(1,1,1,ORA_ORDER_HEADERS.length).setValues([ORA_ORDER_HEADERS]);
  sh.setFrozenRows(1);
  return sh;
}

function oraHeaderMap_(sh){
  var last=Math.max(1,sh.getLastColumn());
  var vals=sh.getRange(1,1,1,last).getDisplayValues()[0];
  var map={};
  for(var i=0;i<vals.length;i++)map[String(vals[i]||"")]=i+1;
  return map;
}

function oraNormalizeIncoming_(body){
  var flat=[];
  if(body&&body.groups){
    for(var g in body.groups){if(Array.isArray(body.groups[g]))flat=flat.concat(body.groups[g]);}
  }
  if(Array.isArray(body&&body.orders))flat=flat.concat(body.orders);
  else if(body&&body.order)flat.push(body.order);
  else if(Array.isArray(body&&body.order_rows))flat=flat.concat(body.order_rows);
  else if(body&&body.order_row)flat.push(body.order_row);

  var grouped={};
  var orderKeys=[];
  for(var i=0;i<flat.length;i++){
    var src=flat[i]||{};
    var id=oraStr_(oraPick_(src,["Order ID","orderId","order_id","order_number","orderNo"])).trim();
    if(!id)continue;
    var key=oraKey_(id);
    if(!grouped[key]){
      grouped[key]={
        id:id,
        source:oraStr_(oraPick_(src,["Source","source","order_source"])||"Website"),
        customer:oraStr_(oraPick_(src,["Customer Name","customerName","customer_name"])),
        phone:oraStr_(oraPick_(src,["Phone Number","phoneNumber","phone_number","phone"])),
        whatsapp:oraStr_(oraPick_(src,["WhatsApp Number","whatsAppNumber","whatsapp_number","whatsapp","phone"])),
        address:oraStr_(oraPick_(src,["Address","address"])),
        city:oraStr_(oraPick_(src,["City","city"])),
        district:oraStr_(oraPick_(src,["District","district"])),
        finalTotal:oraNum_(oraPick_(src,["Final Total (Rs)","finalTotal","final_total","total_amount","total"])),
        discount:oraNum_(oraPick_(src,["Discount (Rs)","discount","discount_amount","special_offer_discount"])),
        normalTotal:oraNum_(oraPick_(src,["Normal Total (Rs)","normalTotal","normal_total","subtotal"])),
        delivery:oraNum_(oraPick_(src,["Delivery Fee (Rs)","deliveryFee","delivery_fee"])),
        offer:oraStr_(oraPick_(src,["Offer","offer","offer_label"])),
        orderTime:oraStr_(oraPick_(src,["Order Time","orderTime","order_time","created_at"])),
        leadId:oraStr_(oraPick_(src,["Lead ID","leadId","lead_id","platform_lead_id"])),
        importedStatus:oraStr_(oraPick_(src,["Imported Status","importedStatus","imported_status","call_center_status"])||"Pending"),
        items:[]
      };
      orderKeys.push(key);
    }
    var order=grouped[key];
    if(!order.customer)order.customer=oraStr_(oraPick_(src,["Customer Name","customerName","customer_name"]));
    if(!order.phone)order.phone=oraStr_(oraPick_(src,["Phone Number","phoneNumber","phone_number","phone"]));
    if(!order.address)order.address=oraStr_(oraPick_(src,["Address","address"]));
    if(!order.city)order.city=oraStr_(oraPick_(src,["City","city"]));
    if(!order.district)order.district=oraStr_(oraPick_(src,["District","district"]));
    if(!order.finalTotal)order.finalTotal=oraNum_(oraPick_(src,["Final Total (Rs)","finalTotal","final_total","total_amount","total"]));
    if(!order.delivery)order.delivery=oraNum_(oraPick_(src,["Delivery Fee (Rs)","deliveryFee","delivery_fee"]));
    if(!order.discount)order.discount=oraNum_(oraPick_(src,["Discount (Rs)","discount","discount_amount","special_offer_discount"]));
    if(!order.normalTotal)order.normalTotal=oraNum_(oraPick_(src,["Normal Total (Rs)","normalTotal","normal_total","subtotal"]));
    if(!order.offer)order.offer=oraStr_(oraPick_(src,["Offer","offer","offer_label"]));

    var nested=Array.isArray(src.items)&&src.items.length?src.items:null;
    var itemList=nested||[src];
    for(var j=0;j<itemList.length;j++){
      var it=itemList[j]||{};
      var qty=Math.max(1,Math.round(oraNum_(oraPick_(it,["Qty","qty","quantity"])||1)));
      var unit=oraNum_(oraPick_(it,["Unit Price (Rs)","unitPrice","unit_price","price"]));
      var line=oraNum_(oraPick_(it,["Line Total (Rs)","lineTotal","line_total"]));
      if(!line)line=Math.round(qty*unit*100)/100;
      order.items.push({
        name:oraStr_(oraPick_(it,["Item Name","itemName","item_name","product_name","name"])),
        code:oraStr_(oraPick_(it,["Item Code","itemCode","item_code","sku"])),
        main:oraStr_(oraPick_(it,["Main Code","mainCode","main_code","main_sku","sku"])),
        variant:oraStr_(oraPick_(it,["Variant / Color","variantName","variant_name","variant","variantColor"])),
        qty:qty,unit:unit,line:line
      });
    }
  }

  var out=[];
  for(var k=0;k<orderKeys.length;k++){
    var o=grouped[orderKeys[k]];
    var lineSum=0,qtySum=0;
    for(var x=0;x<o.items.length;x++){lineSum+=o.items[x].line;qtySum+=o.items[x].qty;}
    if(!o.normalTotal)o.normalTotal=Math.round(lineSum*100)/100;
    if(!o.discount&&o.finalTotal>0){
      var inferred=Math.round(Math.max(0,lineSum+o.delivery-o.finalTotal)*100)/100;
      o.discount=inferred;
    }
    if(!o.finalTotal)o.finalTotal=Math.round(Math.max(0,lineSum-o.discount+o.delivery)*100)/100;
    if(!o.offer)o.offer=o.discount>0?("Qty Offer Rs. "+o.discount+" ("+qtySum+" items)"):"No Qty Offer";
    out.push(o);
  }
  return out;
}

function oraCaptureActions_(sh,orderId){
  var out={orderAction:"PENDING",items:{}};
  var lr=sh.getLastRow();if(lr<2)return out;
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"],itemCol=hm["Item Code"],varCol=hm["Variant / Color"],iaCol=hm["Item Action"],oaCol=hm["Order Action"];
  if(!idCol)return out;
  var vals=sh.getRange(2,1,lr-1,sh.getLastColumn()).getDisplayValues();
  for(var i=0;i<vals.length;i++){
    if(oraKey_(vals[i][idCol-1])!==oraKey_(orderId))continue;
    if(oaCol&&vals[i][oaCol-1])out.orderAction=vals[i][oaCol-1];
    var key=oraKey_((itemCol?vals[i][itemCol-1]:"")+"|"+(varCol?vals[i][varCol-1]:""));
    if(key&&iaCol&&vals[i][iaCol-1])out.items[key]=vals[i][iaCol-1];
  }
  return out;
}

function oraDeleteRowsById_(sh,orderId,moveToDeleted){
  var lr=sh.getLastRow();if(lr<2)return 0;
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"];if(!idCol)return 0;
  var ids=sh.getRange(2,idCol,lr-1,1).getDisplayValues();
  var ss=sh.getParent(),deleted=null,moved=0;
  if(moveToDeleted){deleted=ss.getSheetByName(ORA_DELETED_SHEET)||ss.insertSheet(ORA_DELETED_SHEET);if(deleted.getLastRow()===0)deleted.getRange(1,1,1,sh.getLastColumn()).setValues([sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]]);}
  for(var i=ids.length-1;i>=0;i--){
    if(oraKey_(ids[i][0])!==oraKey_(orderId))continue;
    var row=i+2;
    if(deleted){var v=sh.getRange(row,1,1,sh.getLastColumn()).getValues();deleted.getRange(deleted.getLastRow()+1,1,1,v[0].length).setValues(v);}
    sh.deleteRow(row);moved++;
  }
  return moved;
}

function oraApplyCityValidation_(ss,sh,start,count){
  try{
    var city=ss.getSheetByName(ORA_CITY_TAB);if(!city||city.getLastRow()<2||!count)return;
    var hm=oraHeaderMap_(sh),cityCol=hm["City"];if(!cityCol)return;
    sh.getRange(start,cityCol,count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(city.getRange(2,1,city.getLastRow()-1,1),true).setAllowInvalid(true).build());
  }catch(e){}
}

function oraWriteOrder_(ss,o){
  var sh=oraEnsureSheet_(ss,oraSheetName_(o.source));
  var actions=oraCaptureActions_(sh,o.id);
  oraDeleteRowsById_(sh,o.id,false);
  var hm=oraHeaderMap_(sh),rows=[];
  for(var i=0;i<o.items.length;i++){
    var it=o.items[i],first=i===0,row=[];
    for(var c=1;c<=sh.getLastColumn();c++)row.push("");
    function set(h,v){if(hm[h])row[hm[h]-1]=v;}
    var itemKey=oraKey_(it.code+"|"+it.variant);
    set("Order ID",o.id);
    set("Customer Name",first?o.customer:"");set("Phone Number",first?o.phone:"");set("Address",first?o.address:"");
    set("Item Name",it.name);set("Item Code",it.code);set("Qty",it.qty);set("Unit Price (Rs)",it.unit);set("Variant / Color",it.variant);
    set("Item Action",actions.items[itemKey]||"KEEP ITEM");set("Order Action",first?(actions.orderAction||"PENDING"):"");
    set("Offer",first?o.offer:"");set("Discount (Rs)",first?o.discount:"");set("Source",o.source);set("Main Code",it.main);
    set("Line Total (Rs)",it.line);set("Final Total (Rs)",first?o.finalTotal:"");set("Normal Total (Rs)",first?o.normalTotal:"");
    set("Delivery Fee (Rs)",first?o.delivery:"");set("WhatsApp Number",first?o.whatsapp:"");
    set("Original Main Code",it.main);set("Original Variant / Color",it.variant);set("Original Item Code",it.code);set("Original Item Name",it.name);set("Original Qty",it.qty);
    set("Order Time",first?o.orderTime:"");set("Lead ID",first?o.leadId:"");set("Imported Status",first?o.importedStatus:"");set("Last Sync",new Date());
    set("City",first?o.city:"");set("District",first?o.district:"");
    rows.push(row);
  }
  if(rows.length){var start=sh.getLastRow()+1;sh.getRange(start,1,rows.length,sh.getLastColumn()).setValues(rows);oraApplyCityValidation_(ss,sh,start,rows.length);}
  return rows.length;
}

function oraSync_(body){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),orders=oraNormalizeIncoming_(body),rows=0;
  for(var i=0;i<orders.length;i++)rows+=oraWriteOrder_(ss,orders[i]);
  return {ok:true,status:"orders_synced",synced:orders.length,existing:0,rows:rows};
}

function oraDeleteOrder_(body){
  var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();if(!id)return {ok:false,error:"Missing order ID"};
  var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);if(sh)removed+=oraDeleteRowsById_(sh,id,true);}
  return {ok:true,status:"order_deleted",deleted:removed,removed:removed,orderId:id};
}

function oraClearAll_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0,names=ORA_ORDER_SHEETS.concat([ORA_DELETED_SHEET]);
  for(var i=0;i<names.length;i++){var sh=ss.getSheetByName(names[i]);if(!sh)continue;var lr=sh.getLastRow();if(lr>1){removed+=lr-1;sh.deleteRows(2,lr-1);}}
  return {ok:true,status:"operational_cleared",removed:removed};
}

function oraClearTests_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0;
  for(var s=0;s<ORA_ORDER_SHEETS.length;s++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[s]);if(!sh||sh.getLastRow()<2)continue;
    var hm=oraHeaderMap_(sh),idCol=hm["Order ID"];if(!idCol)continue;
    var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues();
    for(var i=ids.length-1;i>=0;i--){var id=oraKey_(ids[i][0]);if(id.indexOf("TEST-")===0||id.indexOf("WEB-TEST-")===0){sh.deleteRow(i+2);removed++;}}
  }
  return {ok:true,status:"test_orders_cleared",removed:removed};
}

function oraCitySearch_(q){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(ORA_CITY_TAB),out=[];if(!sh||sh.getLastRow()<2)return out;
  var query=String(q||"").trim().toLowerCase();if(query.length<2)return out;
  var vals=sh.getRange(2,1,sh.getLastRow()-1,Math.min(2,sh.getLastColumn())).getDisplayValues();
  for(var i=0;i<vals.length&&out.length<100;i++){var city=String(vals[i][0]||""),district=String(vals[i][1]||"");if(city.toLowerCase().indexOf(query)>=0)out.push({city:city,district:district});}
  return out;
}

function doGet(){return oraJson_({ok:true,status:"ok",service:"O-RA Google Sheet Sync",version:ORA_VERSION,timestamp:new Date().toISOString()});}
function doPost(e){
  try{
    if(!e||!e.postData||!e.postData.contents)return oraJson_({ok:false,error:"Missing POST body"});
    var body=JSON.parse(e.postData.contents),action=String(body.action||body.type||body.payload_type||"").trim();
    if(action==="orders_sync"||action==="order_batch_sync"||action==="orders_batch_sync"||action==="order_sync"||action==="sync_order"||action==="sync_orders")return oraJson_(oraSync_(body));
    if(action==="order_delete"||action==="delete_order"||action==="delete_order_by_id")return oraJson_(oraDeleteOrder_(body));
    if(action==="operational_clear"||action==="clear_live_start_data")return oraJson_(oraClearAll_());
    if(action==="clear_test_orders"||action==="clear_test_data")return oraJson_(oraClearTests_());
    if(action==="city_search"||action==="search_city")return oraJson_({ok:true,status:"city_search",results:oraCitySearch_(body.query||body.q||body.city)});
    if(action==="health"||action==="ping")return oraJson_({ok:true,status:"ok",version:ORA_VERSION,timestamp:new Date().toISOString()});
    return oraJson_({ok:false,error:"Unknown action: "+action});
  }catch(err){return oraJson_({ok:false,error:String(err&&err.message?err.message:err)});}
}

function setupOraCallCenterSheet(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();for(var i=0;i<ORA_ORDER_SHEETS.length;i++)oraEnsureSheet_(ss,ORA_ORDER_SHEETS[i]);
  SpreadsheetApp.getActive().toast("O-RA V16 setup complete. Existing order tabs and CITY LIST preserved.","O-RA",5);
}
`;