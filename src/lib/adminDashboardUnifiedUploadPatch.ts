export const adminDashboardUnifiedUploadPatch = () => ({
  name: 'ora-admin-unified-upload-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    const stateMarker = "  // Branding changes stay as a draft until the admin explicitly saves them.\n";
    if (!text.includes(stateMarker)) throw new Error('[O-RA UI patch] state marker not found');
    if (!text.includes('const [leadImportBatches, setLeadImportBatches]')) {
      const stateInsert = String.raw`  const [leadImportBatches, setLeadImportBatches] = useState<Record<'Facebook'|'TikTok', {
    orderNumbers: string[];
    uploaded: number;
    failed: number;
    ignored: number;
    errors: string[];
    at?: string;
  }>>({
    Facebook: { orderNumbers: [], uploaded: 0, failed: 0, ignored: 0, errors: [] },
    TikTok: { orderNumbers: [], uploaded: 0, failed: 0, ignored: 0, errors: [] },
  });
  const [unifiedConfirmBatch, setUnifiedConfirmBatch] = useState<{
    orderNumbers: string[];
    uploaded: number;
    failed: number;
    ignored: number;
    errors: string[];
    fileCount: number;
    at?: string;
  }>({ orderNumbers: [], uploaded: 0, failed: 0, ignored: 0, errors: [], fileCount: 0 });

`;
      text = text.replace(stateMarker, stateInsert + stateMarker);
    }

    const directStartMarker = "  const handleDirectSourceUpload = (file: File, source: 'Facebook Ads' | 'TikTok Ads') => {";
    const directEndMarker = '  const csvEscape = (value: unknown) => {';
    const directStart = text.indexOf(directStartMarker);
    const directEnd = text.indexOf(directEndMarker, directStart);
    if (directStart < 0 || directEnd < 0) throw new Error('[O-RA UI patch] direct lead upload handler markers not found');
    let directChunk = text.slice(directStart, directEnd);
    if (directChunk.includes('setUploadBatches(prev => ({')) {
      directChunk = directChunk.replace('setUploadBatches(prev => ({', 'setLeadImportBatches(prev => ({');
      text = text.slice(0, directStart) + directChunk + text.slice(directEnd);
    }

    const templateMarker = "  const downloadWebsiteConfirmedTemplate = () => downloadDecisionTemplate('Website');\n";
    if (!text.includes('const downloadUnifiedDecisionTemplate')) {
      if (!text.includes(templateMarker)) throw new Error('[O-RA UI patch] template marker not found');
      const templateInsert = String.raw`  const downloadUnifiedDecisionTemplate = () => {
    const headers = [
      'Order ID','Customer Name','Phone Number','WhatsApp Number','Address','City','District',
      'Item Name','Main Code','Item Code','Variant / Color','Qty','Unit Price (Rs)','Line Total (Rs)',
      'Offer','Discount (Rs)','Normal Total (Rs)','Delivery Fee (Rs)','Final Total (Rs)',
      'Item Action','Order Action','Cancel Reason','Change Item To','Change Preview','Apply Item Change',
      'Source','Order Time','Lead ID','Imported Status','Last Sync',
      'Original Main Code','Original Variant / Color','Original Item Code','Original Item Name','Original Qty'
    ];
    const csv = headers.join(',') + '\n';
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ora_all_channels_confirm_cancel_sheet_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

`;
      text = text.replace(templateMarker, templateInsert + templateMarker);
    }

    const handlerMarker = "  const handleSourceTestLead = async (source:'Facebook Ads'|'TikTok Ads') => {\n";
    if (!text.includes('const handleUnifiedConfirmedCsvUpload')) {
      if (!text.includes(handlerMarker)) throw new Error('[O-RA UI patch] unified handler marker not found');
      const unifiedHandler = String.raw`  const handleUnifiedConfirmedCsvUpload = async (inputFiles: FileList | File[]) => {
    const files = Array.from(inputFiles || []);
    if (!files.length) return;
    const orderNumbers: string[] = [];
    const errors: string[] = [];
    let uploaded = 0;
    let failed = 0;
    let ignored = 0;

    for (const file of files) {
      try {
        const result = importConfirmedOrdersCsv(await file.text());
        uploaded += result.confirmedCount;
        failed += result.notFoundCount;
        ignored += result.ignoredCount;
        orderNumbers.push(...result.orderNumbers);
        errors.push(...result.errors.map((message) => file.name + ': ' + message));
      } catch (error:any) {
        failed += 1;
        errors.push(file.name + ': ' + (error?.message || 'Could not read/process this CSV.'));
      }
    }

    setUnifiedConfirmBatch({
      orderNumbers: Array.from(new Set(orderNumbers)),
      uploaded,
      failed,
      ignored,
      errors,
      fileCount: files.length,
      at: new Date().toISOString(),
    });

    alert(
      'Confirm / Cancel Upload Complete\n\nFiles: ' + files.length +
      '\nProcessed: ' + uploaded +
      '\nNot Found: ' + failed +
      '\nPending / Ignored: ' + ignored +
      (errors.length ? '\n\n' + errors.slice(0,8).join('\n') : '')
    );
  };

`;
      text = text.replace(handlerMarker, unifiedHandler + handlerMarker);
    }

    const leadNextMarker = '          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-5 text-gray-600"><b>Next step:</b> Call Center works in Google Sheets.';
    if (!text.includes('Lead Import • Last Result')) {
      if (!text.includes(leadNextMarker)) throw new Error('[O-RA UI patch] lead result marker not found');
      const leadResults = String.raw`          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {(['Facebook','TikTok'] as const).map((source) => {
              const batch = leadImportBatches[source];
              if (!batch.at && batch.orderNumbers.length === 0 && batch.uploaded === 0 && batch.failed === 0) return null;
              return (
                <div key={source} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className={source === 'Facebook' ? 'text-xs font-black text-blue-700' : 'text-xs font-black text-fuchsia-700'}>{source} Lead Import • Last Result</p>
                      <p className="mt-1 text-[10px] text-gray-500">{batch.at ? new Date(batch.at).toLocaleString() : ''}</p>
                    </div>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-700">{batch.orderNumbers.length} new order(s)</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-emerald-50 p-2"><p className="text-[9px] font-bold text-gray-500">IMPORTED</p><p className="font-black text-emerald-700">{batch.uploaded}</p></div>
                    <div className="rounded-xl bg-amber-50 p-2"><p className="text-[9px] font-bold text-gray-500">ALREADY IN</p><p className="font-black text-amber-700">{batch.ignored}</p></div>
                    <div className="rounded-xl bg-red-50 p-2"><p className="text-[9px] font-bold text-gray-500">FAILED</p><p className="font-black text-red-700">{batch.failed}</p></div>
                  </div>
                  {batch.orderNumbers.length > 0 && <div className="mt-3 rounded-xl bg-gray-50 p-3 font-mono text-[10px] text-gray-700">{batch.orderNumbers.slice(0,15).join(' • ')}</div>}
                  {batch.errors.length > 0 && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">{batch.errors.slice(0,6).map((e,i)=><div key={i}>• {e}</div>)}</div>}
                </div>
              );
            })}
          </div>

`;
      text = text.replace(leadNextMarker, leadResults + leadNextMarker);
    }

    const confirmStartMarker = "      {activeTab === 'confirm_upload' && (";
    const confirmEndMarker = '      {/* TAB 5: GOOGLE SHEETS SYNC */}';
    const confirmStart = text.indexOf(confirmStartMarker);
    const confirmEnd = text.indexOf(confirmEndMarker, confirmStart);
    if (confirmStart < 0 || confirmEnd < 0) throw new Error('[O-RA UI patch] confirm section markers not found');

    const unifiedConfirmSection = String.raw`      {activeTab === 'confirm_upload' && (() => {
        const batchOrders = orders.filter(o => unifiedConfirmBatch.orderNumbers.includes(o.order_number));
        const waiting = batchOrders.filter(o => !o.stock_allocated && o.order_status !== 'Cancelled');
        const allocated = batchOrders.filter(o => o.stock_allocated && o.order_status !== 'Cancelled');
        const withWaybill = batchOrders.filter(o => Boolean(o.waybill_number));
        const packingReady = batchOrders.filter(o => Boolean(o.invoice_locked));
        const cancelled = batchOrders.filter(o => o.order_status === 'Cancelled');
        const webCount = batchOrders.filter(o => o.order_source === 'Website').length;
        const fbCount = batchOrders.filter(o => o.order_source === 'Facebook Ads').length;
        const tkCount = batchOrders.filter(o => o.order_source === 'TikTok Ads').length;

        return (
          <div className="space-y-6">
            <div className="rounded-3xl border border-orange-200 bg-white p-5 sm:p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-orange-100 p-3"><Upload className="h-6 w-6 text-orange-700" /></div>
                <div>
                  <h2 className="text-lg font-black text-gray-900">Confirm / Cancel Orders • ALL CHANNELS</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-600">Website + Facebook + TikTok decisions now use one upload point. WEB- / FB- / TK- Order ID tells O-RA which channel the row belongs to.</p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold leading-5 text-emerald-900">CONFIRM ORDER → FIFO stock allocation → available Waybill auto assignment → invoice automatically becomes Packing Ready when eligible. CANCEL ITEM / CANCEL ENTIRE ORDER keeps the existing protection rules.</div>
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm space-y-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-orange-600">ONE COMMON CSV</p>
                <h3 className="mt-1 text-base font-black text-gray-900">Template headers are exactly the same as the order Sheets</h3>
                <p className="mt-2 text-xs leading-5 text-gray-600">You can export a completed CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS tab as CSV and upload it directly. Or copy the complete Sheet rows into the common template. Full Sheet columns are accepted; O-RA reads only the fields needed for Confirm / Cancel / item changes.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <button type="button" onClick={downloadUnifiedDecisionTemplate} className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-xs font-black text-gray-800 hover:bg-gray-100"><Download className="mr-1 inline h-4 w-4"/> Download Sheet-Matching Common Template</button>
                <label className="block cursor-pointer rounded-xl bg-orange-500 px-4 py-3 text-center text-xs font-black text-black hover:bg-orange-400">
                  <Upload className="mr-1 inline h-4 w-4"/> Upload Confirm / Cancel CSV
                  <input type="file" multiple accept=".csv,text/csv" className="hidden" onChange={e=>{ const files=e.target.files; if(files?.length) void handleUnifiedConfirmedCsvUpload(files); e.currentTarget.value=''; }}/>
                </label>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] leading-5 text-blue-800"><b>One action:</b> upload one mixed WEB + FB + TK CSV, or select the three exported CSV files together in this same file picker. No separate channel upload boxes.</div>
            </div>

            {unifiedConfirmBatch.at && (
              <div className="rounded-3xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div><h3 className="text-sm font-black text-gray-900">Last Unified Upload Result</h3><p className="mt-1 text-[10px] text-gray-500">{new Date(unifiedConfirmBatch.at).toLocaleString()} • {unifiedConfirmBatch.fileCount} file(s)</p></div>
                  <div className="flex flex-wrap gap-2 text-[10px] font-black"><span className="rounded-lg bg-emerald-100 px-2.5 py-1.5 text-emerald-800">Processed {unifiedConfirmBatch.uploaded}</span><span className="rounded-lg bg-red-100 px-2.5 py-1.5 text-red-800">Not Found {unifiedConfirmBatch.failed}</span><span className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-amber-800">Pending / Ignored {unifiedConfirmBatch.ignored}</span></div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-9 text-center">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-[9px] font-bold text-gray-500">WEB</p><p className="font-black text-slate-900">{webCount}</p></div>
                  <div className="rounded-xl bg-blue-50 p-3"><p className="text-[9px] font-bold text-gray-500">FB</p><p className="font-black text-blue-800">{fbCount}</p></div>
                  <div className="rounded-xl bg-fuchsia-50 p-3"><p className="text-[9px] font-bold text-gray-500">TIKTOK</p><p className="font-black text-fuchsia-800">{tkCount}</p></div>
                  <div className="rounded-xl bg-amber-50 p-3"><p className="text-[9px] font-bold text-gray-500">WAIT STOCK</p><p className="font-black text-amber-800">{waiting.length}</p></div>
                  <div className="rounded-xl bg-cyan-50 p-3"><p className="text-[9px] font-bold text-gray-500">STOCK OK</p><p className="font-black text-cyan-800">{allocated.length}</p></div>
                  <div className="rounded-xl bg-violet-50 p-3"><p className="text-[9px] font-bold text-gray-500">WAYBILL</p><p className="font-black text-violet-800">{withWaybill.length}</p></div>
                  <div className="rounded-xl bg-green-50 p-3"><p className="text-[9px] font-bold text-gray-500">PACKING</p><p className="font-black text-green-800">{packingReady.length}</p></div>
                  <div className="rounded-xl bg-red-50 p-3"><p className="text-[9px] font-bold text-gray-500">CANCELLED</p><p className="font-black text-red-800">{cancelled.length}</p></div>
                  <div className="rounded-xl bg-gray-50 p-3"><p className="text-[9px] font-bold text-gray-500">TOTAL</p><p className="font-black text-gray-900">{batchOrders.length}</p></div>
                </div>

                {unifiedConfirmBatch.errors.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">{unifiedConfirmBatch.errors.slice(0,10).map((e,i)=><div key={i}>• {e}</div>)}</div>}

                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-[820px] text-left text-[10px] text-gray-700">
                    <thead className="bg-gray-50 uppercase text-gray-500"><tr><th className="p-2.5">Source</th><th className="p-2.5">Order ID</th><th className="p-2.5">Customer</th><th className="p-2.5">Status</th><th className="p-2.5">Stock</th><th className="p-2.5">Waybill</th><th className="p-2.5">Packing</th></tr></thead>
                    <tbody>{batchOrders.length === 0 ? <tr><td colSpan={7} className="p-5 text-center text-gray-400">No processed orders found in the current order list.</td></tr> : batchOrders.map(o=><tr key={o.id} className="border-t border-gray-100"><td className="p-2.5 font-bold">{o.order_source}</td><td className="p-2.5 font-mono font-black text-gray-900">{o.order_number}</td><td className="p-2.5">{o.customer_name}<div className="text-gray-400">{o.phone}</div></td><td className="p-2.5 font-bold">{o.order_status}</td><td className="p-2.5">{o.stock_allocated ? 'Allocated' : o.order_status === 'Cancelled' ? 'Cancelled' : 'Waiting'}</td><td className="p-2.5 font-mono">{o.waybill_number || 'Pending'}</td><td className="p-2.5">{o.invoice_locked ? 'Ready' : 'Waiting'}</td></tr>)}</tbody>
                  </table>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" disabled={withWaybill.length === 0} onClick={()=>downloadFardarUploadCsv(batchOrders)} className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-xs font-black text-violet-800 disabled:opacity-40"><Download className="mr-1 inline h-4 w-4"/> Fardar Upload CSV ({withWaybill.length})</button>
                  <button type="button" onClick={()=>setActiveTab('packing')} className="rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-black text-white"><Package className="mr-1 inline h-4 w-4"/> Open Packing Downloads</button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

`;

    text = text.slice(0, confirmStart) + unifiedConfirmSection + text.slice(confirmEnd);
    text = text.replace("{ id:'confirm_upload', label:'FINALIZE • Confirm / Cancel Upload', icon:Upload },", "{ id:'confirm_upload', label:'FINALIZE • All Confirm / Cancel Upload', icon:Upload },");

    return { code: text, map: null };
  },
});
