import { stockConsumedItems } from './orderStockQuantities';

/** Actual morning 0, verified 29 Oct 2026 Stock In receipts; NEVER a second purchase. */
export const OCT29_STOCK_RECEIPTS = [
  {po:'PO-2026-0001',sku:'R0008-BLACK',qty:5},
  {po:'PO-2026-0002',sku:'R0008-GREY',qty:5},
  {po:'PO-2026-0003',sku:'R0041',qty:10},
  {po:'PO-2026-0004',sku:'R0052',qty:10},
] as const;
export const OCT29_RECOVERY_KEY='oct29-stock-recovery-v1:2026-10-29';
export type PurchaseProof={
  po_number:string;sku:string;quantity:number;product_id:string;variant_id?:string;
  created_at:string;log_id:string;log_created_at:string;log_reason:string;
  log_previous_stock:number;log_new_stock:number;log_quantity:number;
};
export type StockRecoveryLine={
  sku:string;product_id:string;variant_id?:string;purchase:number;already_allocated:number;
  current:number;expected:number;credit:number;blocked_reason?:string;
};
const day=(at:unknown)=>{const time=Date.parse(String(at||''));return Number.isFinite(time)?new Date(time+330*60000).toISOString().slice(0,10):''};
const normalized=(str:unknown)=>String(str||'').trim().toUpperCase();
const err=(message:string)=>{throw new Error(message)};

/** No writes. Fails closed if an item, audit receipt, or recent allocated order is ambiguous. */
export const planOct29StockRecovery=(proofs:PurchaseProof[],products:any[],orders:any[],returnLogs:any[]=[]):StockRecoveryLine[]=>{
  if(!Array.isArray(proofs)||proofs.length!==OCT29_STOCK_RECEIPTS.length)err('Exactly four original October 29 purchase receipts are required.');
  if(!Array.isArray(products)||!Array.isArray(orders))err('Shared catalog and confirmed orders must be loaded.');
  const skus=new Set<string>(),logs=new Set<string>(),result:StockRecoveryLine[]=[];
  for(const expected of OCT29_STOCK_RECEIPTS){
    const matching=proofs.filter(p=>normalized(p?.sku)===expected.sku);
    if(matching.length!==1)err(expected.sku+': original purchasing receipt is missing or duplicated.');
    const p=matching[0];
    if(p.po_number!==expected.po||p.quantity!==expected.qty||p.log_quantity!==expected.qty||
       p.log_previous_stock!==0||p.log_new_stock!==expected.qty||
       !p.log_id||!String(p.log_reason).includes(expected.po)||
       day(p.created_at)!=='2026-10-29'||day(p.log_created_at)!=='2026-10-29'||
       Math.abs(Date.parse(p.created_at)-Date.parse(p.log_created_at))>15000)
       err(expected.sku+': cannot verify the exact original 0 → '+expected.qty+' Purchase Inflow. No stock was changed.');
    if(skus.has(p.sku)||logs.has(p.log_id))err('Duplicated purchasing proof; no stock was changed.');
    skus.add(p.sku);logs.add(p.log_id);
    const matches=products.filter(product=>String(product.id)===String(p.product_id));
    if(matches.length!==1)err(expected.sku+': catalog product not found.');
    const product=matches[0];
    const variant=p.variant_id ? (Array.isArray(product.variants)?product.variants:[]).find((v:any)=>String(v.id)===String(p.variant_id)):null;
    if(p.variant_id&&!variant)err(expected.sku+': exact variant not found.');
    if((Array.isArray(product.variants)&&product.variants.length)&&!variant)
       err(expected.sku+': exact colour/variant must be selected.');
    const target=variant||product;
    if(normalized(target.sku)!==expected.sku)err(expected.sku+': Purchase Item Code no longer matches catalog.');
    const start=Date.parse(p.created_at);
    if(!Number.isFinite(start))err(expected.sku+': invalid receipt date.');
    let allocated=0;
    for(const order of orders){
      if(order.stock_allocated!==true||order.order_status==='Cancelled'||order.is_duplicate_order||order.is_test_order)continue;
      const allocatedAt=Date.parse(String(order.stock_allocated_at||''));
      if(!Number.isFinite(allocatedAt)){
        // The original older orders are not replayed. A new order without a
        // dated allocation cannot be safely classified.
        if(Date.parse(String(order.created_at||''))>=start)
          err(expected.sku+': a newly allocated order lacks an allocation timestamp. Inspect before recovery.');
        continue;
      }
      if(allocatedAt<start)continue;
      for(const item of stockConsumedItems(order)){
        const q=Number(item.quantity||0);
        if(!Number.isSafeInteger(q)||q<0)err('Invalid saved order quantity.');
        const components=item.product_type==='bundle'&&Array.isArray(item.bundle_components)&&item.bundle_components.length
          ? item.bundle_components.map((c:any)=>({...c,quantity:q*Number(c.quantity_per_bundle||1)}))
          : [{...item,quantity:q}];
        for(const c of components){
          const sku=normalized(c.sku||c.main_sku);
          if(String(c.product_id)===String(p.product_id)&&String(c.variant_id||'')===String(p.variant_id||'')||sku===expected.sku){
            if(!Number.isSafeInteger(Number(c.quantity))||Number(c.quantity)<0)err('Invalid saved component allocation.');
            allocated+=Number(c.quantity);
          }
        }
      }
    }
    if(allocated>expected.qty)err(expected.sku+': orders allocated after purchase exceed this receipt. Cannot guess physical stock.');
    const recentReturn=returnLogs.some(log=>log&&String(log.product_id)===String(p.product_id)&&
      (!p.variant_id||String(log.variant_id||'')===String(p.variant_id))&&
      Date.parse(String(log.created_at||''))>=start&&
      ['Increase','Decrease','Adjustment'].includes(String(log.change_type||'')));
    if(recentReturn)err(expected.sku+': a post-purchase return/adjustment exists. Reconcile that before repairing stock.');
    const current=Number(target.stock_quantity);
    if(!Number.isSafeInteger(current)||current<0)err(expected.sku+': current shared stock is invalid.');
    if(Number(target.return_stock_debt||0)>0)err(expected.sku+': unresolved return-stock debt requires review.');
    const desired=expected.qty-allocated;
    if(current>desired)err(expected.sku+': server already shows '+current+' but verified receipt-minus-new-allocations gives '+desired+'. No stock was changed.');
    result.push({sku:expected.sku,product_id:String(p.product_id),variant_id:p.variant_id,
      purchase:expected.qty,already_allocated:allocated,current,expected:desired,credit:desired-current});
  }
  return result;
};

/** Apply every variant under its parent atomically, without changing untouched SKUs. */
export const applyOct29StockRecoveryLines=(products:any[],lines:StockRecoveryLine[])=>{
  const byProduct=new Map<string,StockRecoveryLine[]>();
  for(const item of lines)byProduct.set(item.product_id,[...(byProduct.get(item.product_id)||[]),item]);
  return products.map(product=>{
    const updates=byProduct.get(String(product.id));
    if(!updates?.length)return product;
    if(updates.some(line=>Boolean(line.variant_id))){
      if(updates.some(line=>!line.variant_id))err('Cannot mix parent and variant recovery for one product.');
      const variants=(product.variants||[]).map((v:any)=>{
        const line=updates.find(entry=>entry.variant_id===String(v.id));
        return line?{...v,stock_quantity:line.expected,status:line.expected>0?'Active':'Out of Stock'}:v;
      });
      const total=variants.reduce((sum:number,v:any)=>sum+Number(v.stock_quantity||0),0);
      return {...product,variants,stock_quantity:total,status:total>0?'Active':'Out of Stock'};
    }
    if(updates.length!==1)err('Duplicate base product recovery.');
    return {...product,stock_quantity:updates[0].expected,status:updates[0].expected>0?'Active':'Out of Stock'};
  });
};
