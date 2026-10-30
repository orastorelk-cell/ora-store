import React,{useEffect,useMemo,useRef,useState} from 'react';
import {staffJsonRequest} from '../../lib/staffRequest';
import {normalizedProductType} from '../../lib/productVariants';
import type {Product} from '../../types';

type SystemRow={sku:string;name:string;variant:string;type:string;available:number;packing:number};
type CountRow={product_id:string;variant_id?:string;sku:string;actual_qty:number;expected_available:number;expected_packing:number;expected_qty:number;difference:number;name:string;variant:string};
type CountSession={session_id:string;counted_at:string;counted_by:string;notes:string;rows:CountRow[]};
const endpoint='/api/admin/inventory-history';
const request=(url:string,options:RequestInit={})=>{
  const token=localStorage.getItem('ora_staff_session_token')||'';
  if(!token)throw new Error('Super Admin login is required.');
  return staffJsonRequest(url,{...options,headers:{...options.headers,authorization:'Bearer '+token,'content-type':'application/json'}},30_000);
};

/** Records a physical count snapshot only; it never adjusts stock or order allocation. */
export const StockCountReconciliationPanel=({products,systemRows,countedBy,isAdmin}:{products:Product[];systemRows:SystemRow[];countedBy:string;isAdmin:boolean})=>{
  const [search,setSearch]=useState('');
  const [staff,setStaff]=useState(countedBy);
  const [notes,setNotes]=useState('');
  const [counts,setCounts]=useState<Record<string,string>>({});
  const [sessions,setSessions]=useState<CountSession[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const pendingSession=useRef<any>(null);

  const choices=useMemo(()=>systemRows.filter(row=>row.type!=='Combo Pack').map(row=>{
    const sku=String(row.sku||'').trim().toUpperCase();
    const product=products.find(item=>String(item.sku||'').trim().toUpperCase()===sku||(item.variants||[]).some(variant=>String(variant.sku||'').trim().toUpperCase()===sku));
    const variant=product?.variants?.find(item=>String(item.sku||'').trim().toUpperCase()===sku);
    return{...row,sku,product_id:String(product?.id||''),variant_id:variant?String(variant.id):undefined,key:sku,expected_qty:Math.max(0,Number(row.available||0)+Number(row.packing||0))};
  }).filter(row=>row.product_id).sort((a,b)=>a.sku.localeCompare(b.sku,undefined,{numeric:true,sensitivity:'base'})),[products,systemRows]);
  const visible=choices.filter(row=>!search.trim()||[row.sku,row.name,row.variant].some(value=>String(value||'').toLowerCase().includes(search.trim().toLowerCase())));
  const entered=choices.filter(row=>counts[row.key]!==undefined&&counts[row.key]!=='' );

  useEffect(()=>{
    if(!isAdmin)return;
    let active=true;
    void request(endpoint+'?stock-counts=1').then(result=>{
      if(active&&result?.ok&&Array.isArray(result.stock_count_sessions))setSessions(result.stock_count_sessions);
    }).catch(error=>{if(active)setMessage(error?.message||'Saved stock counts could not be loaded.');});
    return()=>{active=false;};
  },[isAdmin]);

  const save=async()=>{
    if(busy||!entered.length)return;
    if(!staff.trim()){setMessage('Enter the staff member who counted the stock.');return;}
    const rows=entered.map(row=>({product_id:row.product_id,...(row.variant_id?{variant_id:row.variant_id}:{}),sku:row.sku,actual_qty:Number(counts[row.key])}));
    if(rows.some(row=>!Number.isSafeInteger(row.actual_qty)||row.actual_qty<0)){setMessage('Each counted quantity must be a whole number 0 or greater.');return;}
    if(!pendingSession.current)pendingSession.current={action:'stock-count-session',session_id:crypto.randomUUID(),counted_by:staff.trim(),notes:notes.trim(),rows};
    setBusy(true);setMessage('Saving count snapshot…');
    try{
      const result=await request(endpoint,{method:'POST',body:JSON.stringify(pendingSession.current)});
      if(result?.ok!==true||!result.session)throw new Error(result?.error||'Server did not confirm the stock count.');
      setSessions(previous=>[result.session,...previous.filter(item=>item.session_id!==result.session.session_id)].slice(0,20));
      pendingSession.current=null;setCounts({});setNotes('');
      const variances=(result.session.rows||[]).filter((row:CountRow)=>row.difference!==0).length;
      setMessage('Count saved: '+result.session.rows.length+' item code(s), '+variances+' mismatch(es). System stock was not changed.');
    }catch(error:any){setMessage(error?.message||'Stock count was not saved. System stock was not changed.');}
    finally{setBusy(false);}
  };
  if(!isAdmin)return null;
  return <section className="overflow-hidden rounded-2xl border border-violet-500/30 bg-neutral-900 text-neutral-100">
    <div className="border-b border-neutral-800 p-4"><h3 className="text-sm font-black text-violet-200">Physical Stock Count & Reconciliation</h3>
      <p className="mt-1 text-xs text-neutral-400">Staff ගණන් කළ ඇත්ත stock එක ඇතුළත් කරන්න. System physical stock (Available + Packing) සමඟ වෙනස පෙන්වයි. Save කළාම ගණන් කිරීම පමණක් සුරැකේ; stock, orders, returns හෝ packing ස්වයංක්‍රීයව වෙනස් වෙන්නේ නැහැ.</p></div>
    <div className="grid gap-3 p-4 sm:grid-cols-3">
      <label className="text-xs font-bold text-neutral-300">Counted by<input value={staff} onChange={event=>setStaff(event.target.value)} maxLength={120} disabled={Boolean(pendingSession.current)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white disabled:opacity-50" placeholder="Staff name" /></label>
      <label className="text-xs font-bold text-neutral-300">Search Item Code / name<input value={search} onChange={event=>setSearch(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" placeholder="R0023, Stitch…" /></label>
      <label className="text-xs font-bold text-neutral-300">Count note (optional)<input value={notes} onChange={event=>setNotes(event.target.value)} maxLength={500} disabled={Boolean(pendingSession.current)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white disabled:opacity-50" placeholder="Shelf / location / shift" /></label>
    </div>
    <div className="max-h-[460px] overflow-auto border-y border-neutral-800">
      <table className="w-full min-w-[820px] text-left text-xs text-neutral-300"><thead className="sticky top-0 bg-neutral-950 text-[10px] uppercase text-neutral-500"><tr><th className="p-3">Item Code</th><th className="p-3">Item / Variant</th><th className="p-3 text-center">System Available</th><th className="p-3 text-center">Packing</th><th className="p-3 text-center">System Physical</th><th className="p-3 text-center">Staff Count</th><th className="p-3 text-center">Difference</th></tr></thead>
        <tbody className="divide-y divide-neutral-800">{visible.map(row=>{const raw=counts[row.key]??'';const diff=raw===''?null:Number(raw)-row.expected_qty;return <tr key={row.key}>
          <td className="p-3 font-mono font-black text-violet-200">{row.sku}</td><td className="p-3"><span className="font-semibold text-white">{row.name}</span>{row.variant&&<span className="ml-1 text-neutral-500">• {row.variant}</span>}</td>
          <td className="p-3 text-center">{row.available}</td><td className="p-3 text-center">{row.packing}</td><td className="p-3 text-center font-black text-white">{row.expected_qty}</td>
          <td className="p-2 text-center"><input aria-label={'Staff count '+row.sku} type="number" min="0" step="1" value={raw} disabled={Boolean(pendingSession.current)} onChange={event=>setCounts(previous=>({...previous,[row.key]:event.target.value}))} className="w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-center font-black text-white disabled:opacity-50" placeholder="—" /></td>
          <td className={'p-3 text-center font-black '+(diff===null?'text-neutral-600':diff===0?'text-emerald-300':'text-amber-300')}>{diff===null?'—':diff>0?'+'+diff:String(diff)}</td>
        </tr>;})}{visible.length===0&&<tr><td colSpan={7} className="p-6 text-center text-neutral-500">No matching stock item.</td></tr>}</tbody></table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 p-4"><span className="text-xs text-neutral-400">Entered: {entered.length} / {choices.length} item codes • Mismatches: {entered.filter(row=>Number(counts[row.key])!==row.expected_qty).length}</span>
      <button type="button" disabled={busy||(!entered.length&&!pendingSession.current)} onClick={()=>void save()} className="rounded-xl bg-violet-300 px-4 py-2.5 text-xs font-black text-neutral-950 disabled:opacity-40">{busy?'Saving…':pendingSession.current?'Retry Same Count Save':'Save Count Snapshot (No Stock Change)'}</button></div>
    {message&&<p role="status" className="border-t border-neutral-800 px-4 py-3 text-xs font-semibold text-amber-200">{message}</p>}
    {sessions.length>0&&<details className="border-t border-neutral-800 p-4"><summary className="cursor-pointer text-xs font-black text-neutral-300">Saved count sessions ({sessions.length})</summary><div className="mt-3 space-y-2">{sessions.map(session=>{const variance=session.rows.filter(row=>row.difference!==0);return <details key={session.session_id} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"><summary className="cursor-pointer text-xs"><b>{new Date(session.counted_at).toLocaleString()}</b> • {session.counted_by} • {session.rows.length} codes • <span className={variance.length?'text-amber-300':'text-emerald-300'}>{variance.length} mismatch(es)</span>{session.notes?' • '+session.notes:''}</summary><div className="mt-2 space-y-1">{session.rows.map(row=><p key={row.sku} className="text-[11px] text-neutral-400"><b className="font-mono text-white">{row.sku}</b> — system {row.expected_qty}, counted {row.actual_qty}, difference {row.difference>0?'+'+row.difference:row.difference}</p>)}</div></details>;})}</div></details>}
  </section>;
};
