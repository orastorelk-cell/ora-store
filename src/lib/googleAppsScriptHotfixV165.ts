export const GOOGLE_APPS_SCRIPT_HOTFIX_V165 = String.raw`
ORA_VERSION = "O-RA Store Google Sheet Sync V16.5";

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
  var sheetName=oraSheetName_(o.source),sh=ss.getSheetByName(sheetName);if(!sh)sh=oraEnsureOrderSheet_(ss,sheetName);
  var oldRows=oraFindOrderRowsV165_(sh,o.id),actions=oraCaptureActionsRowsV165_(sh,oldRows);if(oldRows.length)oraDeleteKnownRowsV165_(sh,oldRows);
  if(!o.district&&o.city){var cityMatch=oraFastCityMatchV164_(ss,o.city);if(cityMatch)o.district=cityMatch.district;}
  var hm=oraHeaderMap_(sh),rows=[],lastCol=sh.getLastColumn();
  for(var i=0;i<o.items.length;i++){var it=o.items[i],first=i===0,row=new Array(lastCol).fill("");function set(h,v){if(hm[h])row[hm[h]-1]=v;}var itemKey=oraKey_(it.code+"|"+it.variant);set("Order ID",o.id);set("Customer Name",first?o.customer:"");set("Phone Number",first?o.phone:"");set("Address",first?o.address:"");set("Item Name",it.name);set("Item Code",it.code);set("Qty",it.qty);set("Unit Price (Rs)",it.unit);set("Variant / Color",it.variant);set("Item Action",actions.items[itemKey]||"KEEP ITEM");set("Order Action",first?(actions.orderAction||"PENDING"):"");set("Offer",it.offer||o.offer||"No Qty Offer");set("Discount (Rs)",Math.round(Number(it.discount||0)*100)/100);set("Source",o.source);set("Main Code",it.main);set("Line Total (Rs)",it.line);set("Final Total (Rs)",first?o.finalTotal:"");set("Normal Total (Rs)",first?o.normalTotal:"");set("Delivery Fee (Rs)",first?o.delivery:"");set("WhatsApp Number",first?o.whatsapp:"");set("Original Main Code",it.main);set("Original Variant / Color",it.variant);set("Original Item Code",it.code);set("Original Item Name",it.name);set("Original Qty",it.qty);set("Order Time",first?o.orderTime:"");set("Lead ID",first?o.leadId:"");set("Imported Status",first?o.importedStatus:"");set("Last Sync",new Date());set("City",first?o.city:"");set("District",first?o.district:"");rows.push(row);}
  if(!rows.length)return 0;var start=sh.getLastRow()+1;sh.getRange(start,1,rows.length,lastCol).setValues(rows);if(rows.length>1){try{sh.getRange(start,1,rows.length,lastCol).shiftRowGroupDepth(1);sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}}return rows.length;
};

function oraClearWebsiteTestsV165_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName("CALL CENTER ORDERS"),removed=0;if(!sh||sh.getLastRow()<2)return {ok:true,status:"website_test_orders_cleared",removed:0};
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"];if(!idCol)return {ok:true,status:"website_test_orders_cleared",removed:0};var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues(),rows=[];for(var i=0;i<ids.length;i++)if(oraKey_(ids[i][0]).indexOf("WEB-TEST-")===0)rows.push(i+2);removed=oraDeleteKnownRowsV165_(sh,rows);return {ok:true,status:"website_test_orders_cleared",removed:removed};
}

var oraDeleteOrderV165Base_=oraDeleteOrder_;
oraDeleteOrder_=function(body){var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();if(/^WEB-TEST-/i.test(id)){var r=oraClearWebsiteTestsV165_();return {ok:true,status:"order_deleted",deleted:r.removed,removed:r.removed,orderId:id};}return oraDeleteOrderV165Base_(body);};
`;
