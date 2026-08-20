export const GOOGLE_APPS_SCRIPT_CLEAN_V17 = String.raw`
// ============================================================
// O-RA STORE - CLEAN GOOGLE SHEET ENGINE V17
// Single-file order sync. No legacy wrapper chain. No installable triggers.
// ============================================================
var ORA_VERSION = 'O-RA Store Google Sheet Sync V17 Clean';
var ORA_ORDER_SHEETS = ['CALL CENTER ORDERS','FACEBOOK ORDERS','TIKTOK ORDERS'];
var ORA_CITY_TAB = 'CITY LIST';
var ORA_CATALOG_TAB = 'PRODUCT CATALOG';
var ORA_DELETED_TAB = 'DELETED ORDERS';

var ORA_ORDER_HEADERS = [
  'Order ID','Customer Name','Phone Number','Address','Item Name','Item Code','Qty','Unit Price (Rs)','Final Total (Rs)','Variant / Color',
  'Item Action','Order Action','Offer','Cancel Reason','Change Item To','Change Preview','Apply Item Change','Discount (Rs)','Source','Main Code',
  'Line Total (Rs)','Normal Total (Rs)','Delivery Fee (Rs)','WhatsApp Number','Original Main Code','Original Variant / Color','Original Item Code',
  'Original Item Name','Original Qty','Order Time','Imported Status','Last Sync','City','District'
];

var ORA_CATALOG_HEADERS = ['Item Image','Main Code','Variant Code','Item Name','Variant / Color','Type','Selling Price (Rs)','Current Stock','Status','Image URL','Select Product / Variant','Last Updated'];

function oraJson_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function oraStr_(v){return v===null||v===undefined?'':String(v);}
function oraKey_(v){return oraStr_(v).trim().toUpperCase();}

function oraSheetNameForSource_(source){
  var s=oraKey_(source);
  if(s.indexOf('FACEBOOK')>=0 || s==='FB')return 'FACEBOOK ORDERS';
  if(s.indexOf('TIKTOK')>=0 || s==='TK')return 'TIKTOK ORDERS';
  return 'CALL CENTER ORDERS';
}

function oraHeaderMap_(sh){
  var out={};
  if(!sh || sh.getLastColumn()<1)return out;
  var vals=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  for(var i=0;i<vals.length;i++){var h=oraStr_(vals[i]).trim();if(h)out[h]=i+1;}
  return out;
}

function oraEnsureSheet_(ss,name,headers){
  var sh=ss.getSheetByName(name);
  if(!sh)sh=ss.insertSheet(name);
  if(sh.getLastColumn()<headers.length)sh.insertColumnsAfter(Math.max(1,sh.getLastColumn()),headers.length-sh.getLastColumn());
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  try{sh.getRange(1,1,1,headers.length).setFontWeight('bold');}catch(e){}
  return sh;
}

function oraSetupValidations_(sh,start,count){
  if(!sh || !count)return;
  var hm=oraHeaderMap_(sh);
  try{if(hm['Item Action'])sh.getRange(start,hm['Item Action'],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['KEEP ITEM','CANCEL ITEM'],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm['Order Action'])sh.getRange(start,hm['Order Action'],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['PENDING','CONFIRM ORDER','CANCEL ENTIRE ORDER'],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm['Apply Item Change'])sh.getRange(start,hm['Apply Item Change'],count,1).insertCheckboxes();}catch(e){}
}

function setupOraCallCenterSheet(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw new Error('Open the target Google Sheet first, then run setupOraCallCenterSheet.');
  PropertiesService.getScriptProperties().setProperty('ORA_SPREADSHEET_ID',ss.getId());
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=oraEnsureSheet_(ss,ORA_ORDER_SHEETS[i],ORA_ORDER_HEADERS);
    oraSetupValidations_(sh,2,Math.max(1,sh.getMaxRows()-1));
    try{sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}
  }
  oraEnsureSheet_(ss,ORA_CATALOG_TAB,ORA_CATALOG_HEADERS);
  var city=ss.getSheetByName(ORA_CITY_TAB)||ss.insertSheet(ORA_CITY_TAB);
  if(city.getLastRow()===0)city.getRange(1,1,1,2).setValues([['City','District']]);
  city.setFrozenRows(1);
  oraEnsureSheet_(ss,ORA_DELETED_TAB,ORA_ORDER_HEADERS);
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast('O-RA V17 Clean ready. Paste City / District list into CITY LIST.','O-RA',6);
  return true;
}

function oraSpreadsheet_(){
  var id=oraStr_(PropertiesService.getScriptProperties().getProperty('ORA_SPREADSHEET_ID')).trim();
  if(id){try{return SpreadsheetApp.openById(id);}catch(e){}}
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw new Error('Sheet is not connected. Run setupOraCallCenterSheet once from the target spreadsheet.');
  PropertiesService.getScriptProperties().setProperty('ORA_SPREADSHEET_ID',ss.getId());
  return ss;
}

function oraCityDistrict_(ss,cityName){
  var wanted=oraStr_(cityName).trim();
  if(!wanted)return '';
  var sh=ss.getSheetByName(ORA_CITY_TAB);
  if(!sh || sh.getLastRow()<2)return '';
  try{
    var hit=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(wanted).matchEntireCell(true).matchCase(false).findNext();
    return hit?oraStr_(sh.getRange(hit.getRow(),2).getDisplayValue()).trim():'';
  }catch(e){return '';}
}

function oraFindRows_(sh,orderId){
  var hm=oraHeaderMap_(sh),col=hm['Order ID'],out=[];
  if(!col || sh.getLastRow()<2)return out;
  var target=oraStr_(orderId).trim();
  if(!target)return out;
  try{
    var hits=sh.getRange(2,col,sh.getLastRow()-1,1).createTextFinder(target).matchEntireCell(true).matchCase(false).findAll();
    for(var i=0;i<hits.length;i++)out.push(hits[i].getRow());
  }catch(e){}
  out.sort(function(a,b){return a-b;});
  return out;
}

function oraCaptureActions_(sh,rows){
  var out={orderAction:'PENDING',items:{}};
  if(!rows.length)return out;
  var hm=oraHeaderMap_(sh),first=rows[0],last=rows[rows.length-1];
  var vals=sh.getRange(first,1,last-first+1,sh.getLastColumn()).getDisplayValues();
  for(var i=0;i<rows.length;i++){
    var row=vals[rows[i]-first]||[];
    if(hm['Order Action'] && row[hm['Order Action']-1])out.orderAction=row[hm['Order Action']-1];
    var key=oraKey_((hm['Item Code']?row[hm['Item Code']-1]:'')+'|'+(hm['Variant / Color']?row[hm['Variant / Color']-1]:''));
    if(key && hm['Item Action'] && row[hm['Item Action']-1])out.items[key]=row[hm['Item Action']-1];
  }
  return out;
}

function oraDeleteRows_(sh,rows,moveToDeleted){
  if(!rows.length)return 0;
  if(moveToDeleted){
    var ss=sh.getParent(),del=oraEnsureSheet_(ss,ORA_DELETED_TAB,ORA_ORDER_HEADERS),moved=[];
    for(var m=0;m<rows.length;m++)moved.push(sh.getRange(rows[m],1,1,Math.min(sh.getLastColumn(),ORA_ORDER_HEADERS.length)).getValues()[0]);
    if(moved.length)del.getRange(del.getLastRow()+1,1,moved.length,ORA_ORDER_HEADERS.length).setValues(moved);
  }
  var end=rows.length-1;
  while(end>=0){
    var blockEnd=rows[end],blockStart=blockEnd;
    while(end>0 && rows[end-1]===blockStart-1){end--;blockStart=rows[end];}
    sh.deleteRows(blockStart,blockEnd-blockStart+1);
    end--;
  }
  return rows.length;
}

function oraGroupPayload_(body){
  var groups=body && body.groups && typeof body.groups==='object'?body.groups:{};
  var orders=[];
  Object.keys(groups).forEach(function(source){
    var rows=Array.isArray(groups[source])?groups[source]:[];
    var byId={},sequence=[];
    for(var i=0;i<rows.length;i++){
      var row=rows[i]&&typeof rows[i]==='object'?rows[i]:{};
      var id=oraStr_(row['Order ID']||row.order_id||row.order_number).trim();
      if(!id)continue;
      if(!byId[id]){byId[id]=[];sequence.push(id);}
      byId[id].push(row);
    }
    for(var j=0;j<sequence.length;j++)orders.push({source:source,id:sequence[j],rows:byId[sequence[j]]});
  });
  return orders;
}

function oraWriteOrderRows_(ss,order){
  var sh=oraEnsureSheet_(ss,oraSheetNameForSource_(order.source),ORA_ORDER_HEADERS);
  var oldRows=oraFindRows_(sh,order.id),actions=oraCaptureActions_(sh,oldRows);
  if(oldRows.length)oraDeleteRows_(sh,oldRows,false);
  var hm=oraHeaderMap_(sh),out=[];
  for(var i=0;i<order.rows.length;i++){
    var incoming=order.rows[i]||{},first=i===0,row=new Array(ORA_ORDER_HEADERS.length).fill('');
    for(var h=0;h<ORA_ORDER_HEADERS.length;h++){
      var header=ORA_ORDER_HEADERS[h];
      if(Object.prototype.hasOwnProperty.call(incoming,header))row[h]=incoming[header];
    }
    row[hm['Order ID']-1]=order.id;
    var itemKey=oraKey_(oraStr_(incoming['Item Code'])+'|'+oraStr_(incoming['Variant / Color']));
    if(hm['Item Action'])row[hm['Item Action']-1]=actions.items[itemKey]||oraStr_(incoming['Item Action'])||'KEEP ITEM';
    if(hm['Order Action'])row[hm['Order Action']-1]=first?(actions.orderAction||oraStr_(incoming['Order Action'])||'PENDING'):'';
    if(hm['Last Sync'])row[hm['Last Sync']-1]=new Date();
    if(first && hm['District'] && !oraStr_(row[hm['District']-1]).trim() && hm['City']){
      var district=oraCityDistrict_(ss,row[hm['City']-1]);
      if(district)row[hm['District']-1]=district;
    }
    out.push(row);
  }
  if(!out.length)return 0;
  var start=sh.getLastRow()+1;
  sh.getRange(start,1,out.length,ORA_ORDER_HEADERS.length).setValues(out);
  oraSetupValidations_(sh,start,out.length);
  if(out.length>1){
    try{sh.getRange(start,1,out.length,ORA_ORDER_HEADERS.length).shiftRowGroupDepth(1);sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}
  }
  return out.length;
}

function oraSyncOrders_(body){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))return {ok:false,status:'busy',error:'Sheet is busy. Retry.'};
  try{
    var ss=oraSpreadsheet_(),orders=oraGroupPayload_(body);
    if(!orders.length)return {ok:false,status:'orders_sync_empty',error:'No valid order rows received.',synced:0,rows:0};
    var written=0;
    for(var i=0;i<orders.length;i++)written+=oraWriteOrderRows_(ss,orders[i]);
    SpreadsheetApp.flush();
    return {ok:true,status:'orders_synced',synced:orders.length,existing:0,rows:written,version:ORA_VERSION};
  }catch(e){return {ok:false,status:'orders_sync_failed',error:oraStr_(e&&e.message?e.message:e)};}
  finally{try{lock.releaseLock();}catch(e){}}
}

function oraDeleteOrder_(body){
  var id=oraStr_(body.orderId||body.order_id||body.order_number||body.id).trim();
  if(!id)return {ok:false,error:'Missing order ID'};
  var ss=oraSpreadsheet_(),removed=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if(sh)removed+=oraDeleteRows_(sh,oraFindRows_(sh,id),true);
  }
  SpreadsheetApp.flush();
  return {ok:true,status:'order_deleted',removed:removed,deleted:removed,orderId:id};
}

function oraClearTests_(){
  var ss=oraSpreadsheet_(),removed=0;
  for(var s=0;s<ORA_ORDER_SHEETS.length;s++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[s]);
    if(!sh||sh.getLastRow()<2)continue;
    var hm=oraHeaderMap_(sh),col=hm['Order ID'];if(!col)continue;
    var ids=sh.getRange(2,col,sh.getLastRow()-1,1).getDisplayValues(),rows=[];
    for(var i=0;i<ids.length;i++){var id=oraKey_(ids[i][0]);if(id.indexOf('WEB-TEST-')===0||id.indexOf('TEST-FB-')===0||id.indexOf('TEST-TK-')===0)rows.push(i+2);}
    removed+=oraDeleteRows_(sh,rows,false);
  }
  SpreadsheetApp.flush();
  return {ok:true,status:'test_orders_cleared',removed:removed};
}

function oraClearAll_(){
  var ss=oraSpreadsheet_(),removed=0;
  for(var s=0;s<ORA_ORDER_SHEETS.length;s++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[s]);
    if(sh&&sh.getLastRow()>1){removed+=sh.getLastRow()-1;sh.deleteRows(2,sh.getLastRow()-1);}
  }
  SpreadsheetApp.flush();
  return {ok:true,status:'operational_cleared',removed:removed};
}

function oraCatalogSync_(body){
  var products=Array.isArray(body.products)?body.products:[],ss=oraSpreadsheet_(),sh=oraEnsureSheet_(ss,ORA_CATALOG_TAB,ORA_CATALOG_HEADERS),rows=[];
  for(var i=0;i<products.length;i++){
    var p=products[i]||{},type=oraStr_(p.product_type||p.type||'normal'),variants=Array.isArray(p.variants)&&p.variants.length?p.variants:[null];
    for(var v=0;v<variants.length;v++){
      var vr=variants[v],main=oraStr_(p.sku),code=oraStr_(vr&&vr.sku?vr.sku:main),name=oraStr_(p.name_en||p.name),variant=oraStr_(vr&&(vr.option_value||vr.name)),price=Number(vr&&vr.selling_price!==undefined?vr.selling_price:p.selling_price||0),stock=Number(vr&&vr.stock_quantity!==undefined?vr.stock_quantity:p.stock_quantity||0),image=oraStr_(vr&&vr.image?vr.image:(Array.isArray(p.images)?p.images[0]:p.image_url||''));
      rows.push(['',main,code,name,variant,type,price,stock,oraStr_(vr&&vr.status?vr.status:p.status||'Active'),image,[code,name,variant].filter(Boolean).join(' - '),new Date()]);
    }
  }
  if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
  if(rows.length){
    sh.getRange(2,1,rows.length,ORA_CATALOG_HEADERS.length).setValues(rows);
    for(var r=0;r<rows.length;r++){var url=oraStr_(rows[r][9]).trim();if(url)try{sh.getRange(r+2,1).setFormula('=IFERROR(IMAGE("'+url.replace(/"/g,'')+'",4,70,70),"")');}catch(e){}}
  }
  SpreadsheetApp.flush();
  return {ok:true,status:'catalog_synced',rows:rows.length};
}

function doPost(e){
  try{
    var body=e&&e.postData&&e.postData.contents?JSON.parse(e.postData.contents):{};
    var action=oraStr_(body.action||body.type).trim().toLowerCase();
    var result;
    if(action==='sync_orders'||action==='orders_sync'||action==='order_sync'||action==='orders_batch_sync')result=oraSyncOrders_(body);
    else if(action==='delete_order')result=oraDeleteOrder_(body);
    else if(action==='clear_test_orders')result=oraClearTests_();
    else if(action==='clear_live_start_data'||action==='clear_orders'||action==='clear_all_orders')result=oraClearAll_();
    else if(action==='catalog_sync')result=oraCatalogSync_(body);
    else result={ok:false,status:'unknown_action',error:'Unknown action: '+action};
    return oraJson_(result);
  }catch(e){return oraJson_({ok:false,status:'error',error:oraStr_(e&&e.message?e.message:e),version:ORA_VERSION});}
}

function doGet(){return oraJson_({ok:true,status:'ok',service:'O-RA Google Sheet Sync',version:ORA_VERSION,timestamp:new Date().toISOString()});}

// Simple trigger; no installable trigger required. Exact City match fills District.
function onEdit(e){
  try{
    if(!e||!e.range)return;
    var sh=e.range.getSheet();if(ORA_ORDER_SHEETS.indexOf(sh.getName())<0||e.range.getRow()<2)return;
    var hm=oraHeaderMap_(sh);if(!hm['City']||e.range.getColumn()!==hm['City'])return;
    var district=oraCityDistrict_(sh.getParent(),e.range.getDisplayValue());
    if(hm['District'])sh.getRange(e.range.getRow(),hm['District']).setValue(district||'');
  }catch(err){}
}
`;
