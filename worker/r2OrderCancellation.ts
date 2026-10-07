import { returnPackingInProgress } from '../src/lib/returnSheets';
import { readDataTable, mutateDataTable } from './cloudflareData';
import { canonicalJson } from '../src/lib/confirmCsvSave';

type Row=Record<string,any>;
type Requirement={product_id:string;variant_id?:string;quantity:number;label:string};
const KEY='storefront-state-v1';
const fail=(message:string,status=409):never=>{const error:any=new Error(message);error.status=status;throw error;};
const operationKey=(id:string)=>'order-cancel-stock-v1:'+id;
export const cancellationInProgress=(rows:Row[])=>rows.some(row=>String(row.key).startsWith('order-cancel-stock-v1:')&&['pending','stock_saved'].includes(row.payload?.phase));

const requirementsFor=(order:Row):Requirement[]=>{
  if(order.stock_allocated!==true)return [];
  if(!Array.isArray(order.items)||!order.items.length)fail('Allocated order items are missing.');
  const amounts=new Map<string,Requirement>();
  const add=(productId:any,variantId:any,quantity:any,label:any)=>{
    const id=String(productId||''),variant=String(variantId||''),qty=Number(quantity);
    if(!id||!Number.isSafeInteger(qty)||qty<=0||qty>1_000_000)fail('The allocated item quantity or selection is invalid.');
    const key=id+'\0'+variant,old=amounts.get(key);
    if(old)old.quantity+=qty;else amounts.set(key,{product_id:id,...(variant?{variant_id:variant}:{}),quantity:qty,label:String(label||id)});
  };
  for(const item of order.items){
    const qty=Number(item.quantity);
    if(!Number.isSafeInteger(qty)||qty<=0)fail('The allocated item quantity is invalid.');
    if(item.product_type==='bundle'){
      if(!Array.isArray(item.bundle_components)||!item.bundle_components.length)fail('Allocated bundle components are missing.');
      for(const c of item.bundle_components)add(c.product_id,c.variant_id,qty*Number(c.quantity_per_bundle||1),c.product_name);
    }else add(item.product_id,item.variant_id,qty,item.product_name);
  }
  return [...amounts.values()];
};
const stockTargets=(products:Row[],requirements:Requirement[])=>requirements.map(req=>{
  const matches=products.filter(p=>String(p.id)===req.product_id);
  if(matches.length!==1)fail('The exact allocated product is missing: '+req.label);
  const product=matches[0];let target=product;
  if(req.variant_id){
    const variants=(product.variants||[]).filter((v:Row)=>String(v.id)===req.variant_id);
    if(variants.length!==1)fail('The exact allocated variant is missing: '+req.label);
    target=variants[0];
  }else if(product.product_type==='variant'||(product.variants||[]).length)fail('An exact variant is required to restore '+req.label);
  if(product.product_type==='bundle')fail('Bundle stock must be restored to its allocated components.');
  const before=Number(target.stock_quantity||0),after=before+req.quantity;
  if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after))fail('The current stock quantity is invalid.');
  return {req,product,target,before,after,sku:String(target.sku||product.sku||''),label:String(product.name_en||req.label)+(req.variant_id?' - '+String(target.option_value||req.variant_id):'')};
});
const currentOrder=(rows:Row[],id:string,waybill:string)=>{
  const matches=rows.filter(row=>String(row.payload?.id)===id);
  if(matches.length!==1)fail('Order not uniquely found.',404);
  const row=matches[0],order=row.payload;
  if(String(order.waybill_number||'').trim()!==waybill)fail('The current waybill changed. Check the order again.');
  if(waybill&&rows.some(other=>other!==row&&String(other.payload?.waybill_number||'').trim()===waybill))fail('The waybill is also attached to another order.');
  return {row,order};
};
const canCancel=(order:Row)=>{
  if(order.return_packing_lock?.operation_id)fail('Finish the return packing batch before cancelling this order.');
  if(order.cancel_stock_restore?.operation_id)return;
  if(order.order_status==='Cancelled')fail('This order was cancelled by an older flow. Its stock must be checked before any restoration.');
  if(order.dispatch_status==='Handed Over'||['Shipped','Delivered'].includes(order.order_status)||order.return_received_at||order.return_status||order.cod_payment_received)fail('This parcel has dispatch, delivery, return or COD history. Use the verified return flow.');
};
const assertOwner=(locks:Row[],order:Row)=>{
  const waybill=String(order.waybill_number||'').trim();
  if(!waybill)return;
  const matches=locks.filter(lock=>String(lock.waybill_number||'').trim()===waybill);
  if(matches.length>1)fail('The waybill registry contains duplicate records.');
  if(matches.some(lock=>(lock.assigned_order_number&&String(lock.assigned_order_number)!==String(order.order_number))||
    (lock.assigned_order_id&&String(lock.assigned_order_id)!==String(order.id))))fail('The waybill is locked for another order.');
};

// The stock journal and catalog share one ETag transaction. While the journal
// is pending, ordinary catalog writes are blocked. Every later step is resumable;
// a retry or lost response can never add stock a second time.
export const cancelBeforeDispatch=async(env:unknown,id:string,waybill:string,reason:string,actor:string)=>{
  const initial=currentOrder(await readDataTable(env,'order_snapshots'),id,waybill).order;
  canCancel(initial);assertOwner(await readDataTable(env,'courier_waybills'),initial);
  let requirements:Requirement[]=initial.cancel_stock_restore?.requirements||requirementsFor(initial);
  const op=operationKey(id),now=new Date().toISOString();
  const journal=await mutateDataTable(env,'admin_data_store',rows=>{
    if(returnPackingInProgress(rows))fail('A packing batch is finishing. Retry its saved operation first.');
    const ledger=rows.find(row=>row.key===op);
    if(ledger){if(ledger.payload?.order_number!==initial.order_number||ledger.payload?.waybill_number!==waybill)fail('Cancellation journal identity mismatch.');return ledger.payload;}
    const state=rows.find(row=>row.key===KEY)?.payload;
    if(!state||!Array.isArray(state.products))fail('The current stock catalog is unavailable.');
    stockTargets(state.products,requirements);
    const payload={phase:'pending',order_number:initial.order_number,waybill_number:waybill,requirements,reason,actor,created_at:now};
    rows.push({key:op,updated_at:now,payload});return payload;
  });
  requirements=journal.requirements;
  reason=journal.reason;actor=journal.actor;
  let prepared:Row;
  try{prepared=await mutateDataTable(env,'order_snapshots',rows=>{
    const {row,order}=currentOrder(rows,id,waybill);canCancel(order);
    if(order.cancel_stock_restore?.operation_id){if(order.cancel_stock_restore.operation_id!==op)fail('Another cancellation operation owns this order.');return order;}
    if(canonicalJson(requirementsFor(order))!==canonicalJson(requirements))fail('The allocated items changed. Check the order again.');
    row.payload={...order,order_status:'Cancelled',call_center_status:'Cancelled',call_center_updated_at:now,
      cancelled_at:now,cancelled_by:actor,cancel_reason:reason,stock_allocated:false,
      waybill_protection_locked:Boolean(waybill)||order.waybill_protection_locked,
      waybill_protection_reason:waybill?'Courier removal; this waybill permanently belongs to this cancelled order.':order.waybill_protection_reason,
      cancel_stock_restore:{operation_id:op,state:'pending',requirements,allocated_before:order.stock_allocated===true},
      notes:[order.notes,'Cancelled before dispatch: '+reason].filter(Boolean).join(' | ')};
    row.updated_at=now;return row.payload;
  });}catch(error:any){
    // A validation conflict means the parcel changed before cancellation began.
    // No stock has been restored: release the unused preparation journal. A
    // network/write failure keeps the journal so the same request can resume.
    if(error?.status===409){
      const current=(await readDataTable(env,'order_snapshots')).find(row=>String(row.payload?.id)===id)?.payload;
      if(!current?.cancel_stock_restore?.operation_id)await mutateDataTable(env,'admin_data_store',rows=>{
        const at=rows.findIndex(row=>row.key===op&&row.payload?.phase==='pending'&&row.payload?.stock_applied!==true);
        if(at>=0)rows.splice(at,1);
      });
    }
    throw error;
  }
  if(waybill)await mutateDataTable(env,'courier_waybills',rows=>{
    assertOwner(rows,prepared);
    let lock=rows.find(row=>String(row.waybill_number||'').trim()===waybill);
    if(!lock){lock={waybill_number:waybill,courier_name:prepared.courier_name||'Fardar'};rows.push(lock);}
    Object.assign(lock,{status:'Cancelled',assigned_order_id:id,assigned_order_number:prepared.order_number,
      assigned_at:lock.assigned_at||prepared.cancelled_at,cancelled_at:prepared.cancelled_at,
      cancellation_reason:prepared.cancel_reason,permanently_retired:true});
  });
  const restoration=await mutateDataTable(env,'admin_data_store',rows=>{
    const ledger=rows.find(row=>row.key===op);if(!ledger)fail('Cancellation journal is unavailable.');
    if(ledger.payload.stock_applied===true)return ledger.payload;
    const row=rows.find(row=>row.key===KEY),state=row?.payload;
    if(!state||!Array.isArray(state.products))fail('The current stock catalog is unavailable.');
    const targets=stockTargets(state.products,ledger.payload.requirements),at=new Date().toISOString();
    const history=targets.map(({req,product,target,before,after,sku,label},index)=>{
      target.stock_quantity=after;target.status='Active';
      if(req.variant_id){product.stock_quantity=(product.variants||[]).reduce((sum:number,v:Row)=>sum+Number(v.stock_quantity||0),0);product.status=product.stock_quantity>0?'Active':'Out of Stock';}
      // Adjustment is an audit entry. The purchase ledger already releases the
      // cancelled allocation; an Increase entry would count that release twice.
      return {id:op+':'+index,product_id:req.product_id,variant_id:req.variant_id,sku,product_name:label,
        change_type:'Adjustment',quantity:req.quantity,previous_stock:before,new_stock:after,
        reason:'Cancelled allocation released: '+prepared.order_number+' / '+waybill,performed_by:ledger.payload.actor,created_at:at};
    });
    if(targets.length){state.version=Math.max(1,Number(state.version||0)+1);state.updated_at=at;row!.updated_at=at;}
    ledger.payload={...ledger.payload,phase:'stock_saved',stock_applied:true,restored_at:at,history};ledger.updated_at=at;
    return ledger.payload;
  });
  await mutateDataTable(env,'order_snapshots',rows=>{
    const {row,order}=currentOrder(rows,id,waybill);
    if(order.cancel_stock_restore?.operation_id!==op)fail('Cancellation journal identity changed.');
    if(order.cancel_stock_restore.state==='complete')return;
    row.payload={...order,cancel_stock_restore:{...order.cancel_stock_restore,state:'complete',restored_at:restoration.restored_at,history:restoration.history}};
    row.updated_at=new Date().toISOString();
  });
  await mutateDataTable(env,'admin_data_store',rows=>{
    const ledger=rows.find(row=>row.key===op);if(!ledger)fail('Cancellation journal is unavailable.');
    if(ledger!.payload.phase!=='complete'){ledger!.payload.phase='complete';ledger!.updated_at=new Date().toISOString();}
  });
  return cancellationSummary(env,id,waybill);
};

export const cancellationSummary=async(env:unknown,id:string,waybill:string)=>{
  const {order}=currentOrder(await readDataTable(env,'order_snapshots'),id,waybill);
  const adminRows=await readDataTable(env,'admin_data_store'),state=adminRows.find(row=>row.key===KEY)?.payload;
  const ledger=adminRows.find(row=>row.key===operationKey(id))?.payload;
  const lock=waybill?(await readDataTable(env,'courier_waybills')).find(row=>String(row.waybill_number||'').trim()===waybill):null;
  const requirements=order.cancel_stock_restore?.requirements||requirementsFor(order);
  const items=stockTargets(state?.products||[],requirements).map(({req,sku,label,before})=>({sku,item:label,quantity:req.quantity,current_stock:before}));
  return {ok:true,storage:'cloudflare-r2',order_id:String(order.id),order_number:order.order_number,order_status:order.order_status,
    waybill_number:waybill,waybill_status:lock?.status||null,waybill_owner:lock?.assigned_order_number||null,
    waybill_retired:lock?.permanently_retired===true&&lock?.status==='Cancelled'&&lock?.assigned_order_number===order.order_number,
    invoice_number:order.invoice_number||null,invoice_preserved:Boolean(order.invoice_number),
    cancellation_state:order.cancel_stock_restore?.state||null,
    complete:order.order_status==='Cancelled'&&order.cancel_stock_restore?.state==='complete'&&ledger?.phase==='complete'&&(!waybill||lock?.permanently_retired===true&&lock?.status==='Cancelled'&&lock?.assigned_order_number===order.order_number),
    allocated_stock:order.stock_allocated===true,items,stock_restored:ledger?.history||[],
    can_cancel:(order.order_status!=='Cancelled'||Boolean(order.cancel_stock_restore?.operation_id))&&!['Shipped','Delivered'].includes(order.order_status)&&order.dispatch_status!=='Handed Over'&&!order.return_received_at&&!order.return_status&&!order.cod_payment_received,
    checked_at:new Date().toISOString()};
};

export const r2OrderCancellationHandler=async(request:Request,env:unknown,user:Row)=>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ora-storage':'cloudflare-r2'}});
  if(user.role!=='admin')return json({error:'Super Admin access is required.'},403);
  try{
    if(request.method==='GET'){
      const waybill=String(new URL(request.url).searchParams.get('waybill')||'').trim();
      if(!waybill||waybill.length>100)return json({error:'Enter the exact waybill number.'},400);
      const matches=(await readDataTable(env,'order_snapshots')).filter(row=>String(row.payload?.waybill_number||'').trim()===waybill);
      if(matches.length!==1)return json({error:'The waybill must belong to exactly one existing order.'},409);
      return json(await cancellationSummary(env,String(matches[0].payload.id),waybill));
    }
    const body:any=await request.json().catch(()=>null),id=String(body?.order_id||''),waybill=String(body?.waybill_number||'').trim(),reason=String(body?.reason||'').trim();
    if(!id||id.length>150||waybill.length>100||!reason||reason.length>2000)return json({error:'A current order ID, waybill and cancellation reason are required.'},400);
    return json(await cancelBeforeDispatch(env,id,waybill,reason,String(user.display_name||user.username||'Super Admin')));
  }catch(error:any){return json({error:error?.message||'Cancellation did not finish. Retry the same order.',retry_safe:true},Number(error?.status||503));}
};
