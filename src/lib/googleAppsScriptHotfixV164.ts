export const GOOGLE_APPS_SCRIPT_HOTFIX_V164 = String.raw`
// ============================================================
// O-RA STORE - GOOGLE SHEET SPEED / GROUP / CITY HOTFIX V16.4
// Requires V16.1 + V16.2 + V16.3 above this code.
// ============================================================
ORA_VERSION = "O-RA Store Google Sheet Sync V16.4";

function oraFastCityMatchV164_(ss, cityName){
  var wanted=String(cityName||"").trim();
  if(!wanted)return null;
  var fast=oraFastCitySheet_(ss);
  if(!fast||fast.getLastRow()<2)return null;
  try{
    var hit=fast.getRange(2,1,fast.getLastRow()-1,1).createTextFinder(wanted).matchEntireCell(true).findNext();
    if(!hit)return null;
    return {city:String(hit.getDisplayValue()||"").trim(),district:String(fast.getRange(hit.getRow(),2).getDisplayValue()||"").trim()};
  }catch(e){return null;}
}

oraApplyValidations_ = function(ss,sh,start,count){
  if(!count)return;var hm=oraHeaderMap_(sh);
  try{if(hm["Item Action"])sh.getRange(start,hm["Item Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["KEEP ITEM","CANCEL ITEM"],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm["Order Action"])sh.getRange(start,hm["Order Action"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["PENDING","CONFIRM ORDER","CANCEL ENTIRE ORDER"],true).setAllowInvalid(false).build());}catch(e){}
  try{if(hm["Apply Item Change"])sh.getRange(start,hm["Apply Item Change"],count,1).insertCheckboxes();}catch(e){}
};

oraWriteOrder_ = function(ss,o){
  var sh=oraEnsureOrderSheet_(ss,oraSheetName_(o.source));
  var actions=oraCaptureActions_(sh,o.id);
  if(actions.rows&&actions.rows.length)oraDeleteRowsById_(sh,o.id,false,actions.rows);

  if(!o.district&&o.city){var cityMatch=oraFastCityMatchV164_(ss,o.city);if(cityMatch)o.district=cityMatch.district;}

  var hm=oraHeaderMap_(sh),rows=[],lastCol=sh.getLastColumn();
  for(var i=0;i<o.items.length;i++){
    var it=o.items[i],first=i===0,row=[];
    for(var c=1;c<=lastCol;c++)row.push("");
    function set(h,v){if(hm[h])row[hm[h]-1]=v;}
    var itemKey=oraKey_(it.code+"|"+it.variant);
    set("Order ID",o.id);set("Customer Name",first?o.customer:"");set("Phone Number",first?o.phone:"");set("Address",first?o.address:"");
    set("Item Name",it.name);set("Item Code",it.code);set("Qty",it.qty);set("Unit Price (Rs)",it.unit);set("Variant / Color",it.variant);
    set("Item Action",actions.items[itemKey]||"KEEP ITEM");set("Order Action",first?(actions.orderAction||"PENDING"):"");
    set("Offer",it.offer||o.offer||"No Qty Offer");set("Discount (Rs)",Math.round(Number(it.discount||0)*100)/100);
    set("Source",o.source);set("Main Code",it.main);set("Line Total (Rs)",it.line);set("Final Total (Rs)",first?o.finalTotal:"");
    set("Normal Total (Rs)",first?o.normalTotal:"");set("Delivery Fee (Rs)",first?o.delivery:"");set("WhatsApp Number",first?o.whatsapp:"");
    set("Original Main Code",it.main);set("Original Variant / Color",it.variant);set("Original Item Code",it.code);set("Original Item Name",it.name);set("Original Qty",it.qty);
    set("Order Time",first?o.orderTime:"");set("Lead ID",first?o.leadId:"");set("Imported Status",first?o.importedStatus:"");set("Last Sync",new Date());
    set("City",first?o.city:"");set("District",first?o.district:"");
    rows.push(row);
  }
  if(!rows.length)return 0;

  var start=sh.getLastRow()+1;
  sh.getRange(start,1,rows.length,lastCol).setValues(rows);
  oraApplyValidations_(ss,sh,start,rows.length);

  if(rows.length>1){
    try{
      sh.getRange(start,1,rows.length,lastCol).shiftRowGroupDepth(1);
      sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
    }catch(e){}
  }
  try{sh.getRange(start,1,rows.length,lastCol).setBorder(true,null,true,null,null,null,"#64748b",SpreadsheetApp.BorderStyle.SOLID_MEDIUM);}catch(e){}
  return rows.length;
};

oraSync_ = function(body){
  var lock=LockService.getDocumentLock();
  if(!lock.tryLock(2500))return {ok:false,error:"Sheet is busy. Please retry."};
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet(),orders=oraNormalizeIncoming_(body),rows=0;
    for(var i=0;i<orders.length;i++)rows+=oraWriteOrder_(ss,orders[i]);
    return {ok:true,status:"orders_synced",synced:orders.length,existing:0,rows:rows,version:ORA_VERSION};
  }finally{lock.releaseLock();}
};

var setupOraCallCenterSheetV163_ = setupOraCallCenterSheet;
setupOraCallCenterSheet = function(){
  setupOraCallCenterSheetV163_();
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var fast=oraBuildFastCityList_(ss);
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);if(!sh)continue;
    var hm=oraHeaderMap_(sh),count=Math.max(1,sh.getMaxRows()-1);
    try{if(fast&&fast.getLastRow()>1&&hm["City"])sh.getRange(2,hm["City"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(fast.getRange(2,1,fast.getLastRow()-1,1),true).setAllowInvalid(true).build());}catch(e){}
    try{var cat=ss.getSheetByName(ORA_CATALOG_TAB);if(cat&&cat.getLastRow()>1&&hm["Change Item To"])sh.getRange(2,hm["Change Item To"],count,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange(2,11,cat.getLastRow()-1,1),true).setAllowInvalid(false).build());}catch(e){}
    try{sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}
  }
  SpreadsheetApp.getActive().toast("O-RA V16.4 ready - fast sync, grouped orders, strict City selection.","O-RA",5);
};

var onEditV164Base_ = onEdit;
onEdit = function(e){
  try{
    var sh=e&&e.range?e.range.getSheet():null;
    if(sh&&ORA_ORDER_SHEETS.indexOf(sh.getName())>=0&&e.range.getRow()>=2){
      var hm=oraHeaderMap_(sh);
      if(hm["City"]&&e.range.getColumn()===hm["City"]){
        var typed=String(e.value==null?"":e.value).trim();
        var oldCity=String(e.oldValue==null?"":e.oldValue).trim();
        var match=oraFastCityMatchV164_(sh.getParent(),typed);
        if(!match){
          if(oldCity) e.range.setValue(oldCity); else e.range.clearContent();
          return;
        }
        e.range.setValue(match.city);
        if(hm["District"])sh.getRange(e.range.getRow(),hm["District"]).setValue(match.district||"");
        return;
      }
    }
  }catch(err){}
  try{onEditV164Base_(e);}catch(err){}
};
`;