import { readDataTable,replaceDataTable } from './cloudflareData';
import { cancellationInProgress } from './r2OrderCancellation';
import { returnPackingInProgress,sharedReturnInventory } from '../src/lib/returnSheets';
import { OCT29_RECOVERY_KEY,planOct29StockRecovery,type PurchaseProof,type StockRecoveryLine } from '../src/lib/oct29StockRecovery';

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
    const changed=new Map(nowPlan.map(item=>[item.product_id,item]));
    const products=(row.payload.products as Row[]).map(product=>{
      const entry=changed.get(String(product.id));
      if(!entry)return product;
      if(entry.variant_id){
        const variants=(product.variants||[]).map((v:Row)=>String(v.id)===entry.variant_id
          ?{...v,stock_quantity:entry.expected,status:entry.expected>0?'Active':'Out of Stock'}:v);
        const total=variants.reduce((n:number,v:Row)=>n+Number(v.stock_quantity||0),0);
        return {...product,variants,stock_quantity:total,status:total>0?'Active':'Out of Stock'};
      }
      return {...product,stock_quantity:entry.expected,status:entry.expected>0?'Active':'Out of Stock'};
    });
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
