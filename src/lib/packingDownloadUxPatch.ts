export const packingDownloadUxPatch = () => ({
  name: 'ora-packing-download-ux-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    let text = code;

    const pdfImportOld = "import { generateOrderInvoicePDF, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';";
    const pdfImportNew = "import { generateOrderInvoicePDF, generateRepairedOrderInvoicePDF, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';";
    if (text.includes(pdfImportOld)) text = text.replace(pdfImportOld, pdfImportNew);
    else if (!text.includes(pdfImportNew)) throw new Error('[O-RA packing download UX] PDF import marker not found');

    const stateMarker = "  const [packingFilter, setPackingFilter] = useState<'pending'|'today'|'downloaded'|'all'>('pending');";
    if (!text.includes('const [packingDownloadBusy, setPackingDownloadBusy]')) {
      if (!text.includes(stateMarker)) throw new Error('[O-RA packing download UX] state marker not found');
      text = text.replace(stateMarker, stateMarker + "\n  const [packingDownloadBusy, setPackingDownloadBusy] = useState<string>('');\n  const [packingRepairBusy, setPackingRepairBusy] = useState<string>('');");
    } else if (!text.includes('const [packingRepairBusy, setPackingRepairBusy]')) {
      text = text.replace("  const [packingDownloadBusy, setPackingDownloadBusy] = useState<string>('');", "  const [packingDownloadBusy, setPackingDownloadBusy] = useState<string>('');\n  const [packingRepairBusy, setPackingRepairBusy] = useState<string>('');");
    }

    const allInsertMarker = "              const downloadSingleA6 = async () => {";
    if (!text.includes('const downloadAllA6 = async () =>')) {
      if (!text.includes(allInsertMarker)) throw new Error('[O-RA packing download UX] All A6 insertion marker not found');
      const allFn = String.raw`              const downloadAllA6 = async () => {
                if(!batchOrders.length || packingDownloadBusy) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                setPackingDownloadBusy('all');
                try {
                  const chunkSize=100;
                  const partCount=Math.ceil(batchOrders.length/chunkSize);
                  for(let part=0;part<partCount;part++){
                    const chunk=batchOrders.slice(part*chunkSize,(part+1)*chunkSize);
                    const suffix=partCount>1?('_Part-'+(part+1)+'-of-'+partCount):'';
                    await generateBatchInvoicesPDF(chunk,settings,stem+'_ALL-A6'+suffix+'.pdf');
                  }
                  await savePackingDownloaded(batchOrders,setDate,setNumber);
                } catch(e:any){ alert(e.message || 'All A6 invoice download failed. No batch status was changed unless every PDF completed.'); }
                finally { setPackingDownloadBusy(''); }
              };

`;
      text = text.replace(allInsertMarker, allFn + allInsertMarker);
    }

    const wrap = (name: string, oldBody: string, newBody: string) => {
      if (text.includes(newBody)) return;
      if (!text.includes(oldBody)) throw new Error(`[O-RA packing download UX] ${name} marker not found`);
      text = text.replace(oldBody, newBody);
    };

    wrap('A6',
`              const downloadSingleA6 = async () => {
                if(!singlePageOrders.length) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                try { await generateBatchInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A6-Singles.pdf\`); }
                catch(e:any){ alert(e.message || 'A6 invoice download failed.'); return; }
                await savePackingDownloaded(singlePageOrders,setDate,setNumber);
              };`,
`              const downloadSingleA6 = async () => {
                if(!singlePageOrders.length || packingDownloadBusy) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                setPackingDownloadBusy('a6');
                try {
                  await generateBatchInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A6-Singles.pdf\`);
                  await savePackingDownloaded(singlePageOrders,setDate,setNumber);
                } catch(e:any){ alert(e.message || 'A6 invoice download failed.'); }
                finally { setPackingDownloadBusy(''); }
              };`);

    wrap('A4',
`              const downloadSingleA4 = async () => {
                if(!singlePageOrders.length) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                try { await generateA4FourUpInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A4-4-Up.pdf\`); }
                catch(e:any){ alert(e.message || 'A4 4-up invoice download failed.'); return; }
                await savePackingDownloaded(singlePageOrders,setDate,setNumber);
              };`,
`              const downloadSingleA4 = async () => {
                if(!singlePageOrders.length || packingDownloadBusy) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                setPackingDownloadBusy('a4');
                try {
                  await generateA4FourUpInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A4-4-Up.pdf\`);
                  await savePackingDownloaded(singlePageOrders,setDate,setNumber);
                } catch(e:any){ alert(e.message || 'A4 4-up invoice download failed.'); }
                finally { setPackingDownloadBusy(''); }
              };`);

    const actionsMarker = `                    <div className="flex flex-wrap xl:justify-end gap-2">
                      {singlePageOrders.length>0 && <>`;
    if (!text.includes('Download ALL A6')) {
      if (!text.includes(actionsMarker)) throw new Error('[O-RA packing download UX] packing action marker not found');
      const actionsReplacement = `                    <div className="flex flex-wrap xl:justify-end gap-2">
                      <button data-ora-action="packing_download" type="button" disabled={Boolean(packingDownloadBusy)} onClick={downloadAllA6}
                        className={\`rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2 ${'${downloaded?\'bg-neutral-800 text-neutral-300\':\'bg-emerald-500 text-black\'}'}\`}>
                        <Download className="w-4 h-4"/>
                        {packingDownloadBusy==='all'?'Preparing ALL A6…':downloaded?'Download ALL A6 Again':\`Download ALL A6 (${'${batchOrders.length}'})\`}
                      </button>
                      {singlePageOrders.length>0 && <>`;
      text = text.replace(actionsMarker, actionsReplacement);
    }

    const a6Button = `{singleDownloaded?'A6 Singles Again':\`A6 Singles (${'${singlePageOrders.length}'})\`}`;
    if (text.includes(a6Button)) {
      text = text.replace(a6Button, `{packingDownloadBusy==='a6'?'Preparing PDF…':singleDownloaded?'A6 Singles Again':\`A6 Singles (${'${singlePageOrders.length}'})\`}`);
    }
    const a4Button = `{singleDownloaded?'A4 4-Up Again':\`A4 4-Up (${'${singlePageOrders.length}'})\`}`;
    if (text.includes(a4Button)) {
      text = text.replace(a4Button, `{packingDownloadBusy==='a4'?'Preparing PDF…':singleDownloaded?'A4 4-Up Again':\`A4 4-Up (${'${singlePageOrders.length}'})\`}`);
    }

    const headerOld = `<tr><th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Waybill</th><th className="p-3">Items</th><th className="p-3">Invoice Type</th><th className="p-3">Status</th></tr>`;
    const headerNew = `<tr><th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Waybill</th><th className="p-3">Items</th><th className="p-3">Invoice Type</th><th className="p-3">Status</th><th className="p-3">Repair</th></tr>`;
    if (text.includes(headerOld)) text = text.replace(headerOld, headerNew);

    const rowOld = `                            <td className="p-3">{o.invoice_pack_downloaded_at ? <span className="text-emerald-300">Downloaded</span> : <span className="text-orange-300">Pending</span>}</td>
                          </tr>)}`;
    if (!text.includes('generateRepairedOrderInvoicePDF(o,settings)')) {
      if (!text.includes(rowOld)) throw new Error('[O-RA packing download UX] repair row marker not found');
      const rowNew = `                            <td className="p-3">{o.invoice_pack_downloaded_at ? <span className="text-emerald-300">Downloaded</span> : <span className="text-orange-300">Pending</span>}</td>
                            <td className="p-3">
                              <button type="button" disabled={Boolean(packingRepairBusy)} onClick={async()=>{
                                setPackingRepairBusy(o.id);
                                try { await generateRepairedOrderInvoicePDF(o,settings); }
                                catch(e:any){ alert(e?.message || 'Invoice repair failed.'); }
                                finally { setPackingRepairBusy(''); }
                              }} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-black text-amber-300 disabled:opacity-50">
                                {packingRepairBusy===o.id?'Repairing…':'Repair Invoice'}
                              </button>
                            </td>
                          </tr>)}`;
      text = text.replace(rowOld, rowNew);
    }

    // Disable every packing-download action while one PDF is rendering. This gives
    // immediate visual feedback and prevents accidental double-generation.
    text = text.replace(/data-ora-action="packing_download" type="button" onClick=\{([^}]+)\}/g,
      'data-ora-action="packing_download" type="button" disabled={Boolean(packingDownloadBusy)} onClick={$1}');

    return text === code ? null : { code: text, map: null };
  },
});
