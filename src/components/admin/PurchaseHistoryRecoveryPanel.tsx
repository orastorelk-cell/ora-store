import React,{useState} from 'react';
import { staffJsonRequest } from '../../lib/staffRequest';
import type { PurchaseOrder } from '../../types';

type BackupSlot={slot:number;count?:number;missing_count?:number;conflict_count?:number;oldest?:string|null;newest?:string|null;error?:string};
type BackupPreview={slot:number;backup_count:number;live_count:number;missing_count:number;duplicate_count:number;
  conflict_count:number;conflicts:string[];oldest:string|null;newest:string|null};
const endpoint='/api/admin/purchasing-backup-recovery';
const request=async(url:string,options:RequestInit={})=>{
  const token=localStorage.getItem('ora_staff_session_token')||'';
  if(!token)throw new Error('Super Admin login is required.');
  return staffJsonRequest(url,{...options,headers:{...options.headers,authorization:'Bearer '+token,
    'content-type':'application/json'}},30_000);
};
/** Backup recovery only imports immutable receipts. Never repurchases or credits stock. */
export const PurchaseHistoryRecoveryPanel=({purchases,isAdmin}:{purchases:PurchaseOrder[];isAdmin:boolean})=>{
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState('');
  const [slots,setSlots]=useState<BackupSlot[]>([]);
  const [preview,setPreview]=useState<BackupPreview|null>(null);
  const [message,setMessage]=useState('');
  const [serverCount,setServerCount]=useState<number|null>(null);
  const [restored,setRestored]=useState(0);
  if(!isAdmin)return null;
  const scan=async()=>{
    if(busy)return;
    setBusy(true);setMessage('');setSlots([]);setPreview(null);
    const found:BackupSlot[]=[];
    try{
      const current=await request('/api/admin/inventory-history');
      if(!current?.ok||!Array.isArray(current.purchases))
        throw new Error('Server Purchasing History could not be read. No changes were made.');
      setServerCount(current.purchases.length);
      for(let cursor=0;cursor<168;cursor+=12){
        setProgress('Scanning encrypted R2 backup slots '+(cursor+1)+'–'+Math.min(cursor+12,168)+' of 168...');
        const data=await request(endpoint+'?cursor='+cursor);
        if(data?.ok!==true||!Array.isArray(data.slots))
          throw new Error('Backup scan returned incomplete data. No records restored.');
        found.push(...data.slots);
        setSlots(found.slice());
      }
      const available=found.filter(row=>Number(row.missing_count)>0);
      const bad=found.filter(row=>row.error);
      setMessage(available.length
        ?'Found '+available.length+' backups with potentially missing purchasing receipts. Preview the largest candidate, then restore verified records without affecting Stock.'
        :bad.length?'No confirmed missing records yet. '+bad.length+' backup slots could not be read; check those errors.'
        :'No missing Purchasing receipts found in existing R2 backups. Older purchases may exist only in the original browser, and cannot be reconstructed by guessing.');
    }catch(error:any){setMessage(error?.message||'Cloudflare backup scan failed. No stock changed.');}
    finally{setBusy(false);setProgress('');}
  };
  const inspect=async(slot:number)=>{
    if(busy)return;setBusy(true);setMessage('');setPreview(null);
    try{
      const r=await request(endpoint,{method:'POST',body:JSON.stringify({action:'preview',slot})});
      if(r?.ok!==true||!r.preview)throw new Error('Purchasing backup preview failed.');
      setPreview(r.preview);
      if(r.preview.missing_count===0)setMessage('This backup has no missing Purchase IDs. You can preview another snapshot.');
    }catch(error:any){setMessage(error?.message||'Backup could not be inspected. Nothing changed.');}
    finally{setBusy(false);}
  };
  const restore=async()=>{
    if(busy||!preview||preview.missing_count<=0||preview.conflict_count>0)return;
    const prompt='RESTORE OLD PURCHASING HISTORY — RECEIPTS ONLY\n\n'+
      'R2 backup slot: '+preview.slot+'\n'+
      'Old receipts absent from live server: '+preview.missing_count+'\n'+
      'Oldest: '+(preview.oldest||'Unknown')+'\n'+
      'Newest: '+(preview.newest||'Unknown')+'\n\n'+
      'This will NOT increase Stock, change orders, print invoices, or create a new Purchase. Continue?';
    if(!window.confirm(prompt))return;
    setBusy(true);setMessage('');
    try{
      const done=await request(endpoint,{method:'POST',body:JSON.stringify({action:'restore',slot:preview.slot,
        expected_missing:preview.missing_count,expected_backup_count:preview.backup_count})});
      if(done?.ok!==true||!Number.isInteger(done.added))
        throw new Error('History recovery was not confirmed. Nothing is assumed restored.');
      setRestored(value=>value+done.added);
      setPreview(null);
      setMessage(done.added+' historic Purchase records recovered to server without stock recredit. Re-scan for receipts in other snapshots; reload to view Purchasing and corrected Profit Report review status.');
    }catch(error:any){setMessage(error?.message||'History recovery was not confirmed. Stock is unchanged.');}
    finally{setBusy(false);}
  };
  const candidates=slots.filter(row=>!row.error&&Number(row.missing_count)>0)
    .sort((a,b)=>(b.missing_count||0)-(a.missing_count||0)||(b.count||0)-(a.count||0)).slice(0,20);
  return <section className="rounded-2xl border border-amber-500/30 bg-neutral-900 p-4 text-neutral-200">
    <h3 className="text-sm font-black text-amber-300">Recover Missing Old Purchasing History — Cloudflare R2</h3>
    <p className="mt-1 text-xs text-neutral-400">Browser-only old purchases may have disappeared. Search seven days of existing server backup slots.
      Restore verified old Purchase IDs only; actual Stock, order allocations and invoices will NOT be changed.</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={()=>void scan()}
        className="rounded-xl border border-amber-500 px-4 py-2 text-xs font-black text-amber-200 disabled:opacity-40">
        {busy?'Checking…':'Search All 168 Backup Slots'}
      </button>
      <span className="text-xs text-neutral-400">Visible local receipts: {purchases.length} • R2 receipts: {serverCount===null?'not checked':serverCount} • Restored here: {restored}</span>
    </div>
    {progress&&<p role="status" className="mt-2 text-xs text-sky-300">{progress}</p>}
    {message&&<p role="status" className="mt-2 text-xs font-semibold text-amber-200">{message}</p>}
    {candidates.length>0&&<div className="mt-4 space-y-2">
      <p className="text-xs font-bold">Available old backup candidates (most missing receipts first)</p>
      {candidates.map(item=><div key={item.slot} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-neutral-950 p-3">
        <span className="text-xs">Slot {item.slot} • {item.count} total • <b className="text-amber-300">{item.missing_count} missing</b>
          {item.conflict_count?(' • '+item.conflict_count+' conflicts'):''} • {item.oldest?.slice(0,10)||'Unknown'} → {item.newest?.slice(0,10)||'Unknown'}</span>
        <button type="button" disabled={busy} onClick={()=>void inspect(item.slot)}
          className="rounded-lg border border-neutral-600 px-3 py-1.5 text-xs disabled:opacity-40">Preview old receipts</button>
      </div>)}
    </div>}
    {preview&&<div className="mt-4 rounded-xl border border-amber-500/30 p-3 text-xs">
      <p className="font-black">Backup {preview.slot}: {preview.missing_count} old receipts can be recovered</p>
      <p className="mt-1">Existing server records: {preview.live_count} • Already present: {preview.duplicate_count} • Conflicts: {preview.conflict_count}</p>
      {preview.conflicts.length>0&&<p className="mt-2 text-red-300">Conflicts: {preview.conflicts.join('; ')}. Resolve before restore.</p>}
      <button type="button" disabled={busy||preview.missing_count<=0||preview.conflict_count>0}
        onClick={()=>void restore()} className="mt-3 rounded-xl bg-amber-400 px-4 py-2 font-black text-neutral-950 disabled:opacity-40">
        Restore {preview.missing_count} Original Purchase Receipts (No Stock Change)
      </button>
    </div>}
    {slots.some(s=>s.error)&&<details className="mt-3 text-xs text-amber-400">
      <summary>Unavailable backup slots ({slots.filter(s=>s.error).length})</summary>
      {slots.filter(s=>s.error).map(s=><p key={s.slot}>Slot {s.slot}: {s.error}</p>)}
    </details>}
  </section>;
};
