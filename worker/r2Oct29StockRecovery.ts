import { readDataTable,replaceDataTable } from './cloudflareData';
import { cancellationInProgress } from './r2OrderCancellation';
import { returnPackingInProgress,sharedReturnInventory } from '../src/lib/returnSheets';
import { OCT29_RECOVERY_KEY,planOct29StockRecovery,applyOct29StockRecoveryLines,type PurchaseProof } from '../src/lib/oct29StockRecovery';
import { OCT29_GREY_GAP_KEY,planVerifiedGreyStockGap } from '../src/lib/oct29GreyStockGap';

type Row=Record<string,any>;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const fail=(message:string,status=409):never=>{throw Object.assign(new Error(message),{status})};
const stateFrom=(rows:readonly Row[])=>rows.find(row=>row.key==='storefront-state-v1');
const getOrders=async(env:unknown)=>(await readDataTable(env,'order_snapshots')).map(row=>row.payload).filter(Boolean);
const plan=(proofs:PurchaseProof[],rows:readonly Row[],orders:Row[])=>{
  const catalog=stateFrom(rows);
  if(!catalog?.payload||!Array.isArray(catalog.payload.products))fail('Shared stock catalog unavailable.',503);
  return planOct29StockRecovery(proofs,catalog.payload.products,orders,sharedReturnInventory(rows).stockHistory);
};
/**
 * This is an idempotent correction of the ORIGINAL Oct 29 stock receipts, not
 * another Purchase/Stock In. Preview validates exact historical receipt logs.
 * Commit is a CAS-protected single admin-data R2 transaction containing:
 * product/variant stock, catalog version and unique recovery receipt.
 */
export const r2Oct29StockRecoveryHandler=async(request:Request,env:unknown,user:Row):Promise<Response>=>{
 try{
  if(user.role!=='admin')return json({error:'Super Admin access required.'},403);
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const raw=await request.text();
  if(raw.length>12000)return json({error:'Stock proof is too large.'},413);
  let body:any;try{body=JSON.parse(raw)}catch{return json({error:'Invalid recovery request.'},400)}
  if(body?.action==='preview-grey-gap'||body?.action==='commit-grey-gap'){
    const [rows,orders]=await Promise.all([readDataTable(env,'admin_data_store'),getOrders(env)]);
    const recovery=rows.find(row=>row.key===OCT29_RECOVERY_KEY)?.payload;
    const previous=rows.find(row=>row.key===OCT29_GREY_GAP_KEY)?.payload;
    if(previous?.phase==='complete')return json({ok:true,already_saved:true,diagnosis:previous,lines:previous.lines});
    const catalog=stateFrom(rows);
    if(!catalog?.payload||!Array.isArray(catalog.payload.products))fail('Shared stock catalog unavailable.');
    const recentPurchases=rows.filter(row=>String(row.key||'').startsWith('inventory-purchase-v1:')&&row.payload?.phase==='complete')
      .flatMap(row=>row.payload.purchases||[]);
    const result=planVerifiedGreyStockGap(recovery,catalog.payload.products,orders,sharedReturnInventory(rows).stockHistory,recentPurchases);
    const version=Number(catalog.payload.version||0);
    if(body.action==='preview-grey-gap')return json({ok:true,version,lines:[result.line],allocated_orders:result.allocatedOrders,
      missing:result.missing,already_saved:false,requires_invoice_repair:result.missing===0&&result.allocatedOrders.length>0,
      message:result.missing>0?'A missing part of the ORIGINAL GREY 5 units can be corrected once. No new purchase is created.':
       'Original GREY stock is accounted for in remaining stock or allocated orders; DO NOT add another 5.'});
    if(result.missing===0)return json({ok:true,already_saved:false,stock_changed:false,lines:[result.line],
      allocated_orders:result.allocatedOrders,message:'No GREY stock is missing from original recovery. Check orders/waybills/invoices.'});
    if(body.version!==version||JSON.stringify(body.lines)!==JSON.stringify([result.line]))
      fail('GREY stock changed after preview. Refresh and preview again.');
    const latest=await getOrders(env);
    const originalSig=(items:Row[])=>JSON.stringify(items.map(o=>[o.id,o.stock_allocated,o.stock_allocated_at,o.order_status,
      o.stock_quantity_correction,o.items]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    if(originalSig(latest)!==originalSig(orders))fail('An order changed since GREY preview. Retry preview.');
    const saved=await replaceDataTable(env,'admin_data_store',current=>{
      const done=current.find(row=>row.key===OCT29_GREY_GAP_KEY)?.payload;
      if(done?.phase==='complete')return {rows:current,result:{already_saved:true,diagnosis:done,state:stateFrom(current)!.payload}};
      if(returnPackingInProgress(current)||cancellationInProgress(current as Row[]))
        fail('Return or stock transaction in progress. Try again when finished.');
      const existing=stateFrom(current);
      if(!existing?.payload||Number(existing.payload.version||0)!==version)
        fail('Someone updated stock after the GREY preview. Refresh before saving.');
      const nowPlan=planVerifiedGreyStockGap(
        current.find(row=>row.key===OCT29_RECOVERY_KEY)?.payload,
        existing.payload.products,orders,sharedReturnInventory(current).stockHistory,
        current.filter(row=>String(row.key||'').startsWith('inventory-purchase-v1:')&&row.payload?.phase==='complete')
          .flatMap(row=>row.payload.purchases||[])
      );
      if(JSON.stringify(nowPlan.line)!==JSON.stringify(result.line))
        fail('GREY recovery no longer matches current stock. Refresh.');
      const products=applyOct29StockRecoveryLines(existing.payload.products,[nowPlan.line]);
      const at=new Date().toISOString();
      const state={...existing.payload,products,version:version+1,updated_at:at};
      const diagnosis={phase:'complete',at,actor:String(user.display_name||user.username||user.id),
        original_recovery_key:OCT29_RECOVERY_KEY,reason:'One-time restoration of vanished, unallocated GREY portion of original 5 units',
        lines:[nowPlan.line],allocated_orders:nowPlan.allocatedOrders,
        added_purchase:false,changed_orders:false,changed_invoices:false};
      const next=current.map(row=>row===existing?{...existing,payload:state,updated_at:at}:row);
      next.push({key:OCT29_GREY_GAP_KEY,payload:diagnosis,updated_at:at});
      return {rows:next,result:{already_saved:false,diagnosis,state}};
    });
    return json({ok:true,...saved,stock_changed:!saved.already_saved,lines:saved.diagnosis.lines});
  }
  if(!['preview','commit'].includes(body?.action)||!Array.isArray(body?.proofs)||body.proofs.length!==4)
    return json({error:'Four original 29 October Purchase Inflow receipts are required.'},400);
  const proofs=body.proofs as PurchaseProof[];
  const [rows,orders]=await Promise.all([readDataTable(env,'admin_data_store'),getOrders(env)]);
  const already=rows.find(row=>row.key===OCT29_RECOVERY_KEY)?.payload;
  if(already?.phase==='complete')return json({ok:true,already_saved:true,recovery:already,lines:already.lines});
  const preview=plan(proofs,rows,orders);
  const catalog=stateFrom(rows)!;
  const version=Number(catalog.payload.version||0);
  if(body.action==='preview')return json({ok:true,lines:preview,version,already_saved:false,
    message:'Only lost 29 Oct stock receipts; earlier stock deductions are never replayed.'});
  if(body.version!==version||JSON.stringify(body.lines)!==JSON.stringify(preview))
    fail('Stock or order allocations changed since preview. Refresh and preview again.');
  // Orders and catalog are different durable tables. Reject a changed
  // allocation snapshot immediately before attempting to update catalog.
  // A concurrent order save must not lead to stock being credited twice.
  const latestOrders=await getOrders(env);
  const signature=(items:Row[])=>JSON.stringify(items.map(o=>[
    o.id,o.order_status,o.stock_allocated,o.stock_allocated_at,
    o.stock_quantity_correction,(o.items||[]).map((item:Row)=>[
      item.product_id,item.variant_id,item.quantity,item.product_type,item.bundle_components,
    ])
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  if(signature(latestOrders)!==signature(orders))
    fail('An order stock allocation changed while confirming recovery. Refresh preview before saving.');
  const saved=await replaceDataTable(env,'admin_data_store',current=>{
    const prior=current.find(row=>row.key===OCT29_RECOVERY_KEY)?.payload;
    if(prior?.phase==='complete')return {rows:current,result:{already_saved:true,recovery:prior,state:stateFrom(current)!.payload}};
    if(returnPackingInProgress(current)||cancellationInProgress(current as Row[]))
      fail('Stock or Returns transaction is in progress. Retry this same recovery after it finishes.');
    const row=stateFrom(current);
    if(!row?.payload||Number(row.payload.version)!==version)
      fail('Shared stock was updated in another session. Preview again.');
    const nowPlan=plan(proofs,current,orders);
    if(JSON.stringify(nowPlan)!==JSON.stringify(preview))
      fail('Stock/Returns history changed since preview. Preview again.');
    const products=applyOct29StockRecoveryLines(row.payload.products,nowPlan);
    const at=new Date().toISOString();
    const state={...row.payload,products,version:version+1,updated_at:at};
    const recovery={phase:'complete',at,actor:String(user.display_name||user.username||user.id),
      reason:'Recover verified original 29 Oct 0→5/10 Purchase Inflow after incomplete browser-local history overwrote stock.',
      lines:nowPlan,source_receipts:proofs.map(p=>({sku:p.sku,po_number:p.po_number,log_id:p.log_id,created_at:p.created_at})),
      new_purchase_created:false,orders_changed:false,invoices_changed:false};
    const next=current.map(old=>old===row?{...row,payload:state,updated_at:at}:old);
    next.push({key:OCT29_RECOVERY_KEY,payload:recovery,updated_at:at});
    return {rows:next,result:{already_saved:false,recovery,state}};
  });
  return json({ok:true,...saved,lines:saved.recovery.lines});
 }catch(error:any){return json({error:String(error?.message||'Stock recovery failed. Nothing was changed.')},Number(error?.status||409));}
};
