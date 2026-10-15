import React, { useEffect, useState } from 'react';
import { useStore } from '../../context/StoreContext';

export const DuplicateOrdersPanel:React.FC<{canEdit:boolean}>=({canEdit})=>{
  const {refreshOrdersFromServer}=useStore();
  const [data,setData]=useState<any>({pairs:[],pending:0,approved:0,total:0}),[status,setStatus]=useState('pending'),[search,setSearch]=useState(''),[page,setPage]=useState(1);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const request=async(path:string,options:RequestInit={})=>{
    const response=await fetch(path,{...options,headers:{'content-type':'application/json',authorization:'Bearer '+(localStorage.getItem('ora_staff_session_token')||'')},cache:'no-store'});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Please retry.');return result;
  };
  const load=async()=>setData(await request(`/api/orders/duplicate-review?status=${status}&page=${page}&search=${encodeURIComponent(search)}`));
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{request(`/api/orders/duplicate-review?status=${status}&page=${page}&search=${encodeURIComponent(search)}`).then(result=>{if(active){setData(result);setError('');}}).catch(error=>{if(active)setError(error.message);});},200);return()=>{active=false;clearTimeout(timer);};},[status,search,page]);
  const approve=async(order:any)=>{
    if(busy)return;setBusy(order.id);setError('');setMessage('');
    try{await request('/api/orders/duplicate-review',{method:'POST',body:JSON.stringify({action:'approve_separate',order_id:order.id})});setMessage(order.order_number+' approved as a separate order. Continue its normal confirmation / packing flow.');await load();await refreshOrdersFromServer(true);}
    catch(error:any){setError(error.message);}finally{setBusy('');}
  };
  const details=(order:any)=>order?<div className="space-y-1 text-sm"><p className="font-bold text-gray-900">{order.order_number} · {order.customer_name}</p><p>{order.phone} · {order.city}</p><p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleString()} · {order.order_source} · {order.order_status}</p>
    {(order.items||[]).map((item:any,index:number)=><p key={index}>{item.product_name}{item.variant_name?' · '+item.variant_name:''} × {item.quantity}</p>)}<p className="font-bold">Rs. {Number(order.total_amount||0).toLocaleString()}</p></div>:<p className="text-sm text-gray-500">Original order is unavailable. Review this customer in Orders.</p>;
  return <section className="space-y-4 text-gray-700">
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="text-xl font-black text-gray-900">Duplicate Orders</h2><p className="mt-1 text-sm">නැවත මිලදී ගැනීමක් නම් කලින් order එක සමඟ බලලා Approve කරන්න. Pending orders packing සඳහා නවතා ඇත.</p></div>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>{setStatus('pending');setPage(1);}} className={`rounded-xl border px-4 py-2 font-bold ${status==='pending'?'bg-amber-100':'bg-white'}`}>Needs review ({data.pending})</button>
      <button type="button" onClick={()=>{setStatus('approved');setPage(1);}} className={`rounded-xl border px-4 py-2 font-bold ${status==='approved'?'bg-emerald-100':'bg-white'}`}>Approved ({data.approved})</button>
      <input value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder="Order ID, phone or customer" className="rounded-xl border bg-white px-3 py-2 text-sm"/>
      <button type="button" onClick={()=>load().catch(error=>setError(error.message))} className="rounded-xl border bg-white px-3 py-2">Refresh</button></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}{message&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-700">{message}</p>}
    {!data.pairs.length&&!error&&<p className="rounded-xl border bg-white p-6">No orders in this list.</p>}
    {data.pairs.map(({order,original}:any)=><article key={order.id} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="grid gap-5 md:grid-cols-2"><div><h3 className="mb-2 text-xs font-black uppercase text-amber-700">New / repeat order</h3>{details(order)}</div><div><h3 className="mb-2 text-xs font-black uppercase text-gray-500">Previous order</h3>{details(original)}</div></div>
      {order.duplicate_review_status==='Approved'?<p className="mt-4 text-sm font-bold text-emerald-700">Approved by {order.duplicate_reviewed_by_name||'staff'} · {new Date(order.duplicate_reviewed_at).toLocaleString()}</p>:<div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={!canEdit||Boolean(busy)} onClick={()=>approve(order)} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy===order.id?'Saving…':'Approve as separate order'}</button><span className="text-xs text-gray-500">Leave pending if this is an accidental duplicate.</span></div>}</article>)}
    <div className="flex items-center gap-3 text-sm"><button disabled={page<=1} onClick={()=>setPage(page-1)} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">Previous</button><span>Page {page} · {data.total} orders</span><button disabled={page*10>=data.total} onClick={()=>setPage(page+1)} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">Next</button></div>
  </section>;
};
