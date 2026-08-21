export const GOOGLE_APPS_SCRIPT_HOTFIX_V165 = String.raw`
ORA_VERSION = "O-RA Store Google Sheet Sync V16.5.1";

// Web-app executions do not have a reliable active spreadsheet UI context.
// setupOraCallCenterSheet() pins the exact bound spreadsheet ID once, and every
// doPost write/delete/catalog operation re-opens that spreadsheet explicitly.
var ORA_SPREADSHEET_ID_KEY_V165 = "ORA_TARGET_SPREADSHEET_ID";
function oraSpreadsheetV165_(){
  var props=PropertiesService.getScriptProperties();
  var id=String(props.getProperty(ORA_SPREADSHEET_ID_KEY_V165)||"").trim();
  if(id)return SpreadsheetApp.openById(id);
  var active=SpreadsheetApp.getActiveSpreadsheet();
  if(!active)throw new Error("O-RA target spreadsheet is not configured. Run setupOraCallCenterSheet once from the target Sheet.");
  props.setProperty(ORA_SPREADSHEET_ID_KEY_V165,active.getId());
  return active;
}

function oraFindOrderRowsV165_(sh, orderId){
  var hm=oraHeaderMap_(sh), idCol=hm["Order ID"], out=[];
  if(!idCol || sh.getLastRow()<2)return out;
  try{var hits=sh.getRange(2,idCol,sh.getLastRow()-1,1).createTextFinder(String(orderId||"").trim()).matchEntireCell(true).findAll();for(var i=0;i<hits.length;i++)out.push(hits[i].getRow());}catch(e){}
  out.sort(function(a,b){return a-b;});return out;
}

function oraDeleteKnownRowsV165_(sh, rows){
  if(!rows||!rows.length)return 0;var removed=0,end=rows.length-1;
  while(end>=0){var blockEnd=rows[end],blockStart=blockEnd;while(end>0&&rows[end-1]===blockStart-1){end--;blockStart=rows[end];}var count=blockEnd-blockStart+1;sh.deleteRows(blockStart,count);removed+=count;end--;}
  return removed;
}

function oraCaptureActionsRowsV165_(sh, rows){
  var out={orderAction:"PENDING",items:{}};if(!rows||!rows.length)return out;
  var hm=oraHeaderMap_(sh),first=rows[0],last=rows[rows.length-1],vals=sh.getRange(first,1,last-first+1,sh.getLastColumn()).getDisplayValues();
  for(var i=0;i<rows.length;i++){var row=vals[rows[i]-first]||[];if(hm["Order Action"]&&row[hm["Order Action"]-1])out.orderAction=row[hm["Order Action"]-1];var key=oraKey_((hm["Item Code"]?row[hm["Item Code"]-1]:"")+"|"+(hm["Variant / Color"]?row[hm["Variant / Color"]-1]:""));if(key&&hm["Item Action"]&&row[hm["Item Action"]-1])out.items[key]=row[hm["Item Action"]-1];}
  return out;
}

oraWriteOrder_ = function(ss,o){
  ss=ss||oraSpreadsheetV165_();
  var sheetName=oraSheetName_(o.source),sh=ss.getSheetByName(sheetName);if(!sh)sh=oraEnsureOrderSheet_(ss,sheetName);
  var oldRows=oraFindOrderRowsV165_(sh,o.id),actions=oraCaptureActionsRowsV165_(sh,oldRows);if(oldRows.length)oraDeleteKnownRowsV165_(sh,oldRows);
  if(!o.district&&o.city){var cityMatch=oraFastCityMatchV164_(ss,o.city);if(cityMatch)o.district=cityMatch.district;}
  var hm=oraHeaderMap_(sh),rows=[],lastCol=sh.getLastColumn();
  for(var i=0;i<o.items.length;i++){var it=o.items[i],first=i===0,row=new Array(lastCol).fill("");function set(h,v){if(hm[h])row[hm[h]-1]=v;}var itemKey=oraKey_(it.code+"|"+it.variant);set("Order ID",o.id);set("Customer Name",first?o.customer:"");set("Phone Number",first?o.phone:"");set("Address",first?o.address:"");set("Item Name",it.name);set("Item Code",it.code);set("Qty",it.qty);set("Unit Price (Rs)",it.unit);set("Variant / Color",it.variant);set("Item Action",actions.items[itemKey]||"KEEP ITEM");set("Order Action",first?(actions.orderAction||"PENDING"):"");set("Offer",it.offer||o.offer||"No Qty Offer");set("Discount (Rs)",Math.round(Number(it.discount||0)*100)/100);set("Source",o.source);set("Main Code",it.main);set("Line Total (Rs)",it.line);set("Final Total (Rs)",first?o.finalTotal:"");set("Normal Total (Rs)",first?o.normalTotal:"");set("Delivery Fee (Rs)",first?o.delivery:"");set("WhatsApp Number",first?o.whatsapp:"");set("Original Main Code",it.main);set("Original Variant / Color",it.variant);set("Original Item Code",it.code);set("Original Item Name",it.name);set("Original Qty",it.qty);set("Order Time",first?o.orderTime:"");set("Lead ID",first?o.leadId:"");set("Imported Status",first?o.importedStatus:"");set("Last Sync",new Date());set("City",first?o.city:"");set("District",first?o.district:"");rows.push(row);}
  if(!rows.length)return 0;var start=sh.getLastRow()+1;sh.getRange(start,1,rows.length,lastCol).setValues(rows);if(rows.length>1){try{sh.getRange(start,1,rows.length,lastCol).shiftRowGroupDepth(1);sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}}return rows.length;
};

// Replace the V16.1/V16.4 sync entry point so doPost never depends on
// SpreadsheetApp.getActiveSpreadsheet() during a web-app request.
oraSync_ = function(body){
  var ss=oraSpreadsheetV165_(),orders=oraNormalizeIncoming_(body),rows=0;
  if(!orders.length)return {ok:false,status:"error",message:"No valid order rows were found in sync payload."};
  for(var i=0;i<orders.length;i++)rows+=oraWriteOrder_(ss,orders[i]);
  return {ok:true,status:"orders_synced",synced:orders.length,existing:0,rows:rows};
};

function oraClearWebsiteTestsV165_(){
  var ss=oraSpreadsheetV165_(),sh=ss.getSheetByName("CALL CENTER ORDERS"),removed=0;if(!sh||sh.getLastRow()<2)return {ok:true,status:"website_test_orders_cleared",removed:0};
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"];if(!idCol)return {ok:true,status:"website_test_orders_cleared",removed:0};var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues(),rows=[];for(var i=0;i<ids.length;i++)if(oraKey_(ids[i][0]).indexOf("WEB-TEST-")===0)rows.push(i+2);removed=oraDeleteKnownRowsV165_(sh,rows);return {ok:true,status:"website_test_orders_cleared",removed:removed};
}

oraDeleteOrder_=function(body){
  var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();if(!id)return {ok:false,error:"Missing order ID"};
  if(/^WEB-TEST-/i.test(id)){var tr=oraClearWebsiteTestsV165_();return {ok:true,status:"order_deleted",deleted:tr.removed,removed:tr.removed,orderId:id};}
  var ss=oraSpreadsheetV165_(),removed=0;for(var i=0;i<ORA_ORDER_SHEETS.length;i++){var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);if(sh)removed+=oraDeleteRowsById_(sh,id,true);}return {ok:true,status:"order_deleted",deleted:removed,removed:removed,orderId:id};
};

oraClearAll_=function(){var ss=oraSpreadsheetV165_(),removed=0,names=ORA_ORDER_SHEETS.concat([ORA_DELETED_SHEET]);for(var i=0;i<names.length;i++){var sh=ss.getSheetByName(names[i]);if(!sh)continue;var lr=sh.getLastRow();if(lr>1){removed+=lr-1;sh.deleteRows(2,lr-1);}}return {ok:true,status:"operational_cleared",removed:removed};};
oraClearTests_=function(){var ss=oraSpreadsheetV165_(),removed=0;for(var s=0;s<ORA_ORDER_SHEETS.length;s++){var sh=ss.getSheetByName(ORA_ORDER_SHEETS[s]);if(!sh||sh.getLastRow()<2)continue;var hm=oraHeaderMap_(sh),idCol=hm["Order ID"];if(!idCol)continue;var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues();for(var i=ids.length-1;i>=0;i--){var id=oraKey_(ids[i][0]);if(id.indexOf("TEST-")===0||id.indexOf("WEB-TEST-")===0){sh.deleteRow(i+2);removed++;}}}return {ok:true,status:"test_orders_cleared",removed:removed};};

var oraSyncCatalogV165Base_=oraSyncCatalog_;
oraSyncCatalog_=function(ss,body){return oraSyncCatalogV165Base_(ss||oraSpreadsheetV165_(),body);};

var setupOraCallCenterSheetV165Base_=setupOraCallCenterSheet;
setupOraCallCenterSheet=function(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw new Error("Open the target Google Sheet before running setupOraCallCenterSheet.");
  PropertiesService.getScriptProperties().setProperty(ORA_SPREADSHEET_ID_KEY_V165,ss.getId());
  setupOraCallCenterSheetV165Base_();
  SpreadsheetApp.getActive().toast("O-RA V16.5.1 ready - web app pinned to this spreadsheet.","O-RA",5);
};
`;
