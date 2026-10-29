import {readDataTable,replaceDataTable} from './cloudflareData';
import {returnPackingInProgress} from '../src/lib/returnSheets';
import {cancellationInProgress} from './r2OrderCancellation';
import {stockConsumedItems} from '../src/lib/orderStockQuantities';
import {normalizeOrderMissingStockVariants,hasConflictingVariantOrderItems} from '../src/lib/exactVariantStockResolution';
import {normalizedProductType} from '../src/lib/productVariants';

type Row=Record<string,any>;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const fail=(message:string):never=>{throw Object.assign(new Error(message),{status:409})};
const receiptKey=(id:string)=>'fifo-stock-allocation-v1:'+id;
const eligible=(order:Row)=>order&&order.call_center_status==='Confirmed'&&order.order_status!=='Cancelled'
  &&order.is_duplicate_order!==true&&order.is_test_order!==true&&!order.sheet_confirm_hold
  &&!order.return_packing_lock&&!order.stock_quantity_correction_lock&&!order.item_edit_lock;
const itemFingerprint=(order:Row)=>JSON.stringify({
  items:stockConsumedItems(order),customer:order.id,
  stock_quantity_correction:order.stock_quantity_correction?.item_quantities||null
});
type Need={productId:string;variantId?:string;quantity:number};
export const inventoryDemand=(order:Row,products:Row[]):Need[]=>{
  if(hasConflictingVariantOrderItems(order,products))fail('Variant Item Code disagrees with saved colour ID. Manual review required; no stock deducted.');
  const normalized=normalizeOrderMissingStockVariants(order,products);
  const byId=new Map(products.map(p=>[String(p.id),p]));
  const result=new Map<string,Need>();
  const add=(productId:unknown,variantId:unknown,qty:unknown)=>{
    const id=String(productId||''),variant=String(variantId||'');
    if(!id||!Number.isSafeInteger(Number(qty))||Number(qty)<=0)fail('Invalid stock requirement.');
    const product=byId.get(id);
    if(!product)fail('Ordered item not found in shared stock catalog.');
    if(normalizedProductType(product as any)==='variant' && !variant)
      fail('Cannot resolve exact ordered colour from Item Code; no stock deducted.');
    const key=id+'::'+variant,existing=result.get(key);
    result.set(key,{productId:id,...(variant?{variantId:variant}:{}),
      quantity:Number(qty)+(existing?.quantity||0)});
  };
  for(const item of stockConsumedItems(normalized)){
    const qty=Number(item.quantity);
    if(!Number.isSafeInteger(qty)||qty<=0)fail('Invalid saved order item quantity.');
    if(item.product_type==='bundle'&&Array.isArray(item.bundle_components)&&item.bundle_components.length){
      for(const c of item.bundle_components){
        const per=Number(c.quantity_per_bundle||1);
        if(!Number.isSafeInteger(per)||per<=0)fail('Invalid bundle component quantity.');
        add(c.product_id,c.variant_id,qty*per);
      }
    }else add(item.product_id,item.variant_id,qty);
  }
  return [...result.values()];
};
export const applyAtomicFifoInventory=(products:Row[],needs:Need[],order:Row,at:string)=>{
  const copies=products.map(p=>({...p,variants:(p.variants||[]).map((v:Row)=>({...v}))}));
  const byId=new Map(copies.map(p=>[String(p.id),p]));
  const logs:Row[]=[];
  for(const need of needs){
    const product=byId.get(need.productId);
    if(!product)fail('Stock product disappeared while assigning.');
    const variant=need.variantId?(product.variants||[]).find((v:Row)=>String(v.id)===need.variantId):null;
    if(need.variantId&&!variant)fail('Exact ordered variant has disappeared.');
    if(normalizedProductType(product as any)==='variant'&&!variant)
      fail('Exact colour is needed before deducting stock.');
    const target=variant||product;
    const before=Number(target.stock_quantity);
    if(!Number.isSafeInteger(before)||before<need.quantity)fail('Waiting for Stock: '+String(target.sku||product.sku)+' requires '+need.quantity+' but has '+before+'.');
    target.stock_quantity=before-need.quantity;
    target.status=target.stock_quantity>0?'Active':'Out of Stock';
    if(variant){
      product.stock_quantity=(product.variants||[]).reduce((n:number,v:Row)=>n+Math.max(0,Number(v.stock_quantity||0)),0);
      product.status=product.stock_quantity>0?'Active':'Out of Stock';
    }
    logs.push({id:'fifo-order:'+String(order.id)+':'+need.productId+':'+String(need.variantId||'base'),
      product_id:need.productId,variant_id:need.variantId,
      product_name:String(product.name_en||product.sku)+(variant?' - '+String(variant.option_value||''):''),
      change_type:'Order Deduction',quantity:need.quantity,previous_stock:before,new_stock:target.stock_quantity,
      reason:'FIFO stock allocated to '+String(order.order_number),performed_by:'System Server FIFO',created_at:at});
  }
  return {products:copies,logs};
};
/**
 * A durable receipt and stock mutation share ONE admin-data CAS. If updating
 * the separate order snapshot times out, the receipt remains authoritative:
 * subsequent retries finish the SAME order WITHOUT subtracting stock again.
 */
export const r2AtomicFifoAllocation=async(env:unknown,id:string,user:Row)=>{
  if(!id||id.length>150)fail('Invalid order ID.');
  const savedOrders=await readDataTable(env,'order_snapshots');
  const selected=savedOrders.find(row=>String(row.order_id)===id)?.payload;
  if(!selected)fail('Order does not exist in shared order database.');
  const admin=await readDataTable(env,'admin_data_store');
  const previous=admin.find(row=>row.key===receiptKey(id))?.payload;
  if(selected.stock_allocated===true&&!previous){
    return {ok:true,already_allocated:true,order:selected,state:null,stock_changed:false};
  }
  if(!previous&&!eligible(selected))fail('Order is not eligible for stock allocation.');
  const fingerprint=itemFingerprint(selected);
  const planned=await replaceDataTable(env,'admin_data_store',rows=>{
    const existing=rows.find(row=>row.key===receiptKey(id))?.payload;
    if(existing){
      if(existing.fingerprint!==fingerprint && selected.stock_allocated!==true)
        fail('Order items changed since its first FIFO stock reservation. Review original reservation.');
      return {rows,result:{receipt:existing,state:rows.find(row=>row.key==='storefront-state-v1')?.payload,
        already_saved:true}};
    }
    if(returnPackingInProgress(rows)||cancellationInProgress(rows as Row[]))
      fail('Stock/returns transaction in progress. Retry this same order.');
    const catalog=rows.find(row=>row.key==='storefront-state-v1');
    if(!catalog?.payload||!Array.isArray(catalog.payload.products))
      fail('Shared catalog was unavailable. No stock deducted.');
    const requirements=inventoryDemand(selected,catalog.payload.products);
    if(!requirements.length)fail('No physical stock requirements for this order.');
    const at=new Date().toISOString();
    const changed=applyAtomicFifoInventory(catalog.payload.products,requirements,selected,at);
    const state={...catalog.payload,products:changed.products,
      version:Number(catalog.payload.version||0)+1,updated_at:at};
    const receipt={phase:'reserved',order_id:id,order_number:selected.order_number,
      fingerprint,requirements,logs:changed.logs,created_at:at,
      stock_changed_once:true,actor:String(user.display_name||user.username||user.id)};
    const updated=rows.map(row=>row===catalog?{...catalog,payload:state,updated_at:at}:row);
    updated.push({key:receiptKey(id),payload:receipt,updated_at:at});
    return {rows:updated,result:{receipt,state,already_saved:false}};
  });
  const completed=await replaceDataTable(env,'order_snapshots',rows=>{
    const row=rows.find(r=>String(r.order_id)===id),order=row?.payload;
    if(!order)fail('The saved order disappeared. FIFO receipt retained for retry.');
    if(order.stock_allocated===true)return {rows,result:order};
    if(!eligible(order)||itemFingerprint(order)!==planned.receipt.fingerprint)
      fail('Order changed after stock reservation. Do not allocate again. Reconcile the reserved receipt.');
    const at=planned.receipt.created_at;
    const normalized=normalizeOrderMissingStockVariants(order,planned.state?.products||[]);
    const waiting=Boolean(order.stock_waiting_since) ||
      Boolean(order.call_center_updated_at&&Date.now()-Date.parse(order.call_center_updated_at)>10*60*1000);
    const updated={...normalized,stock_allocated:true,stock_status:'Allocated',
      stock_allocated_at:at,stock_allocated_by:'System Server FIFO',
      ...(waiting&&!order.invoice_pack_batch_id
        ?{invoice_pack_batch_id:'PACK-RESTOCK-'+at.replace(/[^0-9]/g,'').slice(0,17)}:{})};
    return {rows:rows.map(r=>r===row?{...row,payload:updated,updated_at:new Date().toISOString()}:r),result:updated};
  });
  return {ok:true,order:completed,state:planned.state,logs:planned.receipt.logs||[],already_saved:planned.already_saved,stock_changed:!planned.already_saved};
};
export const r2AtomicFifoHandler=async(request:Request,env:unknown,user:Row)=>{
  if(user.role!=='admin'&&!['stock','packing','orders'].some(permission=>(user.permissions||[]).includes(permission)))
    return json({error:'Stock/packing permission required.'},403);
  if(request.method!=='POST')return json({error:'POST required.'},405);
  const body:any=await request.json().catch(()=>null);
  if(typeof body?.order_id!=='string'||!body.order_id||body.order_id.length>150)
    return json({error:'Valid order_id required.'},400);
  try{return json(await r2AtomicFifoAllocation(env,body.order_id,user));}
  catch(error:any){return json({error:String(error?.message||'FIFO allocation failed; retry without new Purchasing.' )},Number(error?.status||409));}
};
