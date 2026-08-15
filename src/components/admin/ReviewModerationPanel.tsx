import React, { useEffect, useMemo, useState } from 'react';
import { Check, MessageSquareText, RefreshCw, Trash2, X } from 'lucide-react';
import type { CustomerReview } from '../../types';

const sessionToken = () => localStorage.getItem('ora_staff_session_token') || '';
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken()}` });

export const ReviewModerationPanel: React.FC = () => {
  const [reviews,setReviews]=useState<CustomerReview[]>([]);
  const [filter,setFilter]=useState<'All'|'Pending'|'Approved'|'Rejected'>('Pending');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(false);

  const load=async()=>{setLoading(true);try{const r=await fetch('/api/admin/reviews',{headers:authHeaders()});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error||'Could not load reviews.');setReviews(Array.isArray(d?.reviews)?d.reviews:[])}catch(e:any){setMessage(e?.message||'Could not load reviews.')}finally{setLoading(false)}};
  useEffect(()=>{void load()},[]);
  const visible=useMemo(()=>reviews.filter((r)=>filter==='All'||r.status===filter),[reviews,filter]);

  const setStatus=async(id:string,status:'Approved'|'Rejected')=>{try{const r=await fetch(`/api/admin/reviews/${encodeURIComponent(id)}`,{method:'PATCH',headers:authHeaders(),body:JSON.stringify({status})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error||'Update failed.');setReviews((prev)=>prev.map((x)=>x.id===id?{...x,status}:x));setMessage(`Review ${status.toLowerCase()}.`)}catch(e:any){setMessage(e?.message||'Update failed.')}};
  const remove=async(id:string)=>{if(!window.confirm('Delete this review permanently?'))return;try{const r=await fetch(`/api/admin/reviews/${encodeURIComponent(id)}`,{method:'DELETE',headers:authHeaders()});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error||'Delete failed.');setReviews((prev)=>prev.filter((x)=>x.id!==id))}catch(e:any){setMessage(e?.message||'Delete failed.')}};

  return <div className="space-y-4">
    <div className="rounded-2xl bg-white border border-gray-100 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div className="flex items-center gap-2"><MessageSquareText className="w-5 h-5 text-orange-600"/><div><h2 className="font-black">Product Review Moderation</h2><p className="text-xs text-gray-500">Only Approved reviews are visible on the matching product.</p></div></div><div className="flex gap-2"><select value={filter} onChange={(e)=>setFilter(e.target.value as any)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold">{['Pending','Approved','Rejected','All'].map((x)=><option key={x}>{x}</option>)}</select><button onClick={load} className="p-2 rounded-xl border border-gray-200"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/></button></div></div>
    {message&&<p className="rounded-xl bg-orange-50 border border-orange-100 p-3 text-xs text-orange-800 font-semibold">{message}</p>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{visible.map((review)=><article key={review.id} className="rounded-2xl bg-white border border-gray-100 p-4 space-y-3"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-black">{review.product_name}</p><p className="text-[11px] text-gray-500">{review.customer_name} • {'★'.repeat(review.rating)}{'☆'.repeat(5-review.rating)} • {new Date(review.created_at).toLocaleString()}</p></div><span className={`text-[10px] font-black px-2 py-1 rounded-full ${review.status==='Approved'?'bg-emerald-50 text-emerald-700':review.status==='Rejected'?'bg-red-50 text-red-600':'bg-orange-50 text-orange-700'}`}>{review.status}</span></div><p className="text-xs leading-5 text-gray-600 whitespace-pre-wrap">{review.review_text}</p>{review.image_url&&<img src={review.image_url} alt="Review" className="w-full max-h-52 object-cover rounded-xl border border-gray-100"/>}<div className="flex gap-2"><button onClick={()=>setStatus(review.id,'Approved')} className="flex-1 rounded-xl bg-emerald-600 text-white px-3 py-2 text-xs font-bold flex items-center justify-center gap-1"><Check className="w-4 h-4"/>Approve</button><button onClick={()=>setStatus(review.id,'Rejected')} className="rounded-xl bg-gray-100 text-gray-700 px-3 py-2 text-xs font-bold"><X className="w-4 h-4"/></button><button onClick={()=>remove(review.id)} className="rounded-xl bg-red-50 text-red-600 px-3 py-2 text-xs font-bold"><Trash2 className="w-4 h-4"/></button></div></article>)}</div>
    {!loading&&visible.length===0&&<div className="rounded-2xl bg-white border border-gray-100 p-8 text-center text-xs text-gray-500">No {filter.toLowerCase()} reviews.</div>}
  </div>;
};
