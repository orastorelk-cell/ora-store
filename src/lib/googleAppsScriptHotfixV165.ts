export const GOOGLE_APPS_SCRIPT_HOTFIX_V165 = String.raw`
// ============================================================
// O-RA STORE - FINAL VERIFIED ORDER WRITER V16.6
// Hard-pinned to the production O-RA spreadsheet.
// This is the LAST layer in the generated Apps Script and therefore owns doPost.
// ============================================================
ORA_VERSION = "O-RA Store Google Sheet Sync V16.6 Verified";
var ORA_FINAL_SPREADSHEET_ID = "1NY5SJ-hSIQTGpAHMT4rz3TOPaQBao2dqL62nzb379m4";
var ORA_FINAL_ORDER_SHEETS = ["CALL CENTER ORDERS","FACEBOOK ORDERS","TIKTOK ORDERS"];

function oraFinalJson_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function oraFinalKey_(v){return String(v==null?"":v).trim().toUpperCase();}
function oraFinalNum_(v){var n=Number(v);return isFinite(n)?n:0;}
function oraFinalSheetName_(source){var s=String(source||"").toLowerCase();if(s.indexOf("facebook")>=0)return "FACEBOOK ORDERS";if(s.indexOf("tiktok")>=0)return "TIKTOK ORDERS";return "CALL CENTER ORDERS";}
function oraFinalSpreadsheet_(){return SpreadsheetApp.openById(ORA_FINAL_SPREADSHEET_ID);}

function oraFinalRows_(body){
  var rows=[];
  if(body&&body.groups&&typeof body.groups==="object"){
    for(var source in body.groups){
      if(!Object.prototype.hasOwnProperty.call(body.groups,source)||!Array.isArray(body.groups[source]))continue;
      for(var i=0;i<body.groups[source].length;i++){
        var r=body.groups[source][i]||{};
        if(!r.Source&&!r.source)r.Source=source;
        rows.push(r);
      }
    }
  }
  if(rows.length)return rows;

  var orders=[];
  if(Array.isArray(body&&body.orders))orders=body.orders;
  else if(body&&body.order)orders=[body.order];
  for(var n=0;n<orders.length;n++){
    var o=orders[n]||{},items=Array.isArray(o.items)&&o.items.length?o.items:[{}];
    for(var j=0;j<items.length;j++){
      var it=items[j]||{},first=j===0,qty=Math.max(1,oraFinalNum_(it.quantity||it.qty||1)),unit=oraFinalNum_(it.unit_price||it.unitPrice||it.price||0);
      rows.push({
        "Order ID":String(o.order_number||o.orderId||o.order_id||""),
        "Customer Name":first?String(o.customer_name||o.customerName||""):"",
        "Phone Number":first?String(o.phone||o.phone_number||""):"",
        "Address":first?String(o.address||""):"",
        "Item Name":String(it.product_name||it.item_name||it.name||""),
        "Item Code":String(it.sku||it.item_code||""),
        "Qty":qty,
        "Unit Price (Rs)":unit,
        "Final Total (Rs)":first?oraFinalNum_(o.total_amount||o.total||0):"",
        "Variant / Color":String(it.variant_name||it.variant||""),
        "Item Action":"KEEP ITEM",
        "Order Action":first?"PENDING":"",
        "Offer":first?String(o.offer||o.offer_label||"No Qty Offer"):"",
        "Discount (Rs)":first?oraFinalNum_(o.special_offer_discount||o.discount||0):"",
        "Source":String(o.order_source||o.source||"Website"),
        "Main Code":String(it.main_sku||it.sku||""),
        "Line Total (Rs)":oraFinalNum_(it.subtotal||qty*unit),
        "Normal Total (Rs)":first?oraFinalNum_(o.subtotal||0):"",
        "Delivery Fee (Rs)":first?oraFinalNum_(o.delivery_fee||0):"",
        "WhatsApp Number":first?String(o.whatsapp||o.phone||""):"",
        "Original Main Code":String(it.main_sku||it.sku||""),
        "Original Variant / Color":String(it.variant_name||it.variant||""),
        "Original Item Code":String(it.sku||it.item_code||""),
        "Original Item Name":String(it.product_name||it.item_name||it.name||""),
        "Original Qty":qty,
        "Order Time":first?String(o.created_at||new Date().toISOString()):"",
        "Lead ID":first?String(o.platform_lead_id||""):"",
        "Imported Status":first?String(o.call_center_status||"Pending"):"",
        "City":first?String(o.city||""):"",
        "District":first?String(o.district||""):""
      });
    }
  }
  return rows;
}

function oraFinalHeaderMap_(sh){var vals=sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getDisplayValues()[0],m={};for(var i=0;i<vals.length;i++)m[String(vals[i]||"").trim()]=i+1;return m;}
function oraFinalEnsureSheet_(ss,name){
  var sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);
  var headers=["Order ID","Customer Name","Phone Number","Address","Item Name","Item Code","Qty","Unit Price (Rs)","Final Total (Rs)","Variant / Color","Item Action","Order Action","Offer","Cancel Reason","Change Item To","Change Preview","Apply Item Change","Discount (Rs)","Source","Main Code","Line Total (Rs)","Normal Total (Rs)","Delivery Fee (Rs)","WhatsApp Number","Original Main Code","Original Variant / Color","Original Item Code","Original Item Name","Original Qty","Order Time","Lead ID","Imported Status","Last Sync","City","District"];
  if(sh.getMaxColumns()<headers.length)sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());
  if(sh.getLastRow()<1)sh.getRange(1,1,1,headers.length).setValues([headers]);
  var existing=sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getDisplayValues()[0];
  for(var h=0;h<headers.length;h++)if(existing.indexOf(headers[h])<0){var col=sh.getLastColumn()+1;if(sh.getMaxColumns()<col)sh.insertColumnAfter(sh.getMaxColumns());sh.getRange(1,col).setValue(headers[h]);existing.push(headers[h]);}
  sh.setFrozenRows(1);return sh;
}

function oraFinalDeleteOrderRows_(sh,id){
  var hm=oraFinalHeaderMap_(sh),c=hm["Order ID"];if(!c||sh.getLastRow()<2)return 0;
  var vals=sh.getRange(2,c,sh.getLastRow()-1,1).getDisplayValues(),wanted=oraFinalKey_(id),removed=0;
  for(var i=vals.length-1;i>=0;i--)if(oraFinalKey_(vals[i][0])===wanted){sh.deleteRow(i+2);removed++;}
  return removed;
}

function oraFinalWriteOrders_(body){
  var ss=oraFinalSpreadsheet_(),flat=oraFinalRows_(body);
  if(!flat.length)return {ok:false,status:"error",message:"No writable order rows in payload.",version:ORA_VERSION,targetSheetId:ORA_FINAL_SPREADSHEET_ID};
  var bySheet={},ids={};
  for(var i=0;i<flat.length;i++){
    var r=flat[i]||{},id=String(r["Order ID"]||r.order_number||r.orderId||"").trim();if(!id)continue;
    var sn=oraFinalSheetName_(r.Source||r.source||"Website");if(!bySheet[sn])bySheet[sn]=[];bySheet[sn].push(r);ids[id]=true;
  }
  var written=0;
  for(var name in bySheet){
    if(!Object.prototype.hasOwnProperty.call(bySheet,name))continue;
    var sh=oraFinalEnsureSheet_(ss,name),hm=oraFinalHeaderMap_(sh),lastCol=sh.getLastColumn(),incoming=bySheet[name];
    var deleteIds={};for(var d=0;d<incoming.length;d++){var did=String(incoming[d]["Order ID"]||"").trim();if(did)deleteIds[did]=true;}
    for(var did2 in deleteIds)if(Object.prototype.hasOwnProperty.call(deleteIds,did2))oraFinalDeleteOrderRows_(sh,did2);
    var out=[],seen={};
    for(var x=0;x<incoming.length;x++){
      var src=incoming[x],oid=String(src["Order ID"]||"").trim(),first=!seen[oid];seen[oid]=true,row=new Array(lastCol).fill("");
      for(var key in hm){if(!Object.prototype.hasOwnProperty.call(hm,key))continue;var v=src[key];
        if(key==="Item Action"&&!v)v="KEEP ITEM";
        if(key==="Order Action"&&!v&&first)v="PENDING";
        if(key==="Offer"&&!v&&first)v="No Qty Offer";
        if(key==="Last Sync")v=new Date();
        row[hm[key]-1]=(v===undefined||v===null)?"":v;
      }
      out.push(row);
    }
    if(out.length){var start=sh.getLastRow()+1;sh.getRange(start,1,out.length,lastCol).setValues(out);written+=out.length;
      if(out.length>1){try{sh.getRange(start,1,out.length,lastCol).shiftRowGroupDepth(1);sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);}catch(e){}}
    }
  }
  SpreadsheetApp.flush();

  // Read-back verification: never report synced unless every incoming Order ID is
  // physically present in the expected production order tab after the write.
  var verified=0,missing=[];
  for(var oid2 in ids){
    if(!Object.prototype.hasOwnProperty.call(ids,oid2))continue;
    var found=false;
    for(var s=0;s<ORA_FINAL_ORDER_SHEETS.length&&!found;s++){
      var sh2=ss.getSheetByName(ORA_FINAL_ORDER_SHEETS[s]);if(!sh2||sh2.getLastRow()<2)continue;
      var hm2=oraFinalHeaderMap_(sh2),c2=hm2["Order ID"];if(!c2)continue;
      var hit=sh2.getRange(2,c2,sh2.getLastRow()-1,1).createTextFinder(oid2).matchEntireCell(true).findNext();if(hit)found=true;
    }
    if(found)verified++;else missing.push(oid2);
  }
  if(missing.length)return {ok:false,status:"error",message:"Sheet write verification failed for: "+missing.join(", "),rows:written,verified:verified,version:ORA_VERSION,targetSheetId:ORA_FINAL_SPREADSHEET_ID};
  return {ok:true,status:"orders_synced",synced:verified,rows:written,existing:0,verified:verified,version:ORA_VERSION,targetSheetId:ORA_FINAL_SPREADSHEET_ID};
}

var oraFinalPreviousDoPost_ = doPost;
doPost = function(e){
  try{
    var body=JSON.parse((e&&e.postData&&e.postData.contents)||"{}"),action=String(body.action||body.type||body.payload_type||"").trim();
    if(action==="sync_orders"||action==="orders_sync"||action==="order_sync"||action==="sync_order"||action==="order_batch_sync"||action==="orders_batch_sync")return oraFinalJson_(oraFinalWriteOrders_(body));
    if(action==="health"||action==="ping")return oraFinalJson_({ok:true,status:"ok",version:ORA_VERSION,targetSheetId:ORA_FINAL_SPREADSHEET_ID});
    return oraFinalPreviousDoPost_(e);
  }catch(err){return oraFinalJson_({ok:false,status:"error",message:String(err&&err.message?err.message:err),version:ORA_VERSION,targetSheetId:ORA_FINAL_SPREADSHEET_ID});}
};

doGet = function(){return oraFinalJson_({ok:true,status:"ok",service:"O-RA Google Sheet Sync",version:ORA_VERSION,targetSheetId:ORA_FINAL_SPREADSHEET_ID,timestamp:new Date().toISOString()});};

var setupOraCallCenterSheetV166Base_ = setupOraCallCenterSheet;
setupOraCallCenterSheet = function(){
  try{setupOraCallCenterSheetV166Base_();}catch(e){}
  var ss=oraFinalSpreadsheet_();for(var i=0;i<ORA_FINAL_ORDER_SHEETS.length;i++)oraFinalEnsureSheet_(ss,ORA_FINAL_ORDER_SHEETS[i]);SpreadsheetApp.flush();
  try{ss.toast("O-RA V16.6 Verified - production order tabs pinned.","O-RA",6);}catch(e){}
};
`;
