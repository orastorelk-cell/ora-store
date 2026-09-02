const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA packing batch combine] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Adds a completely separate multi-batch print convenience panel.
 *
 * Safety rules:
 * - Existing per-batch download / repair buttons are not changed.
 * - Existing invoice locks, packing download status, batch IDs and set numbers are not changed.
 * - It only re-renders already-generated invoice snapshots into one A4 2xA5 PDF.
 */
export const packingBatchCombinePatch = () => ({
  name: 'ora-packing-batch-combine-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (code.includes('Combine Selected Batches → A4 2xA5')) return null;

    let text = code;

    const stateMarker = "  const [packingFilter, setPackingFilter] = useState<'pending'|'today'|'downloaded'|'all'>('pending');";
    const stateReplacement = stateMarker + "\n  const [packingCombineBatchIds, setPackingCombineBatchIds] = useState<string[]>([]);\n  const [packingCombineBusy, setPackingCombineBusy] = useState(false);";
    text = replaceRequired(text, stateMarker, stateReplacement, 'state');

    const derivedMarker = `        const pendingCount = allGroups.filter(([,os])=>!os.every(o=>Boolean(o.invoice_pack_downloaded_at))).length;

        return (`;

    const derivedReplacement = `        const pendingCount = allGroups.filter(([,os])=>!os.every(o=>Boolean(o.invoice_pack_downloaded_at))).length;

        // Separate print-only combiner. It never changes the original batches.
        const combineSelectedGroups = allGroups.filter(([batchId])=>packingCombineBatchIds.includes(batchId));
        const combineSelectedOrders = Array.from(new Map(
          combineSelectedGroups
            .flatMap(([,batchOrders])=>batchOrders)
            .map((order)=>[order.id,order] as [string,Order])
        ).values());
        const combineSelectedInvoicePages = combineSelectedOrders.reduce((sum,order)=>sum+getInvoicePageCount(order),0);
        const combineSelectedA4Sheets = Math.ceil(combineSelectedInvoicePages/2);
        const combineTooLarge = combineSelectedOrders.length > 200;

        const downloadCombinedBatchesA4TwoUp = async () => {
          if (packingCombineBatchIds.length < 2 || !combineSelectedOrders.length || packingCombineBusy || combineTooLarge) return;
          setPackingCombineBusy(true);
          try {
            const now=new Date();
            const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
            const fileName=`${date}_Combined-${packingCombineBatchIds.length}-Batches_${combineSelectedOrders.length}-Invoices_A4-2xA5.pdf`;
            await generateA4TwoUpA5InvoicesPDF(combineSelectedOrders,settings,fileName);
          } catch(e:any) {
            alert(e?.message || 'Combined batch PDF generation failed.');
          } finally {
            setPackingCombineBusy(false);
          }
        };

        return (`;

    text = replaceRequired(text, derivedMarker, derivedReplacement, 'derived combine data');

    const panelMarker = `            {grouped.length===0 ? (`;
    const panel = `            <div data-ora-view-allowed="true" className="rounded-2xl border border-cyan-500/30 bg-neutral-900 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300">Separate Print Tool</p>
                  <h3 className="mt-1 text-base font-black text-white">Combine Selected Batches → A4 2xA5</h3>
                  <p className="mt-1 max-w-3xl text-[11px] leading-5 text-neutral-400">
                    Select 2 or more existing batches and print all their invoice pages in one A4 2xA5 PDF. Original batch PDFs, Downloaded status, invoice locks and batch history stay unchanged.
                  </p>
                </div>
                <div className="shrink-0 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-right">
                  <p className="text-[9px] font-bold uppercase text-neutral-500">Selected</p>
                  <p className="mt-1 text-sm font-black text-white">{packingCombineBatchIds.length} batches • {combineSelectedOrders.length} invoices</p>
                  <p className="text-[10px] text-cyan-300">{combineSelectedInvoicePages} invoice page{combineSelectedInvoicePages===1?'':'s'} → {combineSelectedA4Sheets} A4 sheet{combineSelectedA4Sheets===1?'':'s'}</p>
                </div>
              </div>

              <div className="mt-4 grid max-h-52 grid-cols-1 gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
                {allGroups.map(([batchId,batchOrders])=>{
                  const selected=packingCombineBatchIds.includes(batchId);
                  const pages=batchOrders.reduce((sum,order)=>sum+getInvoicePageCount(order),0);
                  const isDownloaded=batchOrders.every(order=>Boolean(order.invoice_pack_downloaded_at));
                  return (
                    <label key={'combine-'+batchId} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${selected?'border-cyan-400/60 bg-cyan-500/10':'border-neutral-800 bg-neutral-950 hover:border-neutral-700'}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e)=>setPackingCombineBatchIds((prev)=>e.target.checked
                          ? Array.from(new Set([...prev,batchId]))
                          : prev.filter((id)=>id!==batchId)
                        )}
                        className="h-4 w-4 accent-cyan-500"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[10px] font-black text-white">{batchId}</p>
                        <p className="mt-0.5 text-[9px] text-neutral-500">{batchOrders.length} invoice{batchOrders.length===1?'':'s'} • {pages} page{pages===1?'':'s'} • {isDownloaded?'Downloaded':'Need Download'}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={packingCombineBatchIds.length < 2 || combineSelectedOrders.length===0 || combineTooLarge || packingCombineBusy}
                  onClick={downloadCombinedBatchesA4TwoUp}
                  className="rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Printer className="mr-1.5 inline h-4 w-4"/>
                  {packingCombineBusy ? 'Preparing Combined PDF…' : `Combine & Download (${combineSelectedA4Sheets} A4)`}
                </button>
                <button
                  type="button"
                  disabled={packingCombineBatchIds.length===0 || packingCombineBusy}
                  onClick={()=>setPackingCombineBatchIds([])}
                  className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-xs font-bold text-neutral-400 disabled:opacity-40"
                >
                  Clear Selection
                </button>
                {packingCombineBatchIds.length < 2 && <span className="text-[10px] text-neutral-500">Select at least 2 batches.</span>}
                {combineTooLarge && <span className="text-[10px] font-bold text-red-300">Maximum 200 invoices per combined PDF.</span>}
              </div>
            </div>

            {grouped.length===0 ? (`;

    text = replaceRequired(text, panelMarker, panel, 'separate combine panel');

    return { code: text, map: null };
  },
});
