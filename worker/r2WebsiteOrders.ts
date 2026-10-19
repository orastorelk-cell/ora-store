import { readDataTable, replaceDataTable, reserveCloudflareOrderNumber } from './cloudflareData';
import { syncWebsiteOrderSheets } from './websiteOrderSheetSync';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-ora-storage':'cloudflare-r2'}});
const phone=(value:unknown)=>String(value||'').replace(/\D/g,'').replace(/^94(?=7\d{8}$)/,'0');
const fingerprint=(order:any)=>phone(order?.phone)+'::'+(Array.isArray(order?.items)?order.items:[]).map((item:any)=>`${item?.product_id}:${item?.variant_id||'base'}:${item?.quantity}`).sort().join('|');
const cleanText=(value:unknown)=>String(value||'').trim().replace(/\b[a-z][a-z']*\b/g,word=>word.charAt(0).toUpperCase()+word.slice(1));
const receiptKeys=['id','order_number','customer_name','phone','whatsapp','address','city','district','payment_method','payment_status','order_status','items','subtotal','delivery_fee','internal_delivery_fee','delivery_included_in_item_price','special_offer_discount','delivery_rebalance_qty_offer','delivery_rebalance_qty_offer_amount','delivery_rebalance_amount_snapshot','delivery_visible_fee_snapshot','gift_wrap_selected','gift_wrap_fee','total_amount','is_advance_required','advance_amount','advance_confirmed','order_source','call_center_status','is_synced_google_sheets','payment_verification_status','payment_check_notes','courier_name','tracking_status','delivery_status','stock_status','stock_allocated','is_duplicate_order','duplicate_of_order_id','duplicate_fingerprint','duplicate_review_status','dispatch_status','created_at'];
const receipt=(order:any)=>Object.fromEntries(receiptKeys.filter(key=>order[key]!==undefined).map(key=>[key,order[key]]));
const attempts=new Map<string,{at:number;fingerprints:Set<string>}>();
const rateAllowed=async(request:Request,env:any,key:string)=>{
  const raw=request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(env.ABUSE_HASH_SALT||env.STAFF_SESSION_SECRET)+':'+raw)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const now=Date.now();
  for(const [id,value] of attempts)if(now-value.at>600000)attempts.delete(id);
  const current=attempts.get(hash)||{at:now,fingerprints:new Set<string>()};
  if(!current.fingerprints.has(key)&&current.fingerprints.size>=5)return false;
  current.fingerprints.add(key);attempts.set(hash,current);
  if(attempts.size>2000)attempts.delete(attempts.keys().next().value!);
  return true;
};

export const r2WebsiteOrdersHandler=async(request:Request,env:any,ctx:any):Promise<Response|null>=>{
  const path=new URL(request.url).pathname;
  if(request.method!=='POST'||!['/api/orders','/api/order-guard'].includes(path))return null;
  const raw=await request.clone().text();
  if(raw.length>250000)return json({error:'Order payload is too large.'},413);
  let body:any;try{body=JSON.parse(raw);}catch{return json({error:'Invalid order payload.'},400);}
  if(path==='/api/order-guard'){
    if(!/^07\d{8}$/.test(phone(body.phone)))return json({allowed:false,message:'Invalid Sri Lankan mobile number.'},400);
    const items=Array.isArray(body.items)?body.items:[];
    const key=phone(body.phone)+'::'+items.map((item:any)=>`${item.id}:${item.variant_id||'base'}:${item.qty}`).sort().join('|');
    // Preflight is read-only. It never claims that an unsaved attempt is a duplicate.
    return json({allowed:true});
  }
  const input=body?.order;
  if(input?.order_source&&input.order_source!=='Website'||input?.is_test_order)return null;
  if(!input||!/^ord-[A-Za-z0-9_-]{12,100}$/.test(String(input.id||''))||!Array.isArray(input.items)||!input.items.length||input.items.length>100||
    !/^07\d{8}$/.test(phone(input.phone))||String(input.customer_name||'').trim().length<3||String(input.address||'').trim().length<8||String(input.city||'').trim().length<2||
    !['COD','Bank Payment'].includes(input.payment_method)||input.items.some((item:any)=>!item?.product_id||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000||!Number.isFinite(item.unit_price)||item.unit_price<0)||
    !['subtotal','delivery_fee','total_amount'].every(key=>Number.isFinite(input[key])&&input[key]>=0))return json({error:'Invalid order payload. Check the customer details and items.'},400);
  if(!await rateAllowed(request,env,String(input.id)))return json({error:'Too many different order attempts. Please try again later.'},429);
  const previous=(await readDataTable(env,'order_snapshots')).find(row=>String(row.order_id)===String(input.id))?.payload;
  const identity=(order:any)=>JSON.stringify([fingerprint(order),phone(order.whatsapp||order.phone),String(order.address).trim().toLowerCase(),String(order.city).trim().toLowerCase(),order.payment_method,order.total_amount]);
  if(previous){
    if(identity(previous)!==identity(input))return json({error:'This order request belongs to different details. Refresh and retry.'},409);
    if(ctx?.waitUntil&&!body.defer_sheet_sync)ctx.waitUntil(syncWebsiteOrderSheets(env,[previous.id]).catch(()=>undefined));
    return json({ok:true,order:receipt(previous),sheet_sync:{ok:true,queued:!previous.is_synced_google_sheets,confirmed:Boolean(previous.sheet_sync_verified_at)}});
  }
  const admin=await readDataTable(env,'admin_data_store');
  const state=admin.find(row=>row.key==='storefront-state-v1')?.payload;
  if(!state||!Array.isArray(state.products))throw new Error('The website catalog is temporarily unavailable. Retry this same order.');
  for(const item of input.items){
    const product=state.products.find((product:any)=>String(product.id)===String(item.product_id));
    if(!product)return json({error:'An item is no longer available. Refresh your cart.'},409);
    const variant=item.variant_id?(product.variants||[]).find((row:any)=>String(row.id)===String(item.variant_id)):undefined;
    if(product.product_type==='variant'&&!variant)return json({error:'Please select an available product option.'},409);
    if((variant||product).force_out_of_stock)return json({error:String(item.product_name||'This item')+' is currently out of stock.'},409);
  }
  const reserved=await reserveCloudflareOrderNumber(env,'WEB');
  let customer:any=null;
  const authorization=request.headers.get('authorization');
  if(authorization&&env.VITE_SUPABASE_URL&&env.VITE_SUPABASE_PUBLISHABLE_KEY){
    try{const response=await fetch(String(env.VITE_SUPABASE_URL).replace(/\/$/,'')+'/auth/v1/user',{headers:{authorization,apikey:String(env.VITE_SUPABASE_PUBLISHABLE_KEY)},signal:AbortSignal.timeout(1500)});if(response.ok){const user:any=await response.json();if(user?.id)customer=user;}}catch{}
  }
  const saved=await replaceDataTable(env,'order_snapshots',rows=>{
    const existing=rows.find(row=>String(row.order_id)===String(input.id));
    if(existing){if(identity(existing.payload)!==identity(input))throw new Error('Order retry details changed.');return {rows,result:existing.payload};}
    const prior=rows.map(row=>row.payload).filter(order=>order&&order.order_status!=='Cancelled'&&!order.is_test_order&&Date.parse(order.created_at)>Date.now()-86400000&&fingerprint(order)===fingerprint(input))
      .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
    const order:Record<string,any>={...receipt(input),id:String(input.id),order_number:reserved,phone:phone(input.phone),whatsapp:phone(input.whatsapp||input.phone),
      customer_name:cleanText(input.customer_name),address:cleanText(input.address),city:cleanText(input.city),district:cleanText(input.district),
      order_source:'Website',payment_status:'Pending',order_status:input.payment_method==='Bank Payment'?'Pending Payment':'New Orders',
      payment_verification_status:input.payment_method==='Bank Payment'?'Awaiting Receipt':'Not Required',bank_receipt_url:'',advance_confirmed:false,
      call_center_status:'Pending',is_synced_google_sheets:false,stock_status:'Waiting for Stock',stock_allocated:false,dispatch_status:'Not Scanned',delivery_status:'Pending',tracking_status:'Not Shipped',
      is_duplicate_order:Boolean(prior),duplicate_of_order_id:prior?.id,duplicate_fingerprint:fingerprint(input),duplicate_review_status:prior?'Pending':undefined,
      notes:String(input.notes||'').slice(0,4000),created_at:new Date().toISOString()};
    if(customer){order.customer_auth_id=customer.id;order.customer_email=String(customer.email||'');}
    // Keep the saved pricing snapshots; Apps Script receives the final payable values.
    const settings=state.settings||{},qty=order.items.reduce((sum:number,item:any)=>sum+item.quantity,0),labels=[];
    if(order.delivery_rebalance_qty_offer_amount>0)labels.push(`Qty Offer Rs. ${Math.round(order.delivery_rebalance_qty_offer_amount*100)/100} (${qty} items)`);
    if(order.special_offer_discount>0)labels.push(`Multi-Buy Rs. ${Math.round(order.special_offer_discount*100)/100} (${qty} items)`);
    order.offer_label=labels.join(' + ')||'No Qty Offer';
    order.sheet_qty_offer_rules=JSON.stringify({enabled:settings.multi_buy_discount_enabled!==false,delivery_price_rebalance_enabled:settings.delivery_price_rebalance_enabled===true,
      delivery_rebalance_qty_offer:order.delivery_rebalance_qty_offer===true,delivery_rebalance_qty_offer_amount:Number(order.delivery_rebalance_qty_offer_amount||0),
      delivery_price_rebalance_amount:Number(order.delivery_rebalance_amount_snapshot??settings.delivery_price_rebalance_amount??0),delivery_visible_fee_snapshot:Number(order.delivery_visible_fee_snapshot??settings.delivery_fee??0),
      delivery_price_rebalance_original_fee:Number(settings.delivery_base_fee??settings.delivery_price_rebalance_original_fee??0),delivery_rebalance_percent:Number(settings.delivery_rebalance_percent||0),
      tiers:[{min:Number(settings.multi_buy_tier1_min??2),max:Number(settings.multi_buy_tier1_max??3),rate:Number(settings.multi_buy_tier1_rate??5)},
        {min:Number(settings.multi_buy_tier2_min??4),max:Number(settings.multi_buy_tier2_max??5),rate:Number(settings.multi_buy_tier2_rate??7.5)},
        {min:Number(settings.multi_buy_tier3_min??6),max:Number(settings.multi_buy_tier3_max??10),rate:Number(settings.multi_buy_tier3_rate??10),openEnded:true}]});
    order.sheet_wrapping_cost=order.gift_wrap_selected?Number(order.gift_wrap_fee||settings.gift_wrap_fee||0):settings.gift_wrap_enabled?Number(settings.gift_wrap_fee||0):0;
    if(rows.some(row=>row.order_number===reserved))throw new Error('Order number changed concurrently. Retry this same order.');
    return {rows:[...rows,{order_id:order.id,order_number:order.order_number,payload:order,created_at:order.created_at,updated_at:order.created_at}],result:order};
  });
  if(ctx?.waitUntil&&!body.defer_sheet_sync)ctx.waitUntil(syncWebsiteOrderSheets(env,[saved.id]).catch(error=>console.warn('Website Sheet retry remains queued: '+String(error?.message||error))));
  return json({ok:true,order:receipt(saved),sheet_sync:{ok:true,queued:!saved.is_synced_google_sheets,confirmed:Boolean(saved.sheet_sync_verified_at)}});
};
