export const GOOGLE_APPS_SCRIPT_HOTFIX_V163 = String.raw`
// ============================================================
// O-RA STORE - GOOGLE SHEET RELIABILITY / SPEED HOTFIX V16.3
// Requires V16.1 + V16.2 above this code.
// Faster order lookup, visible row grouping, fast city dropdown cache.
// ============================================================
ORA_VERSION = "O-RA Store Google Sheet Sync V16.3";
var ORA_FAST_CITY_TAB = "ORA CITY FAST LIST";

function oraBuildFastCityList_(ss){
  try{
    var source=ss.getSheetByName(ORA_CITY_TAB);
    if(!source||source.getLastRow()<2)return null;
    var last=Math.min(2,Math.max(1,source.getLastColumn()));
    var vals=source.getRange(2,1,source.getLastRow()-1,last).getDisplayValues();
    var seen={},rows=[];
    for(var i=0;i<vals.length;i++){
      var city=String(vals[i][0]||"").trim();
      if(!city)continue;
      var key=city.toLowerCase();
      if(seen[key])continue;
      seen[key]=true;
      rows.push([city,String(vals[i][1]||"").trim()]);
    }
    rows.sort(function(a,b){return a[0].localeCompare(b[0]);});
    var sh=ss.getSheetByName(ORA_FAST_CITY_TAB)||ss.insertSheet(ORA_FAST_CITY_TAB);
    sh.clearContents();
    sh.getRange(1,1,1,2).setValues([["City","District"]]);
    if(rows.length)sh.getRange(2,1,rows.length,2).setValues(rows);
    try{sh.hideSheet();}catch(e){}
    PropertiesService.getDocumentProperties().setProperty("ORA_FAST_CITY_COUNT",String(rows.length));
    return sh;
  }catch(e){return null;}
}

function oraFastCitySheet_(ss){
  var sh=ss.getSheetByName(ORA_FAST_CITY_TAB);
  if(!sh||sh.getLastRow()<2)sh=oraBuildFastCityList_(ss);
  return sh;
}

oraOrderRows_ = function(sh,orderId){
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"],out=[];
  if(!idCol||sh.getLastRow()<2)return out;
  var target=String(orderId||"").trim();
  if(!target)return out;
  try{
    var found=sh.getRange(2,idCol,sh.getLastRow()-1,1).createTextFinder(target).matchEntireCell(true).findAll();
    for(var i=0;i<found.length;i++)out.push(found[i].getRow());
    out.sort(function(a,b){return a-b;});
    return out;
  }catch(e){
    var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues();
    for(var j=0;j<ids.length;j++)if(oraKey_(ids[j][0])===oraKey_(target))out.push(j+2);
    return out;
  }
};

oraApplyValidations_ = function(ss,sh,start,count){
  if(!count)return;var hm=oraHeaderMap_(sh);
  try{if(hm["Item Action"])sh.getRange(start,hm["Item Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["KEEP ITEM","CANCEL ITEM"],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm["Order Action"])sh.getRange(start,hm["Order Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["PENDING","CONFIRM ORDER","CANCEL ENTIRE ORDER"],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm["Apply Item Change"])sh.getRange(start,hm["Apply Item Change"],count,1).insertCheckboxes();}catch(e){}
  try{
    var cat=ss.getSheetByName(ORA_CATALOG_TAB);
    if(cat&&cat.getLastRow()>1&&hm["Change Item To"])sh.getRange(start,hm["Change Item To"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange(2,11,cat.getLastRow()-1,1),true).setAllowInvalid(false).build());
  }catch(e){}
  // IMPORTANT: use the de-duplicated city cache instead of the 8k+ raw CITY LIST.
  try{
    var fast=oraFastCitySheet_(ss);
    if(fast&&fast.getLastRow()>1&&hm["City"])sh.getRange(start,hm["City"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(fast.getRange(2,1,fast.getLastRow()-1,1),true).setAllowInvalid(true).build());
  }catch(e){}
};

oraDeleteRowsById_ = function(sh,orderId,moveToDeleted,knownRows){
  var rows=Array.isArray(knownRows)?knownRows:oraOrderRows_(sh,orderId);
  if(!rows.length)return 0;
  var ss=sh.getParent(),deleted=null,lastCol=sh.getLastColumn();
  if(moveToDeleted){
    deleted=ss.getSheetByName(ORA_DELETED_SHEET)||ss.insertSheet(ORA_DELETED_SHEET);
    if(deleted.getLastRow()===0)deleted.getRange(1,1,1,lastCol).setValues([sh.getRange(1,1,1,lastCol).getValues()[0]]);
    var moved=[];
    for(var m=0;m<rows.length;m++)moved.push(sh.getRange(rows[m],1,1,lastCol).getValues()[0]);
    if(moved.length)deleted.getRange(deleted.getLastRow()+1,1,moved.length,lastCol).setValues(moved);
  }
  var blocks=[],start=rows[0],prev=rows[0];
  for(var i=1;i<rows.length;i++){
    if(rows[i]===prev+1){prev=rows[i];continue;}
    blocks.push([start,prev]);start=rows[i];prev=rows[i];
  }
  blocks.push([start,prev]);
  for(var b=blocks.length-1;b>=0;b--)sh.deleteRows(blocks[b][0],blocks[b][1]-blocks[b][0]+1);
  return rows.length;
};

var oraWriteOrderV162_ = oraWriteOrder_;
oraWriteOrder_ = function(ss,o){
  var sh=oraEnsureOrderSheet_(ss,oraSheetName_(o.source));
  var before=sh.getLastRow();
  var written=oraWriteOrderV162_(ss,o);
  if(written>0){
    var start=before+1;
    // Make every multi-item order visually one collapsible group.
    if(written>1){
      try{sh.getRange(start,1,written,sh.getLastColumn()).shiftRowGroupDepth(1);}catch(e){}
    }
    try{
      sh.getRange(start,1,written,sh.getLastColumn()).setBorder(true,null,true,null,null,null,"#64748b",SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }catch(e){}
  }
  return written;
};

oraSync_ = function(body){
  var lock=LockService.getDocumentLock();
  if(!lock.tryLock(4000))return {ok:false,error:"Sheet is busy. Please retry."};
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet(),orders=oraNormalizeIncoming_(body),rows=0;
    for(var i=0;i<orders.length;i++)rows+=oraWriteOrder_(ss,orders[i]);
    return {ok:true,status:"orders_synced",synced:orders.length,existing:0,rows:rows,version:ORA_VERSION};
  }finally{lock.releaseLock();}
};

oraDeleteOrder_ = function(body){
  var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();
  if(!id)return {ok:false,error:"Missing order ID"};
  var lock=LockService.getDocumentLock();
  if(!lock.tryLock(4000))return {ok:false,error:"Sheet is busy. Please retry delete."};
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0;
    for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
      var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
      if(sh)removed+=oraDeleteRowsById_(sh,id,true);
    }
    return {ok:true,status:"order_deleted",deleted:removed,removed:removed,orderId:id,version:ORA_VERSION};
  }finally{lock.releaseLock();}
};

var setupOraCallCenterSheetV162_ = setupOraCallCenterSheet;
setupOraCallCenterSheet = function(){
  setupOraCallCenterSheetV162_();
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var fast=oraBuildFastCityList_(ss);
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if(sh&&sh.getLastRow()>1)oraApplyValidations_(ss,sh,2,sh.getLastRow()-1);
  }
  SpreadsheetApp.getActive().toast("O-RA V16.3 ready. Fast City List: "+(fast?Math.max(0,fast.getLastRow()-1):0)+" unique cities.","O-RA",5);
};
`;
