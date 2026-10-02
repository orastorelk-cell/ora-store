import { invoiceComplete, invoiceReady } from './invoiceQueue';
type Item={sku:string;quantity:number;variant:string};
type Expected={order_number:string;decision:'Confirmed'|'Cancelled';items:Item[]};
const normal=(value:unknown)=>String(value||'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
export const validConfirmAuditOrders=(orders:unknown):orders is Expected[]=>{
  if(!Array.isArray(orders)||!orders.length||orders.length>20)return false;
  const ids=new Set();
  return orders.every(order=>{
    if(!order||typeof order.order_number!=='string'||!order.order_number||order.order_number.length>100||ids.has(order.order_number))return false;
    ids.add(order.order_number);
    return ['Confirmed','Cancelled'].includes(order.decision)&&Array.isArray(order.items)&&(order.decision==='Cancelled'||order.items.length>0)&&order.items.length<=100&&order.items.every((item:any)=>
      item&&typeof item.sku==='string'&&item.sku.length>0&&item.sku.length<=100&&Number.isFinite(item.quantity)&&item.quantity>=1&&item.quantity<=99&&typeof item.variant==='string'&&item.variant.length<=200);
  });
};
const shape=(items:Item[])=>{
  const amounts=new Map<string,number>();
  for(const item of items){const key=normal(item.sku);amounts.set(key,(amounts.get(key)||0)+item.quantity);}
  return JSON.stringify([...amounts].sort(([a],[b])=>a.localeCompare(b)));
};
export const auditConfirmCsvOrders=(orders:Record<string,any>[],expected:Expected[])=>{
  const results=expected.map(wanted=>{
    const matched=orders.filter(order=>String(order.order_number)===wanted.order_number),order=matched[0];
    const found=matched.length===1;
    const actualItems=(Array.isArray(order?.items)?order.items:[]).map((item:any)=>({sku:String(item.sku||item.main_sku||''),quantity:Number(item.quantity),variant:String(item.variant_name||'')}));
    const items_match=found&&shape(actualItems)===shape(wanted.items)&&wanted.items.every(item=>!item.variant||
      actualItems.filter((actual:any)=>normal(actual.sku)===normal(item.sku)&&normal(actual.variant)===normal(item.variant)).reduce((total:number,actual:any)=>total+actual.quantity,0)===
      wanted.items.filter(expected=>normal(expected.sku)===normal(item.sku)&&normal(expected.variant)===normal(item.variant)).reduce((total,expected)=>total+expected.quantity,0));
    const decision_saved=found&&order.call_center_status===wanted.decision&&(wanted.decision==='Cancelled'
      ? order.order_status==='Cancelled' : ['Processing','Shipped','Delivered'].includes(order.order_status));
    return {order_number:wanted.order_number,found,expected_decision:wanted.decision,call_center_status:order?.call_center_status||null,
      order_status:order?.order_status||null,decision_saved,items_match:wanted.decision==='Cancelled'?null:items_match,
      verified:decision_saved&&(wanted.decision==='Cancelled'||items_match),confirmed_at:order?.call_center_updated_at||null,
      packing_batch:order?.confirm_upload_batch_id||null,
      invoice_ready:found&&invoiceReady(order),invoice_saved:found&&invoiceComplete(order),
      invoice_number:order?.invoice_number||null,invoice_batch:order?.invoice_pack_batch_id||null,
      invoice_downloaded:Boolean(order?.invoice_pack_downloaded_at),fardar_exported:Boolean(order?.fardar_csv_exported_at)};
  });
  const verified=results.filter(order=>order.verified).length;
  const ready=results.filter(order=>order.invoice_ready),saved=ready.filter(order=>order.invoice_saved);
  return {ok:true,complete:true,checked_at:new Date().toISOString(),storage:'cloudflare-r2',expected_orders:expected.length,
    verified_orders:verified,unverified_orders:expected.length-verified,
    invoice_ready_orders:ready.length,saved_invoice_orders:saved.length,missing_invoice_orders:ready.length-saved.length,orders:results};
};
