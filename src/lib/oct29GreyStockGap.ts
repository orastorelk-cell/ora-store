import {stockConsumedItems} from './orderStockQuantities';
import {safeVariantForStock} from './exactVariantStockResolution';
import type {StockRecoveryLine} from './oct29StockRecovery';

type Row=Record<string,any>;
const fail=(reason:string):never=>{throw new Error(reason)};
const same=(a:unknown,b:unknown)=>String(a||'')===String(b||'');
const sku=(value:unknown)=>String(value||'').trim().toUpperCase();
const exactGreyQty=(order:Row,product:Row,variant:Row)=>{
  let total=0;
  for(const item of stockConsumedItems(order)){
    const components=item.product_type==='bundle'&&Array.isArray(item.bundle_components)&&item.bundle_components.length
      ?item.bundle_components.map((c:Row)=>({...c,quantity:Number(item.quantity)*Number(c.quantity_per_bundle||1)}))
      :[item];
    for(const c of components){
      if(!same(c.product_id,product.id))continue;
      const target=safeVariantForStock(product,c.variant_id,c.sku,c.variant_name);
      if(target?.id!==variant.id)continue;
      const q=Number(c.quantity||0);
      if(!Number.isSafeInteger(q)||q<0)fail('Invalid GREY order allocation quantity.');
      total+=q;
    }
  }
  return total;
};
export const OCT29_GREY_GAP_KEY='oct29-grey-stock-gap-v1:2026-10-29';
/**
 * One-time correction of a GREY stock value that vanished after the ORIGINAL
 * verified Oct29 +5 restoration. Does not create another purchase receipt.
 *
 * Stock owned by later allocated orders must NOT be credited again. If five
 * were already assigned and are awaiting waybills/invoices, no stock repair
 * is due; repair the order printing queue instead.
 */
export const planVerifiedGreyStockGap=(
  recovery:Row|undefined,products:Row[],orders:Row[],audit:Row[]=[],
  newerPurchases:Row[]=[]
):{line:StockRecoveryLine;missing:number;allocatedOrders:string[]}=>{
  if(recovery?.phase!=='complete')fail('Original Oct 29 stock recovery was not confirmed.');
  const lines=(recovery.lines||[]).filter((p:Row)=>sku(p.sku)==='R0008-GREY');
  if(lines.length!==1)fail('Original GREY recovery line not unique.');
  const original=lines[0];
  if(original.purchase!==5||original.expected!==5||original.current!==0||
     original.credit!==5||original.already_allocated!==0)
    fail('GREY original recovered receipt does not match verified 0 → 5. No stock was changed.');
  const seen=(recovery.source_receipts||[]).filter((p:Row)=>sku(p.sku)==='R0008-GREY');
  if(seen.length!==1||seen[0].po_number!=='PO-2026-0002')
    fail('Original GREY Purchase Inflow proof is missing.');
  const when=Date.parse(String(recovery.at||''));
  if(!Number.isFinite(when))fail('Recovery timestamp was not saved.');
  const product=products.find((p:Row)=>same(p.id,original.product_id));
  if(!product)fail('Recovered GREY parent product no longer exists.');
  const grey=(product.variants||[]).find((v:Row)=>same(v.id,original.variant_id));
  if(!grey||sku(grey.sku)!=='R0008-GREY')fail('GREY variant identity no longer matches original receipt.');
  const current=Number(grey.stock_quantity);
  if(!Number.isSafeInteger(current)||current<0)fail('GREY saved stock count is invalid.');
  if(Number(grey.return_stock_debt||0)!==0)
    fail('GREY has open return stock debt. Manual reconciliation is required.');
  if(audit.some(event=>same(event.product_id,product.id) &&
    (!event.variant_id||same(event.variant_id,grey.id))&&Date.parse(String(event.created_at||''))>=when))
    fail('GREY returns/adjustments happened after original recovery. Refuse uncertain stock adjustment.');
  if(newerPurchases.some(p=>same(p.product_id,product.id)&&same(p.variant_id,grey.id)&&Date.parse(String(p.created_at||''))>=when))
    fail('GREY has new purchases since recovery. Verify them before adjusting physical stock.');
  let allocated=0;
  const allocatedOrders:string[]=[];
  for(const order of orders){
    if(order.stock_allocated!==true||order.order_status==='Cancelled'||order.is_duplicate_order||order.is_test_order)continue;
    const time=Date.parse(String(order.stock_allocated_at||''));
    if(!Number.isFinite(time)){
      if(Date.parse(String(order.created_at||''))>=when)
        fail('A new allocated order has no timestamp. Stock adjustment requires review.');
      continue;
    }
    if(time<when)continue;
    const quantity=exactGreyQty(order,product,grey);
    if(quantity){allocated+=quantity;allocatedOrders.push(String(order.order_number||order.id));}
  }
  if(allocated>5)fail('More than five GREY items allocated after original recovery; cannot safely rebuild stock.');
  const remaining=5-allocated;
  if(current>remaining)fail('GREY available stock is already greater than the verified remainder. Do not add more.');
  const missing=remaining-current;
  const line:StockRecoveryLine={
    sku:'R0008-GREY',product_id:String(product.id),variant_id:String(grey.id),
    purchase:5,already_allocated:allocated,current,expected:remaining,credit:missing
  };
  return {line,missing,allocatedOrders};
};
