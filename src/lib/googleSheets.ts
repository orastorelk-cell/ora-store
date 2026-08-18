import { Order, StoreSettings, Product, OrderSource } from '../types';
import { buildCatalogRows } from './productVariants';

export const GOOGLE_APPS_SCRIPT_CODE = String.raw`// ============================================================
// O-RA STORE - GOOGLE SHEET SYNC V14.9 FINAL
// High-volume sync: batch row writes + deferred UI styling to keep 50-500+ order imports responsive.
// Safe contract: Sheet edits do not change O-RA until CSV is uploaded back.
// ============================================================

var ORA_ORDER_HEADERS = [
  "Order ID","Customer Name","Phone Number","Address","Item Name","Item Code","Qty","Unit Price (Rs)","Final Total (Rs)","Variant / Color",
  "Item Action","Order Action","Offer","Cancel Reason","Change Item To","Change Preview","Apply Item Change",
  "Discount (Rs)","Source","Main Code","Line Total (Rs)","Normal Total (Rs)","Delivery Fee (Rs)","WhatsApp Number",
  "Original Main Code","Original Variant / Color","Original Item Code","Original Item Name","Original Qty","Order Time","Lead ID","Imported Status","Last Sync","City","District"
];
var ORA_CATALOG_HEADERS = [
  "Item Image","Main Code","Variant Code","Item Name","Variant / Color","Type","Selling Price (Rs)","Current Stock","Status","Image URL","Select Product / Variant","Last Updated"
];
var ORA_ORDER_SHEETS = ["CALL CENTER ORDERS","FACEBOOK ORDERS","TIKTOK ORDERS"];
var ORA_EDITABLE_HEADERS = ["Variant / Color","Qty","Item Action","Change Item To","Apply Item Change","Order Action","Cancel Reason"];
var ORA_UI_TEMPLATE_SHEET = "_ORA UI TEMPLATE";
var ORA_UI_QUEUE_KEY = "ORA_PENDING_UI_QUEUE_V127";
var ORA_UI_WORKER = "oraProcessPendingUiWorker";
var ORA_UI_WORKER_ROWS = 120;
var ORA_UI_IMMEDIATE_ROWS = 20;

function oraJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function oraHeaderCol_(name) { return ORA_ORDER_HEADERS.indexOf(name) + 1; }
function oraOrderSheetName_(source) {
  var s = String(source || "").toLowerCase();
  if (s.indexOf("facebook") >= 0) return "FACEBOOK ORDERS";
  if (s.indexOf("tiktok") >= 0) return "TIKTOK ORDERS";
  return "CALL CENTER ORDERS";
}
function oraSourceFromOrder_(orderNo) {
  var id = String(orderNo || "").toUpperCase();
  if (id.indexOf("FB-") === 0) return "Facebook Ads";
  if (id.indexOf("TK-") === 0) return "TikTok Ads";
  return "Website";
}
function oraSheetHasHeaders_(sheet, headers) {
  if (!sheet || sheet.getLastColumn() < headers.length || sheet.getLastRow() < 1) return false;
  var row = sheet.getRange(1,1,1,headers.length).getDisplayValues()[0];
  for (var i=0;i<headers.length;i++) if (String(row[i] || "") !== headers[i]) return false;
  return true;
}
function oraEnsureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (!oraSheetHasHeaders_(sh, headers)) {
    // Header order may change between O-RA versions. Preserve existing rows by
    // matching the OLD header names to the NEW header names instead of wiping data.
    var oldLastRow=sh.getLastRow(),oldLastCol=sh.getLastColumn(),oldHeaders=[],oldData=[];
    if(oldLastRow>=1&&oldLastCol>0){
      oldHeaders=sh.getRange(1,1,1,oldLastCol).getDisplayValues()[0];
      if(oldLastRow>1)oldData=sh.getRange(2,1,oldLastRow-1,oldLastCol).getValues();
    }
    var index={};for(var oi=0;oi<oldHeaders.length;oi++){var oh=String(oldHeaders[oi]||"").trim();if(oh)index[oh]=oi;}
    // IMPORTANT: old column validations can stay attached to cells even when the
    // header order changes. Clear them BEFORE migrated values are written, or a
    // value such as NO ANSWER / Offer can be rejected by the validation that
    // belonged to that column in the previous layout.
    if (sh.getMaxRows() > 1 && sh.getMaxColumns() > 0) {
      sh.getRange(2,1,sh.getMaxRows()-1,sh.getMaxColumns()).clearDataValidations();
    }
    sh.clear();
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    if(oldData.length&&Object.keys(index).length){
      var migrated=oldData.map(function(r){return headers.map(function(h){return typeof index[h]==="number"?r[index[h]]:"";});});
      sh.getRange(2,1,migrated.length,headers.length).setValues(migrated);
    }
  }
  return sh;
}
function oraEnsureCoreSheets_(ss) {
  for (var i=0;i<ORA_ORDER_SHEETS.length;i++) oraEnsureSheet_(ss, ORA_ORDER_SHEETS[i], ORA_ORDER_HEADERS);
  oraEnsureSheet_(ss, "PRODUCT CATALOG", ORA_CATALOG_HEADERS);
}
function oraFormatOrderSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(4);
  sheet.getRange(1,1,1,ORA_ORDER_HEADERS.length).setFontWeight("bold").setBackground("#111827").setFontColor("#ffffff").setWrap(true);
  var widths = {"Order ID":100,"Customer Name":130,"Phone Number":94,"Address":155,"Item Name":165,"Item Code":92,"Qty":46,"Unit Price (Rs)":86,"Final Total (Rs)":92,"Variant / Color":105,"Item Action":105,"Order Action":120,"Offer":90,"Cancel Reason":125,"Change Item To":155,"Change Preview":165,"Apply Item Change":86};
  Object.keys(widths).forEach(function(h){ sheet.setColumnWidth(oraHeaderCol_(h), widths[h]); });
  var rows = Math.max(1, sheet.getMaxRows()-1);
  sheet.getRange(2,oraHeaderCol_("Phone Number"),rows,1).setNumberFormat("@");
  sheet.getRange(2,oraHeaderCol_("WhatsApp Number"),rows,1).setNumberFormat("@");
  sheet.getRange(2,oraHeaderCol_("Lead ID"),rows,1).setNumberFormat("@");
  sheet.getRange(2,oraHeaderCol_("Qty"),rows,1).setNumberFormat("0");
  ["Unit Price (Rs)","Final Total (Rs)","Discount (Rs)","Line Total (Rs)","Normal Total (Rs)","Delivery Fee (Rs)"].forEach(function(h){ sheet.getRange(2,oraHeaderCol_(h),rows,1).setNumberFormat("#,##0.00"); });
  // Start with a clean data area. Controls are added ONLY to real order rows,
  // so blank rows never show confusing dropdowns/checkboxes.
  sheet.getRange(2,1,rows,ORA_ORDER_HEADERS.length).clearDataValidations();
  sheet.getRange(2,oraHeaderCol_("Qty"),rows,1).setBackground("#ecfeff");
  sheet.getRange(2,oraHeaderCol_("Variant / Color"),rows,1).setBackground("#f8fafc");
  sheet.getRange(2,oraHeaderCol_("Item Action"),rows,1).setBackground("#fff7ed");
  sheet.getRange(2,oraHeaderCol_("Order Action"),rows,1).setBackground("#ecfdf5");
  sheet.getRange(2,oraHeaderCol_("Cancel Reason"),rows,1).setBackground("#fff1f2");
  sheet.getRange(2,oraHeaderCol_("Change Item To"),rows,1).setBackground("#eff6ff");
  sheet.getRange(2,oraHeaderCol_("Change Preview"),rows,1).setBackground("#eff6ff");
  sheet.getRange(2,oraHeaderCol_("Apply Item Change"),rows,1).setBackground("#eff6ff");
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1,1,Math.max(2,sheet.getLastRow()),ORA_ORDER_HEADERS.length).createFilter();
  oraApplySimpleView_(sheet);
}
function oraFormatCatalogSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,ORA_CATALOG_HEADERS.length).setFontWeight("bold").setBackground("#111827").setFontColor("#ffffff").setWrap(true);
  var widths=[90,110,130,240,130,90,115,90,90,280,380,150];
  for(var i=0;i<widths.length;i++) sheet.setColumnWidth(i+1,widths[i]);
  var rows=Math.max(1,sheet.getMaxRows()-1);
  sheet.getRange(2,2,rows,2).setNumberFormat("@");
  sheet.getRange(2,7,rows,1).setNumberFormat("#,##0.00");
  sheet.getRange(2,8,rows,1).setNumberFormat("0");
  sheet.setRowHeights(2, Math.max(1,Math.min(rows,1000)), 64);
}
function oraApplySimpleView_(sheet) {
  try {
    sheet.showColumns(1,ORA_ORDER_HEADERS.length);
    if (ORA_ORDER_HEADERS.length > 17) sheet.hideColumns(18,ORA_ORDER_HEADERS.length-17);
  } catch(e) {}
}
function oraGuideSheet_(ss) {
  var sh=ss.getSheetByName("CALL CENTER GUIDE");
  if(!sh) sh=ss.insertSheet("CALL CENTER GUIDE",0);
  sh.clear();
  var rows=[
    ["O-RA CALL CENTER - EASY GUIDE",""],
    ["1","Customerට call කරලා Order එක verify කරන්න. එක Order එකේ Items කිහිපයක් තිබ්බොත් ඒ rows එකම bordered block එකක් ලෙස පේනවා."],
    ["2","Qty වෙනස් නම් Qty cell එකට 1-99 අතර whole number එක type කර Enter කරන්න. Final Total / Offer auto recalculate වෙනවා. Offer column එක protected AUTO field එකක් — edit කරන්න බැහැ."],
    ["3","Color / Variant තියෙන Item එකකට විතරක් VARIANT / COLOR dropdown එක පේනවා. Color එක මාරු කළාම Item Code + Unit Price + Final Total auto update වෙනවා."],
    ["4","එක Item එකක් අවශ්‍ය නැත්නම් ITEM ACTION → CANCEL ITEM. ඒ item amount එක Final Total එකෙන් auto අඩු වෙනවා. KEEP ITEM දැම්මොත් amount එක ආපහු auto එකතු වෙනවා."],
    ["5","සම්පූර්ණ Item එක වෙන product එකකට මාරු කරන්න නම් CHANGE ITEM TO dropdown එක පරණ විදිහටම use කරන්න. Products ගොඩක් නම් row එක select කර O-RA Call Center → Search / Change Product menu එකෙන් Item Code / Name search කරන්න. අවසානයේ APPLY ITEM CHANGE checkbox එක tick කරන්න."],
    ["6","Call එකට පිළිතුරක් නැත්නම් ORDER ACTION → NO ANSWER. ඒ Order එක follow-up සඳහා Sheet එකේම තබා ගන්න."],
    ["7","Order එක Confirm නම් ORDER ACTION → CONFIRM ORDER. මුළු Order එක Cancel නම් CANCEL ENTIRE ORDER."],
    ["8","Confirm/Cancel rows filter කර copy කර O-RA System → Confirm + Cancel Upload template එකට දාන්න. PENDING / NO ANSWER upload එකෙන් ignore වෙනවා."],
    ["IMPORTANT","ROW DELETE / ROW INSERT manually කරන්න එපා. Order delete/clear කිරීම O-RA System එකෙන් විතරක් කරන්න. Stock / FIFO / Invoice / Sheet sync ඒ flow එකෙන් safeව පවත්වාගෙන යනවා."],
    ["EDIT ACCESS","Call Center usersට edit කරන්න පුළුවන්: Qty, valid Variant / Color, Item Action, Order Action, Cancel Reason, Change Item To, Apply Item Change. Offer / Unit Price / Final Total / Item Code protected AUTO fields. Normal item එකකට Color/Variant change කරන්න බෑ."]
  ];
  sh.getRange(1,1,rows.length,2).setValues(rows).setWrap(true).setVerticalAlignment("top");
  sh.getRange(1,1,1,2).merge().setFontWeight("bold").setFontSize(16).setBackground("#111827").setFontColor("#ffffff");
  sh.getRange(rows.length-1,1,2,1).setFontWeight("bold").setBackground("#fff7ed");
  sh.setColumnWidth(1,115);sh.setColumnWidth(2,800);
  sh.setRowHeights(2,rows.length-1,50);
  return sh;
}

function oraRemoveOraProtections_(sheet) {
  var protections=sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for(var i=0;i<protections.length;i++){
    var d=String(protections[i].getDescription()||"");
    if(d.indexOf("O-RA ")===0 && protections[i].canEdit()) protections[i].remove();
  }
}
function oraLockSheet_(sheet, unprotectedRanges, description) {
  oraRemoveOraProtections_(sheet);
  var protection=sheet.protect().setDescription(description||"O-RA SAFE SHEET LOCK");
  protection.setWarningOnly(false);
  var me=Session.getEffectiveUser();
  try{protection.addEditor(me);}catch(e){}
  try{var editors=protection.getEditors();if(editors&&editors.length)protection.removeEditors(editors);}catch(e){}
  try{protection.addEditor(me);}catch(e){}
  try{if(protection.canDomainEdit())protection.setDomainEdit(false);}catch(e){}
  protection.setUnprotectedRanges(unprotectedRanges||[]);
  return protection;
}
function oraApplyProtections_(ss) {
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if(!sh) continue;
    var maxRows=Math.max(2,sh.getMaxRows());
    var editable=[];
    for(var j=0;j<ORA_EDITABLE_HEADERS.length;j++){
      var c=oraHeaderCol_(ORA_EDITABLE_HEADERS[j]);
      if(c>0) editable.push(sh.getRange(2,c,maxRows-1,1));
    }
    oraLockSheet_(sh,editable,"O-RA CALL CENTER SAFE LOCK - DO NOT DELETE/INSERT ROWS");
  }
  var catalog=ss.getSheetByName("PRODUCT CATALOG");
  if(catalog) oraLockSheet_(catalog,[],"O-RA PRODUCT CATALOG - VIEW ONLY");
  var guide=ss.getSheetByName("CALL CENTER GUIDE");
  if(guide) oraLockSheet_(guide,[],"O-RA CALL CENTER GUIDE - VIEW ONLY");
}
function reapplyOraProtections(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  oraApplyProtections_(ss);
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("O-RA sheet protections applied.","O-RA",4);
}
function oraInstallOwnerEditTrigger_(ss){
  var triggers=ScriptApp.getProjectTriggers();
  for(var i=0;i<triggers.length;i++){
    if(triggers[i].getHandlerFunction()==="oraOwnerEditTrigger") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("oraOwnerEditTrigger").forSpreadsheet(ss).onEdit().create();
}
function setupOraFreshSheet() {
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  // CLEAN RESET: delete only O-RA generated tabs and recreate them from scratch.
  // This permanently removes old dropdowns/validations/formats that can survive migrations.
  var tempName="_ORA_SETUP_TEMP_";
  var temp=ss.getSheetByName(tempName);if(!temp)temp=ss.insertSheet(tempName);
  var targets=ORA_ORDER_SHEETS.concat(["PRODUCT CATALOG","CALL CENTER GUIDE"]);
  for(var d=0;d<targets.length;d++){var old=ss.getSheetByName(targets[d]);if(old)ss.deleteSheet(old);}
  oraEnsureCoreSheets_(ss);
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);oraFormatOrderSheet_(sh);}
  oraFormatCatalogSheet_(ss.getSheetByName("PRODUCT CATALOG"));
  oraGuideSheet_(ss);
  oraApplyProtections_(ss);
  oraInstallOwnerEditTrigger_(ss);
  onOpen();
  var t=ss.getSheetByName(tempName);if(t&&ss.getSheets().length>1)ss.deleteSheet(t);
  ss.setActiveSheet(ss.getSheetByName("CALL CENTER ORDERS"));
  SpreadsheetApp.flush();
  return "O-RA clean fresh sheets recreated - V12.7 Performance Batch.";
}
// Backward-compatible menu/setup name used by older UI text.
function setupOraCallCenterSheet(){ return setupOraFreshSheet(); }

function onOpen() {
  SpreadsheetApp.getUi().createMenu("O-RA Call Center")
    .addItem("Simple Staff View","oraSimpleStaffView")
    .addItem("Show Technical Columns","oraShowTechnicalColumns")
    .addSeparator()
    .addItem("Show Pending Only","oraShowPendingOnly")
    .addItem("Show No Answer Only","oraShowNoAnswerOnly")
    .addItem("Show Pending + No Answer","oraShowPendingNoAnswer")
    .addItem("Show All Orders","oraShowAllOrders")
    .addSeparator()
    .addItem("Open Easy Guide","oraOpenGuide")
    .addItem("Search / Change Product","oraOpenProductSearchSidebar")
    .addItem("Reapply Sheet Protection","reapplyOraProtections")
    .addItem("Repair Action Dropdowns","repairOraActionDropdowns")
    .addItem("Apply Colored Chips + Black Text","captureOraCustomChipColors")
    .addItem("Clean Chip Borders","repairOraChipBorders")
    .addItem("Clean Blank/Ghost Rows + Borders","repairOraBlankOrderRows")
    .addItem("Setup Fresh O-RA Sheets","setupOraFreshSheet")
    .addToUi();
}
function oraSimpleStaffView(){var sh=SpreadsheetApp.getActiveSheet();if(ORA_ORDER_SHEETS.indexOf(sh.getName())<0){SpreadsheetApp.getActive().toast("Open an O-RA order sheet first.");return;}oraApplySimpleView_(sh);}
function oraShowTechnicalColumns(){var sh=SpreadsheetApp.getActiveSheet();if(ORA_ORDER_SHEETS.indexOf(sh.getName())<0)return;sh.showColumns(1,ORA_ORDER_HEADERS.length);}
function oraOpenGuide(){var ss=SpreadsheetApp.getActiveSpreadsheet();ss.setActiveSheet(oraGuideSheet_(ss));}
function oraOpenProductSearchSidebar(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getActiveSheet();
  if(ORA_ORDER_SHEETS.indexOf(sh.getName())<0){SpreadsheetApp.getActive().toast("Open CALL CENTER / FACEBOOK / TIKTOK ORDERS first.","O-RA",4);return;}
  var range=ss.getActiveRange(),row=range?range.getRow():0;
  if(row<2 || !String(sh.getRange(row,oraHeaderCol_("Order ID")).getDisplayValue()||"").trim()){
    SpreadsheetApp.getActive().toast("Select the order ITEM row you want to change first.","O-RA",5);return;
  }
  var sheetName=sh.getName();
  var html='<!doctype html><html><head><base target="_top"><style>'+
    'body{font-family:Arial,sans-serif;margin:0;padding:14px;background:#f8fafc;color:#111827}'+
    'h3{margin:0 0 4px;font-size:16px}p{font-size:11px;color:#64748b;line-height:1.45}'+
    'input{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #cbd5e1;border-radius:10px;font-size:13px;outline:none}'+
    '#results{margin-top:10px;display:flex;flex-direction:column;gap:7px;max-height:620px;overflow:auto}'+
    '.item{width:100%;text-align:left;border:1px solid #e2e8f0;border-radius:10px;background:white;padding:9px;cursor:pointer}'+
    '.item:hover{border-color:#f97316;background:#fff7ed}.code{font-weight:700;font-size:11px;color:#ea580c}.name{font-weight:700;font-size:12px;margin-top:2px}.meta{font-size:10px;color:#64748b;margin-top:2px}'+
    '#msg{margin-top:9px;font-size:11px;font-weight:700;color:#0369a1}</style></head><body>'+
    '<h3>Search / Change Product</h3><p>Selected row: <b>'+row+'</b> • '+sheetName+'<br>Search Item Code, Product Name or Variant. The existing Change Item dropdown and Apply checkbox logic stays unchanged.</p>'+
    '<input id="q" autofocus placeholder="Type S0004, headphones, purple..." oninput="queueSearch()">'+
    '<div id="msg"></div><div id="results"></div><script>'+
    'var timer=null;var sheetName='+JSON.stringify(sheetName)+';var row='+row+';'+
    'function esc(v){return String(v||"").replace(/[&<>\"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;"}[c]||c;});}'+
    'function queueSearch(){clearTimeout(timer);timer=setTimeout(runSearch,180);}'+
    'function runSearch(){var q=document.getElementById("q").value;document.getElementById("msg").textContent="Searching...";google.script.run.withSuccessHandler(render).withFailureHandler(fail).oraSearchProductsForSidebar(q);}'+
    'function render(rows){var box=document.getElementById("results");box.innerHTML="";document.getElementById("msg").textContent=rows.length?rows.length+" result(s)":"No matching product";rows.forEach(function(r){var b=document.createElement("button");b.className="item";b.innerHTML="<div class=code>"+esc(r.code)+"</div><div class=name>"+esc(r.name)+(r.variant?" - "+esc(r.variant):"")+"</div><div class=meta>Rs. "+esc(r.price)+" • "+esc(r.type)+"</div>";b.onclick=function(){choose(r.label);};box.appendChild(b);});}'+
    'function choose(label){document.getElementById("msg").textContent="Setting Change Item...";google.script.run.withSuccessHandler(function(r){document.getElementById("msg").textContent=r&&r.ok?"Selected. Check Change Preview, then tick Apply Item Change.":"Could not select product.";}).withFailureHandler(fail).oraSetChangeProductFromSidebar(sheetName,row,label);}'+
    'function fail(e){document.getElementById("msg").textContent=(e&&e.message)||"Search failed";}runSearch();'+
    '</script></body></html>';
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutput(html).setTitle("O-RA Product Search"));
}
function oraSearchProductsForSidebar(query){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),rows=oraCatalogRows_(ss),q=String(query||"").trim().toLowerCase(),out=[];
  for(var i=0;i<rows.length;i++){
    var r=rows[i],hay=[r.main,r.variantSku,r.name,r.variant,r.type,r.selectLabel].join(" ").toLowerCase();
    if(q && hay.indexOf(q)<0)continue;
    if(!r.selectLabel)continue;
    out.push({label:r.selectLabel,code:r.variantSku||r.main,name:r.name,variant:r.variant,type:r.type,price:Number(r.price||0).toLocaleString()});
    if(out.length>=60)break;
  }
  return out;
}
function oraSetChangeProductFromSidebar(sheetName,row,label){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(String(sheetName||"")),r=Number(row||0);
  if(!sh || ORA_ORDER_SHEETS.indexOf(sh.getName())<0 || r<2)throw new Error("Order row is no longer available.");
  if(!String(sh.getRange(r,oraHeaderCol_("Order ID")).getDisplayValue()||"").trim())throw new Error("Selected row has no Order ID.");
  var item=oraCatalogFromLabel_(ss,label);if(!item)throw new Error("Product is no longer in PRODUCT CATALOG.");
  sh.getRange(r,oraHeaderCol_("Change Item To")).setValue(label);
  oraPreviewProductChange_(ss,sh,r);
  SpreadsheetApp.flush();
  return {ok:true};
}
function oraShowPendingOnly(){var sh=SpreadsheetApp.getActiveSheet();if(ORA_ORDER_SHEETS.indexOf(sh.getName())<0)return;if(!sh.getFilter())sh.getRange(1,1,Math.max(2,sh.getLastRow()),ORA_ORDER_HEADERS.length).createFilter();sh.getFilter().setColumnFilterCriteria(oraHeaderCol_("Order Action"),SpreadsheetApp.newFilterCriteria().whenTextEqualTo("PENDING").build());}
function oraShowNoAnswerOnly(){var sh=SpreadsheetApp.getActiveSheet();if(ORA_ORDER_SHEETS.indexOf(sh.getName())<0)return;if(!sh.getFilter())sh.getRange(1,1,Math.max(2,sh.getLastRow()),ORA_ORDER_HEADERS.length).createFilter();sh.getFilter().setColumnFilterCriteria(oraHeaderCol_("Order Action"),SpreadsheetApp.newFilterCriteria().whenTextEqualTo("NO ANSWER").build());}
function oraShowPendingNoAnswer(){var sh=SpreadsheetApp.getActiveSheet();if(ORA_ORDER_SHEETS.indexOf(sh.getName())<0)return;if(!sh.getFilter())sh.getRange(1,1,Math.max(2,sh.getLastRow()),ORA_ORDER_HEADERS.length).createFilter();sh.getFilter().setColumnFilterCriteria(oraHeaderCol_("Order Action"),SpreadsheetApp.newFilterCriteria().setHiddenValues(["CONFIRM ORDER","CANCEL ENTIRE ORDER"]).build());}
function oraShowAllOrders(){var sh=SpreadsheetApp.getActiveSheet();if(ORA_ORDER_SHEETS.indexOf(sh.getName())<0)return;if(sh.getFilter())sh.getFilter().removeColumnFilterCriteria(oraHeaderCol_("Order Action"));}

function oraCatalogRows_(ss) {
  var sh=oraEnsureSheet_(ss,"PRODUCT CATALOG",ORA_CATALOG_HEADERS),last=sh.getLastRow();
  if(last<2)return[];
  return sh.getRange(2,1,last-1,ORA_CATALOG_HEADERS.length).getDisplayValues().map(function(r){return{main:String(r[1]||"").trim().toUpperCase(),variantSku:String(r[2]||"").trim().toUpperCase(),name:String(r[3]||""),variant:String(r[4]||""),type:String(r[5]||""),price:Number(String(r[6]||"0").replace(/,/g,""))||0,stock:Number(String(r[7]||"0").replace(/,/g,""))||0,status:String(r[8]||""),image:String(r[9]||""),selectLabel:String(r[10]||"")};});
}
function oraCatalogFromLabel_(ss,label){var key=String(label||"").trim();if(!key)return null;var rows=oraCatalogRows_(ss);for(var i=0;i<rows.length;i++)if(rows[i].selectLabel===key)return rows[i];return null;}
function oraLastOrderRow_(sheet){
  var max=Math.max(1,sheet.getMaxRows());
  var row=sheet.getRange(max,oraHeaderCol_("Order ID")).getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
  return Math.max(1,row);
}
function oraOrderRows_(sheet,orderNo){var last=oraLastOrderRow_(sheet);if(last<2)return[];var vals=sheet.getRange(2,1,last-1,1).getDisplayValues(),key=String(orderNo||"").trim().toUpperCase(),rows=[];for(var i=0;i<vals.length;i++)if(String(vals[i][0]||"").trim().toUpperCase()===key)rows.push(i+2);return rows;}
function oraCleanBlankOrderRows_(sheet,startRow,endRow){
  if(!sheet || ORA_ORDER_SHEETS.indexOf(sheet.getName())<0)return 0;
  var maxRows=sheet.getMaxRows();
  if(maxRows<2)return 0;
  var start=Math.max(2,Number(startRow||2));
  var end=Math.min(maxRows,Number(endRow||maxRows));
  if(end<start)return 0;
  var count=end-start+1,idCol=oraHeaderCol_("Order ID"),ids=sheet.getRange(start,idCol,count,1).getDisplayValues();
  var cleaned=0,runStart=-1;
  function clearRun_(from,to){
    if(from<0||to<from)return;
    var rng=sheet.getRange(from,1,to-from+1,Math.max(ORA_ORDER_HEADERS.length,sheet.getLastColumn()));
    // Blank order rows must be visually and logically empty. Keep column formatting,
    // but remove ghost values, dropdowns, checkboxes, notes and other validations.
    rng.clearContent();
    rng.clearDataValidations();
    try{rng.clearNote();}catch(noteErr){}
    // Remove any order-block border that was left behind when a row was
    // deleted/shifted upward. This touches borders only, so the intentional
    // per-column background colors remain. New real/test orders get their
    // order-group border back from oraStyleOrderGroup_().
    try{rng.setBorder(false,false,false,false,false,false);}catch(borderErr){}
  }
  for(var i=0;i<ids.length;i++){
    var blank=!String(ids[i][0]||"").trim();
    if(blank){
      cleaned++;
      if(runStart<0)runStart=start+i;
    }else if(runStart>=0){
      clearRun_(runStart,start+i-1);
      runStart=-1;
    }
  }
  if(runStart>=0)clearRun_(runStart,end);
  return cleaned;
}
function repairOraBlankOrderRows(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),total=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if(sh)total+=oraCleanBlankOrderRows_(sh,2,sh.getMaxRows());
  }
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("Blank/ghost order rows cleaned. Future new orders will recreate their own controls automatically.","O-RA",6);
  return total;
}
function oraDeleteOrder_(ss,orderNo,source){
var sh=oraEnsureSheet_(ss,oraOrderSheetName_(source||oraSourceFromOrder_(orderNo)),ORA_ORDER_HEADERS),rows=oraOrderRows_(sh,orderNo);
if(!rows.length)return 0;
for(var i=0;i<rows.length;i++){
var r=rows[i];
sh.getRange(r,oraHeaderCol_("Order Action")).setValue("DELETED");
sh.getRange(r,oraHeaderCol_("Cancel Reason")).setValue("Order deleted from O-RA system");
sh.getRange(r,oraHeaderCol_("Last Sync")).setValue(new Date());
}
SpreadsheetApp.flush();
return rows.length;
}
function oraClearDataRows_(sheet){
  var maxRows=sheet.getMaxRows();
  if(maxRows<2)return;
  var width=Math.max(1,sheet.getLastColumn());
  var rng=sheet.getRange(2,1,maxRows-1,width);
  rng.clearContent();
  // On order sheets, a clear/reset must also remove ghost dropdowns/checkboxes.
  // New order rows get their controls back from oraApplyRowControls_ when synced.
  if(ORA_ORDER_SHEETS.indexOf(sheet.getName())>=0){
    rng.clearDataValidations();
    try{rng.clearNote();}catch(noteErr){}
    try{rng.setBorder(false,false,false,false,false,false);}catch(borderErr){}
  }
}

function oraDiscountRate_(qty){
  var cfg={enabled:true,tiers:[{min:2,max:3,rate:5},{min:4,max:5,rate:7.5},{min:6,max:10,rate:10}]};
  try{var raw=PropertiesService.getDocumentProperties().getProperty("ORA_PRICING");if(raw)cfg=JSON.parse(raw);}catch(e){}
  if(!cfg||cfg.enabled===false)return 0;
  for(var i=0;i<(cfg.tiers||[]).length;i++){var t=cfg.tiers[i];if(qty>=Number(t.min||0)&&qty<=Number(t.max||999999))return Math.max(0,Number(t.rate||0));}
  return 0;
}
function oraRecalcOrder_(sheet,orderNo){
  var rows=oraOrderRows_(sheet,orderNo);if(!rows.length)return;
  var subtotal=0,totalQty=0,delivery=0;
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    var cancelled=String(sheet.getRange(r,oraHeaderCol_("Item Action")).getDisplayValue()||"").toLowerCase().indexOf("cancel")>=0;
    var qty=Math.max(1,Number(sheet.getRange(r,oraHeaderCol_("Qty")).getValue()||1));
    var unit=Math.max(0,Number(sheet.getRange(r,oraHeaderCol_("Unit Price (Rs)")).getValue()||0));
    if(i===0) delivery=Math.max(0,Number(sheet.getRange(r,oraHeaderCol_("Delivery Fee (Rs)")).getValue()||0));
    var line=cancelled?0:Math.round(qty*unit*100)/100;
    sheet.getRange(r,oraHeaderCol_("Line Total (Rs)")).setValue(line);
    if(!cancelled){subtotal+=line;totalQty+=qty;}
  }
  var rate=oraDiscountRate_(totalQty),discount=Math.round(subtotal*rate)/100,finalTotal=Math.round(Math.max(0,subtotal-discount+delivery)*100)/100,offer=rate>0?("Qty Offer "+rate+"% ("+totalQty+" items)"):"No Qty Offer";
  for(var j=0;j<rows.length;j++){
    var rr=rows[j];
    sheet.getRange(rr,oraHeaderCol_("Normal Total (Rs)")).setValue(subtotal);
    sheet.getRange(rr,oraHeaderCol_("Offer")).setValue(offer);
    sheet.getRange(rr,oraHeaderCol_("Discount (Rs)")).setValue(discount);
    sheet.getRange(rr,oraHeaderCol_("Delivery Fee (Rs)")).setValue(delivery);
    sheet.getRange(rr,oraHeaderCol_("Final Total (Rs)")).setValue(finalTotal);
  }
}
function oraStyleOrderGroup_(sheet,rows,orderNo){
  if(!rows||!rows.length)return;
  var first=rows[0],count=rows.length,visible=Math.min(17,ORA_ORDER_HEADERS.length);
  // Give each order a clear visual block without merging cells (merge breaks filters/CSV).
  var sum=0,id=String(orderNo||"");for(var i=0;i<id.length;i++)sum+=id.charCodeAt(i);
  var shade=(sum%2===0)?"#f8fafc":"#ffffff";
  sheet.getRange(first,1,count,Math.min(9,visible)).setBackground(shade);
  var block=sheet.getRange(first,1,count,visible);
  // One outer border call is much faster than drawing every internal row line.
  // The alternating order shade + outer border still makes multi-item orders clear.
  block.setBorder(true,true,true,true,false,false,"#64748b",SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange(first,oraHeaderCol_("Order ID"),1,1).setFontWeight("bold");
}
function oraCompactCustomerRows_(sheet,rows){
  if(!rows||rows.length<2)return;
  for(var i=1;i<rows.length;i++){
    sheet.getRange(rows[i],oraHeaderCol_("Customer Name")).clearContent();
    sheet.getRange(rows[i],oraHeaderCol_("Phone Number")).clearContent();
    sheet.getRange(rows[i],oraHeaderCol_("Address")).clearContent();
  }
}
function oraRefreshExistingOrderRows_(ss,sheet){
  var last=oraLastOrderRow_(sheet);if(last<2)return;
  var ids=sheet.getRange(2,oraHeaderCol_("Order ID"),last-1,1).getDisplayValues(),groups={},order=[];
  for(var i=0;i<ids.length;i++){var id=String(ids[i][0]||"").trim();if(!id)continue;if(!groups[id]){groups[id]=[];order.push(id);}groups[id].push(i+2);}
  for(var g=0;g<order.length;g++){var key=order[g],rows=groups[key];for(var j=0;j<rows.length;j++)oraApplyRowControls_(ss,sheet,rows[j]);oraCompactCustomerRows_(sheet,rows);oraStyleOrderGroup_(sheet,rows,key);}
  oraSetChangeValidation_(ss,sheet,2,last-1);
  oraForceActionDropdownsForSheet_(sheet);
}
function oraSetVariantValidation_(ss,sheet,row){
  var main=String(sheet.getRange(row,oraHeaderCol_("Main Code")).getDisplayValue()||"").trim().toUpperCase();
  var rows=oraCatalogRows_(ss),seen={},values=[];
  for(var i=0;i<rows.length;i++)if(rows[i].main===main&&rows[i].variant){var k=rows[i].variant.toLowerCase();if(!seen[k]){seen[k]=true;values.push(rows[i].variant);}}
  var cell=sheet.getRange(row,oraHeaderCol_("Variant / Color"));cell.clearDataValidations().clearNote();
  if(values.length){
    cell.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values,true).setAllowInvalid(false).build()).setBackground("#eef2ff").setNote("This item has selectable variants/colors. Changing it auto-updates Item Code, Unit Price and Final Total.");
  }else{
    cell.setBackground("#f3f4f6").setNote("This item has no selectable color/variant.");
  }
  return values;
}
function oraSetChangeValidation_(ss,sheet,startRow,count){
  if(count<=0)return;
  var cat=oraEnsureSheet_(ss,"PRODUCT CATALOG",ORA_CATALOG_HEADERS),last=cat.getLastRow();
  var range=sheet.getRange(startRow,oraHeaderCol_("Change Item To"),count,1);range.clearDataValidations();
  if(last>1){var source=cat.getRange(2,11,last-1,1);range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(source,true).setAllowInvalid(false).build());}
}

function oraActionItemRule_(){
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(["KEEP ITEM","CANCEL ITEM"], true)
    .setAllowInvalid(false)
    .build();
}
function oraActionOrderRule_(){
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(["PENDING","NO ANSWER","CONFIRM ORDER","CANCEL ENTIRE ORDER"], true)
    .setAllowInvalid(false)
    .build();
}

// Google Apps Script cannot create per-option custom chip colors directly.
// The owner has already configured the desired colored-chip rules in
// CALL CENTER ORDERS row 2. We capture those exact validation rules once into
// a hidden master template, then clone them to every current/future order row.
// This preserves the owner's exact custom chip colors without touching values.
function oraGetUiTemplateSheet_(ss,createIfMissing){
  var sh=ss.getSheetByName(ORA_UI_TEMPLATE_SHEET);
  if(!sh && createIfMissing){
    sh=ss.insertSheet(ORA_UI_TEMPLATE_SHEET);
    sh.getRange("A1").setNote("Item Action dropdown template");
    sh.getRange("B1").setNote("Order Action colored-chip dropdown template");
    try{sh.hideSheet();}catch(err){}
  }
  return sh;
}
function oraSeedUiTemplatesFromCallCenter_(ss){
  var source=ss.getSheetByName("CALL CENTER ORDERS");
  if(!source)throw new Error("CALL CENTER ORDERS sheet not found");
  var template=oraGetUiTemplateSheet_(ss,true);
  // Row 2 is the owner's MASTER colored-chip row. One dropdown cell stores
  // the colors for every option in that dropdown rule.
  var itemSrc=source.getRange(2,oraHeaderCol_("Item Action"));
  var orderSrc=source.getRange(2,oraHeaderCol_("Order Action"));
  if(!itemSrc.getDataValidation())throw new Error("CALL CENTER ORDERS!K2 Item Action dropdown is missing.");
  if(!orderSrc.getDataValidation())throw new Error("CALL CENTER ORDERS!L2 Order Action dropdown is missing.");
  // IMPORTANT: use PASTE_NORMAL, not PASTE_DATA_VALIDATION. Google does not
  // expose per-option dropdown chip colors through Apps Script, but a normal
  // in-sheet copy preserves the full editor-created dropdown presentation.
  // This is what keeps CHIP mode + the owner's custom option colors.
  template.getRange("A1:B1").clear();
  itemSrc.copyTo(template.getRange("A1"),SpreadsheetApp.CopyPasteType.PASTE_NORMAL,false);
  orderSrc.copyTo(template.getRange("B1"),SpreadsheetApp.CopyPasteType.PASTE_NORMAL,false);
  try{template.hideSheet();}catch(err){}
  return template;
}
function oraApplyActionValidations_(ss,sheet,row){
  var template=oraGetUiTemplateSheet_(ss,false);
  var itemCell=sheet.getRange(row,oraHeaderCol_("Item Action"));
  var orderCell=sheet.getRange(row,oraHeaderCol_("Order Action"));
  var itemValue=itemCell.getValue(), orderValue=orderCell.getValue();

  // PASTE_NORMAL is required to carry Google Sheets' editor-created CHIP
  // presentation + per-option colors. But it also carries the source cell's
  // border/font/background. clearFormat() removes only that copied cell format
  // while leaving the copied data-validation rule (and its CHIP metadata) in place.
  if(template && template.getRange("A1").getDataValidation()){
    template.getRange("A1").copyTo(itemCell,SpreadsheetApp.CopyPasteType.PASTE_NORMAL,false);
    itemCell.clearFormat();
    itemCell.setValue(itemValue||"KEEP ITEM").setBackground("#fff7ed").setFontColor("#000000").setFontWeight("normal");
  }else{
    itemCell.setDataValidation(oraActionItemRule_()).setFontColor("#000000").setFontWeight("normal");
  }
  if(template && template.getRange("B1").getDataValidation()){
    template.getRange("B1").copyTo(orderCell,SpreadsheetApp.CopyPasteType.PASTE_NORMAL,false);
    orderCell.clearFormat();
    orderCell.setValue(orderValue||"PENDING").setBackground("#ecfdf5").setFontColor("#000000").setFontWeight("normal");
  }else{
    orderCell.setDataValidation(oraActionOrderRule_()).setFontColor("#000000").setFontWeight("normal");
  }
}
function oraStyleActionCell_(cell){
  // IMPORTANT: the dropdown CHIP owns the status color.
  // Keep the letters themselves black so CONFIRM/CANCEL/NO ANSWER colors
  // appear on the chip/pill only, never as colored text.
  if(!cell)return;
  cell.setFontColor("#000000").setFontWeight("normal");
}
function oraStyleActionRow_(sheet,row){
  oraStyleActionCell_(sheet.getRange(row,oraHeaderCol_("Item Action")));
  oraStyleActionCell_(sheet.getRange(row,oraHeaderCol_("Order Action")));
}
function captureOraCustomChipColors(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  // Capture the exact custom chip rules currently configured by the owner in
  // CALL CENTER ORDERS!K2:L2 BEFORE applying anything elsewhere.
  oraSeedUiTemplatesFromCallCenter_(ss);
  var total=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if(!sh)continue;
    var last=oraLastOrderRow_(sh);
    if(last<2)continue;
    var ids=sh.getRange(2,oraHeaderCol_("Order ID"),last-1,1).getDisplayValues();
    for(var r=0;r<ids.length;r++){
      if(!String(ids[r][0]||"").trim())continue;
      var row=r+2;
      oraApplyActionValidations_(ss,sh,row);
      oraStyleActionRow_(sh,row);
      total++;
    }
  }
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("Chip style/color MASTER saved and applied to "+total+" order rows.","O-RA",6);
  return total;
}
// Repair ONLY the accidental K/L border/style copying from V12.6.6.
// Uses the already-saved hidden MASTER chip template, preserves current values,
// then reapplies the intended order-group borders once per order block.
function repairOraChipBorders(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var template=oraGetUiTemplateSheet_(ss,false);
  if(!template || !template.getRange("A1").getDataValidation() || !template.getRange("B1").getDataValidation()){
    throw new Error("Chip MASTER template not found. Run saveOraChipTemplate once after K2/L2 are manually colored.");
  }
  var total=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if(!sh)continue;
    var last=oraLastOrderRow_(sh);
    if(last<2)continue;
    var ids=sh.getRange(2,oraHeaderCol_("Order ID"),last-1,1).getDisplayValues();
    var groups={}, order=[];
    for(var r=0;r<ids.length;r++){
      var id=String(ids[r][0]||"").trim();
      if(!id)continue;
      var row=r+2;
      oraApplyActionValidations_(ss,sh,row);
      oraStyleActionRow_(sh,row);
      if(!groups[id]){groups[id]=[];order.push(id);}
      groups[id].push(row);
      total++;
    }
    // After copied formatting is stripped, restore only O-RA's intended
    // order-block borders/grouping — no repeated template borders per row.
    for(var g=0;g<order.length;g++)oraStyleOrderGroup_(sh,groups[order[g]],order[g]);
  }
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("Chip colors preserved; accidental copied borders cleaned for "+total+" rows.","O-RA",6);
  return total;
}

// Backward-compatible menu/function names. They now use the MASTER colored chips.
function saveOraChipTemplate(){return captureOraCustomChipColors();}
function repairOraActionVisuals(){return captureOraCustomChipColors();}
function repairOraColoredActionChips(){return captureOraCustomChipColors();}
function oraForceActionDropdownsForSheet_(sheet){
  if(!sheet || ORA_ORDER_SHEETS.indexOf(sheet.getName())<0) return 0;
  var last=oraLastOrderRow_(sheet);
  if(last<2) return 0;
  var idCol=oraHeaderCol_("Order ID");
  var ids=sheet.getRange(2,idCol,last-1,1).getDisplayValues();
  var count=0, ss=sheet.getParent();
  for(var i=0;i<ids.length;i++){
    if(!String(ids[i][0]||"").trim()) continue;
    var row=i+2;
    oraApplyActionValidations_(ss,sheet,row);
    oraStyleActionRow_(sheet,row);
    count++;
  }
  return count;
}
function repairOraActionDropdowns(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(), total=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    total+=oraForceActionDropdownsForSheet_(ss.getSheetByName(ORA_ORDER_SHEETS[i]));
  }
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("Item Action / Order Action dropdowns repaired for "+total+" order rows.","O-RA",5);
  return total;
}

function oraApplyRowControls_(ss,sheet,row){
  var qtyCell=sheet.getRange(row,oraHeaderCol_("Qty")),qtyRef=qtyCell.getA1Notation();
  qtyCell.setDataValidation(SpreadsheetApp.newDataValidation().requireFormulaSatisfied("=AND(ISNUMBER("+qtyRef+"),"+qtyRef+"=INT("+qtyRef+"),"+qtyRef+">=1,"+qtyRef+"<=99)").setAllowInvalid(false).build()).setNote("Type a whole Qty from 1 to 99. Final Total and Offer update automatically.");
  oraApplyActionValidations_(ss,sheet,row);
  var applyCell=sheet.getRange(row,oraHeaderCol_("Apply Item Change"));
  applyCell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  if(applyCell.getValue()==="")applyCell.setValue(false);
  oraSetVariantValidation_(ss,sheet,row);
  oraSetChangeValidation_(ss,sheet,row,1);
}
function oraApplyItemFromCatalog_(sheet,row,item){
  sheet.getRange(row,oraHeaderCol_("Item Name")).setValue(item.name);
  sheet.getRange(row,oraHeaderCol_("Variant / Color")).setValue(item.variant||"");
  sheet.getRange(row,oraHeaderCol_("Unit Price (Rs)")).setValue(Number(item.price||0));
  sheet.getRange(row,oraHeaderCol_("Main Code")).setValue(item.main);
  sheet.getRange(row,oraHeaderCol_("Item Code")).setValue(item.variantSku||item.main);
}
function oraPreviewProductChange_(ss,sheet,row){var item=oraCatalogFromLabel_(ss,sheet.getRange(row,oraHeaderCol_("Change Item To")).getDisplayValue());var old=String(sheet.getRange(row,oraHeaderCol_("Item Name")).getDisplayValue()||"")+" ["+String(sheet.getRange(row,oraHeaderCol_("Item Code")).getDisplayValue()||"")+"]";var cell=sheet.getRange(row,oraHeaderCol_("Change Preview"));cell.setBackground("#ffffff").setFontColor("#111827").setFontWeight("normal").clearNote().setValue(item?(old+"  →  "+item.name+(item.variant?" - "+item.variant:"")+" ["+item.variantSku+"] @ Rs. "+Number(item.price||0).toLocaleString()):"");}
function oraApplyProductChange_(ss,sheet,row){var item=oraCatalogFromLabel_(ss,sheet.getRange(row,oraHeaderCol_("Change Item To")).getDisplayValue());var applyCell=sheet.getRange(row,oraHeaderCol_("Apply Item Change"));if(!item){applyCell.setValue(false);SpreadsheetApp.getActive().toast("Select a valid product before Apply Item Change.","O-RA Item Change",4);return;}var itemNameCell=sheet.getRange(row,oraHeaderCol_("Item Name")),previewCell=sheet.getRange(row,oraHeaderCol_("Change Preview"));var oldName=String(itemNameCell.getDisplayValue()||"").trim(),oldCode=String(sheet.getRange(row,oraHeaderCol_("Item Code")).getDisplayValue()||"").trim();oraApplyItemFromCatalog_(sheet,row,item);var newName=String(itemNameCell.getDisplayValue()||item.name||"").trim(),newCode=String(sheet.getRange(row,oraHeaderCol_("Item Code")).getDisplayValue()||item.variantSku||item.main||"").trim();sheet.getRange(row,oraHeaderCol_("Change Item To")).clearContent();applyCell.setValue(false);itemNameCell.setBackground("#fed7aa").setFontWeight("bold").setNote("ITEM CHANGED: "+oldName+(oldCode?" ["+oldCode+"]":"")+" → "+newName+(newCode?" ["+newCode+"]":""));previewCell.setValue("✓ ITEM CHANGED").setBackground("#dcfce7").setFontColor("#166534").setFontWeight("bold").setNote(oldName+(oldCode?" ["+oldCode+"]":"")+" → "+newName+(newCode?" ["+newCode+"]":""));oraSetVariantValidation_(ss,sheet,row);oraRecalcOrder_(sheet,sheet.getRange(row,oraHeaderCol_("Order ID")).getDisplayValue());SpreadsheetApp.getActive().toast("Item changed successfully: "+newName,"O-RA Item Change",4);}
function oraRefreshVariant_(ss,sheet,row,oldValue){
  var main=String(sheet.getRange(row,oraHeaderCol_("Main Code")).getDisplayValue()||"").trim().toUpperCase(),variant=String(sheet.getRange(row,oraHeaderCol_("Variant / Color")).getDisplayValue()||"").trim().toLowerCase(),all=oraCatalogRows_(ss),found=null,options=[];
  for(var i=0;i<all.length;i++)if(all[i].main===main&&all[i].variant){options.push(all[i]);if(String(all[i].variant||"").trim().toLowerCase()===variant)found=all[i];}
  if(!options.length){sheet.getRange(row,oraHeaderCol_("Variant / Color")).setValue(String(oldValue||sheet.getRange(row,oraHeaderCol_("Original Variant / Color")).getDisplayValue()||""));SpreadsheetApp.getActive().toast("This item has no selectable Color / Variant.","O-RA",4);return;}
  if(!found){sheet.getRange(row,oraHeaderCol_("Variant / Color")).setValue(String(oldValue||options[0].variant||""));oraSetVariantValidation_(ss,sheet,row);SpreadsheetApp.getActive().toast("Select a Color / Variant from the dropdown.","O-RA",4);return;}
  oraApplyItemFromCatalog_(sheet,row,found);
  oraSetVariantValidation_(ss,sheet,row);
  oraRecalcOrder_(sheet,sheet.getRange(row,oraHeaderCol_("Order ID")).getDisplayValue());
}
function oraRestoreLockedEdit_(e){if(!e||!e.range||e.range.getNumRows()!==1||e.range.getNumColumns()!==1)return false;var header=String(e.range.getSheet().getRange(1,e.range.getColumn()).getDisplayValue()||"");if(ORA_EDITABLE_HEADERS.indexOf(header)>=0)return false;if(typeof e.oldValue!=="undefined")e.range.setValue(e.oldValue);else e.range.clearContent();SpreadsheetApp.getActive().toast("Protected AUTO field. Edit only Qty, Color, Item Action, Change Item To, Apply Item Change, Order Action or Cancel Reason.","O-RA Safe Edit",5);return true;}
function oraValidateQtyEdit_(e){var n=Number(e&&e.value);if(Number.isFinite(n)&&n>=1&&n<=99&&Math.floor(n)===n)return true;if(typeof e.oldValue!=="undefined"&&String(e.oldValue)!=="")e.range.setValue(e.oldValue);else e.range.setValue(1);SpreadsheetApp.getActive().toast("Qty must be a whole number from 1 to 99.","O-RA Qty",4);return false;}
function oraOwnerEditTrigger(e){
  try{
    if(!e||!e.range)return;var sheet=e.range.getSheet();if(ORA_ORDER_SHEETS.indexOf(sheet.getName())<0)return;var row=e.range.getRow();if(row<2)return;if(oraRestoreLockedEdit_(e))return;
    var ss=sheet.getParent(),header=String(sheet.getRange(1,e.range.getColumn()).getDisplayValue()||""),orderNo=sheet.getRange(row,oraHeaderCol_("Order ID")).getDisplayValue();
    if(header==="Variant / Color")oraRefreshVariant_(ss,sheet,row,e.oldValue);
    if(header==="Change Item To")oraPreviewProductChange_(ss,sheet,row);
    if(header==="Apply Item Change"&&String(e.value||"").toUpperCase()==="TRUE")oraApplyProductChange_(ss,sheet,row);
    if(header==="Order Action"){var rows=oraOrderRows_(sheet,orderNo),vals=[];for(var i=0;i<rows.length;i++)vals.push([String(e.value||"PENDING")]);for(var j=0;j<rows.length;j++){var oc=sheet.getRange(rows[j],oraHeaderCol_("Order Action"));oc.setValue(vals[j][0]);oraStyleActionCell_(oc);}}
    if(header==="Item Action")oraStyleActionCell_(sheet.getRange(row,oraHeaderCol_("Item Action")));
    if(header==="Qty"&&!oraValidateQtyEdit_(e))return;
    if(["Qty","Item Action"].indexOf(header)>=0)oraRecalcOrder_(sheet,orderNo);
  }catch(err){console.log(err);}
}


// ============================================================
// V13 FINAL PERFORMANCE LAYER
// - Incoming orders are appended in one setValues() block per source sheet.
// - Basic controls are applied by range, not row-by-row.
// - Heavy per-row variant/custom-chip/border work runs in a small background
//   worker so the Web App response and open Google Sheet stay responsive.
// ============================================================
function oraSetVariantValidationCached_(sheet,row,catalogRows){
  var main=String(sheet.getRange(row,oraHeaderCol_("Main Code")).getDisplayValue()||"").trim().toUpperCase();
  var seen={},values=[];
  for(var i=0;i<(catalogRows||[]).length;i++){
    var c=catalogRows[i];
    if(c.main===main&&c.variant){
      var k=String(c.variant||"").toLowerCase();
      if(!seen[k]){seen[k]=true;values.push(c.variant);}
    }
  }
  var cell=sheet.getRange(row,oraHeaderCol_("Variant / Color"));
  cell.clearDataValidations().clearNote();
  if(values.length){
    cell.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values,true).setAllowInvalid(false).build())
      .setBackground("#eef2ff")
      .setNote("This item has selectable variants/colors. Changing it auto-updates Item Code, Unit Price and Final Total.");
  }else{
    cell.setBackground("#f3f4f6").setNote("This item has no selectable color/variant.");
  }
}
function oraApplyActionValidationRange_(ss,sheet,start,count){
  if(count<=0)return;
  var template=oraGetUiTemplateSheet_(ss,false);
  var itemRange=sheet.getRange(start,oraHeaderCol_("Item Action"),count,1);
  var orderRange=sheet.getRange(start,oraHeaderCol_("Order Action"),count,1);
  var itemValues=itemRange.getValues();
  var orderValues=orderRange.getValues();

  if(template && template.getRange("A1").getDataValidation()){
    template.getRange("A1").copyTo(itemRange,SpreadsheetApp.CopyPasteType.PASTE_NORMAL,false);
    itemRange.clearFormat();
    for(var i=0;i<itemValues.length;i++)if(!String(itemValues[i][0]||"").trim())itemValues[i][0]="KEEP ITEM";
    itemRange.setValues(itemValues).setBackground("#fff7ed").setFontColor("#000000").setFontWeight("normal");
  }else{
    itemRange.setDataValidation(oraActionItemRule_()).setFontColor("#000000").setFontWeight("normal");
  }

  if(template && template.getRange("B1").getDataValidation()){
    template.getRange("B1").copyTo(orderRange,SpreadsheetApp.CopyPasteType.PASTE_NORMAL,false);
    orderRange.clearFormat();
    for(var j=0;j<orderValues.length;j++)if(!String(orderValues[j][0]||"").trim())orderValues[j][0]="PENDING";
    orderRange.setValues(orderValues).setBackground("#ecfdf5").setFontColor("#000000").setFontWeight("normal");
  }else{
    orderRange.setDataValidation(oraActionOrderRule_()).setFontColor("#000000").setFontWeight("normal");
  }
}

function oraApplyFastBatchControls_(ss,sheet,start,count){
  if(count<=0)return;

  // Qty validation in one range operation.
  var qtyRule=SpreadsheetApp.newDataValidation().requireNumberBetween(1,99).setAllowInvalid(false)
    .setHelpText("Type a whole Qty from 1 to 99. Final Total and Offer update automatically.").build();
  sheet.getRange(start,oraHeaderCol_("Qty"),count,1)
    .setDataValidation(qtyRule)
    .setNote("Type a whole Qty from 1 to 99. Final Total and Offer update automatically.");

  // Owner-created colored CHIP rules copied to the full Item/Order Action ranges.
  oraApplyActionValidationRange_(ss,sheet,start,count);
  sheet.getRange(start,oraHeaderCol_("Apply Item Change"),count,1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  // Change Item dropdown - one shared range rule.
  var cat=oraEnsureSheet_(ss,"PRODUCT CATALOG",ORA_CATALOG_HEADERS),last=cat.getLastRow();
  var changeRange=sheet.getRange(start,oraHeaderCol_("Change Item To"),count,1);
  changeRange.clearDataValidations();
  if(last>1){
    changeRange.setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange(2,11,last-1,1),true).setAllowInvalid(false).build()
    );
  }

  // Variant/Color rules for every incoming row in ONE setDataValidations call.
  var catalogRows=oraCatalogRows_(ss),byMain={};
  for(var c=0;c<catalogRows.length;c++){
    var row=catalogRows[c],main=String(row.main||"").trim().toUpperCase(),variant=String(row.variant||"").trim();
    if(!main||!variant)continue;
    if(!byMain[main])byMain[main]=[];
    if(byMain[main].indexOf(variant)<0)byMain[main].push(variant);
  }
  var mains=sheet.getRange(start,oraHeaderCol_("Main Code"),count,1).getDisplayValues();
  var rules=[],notes=[];
  for(var i=0;i<count;i++){
    var values=byMain[String(mains[i][0]||"").trim().toUpperCase()]||[];
    rules.push([values.length?SpreadsheetApp.newDataValidation().requireValueInList(values,true).setAllowInvalid(false).build():null]);
    notes.push([values.length?"This item has selectable variants/colors. Changing it auto-updates Item Code, Unit Price and Final Total.":"This item has no selectable color/variant."]);
  }
  var variantRange=sheet.getRange(start,oraHeaderCol_("Variant / Color"),count,1);
  variantRange.setDataValidations(rules).setNotes(notes);

  // Fast visual grouping: alternating order blocks with one background matrix
  // instead of hundreds of per-row formatting calls.
  var ids=sheet.getRange(start,oraHeaderCol_("Order ID"),count,1).getDisplayValues();
  var left=[],right=[],weights=[],lastId="",shade="#ffffff",toggle=false;
  for(var r=0;r<count;r++){
    var id=String(ids[r][0]||"").trim();
    if(id!==lastId){toggle=!toggle;shade=toggle?"#f8fafc":"#ffffff";lastId=id;}
    left.push(new Array(10).fill(shade));
    right.push(new Array(5).fill(shade));
    weights.push([r===0||String(ids[r-1][0]||"").trim()!==id?"bold":"normal"]);
  }
  sheet.getRange(start,1,count,10).setBackgrounds(left);
  sheet.getRange(start,13,count,5).setBackgrounds(right);
  sheet.getRange(start,oraHeaderCol_("Order ID"),count,1).setFontWeights(weights);

  // Small website/test orders can afford the exact bordered-group styling now.
  // Large FB/TikTok batches intentionally skip per-order border loops to keep
  // 100-500+ order uploads responsive; alternating blocks still group them clearly.
  if(count<=20){
    var groups={},order=[];
    for(var g=0;g<count;g++){
      var key=String(ids[g][0]||"").trim();if(!key)continue;
      if(!groups[key]){groups[key]=[];order.push(key);}groups[key].push(start+g);
    }
    for(var z=0;z<order.length;z++)oraStyleOrderGroup_(sheet,groups[order[z]],order[z]);
  }
}
function oraDeleteUiWorkerTriggers_(){
  var triggers=ScriptApp.getProjectTriggers();
  for(var i=0;i<triggers.length;i++){
    if(triggers[i].getHandlerFunction()===ORA_UI_WORKER){
      try{ScriptApp.deleteTrigger(triggers[i]);}catch(e){}
    }
  }
}
function oraEnsureUiWorkerTrigger_(){
  var triggers=ScriptApp.getProjectTriggers();
  for(var i=0;i<triggers.length;i++) if(triggers[i].getHandlerFunction()===ORA_UI_WORKER) return;
  ScriptApp.newTrigger(ORA_UI_WORKER).timeBased().after(1000).create();
}
function oraQueueUiWork_(ss,sheetName,start,count){
  if(count<=0)return;
  var props=PropertiesService.getDocumentProperties(),queue=[];
  try{queue=JSON.parse(props.getProperty(ORA_UI_QUEUE_KEY)||"[]");}catch(e){queue=[];}
  var last=queue.length?queue[queue.length-1]:null;
  if(last&&last.sheet===sheetName&&Number(last.start)+Number(last.count)===Number(start)){
    last.count=Number(last.count)+Number(count);
  }else{
    queue.push({sheet:sheetName,start:Number(start),count:Number(count),tries:0});
  }
  if(queue.length>100)queue=queue.slice(queue.length-100);
  props.setProperty(ORA_UI_QUEUE_KEY,JSON.stringify(queue));
  oraEnsureUiWorkerTrigger_();
}
function oraApplyUiChunk_(ss,sheet,start,count){
  if(count<=0)return 0;
  var ids=sheet.getRange(start,oraHeaderCol_("Order ID"),count,1).getDisplayValues();
  var catalogRows=oraCatalogRows_(ss),groups={},order=[];
  var cat=oraEnsureSheet_(ss,"PRODUCT CATALOG",ORA_CATALOG_HEADERS),last=cat.getLastRow();
  var changeRange=sheet.getRange(start,oraHeaderCol_("Change Item To"),count,1);
  changeRange.clearDataValidations();
  if(last>1){
    changeRange.setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange(2,11,last-1,1),true).setAllowInvalid(false).build()
    );
  }
  var done=0;
  for(var i=0;i<ids.length;i++){
    var id=String(ids[i][0]||"").trim();
    if(!id)continue;
    var row=start+i;
    oraStyleActionRow_(sheet,row);
    oraSetVariantValidationCached_(sheet,row,catalogRows);
    if(!groups[id]){groups[id]=[];order.push(id);}
    groups[id].push(row);
    done++;
  }
  for(var g=0;g<order.length;g++)oraStyleOrderGroup_(sheet,groups[order[g]],order[g]);
  return done;
}
function oraProcessPendingUiWorker(){
  oraDeleteUiWorkerTriggers_();
  var lock=LockService.getDocumentLock();
  if(!lock.tryLock(5000)){oraEnsureUiWorkerTrigger_();return;}
  var queue=[],props=PropertiesService.getDocumentProperties(),needsMore=false,job=null;
  try{
    try{queue=JSON.parse(props.getProperty(ORA_UI_QUEUE_KEY)||"[]");}catch(e){queue=[];}
    if(!queue.length){props.deleteProperty(ORA_UI_QUEUE_KEY);return;}
    job=queue.shift();
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sheet=ss.getSheetByName(String(job.sheet||""));
    if(!sheet)throw new Error("UI worker sheet missing: "+job.sheet);
    var take=Math.min(Math.max(1,Number(job.count||0)),ORA_UI_WORKER_ROWS);
    oraApplyUiChunk_(ss,sheet,Number(job.start||2),take);
    if(Number(job.count||0)>take){
      queue.unshift({sheet:job.sheet,start:Number(job.start||2)+take,count:Number(job.count||0)-take,tries:0});
    }
    if(queue.length)props.setProperty(ORA_UI_QUEUE_KEY,JSON.stringify(queue));else props.deleteProperty(ORA_UI_QUEUE_KEY);
    needsMore=queue.length>0;
  }catch(err){
    try{
      if(job){
        job.tries=Number(job.tries||0)+1;
        if(job.tries<=3)queue.unshift(job);
      }
      if(queue.length)props.setProperty(ORA_UI_QUEUE_KEY,JSON.stringify(queue));else props.deleteProperty(ORA_UI_QUEUE_KEY);
      needsMore=queue.length>0;
    }catch(ignore){}
    console.log("O-RA UI worker: "+String(err&&err.message||err));
  }finally{
    try{lock.releaseLock();}catch(e){}
  }
  if(needsMore)oraEnsureUiWorkerTrigger_();
}
function oraBuildOrderRows_(data){
  var orderNo=String(data.order_id||data.order_number||"").trim();
  if(!orderNo)throw new Error("Order ID missing");
  var source=String(data.order_source||"Website");
  var items=Array.isArray(data.items)?data.items:[];
  if(!items.length)throw new Error("No order items for "+orderNo);
  var normal=Number(data.subtotal||0),discount=Number(data.special_offer_discount||0),delivery=Number(data.delivery_fee||0),
      finalTotal=Number(data.total_amount||0),offer=String(data.offer_label||""),out=[];
  for(var i=0;i<items.length;i++){
    var it=items[i]||{},qty=Math.max(1,Number(it.quantity||1)),unit=Number(it.unit_price||0),
        line=Math.round(qty*unit*100)/100,main=String(it.main_sku||it.sku||""),
        variant=String(it.variant_name||""),sku=String(it.sku||""),row={};
    row["Order ID"]=orderNo;
    row["Customer Name"]=i===0?String(data.customer_name||""):"";
    row["Phone Number"]=i===0?String(data.phone||""):"";
    row["Address"]=i===0?(String(data.address||"")+(data.city?", "+String(data.city):"")):"";
    row["City"]=i===0?(data.city||""):"";
    row["District"]=i===0?(data.district||""):"";
    row["Item Name"]=String(it.product_name||"");
    row["Variant / Color"]=variant;
    row["Qty"]=qty;
    row["Unit Price (Rs)"]=unit;
    row["Item Action"]="KEEP ITEM";
    row["Change Item To"]="";
    row["Change Preview"]="";
    row["Apply Item Change"]=false;
    row["Order Action"]="PENDING";
    row["Cancel Reason"]="";
    row["Final Total (Rs)"]=finalTotal;
    row["Offer"]=offer;
    row["Discount (Rs)"]=discount;
    row["Source"]=source;
    row["Main Code"]=main;
    row["Item Code"]=sku;
    row["Line Total (Rs)"]=line;
    row["Normal Total (Rs)"]=normal;
    row["Delivery Fee (Rs)"]=delivery;
    row["WhatsApp Number"]=String(data.whatsapp||data.phone||"");
    row["Original Main Code"]=main;
    row["Original Variant / Color"]=variant;
    row["Original Item Code"]=sku;
    row["Original Item Name"]=String(it.product_name||"");
    row["Original Qty"]=qty;
    row["Order Time"]=String(data.created_at||"");
    row["Lead ID"]=String(data.platform_lead_id||"");
    row["Imported Status"]=String(data.call_center_status||"Pending");
    row["Last Sync"]=new Date();
    out.push(ORA_ORDER_HEADERS.map(function(h){return typeof row[h]==="undefined"?"":row[h];}));
  }
  return out;
}
function oraSyncOrderBatch_(ss,orders){
  var incoming=Array.isArray(orders)?orders:[];
  if(!incoming.length)return {status:"orders_batch_synced",synced:0,existing:0,rows:0};
  var lock=LockService.getDocumentLock();
  lock.waitLock(15000);
  try{
    var bySheet={};
    for(var i=0;i<incoming.length;i++){
      var data=incoming[i]||{},orderNo=String(data.order_id||data.order_number||"").trim();
      if(!orderNo)continue;
      var sheetName=oraOrderSheetName_(data.order_source||oraSourceFromOrder_(orderNo));
      if(!bySheet[sheetName])bySheet[sheetName]=[];
      bySheet[sheetName].push(data);
    }
    var synced=0,existing=0,totalRows=0,sheets=[];
    var names=Object.keys(bySheet);
    for(var n=0;n<names.length;n++){
      var name=names[n],sheet=oraEnsureSheet_(ss,name,ORA_ORDER_HEADERS),last=oraLastOrderRow_(sheet),existingIds={};
      if(last>=2){
        var idVals=sheet.getRange(2,oraHeaderCol_("Order ID"),last-1,1).getDisplayValues();
        for(var x=0;x<idVals.length;x++){
          var exId=String(idVals[x][0]||"").trim().toUpperCase();
          if(exId)existingIds[exId]=true;
        }
      }
      var out=[],seen={};
      var list=bySheet[name];
      for(var j=0;j<list.length;j++){
        var d=list[j]||{},id=String(d.order_id||d.order_number||"").trim(),key=id.toUpperCase();
        if(!id||seen[key])continue;
        seen[key]=true;
        if(existingIds[key]){existing++;continue;}
        var rows=oraBuildOrderRows_(d);
        for(var r=0;r<rows.length;r++)out.push(rows[r]);
        existingIds[key]=true;
        synced++;
      }
      if(out.length){
        var start=last+1;
        sheet.getRange(start,1,out.length,ORA_ORDER_HEADERS.length).setValues(out);
        oraApplyFastBatchControls_(ss,sheet,start,out.length);
        // Rows, dropdowns, variant rules and fast grouping are committed together.
        // No second UI-hydration request is required.
        totalRows+=out.length;
        sheets.push({sheet:name,start:start,rows:out.length});
      }
    }
    return {status:"orders_batch_synced",synced:synced,existing:existing,rows:totalRows,sheets:sheets};
  }finally{
    try{lock.releaseLock();}catch(e){}
  }
}

function oraSyncCatalog_(ss,products,pricing){
  var sh=oraEnsureSheet_(ss,"PRODUCT CATALOG",ORA_CATALOG_HEADERS),last=sh.getLastRow();
  if(last>1)sh.getRange(2,1,last-1,ORA_CATALOG_HEADERS.length).clearContent();
  if(pricing)PropertiesService.getDocumentProperties().setProperty("ORA_PRICING",JSON.stringify(pricing));
  var rows=[];
  for(var i=0;i<(products||[]).length;i++){
    var p=products[i]||{},image=String(p.image||""),label=String(p.variant_sku||p.main_sku||"")+" | "+String(p.main_sku||"")+" | "+String(p.name||"")+(p.variant_name?" | "+String(p.variant_name):"");
    var rowNumber=i+2;
    rows.push([image?'=IFERROR(IMAGE(J'+rowNumber+',4,60,60),"")':"",String(p.main_sku||""),String(p.variant_sku||p.main_sku||""),String(p.name||""),String(p.variant_name||""),String(p.type||"Normal"),Number(p.unit_price||0),Number(p.stock_quantity||0),p.active===false?"Inactive":"Active",image,label,new Date()]);
  }
  if(rows.length){sh.getRange(2,1,rows.length,ORA_CATALOG_HEADERS.length).setValues(rows);sh.setRowHeights(2,rows.length,64);}
  // Product catalog updates used to re-style EVERY existing order row synchronously,
  // which could freeze an open Sheet. Refresh only the shared Change Item dropdown now;
  // per-row variant rules are refreshed by the lightweight background UI worker.
  for(var s=0;s<ORA_ORDER_SHEETS.length;s++){
    var os=oraEnsureSheet_(ss,ORA_ORDER_SHEETS[s],ORA_ORDER_HEADERS),lr=oraLastOrderRow_(os);
    if(lr>1){
      // One shared range rule is enough here. Existing action chips and row styling
      // are left untouched; new orders always receive the latest variant rules.
      oraSetChangeValidation_(ss,os,2,lr-1);
    }
  }
  SpreadsheetApp.flush();
  return rows.length;
}
function oraSyncOrder_(ss,data){
  var source=String(data.order_source||"Website"),sheet=oraEnsureSheet_(ss,oraOrderSheetName_(source),ORA_ORDER_HEADERS),orderNo=String(data.order_id||data.order_number||"").trim();
  if(!orderNo)throw new Error("Order ID missing");
  var existing=oraOrderRows_(sheet,orderNo);
  if(existing.length){
    for(var ex=0;ex<existing.length;ex++){
      var r=existing[ex];
      sheet.getRange(r,oraHeaderCol_("Normal Total (Rs)")).setValue(Number(data.subtotal||0));
      sheet.getRange(r,oraHeaderCol_("Offer")).setValue(String(data.offer_label||""));
      sheet.getRange(r,oraHeaderCol_("Discount (Rs)")).setValue(Number(data.special_offer_discount||0));
      sheet.getRange(r,oraHeaderCol_("Delivery Fee (Rs)")).setValue(Number(data.delivery_fee||0));
      sheet.getRange(r,oraHeaderCol_("Final Total (Rs)")).setValue(Number(data.total_amount||0));
      sheet.getRange(r,oraHeaderCol_("Imported Status")).setValue(String(data.call_center_status||"Pending"));
      sheet.getRange(r,oraHeaderCol_("Last Sync")).setValue(new Date());
    }
    for(var ec=0;ec<existing.length;ec++)oraApplyRowControls_(ss,sheet,existing[ec]);
    oraCompactCustomerRows_(sheet,existing);oraStyleOrderGroup_(sheet,existing,orderNo);oraForceActionDropdownsForSheet_(sheet);
    return {status:"order_existing_preserved",order_id:orderNo,sheet:sheet.getName(),rows:existing.length};
  }
  var items=Array.isArray(data.items)?data.items:[];if(!items.length)throw new Error("No order items");
  var normal=Number(data.subtotal||0),discount=Number(data.special_offer_discount||0),delivery=Number(data.delivery_fee||0),finalTotal=Number(data.total_amount||0),offer=String(data.offer_label||""),out=[];
  for(var i=0;i<items.length;i++){
    var it=items[i]||{},qty=Math.max(1,Number(it.quantity||1)),unit=Number(it.unit_price||0),line=Math.round(qty*unit*100)/100,main=String(it.main_sku||it.sku||""),variant=String(it.variant_name||""),sku=String(it.sku||""),row={};
    row["Order ID"]=orderNo;row["Customer Name"]=i===0?String(data.customer_name||""):"";row["Phone Number"]=i===0?String(data.phone||""):"";row["Address"]=i===0?(String(data.address||"")+(data.city?", "+String(data.city):"")):"";row["Item Name"]=String(it.product_name||"");row["Variant / Color"]=variant;row["Qty"]=qty;row["Unit Price (Rs)"]=unit;row["Item Action"]="KEEP ITEM";row["Change Item To"]="";row["Change Preview"]="";row["Apply Item Change"]=false;row["Order Action"]="PENDING";row["Cancel Reason"]="";row["Final Total (Rs)"]=finalTotal;row["Offer"]=offer;row["Discount (Rs)"]=discount;row["Source"]=source;row["Main Code"]=main;row["Item Code"]=sku;row["Line Total (Rs)"]=line;row["Normal Total (Rs)"]=normal;row["Delivery Fee (Rs)"]=delivery;row["WhatsApp Number"]=String(data.whatsapp||data.phone||"");row["Original Main Code"]=main;row["Original Variant / Color"]=variant;row["Original Item Code"]=sku;row["Original Item Name"]=String(it.product_name||"");row["Original Qty"]=qty;row["Order Time"]=String(data.created_at||"");row["Lead ID"]=String(data.platform_lead_id||"");row["Imported Status"]=String(data.call_center_status||"Pending");row["Last Sync"]=new Date();
    out.push(ORA_ORDER_HEADERS.map(function(h){return typeof row[h]==="undefined"?"":row[h];}));
  }
  var start=oraLastOrderRow_(sheet)+1;sheet.getRange(start,1,out.length,ORA_ORDER_HEADERS.length).setValues(out);
  // Keep the call-center dropdowns, but do NOT recalculate the whole order here.
  // O-RA already sends the final totals, and recalculation/flush can delay the Web App response.
  for(var rr=start;rr<start+out.length;rr++)oraApplyRowControls_(ss,sheet,rr);
  var newRows=[];for(var nr=start;nr<start+out.length;nr++)newRows.push(nr);
  oraCompactCustomerRows_(sheet,newRows);
  oraStyleOrderGroup_(sheet,newRows,orderNo);
  oraForceActionDropdownsForSheet_(sheet);
  return {status:"order_synced",order_id:orderNo,sheet:sheet.getName(),rows:out.length};
}
function oraCheckOrder_(ss,orderNo,source){
  var id=String(orderNo||"").trim();
  if(!id)return {status:"order_missing",order_id:""};
  var sh=oraEnsureSheet_(ss,oraOrderSheetName_(source||oraSourceFromOrder_(id)),ORA_ORDER_HEADERS);
  var rows=oraOrderRows_(sh,id);
  return rows.length?{status:"order_exists",order_id:id,sheet:sh.getName(),rows:rows.length}:{status:"order_missing",order_id:id,sheet:sh.getName(),rows:0};
}

function oraHydrateUiChunkRequest_(ss,data){
  var sheetName=String(data.sheet||"").trim();
  var start=Math.max(2,Number(data.start||2));
  var count=Math.min(120,Math.max(0,Number(data.count||0)));
  if(ORA_ORDER_SHEETS.indexOf(sheetName)<0 || count<=0)return {status:"ui_chunk_skipped",rows:0};
  var sheet=ss.getSheetByName(sheetName);
  if(!sheet)return {status:"ui_chunk_skipped",rows:0};
  var done=oraApplyUiChunk_(ss,sheet,start,count);
  SpreadsheetApp.flush();
  return {status:"ui_chunk_styled",rows:done,sheet:sheetName,start:start};
}

function activateOraFastSyncV143(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  oraDeleteUiWorkerTriggers_();
  PropertiesService.getDocumentProperties().deleteProperty(ORA_UI_QUEUE_KEY);
  oraEnsureCoreSheets_(ss);
  SpreadsheetApp.getActive().toast("V14.3 server-fast Sheet sync activated. Existing data was not deleted.","O-RA",5);
  return "O-RA V14.3 FAST SYNC READY";
}

function activateOraV149Safe(){
  onOpen();
  SpreadsheetApp.getActive().toast("V14.9 safe item-change feedback activated. Existing Sheet data, dropdown colors and rules were not reset.","O-RA",6);
  return "O-RA V14.9 READY - NO DATA RESET";
}

function doPost(e){
  try{
    var data={};try{data=JSON.parse(e&&e.postData&&e.postData.contents?e.postData.contents:"{}");}catch(parseErr){throw new Error("Invalid JSON payload");}
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var type=String(data.payload_type||"");
    if(type==="catalog_sync")return oraJson_({status:"catalog_synced",count:oraSyncCatalog_(ss,Array.isArray(data.products)?data.products:[],data.pricing)});
    if(type==="operational_clear"){for(var i=0;i<ORA_ORDER_SHEETS.length;i++)oraClearDataRows_(oraEnsureSheet_(ss,ORA_ORDER_SHEETS[i],ORA_ORDER_HEADERS));SpreadsheetApp.flush();return oraJson_({status:"operational_cleared"});}
    if(type==="live_start_clear"){for(var j=0;j<ORA_ORDER_SHEETS.length;j++)oraClearDataRows_(oraEnsureSheet_(ss,ORA_ORDER_SHEETS[j],ORA_ORDER_HEADERS));oraClearDataRows_(oraEnsureSheet_(ss,"PRODUCT CATALOG",ORA_CATALOG_HEADERS));SpreadsheetApp.flush();return oraJson_({status:"live_start_cleared"});}
    if(type==="order_delete" || data.action==="deleteOrder"){var removed=oraDeleteOrder_(ss,data.orderNo||data.orderId||data.order_number||data.order_id,data.order_source);return oraJson_({status:"order_deleted",removed:removed});}
    if(type==="order_check")return oraJson_(oraCheckOrder_(ss,data.order_number||data.order_id,data.order_source));
    if(type==="order_batch_sync")return oraJson_(oraSyncOrderBatch_(ss,Array.isArray(data.orders)?data.orders:[]));
    if(type==="ui_style_chunk")return oraJson_(oraHydrateUiChunkRequest_(ss,data));
    if(type==="order_sync"){var result=oraSyncOrder_(ss,data);return oraJson_(result);}
    return oraJson_({status:"error",message:"Unknown payload_type: "+type});
  }catch(err){return oraJson_({status:"error",message:String(err&&err.message||err)});}
}
function doGet(){return oraJson_({status:"ok",service:"O-RA Google Sheet Sync V14.9 Final"});}`;

const proxyPost = async (webhookUrl:string,payload:any) => {
  const response=await fetch('/api/google-sheets/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({webhookUrl,payload})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok || !result?.ok) throw new Error(result?.error || `Google Sheet request failed (${response.status}).`);
  return result;
};

const scheduleSheetUiHydration = (webhookUrl:string,sheets:any[]) => {
  const jobs:Array<{sheet:string;start:number;count:number}>=[];
  for(const raw of Array.isArray(sheets)?sheets:[]){
    const sheet=String(raw?.sheet||'');
    let start=Math.max(2,Number(raw?.start||2));
    let remaining=Math.max(0,Number(raw?.rows||0));
    while(remaining>0){
      const count=Math.min(80,remaining);
      jobs.push({sheet,start,count});
      start+=count;remaining-=count;
    }
  }
  jobs.forEach((job,index)=>{
    window.setTimeout(()=>{
      void proxyPost(webhookUrl,{payload_type:'ui_style_chunk',...job}).catch(()=>undefined);
    },300+index*350);
  });
};

const orderOfferLabel = (order:Order,settings?:StoreSettings) => {
  const qty=(order.items||[]).reduce((sum,it)=>sum+Math.max(1,Number(it.quantity||1)),0);
  const discount=Math.max(0,Number(order.special_offer_discount||0));
  if(discount<=0) return 'No Qty Offer';
  if(settings?.multi_buy_discount_enabled){
    const tiers=[
      {min:Number(settings.multi_buy_tier1_min??2),max:Number(settings.multi_buy_tier1_max??3),rate:Number(settings.multi_buy_tier1_rate??5)},
      {min:Number(settings.multi_buy_tier2_min??4),max:Number(settings.multi_buy_tier2_max??5),rate:Number(settings.multi_buy_tier2_rate??7.5)},
      {min:Number(settings.multi_buy_tier3_min??6),max:Number(settings.multi_buy_tier3_max??10),rate:Number(settings.multi_buy_tier3_rate??10)},
    ];
    const tier=tiers.find(t=>qty>=t.min&&qty<=t.max&&t.rate>0);
    if(tier) return `Qty Offer ${tier.rate}% (${qty} items)`;
  }
  return `Order Offer Rs. ${Math.round(discount*100)/100}`;
};


const buildOrderSyncPayload = (order:Order,settings?:StoreSettings) => ({
  order_id:order.order_number,
  order_number:order.order_number,
  order_source:order.order_source,
  customer_name:order.customer_name,
  phone:order.phone,
  whatsapp:order.whatsapp,
  address:order.address,
  city:order.city,
  created_at:order.created_at,
  subtotal:Number(order.subtotal||0),
  total_amount:Number(order.total_amount||0),
  delivery_fee:Number(order.delivery_fee||0),
  special_offer_discount:Number(order.special_offer_discount||0),
  offer_label:orderOfferLabel(order,settings),
  platform_lead_id:order.platform_lead_id||'',
  call_center_status:order.call_center_status||'Pending',
  items:(order.items||[]).map(it=>({
    main_sku:it.main_sku||it.sku,
    variant_name:it.variant_name||'',
    sku:it.sku,
    product_name:it.product_name,
    quantity:it.quantity,
    unit_price:it.unit_price,
  })),
});

export async function syncOrdersBatchToGoogleSheets(
  orders:Order[],
  webhookUrl:string,
  settings?:StoreSettings,
):Promise<{success:boolean;message:string;syncedCount:number;existingCount:number}> {
  if(!webhookUrl || !webhookUrl.startsWith('http')) return {success:false,message:'Google Sheets Webhook URL is not configured.',syncedCount:0,existingCount:0};
  const eligible=(orders||[]).filter(order =>
    order.order_source!=='Manual Admin' &&
    !(order.order_source==='Website' && order.payment_method==='Bank Payment' && order.payment_verification_status!=='Approved')
  );
  if(!eligible.length) return {success:true,message:'No eligible orders to sync.',syncedCount:0,existingCount:0};
  try{
    const proxyResult=await proxyPost(webhookUrl,{payload_type:'order_batch_sync',orders:eligible.map(order=>buildOrderSyncPayload(order,settings))});
    const result=proxyResult?.result||{};
    const status=String(result?.status||'').trim();
    if(status!=='orders_batch_synced') throw new Error(`Apps Script returned unexpected batch status: ${status||'no status'}`);
    const syncedCount=Math.max(0,Number(result?.synced||0));
    const existingCount=Math.max(0,Number(result?.existing||0));
    return {success:true,message:`Batch synced ${syncedCount} new order(s); ${existingCount} already existed.`,syncedCount,existingCount};
  }catch(e:any){
    return {success:false,message:e?.message||'Google Sheet batch sync failed.',syncedCount:0,existingCount:0};
  }
}

export async function syncOrderToGoogleSheets(order:Order,webhookUrl:string,settings?:StoreSettings,products:Product[]=[]):Promise<{success:boolean;message:string}> {
  void products; // Catalog sync is separate; do not resend the full catalog with every order.
  const result=await syncOrdersBatchToGoogleSheets([order],webhookUrl,settings);
  return {success:result.success,message:result.success?`${order.order_number} queued/synced to ${order.order_source} Google Sheet.`:result.message};
}

export async function syncProductCatalogToGoogleSheets(products:Product[],webhookUrl:string,settings?:StoreSettings):Promise<{success:boolean;message:string}> {
  if(!webhookUrl || !webhookUrl.startsWith('http')) return {success:false,message:'Google Sheets Webhook URL is not configured.'};
  try{ const rows=buildCatalogRows(products,settings); const pricing={enabled:Boolean(settings?.multi_buy_discount_enabled),tiers:[{min:Number(settings?.multi_buy_tier1_min??2),max:Number(settings?.multi_buy_tier1_max??3),rate:Number(settings?.multi_buy_tier1_rate??5)},{min:Number(settings?.multi_buy_tier2_min??4),max:Number(settings?.multi_buy_tier2_max??5),rate:Number(settings?.multi_buy_tier2_rate??7.5)},{min:Number(settings?.multi_buy_tier3_min??6),max:Number(settings?.multi_buy_tier3_max??10),rate:Number(settings?.multi_buy_tier3_rate??10)}]}; const proxyResult=await proxyPost(webhookUrl,{payload_type:'catalog_sync',products:rows,pricing}); const status=String(proxyResult?.result?.status||'').trim(); if(!status) throw new Error(`Apps Script returned no JSON status. Raw response: ${String(proxyResult?.raw || '').slice(0,180) || 'empty'}`); if(status!=='catalog_synced') throw new Error(`Apps Script returned unexpected status: ${status}`); return {success:true,message:`Catalog synced (${rows.length} SKU/variant rows).`}; }
  catch(e:any){return {success:false,message:e?.message||'Catalog sync failed.'};}
}

export async function clearGoogleSheetTestData(webhookUrl:string):Promise<{success:boolean;message:string}> {
  if(!webhookUrl || !webhookUrl.startsWith('http')) return {success:false,message:'Google Sheet Web App URL is not configured.'};
  try{ const r=await proxyPost(webhookUrl,{payload_type:'operational_clear'}); const status=String(r?.result?.status||''); if(status!=='operational_cleared') throw new Error(`Apps Script did not confirm clear (${status||'no status'}).`); return {success:true,message:'Website/Facebook/TikTok operational order rows cleared; Product Catalog preserved.'}; }catch(e:any){return {success:false,message:e?.message||'Google Sheet clear failed.'};}
}

export async function clearGoogleSheetLiveStartData(webhookUrl:string):Promise<{success:boolean;message:string}> {
  if(!webhookUrl || !webhookUrl.startsWith('http')) return {success:false,message:'Google Sheet Web App URL is not configured.'};
  try{ const r=await proxyPost(webhookUrl,{payload_type:'live_start_clear'}); const status=String(r?.result?.status||''); if(status!=='live_start_cleared') throw new Error(`Apps Script did not confirm live-start clear (${status||'no status'}).`); return {success:true,message:'All O-RA business/demo rows cleared from Google Sheet; tabs/headers/link preserved.'}; }catch(e:any){return {success:false,message:e?.message||'Google Sheet live-start clear failed.'};}
}

export async function deleteOrderFromGoogleSheets(orderNumber:string,webhookUrl:string,reason?:string,source?:OrderSource):Promise<{success:boolean;message:string}> {
  if(!webhookUrl || !webhookUrl.startsWith('http')) return {success:false,message:'Google Sheet Web App URL is not configured.'};
  try{ const result=await proxyPost(webhookUrl,{payload_type:'order_delete',order_number:orderNumber,order_source:source,reason:reason||''}); const status=String(result?.result?.status||result?.status||''); if(status && status!=='order_deleted') return {success:false,message:'Apps Script did not confirm row deletion.'}; return {success:true,message:`${orderNumber} removed from Google Sheet.`}; }catch(e:any){return {success:false,message:e?.message||'Google Sheet order delete failed.'};}
}
