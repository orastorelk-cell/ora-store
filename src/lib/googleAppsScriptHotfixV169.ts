export const GOOGLE_APPS_SCRIPT_HOTFIX_V169 = String.raw`
// ============================================================
// O-RA STORE - PINNED SPREADSHEET RUNTIME V16.9
// Web-app executions do not rely on an "active" spreadsheet context.
// setupOraCallCenterSheet stores the bound Sheet ID once; all POST writes
// reopen that exact spreadsheet by ID.
// ============================================================
ORA_VERSION = "O-RA Store Google Sheet Sync V16.9";
var ORA_SPREADSHEET_ID_PROPERTY = "ORA_SPREADSHEET_ID";

function oraSpreadsheetV169_(){
  var props=PropertiesService.getScriptProperties();
  var id=String(props.getProperty(ORA_SPREADSHEET_ID_PROPERTY)||"").trim();
  if(id){
    try{return SpreadsheetApp.openById(id);}catch(e){}
  }
  var active=null;
  try{active=SpreadsheetApp.getActiveSpreadsheet();}catch(e){}
  if(!active){try{active=SpreadsheetApp.getActive();}catch(e){}}
  if(!active)throw new Error("O-RA spreadsheet is not pinned. Run setupOraCallCenterSheet once from the target Google Sheet, then deploy the Web App again.");
  props.setProperty(ORA_SPREADSHEET_ID_PROPERTY,active.getId());
  return active;
}

// Final authoritative sync endpoint. No active-spreadsheet dependency.
oraSync_ = function(body){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(8000))return {ok:false,error:"Sheet is busy. Please retry."};
  try{
    var ss=oraSpreadsheetV169_();
    var orders=oraNormalizeIncoming_(body),rows=0;
    if(!orders.length)return {ok:false,error:"No valid orders found in request."};
    for(var i=0;i<orders.length;i++)rows+=oraWriteOrder_(ss,orders[i]);
    SpreadsheetApp.flush();
    return {ok:true,status:"orders_synced",synced:orders.length,existing:0,rows:rows,spreadsheetId:ss.getId(),version:ORA_VERSION};
  }catch(e){
    return {ok:false,error:String(e&&e.stack?e.stack:e),version:ORA_VERSION};
  }finally{try{lock.releaseLock();}catch(e){}}
};

oraDeleteOrder_ = function(body){
  var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();
  if(!id)return {ok:false,error:"Missing order ID"};
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(8000))return {ok:false,error:"Sheet is busy. Please retry delete."};
  try{
    var ss=oraSpreadsheetV169_(),removed=0;
    for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
      var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
      if(sh)removed+=oraDeleteRowsV168_(sh,oraRowsForOrderV168_(sh,id),true);
    }
    SpreadsheetApp.flush();
    return {ok:true,status:"order_deleted",deleted:removed,removed:removed,orderId:id,spreadsheetId:ss.getId(),version:ORA_VERSION};
  }catch(e){return {ok:false,error:String(e&&e.stack?e.stack:e),version:ORA_VERSION};}
  finally{try{lock.releaseLock();}catch(e){}}
};

// Preserve the V16.7 image-preview behavior while pinning catalog writes too.
var oraSyncCatalogV169Core_=oraSyncCatalog_;
oraSyncCatalog_=function(_ss,body){
  var ss=oraSpreadsheetV169_();
  return oraSyncCatalogV169Core_(ss,body);
};

setupOraCallCenterSheet = function(){
  var ss=null;
  try{ss=SpreadsheetApp.getActiveSpreadsheet();}catch(e){}
  if(!ss){try{ss=SpreadsheetApp.getActive();}catch(e){}}
  if(!ss)throw new Error("Open the target O-RA Google Sheet and run setupOraCallCenterSheet from its Apps Script project.");
  PropertiesService.getScriptProperties().setProperty(ORA_SPREADSHEET_ID_PROPERTY,ss.getId());
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=oraEnsureOrderSheet_(ss,ORA_ORDER_SHEETS[i]);
    var count=Math.max(1,sh.getMaxRows()-1);
    oraApplyOrderControlsV168_(ss,sh,2,count);
    try{sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}
  }
  try{oraEnsureCatalog_(ss);}catch(e){}
  try{oraBuildFastCityList_(ss);}catch(e){}
  SpreadsheetApp.getActive().toast("O-RA V16.9 ready. Sheet pinned: "+ss.getId(),"O-RA",6);
  return ss.getId();
};
`;
