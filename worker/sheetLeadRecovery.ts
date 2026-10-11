import { sheetHeader, type SheetDecision } from '../src/lib/sheetConfirmRows';
import { buildOrderItemSnapshot, findProductSelection } from '../src/lib/productVariants';

type Row=Record<string,any>;
export const recoveredLeadIdentityConflict = (seed:Row,other:Row) => {
  if(String(other.id)===seed.id||String(other.order_number)===seed.order_number)return true;
  if(other.order_source!==seed.order_source)return false;
  if(seed.platform_lead_id)return String(other.platform_lead_id||'')===seed.platform_lead_id;
  const phone=(value:unknown)=>String(value||'').replace(/\D/g,'').replace(/^94/,'0');
  const address=(value:unknown)=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
  const items=(order:Row)=>(order.items||[]).map((item:Row)=>String(item.sku||item.product_id)+':'+Number(item.quantity)).sort().join('|');
  return phone(other.phone)===phone(seed.phone)&&address(other.address)===address(seed.address)&&items(other)===items(seed);
};
// A missing snapshot may still have a parcel in durable courier/packing history.
// Never manufacture a second parcel from that Sheet row.
export const sheetParcelHistory = (waybills:readonly Row[],admin:readonly Row[]) => {
  const numbers=new Set<string>();
  const add=(value:unknown)=>{const number=String(value||'').trim().toUpperCase();if(number)numbers.add(number);};
  for(const row of waybills)add(row.assigned_order_number);
  for(const row of admin){
    for(const plan of row.payload?.plans||[])add(plan.order_number);
    for(const parcel of row.payload?.parcels||[])add(parcel.order_number||parcel.csv_order_id);
  }
  return numbers;
};

export const recoverSheetLead = (decision:SheetDecision,products:any[],settings:any,at:string,operationId:string):Row => {
  const fail=(reason:string):never=>{throw new Error(decision.order_number+': Missing system order cannot be recovered: '+reason);};
  if(!/^(FB|TK)-\d{6}$/.test(decision.order_number))fail('only Facebook / TikTok COD leads can be restored from the Sheet.');
  const h=decision.headers.map(sheetHeader);
  const column=(names:string[])=>h.findIndex(key=>names.includes(key));
  const value=(names:string[])=>{
    const i=column(names),values=[...new Set(decision.rows.map(row=>String(row[i]||'').trim()).filter(Boolean))];
    if(values.length>1)fail('conflicting '+names[0]+' across item rows.');
    return values[0]||'';
  };
  const money=(raw:string,label:string)=>{
    const clean=raw.replace(/,/g,'').replace(/^(?:Rs\.?|LKR)\s*/i,'').replace(/\s*\/=\s*$/,'').trim();
    if(!/^\d+(?:\.\d{1,2})?$/.test(clean))fail('a valid '+label+' is required.');
    return Number(clean);
  };
  const lead=value(['lead_id','platform_lead_id','leadid']);
  if(lead.length>100)fail('Lead ID is too long.');
  const customer=value(['customer_name','customer','name']),address=value(['address','customer_address','delivery_address']);
  const city=value(['city','town','delivery_city']),district=value(['district','delivery_district']);
  let phone=value(['phone_number','phone','mobile_number','mobile']).replace(/^p:/i,'').replace(/\D/g,'');
  if(phone.startsWith('94')&&phone.length===11)phone='0'+phone.slice(2);
  if(phone.length===9)phone='0'+phone;
  if(!customer||!address||!city||!district||!/^0[1-9]\d{8}$/.test(phone))fail('Customer Name, valid Phone Number, Address, City and District are required.');
  const payment=value(['payment_method','payment_type']);
  if(payment&&!['cod','cash on delivery'].includes(payment.toLowerCase()))fail('bank/paid orders need their original payment record.');
  // Do not infer historical sale prices from today's catalog.
  const code=column(['item_code','variant_code','actual_sku','sku']),qty=column(['qty','quantity']);
  const variant=column(['variant_color','variant','color','colour','option']),action=column(['item_action','item_status']);
  const unit=column(['unit_price_rs','unit_price','price']),line=column(['line_total_rs','line_total']);
  const items=decision.status==='Cancelled'?[]:decision.rows.filter(row=>!['cancel','cancelled','canceled','cancel item'].includes(String(row[action]||'').toLowerCase().replace(/[_-]+/g,' '))).map(row=>{
    const amount=Number(row[qty]),selection=findProductSelection(products,String(row[code]||''),String(row[variant]||''));
    if(!selection||!Number.isSafeInteger(amount)||amount<1||amount>99)fail('a valid Item Code, Variant and Qty are required.');
    const snapshot=buildOrderItemSnapshot(selection!.product,amount,settings,selection!.variant,products);
    const price=money(String(row[unit]||''),'Unit Price');
    const actual=row[line]?money(String(row[line]),'Line Total')/amount:price;
    if(actual<=0||actual>price+.01)fail('Line Total must agree with its historical Unit Price.');
    return {...snapshot,unit_price:actual,subtotal:Math.round(actual*amount*100)/100,regular_unit_price:price,supplier_offer_discount_per_unit:Math.max(0,price-actual)};
  });
  const subtotal=items.reduce((sum,item)=>sum+item.subtotal,0);
  const delivery=decision.status==='Cancelled'?0:money(value(['delivery_fee_rs','delivery_fee']),'Delivery Fee');
  const final=decision.status==='Cancelled'?0:money(value(['final_total_rs','final_total']),'Final Total');
  const discountRaw=value(['discount_rs','discount']),discount=discountRaw?money(discountRaw,'Discount'):0;
  if(decision.status==='Confirmed'&&(!items.length||final<=0))fail('confirmed items and Final Total must be positive.');
  const wrap=['yes','true','1','on','add wrap','gift wrap'].includes(value(['gift_wrap','gift_wrapping','wrap']).toLowerCase());
  const wrapRaw=value(['wrapping_cost_rs','wrapping_cost','gift_wrap_fee','wrapping_fee_rs','wrapping_fee']);
  const wrapFee=wrap?money(wrapRaw,'Wrapping Cost'):0;
  if(decision.status==='Confirmed'&&Math.abs(Math.round(Math.max(0,subtotal-discount+delivery+wrapFee))-final)>.01)fail('historical item prices, Discount, Delivery and Wrapping Cost do not match Final Total.');
  const time=value(['order_time','created_at']),created=Number.isFinite(Date.parse(time))?new Date(time).toISOString():at;
  const source=decision.order_number.startsWith('FB-')?'Facebook Ads':'TikTok Ads';
  return {id:lead?(source==='Facebook Ads'?'fb-lead-':'tk-lead-')+lead.replace(/[^a-zA-Z0-9_-]/g,'_'):'sheet-lead-'+decision.order_number,order_number:decision.order_number,
    customer_name:customer,phone,whatsapp:value(['whatsapp_number','whatsapp_phone','whatsapp'])||phone,address,city,district,
    order_source:source,...(lead?{platform_lead_id:lead}:{}),lead_import_key:(source+(lead?'::lead::'+lead:'::sheet-order::'+decision.order_number)).toLowerCase(),
    created_at:created,lead_imported_at:at,payment_method:'COD',payment_status:'Pending',call_center_status:'Pending',order_status:'New Orders',
    stock_allocated:false,stock_status:'Waiting for Stock',items,subtotal,delivery_fee:delivery,special_offer_discount:discount,
    gift_wrap_selected:wrap,gift_wrap_fee:wrapFee,total_amount:final,is_advance_required:false,advance_confirmed:false,
    is_synced_google_sheets:true,dispatch_status:'Not Scanned',notes:'Recovered missing system lead from connected Sheet; original Order ID preserved',
    sheet_lead_recovery:{operation_id:operationId,recovered_at:at,original_order_time:time,identity:lead?'platform_lead_id':'original_order_number'}};
};
