import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, PackageCheck, RefreshCcw, RotateCcw, Search, Send, WalletCards } from 'lucide-react';

type Complaint = {
  id: string;
  order_number: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  source: 'WhatsApp' | 'Website' | 'Manual';
  language?: string;
  category: string;
  description: string;
  evidence_urls?: string[];
  status: string;
  return_waybill?: string | null;
  return_received_at?: string | null;
  return_condition_notes?: string | null;
  refund_amount?: number | null;
  refund_method?: string | null;
  refund_reference?: string | null;
  refund_completed_at?: string | null;
  internal_notes?: string | null;
  messages?: { id:string; role:string; text:string; at:string; agent_name?:string; delivery?:string }[];
  created_at: string;
  updated_at: string;
};

const staffRequest = async (url: string, init: RequestInit = {}) => {
  const token = localStorage.getItem('ora_staff_session_token') || '';
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type','application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
};

const statuses = ['New','Checking','Waiting Customer','Return Requested','Return In Transit','Parcel Received','Refund Approved','Refund Completed','Resolved','Rejected'];
const categories = ['Wrong Item','Missing Item','Damaged Item','Delivery Issue','Payment Issue','Other Complaint'];

const statusClass = (status:string) => {
  if (status === 'Resolved' || status === 'Refund Completed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'Rejected') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status.includes('Refund') || status.includes('Return') || status === 'Parcel Received') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
};

export const ComplaintsPanel: React.FC = () => {
  const [rows,setRows]=useState<Complaint[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [query,setQuery]=useState('');
  const [statusFilter,setStatusFilter]=useState('Open');
  const [busy,setBusy]=useState(false);
  const [reply,setReply]=useState('');
  const [draft,setDraft]=useState({ return_waybill:'', return_condition_notes:'', refund_amount:'', refund_method:'Bank Transfer', refund_reference:'', internal_notes:'' });
  const [manualOpen,setManualOpen]=useState(false);
  const [manual,setManual]=useState({ order_number:'', customer_name:'', customer_phone:'', category:'Other Complaint', description:'' });

  const load=async()=>{
    try{
      const data=await staffRequest('/api/admin/complaints');
      const next:Array<Complaint>=Array.isArray(data?.complaints)?data.complaints:[];
      setRows(next);
      setSelectedId((cur)=>cur&&next.some((r)=>r.id===cur)?cur:next.find((r)=>r.status==='New')?.id||next[0]?.id||'');
    }catch(e){console.warn('Complaint refresh failed:',e);}
  };
  useEffect(()=>{void load(); const t=window.setInterval(()=>void load(),30000); return()=>window.clearInterval(t);},[]);

  const selected=rows.find((r)=>r.id===selectedId)||null;
  useEffect(()=>{
    if(!selected)return;
    setDraft({
      return_waybill:selected.return_waybill||'',
      return_condition_notes:selected.return_condition_notes||'',
      refund_amount:selected.refund_amount?String(selected.refund_amount):'',
      refund_method:selected.refund_method||'Bank Transfer',
      refund_reference:selected.refund_reference||'',
      internal_notes:selected.internal_notes||'',
    });
  },[selectedId,selected?.updated_at]);

  const visible=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return rows.filter((r)=>{
      if(statusFilter==='Open' && ['Resolved','Rejected','Refund Completed'].includes(r.status))return false;
      if(statusFilter!=='Open'&&statusFilter!=='All'&&r.status!==statusFilter)return false;
      if(!q)return true;
      return [r.id,r.order_number,r.customer_name||'',r.customer_phone||'',r.category,r.description].some((v)=>String(v).toLowerCase().includes(q));
    });
  },[rows,query,statusFilter]);

  const patch=async(payload:any)=>{
    if(!selected||busy)return;
    setBusy(true);
    try{await staffRequest(`/api/admin/complaints/${selected.id}`,{method:'PATCH',body:JSON.stringify(payload)});await load();}
    catch(e:any){alert(e?.message||'Complaint update failed.');}
    finally{setBusy(false);}
  };

  const saveDetails=()=>patch({
    return_waybill:draft.return_waybill,
    return_condition_notes:draft.return_condition_notes,
    refund_amount:Number(draft.refund_amount||0)||null,
    refund_method:draft.refund_method,
    refund_reference:draft.refund_reference,
    internal_notes:draft.internal_notes,
  });

  const markParcelReceived=()=>patch({ status:'Parcel Received', return_received_at:new Date().toISOString(), ...draft, refund_amount:Number(draft.refund_amount||0)||null });

  const sendReply=async()=>{
    if(!selected||!reply.trim()||busy)return;
    setBusy(true);
    try{
      const data=await staffRequest(`/api/admin/complaints/${selected.id}/reply`,{method:'POST',body:JSON.stringify({message:reply.trim()})});
      setReply(''); await load();
      if(data?.delivery==='Pending WhatsApp Setup') alert('Reply saved in O-RA. WhatsApp delivery will activate after the complaint WhatsApp number/API is connected.');
    }catch(e:any){alert(e?.message||'Reply failed.');}
    finally{setBusy(false);}
  };

  const createManual=async()=>{
    if(!manual.order_number.trim()||!manual.description.trim())return alert('Order ID and complaint details are required.');
    setBusy(true);
    try{await staffRequest('/api/admin/complaints',{method:'POST',body:JSON.stringify(manual)});setManual({order_number:'',customer_name:'',customer_phone:'',category:'Other Complaint',description:''});setManualOpen(false);await load();}
    catch(e:any){alert(e?.message||'Complaint create failed.');}
    finally{setBusy(false);}
  };

  const openCount=rows.filter((r)=>!['Resolved','Rejected','Refund Completed'].includes(r.status)).length;

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 md:flex-row md:items-center md:justify-between">
      <div><div className="flex items-center gap-2 text-white"><AlertTriangle className="h-5 w-5 text-orange-400"/><h2 className="font-black">Complaints</h2></div><p className="mt-1 text-[11px] text-neutral-400">Normal support stays in O-RA Assistant. This module is for complaint cases, return parcels and refunds.</p></div>
      <div className="flex flex-wrap items-center gap-2"><div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center"><div className="text-[9px] font-black uppercase text-amber-300">Open Cases</div><div className="text-xl font-black text-white">{openCount}</div></div><button onClick={()=>setManualOpen((v)=>!v)} className="rounded-xl bg-orange-500 px-3 py-2 text-[10px] font-black text-neutral-950">+ Manual Complaint</button><button onClick={()=>void load()} className="rounded-xl border border-neutral-700 bg-neutral-950 p-2 text-neutral-300"><RefreshCcw className="h-4 w-4"/></button></div>
    </div>

    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3 text-[11px] leading-5 text-sky-200"><b>Complaint flow right now:</b> this page is the O-RA complaint case manager. WhatsApp Complaint Assistant is not connected yet, so customer complaints do not arrive here automatically. Use <b>+ Manual Complaint</b> only for localhost testing. After the dedicated WhatsApp complaint number is connected, it will collect Order ID → complaint type → short details → evidence and create the same CMP case here automatically.</div>

    {manualOpen&&<div className="grid gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 md:grid-cols-2"><input value={manual.order_number} onChange={(e)=>setManual({...manual,order_number:e.target.value})} placeholder="Order ID *" className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/><input value={manual.customer_name} onChange={(e)=>setManual({...manual,customer_name:e.target.value})} placeholder="Customer name" className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/><input value={manual.customer_phone} onChange={(e)=>setManual({...manual,customer_phone:e.target.value})} placeholder="Phone" className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/><select value={manual.category} onChange={(e)=>setManual({...manual,category:e.target.value})} className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white">{categories.map((c)=><option key={c}>{c}</option>)}</select><textarea value={manual.description} onChange={(e)=>setManual({...manual,description:e.target.value})} placeholder="Complaint details *" className="md:col-span-2 min-h-24 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/><button disabled={busy} onClick={()=>void createManual()} className="md:col-span-2 rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-neutral-950">Create Complaint</button></div>}

    <div className="grid min-h-[680px] gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900"><div className="space-y-2 border-b border-neutral-800 p-3"><label className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"><Search className="h-4 w-4 text-neutral-500"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="CMP ID, Order ID, customer..." className="w-full bg-transparent text-xs text-white outline-none"/></label><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)} className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-bold text-white"><option>Open</option><option>All</option>{statuses.map((s)=><option key={s}>{s}</option>)}</select></div><div className="max-h-[600px] overflow-y-auto p-2">{visible.length===0?<div className="p-6 text-center text-xs text-neutral-500">No complaint cases.</div>:visible.map((r)=><button key={r.id} onClick={()=>setSelectedId(r.id)} className={`mb-2 w-full rounded-xl border p-3 text-left ${selectedId===r.id?'border-orange-500/50 bg-orange-500/10':'border-neutral-800 bg-neutral-950'}`}><div className="flex items-start justify-between gap-2"><div><p className="font-mono text-xs font-black text-white">{r.id}</p><p className="mt-0.5 text-[10px] text-neutral-500">{r.order_number} • {r.category}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-black ${statusClass(r.status)}`}>{r.status}</span></div><p className="mt-2 line-clamp-2 text-[11px] text-neutral-300">{r.description}</p><p className="mt-2 text-[9px] text-neutral-600">{new Date(r.updated_at).toLocaleString()}</p></button>)}</div></div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">{!selected?<div className="flex min-h-[620px] items-center justify-center text-xs text-neutral-500">Select a complaint.</div>:<div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-black text-white">{selected.id}</span><span className={`rounded-full border px-2 py-1 text-[9px] font-black ${statusClass(selected.status)}`}>{selected.status}</span></div><p className="mt-1 text-xs text-neutral-300">Order: <b>{selected.order_number}</b> • {selected.category} • {selected.source}</p><p className="mt-1 text-[10px] text-neutral-500">{selected.customer_name||'Customer'} {selected.customer_phone?`• ${selected.customer_phone}`:''}</p></div><select value={selected.status} onChange={(e)=>void patch({status:e.target.value})} className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-bold text-white">{statuses.map((s)=><option key={s}>{s}</option>)}</select></div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"><p className="text-[10px] font-black uppercase text-neutral-500">Complaint Details</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-neutral-200">{selected.description}</p></div>
        {selected.evidence_urls&&selected.evidence_urls.length>0&&<div className="grid grid-cols-3 gap-2">{selected.evidence_urls.map((url,i)=><a key={url+i} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950"><img src={url} alt={`Evidence ${i+1}`} className="h-28 w-full object-cover"/></a>)}</div>}

        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4"><div className="mb-3 flex items-center gap-2 text-sky-200"><RotateCcw className="h-4 w-4"/><h3 className="text-xs font-black">Return & Refund</h3></div><div className="grid gap-3 md:grid-cols-2"><label className="text-[10px] text-neutral-400">Return Waybill<input value={draft.return_waybill} onChange={(e)=>setDraft({...draft,return_waybill:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label><label className="text-[10px] text-neutral-400">Refund Amount (Rs.)<input type="number" min="0" value={draft.refund_amount} onChange={(e)=>setDraft({...draft,refund_amount:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label><label className="text-[10px] text-neutral-400">Refund Method<input value={draft.refund_method} onChange={(e)=>setDraft({...draft,refund_method:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label><label className="text-[10px] text-neutral-400">Refund Reference<input value={draft.refund_reference} onChange={(e)=>setDraft({...draft,refund_reference:e.target.value})} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label><label className="md:col-span-2 text-[10px] text-neutral-400">Returned Item / Condition Notes<textarea value={draft.return_condition_notes} onChange={(e)=>setDraft({...draft,return_condition_notes:e.target.value})} className="mt-1 min-h-20 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label><label className="md:col-span-2 text-[10px] text-neutral-400">Internal Notes<textarea value={draft.internal_notes} onChange={(e)=>setDraft({...draft,internal_notes:e.target.value})} className="mt-1 min-h-20 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label></div><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} onClick={()=>void saveDetails()} className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-[10px] font-black text-white">Save Details</button><button disabled={busy} onClick={()=>void patch({status:'Return Requested',return_waybill:draft.return_waybill})} className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[10px] font-black text-sky-300"><RotateCcw className="h-3.5 w-3.5"/>Return Requested</button><button disabled={busy} onClick={()=>void patch({status:'Return In Transit',return_waybill:draft.return_waybill})} className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-black text-cyan-300">Return In Transit</button><button disabled={busy} onClick={()=>void markParcelReceived()} className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[10px] font-black text-violet-300"><PackageCheck className="h-3.5 w-3.5"/>Parcel Received</button><button disabled={busy||!selected.return_received_at} onClick={()=>void patch({status:'Refund Approved',...draft,refund_amount:Number(draft.refund_amount||0)||null})} className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-black text-amber-300 disabled:opacity-40"><WalletCards className="h-3.5 w-3.5"/>Refund Approved</button><button disabled={busy||!selected.return_received_at} onClick={()=>void patch({status:'Refund Completed',...draft,refund_amount:Number(draft.refund_amount||0)||null})} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-[10px] font-black text-neutral-950 disabled:opacity-40"><CheckCircle2 className="h-3.5 w-3.5"/>Refund Completed</button></div>{!selected.return_received_at&&<p className="mt-2 text-[10px] text-amber-300">Refund approval is locked until Parcel Received is confirmed.</p>}</div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4"><div className="mb-2 flex items-center gap-2"><Clock3 className="h-4 w-4 text-orange-400"/><h3 className="text-xs font-black text-white">Customer Reply</h3></div>{selected.messages&&selected.messages.length>0&&<div className="mb-3 max-h-44 space-y-2 overflow-y-auto">{selected.messages.map((m)=><div key={m.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-2 text-[11px] text-neutral-200"><p>{m.text}</p><p className="mt-1 text-[9px] text-neutral-600">{m.agent_name||m.role} • {new Date(m.at).toLocaleString()} • {m.delivery||''}</p></div>)}</div>}<div className="flex items-end gap-2"><textarea value={reply} onChange={(e)=>setReply(e.target.value)} rows={2} placeholder="Reply / resolution message..." className="flex-1 resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white"/><button disabled={busy||!reply.trim()} onClick={()=>void sendReply()} className="inline-flex h-10 items-center gap-1 rounded-xl bg-orange-500 px-4 text-xs font-black text-neutral-950"><Send className="h-4 w-4"/>Save Reply</button></div><p className="mt-2 text-[9px] text-neutral-500">Until WhatsApp Cloud API is connected, replies are saved in O-RA as pending delivery.</p></div>
      </div>}</div>
    </div>
  </div>;
};
