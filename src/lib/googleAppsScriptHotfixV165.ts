export const GOOGLE_APPS_SCRIPT_HOTFIX_V165 = String.raw`
// ============================================================
// O-RA STORE - FINAL SELF-CONTAINED SHEET ENGINE V17 STABLE
// This final layer intentionally bypasses every older order/catalog writer.
// ============================================================
var ORA_VERSION = "O-RA Store Google Sheet Sync V17 Stable";
var ORA_STABLE_SHEET_ID_KEY = "ORA_TARGET_SPREADSHEET_ID";
var ORA_STABLE_ORDER_SHEETS = ["CALL CENTER ORDERS","FACEBOOK ORDERS","TIKTOK ORDERS"];
var ORA_STABLE_ORDER_HEADERS = [
  "Order ID","Customer Name","Phone Number","Address","Item Name","Item Code","Qty","Unit Price (Rs)","Final Total (Rs)",
  "Variant / Color","Item Action","Order Action","Offer","Cancel Reason","Change Item To","Change Preview","Apply Item Change",
  "Discount (Rs)","Source","Main Code","Line Total (Rs)","Normal Total (Rs)","Delivery Fee (Rs)","WhatsApp Number",
  "Original Main Code","Original Variant / Color","Original Item Code","Original Item Name","Original Qty","Order Time","Lead ID",
  "Imported Status","Last Sync","City","District"
];
var ORA_STABLE_CATALOG_HEADERS = ["Item Image","Main Code","Variant Code","Item Name","Variant / Color","Type","Selling Price (Rs)","Current Stock","Status","Image URL","Select Product / Variant","Last Updated"];

function oraStableJson_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function oraStableStr_(v){return v===undefined||v===null?"":String(v);}
function oraStableNum_(v){var n=Number(String(v===undefined||v===null?"":v).replace(/[^0-9.-]/g,""));return isFinite(n)?n:0;}
function oraStablePick_(o,names){for(var i=0;i<names.length;i++){var v=o?o[names[i]]:undefined;if(v!==undefined&&v!==null&&String(v)!=="")return v;}return "";}
function oraStableKey_(v){return String(v||"").trim().toUpperCase();}
function oraStableSheetName_(source){var s=String(source||"").toLowerCase();if(s.indexOf("facebook")>=0)return "FACEBOOK ORDERS";if(s.indexOf("tiktok")>=0)return "TIKTOK ORDERS";return "CALL CENTER ORDERS";}

function oraStableSpreadsheet_(){
  var props=PropertiesService.getScriptProperties();
  var id=String(props.getProperty(ORA_STABLE_SHEET_ID_KEY)||"").trim();
  if(id){try{return SpreadsheetApp.openById(id);}catch(e){}}
  var active=SpreadsheetApp.getActiveSpreadsheet();
  if(!active)throw new Error("Target Google Sheet is not configured. Open the Sheet and run setupOraCallCenterSheet once.");
  props.setProperty(ORA_STABLE_SHEET_ID_KEY,active.getId());
  return active;
}

function oraStableEnsureOrderSheet_(ss,name){
  var sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);
  if(sh.getMaxColumns()<ORA_STABLE_ORDER_HEADERS.length)sh.insertColumnsAfter(sh.getMaxColumns(),ORA_STABLE_ORDER_HEADERS.length-sh.getMaxColumns());
  var current=sh.getLastRow()>=1?sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getDisplayValues()[0]:[];
  for(var i=0;i<ORA_STABLE_ORDER_HEADERS.length;i++){
    if(current.indexOf(ORA_STABLE_ORDER_HEADERS[i])<0){var c=sh.getLastColumn()+1;if(sh.getMaxColumns()<c)sh.insertColumnAfter(sh.getMaxColumns());sh.getRange(1,c).setValue(ORA_STABLE_ORDER_HEADERS[i]);current.push(ORA_STABLE_ORDER_HEADERS[i]);}
  }
  if(sh.getLastRow()<1)sh.getRange(1,1,1,ORA_STABLE_ORDER_HEADERS.length).setValues([ORA_STABLE_ORDER_HEADERS]);
  sh.setFrozenRows(1);
  try{sh.getRange(1,1,1,sh.getLastColumn()).setFontWeight("bold");}catch(e){}
  return sh;
}
function oraStableHeaderMap_(sh){var a=sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getDisplayValues()[0],m={};for(var i=0;i<a.length;i++)m[String(a[i]||"").trim()]=i+1;return m;}
function oraStableEnsureCatalog_(ss){var sh=ss.getSheetByName("PRODUCT CATALOG");if(!sh)sh=ss.insertSheet("PRODUCT CATALOG");if(sh.getMaxColumns()<ORA_STABLE_CATALOG_HEADERS.length)sh.insertColumnsAfter(sh.getMaxColumns(),ORA_STABLE_CATALOG_HEADERS.length-sh.getMaxColumns());sh.getRange(1,1,1,ORA_STABLE_CATALOG_HEADERS.length).setValues([ORA_STABLE_CATALOG_HEADERS]).setFontWeight("bold");sh.setFrozenRows(1);try{sh.setColumnWidth(1,90);sh.setRowHeights(2,Math.max(1,sh.getMaxRows()-1),70);}catch(e){}return sh;}

function oraStableDirectValue_(src,h){
  if(src&&src[h]!==undefined&&src[h]!==null)return src[h];
  if(h==="Order ID")return oraStablePick_(src,["orderId","order_id","order_number","orderNo"]);
  if(h==="Customer Name")return oraStablePick_(src,["customerName","customer_name"]);
  if(h==="Phone Number")return oraStablePick_(src,["phoneNumber","phone_number","phone"]);
  if(h==="Address")return oraStablePick_(src,["address"]);
  if(h==="Item Name")return oraStablePick_(src,["itemName","item_name","product_name","name"]);
  if(h==="Item Code")return oraStablePick_(src,["itemCode","item_code","sku"]);
  if(h==="Qty")return oraStablePick_(src,["qty","quantity"]);
  if(h==="Unit Price (Rs)")return oraStablePick_(src,["unitPrice","unit_price","price"]);
  if(h==="Final Total (Rs)")return oraStablePick_(src,["finalTotal","final_total","total_amount","total"]);
  if(h==="Variant / Color")return oraStablePick_(src,["variantName","variant_name","variant","variantColor"]);
  if(h==="Discount (Rs)")return oraStablePick_(src,["discount","discount_amount","special_offer_discount"]);
  if(h==="Source")return oraStablePick_(src,["source","order_source"]);
  if(h==="Main Code")return oraStablePick_(src,["mainCode","main_code","main_sku","sku","Item Code"]);
  if(h==="Line Total (Rs)")return oraStablePick_(src,["lineTotal","line_total"]);
  if(h==="Normal Total (Rs)")return oraStablePick_(src,["normalTotal","normal_total","subtotal"]);
  if(h==="Delivery Fee (Rs)")return oraStablePick_(src,["deliveryFee","delivery_fee"]);
  if(h==="WhatsApp Number")return oraStablePick_(src,["whatsAppNumber","whatsapp_number","whatsapp","phone"]);
  if(h==="Order Time")return oraStablePick_(src,["orderTime","order_time","created_at"]);
  if(h==="Lead ID")return oraStablePick_(src,["leadId","lead_id","platform_lead_id"]);
  if(h==="Imported Status")return oraStablePick_(src,["importedStatus","imported_status","call_center_status"]);
  if(h==="City")return oraStablePick_(src,["city"]);
  if(h==="District")return oraStablePick_(src,["district"]);
  if(h==="Offer")return oraStablePick_(src,["offer","offer_label"]);
  return "";
}

function oraStableFlatten_(body){
  var out=[];
  if(body&&body.groups&&typeof body.groups==="object"){
    for(var g in body.groups)if(Object.prototype.hasOwnProperty.call(body.groups,g)&&Array.isArray(body.groups[g]))for(var i=0;i<body.groups[g].length;i++){var r=body.groups[g][i]||{};if(!r.Source&&!r.source)r.Source=g;out.push(r);}
  }
  var orders=[];
  if(Array.isArray(body&&body.orders))orders=body.orders;else if(body&&body.order)orders=[body.order];
  for(var n=0;n<orders.length;n++){
    var o=orders[n]||{},items=Array.isArray(o.items)&&o.items.length?o.items:[{}];
    for(var j=0;j<items.length;j++){
      var it=items[j]||{},first=j===0,qty=Math.max(1,oraStableNum_(oraStablePick_(it,["quantity","qty"])||1)),unit=oraStableNum_(oraStablePick_(it,["unit_price","unitPrice","price"]));
      out.push({
        "Order ID":oraStablePick_(o,["order_number","orderId","order_id","orderNo"]),"Customer Name":first?oraStablePick_(o,["customer_name","customerName"]):"","Phone Number":first?oraStablePick_(o,["phone","phone_number","phoneNumber"]):"","Address":first?oraStablePick_(o,["address"]):"",
        "Item Name":oraStablePick_(it,["product_name","itemName","item_name","name"]),"Item Code":oraStablePick_(it,["sku","itemCode","item_code"]),"Qty":qty,"Unit Price (Rs)":unit,"Final Total (Rs)":first?oraStablePick_(o,["total_amount","finalTotal","final_total","total"]):"",
        "Variant / Color":oraStablePick_(it,["variant_name","variant","variantName"]),"Item Action":"KEEP ITEM","Order Action":first?"PENDING":"","Offer":oraStablePick_(o,["offer","offer_label"]),"Discount (Rs)":first?oraStablePick_(o,["special_offer_discount","discount"]):"",
        "Source":oraStablePick_(o,["order_source","source"])||"Website","Main Code":oraStablePick_(it,["main_sku","mainCode","sku"]),"Line Total (Rs)":oraStablePick_(it,["subtotal","lineTotal","line_total"])||Math.round(qty*unit*100)/100,
        "Normal Total (Rs)":first?oraStablePick_(o,["subtotal","normalTotal","normal_total"]):"","Delivery Fee (Rs)":first?oraStablePick_(o,["delivery_fee","deliveryFee"]):"","WhatsApp Number":first?oraStablePick_(o,["whatsapp","whatsAppNumber","phone"]):"",
        "Order Time":first?oraStablePick_(o,["created_at","orderTime"]):"","Lead ID":first?oraStablePick_(o,["platform_lead_id","leadId"]):"","Imported Status":first?(oraStablePick_(o,["call_center_status","importedStatus"])||"Pending"):"","City":first?oraStablePick_(o,["city"]):"","District":first?oraStablePick_(o,["district"]):""
      });
    }
  }
  return out;
}

function oraStableDeleteExisting_(sh,ids){
  var hm=oraStableHeaderMap_(sh),idCol=hm["Order ID"];if(!idCol||sh.getLastRow()<2)return 0;
  var wanted={};for(var k in ids)if(Object.prototype.hasOwnProperty.call(ids,k))wanted[oraStableKey_(k)]=true;
  var vals=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues(),removed=0;
  for(var i=vals.length-1;i>=0;i--){if(wanted[oraStableKey_(vals[i][0])]){sh.deleteRow(i+2);removed++;}}
  return removed;
}

function oraStableSyncOrders_(body){
  var ss=oraStableSpreadsheet_(),flat=oraStableFlatten_(body);if(!flat.length)return {ok:false,status:"error",message:"No writable order rows in payload."};
  var bySheet={};
  for(var i=0;i<flat.length;i++){var src=flat[i]||{},id=String(oraStableDirectValue_(src,"Order ID")||"").trim();if(!id)continue;var sn=oraStableSheetName_(oraStableDirectValue_(src,"Source"));if(!bySheet[sn])bySheet[sn]=[];bySheet[sn].push(src);}
  var totalRows=0,syncedIds={};
  for(var sheetName in bySheet){if(!Object.prototype.hasOwnProperty.call(bySheet,sheetName))continue;var incoming=bySheet[sheetName],sh=oraStableEnsureOrderSheet_(ss,sheetName),hm=oraStableHeaderMap_(sh),lastCol=sh.getLastColumn(),ids={};
    for(var a=0;a<incoming.length;a++){var idA=String(oraStableDirectValue_(incoming[a],"Order ID")||"").trim();if(idA){ids[idA]=true;syncedIds[idA]=true;}}
    oraStableDeleteExisting_(sh,ids);
    var output=[],seen={};
    for(var r=0;r<incoming.length;r++){
      var srcRow=incoming[r]||{},oid=String(oraStableDirectValue_(srcRow,"Order ID")||"").trim();if(!oid)continue;var first=!seen[oid];seen[oid]=true;var row=new Array(lastCol).fill("");
      for(var h in hm){if(!Object.prototype.hasOwnProperty.call(hm,h))continue;var v=oraStableDirectValue_(srcRow,h);
        if(h==="Qty"&&!v)v=1;
        if(h==="Line Total (Rs)"&&!v)v=Math.round(Math.max(1,oraStableNum_(oraStableDirectValue_(srcRow,"Qty")||1))*oraStableNum_(oraStableDirectValue_(srcRow,"Unit Price (Rs)"))*100)/100;
        if(h==="Main Code"&&!v)v=oraStableDirectValue_(srcRow,"Item Code");
        if(h==="Item Action"&&!v)v="KEEP ITEM";
        if(h==="Order Action"&&!v&&first)v="PENDING";
        if(h==="Offer"&&!v)v="No Qty Offer";
        if(h==="Last Sync")v=new Date();
        if(h==="Original Main Code"&&!v)v=oraStableDirectValue_(srcRow,"Main Code")||oraStableDirectValue_(srcRow,"Item Code");
        if(h==="Original Variant / Color"&&!v)v=oraStableDirectValue_(srcRow,"Variant / Color");
        if(h==="Original Item Code"&&!v)v=oraStableDirectValue_(srcRow,"Item Code");
        if(h==="Original Item Name"&&!v)v=oraStableDirectValue_(srcRow,"Item Name");
        if(h==="Original Qty"&&!v)v=oraStableDirectValue_(srcRow,"Qty")||1;
        row[hm[h]-1]=v===undefined||v===null?"":v;
      }
      output.push(row);
    }
    if(output.length){var start=sh.getLastRow()+1;sh.getRange(start,1,output.length,lastCol).setValues(output);totalRows+=output.length;
      try{if(hm["Item Action"])sh.getRange(start,hm["Item Action"],output.length,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["KEEP ITEM","CANCEL ITEM"],true).setAllowInvalid(false).build());}catch(e){}
      try{if(hm["Order Action"])sh.getRange(start,hm["Order Action"],output.length,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["PENDING","CONFIRM ORDER","CANCEL ENTIRE ORDER"],true).setAllowInvalid(false).build());}catch(e){}
      try{if(hm["Apply Item Change"])sh.getRange(start,hm["Apply Item Change"],output.length,1).insertCheckboxes();}catch(e){}
    }
  }
  var synced=0;for(var z in syncedIds)if(Object.prototype.hasOwnProperty.call(syncedIds,z))synced++;
  if(!totalRows)return {ok:false,status:"error",message:"Payload arrived but no rows could be written."};
  SpreadsheetApp.flush();
  return {ok:true,status:"orders_synced",synced:synced,existing:0,rows:totalRows,version:ORA_VERSION};
}

function oraStableCatalogSync_(body){
  var ss=oraStableSpreadsheet_(),sh=oraStableEnsureCatalog_(ss),products=Array.isArray(body&&body.products)?body.products:[],rows=[],now=new Date();
  for(var i=0;i<products.length;i++){
    var p=products[i]||{},main=oraStableStr_(p.sku||p.main_sku),name=oraStableStr_(p.name_en||p.name),type=oraStableStr_(p.product_type||"normal"),baseImg=Array.isArray(p.images)&&p.images.length?oraStableStr_(p.images[0]):oraStableStr_(p.image||"");
    var variants=Array.isArray(p.variants)&&p.variants.length?p.variants:null;
    if(variants){for(var j=0;j<variants.length;j++){var x=variants[j]||{},variant=oraStableStr_(x.option_value||x.variant_name),code=oraStableStr_(x.sku||main),price=oraStableNum_(x.discount_enabled!==false&&oraStableNum_(x.discount_price)>0?x.discount_price:x.selling_price),stock=oraStableNum_(x.stock_quantity),status=oraStableStr_(x.status||p.status||"Active"),img=oraStableStr_(x.image||baseImg),formula=img?'=IFERROR(IMAGE("'+img.replace(/"/g,'""')+'",4,60,60),"")':"";rows.push([formula,main,code,name,variant,"Variant",price,stock,status,img,code+" | "+name+(variant?" | "+variant:""),now]);}}
    else{var price=oraStableNum_(p.discount_enabled!==false&&oraStableNum_(p.discount_price)>0?p.discount_price:p.selling_price),stock=oraStableNum_(p.stock_quantity),status=oraStableStr_(p.status||"Active"),formula=baseImg?'=IFERROR(IMAGE("'+baseImg.replace(/"/g,'""')+'",4,60,60),"")':"";rows.push([formula,main,main,name,"",type,price,stock,status,baseImg,main+" | "+name,now]);}
  }
  var lr=sh.getLastRow();if(lr>1)sh.getRange(2,1,lr-1,sh.getLastColumn()).clearContent();if(rows.length)sh.getRange(2,1,rows.length,ORA_STABLE_CATALOG_HEADERS.length).setValues(rows);SpreadsheetApp.flush();return {ok:true,status:"catalog_synced",rows:rows.length,version:ORA_VERSION};
}

function oraStableDeleteOrder_(body){var ss=oraStableSpreadsheet_(),id=String(oraStablePick_(body,["orderId","order_id","order_number","id"])||"").trim();if(!id)return {ok:false,status:"error",message:"Missing order ID"};var removed=0,ids={};ids[id]=true;for(var i=0;i<ORA_STABLE_ORDER_SHEETS.length;i++){var sh=ss.getSheetByName(ORA_STABLE_ORDER_SHEETS[i]);if(sh)removed+=oraStableDeleteExisting_(sh,ids);}SpreadsheetApp.flush();return {ok:true,status:"order_deleted",removed:removed,deleted:removed,orderId:id};}
function oraStableClear_(testsOnly){var ss=oraStableSpreadsheet_(),removed=0;for(var s=0;s<ORA_STABLE_ORDER_SHEETS.length;s++){var sh=ss.getSheetByName(ORA_STABLE_ORDER_SHEETS[s]);if(!sh||sh.getLastRow()<2)continue;if(!testsOnly){removed+=sh.getLastRow()-1;sh.deleteRows(2,sh.getLastRow()-1);continue;}var hm=oraStableHeaderMap_(sh),c=hm["Order ID"];if(!c)continue;var vals=sh.getRange(2,c,sh.getLastRow()-1,1).getDisplayValues();for(var r=vals.length-1;r>=0;r--){var k=oraStableKey_(vals[r][0]);if(k.indexOf("TEST-")===0||k.indexOf("WEB-TEST-")===0){sh.deleteRow(r+2);removed++;}}}SpreadsheetApp.flush();return {ok:true,status:testsOnly?"test_orders_cleared":"operational_cleared",removed:removed};}

function doGet(){return oraStableJson_({ok:true,status:"ok",service:"O-RA Google Sheet Sync",version:ORA_VERSION,timestamp:new Date().toISOString()});}
function doPost(e){
  try{
    var body=JSON.parse((e&&e.postData&&e.postData.contents)||"{}"),action=String(body.action||body.type||body.payload_type||"").trim();
    if(action==="sync_orders"||action==="orders_sync"||action==="order_sync"||action==="sync_order"||action==="order_batch_sync"||action==="orders_batch_sync")return oraStableJson_(oraStableSyncOrders_(body));
    if(action==="catalog_sync"||action==="sync_catalog"||action==="product_catalog_sync")return oraStableJson_(oraStableCatalogSync_(body));
    if(action==="order_delete"||action==="delete_order"||action==="delete_order_by_id")return oraStableJson_(oraStableDeleteOrder_(body));
    if(action==="operational_clear"||action==="clear_live_start_data"||action==="clear_orders")return oraStableJson_(oraStableClear_(false));
    if(action==="clear_test_orders"||action==="clear_test_data")return oraStableJson_(oraStableClear_(true));
    if(action==="health"||action==="ping")return oraStableJson_({ok:true,status:"ok",version:ORA_VERSION});
    return oraStableJson_({ok:false,status:"error",message:"Unknown action: "+action,version:ORA_VERSION});
  }catch(err){return oraStableJson_({ok:false,status:"error",message:String(err&&err.message?err.message:err),version:ORA_VERSION});}
}

function setupOraCallCenterSheet(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();if(!ss)throw new Error("Open the target Google Sheet before running setupOraCallCenterSheet.");
  PropertiesService.getScriptProperties().setProperty(ORA_STABLE_SHEET_ID_KEY,ss.getId());
  for(var i=0;i<ORA_STABLE_ORDER_SHEETS.length;i++)oraStableEnsureOrderSheet_(ss,ORA_STABLE_ORDER_SHEETS[i]);
  oraStableEnsureCatalog_(ss);
  if(!ss.getSheetByName("CITY LIST"))ss.insertSheet("CITY LIST");
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("O-RA V17 Stable ready - orders + catalog images use one direct engine.","O-RA",6);
}
`;
