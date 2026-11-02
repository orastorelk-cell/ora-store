import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compressImageFile } from '../../lib/imageUpload';
import { CheckCircle2, Download, FileSpreadsheet, PackageCheck, Plus, RefreshCw, Search, WalletCards } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { generateExchangeInvoicePDF, generateOrderInvoicePDF } from '../../lib/pdfGenerator';
import type { ExchangeInvoiceRecord, Order } from '../../types';

const money=(value:number)=>`Rs. ${Math.max(0,Math.round(Number(value||0))).toLocaleString('en-US')}`;

export const ExchangeParcelsPanel:React.FC=()=>{
  const {orders,waybillRecords,exchangeInvoices,settings,createExchangeInvoice,createItemExchangeReplacement,linkExchangeReplacementOrder,completeExchangeRefund,refreshExchangeInvoices}=useStore();
  const [query,setQuery]=useState('');
  const [refundQuery,setRefundQuery]=useState('');
  const [selected,setSelected]=useState<Order|null>(null);
  const [waybill,setWaybill]=useState('');
  const [exchangeType,setExchangeType]=useState<'Cash Refund'|'Item Exchange'>('Cash Refund');
  const [exchangeItems,setExchangeItems]=useState<Record<number,number>>({});
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [refundFeedback,setRefundFeedback]=useState<Record<string,{kind:'info'|'success'|'error';message:string}>>({});
  const [refundUploadTarget,setRefundUploadTarget]=useState<ExchangeInvoiceRecord|null>(null);
  const [pendingReplacementInvoices,setPendingReplacementInvoices]=useState<string[]>([]);
  const downloadedReplacementInvoices=useRef(new Set<string>());
  const refundSlipInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    for(const id of pendingReplacementInvoices){
      const replacement=orders.find(order=>order.id===id);
      if(!replacement?.invoice_locked||!replacement.stock_allocated||!replacement.waybill_number||downloadedReplacementInvoices.current.has(id))continue;
      downloadedReplacementInvoices.current.add(id);
      void generateOrderInvoicePDF(replacement,settings).catch((error:any)=>setNotice(error?.message||'The MAN invoice is ready, but its PDF could not be downloaded. Use the order invoice download to retry.'));
      setPendingReplacementInvoices(previous=>previous.filter(value=>value!==id));
    }
  },[orders,pendingReplacementInvoices,settings]);
  const setRefundMessage=(exchangeId:string,message:string,kind:'info'|'success'|'error'='info')=>
    setRefundFeedback(previous=>({...previous,[exchangeId]:{kind,message}}));
  const delivered=useMemo(()=>orders.filter(order=>order.order_status==='Delivered'&&Boolean(order.waybill_number)&&!order.is_replacement_order)
    .filter(order=>`${order.order_number} ${order.waybill_number} ${order.customer_name} ${order.phone}`.toLowerCase().includes(query.toLowerCase())),[orders,query]);
  const availableFor=(order:Order)=>waybillRecords.filter(row=>row.status==='Available'&&row.courier_name===(order.courier_name||settings.courier_provider||'Fardar'))
    .sort((a,b)=>Date.parse(a.imported_at||'')-Date.parse(b.imported_at||''));
  const orderTotal=(order:Order)=>Math.max(0,Math.round(Number(order.total_amount||0)));
  const deliveryFee=(order:Order)=>Math.min(orderTotal(order),Math.max(0,Math.round(Number(order.delivery_fee||0))));
  const refundFor=(order:Order)=>Math.max(0,orderTotal(order)-deliveryFee(order));
  const replacementFor=(row:ExchangeInvoiceRecord)=>orders.find(order=>order.id===row.replacement_order_id)||orders.find(order=>order.is_replacement_order&&order.replacement_of_order_id===row.original_order_id&&order.replacement_reason==='Customer item exchange'&&String(order.notes||'').includes('Exchange: '+row.id));
  const pending=exchangeInvoices.filter(row=>row.status==='Pending Refund');
  const completed=exchangeInvoices.filter(row=>row.status==='Refund Complete');
  const refundRows=useMemo(()=>exchangeInvoices
    .filter(row=>row.status==='Pending Refund'||row.status==='Refund Complete'||row.status==='Item Exchange')
    .filter(row=>`${row.id} ${row.original_order_number} ${row.original_waybill} ${row.new_waybill} ${row.customer_name} ${row.phone} ${row.status}`.toLowerCase().includes(refundQuery.trim().toLowerCase()))
    .sort((a,b)=>b.created_at.localeCompare(a.created_at)),[exchangeInvoices,refundQuery]);

  const begin=(order:Order)=>{setSelected(order);setWaybill(availableFor(order)[0]?.waybill_number||'');setExchangeType('Cash Refund');setExchangeItems({});setNotice('');};
  const create=async()=>{
    if(!selected||!waybill)return;
    const picked=Object.entries(exchangeItems).map(([index,quantity])=>({item_index:Number(index),quantity:Number(quantity)}));
    const replacementWaybill=availableFor(selected).find(row=>row.waybill_number!==waybill)?.waybill_number||'';
    if(exchangeType==='Item Exchange'&&!picked.length){setNotice('Select at least one item to exchange.');return;}
    if(exchangeType==='Item Exchange'&&!replacementWaybill){setNotice('Two available waybills are required for an item exchange.');return;}
    setBusy('create');
    try{
      const result=await createExchangeInvoice(selected.id,waybill,exchangeType,picked);
      await generateExchangeInvoicePDF(result.exchange,settings);
      if(exchangeType==='Item Exchange'){
        const replacement=await createItemExchangeReplacement({originalOrderId:selected.id,items:picked.map(row=>({itemIndex:row.item_index,quantity:row.quantity})),waybillNumber:replacementWaybill,exchangeId:result.exchange.id});
        await linkExchangeReplacementOrder(result.exchange.id,replacement);
        setPendingReplacementInvoices(previous=>previous.includes(replacement.id)?previous:[...previous,replacement.id]);
        setNotice(result.exchange.id+' return cover PDF downloaded. MAN '+replacement.order_number+' saved for '+replacementWaybill+' with COD Rs. 0; its A6 invoice PDF will download as soon as stock is allocated and the invoice is ready.');
      }else{setNotice(result.exchange.id+' created. Refund '+money(result.exchange.refund_amount)+' is Pending.');}
      setSelected(null);
    }catch(error:any){setNotice(error?.message||'Exchange could not be completed. Refresh the exchange list before retrying.');}
    finally{setBusy('');}
  };
  const finishRefund=async(row:ExchangeInvoiceRecord,file:File)=>{
    const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
    const isImage=/^image\/(jpeg|png|webp)$/i.test(file.type);
    if(!isPdf&&!isImage){setRefundMessage(row.id,'JPG, PNG, WEBP image එකක් හෝ PDF slip එකක් තෝරන්න.','error');return;}
    if(isPdf&&file.size>5*1024*1024){setRefundMessage(row.id,'PDF slip එක 5 MB හෝ ඊට අඩු විය යුතුයි.','error');return;}
    if(!window.confirm(`Confirm refund paid to customer?\n\n${row.original_order_number} · ${row.original_waybill}\nRefund: ${money(row.refund_amount)}\n\nThe slip will be uploaded and this refund will be marked complete.`))return;
    setBusy(row.id);setRefundMessage(row.id,'Slip එක සූදානම් කරනවා...');
    try{
      let slipDataUrl='';let slipContentType='application/pdf';let slipFileName=file.name;
      if(isImage){slipDataUrl=await compressImageFile(file,1280,450_000);slipContentType='image/jpeg';slipFileName=file.name.replace(/\.[^.]+$/,'')+'.jpg';}
      else slipDataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('PDF slip could not be read.'));reader.readAsDataURL(file);});
      setRefundMessage(row.id,'Slip එක upload කර refund එක save කරනවා...');
      await completeExchangeRefund(row.id,{slipDataUrl,slipFileName,slipContentType});
      setRefundMessage(row.id,`${row.id}: refund එක save වුණා; ${money(row.refund_amount)} සහ slip එක වාර්තා කළා.`,'success');
      setNotice(`${row.id}: refund completed; ${money(row.refund_amount)} recorded and slip saved.`);
    }catch(error:any){
      const message=error?.message||'Refund could not be completed. The refund remains pending.';
      setRefundMessage(row.id,`Save වුණේ නැහැ: ${message}`,'error');
      setNotice(message);
    }
    finally{setBusy('');}
  };
  const chooseRefundSlip=(row:ExchangeInvoiceRecord)=>{setRefundUploadTarget(row);if(refundSlipInput.current){refundSlipInput.current.value='';refundSlipInput.current.click();}};
  const refundSlipUrl=(row:ExchangeInvoiceRecord)=>`/api/exchange-invoices/${encodeURIComponent(row.id)}/refund-slip`;
  const openRefundSlip=async(row:ExchangeInvoiceRecord)=>{
    const preview=window.open('about:blank','_blank');
    try{
      const response=await fetch(refundSlipUrl(row),{headers:{Authorization:`Bearer ${localStorage.getItem('ora_staff_session_token')||''}`},cache:'no-store'});
      if(!response.ok)throw new Error('Payment slip could not be opened.');
      const url=URL.createObjectURL(await response.blob());
      if(preview)preview.location.href=url;
      else{const link=document.createElement('a');link.href=url;link.download=row.refund_slip_file_name||'refund-slip';link.click();}
      window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
    }catch(error:any){preview?.close();setNotice(error?.message||'Payment slip could not be opened.');}
  };
  const downloadInvoice=(row:ExchangeInvoiceRecord)=>void generateExchangeInvoicePDF(row,settings).catch((error:any)=>setNotice(error?.message||'Exchange invoice PDF could not be downloaded.'));
  const downloadFardarCsv=(row:ExchangeInvoiceRecord)=>{
    const normalizePhone=(value:string)=>{let digits=String(value||'').replace(/\D/g,'');if(digits.startsWith('0094')&&digits.length>=13)digits=digits.slice(4);else if(digits.startsWith('94')&&digits.length===11)digits=digits.slice(2);else if(digits.length===10&&digits.startsWith('0'))digits=digits.slice(1);return digits;};
    const header=['Waybill ID','Order ID','Parcel Type','Parcel Description','Recipient Name','Recipient Mobile','Recipient Mobile','Recipient Address','Recipient City','COD Amount','Exchange (0 or 1)'];
    const escapeCsv=(value:unknown)=>{const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
    const coverDescription='Exchange: '+(row.items||[]).map(item=>`${item.sku||item.main_sku||'0'} ${item.product_name||''}${item.variant_name?` - ${item.variant_name}`:''} x${item.quantity}`).join(' | ')+' (Exchange Blank Cover)';
    const rows=[ [row.new_waybill,row.id,1,coverDescription,row.customer_name,normalizePhone(row.phone),normalizePhone(row.whatsapp||row.phone),row.address,row.fardar_city||row.city,0,1] ];
    if(row.status==='Item Exchange'){
      const replacement=replacementFor(row);
      if(!replacement){setNotice('MAN replacement order is not linked to '+row.id+' yet. Refresh the exchange list after replacement creation.');return;}
      const replacementDescription=(replacement.items||[]).map(item=>`${item.sku||item.main_sku||'0'} ${item.product_name||''}${item.variant_name?` - ${item.variant_name}`:''} x${item.quantity}`).join(' | ');
      rows.push([replacement.waybill_number||row.replacement_waybill||'',replacement.order_number,1,replacementDescription,replacement.customer_name,normalizePhone(replacement.phone),normalizePhone(replacement.whatsapp||replacement.phone),replacement.address,replacement.fardar_city||replacement.city,0,0]);
    }
    const csv=[header,...rows].map(line=>line.map(escapeCsv).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    const link=document.createElement('a');link.href=url;link.download=`ora_fardar_ready_${row.id}${row.status==='Item Exchange'?'_two_parcels':''}.csv`;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><PackageCheck className="h-6 w-6 text-teal-400"/><h2 className="text-xl font-black text-white">Exchange Parcels</h2></div><p className="mt-1 text-xs text-neutral-400">Cash refunds create one return cover. Item exchanges create a return cover and a COD Rs. 0 MAN replacement invoice.</p></div>
      <button onClick={()=>void refreshExchangeInvoices().catch((error:any)=>setNotice(error?.message||'Refresh failed.'))} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-200"><RefreshCw className="h-3.5 w-3.5"/>Refresh</button>
    </div>
    {notice&&<div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-3 text-xs font-bold text-teal-100">{notice}</div>}

    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="text-[10px] font-black uppercase text-amber-300">Pending Refunds</p><p className="mt-1 text-2xl font-black text-white">{pending.length}</p><p className="mt-1 text-[10px] text-neutral-400">{money(pending.reduce((sum,row)=>sum+row.refund_amount,0))} to pay; delivery charges excluded.</p></div>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"><p className="text-[10px] font-black uppercase text-neutral-500">Refunds Completed</p><p className="mt-1 text-2xl font-black text-white">{completed.length}</p><p className="mt-1 text-[10px] text-neutral-400">{money(completed.reduce((sum,row)=>sum+row.refund_amount,0))} deducted from received-money totals.</p></div>
    </div>

    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-white">Delivered Orders</h3><p className="mt-1 text-[10px] text-neutral-400">Select an original delivered waybill. Exchange creation does not deduct stock.</p></div><label className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Order / waybill / customer" className="w-64 rounded-lg border border-neutral-700 bg-neutral-950 py-2 pl-8 pr-3 text-xs text-white"/></label></div>
      <div className="max-h-[420px] overflow-auto rounded-lg">
        <table className="w-full min-w-[720px] table-fixed text-left text-xs">
          <thead className="sticky top-0 bg-neutral-950 text-[10px] uppercase text-neutral-500"><tr><th className="w-[19%] p-2">Order / Waybill</th><th className="w-[25%] p-2">Customer</th><th className="w-[11%] p-2">Total</th><th className="w-[12%] p-2">Delivery kept</th><th className="w-[11%] p-2">Refund</th><th className="w-[22%] p-2"></th></tr></thead>
          <tbody>{delivered.map(order=><tr key={order.id} className="border-t border-neutral-800"><td className="break-words p-2 font-mono font-bold text-amber-300">{order.order_number}<div className="mt-1 text-[10px] text-blue-300">{order.waybill_number}</div></td><td className="break-words p-2 text-neutral-200">{order.customer_name}<div className="break-all text-[10px] text-neutral-500">{order.phone}</div></td><td className="p-2">{money(orderTotal(order))}</td><td className="p-2 text-neutral-400">{money(deliveryFee(order))}</td><td className="p-2 font-black text-emerald-300">{money(refundFor(order))}</td><td className="p-2"><button disabled={!availableFor(order).length} onClick={()=>begin(order)} className="inline-flex max-w-full items-center justify-center gap-1 whitespace-normal rounded-lg bg-teal-600 px-3 py-2 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3 w-3 shrink-0"/>Create Exchange Invoice</button>{!availableFor(order).length&&<div className="mt-1 text-[9px] text-amber-300">No available waybill</div>}</td></tr>)}{!delivered.length&&<tr><td colSpan={6} className="p-6 text-center text-neutral-500">No delivered orders match this search.</td></tr>}</tbody>
        </table>
      </div>
    </div>

    <div className="rounded-2xl border border-amber-500/20 bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><WalletCards className="h-4 w-4 text-amber-300"/><h3 className="font-black text-white">Refund / Item Exchange History</h3></div><label className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500"/><input value={refundQuery} onChange={event=>setRefundQuery(event.target.value)} placeholder="Exchange ID / order / waybill / customer" className="w-72 max-w-full rounded-lg border border-neutral-700 bg-neutral-950 py-2 pl-8 pr-3 text-xs text-white"/></label></div>
      <p className="mb-3 text-[10px] text-neutral-400">Refund is the original order total less the delivery fee. It stays pending until you have paid the customer. Completing it records the refund against received money and updates the original order to Exchange Refund.</p>
      <div className="overflow-auto rounded-lg">
        <table className="w-full min-w-[830px] table-fixed text-left text-xs">
          <thead className="text-[10px] uppercase text-neutral-500"><tr><th className="w-[19%] p-2">Exchange / Original</th><th className="w-[17%] p-2">Customer</th><th className="w-[10%] p-2">Order total</th><th className="w-[11%] p-2">Delivery kept</th><th className="w-[10%] p-2">Refund</th><th className="w-[11%] p-2">Status</th><th className="w-[22%] p-2">Actions</th></tr></thead>
      <tbody>{refundRows.map(row=>{const replacement=replacementFor(row);return <tr key={row.id} className="border-t border-neutral-800 align-top"><td className="break-words p-2 font-mono"><b className="text-teal-300">{row.id}</b><div className="text-[10px] text-neutral-400">{row.original_order_number} · {row.original_waybill}</div><div className="text-[10px] text-blue-300">New WB {row.new_waybill}</div>{(row.replacement_order_number||replacement?.order_number)&&<div className="text-[10px] text-violet-300">MAN {row.replacement_order_number||replacement?.order_number} · WB {row.replacement_waybill||replacement?.waybill_number}</div>}</td><td className="break-words p-2">{row.customer_name}<div className="break-all text-[10px] text-neutral-500">{row.phone}</div></td><td className="p-2">{money(row.order_total)}</td><td className="p-2">{money(row.delivery_fee)}</td><td className="p-2 font-black text-emerald-300">{money(row.refund_amount)}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${row.status==='Pending Refund'?'bg-amber-500/10 text-amber-300':row.status==='Item Exchange'?'bg-sky-500/10 text-sky-300':'bg-emerald-500/10 text-emerald-300'}`}>{row.status}</span></td><td className="p-2"><div className="flex flex-wrap gap-1.5"><button onClick={()=>downloadInvoice(row)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-700 px-2 py-1.5 text-[9px] font-bold text-neutral-200"><Download className="h-3 w-3"/>A5 PDF</button>{row.status==='Item Exchange'&&replacement?.invoice_locked&&<button onClick={()=>void generateOrderInvoicePDF(replacement,settings)} className="inline-flex items-center gap-1 rounded-lg border border-teal-500/30 bg-teal-500/10 px-2 py-1.5 text-[9px] font-bold text-teal-200"><Download className="h-3 w-3"/>MAN A6 PDF</button>}<button onClick={()=>downloadFardarCsv(row)} className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-[9px] font-bold text-violet-200"><FileSpreadsheet className="h-3 w-3"/>{row.status==='Item Exchange'?'2-parcel CSV':'Fardar CSV'}</button>{row.status==='Pending Refund'?<button disabled={busy===row.id} onClick={()=>chooseRefundSlip(row)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2 py-1.5 text-[9px] font-black text-neutral-950 disabled:opacity-40"><CheckCircle2 className="h-3 w-3"/>{busy===row.id?'Saving...':'Complete + Upload Slip'}</button>:<div className="flex flex-col gap-1 text-[10px] text-neutral-500">{row.refund_completed_at?new Date(row.refund_completed_at).toLocaleDateString():''}{row.refund_slip_path&&<button type="button" onClick={()=>void openRefundSlip(row)} className="text-left font-bold text-teal-300 underline">View payment slip</button>}</div>}</div>{row.status==='Item Exchange'&&replacement&&!replacement.invoice_locked&&<p className="mt-2 text-[10px] text-amber-300">MAN invoice waiting for stock allocation.</p>}{refundFeedback[row.id]&&<p role="status" aria-live="polite" className={`mt-2 rounded-md px-2 py-1.5 text-[10px] font-bold ${refundFeedback[row.id].kind==='error'?'bg-red-500/10 text-red-200':refundFeedback[row.id].kind==='success'?'bg-emerald-500/10 text-emerald-200':'bg-sky-500/10 text-sky-200'}`}>{refundFeedback[row.id].message}</p>}</td></tr>})}{!refundRows.length&&<tr><td colSpan={7} className="p-6 text-center text-neutral-500">{refundQuery.trim()?'No refunds match this search.':'No exchange invoices or refunds yet.'}</td></tr>}</tbody>
        </table>
      </div>
    </div>

    {selected&&<div className="fixed inset-0 z-[85] flex items-center justify-center overflow-y-auto bg-black/80 p-4"><div className="my-4 w-full max-w-2xl rounded-2xl border border-teal-500/30 bg-neutral-900 p-5 shadow-2xl">
<div className="flex items-start justify-between"><div><h3 className="text-lg font-black text-white">Create Exchange</h3><p className="mt-1 text-xs text-neutral-400">{selected.order_number} · Original waybill {selected.waybill_number}</p></div><button onClick={()=>setSelected(null)} className="rounded-lg px-3 py-1 text-neutral-400">×</button></div>
<div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs"><p className="font-bold text-white">{selected.customer_name} · {selected.phone}</p>
<p className="mt-3 font-bold text-neutral-300">Exchange type</p><div className="mt-2 flex gap-2">{(["Cash Refund","Item Exchange"] as const).map(type=><button key={type} type="button" onClick={()=>setExchangeType(type)} className={"rounded-lg border px-3 py-2 text-xs font-black "+(exchangeType===type?"border-teal-400 bg-teal-500/15 text-teal-200":"border-neutral-700 text-neutral-400")}>{type}</button>)}</div>
<p className="mt-3 text-neutral-400">Return cover waybill · auto selected</p><select value={waybill} onChange={event=>setWaybill(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white">{availableFor(selected).map(row=><option key={row.waybill_number} value={row.waybill_number}>{row.waybill_number} · {row.courier_name}</option>)}</select>
{exchangeType==='Cash Refund'?<div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-neutral-900 p-2"><div className="text-[9px] text-neutral-500">Order Total</div><b>{money(orderTotal(selected))}</b></div><div className="rounded-lg bg-neutral-900 p-2"><div className="text-[9px] text-neutral-500">Delivery Kept</div><b>{money(deliveryFee(selected))}</b></div><div className="rounded-lg bg-emerald-500/10 p-2"><div className="text-[9px] text-emerald-300">Pending Refund</div><b className="text-emerald-200">{money(refundFor(selected))}</b></div></div>:<>
<div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3"><p className="font-bold text-sky-200">Choose damaged item(s) and quantity</p><div className="mt-2 space-y-2">{selected.items.map((item,index)=><div key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-900 p-2"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={Boolean(exchangeItems[index])} onChange={event=>setExchangeItems(prev=>{const next={...prev};if(event.target.checked)next[index]=Number(item.quantity||1);else delete next[index];return next;})}/><span><b>{item.product_name}</b><span className="ml-1 text-neutral-400">{item.sku}{item.variant_name?" · "+item.variant_name:""} · Qty {item.quantity}</span></span></label>{exchangeItems[index]!==undefined&&<input aria-label={"Exchange quantity "+(index+1)} type="number" min="1" max={item.quantity} step="1" value={exchangeItems[index]} onChange={event=>setExchangeItems(prev=>({...prev,[index]:Math.max(1,Math.min(Number(item.quantity||1),Number(event.target.value)||1))}))} className="w-20 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-white"/>}</div>)}</div></div>
<div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-amber-100"><b>Replacement parcel</b><p className="mt-1 text-neutral-300">MAN order · normal invoice · COD Rs. 0 · stock deducted</p><p className="mt-1 font-mono text-sm">{availableFor(selected).find(row=>row.waybill_number!==waybill)?.waybill_number||"Need second available waybill"}</p></div></>}</div>
<p className="mt-3 text-[10px] leading-5 text-neutral-400">{exchangeType==="Item Exchange"?"Creates a return cover and a separate MAN replacement invoice using two waybills.":"Refund remains pending until payment slip upload and completion."}</p>
<div className="mt-4 flex justify-end gap-2"><button onClick={()=>setSelected(null)} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300">Cancel</button><button disabled={busy==='create'||!waybill||(exchangeType==='Item Exchange'&&(!Object.keys(exchangeItems).length||availableFor(selected).filter(row=>row.waybill_number!==waybill).length<1))} onClick={()=>void create()} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40"><Download className="h-4 w-4"/>{busy==='create'?'Creating...':exchangeType==='Item Exchange'?'Create Both Invoices':'Create Cash Refund'}</button></div>
</div></div>}
    <input ref={refundSlipInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" className="hidden" onChange={event=>{const file=event.target.files?.[0];const target=refundUploadTarget;event.target.value='';setRefundUploadTarget(null);if(file&&target)void finishRefund(target,file);}} />
  </div>;
};
