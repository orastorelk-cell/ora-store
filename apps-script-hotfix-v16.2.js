// O-RA STORE Google Sheet Hotfix V16.2
// Append this BELOW the existing V16.1 Apps Script, save, and deploy a new version.
// Fixes: faster sync, atomic multi-row delete, per-item Offer + Discount rows.

ORA_VERSION = "O-RA Store Google Sheet Sync V16.2";

oraNormalizeIncoming_ = function(body){
  var flat=[];
  if(body&&body.groups){for(var g in body.groups){if(Array.isArray(body.groups[g]))flat=flat.concat(body.groups[g]);}}
  if(Array.isArray(body&&body.orders))flat=flat.concat(body.orders);
  else if(body&&body.order)flat.push(body.order);
  else if(Array.isArray(body&&body.order_rows))flat=flat.concat(body.order_rows);
  else if(body&&body.order_row)flat.push(body.order_row);

  var grouped={},keys=[];
  for(var i=0;i<flat.length;i++){
    var src=flat[i]||{};
    var id=oraStr_(oraPick_(src,["Order ID","orderId","order_id","order_number","orderNo"])).trim();
    if(!id)continue;
    var key=oraKey_(id);
    if(!grouped[key]){
      grouped[key]={
        id:id,
        source:oraStr_(oraPick_(src,["Source","source","order_source"])||"Website"),
        customer:oraStr_(oraPick_(src,["Customer Name","customerName","customer_name"])),
        phone:oraStr_(oraPick_(src,["Phone Number","phoneNumber","phone_number","phone"])),
        whatsapp:oraStr_(oraPick_(src,["WhatsApp Number","whatsAppNumber","whatsapp_number","whatsapp","phone"])),
        address:oraStr_(oraPick_(src,["Address","address"])),
        city:oraStr_(oraPick_(src,["City","city"])),
        district:oraStr_(oraPick_(src,["District","district"])),
        finalTotal:oraNum_(oraPick_(src,["Final Total (Rs)","finalTotal","final_total","total_amount","total"])),
        discount:oraNum_(oraPick_(src,["Discount (Rs)","discount","discount_amount","special_offer_discount"])),
        normalTotal:oraNum_(oraPick_(src,["Normal Total (Rs)","normalTotal","normal_total","subtotal"])),
        delivery:oraNum_(oraPick_(src,["Delivery Fee (Rs)","deliveryFee","delivery_fee"])),
        offer:oraStr_(oraPick_(src,["Offer","offer","offer_label"])),
        orderTime:oraStr_(oraPick_(src,["Order Time","orderTime","order_time","created_at"])),
        leadId:oraStr_(oraPick_(src,["Lead ID","leadId","lead_id","platform_lead_id"])),
        importedStatus:oraStr_(oraPick_(src,["Imported Status","importedStatus","imported_status","call_center_status"])||"Pending"),
        items:[]
      };
      keys.push(key);
    }
    var o=grouped[key];
    if(!o.customer)o.customer=oraStr_(oraPick_(src,["Customer Name","customerName","customer_name"]));
    if(!o.phone)o.phone=oraStr_(oraPick_(src,["Phone Number","phoneNumber","phone_number","phone"]));
    if(!o.address)o.address=oraStr_(oraPick_(src,["Address","address"]));
    if(!o.city)o.city=oraStr_(oraPick_(src,["City","city"]));
    if(!o.district)o.district=oraStr_(oraPick_(src,["District","district"]));
    if(!o.finalTotal)o.finalTotal=oraNum_(oraPick_(src,["Final Total (Rs)","finalTotal","final_total","total_amount","total"]));
    if(!o.delivery)o.delivery=oraNum_(oraPick_(src,["Delivery Fee (Rs)","deliveryFee","delivery_fee"]));
    if(!o.discount)o.discount=oraNum_(oraPick_(src,["Discount (Rs)","discount","discount_amount","special_offer_discount"]));
    if(!o.normalTotal)o.normalTotal=oraNum_(oraPick_(src,["Normal Total (Rs)","normalTotal","normal_total","subtotal"]));
    if(!o.offer)o.offer=oraStr_(oraPick_(src,["Offer","offer","offer_label"]));

    var nested=Array.isArray(src.items)&&src.items.length?src.items:null;
    var itemList=nested||[src];
    for(var j=0;j<itemList.length;j++){
      var it=itemList[j]||{};
      var qty=Math.max(1,Math.round(oraNum_(oraPick_(it,["Qty","qty","quantity"])||1)));
      var unit=oraNum_(oraPick_(it,["Unit Price (Rs)","unitPrice","unit_price","price"]));
      var line=oraNum_(oraPick_(it,["Line Total (Rs)","lineTotal","line_total"]));
      if(!line)line=Math.round(qty*unit*100)/100;
      o.items.push({
        name:oraStr_(oraPick_(it,["Item Name","itemName","item_name","product_name","name"])),
        code:oraStr_(oraPick_(it,["Item Code","itemCode","item_code","sku"])),
        main:oraStr_(oraPick_(it,["Main Code","mainCode","main_code","main_sku","sku"])),
        variant:oraStr_(oraPick_(it,["Variant / Color","variantName","variant_name","variant","variantColor"])),
        qty:qty,unit:unit,line:line
      });
    }
  }

  var out=[];
  for(var k=0;k<keys.length;k++){
    var order=grouped[keys[k]],lineSum=0,qtySum=0;
    for(var x=0;x<order.items.length;x++){lineSum+=order.items[x].line;qtySum+=order.items[x].qty;}
    lineSum=Math.round(lineSum*100)/100;
    if(!order.normalTotal)order.normalTotal=lineSum;
    if(!order.discount&&order.finalTotal>0)order.discount=Math.round(Math.max(0,lineSum+order.delivery-order.finalTotal)*100)/100;
    if(!order.finalTotal)order.finalTotal=Math.round(Math.max(0,lineSum-order.discount+order.delivery)*100)/100;
    if(!order.offer)order.offer=order.discount>0?("Qty Offer Rs. "+order.discount+" ("+qtySum+" items)"):"No Qty Offer";

    // Allocate EXACT website final discount to item rows proportionally.
    var allocated=0;
    for(var d=0;d<order.items.length;d++){
      var item=order.items[d];
      var share=(d===order.items.length-1)
        ? Math.round((order.discount-allocated)*100)/100
        : Math.round((lineSum>0?order.discount*(item.line/lineSum):0)*100)/100;
      share=Math.max(0,share);
      allocated=Math.round((allocated+share)*100)/100;
      item.discount=share;
      item.offer=order.discount>0?order.offer:"No Qty Offer";
    }
    out.push(order);
  }
  return out;
};

oraOrderRows_ = function(sh,orderId){
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"],out=[];
  if(!idCol||sh.getLastRow()<2)return out;
  var ids=sh.getRange(2,idCol,sh.getLastRow()-1,1).getDisplayValues();
  var target=oraKey_(orderId);
  for(var i=0;i<ids.length;i++)if(oraKey_(ids[i][0])===target)out.push(i+2);
  return out;
};

oraCaptureActions_ = function(sh,orderId){
  var out={orderAction:"PENDING",items:{},rows:[]};
  var hm=oraHeaderMap_(sh),idCol=hm["Order ID"],itemCol=hm["Item Code"],varCol=hm["Variant / Color"],iaCol=hm["Item Action"],oaCol=hm["Order Action"];
  if(!idCol)return out;
  var rows=oraOrderRows_(sh,orderId);out.rows=rows;
  if(!rows.length)return out;
  var start=rows[0],end=rows[rows.length-1];
  var vals=sh.getRange(start,1,end-start+1,sh.getLastColumn()).getDisplayValues();
  for(var i=0;i<vals.length;i++){
    if(oraKey_(vals[i][idCol-1])!==oraKey_(orderId))continue;
    if(oaCol&&vals[i][oaCol-1])out.orderAction=vals[i][oaCol-1];
    var key=oraKey_((itemCol?vals[i][itemCol-1]:"")+"|"+(varCol?vals[i][varCol-1]:""));
    if(key&&iaCol&&vals[i][iaCol-1])out.items[key]=vals[i][iaCol-1];
  }
  return out;
};

oraDeleteRowsById_ = function(sh,orderId,moveToDeleted,knownRows){
  var rows=Array.isArray(knownRows)?knownRows:oraOrderRows_(sh,orderId);
  if(!rows.length)return 0;
  var ss=sh.getParent(),deleted=null,lastCol=sh.getLastColumn();

  if(moveToDeleted){
    deleted=ss.getSheetByName(ORA_DELETED_SHEET)||ss.insertSheet(ORA_DELETED_SHEET);
    if(deleted.getLastRow()===0)deleted.getRange(1,1,1,lastCol).setValues([sh.getRange(1,1,1,lastCol).getValues()[0]]);
    var movedValues=[];
    for(var m=0;m<rows.length;m++)movedValues.push(sh.getRange(rows[m],1,1,lastCol).getValues()[0]);
    if(movedValues.length)deleted.getRange(deleted.getLastRow()+1,1,movedValues.length,lastCol).setValues(movedValues);
  }

  // Delete contiguous item rows as one block. This prevents half-deleted orders.
  var blocks=[],blockStart=rows[0],prev=rows[0];
  for(var i=1;i<rows.length;i++){
    if(rows[i]===prev+1){prev=rows[i];continue;}
    blocks.push([blockStart,prev]);blockStart=rows[i];prev=rows[i];
  }
  blocks.push([blockStart,prev]);
  for(var b=blocks.length-1;b>=0;b--)sh.deleteRows(blocks[b][0],blocks[b][1]-blocks[b][0]+1);
  return rows.length;
};

oraWriteOrder_ = function(ss,o){
  var sh=oraEnsureOrderSheet_(ss,oraSheetName_(o.source));
  var actions=oraCaptureActions_(sh,o.id);
  if(actions.rows.length)oraDeleteRowsById_(sh,o.id,false,actions.rows);
  var hm=oraHeaderMap_(sh),rows=[];
  for(var i=0;i<o.items.length;i++){
    var it=o.items[i],first=i===0,row=[];
    for(var c=1;c<=sh.getLastColumn();c++)row.push("");
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
  if(rows.length){
    var start=sh.getLastRow()+1;
    sh.getRange(start,1,rows.length,sh.getLastColumn()).setValues(rows);
    oraApplyValidations_(ss,sh,start,rows.length);
  }
  return rows.length;
};

oraSync_ = function(body){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),orders=oraNormalizeIncoming_(body),rows=0;
  for(var i=0;i<orders.length;i++)rows+=oraWriteOrder_(ss,orders[i]);
  SpreadsheetApp.flush();
  return {ok:true,status:"orders_synced",synced:orders.length,existing:0,rows:rows};
};

oraDeleteOrder_ = function(body){
  var id=oraStr_(oraPick_(body,["orderId","order_id","order_number","id"])).trim();
  if(!id)return {ok:false,error:"Missing order ID"};
  var ss=SpreadsheetApp.getActiveSpreadsheet(),removed=0;
  for(var i=0;i<ORA_ORDER_SHEETS.length;i++){
    var sh=ss.getSheetByName(ORA_ORDER_SHEETS[i]);
    if(sh)removed+=oraDeleteRowsById_(sh,id,true);
  }
  SpreadsheetApp.flush();
  return {ok:true,status:"order_deleted",deleted:removed,removed:removed,orderId:id};
};

oraRecalcOrder_ = function(sh,orderId){
  var rows=oraOrderRows_(sh,orderId);if(!rows.length)return;
  var hm=oraHeaderMap_(sh),sum=0,discountSum=0;
  for(var i=0;i<rows.length;i++){
    var r=rows[i],qty=Math.max(1,oraNum_(sh.getRange(r,hm["Qty"]).getValue())),unit=oraNum_(sh.getRange(r,hm["Unit Price (Rs)"]).getValue());
    var act=oraStr_(sh.getRange(r,hm["Item Action"]).getDisplayValue());
    var rowDiscount=hm["Discount (Rs)"]?oraNum_(sh.getRange(r,hm["Discount (Rs)"]).getValue()):0;
    var line=Math.round(qty*unit*100)/100;
    sh.getRange(r,hm["Line Total (Rs)"]).setValue(line);
    if(oraKey_(act)!=="CANCEL ITEM"){sum+=line;discountSum+=rowDiscount;}
  }
  var first=rows[0],delivery=hm["Delivery Fee (Rs)"]?oraNum_(sh.getRange(first,hm["Delivery Fee (Rs)"]).getValue()):0;
  if(hm["Normal Total (Rs)"])sh.getRange(first,hm["Normal Total (Rs)"]).setValue(Math.round(sum*100)/100);
  if(hm["Final Total (Rs)"])sh.getRange(first,hm["Final Total (Rs)"]).setValue(Math.round(Math.max(0,sum-discountSum+delivery)*100)/100);
};
