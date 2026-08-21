export const GOOGLE_APPS_SCRIPT_PULL_V18 = String.raw`

// ============================================================
// O-RA STORE - V18.1 GOOGLE-PULL RELIABILITY LAYER
// Fallback path: Google itself pulls unsynced orders from O-RA.
// The existing server -> Apps Script push remains enabled as a fast path.
// ============================================================
ORA_VERSION = "O-RA Store Google Sheet Sync V18.1 Pull Authorization";
var ORA_PULL_API_BASE = "https://ora-store.orastore-lk.workers.dev";
var ORA_PULL_HANDLER = "oraStablePullOrdersFromServer";
var ORA_PULL_CATALOG_VERSION_KEY = "ORA_PULL_CATALOG_VERSION";

function oraStableRequirePullPermissions_(){
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL,[
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/spreadsheets"
  ]);
}

function oraAuthorizeOraSheetSync(){
  oraStableRequirePullPermissions_();
  return "O-RA Google Sheet pull permissions are authorized.";
}

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

function oraStablePullCatalogIfChanged_(remoteVersion,key,headers){
  var version=Math.max(0,Number(remoteVersion||0));
  if(!version)return {ok:true,status:"catalog_version_missing",rows:0};
  var props=PropertiesService.getScriptProperties();
  var localVersion=Math.max(0,Number(props.getProperty(ORA_PULL_CATALOG_VERSION_KEY)||0));
  if(localVersion===version)return {ok:true,status:"catalog_current",rows:0};

  var catalog=oraStablePullJson_(ORA_PULL_API_BASE+"/api/google-sheets/catalog-pull",{
    method:"get",
    headers:headers,
    muteHttpExceptions:true,
    followRedirects:true
  });
  var result=oraStableCatalogSync_({products:Array.isArray(catalog.products)?catalog.products:[]});
  if(!result||result.ok===false)throw new Error((result&&result.message)||"Pulled product catalog could not be written.");
  props.setProperty(ORA_PULL_CATALOG_VERSION_KEY,String(version));
  return {ok:true,status:"catalog_pulled",rows:Number(result.rows||0)};
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

  var catalogResult=oraStablePullCatalogIfChanged_(data.catalog_version,key,headers);
  var orders=Array.isArray(data.orders)?data.orders:[];
  if(!orders.length)return {ok:true,status:"pull_empty",count:0,catalog_status:catalogResult.status,catalog_rows:Number(catalogResult.rows||0),version:ORA_VERSION};

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
    catalog_status:catalogResult.status,
    catalog_rows:Number(catalogResult.rows||0),
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

// Replace setup only at the final layer. Permission is required BEFORE the
// installable trigger is created, so background runs never fail for missing
// UrlFetchApp authorization.
setupOraCallCenterSheet = function(){
  oraStableRequirePullPermissions_();
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw new Error("Open the target Google Sheet before running setupOraCallCenterSheet.");
  PropertiesService.getScriptProperties().setProperty(ORA_STABLE_SHEET_ID_KEY,ss.getId());
  PropertiesService.getScriptProperties().deleteProperty(ORA_PULL_CATALOG_VERSION_KEY);
  for(var i=0;i<ORA_STABLE_ORDER_SHEETS.length;i++)oraStableEnsureOrderSheet_(ss,ORA_STABLE_ORDER_SHEETS[i]);
  oraStableEnsureCatalog_(ss);
  if(!ss.getSheetByName("CITY LIST"))ss.insertSheet("CITY LIST");
  oraStableInstallPullTrigger_();
  var first=oraStablePullOrdersFromServer();
  var pullMessage=first.status==="pull_synced"?("Pulled "+Number(first.synced||0)+" order(s)"):"No pending orders";
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("O-RA V18.1 ready - "+pullMessage+".","O-RA",8);
  return first;
};
`;
