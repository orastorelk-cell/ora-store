import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, RefreshCw, Settings2, Upload } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { invoiceRecoveryRequest } from '../../lib/invoiceRecovery';
import { SHEET_CONFIRM_API, sheetConfirmPhaseLabel } from '../../lib/sheetConfirmState';
import { invoiceComplete } from '../../lib/invoiceQueue';
import { StoreOnlyZip } from '../../lib/productFolderZip';

type Connection={connected:boolean;spreadsheet_id?:string;tabs?:string[];client_email?:string};
type Job={operation_id:string;batch_id:string;phase:string;created_at:string;updated_at:string;counts:Record<string,number>;errors:string[];warnings:string[];error?:string;invoices_ready:boolean;downloaded_at?:string};
const primary='inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white hover:bg-emerald-500 disabled:cursor-default disabled:opacity-50 sm:w-auto';
const field='mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-500';
const request=invoiceRecoveryRequest;

export const SheetConfirmUploadPanel=()=>{
  const {adminUser,refreshReturnInventory}=useStore();
  const [connection,setConnection]=useState<Connection|null>(null),[job,setJob]=useState<Job|null>(null),[history,setHistory]=useState<Job[]>([]);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [sheet,setSheet]=useState(''),[tabs,setTabs]=useState(''),[account,setAccount]=useState<any>(null);
  const running=useRef(false),refreshing=useRef(false),lastRefresh=useRef('');
  const pendingKey='ora_sheet_confirm_request:'+adminUser?.id;
  const editable=adminUser?.role==='admin'||!adminUser?.permissions?.includes('level:confirm_upload:view');
  const active=!!job&&!['complete','blocked','sheet_update_failed'].includes(job.phase);
  const retryable=!!job&&(!!job.error||['blocked','sheet_update_failed'].includes(job.phase));
  const accept=(next:Job|null)=>{
    setJob(next);
    if(next&&(next.invoices_ready||next.phase==='complete')){
      localStorage.removeItem(pendingKey);
      if(lastRefresh.current!==next.operation_id){lastRefresh.current=next.operation_id;void refreshReturnInventory().catch(()=>{});}
    }
  };
  const load=async()=>{
    if(refreshing.current)return;refreshing.current=true;
    try{const data=await request(SHEET_CONFIRM_API+'/jobs');accept(data.job);if(Array.isArray(data.history))setHistory(data.history);}
    finally{refreshing.current=false;}
  };
  useEffect(()=>{
    let live=true;
    request(SHEET_CONFIRM_API+'/connection').then(data=>{
      if(!live)return;
      setConnection(data.connection);
      if(data.connection?.connected){setSheet(data.connection.spreadsheet_id);setTabs(data.connection.tabs.join('\n'));}
    }).catch(failure=>{if(live)setError(failure.message||'Sheet connection could not be checked.');});
    request(SHEET_CONFIRM_API+'/jobs').then(data=>{if(live){accept(data.job);if(Array.isArray(data.history))setHistory(data.history);}}).catch(failure=>{if(live)setError(failure.message||'Saved Sheet imports could not be checked.');});
    return()=>{live=false;};
  },[adminUser?.id]);
  useEffect(()=>{
    if(!active)return;
    const poll=()=>{if(document.visibilityState==='visible')void load().catch(()=>setMessage('The server is continuing the saved import. Status will refresh when the connection returns.'));};
    const timer=window.setInterval(poll,6000);window.addEventListener('focus',poll);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',poll);};
  },[active,job?.operation_id]);

  const connect=async()=>{
    if(running.current)return;running.current=true;setBusy('Connecting Sheet…');setError('');setMessage('');
    try{
      const selected=tabs.split(/[\r\n,]+/).map(value=>value.trim()).filter(Boolean);
      const data=await request(SHEET_CONFIRM_API+'/connection',{spreadsheet_id:sheet,tabs:selected,...(account?{service_account:account}:{})});
      setConnection(data.connection);setSheet(data.connection.spreadsheet_id);setTabs(data.connection.tabs.join('\n'));setAccount(null);
      setMessage('Google Sheet connected. Apps Script එක වෙනස් කරන්න ඕන නැහැ. දැන් Auto Upload button එක භාවිත කරන්න පුළුවන්.');
    }catch(failure:any){setError(failure.message||'The Google Sheet could not be connected.');}
    finally{running.current=false;setBusy('');}
  };
  const chooseKey=async(file?:File)=>{
    if(!file)return;
    try{
      if(file.size>30000)throw new Error('Choose the service account JSON key file.');
      const value=JSON.parse(await file.text());
      if(value.type!=='service_account'||!value.client_email||!value.private_key)throw new Error('This is not a Google service account JSON key.');
      setAccount(value);setError('');
    }catch(failure:any){setAccount(null);setError(failure.message||'The key file could not be read.');}
  };
  const start=async()=>{
    if(running.current||!connection?.connected)return;running.current=true;setBusy(retryable?'Resuming saved import…':'Starting Sheet import…');setError('');setMessage('');
    try{
      let data;
      if(retryable)data=await request(SHEET_CONFIRM_API+'/jobs/'+job!.operation_id+'/retry',{});
      else{
        let id=localStorage.getItem(pendingKey);
        if(!id||!/^[A-Za-z0-9_-]{16,100}$/.test(id))id=crypto.randomUUID();
        localStorage.setItem(pendingKey,id);
        data=await request(SHEET_CONFIRM_API+'/jobs',{operation_id:id});
      }
      accept(data.job);setMessage('Server එක වැඩේ භාරගත්තා. මේ page එක වසා දැම්මත් saved import එක ඉදිරියට යනවා.');
      await refreshReturnInventory().catch(()=>{});
    }catch(failure:any){setError((failure.message||'The import could not start.')+' Saved work is kept. Check status or retry the same import.');}
    finally{running.current=false;setBusy('');}
  };
  const download=async(id:string)=>{
    if(running.current)return;running.current=true;setBusy('Preparing one invoice PDF…');setError('');
    try{
      const data=await request(SHEET_CONFIRM_API+'/jobs/'+id+'/files');
      if(data.operation_id!==id||!Array.isArray(data.orders)||!data.orders.length||data.orders.some((order:any)=>!invoiceComplete(order)||order.invoice_pack_batch_id!==data.batch_id))throw new Error('The complete saved invoice batch could not be verified.');
      // Keep the browser PDF/image renderer out of the normal dashboard bundle.
      const [{buildReturnPackingInvoiceBlob},{returnPackingCsv,downloadReturnBlob}]=await Promise.all([import('../../lib/pdfGenerator'),import('../../lib/returnExports')]);
      const pdf=await buildReturnPackingInvoiceBlob(data.orders,data.settings,1000),zip=new StoreOnlyZip();
      zip.addFile(data.batch_id+'_Invoices.pdf',new Uint8Array(await pdf.arrayBuffer()));
      zip.addText(data.batch_id+'_Fardar.csv',returnPackingCsv(data.orders,data.settings));
      const blob=zip.build();
      await request(SHEET_CONFIRM_API+'/jobs/'+id+'/downloaded',{});
      downloadReturnBlob(blob,data.batch_id+'.zip');
      setMessage(data.orders.length+' invoices downloaded together: one PDF + one Fardar CSV.');
      await load().catch(()=>{});await refreshReturnInventory().catch(()=>{});
    }catch(failure:any){setError(failure.message||'Saved invoice files could not be prepared. Retry this same batch.');}
    finally{running.current=false;setBusy('');}
  };
  const details=[job?.counts.stock?job.counts.stock+' waiting for stock':'',job?.counts.waybills?job.counts.waybills+' waiting for waybills':'',job?.counts.details?job.counts.details+' need order details':'',job?.counts.return_checks?job.counts.return_checks+' waiting for return checks':'',job?.counts.payment?job.counts.payment+' waiting for payment verification':''].filter(Boolean);
  return <section data-ora-action="confirm_upload" className="rounded-2xl border border-emerald-500/40 bg-neutral-900 p-4 space-y-4 sm:p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="flex items-center gap-2 text-sm font-black text-emerald-300"><FileSpreadsheet className="h-5 w-5 shrink-0"/>New Confirm Orders Auto Upload</h3><p className="mt-2 text-xs leading-5 text-neutral-300">Calls ඉවර වුණාම button එක ඔබන්න. Sheet එකේ Confirm / Cancel සියල්ල save කරලා ඉවර වුණාට පස්සේ stock තියෙන orders වලට එක invoice batch එකක් + එක Fardar CSV එකක් හැදෙනවා. Pending orders import වෙන්නේ නැහැ.</p></div>
      <button type="button" className={primary+' shrink-0'} disabled={!editable||!connection?.connected||!!busy||(active&&!retryable)} onClick={()=>void start()}><RefreshCw className={'h-4 w-4'+(active||busy?' animate-spin':'')}/>{busy||(retryable?'Retry saved Sheet import':active?'Import running…':'New Confirm Orders Auto Upload')}</button>
    </div>
    {connection?.connected&&<p className="flex items-center gap-2 text-[11px] text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0"/>Connected · {connection.tabs?.join(' / ')}</p>}
    {job&&<div className="rounded-xl border border-neutral-700 bg-neutral-950 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs font-black text-white">{sheetConfirmPhaseLabel(job.phase)}</p><button type="button" onClick={()=>void load().catch(failure=>setError(failure.message))} className="text-xs font-bold text-emerald-300">Refresh status</button></div>
      <div className="flex flex-wrap gap-2 text-[11px] font-bold">{[['Confirmed',job.counts.confirmed],['Cancelled',job.counts.cancelled],['Pending skipped',job.counts.pending],['Already processed',job.counts.already_processed],['Invoices ready',job.counts.invoices]].map(([label,value])=><span key={String(label)} className="rounded-lg bg-neutral-800 px-2.5 py-1.5 text-neutral-200">{label} {Number(value||0)}</span>)}</div>
      {!!details.length&&<p className="text-xs text-amber-300">{details.join(' · ')}</p>}
      {job.errors?.map((value,i)=><p key={i} role="alert" className="text-xs leading-5 text-amber-300">{value}</p>)}
      {job.error&&<p className="text-xs leading-5 text-amber-300">{job.error} Server එක saved තැනින් නැවත උත්සාහ කරනවා.</p>}
      {job.warnings?.map((value,i)=><p key={i} className="text-xs leading-5 text-amber-300">{value}</p>)}
      {job.invoices_ready&&job.counts.invoices>0&&<button type="button" className={primary} disabled={!!busy||!editable} onClick={()=>void download(job.operation_id)}><Download className="h-4 w-4"/>Download invoices + Fardar CSV ({job.counts.invoices})</button>}
      {job.phase==='complete'&&!job.counts.invoices&&<p className="text-xs text-neutral-300">Import finished. No additional orders are ready to invoice.</p>}
    </div>}
    {message&&<p role="status" className="text-xs leading-5 text-emerald-300">{message}</p>}
    {error&&<p role="alert" className="text-xs leading-5 text-amber-300">{error}</p>}
    {adminUser?.role==='admin'?<details open={connection?.connected===false} className="rounded-xl border border-neutral-700 p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-bold text-neutral-200"><Settings2 className="h-4 w-4"/>{connection?.connected?'Google Sheet connection':'Connect Google Sheet once'}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs leading-5 text-neutral-400">Apps Script update අවශ්‍ය නැහැ. <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noreferrer" className="text-emerald-300 underline">Google Sheets API enable</a> කරලා <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noreferrer" className="text-emerald-300 underline">service account</a> එකක් සාදා JSON key එකක් ලබාගන්න. ඒ account email එකට අදාළ Sheet එක Editor ලෙස share කරන්න.</p>
        <label className="block text-xs font-bold text-neutral-300">Google Sheet link<input className={field} value={sheet} onChange={e=>setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoComplete="off"/></label>
        <label className="block text-xs font-bold text-neutral-300">Order tab names · one per line<textarea className={field} rows={3} value={tabs} onChange={e=>setTabs(e.target.value)} placeholder={'Leave blank to detect CALL CENTER ORDERS, FACEBOOK ORDERS and TIKTOK ORDERS.'}/></label>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-700 p-3 text-xs font-bold text-neutral-200"><Upload className="h-4 w-4"/>{account?'Key file selected':'Choose service account JSON key'}<input type="file" accept=".json,application/json" className="hidden" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void chooseKey(file);}}/></label>
        {(account?.client_email||connection?.client_email)&&<p className="break-all text-xs leading-5 text-emerald-300">Share the Sheet as Editor with: {account?.client_email||connection?.client_email}</p>}
        <button type="button" className={primary} disabled={!!busy||!sheet||(!account&&!connection?.connected)||active} onClick={()=>void connect()}><CheckCircle2 className="h-4 w-4"/>{connection?.connected?'Check & save connection':'Connect Google Sheet'}</button>
      </div>
    </details>:connection?.connected===false&&<p className="text-xs leading-5 text-amber-300">Super Admin එක් වරක් Google Sheet connect කළාට පස්සේ Auto Upload භාවිත කරන්න පුළුවන්.</p>}
    {!!history.filter(batch=>batch.invoices_ready&&batch.counts.invoices>0&&batch.operation_id!==job?.operation_id).length&&<details><summary className="cursor-pointer text-xs font-bold text-neutral-300">Previous Auto Upload batches</summary><div className="mt-3 space-y-2">{history.filter(batch=>batch.invoices_ready&&batch.counts.invoices>0&&batch.operation_id!==job?.operation_id).map(batch=><div key={batch.operation_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-950 p-3"><span className="text-xs text-neutral-300">{batch.counts.invoices} invoices · {new Date(batch.created_at).toLocaleString('en-GB',{timeZone:'Asia/Colombo'})}</span><button type="button" className={primary} disabled={!!busy||!editable} onClick={()=>void download(batch.operation_id)}><Download className="h-4 w-4"/>Download batch</button></div>)}</div></details>}
  </section>;
};
