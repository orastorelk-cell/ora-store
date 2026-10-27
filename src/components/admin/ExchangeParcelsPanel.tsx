import React, { useMemo, useState } from 'react';
import { CheckCircle2, Download, PackageCheck, Plus, RefreshCw, Search, WalletCards } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { generateExchangeInvoicePDF } from '../../lib/pdfGenerator';
import type { ExchangeInvoiceRecord, Order } from '../../types';

const money=(value:number)=>`Rs. ${Math.max(0,Math.round(Number(value||0))).toLocaleString('en-US')}`;

export const ExchangeParcelsPanel:React.FC=()=>{
  const {orders,waybillRecords,exchangeInvoices,settings,createExchangeInvoice,completeExchangeRefund,refreshExchangeInvoices}=useStore();
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<Order|null>(null);
  const [waybill,setWaybill]=useState('');
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const delivered=useMemo(()=>orders.filter(order=>order.order_status==='Delivered'&&Boolean(order.waybill_number)&&!order.is_replacement_order)
    .filter(order=>`${order.order_number} ${order.waybill_number} ${order.customer_name} ${order.phone}`.toLowerCase().includes(query.toLowerCase())),[orders,query]);
  const availableFor=(order:Order)=>waybillRecords.filter(row=>row.status==='Available'&&row.courier_name===(order.courier_name||settings.courier_provider||'Fardar'))
    .sort((a,b)=>Date.parse(a.imported_at||'')-Date.parse(b.imported_at||''));
  const orderTotal=(order:Order)=>Math.max(0,Math.round(Number(order.total_amount||0)));
  const deliveryFee=(order:Order)=>Math.min(orderTotal(order),Math.max(0,Math.round(Number(order.delivery_fee||0))));
  const refundFor=(order:Order)=>Math.max(0,orderTotal(order)-deliveryFee(order));
  const pending=exchangeInvoices.filter(row=>row.status==='Pending Refund');
  const completed=exchangeInvoices.filter(row=>row.status==='Refund Complete');

  const begin=(order:Order)=>{setSelected(order);setWaybill(availableFor(order)[0]?.waybill_number||'');setNotice('');};
  const create=async()=>{
    if(!selected||!waybill)return;
    setBusy('create');
    try{
      const result=await createExchangeInvoice(selected.id,waybill);
      await generateExchangeInvoicePDF(result.exchange,settings);
      setNotice(`${result.exchange.id} created. Refund ${money(result.exchange.refund_amount)} is Pending.`);
      setSelected(null);
    }catch(error:any){setNotice(error?.message||'Exchange invoice could not be created.');}
    finally{setBusy('');}
  };
  const finishRefund=async(row:ExchangeInvoiceRecord)=>{
    if(!window.confirm(`Confirm refund paid to customer?\n\n${row.original_order_number} · ${row.original_waybill}\nRefund: ${money(row.refund_amount)}\n\nThis will record the refund against received money and change the original order status to Exchange Refund.`))return;
    setBusy(row.id);setNotice('');
    try{await completeExchangeRefund(row.id);setNotice(`${row.id}: refund completed; ${money(row.refund_amount)} recorded against received money.`);}
    catch(error:any){setNotice(error?.message||'Refund could not be completed.');}
    finally{setBusy('');}
  };
  const downloadInvoice=(row:ExchangeInvoiceRecord)=>void generateExchangeInvoicePDF(row,settings).catch((error:any)=>setNotice(error?.message||'Exchange invoice PDF could not be downloaded.'));
  return <div className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><PackageCheck className="h-6 w-6 text-teal-400"/><h2 className="text-xl font-black text-white">Exchange Parcels</h2></div><p className="mt-1 text-xs text-neutral-400">Create an A5 exchange invoice, track the original order refund, and keep stock unchanged until returned goods are received.</p></div>
      <button onClick={()=>void refreshExchangeInvoices().catch((error:any)=>setNotice(error?.message||'Refresh failed.'))} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-200"><RefreshCw className="h-3.5 w-3.5"/>Refresh</button>
    </div>
    {notice&&<div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-3 text-xs font-bold text-teal-100">{notice}</div>}

    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="text-[10px] font-black uppercase text-amber-300">Pending Refunds</p><p className="mt-1 text-2xl font-black text-white">{pending.length}</p><p className="mt-1 text-[10px] text-neutral-400">{money(pending.reduce((sum,row)=>sum+row.refund_amount,0))} to pay; delivery charges excluded.</p></div>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"><p className="text-[10px] font-black uppercase text-neutral-500">Refunds Completed</p><p className="mt-1 text-2xl font-black text-white">{completed.length}</p><p className="mt-1 text-[10px] text-neutral-400">{money(completed.reduce((sum,row)=>sum+row.refund_amount,0))} deducted from received-money totals.</p></div>
    </div>

    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-white">Delivered Orders</h3><p className="mt-1 text-[10px] text-neutral-400">Select an original delivered waybill. Exchange creation does not deduct stock.</p></div><label className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Order / waybill / customer" className="w-64 rounded-lg border border-neutral-700 bg-neutral-950 py-2 pl-8 pr-3 text-xs text-white"/></label></div>
      <div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="sticky top-0 bg-neutral-950 text-[10px] uppercase text-neutral-500"><tr><th className="p-2">Order / Waybill</th><th className="p-2">Customer</th><th className="p-2">Total</th><th className="p-2">Delivery kept</th><th className="p-2">Refund</th><th className="p-2"></th></tr></thead><tbody>{delivered.map(order=><tr key={order.id} className="border-t border-neutral-800"><td className="p-2 font-mono font-bold text-amber-300">{order.order_number}<div className="mt-1 text-[10px] text-blue-300">{order.waybill_number}</div></td><td className="p-2 text-neutral-200">{order.customer_name}<div className="text-[10px] text-neutral-500">{order.phone}</div></td><td className="p-2">{money(orderTotal(order))}</td><td className="p-2 text-neutral-400">{money(deliveryFee(order))}</td><td className="p-2 font-black text-emerald-300">{money(refundFor(order))}</td><td className="p-2"><button disabled={!availableFor(order).length} onClick={()=>begin(order)} className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3 w-3"/>Create Exchange Invoice</button>{!availableFor(order).length&&<div className="mt-1 text-[9px] text-amber-300">No available waybill</div>}</td></tr>)}{!delivered.length&&<tr><td colSpan={6} className="p-6 text-center text-neutral-500">No delivered orders match this search.</td></tr>}</tbody></table></div>
    </div>

    <div className="rounded-2xl border border-amber-500/20 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center gap-2"><WalletCards className="h-4 w-4 text-amber-300"/><h3 className="font-black text-white">Pending Refund List</h3></div>
      <p className="mb-3 text-[10px] text-neutral-400">Refund is the original order total less the delivery fee. It stays pending until you have paid the customer. Completing it records the refund against received money and updates the original order to Exchange Refund.</p>
      <div className="overflow-auto"><table className="w-full min-w-[830px] text-left text-xs"><thead className="text-[10px] uppercase text-neutral-500"><tr><th className="p-2">Exchange / Original</th><th className="p-2">Customer</th><th className="p-2">Order total</th><th className="p-2">Delivery kept</th><th className="p-2">Refund</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr></thead><tbody>{[...pending,...completed].sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(row=><tr key={row.id} className="border-t border-neutral-800"><td className="p-2 font-mono"><b className="text-teal-300">{row.id}</b><div className="text-[10px] text-neutral-400">{row.original_order_number} · {row.original_waybill}</div><div className="text-[10px] text-blue-300">New WB {row.new_waybill}</div></td><td className="p-2">{row.customer_name}<div className="text-[10px] text-neutral-500">{row.phone}</div></td><td className="p-2">{money(row.order_total)}</td><td className="p-2">{money(row.delivery_fee)}</td><td className="p-2 font-black text-emerald-300">{money(row.refund_amount)}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${row.status==='Pending Refund'?'bg-amber-500/10 text-amber-300':'bg-emerald-500/10 text-emerald-300'}`}>{row.status}</span></td><td className="p-2"><div className="flex flex-wrap gap-1.5"><button onClick={()=>downloadInvoice(row)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-700 px-2 py-1.5 text-[9px] font-bold text-neutral-200"><Download className="h-3 w-3"/>A5 PDF</button>{row.status==='Pending Refund'?<button disabled={busy===row.id} onClick={()=>void finishRefund(row)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2 py-1.5 text-[9px] font-black text-neutral-950 disabled:opacity-40"><CheckCircle2 className="h-3 w-3"/>{busy===row.id?'Saving...':'Refund Complete'}</button>:<span className="text-[10px] text-neutral-500">{row.refund_completed_at?new Date(row.refund_completed_at).toLocaleDateString():''}</span>}</div></td></tr>)}{!exchangeInvoices.length&&<tr><td colSpan={7} className="p-6 text-center text-neutral-500">No exchange invoices or refunds yet.</td></tr>}</tbody></table></div>
    </div>

    {selected&&<div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/80 p-4"><div className="w-full max-w-lg rounded-2xl border border-teal-500/30 bg-neutral-900 p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h3 className="text-lg font-black text-white">Create Exchange Invoice</h3><p className="mt-1 text-xs text-neutral-400">{selected.order_number} · Original waybill {selected.waybill_number}</p></div><button onClick={()=>setSelected(null)} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-neutral-800">×</button></div><div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs"><p className="font-bold text-white">{selected.customer_name} · {selected.phone}</p><p className="mt-2 text-neutral-400">New exchange waybill</p><select value={waybill} onChange={event=>setWaybill(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white">{availableFor(selected).map(row=><option key={row.waybill_number} value={row.waybill_number}>{row.waybill_number} · {row.courier_name}</option>)}</select><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-neutral-900 p-2"><div className="text-[9px] text-neutral-500">Order Total</div><b>{money(orderTotal(selected))}</b></div><div className="rounded-lg bg-neutral-900 p-2"><div className="text-[9px] text-neutral-500">Delivery Kept</div><b>{money(deliveryFee(selected))}</b></div><div className="rounded-lg bg-emerald-500/10 p-2"><div className="text-[9px] text-emerald-300">Pending Refund</div><b className="text-emerald-200">{money(refundFor(selected))}</b></div></div></div><p className="mt-3 text-[10px] leading-5 text-neutral-400">The A5 invoice will show the original item codes and names, COD Rs. 0, and the new waybill. Stock remains unchanged until the return is received and checked.</p><div className="mt-4 flex justify-end gap-2"><button onClick={()=>setSelected(null)} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300">Cancel</button><button disabled={busy==='create'||!waybill} onClick={()=>void create()} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40"><Download className="h-4 w-4"/>{busy==='create'?'Creating...':'Create & Download A5 PDF'}</button></div></div></div>}
  </div>;
};
