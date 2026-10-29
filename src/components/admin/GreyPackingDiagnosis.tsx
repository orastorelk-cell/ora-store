import React,{useState} from 'react';
import { staffJsonRequest } from '../../lib/staffRequest';
import type { Order,Product,StockHistory } from '../../types';
import { safeVariantForStock } from '../../lib/exactVariantStockResolution';

/** Read-only invoice diagnosis: purchasing is NOT a printable invoice by itself. */
export const GreyPackingDiagnosis=({orders,products,stockHistory=[]}:{orders:Order[];products:Product[];stockHistory?:StockHistory[]})=>{
  const [repairing,setRepairing]=useState(false);
  const [message,setMessage]=useState('');
  const recoverMissingGrey=async()=>{
    if(repairing)return;
    setRepairing(true);setMessage('');
    try{
      const request=async(data:unknown)=>{
        const token=localStorage.getItem('ora_staff_session_token')||'';
        if(!token)throw new Error('Super Admin login is required.');
        return staffJsonRequest('/api/admin/recover-oct29-stock',{
          method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
          body:JSON.stringify(data)
        });
      };
      const checked=await request({action:'preview-grey-gap'});
      if(!checked?.ok||!Array.isArray(checked.lines)||checked.lines.length!==1)
        throw new Error('Could not verify the original GREY +5 stock recovery.');
      if(checked.already_saved){
        setMessage('GREY stock gap repair was already recorded. It cannot be credited again. Check order allocations/waybills.');
        return;
      }
      const line=checked.lines[0];
      if(!checked.missing){
        setMessage('No missing GREY stock in the verified receipt. '+line.already_allocated+
          ' units already allocated to orders: '+(checked.allocated_orders||[]).join(', ')+
          '. Check their Waybill / Invoice status below.');
        return;
      }
      const prompt='CORRECT ORIGINAL R0008-GREY STOCK (NOT A NEW PURCHASE)\n\n'+
        'Original purchased: 5 × Rs. 280\n'+
        'Already allocated after recovery: '+line.already_allocated+'\n'+
        'Current shared stock: '+line.current+'\n'+
        'Verified remaining: '+line.expected+'\n'+
        'Missing units to restore ONCE: +'+checked.missing+
        '\n\nNo new purchase or duplicate invoice will be made. Continue?';
      if(!window.confirm(prompt))return;
      const committed=await request({action:'commit-grey-gap',version:checked.version,lines:checked.lines});
      if(!committed?.ok||!Array.isArray(committed.lines))
        throw new Error('The server did not confirm the GREY stock repair.');
      window.alert('Original GREY stock gap checked and saved. Reloading for FIFO invoice allocation.');
      window.location.reload();
    }catch(error:any){setMessage(error?.message||'GREY stock repair could not be verified. No changes were made.');}
    finally{setRepairing(false);}
  };
  const product=products.find(p=>(p.variants||[]).some(v=>String(v.sku).toUpperCase()==='R0008-GREY'));
  const grey=product?.variants?.find(v=>String(v.sku).toUpperCase()==='R0008-GREY');
  const remaining=Number(grey?.stock_quantity||0);
  // Duplicate Stock Audit receipt detection (no speculative changes).
  const greyAllocations=stockHistory.filter(log=>log.change_type==='Order Deduction' &&
    String(log.product_id)===String(product?.id) &&
    (String(log.variant_id||'')===String(grey?.id||'__none__') ||
      String(log.product_name||'').toUpperCase().includes('GREY')) &&
    /^FIFO stock allocated to FB-/i.test(String(log.reason||'')));
  const auditByOrder=new Map<string,StockHistory[]>();
  for(const log of greyAllocations){
    const key=String(log.reason||'').trim();
    auditByOrder.set(key,[...(auditByOrder.get(key)||[]),log]);
  }
  const duplicateDeductions=[...auditByOrder.entries()].filter(([,logs])=>logs.length>1);
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
    {duplicateDeductions.length>0&&<p role="alert" className="mt-3 rounded-lg border border-red-500/40 bg-red-900/20 p-3 text-xs font-bold text-red-200">
      Duplicate FIFO stock deductions detected: {duplicateDeductions.map(([order,logs])=>
        order.replace('FIFO stock allocated to ','')+' ('+logs.length+' deductions)').join(', ')}.
      Do not add new Purchasing to compensate. Use the verified original GREY stock-gap check below;
      reconcile each order's waybill and invoice status before printing.
    </p>}
    <div className="mt-3">
      <button type="button" disabled={repairing} onClick={()=>void recoverMissingGrey()}
        className="rounded-xl border border-amber-500 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-200 disabled:opacity-50">
        {repairing?'Verifying original GREY receipt…':'Check & Restore Missing R0008-GREY Stock (No New Purchase)'}
      </button>
      {message&&<p role="status" className="mt-2 text-xs text-amber-200">{message}</p>}
    </div>
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
