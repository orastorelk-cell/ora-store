export const GOOGLE_APPS_SCRIPT_HOTFIX_V168 = String.raw`
// ============================================================
// O-RA STORE - STABLE AUTHORITATIVE ORDER CORE V16.8
// No wrapper chaining. Final definitions below win over older hotfixes.
// ============================================================
ORA_VERSION = "O-RA Store Google Sheet Sync V16.8";

function oraApplyOrderControlsV168_(ss,sh,start,count){
  if(!count||count<1)return;
  var hm=oraHeaderMap_(sh);
  try{if(hm["Item Action"])sh.getRange(start,hm["Item Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["KEEP ITEM","CANCEL ITEM"],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm["Order Action"])sh.getRange(start,hm["Order Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["PENDING","CONFIRM ORDER","NO ANSWER","CANCEL ENTIRE ORDER"],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm["Apply Item Change"])sh.getRange(start,hm["Apply Item Change"],count,1).insertCheckboxes();}catch(e){}
  try{var cat=ss.getSheetByName(ORA_CATALOG_TAB);if(cat&&cat.getLastRow()>1&&hm["Change Item To"])sh.getRange(start,hm["Change Item To"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange(2,11,cat.getLastRow()-1,1),true).setAllowInvalid(false).build());}catch(e){}
  try{var fast=oraFastCitySheet_(ss);if(fast&&fast.getLastRow()>1&&hm["City"])sh.getRange(start,hm["City"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(fast.getRange(2,1,fast.getLastRow()-1,1),true).setAllowInvalid(true).build());}catch(e){}
}

function oraRowsForOrderV168_(sh,orderId){
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"],out=[];
  if(!idCol||sh.getLastRow()<2)return out;
  try{var hits=sh.getRange(2,idCol,sh.getLastRow()-1,1).createTextFinder(String(orderId||"").trim()).matchEntireCell(true).findAll();for(var i=0;i<hits.length;i++)out.push(hits[i].getRow());}catch(e){}
  out.sort(function(a,b){return a-b;});return out;
}

function oraDeleteRowsV168_(sh,rows,moveToDeleted){
  if(!rows||!rows.length)return 0;
  var lastCol=sh.getLastColumn(),ss=sh.getParent();
  if(moveToDeleted){
    var deleted=ss.getSheetByName(ORA_DELETED_SHEET)||ss.insertSheet(ORA_DELETED_SHEET);
    if(deleted.getLastRow()===0)deleted.getRange(1,1,1,lastCol).setValues([sh.getRange(1,1,1,lastCol).getValues()[0]]);
    var moved=[];for(var m=0;m<rows.length;m++)moved.push(sh.getRange(rows[m],1,1,lastCol).getValues()[0]);
    if(moved.length)deleted.getRange(deleted.getLastRow()+1,1,moved.length,lastCol).setValues(moved);
  }
  var end=rows.length-1;
  while(end>=0){var blockEnd=rows[end],blockStart=blockEnd;while(end>0&&rows[end-1]===blockStart-1){end--;blockStart=rows[end];}sh.deleteRows(blockStart,blockEnd-blockStart+1);end--;}
  return rows.length;
}

function oraExistingActionsV168_(sh,rows){
  var out={orderAction:"PENDING",items:{}};if(!rows.length)return out;
  var hm=oraHeaderMap_(sh),first=rows[0],last=rows[rows.length-1],vals=sh.getRange(first,1,last-first+1,sh.getLastColumn()).getDisplayValues();
  for(var i=0;i<rows.length;i++){var r=vals[rows[i]-first]||[];if(hm["Order Action"]&&r[hm["Order Action"]-1])out.orderAction=r[hm["Order Action"]-1];var key=oraKey_((hm["Item Code"]?r[hm["Item Code"]-1]:"")+"|"+(hm["Variant / Color"]?r[hm["Variant / Color"]-1]:""));if(key&&hm["Item Action"]&&r[hm["Item Action"]-1])out.items[key]=r[hm["Item Action"]-1];}
  return out;
}

oraWriteOrder_ = function(ss,o){
  var sheetName=oraSheetName_(o.source),sh=ss.getSheetByName(sheetName)||oraEnsureOrderSheet_(ss,sheetName);
  var oldRows=oraRowsForOrderV168_(sh,o.id),actions=oraExistingActionsV168_(sh,oldRows);
  if(oldRows.length)oraDeleteRowsV168_(sh,oldRows,false);
  if(!o.district&&o.city){try{var cm=oraFastCityMatchV164_(ss,o.city);if(cm)o.district=cm.district;}catch(e){}}
  var hm=oraHeaderMap_(sh),lastCol=sh.getLastColumn(),rows=[];
  for(var i=0;i<o.items.length;i++){
    var it=o.items[i],first=i===0,row=[];for(var c=0;c<lastCol;c++)row.push("");
    function set(h,v){if(hm[h])row[hm[h]-1]=v;}
    var itemKey=oraKey_(it.code+"|"+it.variant);
    set("Order ID",o.id);set("Customer Name",first?o.customer:"");set("Phone Number",first?o.phone:"");set("Address",first?o.address:"");
    set("Item Name",it.name);set("Item Code",it.code);set("Qty",it.qty);set("Unit Price (Rs)",it.unit);set("Final Total (Rs)",first?o.finalTotal:"");set("Variant / Color",it.variant);
    set("Item Action",actions.items[itemKey]||"KEEP ITEM");set("Order Action",first?(actions.orderAction||"PENDING"):"");
    set("Offer",it.offer||o.offer||"No Qty Offer");set("Discount (Rs)",Math.round(Number(it.discount||0)*100)/100);
    set("Source",o.source);set("Main Code",it.main);set("Line Total (Rs)",it.line);set("Normal Total (Rs)",first?o.normalTotal:"");set("Delivery Fee (Rs)",first?o.delivery:"");
    set("WhatsApp Number",first?o.whatsapp:"");set("Original Main Code",it.main);set("Original Variant / Color",it.variant);set("Original Item Code",it.code);set("Original Item Name",it.name);set("Original Qty",it.qty);
    set("Order Time",first?o.orderTime:"");set("Imported Status",first?o.importedStatus:"");set("Last Sync",new Date());set("City",first?o.city:"");set("District",first?o.district:"");
    rows.push(row);
  }
  if(!rows.length)return 0;
  var start=sh.getLastRow()+1;sh.getRange(start,1,rows.length,lastCol).setValues(rows);oraApplyOrderControlsV168_(ss,sh,start,rows.length);
  if(rows.length>1){try{sh.getRange(start,1,rows.length,lastCol).shiftRowGroupDepth(1);sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}}
  try{sh.getRange(start,1,rows.length,lastCol).setBorder(true,null,true,null,null,null,"#64748b",SpreadsheetApp.BorderStyle.SOLID_MEDIUM);}catch(e){}
  return rows.length;
};

oraSync_ = function(body){
  var lock=LockService.getDocumentLock();if(!lock.tryLock(5000))return {ok:false,error:"Sheet is busy. Please retry."};
  try{var ss=SpreadsheetApp.getActiveSpreadsheet(),orders=oraNormalizeIncoming_(body),rows=0;if(!orders.length)return {ok:false,error:"No valid orders found in request."};for(var i=0;i<orders.length;i++)rows+=oraWriteOrder_(ss,orders[i]);SpreadsheetApp.flush();return {ok:true,status:"orders_synced",synced:orders.length,existing:0,rows:rows,version:ORA_VERSION};}catch(e){return {ok:false,error:String(e&&e.stack?e.stack:e)};}finally{try{lock.releaseLock();}catch(e){}}
};

oraDeleteOrder_ = function(body){
  var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();if(!id)return {ok:false,error:"Missing order ID"};
  var lock=LockService.getDocumentLock();if(!lock.tryLock(5000))return {ok:false,error:"Sheet is busy. Please retry delete."};
  try{var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0;for(var i=0;i<ORA_ORDER_SHEETS.length;i++){var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);if(sh)removed+=oraDeleteRowsV168_(sh,oraRowsForOrderV168_(sh,id),true);}SpreadsheetApp.flush();return {ok:true,status:"order_deleted",deleted:removed,removed:removed,orderId:id,version:ORA_VERSION};}catch(e){return {ok:false,error:String(e&&e.stack?e.stack:e)};}finally{try{lock.releaseLock();}catch(e){}}
};

setupOraCallCenterSheet = function(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){var sh=oraEnsureOrderSheet_(ss,ORA_ORDER_SHEETS[i]);var count=Math.max(1,sh.getMaxRows()-1);oraApplyOrderControlsV168_(ss,sh,2,count);try{sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}}
  try{oraEnsureCatalog_(ss);}catch(e){}
  try{oraBuildFastCityList_(ss);}catch(e){}
  SpreadsheetApp.getActive().toast("O-RA V16.8 stable core ready.","O-RA",5);
};
`;
