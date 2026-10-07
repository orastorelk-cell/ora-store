const replace = (text:string,from:string,to:string,label:string) => {
  if(!text.includes(from))throw new Error('[O-RA durable invoices] '+label+' marker not found');
  return text.replace(from,to);
};

// Apply after the business-rule patches: their batching and invoice amounts
// stay intact, while invoice acknowledgments come from the current R2 snapshot.
export const invoiceDurabilityPatch = () => ({
  name:'ora-invoice-durability-patch',enforce:'pre' as const,
  transform(code:string,rawId:string){
    const id=rawId.split('?')[0].replace(/\\/g,'/');let text=code;
    if(id.endsWith('/src/context/StoreContext.tsx')){
      text="import { invoiceComplete, invoiceReady, saveInvoiceQueue } from '../lib/invoiceQueue';\n"+text;
      text=replace(text,'  markInvoicesGenerated: (orderIds: string[], generatedBy?: string) => Order[];',
        '  markInvoicesGenerated: (orderIds: string[], generatedBy?: string) => Promise<Order[]>;','async interface');
      text=replace(text,'  const autoInvoiceReadyRef = useRef<Set<string>>(new Set());',String.raw`  const autoInvoiceReadyRef = useRef<Set<string>>(new Set());
  const [invoiceQueueRetry,setInvoiceQueueRetry] = useState(0);
  const invoiceQueueRetryTimerRef = useRef<number|null>(null);
  useEffect(()=>()=>{if(invoiceQueueRetryTimerRef.current!==null)window.clearTimeout(invoiceQueueRetryTimerRef.current);},[]);`,'retry state');
      const start=text.indexOf('  // AUTO INVOICE QUEUE:'),end=text.indexOf('  const updateOrderStatus',start);
      if(start<0||end<0)throw new Error('[O-RA durable invoices] auto queue not found');
      text=text.slice(0,start)+String.raw`  // AUTO INVOICE QUEUE: publish only invoices acknowledged by durable R2.
  useEffect(()=>{
    if(!adminUser||!sharedStoreReady||!getStaffSessionToken()||returnPackingPending)return;
    const ready=orders.filter(o=>invoiceReady(o)&&!invoiceComplete(o)&&!autoInvoiceReadyRef.current.has(o.id))
      .sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()).slice(0,50);
    if(!ready.length)return;
    ready.forEach(o=>autoInvoiceReadyRef.current.add(o.id));
    const batchId='PACK-AUTO-'+new Date().toISOString().replace(/[^0-9]/g,'');
    const retry=()=>{if(getStaffSessionToken()&&invoiceQueueRetryTimerRef.current===null){
      invoiceQueueRetryTimerRef.current=window.setTimeout(()=>{invoiceQueueRetryTimerRef.current=null;setInvoiceQueueRetry(n=>n+1);},15000);
    }};
    void saveInvoiceQueue(ready.map(o=>o.id),batchId,sharedStaffRequest,true).then(result=>{
      const saved=new Map(result.orders.map(o=>[String(o.id),o]));
      if(saved.size){
        setOrders(prev=>prev.map(o=>(saved.get(String(o.id)) as Order)||o));
        logActivity({action:'Auto Invoice Batch Ready',module:'Invoices',details:result.orders.length+' invoice(s) safely saved in R2'});
      }
      if(result.errors.length){console.warn('Invoice queue:',result.errors.join(' | '));void refreshOrdersFromServer().catch(()=>{});retry();}
    }).catch(error=>{console.warn('Invoice save did not finish; no invoice was marked Generated:',error?.message||error);retry();})
      .finally(()=>ready.forEach(o=>autoInvoiceReadyRef.current.delete(o.id)));
  },[orders,adminUser?.id,sharedStoreReady,invoiceQueueRetry,returnPackingPending]);


`+text.slice(end);
      const manualStart=text.indexOf('  const markInvoicesGenerated ='),manualEnd=text.indexOf('  const markInvoiceBatchDownloaded',manualStart);
      if(manualStart<0||manualEnd<0)throw new Error('[O-RA durable invoices] manual generation not found');
      text=text.slice(0,manualStart)+String.raw`  const markInvoicesGenerated = async(orderIds:string[],generatedBy=adminUser?.name||'Admin'):Promise<Order[]> => {
    const ids=[...new Set(orderIds.map(String))].slice(0,200);
    const selected=orders.filter(o=>ids.includes(String(o.id))&&invoiceReady(o)&&!invoiceComplete(o));
    if(!selected.length)return [];
    const batchId='PACK-'+new Date().toISOString().replace(/[^0-9]/g,'');
    const result=await saveInvoiceQueue(selected.map(o=>o.id),batchId,sharedStaffRequest);
    const saved=new Map(result.orders.map(o=>[String(o.id),o]));
    if(saved.size)setOrders(prev=>prev.map(o=>(saved.get(String(o.id)) as Order)||o));
    if(result.errors.length)throw new Error(result.errors.join('\n'));
    result.orders.forEach(o=>logActivity({action:'Invoice Generated & Locked',module:'Invoices',target_id:o.id,target_label:o.order_number,details:o.waybill_number}));
    return result.orders as Order[];
  };

`+text.slice(manualEnd);
    }else if(id.endsWith('/src/components/admin/AdminDashboard.tsx')){
      text="import { invoiceComplete, invoiceReady } from '../../lib/invoiceQueue';\nimport { utf8CsvBlob, fardarParcelDescription } from '../../lib/csv';\n"+text;
      text=replace(text,'  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);',String.raw`  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [missingInvoiceSaveBusy,setMissingInvoiceSaveBusy] = useState(false);
  const pendingInvoiceSaves=orders.filter(order=>invoiceReady(order)&&!invoiceComplete(order));
  const pendingInvoiceSavePanel=pendingInvoiceSaves.length>0 ? (
    <div data-ora-view-allowed="true" className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-5">
      <p className="text-sm font-black text-amber-300">Invoices waiting to save: {pendingInvoiceSaves.length}</p>
      <p className="mt-2 text-xs text-neutral-300">Stock and waybills are ready. These invoices will appear here after their save succeeds.</p>
      <p className="mt-2 font-mono text-xs text-amber-200">{pendingInvoiceSaves.map(order=>order.order_number).join(', ')}</p>
      <button type="button" disabled={missingInvoiceSaveBusy} onClick={async()=>{
        setMissingInvoiceSaveBusy(true);
        try{await markInvoicesGenerated(pendingInvoiceSaves.map(order=>order.id));}
        catch(error:any){alert(error?.message||'Invoice save did not finish. Please retry.');}
        finally{setMissingInvoiceSaveBusy(false);}
      }} className="mt-3 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-neutral-950 disabled:opacity-40">
        {missingInvoiceSaveBusy?'Saving invoices…':'Retry Missing Invoices'}
      </button>
    </div>
  ) : null;`,'visible missing invoice recovery');
      const oldEligible=String.raw`    const eligible = selectedOrders.filter(o =>
      o.call_center_status === 'Confirmed' &&
      o.stock_allocated &&
      Boolean(o.waybill_number) &&
      o.order_status !== 'Cancelled'
    );`;
      text=replace(text,oldEligible,String.raw`    const awaiting=selectedOrders.filter(o=>invoiceReady(o)&&!invoiceComplete(o));
    if(awaiting.length){alert('Invoices are still waiting to save: '+awaiting.map(o=>o.order_number).join(', ')+'. Open Packing Downloads and use Retry Missing Invoices.');return;}
    const eligible = selectedOrders.filter(o => invoiceReady(o) && invoiceComplete(o));`,'Fardar invoice gate');
      text=replace(text,"      const desc = o.items.map(it => `${it.sku} ${it.product_name}${it.variant_name ? ` - ${it.variant_name}` : ''} x${it.quantity}`).join(' | ');",
        '      const desc = fardarParcelDescription(o.items);','parcel text');
      text=replace(text,"    const blob = new Blob([[header.join(','),...rows].join('\\n')],{type:'text/csv;charset=utf-8;'});",
        "    const blob = utf8CsvBlob([header.join(','),...rows].join('\\n'));",'UTF-8 download');
      text=replace(text,"          .filter(o => o.invoice_locked && o.invoice_pack_batch_id)","          .filter(o => invoiceComplete(o))",'packing selection');
      text=replace(text,'orders.filter((o)=>o.invoice_locked).length','orders.filter((o)=>invoiceComplete(o)).length','sidebar invoice count');
      text=replace(text,'orders.filter((o) => o.invoice_locked).length','orders.filter((o) => invoiceComplete(o)).length','invoice history count');
      text=replace(text,"orders.filter((o) => !o.invoice_locked && !o.is_duplicate_order && o.stock_allocated && Boolean(o.waybill_number) && o.order_status !== 'Cancelled')",
        'orders.filter((o) => invoiceReady(o) && !invoiceComplete(o))','manual ready selection');
      text=replace(text,"orders.filter((o) => o.stock_allocated && o.waybill_number && !o.invoice_locked && !o.is_duplicate_order && o.order_status !== 'Cancelled').length",
        'orders.filter((o) => invoiceReady(o) && !invoiceComplete(o)).length','ready count');
      text=replace(text,'const canGenerate = reasons.length === 0 && !o.invoice_locked;',
        'const canGenerate = reasons.length === 0 && invoiceReady(o) && !invoiceComplete(o);','invoice selection checkbox');
      text=replace(text,'<td className="p-3">{o.invoice_locked ? ',
        '<td className="p-3">{invoiceComplete(o) ? ','Generated display');
      const packingStart=text.indexOf("      {activeTab === 'packing' && (() => {");
      const packingContent=text.indexOf('<div className="space-y-4">',packingStart);
      if(packingStart<0||packingContent<0)throw new Error('[O-RA durable invoices] Packing view not found');
      const panelAt=packingContent+'<div className="space-y-4">'.length;
      text=text.slice(0,panelAt)+'\n            {pendingInvoiceSavePanel}'+text.slice(panelAt);
      text=replace(text,'        const packingReady = batchOrders.filter(o => Boolean(o.invoice_locked));',String.raw`        const packingReady = batchOrders.filter(o => invoiceComplete(o));
        const fardarBatchReady = batchOrders.filter(o => invoiceReady(o) && invoiceComplete(o) && o.dispatch_status!=='Handed Over' &&
          !(o.fardar_csv_exported_at && o.fardar_csv_exported_waybill && String(o.fardar_csv_exported_waybill)===String(o.waybill_number||'')));`,'unified invoice count');
      text=replace(text,'disabled={withWaybill.length === 0} onClick={()=>downloadFardarUploadCsv(batchOrders)}',
        'disabled={fardarBatchReady.length === 0} onClick={()=>downloadFardarUploadCsv(fardarBatchReady)}','unified CSV button');
      text=replace(text,'Fardar Upload CSV ({withWaybill.length})','Fardar Upload CSV ({fardarBatchReady.length})','unified CSV count');
      text=replace(text,'        const selectedDateReadyOrders = selectedDateOrders.filter(order =>',
        '        const selectedDateReadyOrders = selectedDateOrders.filter(order => invoiceReady(order) && invoiceComplete(order) &&','date CSV gate');
      text=replace(text,'                    const historyBatchReady = historyBatchOrders.filter(order =>',
        '                    const historyBatchReady = historyBatchOrders.filter(order => invoiceReady(order) && invoiceComplete(order) &&','history CSV gate');
      const oldManual=String.raw`                    const generated = markInvoicesGenerated(selectedInvoiceIds, adminUser?.name || 'Admin');
                    if (!generated.length) { alert('No eligible invoices. Stock must be allocated, waybill assigned, order must not be duplicate, and invoice must not already exist.'); return; }
                    try {`;
      const newManual=String.raw`                    try {
                      const generated = await markInvoicesGenerated(selectedInvoiceIds, adminUser?.name || 'Admin');
                      if (!generated.length) { alert('No eligible invoices. Stock must be allocated, waybill assigned, order must not be duplicate, and invoice must not already exist.'); return; }`;
      text=replace(text,oldManual,newManual,'manual acknowledgment');
      const oldReady=String.raw`                        const generated = markInvoicesGenerated(invoiceReady.map(o=>o.id));
                        if (!generated.length) { alert('No eligible invoices in this batch.'); return; }
                        await generateBatchInvoicesPDF(generated, settings);`;
      const newReady=String.raw`                        try {
                          const generated = await markInvoicesGenerated(invoiceReady.map(o=>o.id));
                          if (!generated.length) { alert('No eligible invoices in this batch.'); return; }
                          await generateBatchInvoicesPDF(generated, settings);
                        } catch(error:any) { alert(error?.message || 'Invoice save or PDF generation failed.'); }`;
      if(text.includes(oldReady))text=replace(text,oldReady,newReady,'ready batch acknowledgment');
    }else return null;
    return {code:text,map:null};
  },
});
