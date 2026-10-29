import { readDataTable, replaceDataTable } from './cloudflareData';

/**
 * Durable history mirror. Imported browser records are receipts/audit facts,
 * NEVER new stock movements. A copy from a second browser must not credit stock.
 * Existing row IDs cannot be silently edited or overwritten by a stale browser.
 */
type Row = Record<string,any>;
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const validEntry=(row:any,kind:'purchase'|'audit')=>{
  if(!row||typeof row!=='object'||Array.isArray(row))return false;
  if(typeof row.id!=='string'||!row.id.trim()||row.id.length>180||!/^[A-Za-z0-9:_-]+$/.test(row.id))return false;
  if(typeof row.product_id!=='string'||!row.product_id||row.product_id.length>180)return false;
  if(!Number.isFinite(Date.parse(String(row.created_at||''))))return false;
  if(kind==='purchase') {
    const quantity=Number(row.quantity_added),cost=Number(row.unit_buying_price);
    return quantity>=0&&Number.isSafeInteger(quantity)&&quantity<=1_000_000
      &&Number.isFinite(cost)&&cost>=0&&cost<=1_000_000_000
      &&String(row.sku||row.variant_sku||'').length<=180
      &&String(row.supplier_name||'').length<=300
      &&String(row.po_number||'').length<=180;
  }
  return Number.isFinite(Number(row.quantity))&&Number(row.quantity)>=0
    &&String(row.change_type||'').length<=80&&String(row.reason||'').length<=2000;
};
const stripUnsafe=(row:Row)=>JSON.parse(JSON.stringify(row)) as Row;
const equal=(a:Row,b:Row)=>JSON.stringify(a)===JSON.stringify(b);
const mergeHistory=async(env:unknown,table:'purchase_orders'|'stock_history',incoming:Row[])=>
  replaceDataTable(env,table,existing=>{
    const byId=new Map(existing.map((row:Row)=>[String(row.id),row]));
    const conflicts:string[]=[];let added=0;
    const next=existing.slice();
    for(const item of incoming) {
      const previous=byId.get(String(item.id));
      if(previous){
        if(!equal(previous,item))conflicts.push(String(item.id));
        continue;
      }
      byId.set(String(item.id),item);next.push(item);added++;
    }
    return {rows:added?next:existing,result:{added,conflicts}};
  });

export const inventoryHistoryHandler=async(request:Request,env:unknown,user:Row)=>{
  if(user.role!=='admin')return reply({error:'Only Super Admin can recover or inspect full Purchasing History.'},403);
  if(request.method==='GET'){
    const [purchases,history]=await Promise.all([readDataTable(env,'purchase_orders'),readDataTable(env,'stock_history')]);
    return reply({ok:true,purchases,stock_history:history,purchase_count:purchases.length});
  }
  if(request.method!=='POST')return reply({error:'Use GET or POST.'},405);
  const raw=await request.text();
  if(raw.length>1_200_000)return reply({error:'History recovery chunk is too large.'},413);
  let body:any;try{body=JSON.parse(raw)}catch{return reply({error:'Invalid history JSON.'},400)}
  if(body?.action!=='merge-history')return reply({error:'Only idempotent history recovery is supported; this endpoint never alters stock.'},400);
  const purchases=Array.isArray(body.purchases)?body.purchases:[],history=Array.isArray(body.stock_history)?body.stock_history:[];
  if(purchases.length>100||history.length>100)return reply({error:'Use batches of 100 history entries.'},400);
  if(purchases.some((row:any)=>!validEntry(row,'purchase'))||history.some((row:any)=>!validEntry(row,'audit')))
    return reply({error:'Some history entries were invalid; no history entries were imported.'},400);
  const unique=(rows:Row[])=>new Set(rows.map(row=>String(row.id))).size===rows.length;
  if(!unique(purchases)||!unique(history))return reply({error:'Duplicate receipt IDs in the recovery request.'},409);
  const cleanPurchases=purchases.map(stripUnsafe),cleanHistory=history.map(stripUnsafe);
  // A ledger-only migration NEVER increments product stock, edits an order or
  // auto-generates an invoice. Existing receipts are immutable by ID.
  const p=cleanPurchases.length?await mergeHistory(env,'purchase_orders',cleanPurchases):{added:0,conflicts:[]};
  const h=cleanHistory.length?await mergeHistory(env,'stock_history',cleanHistory):{added:0,conflicts:[]};
  return reply({ok:true,added_purchases:p.added,added_history:h.added,
    conflicts:[...p.conflicts,...h.conflicts],stock_changed:false});
};
