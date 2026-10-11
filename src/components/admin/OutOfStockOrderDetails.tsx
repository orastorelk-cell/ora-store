import { useMemo, useState } from 'react';
import type { Order } from '../../types';
import type { OutOfStockNeedRow } from '../../lib/outOfStockReport';

export function OutOfStockOrderDetails({ rows, orders }: { rows: readonly OutOfStockNeedRow[]; orders: readonly Order[] }) {
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(1);
  const details=useMemo(()=>{
    const byNumber=new Map(orders.map(order=>[order.order_number || order.id,order]));
    const result=new Map<string,{orderNumber:string;waybill:string;reasons:Map<string,string>}>();
    for(const row of rows)for(const orderNumber of row.orderIds) {
      const order=byNumber.get(orderNumber);
      if(!order)continue;
      let detail=result.get(order.id);
      if(!detail){detail={orderNumber,waybill:String(order.waybill_number||'').trim(),reasons:new Map()};result.set(order.id,detail);}
      const shortage=Math.max(0,row.neededQty-row.currentStock);
      const reason=`${row.itemCode} — ${row.itemLabel}: Stock ${row.currentStock}; waiting orders need ${row.neededQty}; short ${shortage}.`;
      detail.reasons.set(row.itemCode,reason);
    }
    return Array.from(result.values());
  },[rows,orders]);
  const filtered=details.filter(row=>`${row.orderNumber} ${row.waybill} ${Array.from(row.reasons.values()).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages=Math.max(1,Math.ceil(filtered.length/10)),currentPage=Math.min(page,pages);
  if(!details.length)return null;
  return <section className="rounded-2xl border border-amber-500/20 bg-neutral-900 p-4 sm:p-5">
    <h3 className="text-sm font-bold text-amber-300">Orders waiting for stock ({details.length})</h3>
    <p className="mt-1 text-xs text-neutral-400">Order ID, assigned waybill and the item shortage. Quantities below are the total demand from waiting orders.</p>
    <input aria-label="Search waiting orders" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} placeholder="Search Order ID / Waybill / Item Code" className="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white" />
    <div className="mt-3 space-y-3">
      {filtered.slice((currentPage-1)*10,currentPage*10).map(row=><div key={row.orderNumber} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
          <div><span className="text-neutral-500">Order ID: </span><span className="font-mono font-bold text-white">{row.orderNumber}</span></div>
          <div><span className="text-neutral-500">Waybill: </span><span className={`font-mono font-bold ${row.waybill?'text-sky-300':'text-neutral-400'}`}>{row.waybill || 'Not assigned yet'}</span></div>
        </div>
        <div className="mt-2 space-y-1 text-xs leading-5 text-amber-200"><span className="font-bold">Reason:</span>{Array.from(row.reasons,([code,reason])=><p key={code} className="break-words">{reason}</p>)}</div>
      </div>)}
      {!filtered.length&&<p className="text-xs text-neutral-400">No matching waiting orders.</p>}
    </div>
    {pages>1&&<div className="mt-3 flex items-center justify-between text-xs text-neutral-300"><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)} className="rounded-lg border border-neutral-700 px-3 py-2 disabled:opacity-40">Previous</button><span>{currentPage} / {pages}</span><button disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)} className="rounded-lg border border-neutral-700 px-3 py-2 disabled:opacity-40">Next</button></div>}
  </section>;
}
