export const GOOGLE_APPS_SCRIPT_PULL_V18 = String.raw`

// ============================================================
// O-RA STORE - V18 GOOGLE-PULL RELIABILITY LAYER
// Fallback path: Google itself pulls unsynced orders from O-RA.
// The existing server -> Apps Script push remains enabled as a fast path.
// ============================================================
ORA_VERSION = "O-RA Store Google Sheet Sync V18 Pull Fallback";
var ORA_PULL_API_BASE = "https://ora-store.orastore-lk.workers.dev";
var ORA_PULL_HANDLER = "oraStablePullOrdersFromServer";

function oraStableDeploymentId_(){
  var serviceUrl=String(ScriptApp.getService().getUrl()||"").trim();
  var match=serviceUrl.match(/\/macros\/s\/([^/]+)\/(?:exec|dev)(?:\?|$)/i);
  if(!match)throw new Error("O-RA Web App deployment URL was not found. Deploy this Apps Script as a Web App first.");
  return match[1];
}

function oraStablePullJson_(url,options){
  var response=UrlFetchApp.fetch(url,options||{});
  var code=response.getResponseCode();
  var text=response.getContentText()||"";
  var data={};
  try{data=text?JSON.parse(text):{};}catch(e){throw new Error("O-RA pull returned invalid JSON (HTTP "+code+").");}
  if(code<200||code>=300||data.ok===false)throw new Error(data.error||("O-RA pull HTTP "+code));
  return data;
}

function oraStablePullOrdersFromServer(){
  var key=oraStableDeploymentId_();
  var headers={"x-ora-sheet-key":key,"accept":"application/json"};
  var data=oraStablePullJson_(ORA_PULL_API_BASE+"/api/google-sheets/pull",{
    method:"get",
    headers:headers,
    muteHttpExceptions:true,
    followRedirects:true
  });

  var orders=Array.isArray(data.orders)?data.orders:[];
  if(!orders.length)return {ok:true,status:"pull_empty",count:0,version:ORA_VERSION};

  var result=oraStableSyncOrders_({orders:orders});
  if(!result||result.ok===false)throw new Error((result&&result.message)||"Pulled orders could not be written to Google Sheet.");

  var orderNumbers=Array.isArray(data.order_numbers)?data.order_numbers:orders.map(function(order){return String(order&&order.order_number||"");}).filter(Boolean);
  var ack=oraStablePullJson_(ORA_PULL_API_BASE+"/api/google-sheets/pull-ack",{
    method:"post",
    contentType:"application/json",
    headers:headers,
    payload:JSON.stringify({order_numbers:orderNumbers}),
    muteHttpExceptions:true,
    followRedirects:true
  });

  return {
    ok:true,
    status:"pull_synced",
    synced:Number(result.synced||orderNumbers.length||0),
    rows:Number(result.rows||0),
    acknowledged:Number(ack.updated||0),
    version:ORA_VERSION
  };
}

function oraStableInstallPullTrigger_(){
  var triggers=ScriptApp.getProjectTriggers();
  for(var i=0;i<triggers.length;i++){
    if(triggers[i].getHandlerFunction()===ORA_PULL_HANDLER)ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger(ORA_PULL_HANDLER).timeBased().everyMinutes(1).create();
  return true;
}

// Replace setup only at the final layer. This pins the exact Sheet, installs one
// pull trigger, then tries one immediate pull so an already-saved order can appear
// without waiting for the first scheduled minute.
setupOraCallCenterSheet = function(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw new Error("Open the target Google Sheet before running setupOraCallCenterSheet.");
  PropertiesService.getScriptProperties().setProperty(ORA_STABLE_SHEET_ID_KEY,ss.getId());
  for(var i=0;i<ORA_STABLE_ORDER_SHEETS.length;i++)oraStableEnsureOrderSheet_(ss,ORA_STABLE_ORDER_SHEETS[i]);
  oraStableEnsureCatalog_(ss);
  if(!ss.getSheetByName("CITY LIST"))ss.insertSheet("CITY LIST");
  oraStableInstallPullTrigger_();
  var pullMessage="Pull trigger installed";
  try{
    var first=oraStablePullOrdersFromServer();
    pullMessage=first.status==="pull_synced"?("Pulled "+Number(first.synced||0)+" order(s)"):"No pending orders";
  }catch(err){
    pullMessage="Trigger installed; first pull will retry automatically";
    console.log("O-RA first pull: "+String(err&&err.message?err.message:err));
  }
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("O-RA V18 ready - "+pullMessage+".","O-RA",8);
};
`;
