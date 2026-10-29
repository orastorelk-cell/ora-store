import { dataBucket, readDataTable, replaceDataTable, type DataBucket } from './cloudflareData';
import { creditReturnStock, returnPackingInProgress } from '../src/lib/returnSheets';
import { cancellationInProgress } from './r2OrderCancellation';
import { normalizedProductType } from '../src/lib/productVariants';

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

const PURCHASE_HISTORY_BACKUP_ROOT='ora-data/purchase-history-backup-v1/';
const PURCHASE_HISTORY_BACKUP_INDEX=PURCHASE_HISTORY_BACKUP_ROOT+'index.json';
type PurchaseBackupIndex={format:'ora-purchase-history-backup-v1';records:Record<string,string>;updated_at:string};
const backupRecordKey=(row:Row)=>{
  const millis=Date.parse(String(row.created_at||''));
  if(!Number.isFinite(millis))throw Object.assign(new Error('Purchase history backup needs a valid bill date.'),{status:400});
  const day=new Date(millis).toISOString().slice(0,10).replace(/-/g,'/');
  return PURCHASE_HISTORY_BACKUP_ROOT+'records/'+day+'/'+String(row.id)+'.json';
};
const readPurchaseHistoryBackup=async(bucket:DataBucket):Promise<Row[]>=>{
  const object=await bucket.get(PURCHASE_HISTORY_BACKUP_INDEX);
  if(!object)return [];
  let index:PurchaseBackupIndex;
  try{index=JSON.parse(await object.text()) as PurchaseBackupIndex;}catch{throw new Error('Purchase-history R2 backup index is not valid JSON.');}
  if(index?.format!=='ora-purchase-history-backup-v1'||!index.records||typeof index.records!=='object'||Array.isArray(index.records))
    throw new Error('Purchase-history R2 backup index has an unexpected format.');
  const rows:Row[]=[];
  for(const [id,key] of Object.entries(index.records)){
    if(typeof key!=='string'||!key.startsWith(PURCHASE_HISTORY_BACKUP_ROOT+'records/'))continue;
    const record=await bucket.get(key);
    if(!record)throw new Error('A purchase-history R2 backup record is missing: '+id);
    let row:Row;try{row=JSON.parse(await record.text()) as Row;}catch{throw new Error('A purchase-history R2 backup record is not valid JSON: '+id);}
    if(String(row?.id||'')!==id||!validEntry(row,'purchase'))throw new Error('A purchase-history R2 backup record failed validation: '+id);
    rows.push(row);
  }
  return rows;
};
const writePurchaseHistoryBackup=async(bucket:DataBucket,rows:Row[])=>{
  if(!rows.length)return;
  const keys=new Map<string,string>();
  for(const row of rows){
    const id=String(row.id),key=backupRecordKey(row),serialized=JSON.stringify(row);
    const existing=await bucket.get(key);
    if(existing){
      let previous:Row;try{previous=JSON.parse(await existing.text()) as Row;}catch{throw Object.assign(new Error('Existing purchase-history R2 backup is unreadable: '+id),{status:409});}
      if(!equal(previous,row))throw Object.assign(new Error('An R2 backup already exists for this purchase ID with different details: '+id),{status:409});
      keys.set(id,key);continue;
    }
    const saved=await bucket.put(key,serialized,{httpMetadata:{contentType:'application/json',cacheControl:'no-store'},customMetadata:{oraPurchaseHistoryBackup:'1',recordId:id},onlyIf:{etagDoesNotMatch:'*'}});
    if(!saved){
      const raced=await bucket.get(key);
      if(!raced||!equal(JSON.parse(await raced.text()),row))throw Object.assign(new Error('Could not confirm the R2 backup record: '+id),{status:503});
    }
    keys.set(id,key);
  }
  for(let attempt=0;attempt<8;attempt++){
    const existing=await bucket.get(PURCHASE_HISTORY_BACKUP_INDEX);
    let index:PurchaseBackupIndex={format:'ora-purchase-history-backup-v1',records:{},updated_at:new Date().toISOString()};
    if(existing){
      try{index=JSON.parse(await existing.text()) as PurchaseBackupIndex;}catch{throw Object.assign(new Error('Purchase-history R2 backup index is not readable; nothing was confirmed.'),{status:503});}
      if(index?.format!=='ora-purchase-history-backup-v1'||!index.records||typeof index.records!=='object'||Array.isArray(index.records))
        throw Object.assign(new Error('Purchase-history R2 backup index has an unexpected format.'),{status:503});
    }
    const records={...index.records};
    for(const [id,key] of keys){
      if(records[id]&&records[id]!==key)throw Object.assign(new Error('R2 backup index already contains a different path for purchase '+id),{status:409});
      records[id]=key;
    }
    const next:PurchaseBackupIndex={format:'ora-purchase-history-backup-v1',records,updated_at:new Date().toISOString()};
    const saved=await bucket.put(PURCHASE_HISTORY_BACKUP_INDEX,JSON.stringify(next),{
      httpMetadata:{contentType:'application/json',cacheControl:'no-store'},
      customMetadata:{oraPurchaseHistoryBackup:'index'},
      onlyIf:existing?{etagMatches:existing.etag}:{etagDoesNotMatch:'*'}
    });
    if(saved)return;
  }
  throw Object.assign(new Error('Could not confirm the Purchase History R2 backup index. Please retry; stock was not changed.'),{status:503});
};

export const readDurablePurchasingHistory=async(env:unknown)=>{
  const [storedPurchases,storedHistory,admin]=await Promise.all([
    readDataTable(env,'purchase_orders'),readDataTable(env,'stock_history'),readDataTable(env,'admin_data_store')
  ]);
  let backupPurchases:Row[]=[],backupWarning='';
  const bucket=dataBucket(env);
  if(bucket){try{backupPurchases=await readPurchaseHistoryBackup(bucket);}catch(error:any){backupWarning=error?.message||'Purchase-history R2 backup could not be read.';}}
  const receipts=admin.filter(row=>String(row.key||'').startsWith('inventory-purchase-v1:')&&row.payload?.phase==='complete');
  const fifo=admin.filter(row=>String(row.key||'').startsWith('fifo-stock-allocation-v1:')&&row.payload?.stock_changed_once===true);
  const byId=<T extends Row>(rows:T[])=>[...new Map(rows.map(row=>[String(row.id),row])).values()];
  return {
    purchases:byId([...storedPurchases,...receipts.flatMap(row=>row.payload.purchases||[]),...backupPurchases]),
    backup_warning:backupWarning,
    stock_history:byId([...storedHistory,...receipts.flatMap(row=>row.payload.stock_history||[]),...fifo.flatMap(row=>row.payload.logs||[])])
  };
};
export const inventoryHistoryHandler=async(request:Request,env:unknown,user:Row)=>{
  if(user.role!=='admin')return reply({error:'Only Super Admin can recover or inspect full Purchasing History.'},403);
  if(request.method==='GET'){
    const {purchases,stock_history,backup_warning}=await readDurablePurchasingHistory(env);
    return reply({ok:true,purchases,stock_history,purchase_count:purchases.length,server_authoritative:true,r2_backup_warning:backup_warning||undefined});
  }
  if(request.method!=='POST')return reply({error:'Use GET or POST.'},405);
  const raw=await request.text();
  if(raw.length>1_200_000)return reply({error:'History recovery chunk is too large.'},413);
  let body:any;try{body=JSON.parse(raw)}catch{return reply({error:'Invalid history JSON.'},400)}
  if(body?.action==='purchase-stock'){
    const id=String(body.operation_id||'');
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(id))return reply({error:'Invalid stock-purchase operation ID.'},400);
    const items=body.items;
    if(!Array.isArray(items)||!items.length||items.length>100)return reply({error:'Select 1-100 Purchase / Stock In lines.'},400);
    const parsed:Row[]=[];
    for(const row of items){
      if(!row||typeof row!=='object'||typeof row.product_id!=='string'||!row.product_id||
        typeof row.supplier_name!=='string'||!row.supplier_name.trim()||
        row.supplier_name.length>200||typeof row.variant_id!=='undefined'&&typeof row.variant_id!=='string'||
        !Number.isSafeInteger(row.quantity_added)||row.quantity_added<=0||row.quantity_added>1000000||
        typeof row.unit_buying_price!=='number'||!Number.isFinite(row.unit_buying_price)||row.unit_buying_price<0||row.unit_buying_price>1e9||
        String(row.invoice_ref||'').length>180||String(row.notes||'').length>2000||
        String(row.bill_image_url||'').length>900)
        return reply({error:'Invalid purchase line. Nothing was saved.'},400);
      parsed.push({
        supplier_name:row.supplier_name.trim(),product_id:row.product_id,
        ...(row.variant_id?{variant_id:row.variant_id}:{}),
        quantity_added:row.quantity_added,unit_buying_price:row.unit_buying_price,
        invoice_ref:String(row.invoice_ref||'').trim(),bill_image_url:String(row.bill_image_url||'').trim(),
        notes:String(row.notes||'').trim()
      });
    }
    const identity=JSON.stringify(parsed);
    const receiptKey='inventory-purchase-v1:'+id;
    // Legacy Purchasing was browser-local. Once those receipts are migrated to
    // the durable purchase_orders table, a second submission of the same
    // supplier bill must not credit the stock twice.
    const previousLegacy=await readDataTable(env,'purchase_orders');
    const today=new Date(Date.now()+330*60_000).toISOString().slice(0,10);
    const receiptDay=(date:unknown)=>{const millis=Date.parse(String(date||''));return Number.isFinite(millis)?new Date(millis+330*60_000).toISOString().slice(0,10):'';};
    const sameLine=(old:Row,line:Row)=>receiptDay(old.created_at)===today
      &&String(old.product_id)===String(line.product_id)
      &&String(old.variant_id||'')===String(line.variant_id||'')
      &&String(old.supplier_name||'').trim().toLowerCase()===String(line.supplier_name||'').trim().toLowerCase()
      &&Number(old.quantity_added)===Number(line.quantity_added)
      &&Number(old.unit_buying_price)===Number(line.unit_buying_price)
      &&String(old.invoice_ref||'').trim()===String(line.invoice_ref||'').trim();
    const result=await replaceDataTable(env,'admin_data_store',rows=>{
      const previous=rows.find(row=>String(row.key)===receiptKey)?.payload;
      if(previous){
        if(previous.identity!==identity)throw Object.assign(new Error('Purchase operation already exists with different details. Do not resubmit.'),{status:409});
        const catalog=rows.find(row=>row.key==='storefront-state-v1')?.payload;
        return {rows,result:{ok:true,already_saved:true,stock_changed:false,purchases:previous.purchases,stock_history:previous.stock_history,
          state:catalog}};
      }
      const historical=rows.filter(row=>String(row.key||'').startsWith('inventory-purchase-v1:')&&row.payload?.phase==='complete')
        .flatMap(row=>row.payload.purchases||[]);
      // ANY duplicate line blocks the entire new bill, even if the other lines are new.
      // Otherwise one repeated variant (BLACK) plus one new variant (GREY)
      // would silently add the repeated stock a second time.
      if(parsed.some(line=>[...previousLegacy,...historical].some(receipt=>sameLine(receipt,line))))
        throw Object.assign(new Error('Possible duplicate Purchase / Stock In today. These exact supplier/item/qty/cost lines were already recorded. Verify the earlier bill; use its unique invoice reference for a genuinely separate purchase. Nothing was added again.'),{status:409});
      if(returnPackingInProgress(rows)||cancellationInProgress(rows as any[]))
        throw Object.assign(new Error('A stock/returns transaction is in progress; retry the same purchase operation.'),{status:409});
      const catalog=rows.find(row=>row.key==='storefront-state-v1');
      if(!catalog?.payload||!Array.isArray(catalog.payload.products))
        throw Object.assign(new Error('Shared stock catalog unavailable. Nothing was saved.'),{status:503});
      const products=(catalog.payload.products as Row[]).map(p=>({...p,variants:Array.isArray(p.variants)?p.variants.map((v:Row)=>({...v})):[]}));
      const byProduct=new Map(products.map(p=>[String(p.id),p]));
      const at=new Date().toISOString(),actor=String(user.display_name||user.username||user.id);
      const purchases:Row[]=[],logs:Row[]=[];
      // Validate the COMPLETE transaction on private copies before saving anything.
      parsed.forEach((row,index)=>{
        const product=byProduct.get(row.product_id);
        if(!product)throw Object.assign(new Error('Selected Item Code no longer exists. Refresh stock.'),{status:409});
        const type=normalizedProductType(product as any);
        if(type==='bundle')throw Object.assign(new Error('Add stock to the bundle components, not the bundle itself.'),{status:400});
        const variants=product.variants as Row[];
        const v=type==='variant'?variants.find(v=>String(v.id)===row.variant_id):null;
        if(type==='variant'&&!v||type!=='variant'&&row.variant_id)
          throw Object.assign(new Error('Exact colour/variant is required.'),{status:400});
        const target=v||product,before=Number(target.stock_quantity||0);
        const credited=creditReturnStock(target,row.quantity_added);
        const after=credited.stock_quantity;
        const sku=String(target.sku||product.sku||'');
        const label=String(product.name_en||sku)+(v?' - '+String(v.option_value||''):'');
        const receiptId='stock-in:'+id+':'+index;
        if(v){
          product.variants=variants.map(old=>old.id===v.id?{...v,stock_quantity:after,return_stock_debt:credited.return_stock_debt,status:after>0?'Active':'Out of Stock'}:old);
          product.stock_quantity=(product.variants as Row[]).reduce((sum,current)=>sum+Number(current.stock_quantity||0),0);
          product.status=product.stock_quantity>0?'Active':'Out of Stock';
        }else{
          product.stock_quantity=after;product.return_stock_debt=credited.return_stock_debt;
          product.status=after>0?'Active':'Out of Stock';
        }
        const poNumber='PO-'+at.slice(0,4)+'-'+id.slice(0,8).toUpperCase()+'-'+(index+1);
        purchases.push({
          id:receiptId,po_number:poNumber,supplier_name:row.supplier_name,product_id:product.id,
          product_name:product.name_en,sku,variant_id:v?.id,variant_name:v?.option_value,variant_sku:v?.sku,
          quantity_added:row.quantity_added,unit_buying_price:row.unit_buying_price,
          total_cost:row.quantity_added*row.unit_buying_price,invoice_ref:row.invoice_ref||undefined,
          bill_image_url:row.bill_image_url||undefined,notes:row.notes||undefined,performed_by:actor,created_at:at,
        });
        logs.push({
          id:'history:'+receiptId,product_id:product.id,variant_id:v?.id,product_name:label,
          change_type:'Purchase Inflow',quantity:row.quantity_added,previous_stock:before,new_stock:after,
          reason:poNumber+' • '+row.supplier_name,performed_by:actor,created_at:at,
        });
      });
      const state={...catalog.payload,products,version:Number(catalog.payload.version||0)+1,updated_at:at};
      const receipt={phase:'complete',identity,operation_id:id,purchases,stock_history:logs,created_at:at};
      return {rows:[...rows.map(row=>row===catalog?{...catalog,payload:state,updated_at:at}:row),
          {key:receiptKey,payload:receipt,updated_at:at}],result:{ok:true,already_saved:false,stock_changed:true,purchases,stock_history:logs,state}};
    });
    return reply(result);
  }
  if(body?.action!=='merge-history')return reply({error:'Only signed purchase-stock or idempotent history recovery is supported.'},400);
  const purchases=Array.isArray(body.purchases)?body.purchases:[],history=Array.isArray(body.stock_history)?body.stock_history:[];
  if(purchases.length>100||history.length>100)return reply({error:'Use batches of 100 history entries.'},400);
  if(purchases.some((row:any)=>!validEntry(row,'purchase'))||history.some((row:any)=>!validEntry(row,'audit')))
    return reply({error:'Some history entries were invalid; no history entries were imported.'},400);
  const unique=(rows:Row[])=>new Set(rows.map(row=>String(row.id))).size===rows.length;
  if(!unique(purchases)||!unique(history))return reply({error:'Duplicate receipt IDs in the recovery request.'},409);
  const cleanPurchases=purchases.map(stripUnsafe),cleanHistory=history.map(stripUnsafe);
  // A ledger-only migration NEVER increments product stock, edits an order or
  // auto-generates an invoice. Existing receipts are immutable by ID.
  const bucket=dataBucket(env);
  if(!bucket&&cleanPurchases.length)return reply({error:'Purchase History R2 backup is unavailable. Nothing was confirmed as saved.'},503);
  try{if(bucket)await writePurchaseHistoryBackup(bucket,cleanPurchases);}catch(error:any){return reply({error:error?.message||'Purchase History R2 backup failed. Nothing was confirmed as saved.'},Number(error?.status)||503);}
  const p=cleanPurchases.length?await mergeHistory(env,'purchase_orders',cleanPurchases):{added:0,conflicts:[]};
  const h=cleanHistory.length?await mergeHistory(env,'stock_history',cleanHistory):{added:0,conflicts:[]};
  return reply({ok:true,added_purchases:p.added,added_history:h.added,
    conflicts:[...p.conflicts,...h.conflicts],stock_changed:false,r2_backup_saved:cleanPurchases.length>0});
};
