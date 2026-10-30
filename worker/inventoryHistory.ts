import { dataBucket, readDataTable, replaceDataTable, type DataBucket } from './cloudflareData';
import { creditReturnStock, returnPackingInProgress } from '../src/lib/returnSheets';
import { cancellationInProgress } from './r2OrderCancellation';
import { normalizedProductType } from '../src/lib/productVariants';
import { stockConsumedItems } from '../src/lib/orderStockQuantities';

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
  const entries=Object.entries(index.records).filter(([,key])=>typeof key==='string'&&key.startsWith(PURCHASE_HISTORY_BACKUP_ROOT+'records/'));
  const rows:Row[]=[];
  // R2 reads are network-bound. A serial walk across the whole backup index
  // made Purchase History corrections exceed the browser request timeout.
  // Keep bounded concurrency so large archives stay within Worker subrequest
  // limits while still completing quickly.
  for(let offset=0;offset<entries.length;offset+=24){
    const batch=await Promise.all(entries.slice(offset,offset+24).map(async([id,key])=>{
      const record=await bucket.get(key);
      if(!record)throw new Error('A purchase-history R2 backup record is missing: '+id);
      let row:Row;try{row=JSON.parse(await record.text()) as Row;}catch{throw new Error('A purchase-history R2 backup record is not valid JSON: '+id);}
      if(String(row?.id||'')!==id||!validEntry(row,'purchase'))throw new Error('A purchase-history R2 backup record failed validation: '+id);
      return row;
    }));
    rows.push(...batch);
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
  const corrections=admin.filter(row=>String(row.key||'').startsWith('purchase-history-correction-v1:')&&row.payload?.purchase?.id);
  const byId=<T extends Row>(rows:T[])=>[...new Map(rows.map(row=>[String(row.id),row])).values()];
  const correctedPurchases=corrections.map(row=>row.payload.purchase as Row);
  const correctionHistory=corrections.flatMap(row=>Array.isArray(row.payload.stock_history)?row.payload.stock_history as Row[]:[]);
  return {
    // Corrections are an append-only overlay. Original rows and bill images in
    // purchase_orders/R2 remain intact for audit, while the corrected version
    // is the current visible history row.
    purchases:byId([...storedPurchases,...receipts.flatMap(row=>row.payload.purchases||[]),...backupPurchases,...correctedPurchases]),
    backup_warning:backupWarning,
    stock_history:byId([...storedHistory,...receipts.flatMap(row=>row.payload.stock_history||[]),...fifo.flatMap(row=>row.payload.logs||[]),...correctionHistory])
  };
};

const CORRECTION_PREFIX='purchase-history-correction-v1:';
const CORRECTION_OPERATION_PREFIX='purchase-history-correction-operation-v1:';
const sameCorrection=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const writePurchaseCorrectionBackup=async(bucket:DataBucket,operationId:string,rows:Row[])=>{
  const key='ora-data/purchase-history-corrections-v1/'+operationId+'.json';
  const body=JSON.stringify({format:'ora-purchase-history-correction-v1',operation_id:operationId,corrected_at:new Date().toISOString(),purchases:rows});
  const existing=await bucket.get(key);
  if(existing){
    let previous:Row;try{previous=JSON.parse(await existing.text()) as Row;}catch{throw Object.assign(new Error('The existing R2 correction backup is unreadable.'),{status:409});}
    if(previous?.format!=='ora-purchase-history-correction-v1'||previous?.operation_id!==operationId||!sameCorrection(previous?.purchases,rows))throw Object.assign(new Error('A different R2 correction backup already uses this operation ID.'),{status:409});
    return;
  }
  const saved=await bucket.put(key,body,{httpMetadata:{contentType:'application/json',cacheControl:'no-store'},customMetadata:{oraPurchaseHistoryCorrection:'1',operationId},onlyIf:{etagDoesNotMatch:'*'}});
  if(!saved){
    const raced=await bucket.get(key);
    let previous:Row|null=null;try{if(raced)previous=JSON.parse(await raced.text()) as Row;}catch{}
    if(!previous||previous?.format!=='ora-purchase-history-correction-v1'||previous?.operation_id!==operationId||!sameCorrection(previous?.purchases,rows))throw Object.assign(new Error('Could not confirm the R2 Purchase History correction backup.'),{status:503});
  }
};
export const inventoryHistoryHandler=async(request:Request,env:unknown,user:Row)=>{
  if(user.role!=='admin')return reply({error:'Only Super Admin can recover or inspect full Purchasing History.'},403);
  if(request.method==='GET'){
    if(new URL(request.url).searchParams.get('stock-counts')==='1'){
      const rows=await readDataTable(env,'admin_data_store');
      const sessions=rows.filter(row=>String(row.key||'').startsWith('stock-count-session-v1:')&&row.payload?.format==='ora-stock-count-session-v1')
        .map(row=>row.payload as Row).sort((a,b)=>Date.parse(String(b.counted_at||''))-Date.parse(String(a.counted_at||''))).slice(0,20);
      return reply({ok:true,stock_count_sessions:sessions});
    }
    const {purchases,stock_history,backup_warning}=await readDurablePurchasingHistory(env);
    return reply({ok:true,purchases,stock_history,purchase_count:purchases.length,server_authoritative:true,r2_backup_warning:backup_warning||undefined});
  }
  if(request.method!=='POST')return reply({error:'Use GET or POST.'},405);
  const raw=await request.text();
  if(raw.length>1_200_000)return reply({error:'History recovery chunk is too large.'},413);
  let body:any;try{body=JSON.parse(raw)}catch{return reply({error:'Invalid history JSON.'},400)}
  if(body?.action==='stock-count-session'){
    const sessionId=String(body.session_id||'');
    const countedBy=String(body.counted_by||'').trim(),notes=String(body.notes||'').trim();
    const incoming=body.rows;
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(sessionId)||!countedBy||countedBy.length>120||notes.length>500||!Array.isArray(incoming)||!incoming.length||incoming.length>500)
      return reply({error:'Enter a staff name and 1-500 valid stock counts.'},400);
    const admin=await readDataTable(env,'admin_data_store');
    const catalog=admin.find(row=>row.key==='storefront-state-v1')?.payload;
    if(!catalog||!Array.isArray(catalog.products))return reply({error:'Shared stock catalog unavailable. No count was saved.'},503);
    const products=catalog.products as Row[];
    const productsById=new Map(products.map(product=>[String(product.id),product] as [string,Row]));
    const orders=(await readDataTable(env,'order_snapshots')).map(row=>row.payload).filter(Boolean);
    const packingBySku=new Map<string,number>();
    const addPacking=(sku:unknown,quantity:unknown)=>{
      const key=String(sku||'').trim().toUpperCase(),amount=Math.max(0,Number(quantity||0));
      if(key&&amount)packingBySku.set(key,(packingBySku.get(key)||0)+amount);
    };
    try{
      orders.filter(order=>order.stock_allocated&&order.stock_status==='Allocated'&&order.order_status!=='Cancelled'&&order.order_status!=='Shipped'&&order.order_status!=='Delivered'&&order.dispatch_status!=='Handed Over'&&!order.is_duplicate_order&&!order.is_test_order)
        .forEach(order=>stockConsumedItems(order).forEach((item:any)=>{
          const orderQty=Math.max(1,Number(item.quantity||1));addPacking(item.sku||item.main_sku,orderQty);
          if(item.product_type==='bundle'&&Array.isArray(item.bundle_components))item.bundle_components.forEach((component:any)=>addPacking(component.sku,orderQty*Math.max(1,Number(component.quantity_per_bundle||1))));
        }));
    }catch(error:any){return reply({error:error?.message||'Packing quantities need review. No count was saved.'},409);}
    const keys=new Set<string>(),countRows:Row[]=[];
    for(const row of incoming){
      if(!row||typeof row!=='object'||typeof row.product_id!=='string'||!Number.isSafeInteger(row.actual_qty)||row.actual_qty<0||row.actual_qty>1_000_000||typeof row.sku!=='string'||row.sku.length>180)
        return reply({error:'A stock count row is invalid. No count was saved.'},400);
      const product=productsById.get(row.product_id);
      if(!product||normalizedProductType(product as any)==='bundle')return reply({error:'Choose an existing non-bundle Item Code. No count was saved.'},400);
      const variant=typeof row.variant_id==='string'?product.variants?.find((item:Row)=>String(item.id)===row.variant_id):undefined;
      if(normalizedProductType(product as any)==='variant'&&!variant)return reply({error:'Choose the exact colour / variant before saving this stock count.'},400);
      if(row.variant_id&&(!variant||normalizedProductType(product as any)!=='variant'))return reply({error:'The selected Item Code / variant does not match.'},409);
      const sku=String(variant?.sku||product.sku||'').trim().toUpperCase();
      if(sku!==String(row.sku).trim().toUpperCase())return reply({error:'The Item Code changed while counting. Refresh the stock list and retry.'},409);
      const identityKey=String(product.id)+'::'+String(variant?.id||'base');
      if(keys.has(identityKey))return reply({error:'The same Item Code was included more than once.'},409);
      keys.add(identityKey);
      const available=Math.max(0,Number(variant?.stock_quantity??product.stock_quantity??0));
      const packing=Math.max(0,Number(packingBySku.get(sku)||0));
      countRows.push({product_id:String(product.id),...(variant?{variant_id:String(variant.id)}:{}),sku,name:String(product.name_en||sku),variant:String(variant?.option_value||''),expected_available:available,expected_packing:packing,expected_qty:available+packing,actual_qty:row.actual_qty,difference:row.actual_qty-(available+packing)});
    }
    const countedAt=new Date().toISOString(),recordedBy=String(user.display_name||user.username||user.id),key='stock-count-session-v1:'+sessionId;
    const identity=JSON.stringify({counted_by:countedBy,notes,rows:countRows.map(row=>({product_id:row.product_id,variant_id:row.variant_id,sku:row.sku,actual_qty:row.actual_qty}))});
    const session={format:'ora-stock-count-session-v1',session_id:sessionId,counted_at:countedAt,counted_by:countedBy,recorded_by:recordedBy,notes,identity,rows:countRows};
    const saved=await replaceDataTable(env,'admin_data_store',existing=>{
      const prior=existing.find(row=>String(row.key)===key);
      if(prior){
        if(prior.payload?.identity!==identity)return{rows:existing,result:{ok:false,status:409,error:'This count session ID already contains different counts. Refresh before retrying.'}};
        return{rows:existing,result:{ok:true,already_saved:true,session:prior.payload}};
      }
      return{rows:[...existing,{key,payload:session,updated_at:countedAt}],result:{ok:true,already_saved:false,session}};
    });
    return reply(saved,saved.ok?200:Number(saved.status)||409);
  }
  if(body?.action==='correct-history'){
    const operationId=String(body.operation_id||'');
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(operationId))return reply({error:'Invalid Purchase History correction ID.'},400);
    const incoming=body.rows;
    if(!Array.isArray(incoming)||!incoming.length||incoming.length>100)return reply({error:'Correct 1-100 Purchase History rows at a time.'},400);
    const seen=new Set<string>(),rows:Row[]=[];
    for(const row of incoming){
      if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id.trim()||row.id.length>180||!/^[A-Za-z0-9:_-]+$/.test(row.id)||
        typeof row.product_id!=='string'||!row.product_id||row.product_id.length>180||
        typeof row.variant_id!=='undefined'&&typeof row.variant_id!=='string'||
        typeof row.supplier_name!=='string'||row.supplier_name.length>300||
        !Number.isSafeInteger(row.quantity_added)||row.quantity_added<0||row.quantity_added>1_000_000||
        typeof row.unit_buying_price!=='number'||!Number.isFinite(row.unit_buying_price)||row.unit_buying_price<0||row.unit_buying_price>1e9||
        !Number.isFinite(Date.parse(String(row.created_at||'')))||String(row.invoice_ref||'').length>180||String(row.notes||'').length>2000)
        return reply({error:'Invalid Purchase History correction. Nothing was saved.'},400);
      if(seen.has(row.id))return reply({error:'A Purchase History row was repeated in this correction.'},409);
      seen.add(row.id);
      rows.push({id:row.id,product_id:row.product_id,...(row.variant_id?{variant_id:row.variant_id}:{}),supplier_name:row.supplier_name.trim(),quantity_added:row.quantity_added,unit_buying_price:row.unit_buying_price,invoice_ref:String(row.invoice_ref||'').trim(),notes:String(row.notes||'').trim(),created_at:new Date(row.created_at).toISOString()});
    }
    const identity=JSON.stringify(rows),operationKey=CORRECTION_OPERATION_PREFIX+operationId;
    const [history,admin]=await Promise.all([readDurablePurchasingHistory(env),readDataTable(env,'admin_data_store')]);
    const priorOperation=admin.find(row=>String(row.key)===operationKey)?.payload;
    if(priorOperation){
      if(priorOperation.identity!==identity)return reply({error:'This correction ID was already used for different details. Refresh Purchase History before retrying.'},409);
      const catalog=admin.find(row=>row.key==='storefront-state-v1')?.payload;
      const current=await readDurablePurchasingHistory(env);
      return reply({ok:true,already_saved:true,correctedCount:rows.length,netQuantityChange:Number(priorOperation.net_quantity_change||0),stock_adjusted:Boolean(priorOperation.stock_adjusted),deallocatedOrderNumbers:[],purchases:current.purchases,stock_history:current.stock_history,state:catalog});
    }
    const purchaseById=new Map(history.purchases.map((purchase:Row)=>[String(purchase.id),purchase] as [string,Row]));
    const receiptRows=admin.filter(row=>String(row.key||'').startsWith('inventory-purchase-v1:')&&row.payload?.phase==='complete');
    const creditedIds=new Set<string>(receiptRows.flatMap(row=>(row.payload.purchases||[]).map((purchase:Row)=>String(purchase.id))));
    const catalogRow=admin.find(row=>row.key==='storefront-state-v1');
    if(!catalogRow?.payload||!Array.isArray(catalogRow.payload.products))return reply({error:'Shared stock catalog unavailable. Nothing was saved.'},503);
    if(returnPackingInProgress(admin)||cancellationInProgress(admin as any[]))return reply({error:'A stock / return transaction is in progress. Nothing was saved; retry after it completes.'},409);
    const products=(catalogRow.payload.products as Row[]).map(product=>({...product,variants:Array.isArray(product.variants)?product.variants.map((variant:Row)=>({...variant})):[]}));
    const productsById=new Map(products.map(product=>[String(product.id),product] as [string,Row]));
    const corrections:Row[]=[],deltas=new Map<string,{product:Row;variant_id?:string;delta:number;sku:string;label:string}>();
    for(const row of rows){
      const original=purchaseById.get(row.id);
      if(!original)return reply({error:'Purchase '+row.id+' is no longer available. Refresh Purchase History; no changes were saved.'},409);
      const product=productsById.get(row.product_id);
      if(!product||normalizedProductType(product as any)==='bundle')return reply({error:'Choose an existing non-bundle Item Code for '+String(original.po_number||row.id)+'. Nothing was saved.'},400);
      const productType=normalizedProductType(product as any);
      const variant=row.variant_id?product.variants.find((item:Row)=>String(item.id)===row.variant_id):undefined;
      if(row.variant_id&&(productType!=='variant'||!variant))return reply({error:'The selected colour / variant no longer exists for this Item Code. Refresh and try again.'},409);
      const stockCredited=creditedIds.has(row.id);
      if(stockCredited&&productType==='variant'&&!variant)return reply({error:'Stock-credit Purchase rows require an exact colour / variant. Nothing was saved.'},400);
      const oldProduct=productsById.get(String(original.product_id));
      const oldVariant=original.variant_id?oldProduct?.variants.find((item:Row)=>String(item.id)===String(original.variant_id)):undefined;
      if(stockCredited){
        if(!oldProduct||normalizedProductType(oldProduct as any)==='variant'&&!oldVariant)return reply({error:'The original stock-credit Item Code / variant cannot be found. Nothing was saved.'},409);
        const addDelta=(targetProduct:Row,targetVariant:Row|undefined,delta:number)=>{
          if(!delta)return;
          const variantId=targetVariant?String(targetVariant.id):undefined,key=String(targetProduct.id)+'::'+String(variantId||'base');
          const sku=String(targetVariant?.sku||targetProduct.sku||original.variant_sku||original.sku||'');
          const label=String(targetProduct.name_en||sku)+(targetVariant?' - '+String(targetVariant.option_value||''):'');
          const old=deltas.get(key);deltas.set(key,{product:targetProduct,variant_id:variantId,delta:(old?.delta||0)+delta,sku,label});
        };
        addDelta(oldProduct,oldVariant,-Math.max(0,Number(original.quantity_added||0)));
        addDelta(product,variant,row.quantity_added);
      }
      corrections.push({...original,...row,product_name:String(product.name_en||original.product_name||''),sku:String(product.sku||original.sku||''),variant_id:variant?.id,variant_name:variant?.option_value,variant_sku:variant?.sku,total_cost:row.quantity_added*row.unit_buying_price,invoice_ref:row.invoice_ref||undefined,notes:row.notes||undefined});
    }
    const stockHistory:Row[]=[],now=new Date().toISOString();
    for(const change of deltas.values()){
      if(!change.delta)continue;
      const target=change.variant_id?change.product.variants.find((item:Row)=>String(item.id)===change.variant_id):change.product;
      if(!target)return reply({error:'A Purchase variant no longer exists. Nothing was saved.'},409);
      const before=Math.max(0,Number(target.stock_quantity||0)),after=before+change.delta;
      if(after<0)return reply({error:change.sku+': available stock is '+before+', so this correction cannot safely remove '+Math.abs(change.delta)+'. Nothing was saved.'},409);
      target.stock_quantity=after;target.status=after>0?'Active':'Out of Stock';
      if(change.variant_id){change.product.variants=change.product.variants.map((item:Row)=>String(item.id)===change.variant_id?target:item);change.product.stock_quantity=change.product.variants.reduce((sum:number,item:Row)=>sum+Math.max(0,Number(item.stock_quantity||0)),0);change.product.status=change.product.stock_quantity>0?'Active':'Out of Stock';}
      stockHistory.push({id:'stock-history-purchase-correction:'+operationId+':'+stockHistory.length,product_id:change.product.id,product_name:change.label,change_type:'Adjustment',quantity:Math.abs(change.delta),previous_stock:before,new_stock:after,reason:'Purchase History correction • '+change.sku,performed_by:String(user.display_name||user.username||user.id),created_at:now});
    }
    const bucket=dataBucket(env);
    if(!bucket)return reply({error:'Purchase History correction backup is unavailable. Nothing was saved.'},503);
    try{await writePurchaseCorrectionBackup(bucket,operationId,corrections);}catch(error:any){return reply({error:error?.message||'Purchase History correction backup failed. Nothing was saved.'},Number(error?.status)||503);}
    try{
      await replaceDataTable(env,'admin_data_store',current=>{
        const operation=current.find(row=>String(row.key)===operationKey)?.payload;
        if(operation){if(operation.identity!==identity)throw Object.assign(new Error('This correction ID was already used for different details.'),{status:409});return{rows:current,result:undefined};}
        if(returnPackingInProgress(current)||cancellationInProgress(current as any[]))throw Object.assign(new Error('A stock / return transaction is in progress. Nothing was saved; retry after it completes.'),{status:409});
        const liveCatalog=current.find(row=>row.key==='storefront-state-v1');
        if(!liveCatalog?.payload||Number(liveCatalog.payload.version||0)!==Number(catalogRow.payload.version||0)||String(liveCatalog.updated_at||'')!==String(catalogRow.updated_at||''))throw Object.assign(new Error('Shared stock changed while this correction was being prepared. Refresh Inventory & Stock and try again.'),{status:409});
        const latest=new Map(current.filter(row=>String(row.key||'').startsWith(CORRECTION_PREFIX)).map(row=>[String(row.payload?.purchase?.id),row.payload.purchase] as [string,Row]));
        for(const row of rows){const before=purchaseById.get(row.id)!,after=latest.get(row.id);if(after&&!sameCorrection(after,before))throw Object.assign(new Error('Another correction changed '+String(before.po_number||row.id)+'. Refresh before saving.'),{status:409});}
        const result=current.slice();
        if(deltas.size&&Array.from(deltas.values()).some(change=>change.delta!==0)){const nextCatalog={...catalogRow,payload:{...catalogRow.payload,products,version:Number(catalogRow.payload.version||0)+1,updated_at:now},updated_at:now};const catalogAt=result.findIndex(row=>row.key==='storefront-state-v1');result[catalogAt]=nextCatalog;}
        for(let i=0;i<corrections.length;i++){
          const purchase=corrections[i],key=CORRECTION_PREFIX+purchase.id,index=result.findIndex(row=>String(row.key)===key);
          const payload={purchase,stock_history:stockHistory.filter(log=>String(log.id).startsWith('stock-history-purchase-correction:'+operationId+':'))};
          const saved={key,payload,updated_at:now};if(index>=0)result[index]=saved;else result.push(saved);
        }
        result.push({key:operationKey,payload:{identity,operation_id:operationId,purchase_ids:corrections.map(row=>row.id),net_quantity_change:corrections.reduce((sum,row)=>sum+Number(row.quantity_added||0)-Number(purchaseById.get(row.id)?.quantity_added||0),0),stock_adjusted:stockHistory.length>0,created_at:now},updated_at:now});
        return{rows:result,result:undefined};
      });
    }catch(error:any){return reply({error:error?.message||'Purchase History correction did not save. Refresh before retrying.'},Number(error?.status)||503);}
    // We already loaded the authoritative ledger before validating the edit and
    // committed the correction overlay above. Re-reading every R2 backup just
    // to build the response doubled request latency and caused browser timeouts.
    const correctedById=new Map(corrections.map(row=>[String(row.id),row] as [string,Row]));
    const purchases=[...new Map(history.purchases.map((row:Row)=>[String(row.id),correctedById.get(String(row.id))||row])).values()];
    const stock_history=[...new Map([...history.stock_history,...stockHistory].map((row:Row)=>[String(row.id),row])).values()];
    const state=stockHistory.length?{...catalogRow.payload,products,version:Number(catalogRow.payload.version||0)+1,updated_at:now}:catalogRow.payload;
    return reply({ok:true,correctedCount:corrections.length,netQuantityChange:corrections.reduce((sum,row)=>sum+Number(row.quantity_added||0)-Number(purchaseById.get(row.id)?.quantity_added||0),0),stock_adjusted:stockHistory.length>0,deallocatedOrderNumbers:[],purchases,stock_history,state});
  }
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
      const currentCorrections=new Map(rows.filter(row=>String(row.key||'').startsWith(CORRECTION_PREFIX)&&row.payload?.purchase?.id)
        .map(row=>[String(row.payload.purchase.id),row.payload.purchase] as [string,Row]));
      const effective=(purchase:Row)=>currentCorrections.get(String(purchase.id))||purchase;
      const effectiveLegacy=previousLegacy.map(effective);
      const historical=rows.filter(row=>String(row.key||'').startsWith('inventory-purchase-v1:')&&row.payload?.phase==='complete')
        .flatMap(row=>(row.payload.purchases||[]).map(effective));
      // ANY duplicate line blocks the entire new bill, even if the other lines are new.
      // Otherwise one repeated variant (BLACK) plus one new variant (GREY)
      // would silently add the repeated stock a second time.
      if(parsed.some(line=>[...effectiveLegacy,...historical].some(receipt=>sameLine(receipt,line))))
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
  if(cleanPurchases.length){
    const existingPurchases=await readDataTable(env,'purchase_orders');
    const conflicts=cleanPurchases.filter(item=>{
      const previous=existingPurchases.find(row=>String(row.id)===String(item.id));
      return Boolean(previous&&!equal(previous,item));
    }).map(item=>String(item.id));
    if(conflicts.length)return reply({ok:true,added_purchases:0,added_history:0,conflicts,stock_changed:false,r2_backup_saved:false},409);
  }
  try{if(bucket)await writePurchaseHistoryBackup(bucket,cleanPurchases);}catch(error:any){return reply({error:error?.message||'Purchase History R2 backup failed. Nothing was confirmed as saved.'},Number(error?.status)||503);}
  const p=cleanPurchases.length?await mergeHistory(env,'purchase_orders',cleanPurchases):{added:0,conflicts:[]};
  const h=cleanHistory.length?await mergeHistory(env,'stock_history',cleanHistory):{added:0,conflicts:[]};
  return reply({ok:true,added_purchases:p.added,added_history:h.added,
    conflicts:[...p.conflicts,...h.conflicts],stock_changed:false,r2_backup_saved:cleanPurchases.length>0});
};
