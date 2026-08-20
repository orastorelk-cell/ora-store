export const GOOGLE_APPS_SCRIPT_DIAGNOSTICS = String.raw`
// ============================================================
// O-RA SHEET BINDING SAFETY LAYER
// Pins the bound spreadsheet during setup so Web App doPost always
// writes to the exact O-RA order spreadsheet, even without active UI context.
// ============================================================
var ORA_BOUND_SHEET_KEY_ = 'ORA_BOUND_SPREADSHEET_ID';

function oraBoundSpreadsheet_(){
  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty(ORA_BOUND_SHEET_KEY_) || '').trim();
  if(id){
    try{return SpreadsheetApp.openById(id);}catch(e){}
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if(!active) throw new Error('O-RA spreadsheet is not bound. Run setupOraCallCenterSheet from the spreadsheet once.');
  props.setProperty(ORA_BOUND_SHEET_KEY_, active.getId());
  return active;
}

var oraSetupBoundBase_ = setupOraCallCenterSheet;
setupOraCallCenterSheet = function(){
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if(!active) throw new Error('Open the O-RA spreadsheet and run setup again.');
  PropertiesService.getScriptProperties().setProperty(ORA_BOUND_SHEET_KEY_, active.getId());
  var result = oraSetupBoundBase_();
  SpreadsheetApp.getActive().toast('O-RA Sheet connection locked to this spreadsheet.','O-RA',5);
  return result;
};

oraSync_ = function(body){
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) return {ok:false,error:'Sheet is busy. Please retry.'};
  try{
    var ss = oraBoundSpreadsheet_();
    var orders = oraNormalizeIncoming_(body);
    if(!orders.length) return {ok:false,error:'No valid orders found in sync payload.',status:'orders_sync_empty',synced:0,rows:0};
    var rows = 0;
    for(var i=0;i<orders.length;i++) rows += oraWriteOrder_(ss,orders[i]);
    SpreadsheetApp.flush();
    return {ok:true,status:'orders_synced',synced:orders.length,existing:0,rows:rows,version:ORA_VERSION};
  }catch(err){
    return {ok:false,error:String(err && err.message ? err.message : err),status:'orders_sync_failed'};
  }finally{
    try{lock.releaseLock();}catch(e){}
  }
};

oraDeleteOrder_ = function(body){
  var id=oraStr_(oraPick_(body,['orderId','order_id','order_number','id'])).trim();
  if(!id)return {ok:false,error:'Missing order ID'};
  var ss=oraBoundSpreadsheet_(),removed=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if(sh)removed+=oraDeleteRowsById_(sh,id,true);
  }
  SpreadsheetApp.flush();
  return {ok:true,status:'order_deleted',deleted:removed,removed:removed,orderId:id};
};

oraClearTests_ = function(){
  var ss=oraBoundSpreadsheet_(),removed=0;
  for(var s=0;s<ORA_ORDER_SHEETS.length;s++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[s]);
    if(!sh||sh.getLastRow()<2)continue;
    var hm=oraHeaderMap_(sh),idCol=hm['Order ID'];
    if(!idCol)continue;
    var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues();
    for(var i=ids.length-1;i>=0;i--){
      var oid=oraKey_(ids[i][0]);
      if(oid.indexOf('TEST-')===0||oid.indexOf('WEB-TEST-')===0){sh.deleteRow(i+2);removed++;}
    }
  }
  SpreadsheetApp.flush();
  return {ok:true,status:'test_orders_cleared',removed:removed};
};
`;
