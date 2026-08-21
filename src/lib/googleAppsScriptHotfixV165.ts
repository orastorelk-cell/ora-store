export const GOOGLE_APPS_SCRIPT_HOTFIX_V165 = String.raw`
ORA_VERSION = "O-RA Store Google Sheet Sync V16.6 Direct";

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
  try{
    var hits=sh.getRange(2,idCol,sh.getLastRow()-1,1).createTextFinder(String(orderId||"").trim()).matchEntireCell(true).findAll();
    for(var i=0;i<hits.length;i++)out.push(hits[i].getRow());
  }catch(e){}
  out.sort(function(a,b){return a-b;});
  return out;
}

function oraDeleteKnownRowsV165_(sh, rows){
  if(!rows||!rows.length)return 0;
  var removed=0,end=rows.length-1;
  while(end>=0){
    var blockEnd=rows[end],blockStart=blockEnd;
    while(end>0&&rows[end-1]===blockStart-1){end--;blockStart=rows[end];}
    var count=blockEnd-blockStart+1;
    sh.deleteRows(blockStart,count);
    removed+=count;
    end--;
  }
  return removed;
}

function oraDirectValueV166_(src, header){
  if(src&&src[header]!==undefined&&src[header]!==null)return src[header];
  if(header==="Order ID")return oraPick_(src,["orderId","order_id","order_number","orderNo"]);
  if(header==="Customer Name")return oraPick_(src,["customerName","customer_name"]);
  if(header==="Phone Number")return oraPick_(src,["phoneNumber","phone_number","phone"]);
  if(header==="Address")return oraPick_(src,["address"]);
  if(header==="Item Name")return oraPick_(src,["itemName","item_name","product_name","name"]);
  if(header==="Item Code")return oraPick_(src,["itemCode","item_code","sku"]);
  if(header==="Qty")return oraPick_(src,["qty","quantity"]);
  if(header==="Unit Price (Rs)")return oraPick_(src,["unitPrice","unit_price","price"]);
  if(header==="Final Total (Rs)")return oraPick_(src,["finalTotal","final_total","total_amount","total"]);
  if(header==="Variant / Color")return oraPick_(src,["variantName","variant_name","variant","variantColor"]);
  if(header==="Discount (Rs)")return oraPick_(src,["discount","discount_amount","special_offer_discount"]);
  if(header==="Source")return oraPick_(src,["source","order_source"]);
  if(header==="Main Code")return oraPick_(src,["mainCode","main_code","main_sku","sku"]);
  if(header==="Line Total (Rs)")return oraPick_(src,["lineTotal","line_total"]);
  if(header==="Normal Total (Rs)")return oraPick_(src,["normalTotal","normal_total","subtotal"]);
  if(header==="Delivery Fee (Rs)")return oraPick_(src,["deliveryFee","delivery_fee"]);
  if(header==="WhatsApp Number")return oraPick_(src,["whatsAppNumber","whatsapp_number","whatsapp"]);
  if(header==="Order Time")return oraPick_(src,["orderTime","order_time","created_at"]);
  if(header==="Lead ID")return oraPick_(src,["leadId","lead_id","platform_lead_id"]);
  if(header==="Imported Status")return oraPick_(src,["importedStatus","imported_status","call_center_status"]);
  if(header==="City")return oraPick_(src,["city"]);
  if(header==="District")return oraPick_(src,["district"]);
  if(header==="Offer")return oraPick_(src,["offer","offer_label"]);
  return "";
}

function oraDirectSyncV166_(body){
  var ss=oraSpreadsheetV165_();
  var groups=(body&&body.groups&&typeof body.groups==="object")?body.groups:{};
  var sourceNames=[];
  for(var source in groups)if(Object.prototype.hasOwnProperty.call(groups,source))sourceNames.push(source);

  // Compatibility fallback for callers that send orders[] / order instead of groups.
  if(!sourceNames.length){
    var normalized=oraNormalizeIncoming_(body),rebuilt={};
    for(var n=0;n<normalized.length;n++){
      var o=normalized[n],srcName=String(o.source||"Website");
      if(!rebuilt[srcName])rebuilt[srcName]=[];
      for(var ii=0;ii<o.items.length;ii++){
        var it=o.items[ii],first=ii===0;
        rebuilt[srcName].push({
          "Order ID":o.id,"Customer Name":first?o.customer:"","Phone Number":first?o.phone:"","Address":first?o.address:"",
          "Item Name":it.name,"Item Code":it.code,"Qty":it.qty,"Unit Price (Rs)":it.unit,"Final Total (Rs)":first?o.finalTotal:"",
          "Variant / Color":it.variant,"Item Action":"KEEP ITEM","Order Action":first?"PENDING":"","Offer":first?o.offer:"",
          "Discount (Rs)":first?o.discount:"","Source":o.source,"Main Code":it.main,"Line Total (Rs)":it.line,
          "Normal Total (Rs)":first?o.normalTotal:"","Delivery Fee (Rs)":first?o.delivery:"","WhatsApp Number":first?o.whatsapp:"",
          "Order Time":first?o.orderTime:"","Lead ID":first?o.leadId:"","Imported Status":first?o.importedStatus:"","City":first?o.city:"","District":first?o.district:""
        });
      }
    }
    groups=rebuilt;sourceNames=[];for(var rs in groups)if(Object.prototype.hasOwnProperty.call(groups,rs))sourceNames.push(rs);
  }

  if(!sourceNames.length)return {ok:false,status:"error",message:"No order groups found in sync payload."};

  var syncedIds={},totalRows=0;
  for(var s=0;s<sourceNames.length;s++){
    var sourceName=sourceNames[s],incoming=Array.isArray(groups[sourceName])?groups[sourceName]:[];
    if(!incoming.length)continue;
    var sheetName=oraSheetName_(sourceName),sh=oraEnsureOrderSheet_(ss,sheetName),hm=oraHeaderMap_(sh),lastCol=sh.getLastColumn();

    // Replace any previous copy of the same order so retries never create duplicates.
    var idsForSheet={};
    for(var r=0;r<incoming.length;r++){
      var oid=String(oraDirectValueV166_(incoming[r],"Order ID")||"").trim();
      if(oid)idsForSheet[oid]=true;
    }
    for(var oidKey in idsForSheet){
      if(!Object.prototype.hasOwnProperty.call(idsForSheet,oidKey))continue;
      var oldRows=oraFindOrderRowsV165_(sh,oidKey);
      if(oldRows.length)oraDeleteKnownRowsV165_(sh,oldRows);
    }

    var output=[];
    var seenFirst={};
    for(var j=0;j<incoming.length;j++){
      var src=incoming[j]||{},orderId=String(oraDirectValueV166_(src,"Order ID")||"").trim();
      if(!orderId)continue;
      var first=!seenFirst[orderId];seenFirst[orderId]=true;syncedIds[orderId]=true;
      var row=new Array(lastCol).fill("");
      for(var h in hm){
        if(!Object.prototype.hasOwnProperty.call(hm,h))continue;
        var val=oraDirectValueV166_(src,h);
        if(h==="Item Action"&&!val)val="KEEP ITEM";
        if(h==="Order Action"&&!val&&first)val="PENDING";
        if(h==="Last Sync")val=new Date();
        if(h==="Original Main Code"&&!val)val=oraDirectValueV166_(src,"Main Code");
        if(h==="Original Variant / Color"&&!val)val=oraDirectValueV166_(src,"Variant / Color");
        if(h==="Original Item Code"&&!val)val=oraDirectValueV166_(src,"Item Code");
        if(h==="Original Item Name"&&!val)val=oraDirectValueV166_(src,"Item Name");
        if(h==="Original Qty"&&!val)val=oraDirectValueV166_(src,"Qty");
        row[hm[h]-1]=val===undefined||val===null?"":val;
      }
      output.push(row);
    }

    if(output.length){
      var start=sh.getLastRow()+1;
      sh.getRange(start,1,output.length,lastCol).setValues(output);
      totalRows+=output.length;
      // Group contiguous rows with the same Order ID. This is cosmetic only and
      // never blocks the write itself.
      try{
        var idCol=hm["Order ID"],blockStart=start,lastId="";
        for(var x=0;x<output.length;x++){
          var cur=String(output[x][idCol-1]||"");
          if(x===0){lastId=cur;blockStart=start;continue;}
          if(cur!==lastId){var count=(start+x)-blockStart;if(count>1)sh.getRange(blockStart,1,count,lastCol).shiftRowGroupDepth(1);blockStart=start+x;lastId=cur;}
        }
        var finalCount=start+output.length-blockStart;if(finalCount>1)sh.getRange(blockStart,1,finalCount,lastCol).shiftRowGroupDepth(1);
        sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
      }catch(groupErr){}
    }
  }

  var synced=0;for(var idKey in syncedIds)if(Object.prototype.hasOwnProperty.call(syncedIds,idKey))synced++;
  if(!totalRows)return {ok:false,status:"error",message:"Order payload reached Apps Script but contained no writable rows."};
  return {ok:true,status:"orders_synced",synced:synced,existing:0,rows:totalRows,version:ORA_VERSION};
}

// Final order entry point: bypass every older V16 writer/wrapper for order sync.
var doPostV166Base_=doPost;
doPost=function(e){
  try{
    if(!e||!e.postData||!e.postData.contents)return oraJson_({ok:false,status:"error",message:"Missing POST body"});
    var body=JSON.parse(e.postData.contents),action=String(body.action||body.type||body.payload_type||"").trim();
    if(action==="orders_sync"||action==="order_batch_sync"||action==="orders_batch_sync"||action==="order_sync"||action==="sync_order"||action==="sync_orders"){
      return oraJson_(oraDirectSyncV166_(body));
    }
    return doPostV166Base_(e);
  }catch(err){return oraJson_({ok:false,status:"error",message:String(err&&err.message?err.message:err),version:ORA_VERSION});}
};

function oraClearWebsiteTestsV165_(){
  var ss=oraSpreadsheetV165_(),sh=ss.getSheetByName("CALL CENTER ORDERS"),removed=0;
  if(!sh||sh.getLastRow()<2)return {ok:true,status:"website_test_orders_cleared",removed:0};
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"];
  if(!idCol)return {ok:true,status:"website_test_orders_cleared",removed:0};
  var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues(),rows=[];
  for(var i=0;i<ids.length;i++)if(oraKey_(ids[i][0]).indexOf("WEB-TEST-")===0)rows.push(i+2);
  removed=oraDeleteKnownRowsV165_(sh,rows);
  return {ok:true,status:"website_test_orders_cleared",removed:removed};
}

oraDeleteOrder_=function(body){
  var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();
  if(!id)return {ok:false,error:"Missing order ID"};
  if(/^WEB-TEST-/i.test(id)){var tr=oraClearWebsiteTestsV165_();return {ok:true,status:"order_deleted",deleted:tr.removed,removed:tr.removed,orderId:id};}
  var ss=oraSpreadsheetV165_(),removed=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);if(sh)removed+=oraDeleteRowsById_(sh,id,true);}
  return {ok:true,status:"order_deleted",deleted:removed,removed:removed,orderId:id};
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
  SpreadsheetApp.getActive().toast("O-RA V16.6 ready - direct order writer pinned to this spreadsheet.","O-RA",5);
};
`;
