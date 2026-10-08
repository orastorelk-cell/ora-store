import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { finishInvoiceRecovery, invoiceRecoveryPath, invoiceRecoveryRequest } from '../../lib/invoiceRecovery';
import { buildReturnPackingInvoiceBlob } from '../../lib/pdfGenerator';
import { downloadReturnBlob, returnPackingCsv } from '../../lib/returnExports';
import { StoreOnlyZip } from '../../lib/productFolderZip';

type Batch={operation_id:string;batch_id:string;created_at:string;count:number};
const button='inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50';
export const InvoiceDoubleCheck=()=>{
  const {adminUser,refreshReturnInventory}=useStore();
  const key='ora_invoice_double_check:'+adminUser?.id;
  const readPending=()=>{try{const ids=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(ids)?ids.filter((id:any)=>typeof id==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(id)):[];}catch{return [];}};
  const [pending,setPending]=useState<string[]>(readPending);
  const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [batches,setBatches]=useState<Batch[]>([]);
  const running=useRef(false);
  const savePending=(ids:string[])=>{if(ids.length)localStorage.setItem(key,JSON.stringify(ids));else localStorage.removeItem(key);setPending(ids);};
  const loadHistory=async()=>{const data=await invoiceRecoveryRequest(invoiceRecoveryPath);if(Array.isArray(data.batches))setBatches(data.batches);};
  useEffect(()=>{let active=true;invoiceRecoveryRequest(invoiceRecoveryPath).then(data=>{if(active&&Array.isArray(data.batches))setBatches(data.batches);}).catch(()=>{});return()=>{active=false;};},[adminUser?.id]);

  const download=async(data:any[])=>{
    const zip=new StoreOnlyZip();let count=0;
    for(const batch of data){
      for(let offset=0;offset<batch.orders.length;offset+=50){
        setBusy('Preparing invoices '+(count+offset+1)+'…');
        const pdf=await buildReturnPackingInvoiceBlob(batch.orders.slice(offset,offset+50),batch.settings);
        zip.addFile(batch.batch_id+'_Invoices_'+(Math.floor(offset/50)+1)+'.pdf',new Uint8Array(await pdf.arrayBuffer()));
      }
      if(batch.orders.length)zip.addText(batch.batch_id+'_Fardar.csv',returnPackingCsv(batch.orders,batch.settings));
      count+=batch.orders.length;
    }
    if(!count)return 0;
    const blob=zip.build();
    for(const batch of data.filter(batch=>batch.orders.length))await invoiceRecoveryRequest(invoiceRecoveryPath+'/'+batch.operation_id+'/downloaded',{});
    downloadReturnBlob(blob,'O-RA_Double_Check_'+data[0].operation_id+'.zip');return count;
  };
  const check=async()=>{
    if(running.current)return;running.current=true;setError('');setMessage('');setBusy('Checking saved orders…');
    let ids=readPending();
    try{
      if(!ids.length){ids=[crypto.randomUUID()];savePending(ids);}
      const results:any[]=[];
      for(let at=0;at<ids.length;at++){
        setBusy('Checking missing invoices · batch '+(at+1)+'…');
        const data=await finishInvoiceRecovery(ids[at]);results.push(data);
        if(at===ids.length-1&&data.skipped.limit>0){ids=[...ids,crypto.randomUUID()];savePending(ids);}
      }
      const count=await download(results),last=results.at(-1),skipped=last?.skipped||{};
      savePending([]);
      const waiting=[skipped.stock?skipped.stock+' waiting for stock':'',skipped.waybills?skipped.waybills+' waiting for waybills':'',skipped.details?skipped.details+' need order details':'',skipped.return_checks?skipped.return_checks+' waiting for return checks':''].filter(Boolean);
      setMessage((count?count+' missing invoices recovered. Invoices and Fardar CSVs are together in the downloaded ZIP.':'Double Check finished. No additional invoices are ready.')+(waiting.length?' '+waiting.join(' · ')+'.':''));
      // Downloaded batches remain available even if the subsequent catalog refresh
      // fails. Do not discard their durable export acknowledgment.
      await refreshReturnInventory().catch(()=>setError('Files are ready. The orders list is still refreshing automatically.'));
      await loadHistory().catch(()=>{});
    }catch(failure:any){
      if(/start a new packing operation/i.test(failure.message)){savePending(ids.slice(0,-1));}
      setError((failure.message||'The check could not finish.')+' Your saved work is kept. Press '+(readPending().length?'Resume Double Check':'Double Check')+' to continue.');
    }finally{running.current=false;setBusy('');}
  };
  const redownload=async(id:string)=>{
    if(running.current)return;running.current=true;setBusy('Preparing saved invoices…');setError('');
    try{const data=await invoiceRecoveryRequest(invoiceRecoveryPath+'/'+id);await download([data]);setMessage('Saved invoices and their Fardar CSV downloaded again.');}
    catch(failure:any){setError(failure.message||'Saved files could not be downloaded.');}
    finally{running.current=false;setBusy('');}
  };
  return <div data-ora-action="confirm_upload" className="rounded-2xl border border-emerald-500/30 bg-neutral-900 p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-black text-emerald-300"><ShieldCheck className="h-4 w-4"/>Missing invoice check</h3><p className="mt-1 text-xs text-neutral-400">Recheck saved confirmed orders and create missing invoices + Fardar CSVs.</p></div><button type="button" className={button} disabled={!!busy} onClick={()=>void check()}><RefreshCw className={'h-4 w-4'+(busy?' animate-spin':'')}/>{busy|| (pending.length?'Resume Double Check':'Double Check')}</button></div>
    {message&&<p role="status" className="text-xs leading-5 text-emerald-300">{message}</p>}
    {error&&<p role="alert" className="text-xs leading-5 text-amber-300">{error}</p>}
    {!!batches.length&&<details><summary className="cursor-pointer text-xs font-bold text-neutral-300">Previous Double Check downloads</summary><div className="mt-2 space-y-2">{batches.map(batch=><div key={batch.operation_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-950 p-3"><span className="text-xs text-neutral-400">{batch.count} invoices · {new Date(batch.created_at).toLocaleString('en-GB',{timeZone:'Asia/Colombo'})}</span><button type="button" className={button} disabled={!!busy} onClick={()=>void redownload(batch.operation_id)}><Download className="h-4 w-4"/>Download again</button></div>)}</div></details>}
  </div>;
};
