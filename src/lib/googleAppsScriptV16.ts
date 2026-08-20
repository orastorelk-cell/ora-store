export const GOOGLE_APPS_SCRIPT_CODE_V16 = String.raw`// ============================================================
// O-RA STORE - GOOGLE SHEET SYNC V16.1
// Multi-item safe • update-safe • delete/clear safe
// Existing CITY LIST / order tabs are preserved.
// ============================================================

var ORA_VERSION = "O-RA Store Google Sheet Sync V16.1";
var ORA_ORDER_HEADERS = [
  "Order ID","Customer Name","Phone Number","Address","Item Name","Item Code","Qty","Unit Price (Rs)","Final Total (Rs)",
  "Variant / Color","Item Action","Order Action","Offer","Cancel Reason","Change Item To","Change Preview","Apply Item Change",
  "Discount (Rs)","Source","Main Code","Line Total (Rs)","Normal Total (Rs)","Delivery Fee (Rs)","WhatsApp Number",
  "Original Main Code","Original Variant / Color","Original Item Code","Original Item Name","Original Qty","Order Time","Lead ID",
  "Imported Status","Last Sync","City","District"
];
var ORA_CATALOG_HEADERS = ["Item Image","Main Code","Variant Code","Item Name","Variant / Color","Type","Selling Price (Rs)","Current Stock","Status","Image URL","Select Product / Variant","Last Updated"];
var ORA_ORDER_SHEETS = ["CALL CENTER ORDERS","FACEBOOK ORDERS","TIKTOK ORDERS"];
var ORA_DELETED_SHEET = "DELETED ORDERS";
var ORA_CITY_TAB = "CITY LIST";
var ORA_CATALOG_TAB = "PRODUCT CATALOG";

function oraJson_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function oraCol_(name){return ORA_ORDER_HEADERS.indexOf(name)+1;}
function oraNum_(v){var n=Number(String(v==null?"":v).replace(/[^0-9.-]/g,""));return isFinite(n)?n:0;}
function oraStr_(v){return v==null?"":String(v);}
function oraPick_(o,names){for(var i=0;i<names.length;i++){var v=o?o[names[i]]:undefined;if(v!==undefined&&v!==null&&String(v)!=="")return v;}return "";}
function oraKey_(v){return String(v||"").trim().toUpperCase();}
function oraSheetName_(source){var s=String(source||"").toLowerCase();if(s.indexOf("facebook")>=0)return "FACEBOOK ORDERS";if(s.indexOf("tiktok")>=0)return "TIKTOK ORDERS";return "CALL CENTER ORDERS";}

function oraEnsureOrderSheet_(ss,name){
  var sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);
  var lastCol=Math.max(1,sh.getLastColumn()),headers=sh.getLastRow()>=1?sh.getRange(1,1,1,lastCol).getDisplayValues()[0]:[];
  for(var i=0;i<ORA_ORDER_HEADERS.length;i++){
    if(headers.indexOf(ORA_ORDER_HEADERS[i])<0){var col=sh.getLastColumn()+1;if(sh.getMaxColumns()<col)sh.insertColumnAfter(sh.getMaxColumns());sh.getRange(1,col).setValue(ORA_ORDER_HEADERS[i]);headers.push(ORA_ORDER_HEADERS[i]);}
  }
  if(sh.getLastRow()<1)sh.getRange(1,1,1,ORA_ORDER_HEADERS.length).setValues([ORA_ORDER_HEADERS]);
  sh.setFrozenRows(1);sh.getRange(1,1,1,Math.max(ORA_ORDER_HEADERS.length,sh.getLastColumn())).setFontWeight("bold");
  return sh;
}
function oraHeaderMap_(sh){var last=Math.max(1,sh.getLastColumn()),vals=sh.getRange(1,1,1,last).getDisplayValues()[0],map={};for(var i=0;i<vals.length;i++)map[String(vals[i]||"")]=i+1;return map;}

function oraEnsureCatalog_(ss){
  var sh=ss.getSheetByName(ORA_CATALOG_TAB);if(!sh)sh=ss.insertSheet(ORA_CATALOG_TAB);
  if(sh.getMaxColumns()<ORA_CATALOG_HEADERS.length)sh.insertColumnsAfter(sh.getMaxColumns(),ORA_CATALOG_HEADERS.length-sh.getMaxColumns());
  sh.getRange(1,1,1,ORA_CATALOG_HEADERS.length).setValues([ORA_CATALOG_HEADERS]).setFontWeight("bold");sh.setFrozenRows(1);return sh;
}
function oraCatalogRows_(products){
  var rows=[],now=new Date();products=Array.isArray(products)?products:[];
  for(var i=0;i<products.length;i++){
    var p=products[i]||{},main=oraStr_(p.sku||p.main_sku),name=oraStr_(p.name_en||p.name),type=oraStr_(p.product_type||"normal"),img=Array.isArray(p.images)&&p.images.length?oraStr_(p.images[0]):"";
    var variants=Array.isArray(p.variants)&&p.variants.length?p.variants:null;
    if(variants){
      for(var v=0;v<variants.length;v++){var x=variants[v]||{},variant=oraStr_(x.option_value||x.variant_name),code=oraStr_(x.sku||main),price=oraNum_(x.discount_enabled!==false&&oraNum_(x.discount_price)>0?x.discount_price:x.selling_price),stock=oraNum_(x.stock_quantity),status=oraStr_(x.status||p.status||"Active"),image=oraStr_(x.image||img);rows.push([image,main,code,name,variant,"Variant",price,stock,status,image,code+" | "+name+(variant?" | "+variant:""),now]);}
    }else{
      var price=oraNum_(p.discount_enabled!==false&&oraNum_(p.discount_price)>0?p.discount_price:p.selling_price),stock=oraNum_(p.stock_quantity),status=oraStr_(p.status||"Active");rows.push([img,main,main,name,"",type,price,stock,status,img,main+" | "+name,now]);
    }
  }
  return rows;
}
function oraSyncCatalog_(ss,body){
  var sh=oraEnsureCatalog_(ss),rows=oraCatalogRows_(body.products||[]),lr=sh.getLastRow();if(lr>1)sh.getRange(2,1,lr-1,sh.getLastColumn()).clearContent();if(rows.length)sh.getRange(2,1,rows.length,ORA_CATALOG_HEADERS.length).setValues(rows);return {ok:true,status:"catalog_synced",rows:rows.length};
}

function oraNormalizeIncoming_(body){
  var flat=[];
  if(body&&body.groups){for(var g in body.groups){if(Array.isArray(body.groups[g]))flat=flat.concat(body.groups[g]);}}
  if(Array.isArray(body&&body.orders))flat=flat.concat(body.orders);else if(body&&body.order)flat.push(body.order);else if(Array.isArray(body&&body.order_rows))flat=flat.concat(body.order_rows);else if(body&&body.order_row)flat.push(body.order_row);
  var grouped={},keys=[];
  for(var i=0;i<flat.length;i++){
    var src=flat[i]||{},id=oraStr_(oraPick_(src,["Order ID","orderId","order_id","order_number","orderNo"])).trim();if(!id)continue;var key=oraKey_(id);
    if(!grouped[key]){grouped[key]={id:id,source:oraStr_(oraPick_(src,["Source","source","order_source"])||"Website"),customer:oraStr_(oraPick_(src,["Customer Name","customerName","customer_name"])),phone:oraStr_(oraPick_(src,["Phone Number","phoneNumber","phone_number","phone"])),whatsapp:oraStr_(oraPick_(src,["WhatsApp Number","whatsAppNumber","whatsapp_number","whatsapp","phone"])),address:oraStr_(oraPick_(src,["Address","address"])),city:oraStr_(oraPick_(src,["City","city"])),district:oraStr_(oraPick_(src,["District","district"])),finalTotal:oraNum_(oraPick_(src,["Final Total (Rs)","finalTotal","final_total","total_amount","total"])),discount:oraNum_(oraPick_(src,["Discount (Rs)","discount","discount_amount","special_offer_discount"])),normalTotal:oraNum_(oraPick_(src,["Normal Total (Rs)","normalTotal","normal_total","subtotal"])),delivery:oraNum_(oraPick_(src,["Delivery Fee (Rs)","deliveryFee","delivery_fee"])),offer:oraStr_(oraPick_(src,["Offer","offer","offer_label"])),orderTime:oraStr_(oraPick_(src,["Order Time","orderTime","order_time","created_at"])),leadId:oraStr_(oraPick_(src,["Lead ID","leadId","lead_id","platform_lead_id"])),importedStatus:oraStr_(oraPick_(src,["Imported Status","importedStatus","imported_status","call_center_status"])||"Pending"),items:[]};keys.push(key);}
    var o=grouped[key];
    if(!o.customer)o.customer=oraStr_(oraPick_(src,["Customer Name","customerName","customer_name"]));if(!o.phone)o.phone=oraStr_(oraPick_(src,["Phone Number","phoneNumber","phone_number","phone"]));if(!o.address)o.address=oraStr_(oraPick_(src,["Address","address"]));if(!o.city)o.city=oraStr_(oraPick_(src,["City","city"]));if(!o.district)o.district=oraStr_(oraPick_(src,["District","district"]));if(!o.finalTotal)o.finalTotal=oraNum_(oraPick_(src,["Final Total (Rs)","finalTotal","final_total","total_amount","total"]));if(!o.delivery)o.delivery=oraNum_(oraPick_(src,["Delivery Fee (Rs)","deliveryFee","delivery_fee"]));if(!o.discount)o.discount=oraNum_(oraPick_(src,["Discount (Rs)","discount","discount_amount","special_offer_discount"]));if(!o.normalTotal)o.normalTotal=oraNum_(oraPick_(src,["Normal Total (Rs)","normalTotal","normal_total","subtotal"]));if(!o.offer)o.offer=oraStr_(oraPick_(src,["Offer","offer","offer_label"]));
    var nested=Array.isArray(src.items)&&src.items.length?src.items:null,itemList=nested||[src];
    for(var j=0;j<itemList.length;j++){var it=itemList[j]||{},qty=Math.max(1,Math.round(oraNum_(oraPick_(it,["Qty","qty","quantity"])||1))),unit=oraNum_(oraPick_(it,["Unit Price (Rs)","unitPrice","unit_price","price"])),line=oraNum_(oraPick_(it,["Line Total (Rs)","lineTotal","line_total"]));if(!line)line=Math.round(qty*unit*100)/100;o.items.push({name:oraStr_(oraPick_(it,["Item Name","itemName","item_name","product_name","name"])),code:oraStr_(oraPick_(it,["Item Code","itemCode","item_code","sku"])),main:oraStr_(oraPick_(it,["Main Code","mainCode","main_code","main_sku","sku"])),variant:oraStr_(oraPick_(it,["Variant / Color","variantName","variant_name","variant","variantColor"])),qty:qty,unit:unit,line:line});}
  }
  var out=[];
  for(var k=0;k<keys.length;k++){var o=grouped[keys[k]],lineSum=0,qtySum=0;for(var x=0;x<o.items.length;x++){lineSum+=o.items[x].line;qtySum+=o.items[x].qty;}if(!o.normalTotal)o.normalTotal=Math.round(lineSum*100)/100;if(!o.discount&&o.finalTotal>0)o.discount=Math.round(Math.max(0,lineSum+o.delivery-o.finalTotal)*100)/100;if(!o.finalTotal)o.finalTotal=Math.round(Math.max(0,lineSum-o.discount+o.delivery)*100)/100;if(!o.offer)o.offer=o.discount>0?("Qty Offer Rs. "+o.discount+" ("+qtySum+" items)"):"No Qty Offer";out.push(o);}return out;
}

function oraCaptureActions_(sh,orderId){var out={orderAction:"PENDING",items:{}},lr=sh.getLastRow();if(lr<2)return out;var hm=oraHeaderMap_(sh),idCol=hm["Order ID"],itemCol=hm["Item Code"],varCol=hm["Variant / Color"],iaCol=hm["Item Action"],oaCol=hm["Order Action"];if(!idCol)return out;var vals=sh.getRange(2,1,lr-1,sh.getLastColumn()).getDisplayValues();for(var i=0;i<vals.length;i++){if(oraKey_(vals[i][idCol-1])!==oraKey_(orderId))continue;if(oaCol&&vals[i][oaCol-1])out.orderAction=vals[i][oaCol-1];var key=oraKey_((itemCol?vals[i][itemCol-1]:"")+"|"+(varCol?vals[i][varCol-1]:""));if(key&&iaCol&&vals[i][iaCol-1])out.items[key]=vals[i][iaCol-1];}return out;}
function oraDeleteRowsById_(sh,orderId,moveToDeleted){var lr=sh.getLastRow();if(lr<2)return 0;var hm=oraHeaderMap_(sh),idCol=hm["Order ID"];if(!idCol)return 0;var ids=sh.getRange(2,idCol,lr-1,1).getDisplayValues(),ss=sh.getParent(),deleted=null,moved=0;if(moveToDeleted){deleted=ss.getSheetByName(ORA_DELETED_SHEET)||ss.insertSheet(ORA_DELETED_SHEET);if(deleted.getLastRow()===0)deleted.getRange(1,1,1,sh.getLastColumn()).setValues([sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]]);}for(var i=ids.length-1;i>=0;i--){if(oraKey_(ids[i][0])!==oraKey_(orderId))continue;var row=i+2;if(deleted){var v=sh.getRange(row,1,1,sh.getLastColumn()).getValues();deleted.getRange(deleted.getLastRow()+1,1,1,v[0].length).setValues(v);}sh.deleteRow(row);moved++;}return moved;}

function oraApplyValidations_(ss,sh,start,count){
  if(!count)return;var hm=oraHeaderMap_(sh);
  try{if(hm["Item Action"])sh.getRange(start,hm["Item Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["KEEP ITEM","CANCEL ITEM"],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm["Order Action"])sh.getRange(start,hm["Order Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["PENDING","CONFIRM ORDER","CANCEL ENTIRE ORDER"],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm["Apply Item Change"])sh.getRange(start,hm["Apply Item Change"],count,1).insertCheckboxes();}catch(e){}
  try{var cat=ss.getSheetByName(ORA_CATALOG_TAB);if(cat&&cat.getLastRow()>1&&hm["Change Item To"])sh.getRange(start,hm["Change Item To"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange(2,11,cat.getLastRow()-1,1),true).setAllowInvalid(false).build());}catch(e){}
  try{var city=ss.getSheetByName(ORA_CITY_TAB);if(city&&city.getLastRow()>1&&hm["City"])sh.getRange(start,hm["City"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(city.getRange(2,1,city.getLastRow()-1,1),true).setAllowInvalid(true).build());}catch(e){}
}

function oraWriteOrder_(ss,o){
  var sh=oraEnsureOrderSheet_(ss,oraSheetName_(o.source)),actions=oraCaptureActions_(sh,o.id);oraDeleteRowsById_(sh,o.id,false);var hm=oraHeaderMap_(sh),rows=[];
  for(var i=0;i<o.items.length;i++){var it=o.items[i],first=i===0,row=[];for(var c=1;c<=sh.getLastColumn();c++)row.push("");function set(h,v){if(hm[h])row[hm[h]-1]=v;}var itemKey=oraKey_(it.code+"|"+it.variant);set("Order ID",o.id);set("Customer Name",first?o.customer:"");set("Phone Number",first?o.phone:"");set("Address",first?o.address:"");set("Item Name",it.name);set("Item Code",it.code);set("Qty",it.qty);set("Unit Price (Rs)",it.unit);set("Variant / Color",it.variant);set("Item Action",actions.items[itemKey]||"KEEP ITEM");set("Order Action",first?(actions.orderAction||"PENDING"):"");set("Offer",first?o.offer:"");set("Discount (Rs)",first?o.discount:"");set("Source",o.source);set("Main Code",it.main);set("Line Total (Rs)",it.line);set("Final Total (Rs)",first?o.finalTotal:"");set("Normal Total (Rs)",first?o.normalTotal:"");set("Delivery Fee (Rs)",first?o.delivery:"");set("WhatsApp Number",first?o.whatsapp:"");set("Original Main Code",it.main);set("Original Variant / Color",it.variant);set("Original Item Code",it.code);set("Original Item Name",it.name);set("Original Qty",it.qty);set("Order Time",first?o.orderTime:"");set("Lead ID",first?o.leadId:"");set("Imported Status",first?o.importedStatus:"");set("Last Sync",new Date());set("City",first?o.city:"");set("District",first?o.district:"");rows.push(row);}
  if(rows.length){var start=sh.getLastRow()+1;sh.getRange(start,1,rows.length,sh.getLastColumn()).setValues(rows);oraApplyValidations_(ss,sh,start,rows.length);}return rows.length;
}
function oraSync_(body){var ss=SpreadsheetApp.getActiveSpreadsheet(),orders=oraNormalizeIncoming_(body),rows=0;for(var i=0;i<orders.length;i++)rows+=oraWriteOrder_(ss,orders[i]);return {ok:true,status:"orders_synced",synced:orders.length,existing:0,rows:rows};}
function oraDeleteOrder_(body){var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();if(!id)return {ok:false,error:"Missing order ID"};var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0;for(var i=0;i<ORA_ORDER_SHEETS.length;i++){var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);if(sh)removed+=oraDeleteRowsById_(sh,id,true);}return {ok:true,status:"order_deleted",deleted:removed,removed:removed,orderId:id};}
function oraClearAll_(){var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0,names=ORA_ORDER_SHEETS.concat([ORA_DELETED_SHEET]);for(var i=0;i<names.length;i++){var sh=ss.getSheetByName(names[i]);if(!sh)continue;var lr=sh.getLastRow();if(lr>1){removed+=lr-1;sh.deleteRows(2,lr-1);}}return {ok:true,status:"operational_cleared",removed:removed};}
function oraClearTests_(){var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0;for(var s=0;s<ORA_ORDER_SHEETS.length;s++){var sh=ss.getSheetByName(ORA_ORDER_SHEETS[s]);if(!sh||sh.getLastRow()<2)continue;var hm=oraHeaderMap_(sh),idCol=hm["Order ID"];if(!idCol)continue;var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues();for(var i=ids.length-1;i>=0;i--){var id=oraKey_(ids[i][0]);if(id.indexOf("TEST-")===0||id.indexOf("WEB-TEST-")===0){sh.deleteRow(i+2);removed++;}}}return {ok:true,status:"test_orders_cleared",removed:removed};}
function oraCitySearch_(q){var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(ORA_CITY_TAB),out=[];if(!sh||sh.getLastRow()<2)return out;var query=String(q||"").trim().toLowerCase();if(query.length<2)return out;var vals=sh.getRange(2,1,sh.getLastRow()-1,Math.min(2,sh.getLastColumn())).getDisplayValues();for(var i=0;i<vals.length&&out.length<100;i++){var city=String(vals[i][0]||""),district=String(vals[i][1]||"");if(city.toLowerCase().indexOf(query)>=0)out.push({city:city,district:district});}return out;}

function oraOrderRows_(sh,orderId){var hm=oraHeaderMap_(sh),idCol=hm["Order ID"],out=[];if(!idCol||sh.getLastRow()<2)return out;var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues();for(var i=0;i<ids.length;i++)if(oraKey_(ids[i][0])===oraKey_(orderId))out.push(i+2);return out;}
function oraRecalcOrder_(sh,orderId){var rows=oraOrderRows_(sh,orderId);if(!rows.length)return;var hm=oraHeaderMap_(sh),sum=0;for(var i=0;i<rows.length;i++){var r=rows[i],qty=Math.max(1,oraNum_(sh.getRange(r,hm["Qty"]).getValue())),unit=oraNum_(sh.getRange(r,hm["Unit Price (Rs)"]).getValue()),act=oraStr_(sh.getRange(r,hm["Item Action"]).getDisplayValue());var line=Math.round(qty*unit*100)/100;sh.getRange(r,hm["Line Total (Rs)"]).setValue(line);if(oraKey_(act)!=="CANCEL ITEM")sum+=line;}var first=rows[0],discount=hm["Discount (Rs)"]?oraNum_(sh.getRange(first,hm["Discount (Rs)"]).getValue()):0,delivery=hm["Delivery Fee (Rs)"]?oraNum_(sh.getRange(first,hm["Delivery Fee (Rs)"]).getValue()):0;if(hm["Normal Total (Rs)"])sh.getRange(first,hm["Normal Total (Rs)"]).setValue(Math.round(sum*100)/100);if(hm["Final Total (Rs)"])sh.getRange(first,hm["Final Total (Rs)"]).setValue(Math.round(Math.max(0,sum-discount+delivery)*100)/100);}
function oraApplyCatalogSelection_(ss,sh,row){var hm=oraHeaderMap_(sh),sel=oraStr_(sh.getRange(row,hm["Change Item To"]).getDisplayValue()).trim(),cat=ss.getSheetByName(ORA_CATALOG_TAB);if(!sel||!cat||cat.getLastRow()<2)return;var vals=cat.getRange(2,1,cat.getLastRow()-1,ORA_CATALOG_HEADERS.length).getDisplayValues(),match=null;for(var i=0;i<vals.length;i++)if(oraStr_(vals[i][10]).trim()===sel){match=vals[i];break;}if(!match)return;var qty=Math.max(1,oraNum_(sh.getRange(row,hm["Qty"]).getValue()));if(hm["Main Code"])sh.getRange(row,hm["Main Code"]).setValue(match[1]);if(hm["Item Code"])sh.getRange(row,hm["Item Code"]).setValue(match[2]||match[1]);if(hm["Item Name"])sh.getRange(row,hm["Item Name"]).setValue(match[3]);if(hm["Variant / Color"])sh.getRange(row,hm["Variant / Color"]).setValue(match[4]);if(hm["Unit Price (Rs)"])sh.getRange(row,hm["Unit Price (Rs)"]).setValue(oraNum_(match[6]));if(hm["Line Total (Rs)"])sh.getRange(row,hm["Line Total (Rs)"]).setValue(Math.round(qty*oraNum_(match[6])*100)/100);if(hm["Apply Item Change"])sh.getRange(row,hm["Apply Item Change"]).setValue(false);if(hm["Change Preview"])sh.getRange(row,hm["Change Preview"]).setValue(oraStr_(match[3])+(match[4]?" • "+match[4]:""));}

function onEdit(e){
  try{var sh=e&&e.range?e.range.getSheet():null;if(!sh||ORA_ORDER_SHEETS.indexOf(sh.getName())<0||e.range.getRow()<2)return;var ss=sh.getParent(),hm=oraHeaderMap_(sh),row=e.range.getRow(),col=e.range.getColumn(),orderId=oraStr_(sh.getRange(row,hm["Order ID"]).getDisplayValue());if(!orderId)return;
    if(col===hm["Order Action"]){var rows=oraOrderRows_(sh,orderId),value=oraStr_(e.value||"");for(var i=0;i<rows.length;i++)sh.getRange(rows[i],hm["Order Action"]).setValue(i===0?(value||"PENDING"):"");}
    if(col===hm["Apply Item Change"]&&String(e.value||"").toUpperCase()==="TRUE")oraApplyCatalogSelection_(ss,sh,row);
    if(col===hm["Qty"]||col===hm["Item Action"]||col===hm["Apply Item Change"])oraRecalcOrder_(sh,orderId);
  }catch(err){console.log(err);}
}

function doGet(){return oraJson_({ok:true,status:"ok",service:"O-RA Google Sheet Sync",version:ORA_VERSION,timestamp:new Date().toISOString()});}
function doPost(e){
  try{if(!e||!e.postData||!e.postData.contents)return oraJson_({ok:false,error:"Missing POST body"});var body=JSON.parse(e.postData.contents),action=String(body.action||body.type||body.payload_type||"").trim();
    if(action==="orders_sync"||action==="order_batch_sync"||action==="orders_batch_sync"||action==="order_sync"||action==="sync_order"||action==="sync_orders")return oraJson_(oraSync_(body));
    if(action==="order_delete"||action==="delete_order"||action==="delete_order_by_id")return oraJson_(oraDeleteOrder_(body));
    if(action==="operational_clear"||action==="clear_live_start_data")return oraJson_(oraClearAll_());
    if(action==="clear_test_orders"||action==="clear_test_data")return oraJson_(oraClearTests_());
    if(action==="catalog_sync"||action==="sync_catalog"||action==="product_catalog_sync")return oraJson_(oraSyncCatalog_(SpreadsheetApp.getActiveSpreadsheet(),body));
    if(action==="city_search"||action==="search_city")return oraJson_({ok:true,status:"city_search",results:oraCitySearch_(body.query||body.q||body.city)});
    if(action==="health"||action==="ping")return oraJson_({ok:true,status:"ok",version:ORA_VERSION,timestamp:new Date().toISOString()});
    return oraJson_({ok:false,error:"Unknown action: "+action});
  }catch(err){return oraJson_({ok:false,error:String(err&&err.message?err.message:err)});}
}
function setupOraCallCenterSheet(){var ss=SpreadsheetApp.getActiveSpreadsheet();for(var i=0;i<ORA_ORDER_SHEETS.length;i++)oraEnsureOrderSheet_(ss,ORA_ORDER_SHEETS[i]);oraEnsureCatalog_(ss);SpreadsheetApp.getActive().toast("O-RA V16.1 setup complete. Existing order tabs and CITY LIST preserved.","O-RA",5);}
`;