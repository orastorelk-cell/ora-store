import { readDataTable, replaceDataTable, resolveKnownBrandImages } from './cloudflareData';
import { cancellationInProgress } from './r2OrderCancellation';
import { sharedReturnInventory } from '../src/lib/returnSheets';
import { validProductSave } from '../src/lib/storefrontProductSave';

type VerifyStaff=(request:Request,env:unknown)=>Promise<Record<string,any>|null>;
const KEY='storefront-state-v1';
export const sameStorefrontValue=(a:any,b:any):boolean=>{
  if(a===b)return true;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.prototype.hasOwnProperty.call(b,key)&&sameStorefrontValue(a[key],b[key]));
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store, no-cache, must-revalidate',
  pragma:'no-cache','x-ora-storage':'cloudflare-r2',
}});
const stateFrom=(row:any)=>{
  if(!row)return null;
  const payload=row.payload;
  if(!payload||typeof payload!=='object'||!Array.isArray(payload.products)||!Array.isArray(payload.categories))throw new Error('The durable website catalog is invalid.');
  return {version:Math.max(1,Number(payload.version||1)),updated_at:String(payload.updated_at||new Date(0).toISOString()),
    products:payload.products,categories:payload.categories,
    settings:payload.settings&&typeof payload.settings==='object'&&!Array.isArray(payload.settings)?payload.settings:{}};
};
export const publicStorefrontSettings=(settings:Record<string,any>)=>{
  const out={...settings};
  for(const key of ['google_sheet_webhook_url','fardar_api_url','fardar_account_id','courier_api_enabled','admin_secret_path'])delete out[key];
  if(out.bank_details_saved!==true)for(const key of ['bank_name','bank_account_holder','bank_account_number','bank_branch'])out[key]='';
  return out;
};
const syncCatalog=async(webhook:string,products:any[])=>{
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook))return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{await fetch(webhook,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8',accept:'application/json'},
    body:JSON.stringify({payload_type:'catalog_sync',products,pricing:Object.fromEntries(products.map(product=>[String(product?.sku||''),Number(product?.selling_price||0)]))}),
    redirect:'follow',signal:controller.signal});}finally{clearTimeout(timer);}
};

export const r2StorefrontHandler=async(request:Request,env:unknown,ctx:any,verifyStaff:VerifyStaff):Promise<Response|null>=>{
  const path=new URL(request.url).pathname;
  const admin=path==='/api/admin/storefront/state';
  const read=request.method==='GET'&&(admin||['/api/storefront/state','/api/storefront/version'].includes(path));
  const save=request.method==='PUT'&&admin;
  if(!read&&!save)return null;
  if(admin&&!await verifyStaff(request,env))return json({error:'Login session required.'},401);
  if(read){
    const rows=await readDataTable(env,'admin_data_store');
    const row=rows.find(row=>row.key===KEY);
    const state=stateFrom(row);
    if(path.endsWith('/version'))return json({initialized:Boolean(row?.updated_at),updated_at:String(row?.updated_at||'')});
    return json({initialized:Boolean(state),state:state?(admin?{...state,return_inventory:sharedReturnInventory(rows)}:{...state,settings:publicStorefrontSettings(state.settings)}):null});
  }
  // Clone keeps the existing webhook-restoration/recovery route able to consume
  // the original request when that uncommon transition needs the server flow.
  const raw=await request.clone().text();
  if(raw.length>15000000)return json({error:'Storefront catalog is too large. Use public image URLs instead of embedded image data.'},413);
  let body:any;try{body=JSON.parse(raw);}catch{return json({error:'Invalid website save request.'},400);}
  const productSave=body?.format==='ora-storefront-products-v1';
  if(productSave?!validProductSave(body):(!Array.isArray(body?.products)||!Array.isArray(body?.categories)||!body?.settings||typeof body.settings!=='object'||Array.isArray(body.settings))){
    return json({error:'Products, categories and settings are required.'},400);
  }
  if(body.expected_version!==undefined&&(!Number.isSafeInteger(body.expected_version)||body.expected_version<0))return json({error:'Invalid website version.'},400);
  const incomingWebhook=String(body.settings?.google_sheet_webhook_url||'').trim();
  const updates=productSave?new Map<string,any>(body.product_updates.map((product:any)=>[product.id,product])):null;
  const saved=await replaceDataTable<any>(env,'admin_data_store',rows=>{
    if(cancellationInProgress(rows as any[]))return {rows,result:{cancellationPending:true}};
    const row=rows.find(row=>row.key===KEY);const current=stateFrom(row);
    if(productSave&&(!current||body.product_updates.some((product:any)=>!current.products.some(existing=>existing.id===product.id))))return {rows,result:{conflict:true}};
    if(!productSave&&!current?.settings?.google_sheet_webhook_url&&incomingWebhook)return {rows,result:{serverTransition:true}};
    const products=productSave?current!.products.map(product=>updates!.get(product.id)||product):body.products.slice(0,5000);
    const categories=productSave?current!.categories:body.categories.slice(0,1000);
    const settings=productSave?current!.settings:resolveKnownBrandImages({...body.settings,google_sheet_webhook_url:incomingWebhook||String(current?.settings.google_sheet_webhook_url||'').trim()});
    const unchanged=current&&sameStorefrontValue(products,current.products)&&sameStorefrontValue(categories,current.categories)&&sameStorefrontValue(settings,current.settings);
    if(unchanged)return {rows,result:{state:current,changed:false}};
    if(body.expected_version!==undefined&&Number(body.expected_version)!==Number(current?.version||0))return {rows,result:{conflict:true}};
    const state={products,categories,settings,version:Math.max(1,Number(current?.version||0)+1),updated_at:new Date().toISOString()};
    const replacement={...row,key:KEY,payload:state,updated_at:state.updated_at};
    return {rows:row?rows.map(item=>item===row?replacement:item):[...rows,replacement],result:{state,changed:true}};
  });
  if(saved.serverTransition)return null;
  if(saved.cancellationPending)return json({error:'An order cancellation is restoring stock. Finish or retry that cancellation before saving the catalog.',code:'CANCELLATION_PENDING'},409);
  if(saved.conflict)return json({error:'The website changed in another session. Your local edit was not overwritten; reload the latest website data before saving again.',code:'STOREFRONT_CONFLICT'},409);
  const state=saved.state!;
  if(saved.changed&&ctx?.waitUntil)ctx.waitUntil(syncCatalog(String(state.settings.google_sheet_webhook_url||''),state.products).catch(()=>console.warn('Catalog Sheet sync could not finish; the website is safely saved in R2.')));
  return json({ok:true,version:state.version,updated_at:state.updated_at,unchanged:!saved.changed,recovered_unsynced_orders:0});
};
