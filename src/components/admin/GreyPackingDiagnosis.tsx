import React from 'react';
import type { Order,Product } from '../../types';
import { safeVariantForStock } from '../../lib/exactVariantStockResolution';

/** Read-only invoice diagnosis: purchasing is NOT a printable invoice by itself. */
export const GreyPackingDiagnosis=({orders,products}:{orders:Order[];products:Product[]})=>{
  const product=products.find(p=>(p.variants||[]).some(v=>String(v.sku).toUpperCase()==='R0008-GREY'));
  const grey=product?.variants?.find(v=>String(v.sku).toUpperCase()==='R0008-GREY');
  const remaining=Number(grey?.stock_quantity||0);
  const candidates=orders.filter(order=>(order.items||[]).some(item=>{
    const direct=String(item.sku||'').toUpperCase()==='R0008-GREY' ||
      String(item.variant_id||'')===String(grey?.id||'__none__') ||
      (String(item.product_id)===String(product?.id||'__none__')&&String(item.variant_name||'').trim().toUpperCase()==='GREY');
    const combo=(item.bundle_components||[]).some(c=>String(c.sku||'').toUpperCase()==='R0008-GREY'||
      String(c.variant_id||'')===String(grey?.id||'__none__'));
    return direct||combo;
  })).sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());
  const reason=(order:Order)=>{
    if(order.order_status==='Cancelled'||order.call_center_status==='Cancelled')return 'Cancelled — no invoice';
    if(order.is_duplicate_order||order.is_test_order)return 'Duplicate/Test — no invoice';
    if(order.call_center_status!=='Confirmed')return 'Awaiting Call Center Confirmed';
    if(order.sheet_confirm_hold)return 'Confirm Sheet is still processing';
    if(!order.stock_allocated){
      const missing=(order.items||[]).some(item=>String(item.product_id)===String(product?.id)&&
        !item.variant_id&&!safeVariantForStock(product,item.variant_id,item.sku,item.variant_name));
      if(missing)return 'Exact GREY variant cannot be verified from this order';
      return remaining<=0?'Waiting for Stock — GREY Available 0':'Waiting for FIFO allocation / another item shortage';
    }
    if(!order.waybill_number)return 'Allocated — waiting for server waybill';
    if(order.invoice_locked||order.invoice_number||order.invoice_generated_at)
      return 'Invoice already exists'+(order.invoice_pack_batch_id?' in '+order.invoice_pack_batch_id:' — check batch');
    return 'Waybill ready — awaiting invoice queue';
  };
  return <details className="rounded-2xl border border-slate-600 bg-neutral-900 p-4 text-sm text-neutral-200">
    <summary className="cursor-pointer font-black text-amber-200">
      Check R0008-GREY Print / Waiting Orders — Stock {remaining}, {candidates.length} matching orders
    </summary>
    <p className="mt-2 text-xs text-neutral-400">
      Exact GREY item diagnosis. A purchase receipt is not itself an invoice. Only valid Confirmed orders
      with allocated stock and a current waybill enter Packing. This is read-only; it never adds stock.
    </p>
    {!candidates.length?<p className="mt-3 text-amber-300">No matching GREY orders are present in the current server-loaded order list. No GREY invoice can be generated until a Confirmed GREY order exists.</p>:
    <div className="mt-3 max-h-80 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="text-neutral-400"><th className="p-2">Order</th><th className="p-2">Waybill</th><th className="p-2">Why not printed / Status</th></tr></thead>
        <tbody>{candidates.slice(0,150).map(order=><tr key={order.id} className="border-t border-neutral-700">
          <td className="p-2 font-mono">{order.order_number}</td>
          <td className="p-2">{order.waybill_number||'—'}</td>
          <td className="p-2">{reason(order)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </details>;
};
