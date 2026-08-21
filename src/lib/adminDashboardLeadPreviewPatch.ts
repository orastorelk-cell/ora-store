export const adminDashboardLeadPreviewPatch = () => ({
  name: 'ora-admin-lead-preview-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;
    const stateMarker = "  // Branding changes stay as a draft until the admin explicitly saves them.\n";
    if (!text.includes(stateMarker)) throw new Error('[O-RA lead preview patch] state marker not found');

    if (!text.includes('const [leadCsvPreview, setLeadCsvPreview]')) {
      const stateInsert = String.raw`  const [leadCsvPreview, setLeadCsvPreview] = useState<Record<'Facebook'|'TikTok', {
    source: 'Facebook Ads'|'TikTok Ads';
    fileName: string;
    rows: any[];
    total: number;
    newCount: number;
    existingCount: number;
    duplicateInFile: number;
    invalidCount: number;
    errors: string[];
    sending: boolean;
    at?: string;
  }>>({
    Facebook: { source:'Facebook Ads', fileName:'', rows:[], total:0, newCount:0, existingCount:0, duplicateInFile:0, invalidCount:0, errors:[], sending:false },
    TikTok: { source:'TikTok Ads', fileName:'', rows:[], total:0, newCount:0, existingCount:0, duplicateInFile:0, invalidCount:0, errors:[], sending:false },
  });

`;
      text = text.replace(stateMarker, stateInsert + stateMarker);
    }

    const handlerStartMarker = "  const handleDirectSourceUpload = (file: File, source: 'Facebook Ads' | 'TikTok Ads') => {";
    const handlerEndMarker = '  const csvEscape = (value: unknown) => {';
    const handlerStart = text.indexOf(handlerStartMarker);
    const handlerEnd = text.indexOf(handlerEndMarker, handlerStart);
    if (handlerStart < 0 || handlerEnd < 0) throw new Error('[O-RA lead preview patch] direct upload handler markers not found');

    const newHandlers = String.raw`  const handleDirectSourceUpload = (file: File, source: 'Facebook Ads' | 'TikTok Ads') => {
    const selectedCode = String(selectedLeadItemCode || '').trim();
    if (!selectedCode) {
      alert('Select or type the Item Code before uploading the Lead CSV.');
      return;
    }
    const product = products.find(p => String(p.sku || '').trim().toUpperCase() === selectedCode.toUpperCase());
    if (!product) {
      alert('Item Code "' + selectedCode + '" was not found in the O-RA product catalog.');
      return;
    }

    const key = source === 'Facebook Ads' ? 'Facebook' : 'TikTok';
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseSourceCsvForDirectImport(String(reader.result || ''), source, selectedCode);
      if (!parsed.length) {
        alert('No lead rows found in the CSV.');
        return;
      }

      const existingLeadIds = new Set(
        orders
          .filter(o => o.order_source === source && String(o.platform_lead_id || '').trim())
          .map(o => String(o.platform_lead_id || '').trim().toLowerCase())
      );
      const seenFile = new Set<string>();
      const freshRows: any[] = [];
      const errors: string[] = [];
      let existingCount = 0;
      let duplicateInFile = 0;
      let invalidCount = 0;

      parsed.forEach((row:any, index:number) => {
        const leadId = String(row?.platform_lead_id || '').trim();
        const leadKey = leadId.toLowerCase();
        if (!leadId) {
          invalidCount++;
          errors.push('Row ' + (index + 2) + ': Lead ID missing');
          return;
        }
        if (!String(row?.customer_name || '').trim() || !String(row?.phone || '').trim()) {
          invalidCount++;
          errors.push('Row ' + (index + 2) + ': Customer Name / Phone missing');
          return;
        }
        if (seenFile.has(leadKey)) {
          duplicateInFile++;
          return;
        }
        seenFile.add(leadKey);
        if (existingLeadIds.has(leadKey)) {
          existingCount++;
          return;
        }
        freshRows.push(row);
      });

      setLeadCsvPreview(prev => ({
        ...prev,
        [key]: {
          source,
          fileName: file.name,
          rows: freshRows,
          total: parsed.length,
          newCount: freshRows.length,
          existingCount,
          duplicateInFile,
          invalidCount,
          errors,
          sending: false,
          at: new Date().toISOString(),
        },
      }));
    };
    reader.readAsText(file);
  };

  const handleSendLeadPreview = async (key: 'Facebook'|'TikTok') => {
    const preview = leadCsvPreview[key];
    if (!preview.rows.length || preview.sending) return;

    setLeadCsvPreview(prev => ({ ...prev, [key]: { ...prev[key], sending:true } }));
    try {
      // importBulkOrders performs the authoritative server-side source + Lead ID
      // dedupe again before saving/syncing, so another browser cannot create a
      // duplicate between Preview and Send.
      const result = await importBulkOrders(preview.rows);
      setLeadImportBatches(prev => ({
        ...prev,
        [key]: {
          orderNumbers: result.importedOrderNumbers,
          uploaded: result.importedCount,
          failed: result.failedCount,
          ignored: result.ignoredCount,
          errors: result.errors,
          at: new Date().toISOString(),
        },
      }));
      setLeadCsvPreview(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          rows: [],
          newCount: 0,
          existingCount: prev[key].existingCount + Number(result.ignoredCount || 0),
          sending: false,
        },
      }));
      alert(
        key + ' Lead Send Complete\n\n' +
        'Sent new orders: ' + result.importedCount + '\n' +
        'Already imported / skipped: ' + result.ignoredCount + '\n' +
        'Failed: ' + result.failedCount +
        (result.errors.length ? '\n\n' + result.errors.slice(0,8).join('\n') : '')
      );
    } catch (error:any) {
      setLeadCsvPreview(prev => ({ ...prev, [key]: { ...prev[key], sending:false } }));
      alert(key + ' lead send failed.\n\n' + (error?.message || 'Unknown error'));
    }
  };

`;
    text = text.slice(0, handlerStart) + newHandlers + text.slice(handlerEnd);

    text = text.replace(
      'NEW LEADS ONLY → System creates FB-/TK- Order IDs → Google Sheet PENDING. Stock is not deducted here.',
      'UPLOAD CSV → Preview Total / New / Already Imported → SEND button → new FB-/TK- orders go to Google Sheet PENDING in one fast batch. Stock is not deducted here.'
    );

    const fbUpload = '<label className="block cursor-pointer rounded-xl bg-blue-600 px-3 py-3 text-center text-xs font-black text-white"><Upload className="mr-1 inline h-4 w-4"/> Upload Facebook LEAD CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>e.target.files?.[0]&&handleDirectSourceUpload(e.target.files[0],\'Facebook Ads\')}/></label>';
    if (!text.includes('Facebook CSV Preview')) {
      if (!text.includes(fbUpload)) throw new Error('[O-RA lead preview patch] Facebook upload marker not found');
      const fbPreview = String.raw`${fbUpload}
              {leadCsvPreview.Facebook.at && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-black text-blue-900">Facebook CSV Preview</p><span className="text-[9px] font-bold text-blue-700">{leadCsvPreview.Facebook.fileName}</span></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
                  <div className="rounded-xl bg-white p-2"><p className="text-[9px] font-bold text-gray-500">CSV TOTAL</p><p className="text-lg font-black text-gray-900">{leadCsvPreview.Facebook.total}</p></div>
                  <div className="rounded-xl bg-emerald-100 p-2"><p className="text-[9px] font-bold text-emerald-700">NEW</p><p className="text-lg font-black text-emerald-800">{leadCsvPreview.Facebook.newCount}</p></div>
                  <div className="rounded-xl bg-amber-100 p-2"><p className="text-[9px] font-bold text-amber-700">ALREADY IN</p><p className="text-lg font-black text-amber-800">{leadCsvPreview.Facebook.existingCount}</p></div>
                  <div className="rounded-xl bg-red-100 p-2"><p className="text-[9px] font-bold text-red-700">INVALID / FILE DUP</p><p className="text-lg font-black text-red-800">{leadCsvPreview.Facebook.invalidCount + leadCsvPreview.Facebook.duplicateInFile}</p></div>
                </div>
                <button type="button" disabled={leadCsvPreview.Facebook.sending || leadCsvPreview.Facebook.newCount < 1} onClick={()=>void handleSendLeadPreview('Facebook')} className="w-full rounded-xl bg-blue-700 px-3 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{leadCsvPreview.Facebook.sending ? 'Sending fast batch...' : 'Send ' + leadCsvPreview.Facebook.newCount + ' New Orders to Google Sheet'}</button>
                <p className="text-[9px] leading-4 text-blue-800">Nothing is sent to Google Sheet until this button is pressed. Duplicate protection is checked again on the server by Facebook + Lead ID.</p>
              </div>}`;
      text = text.replace(fbUpload, fbPreview);
    }

    const tkUpload = '<label className="block cursor-pointer rounded-xl bg-fuchsia-600 px-3 py-3 text-center text-xs font-black text-white"><Upload className="mr-1 inline h-4 w-4"/> Upload TikTok LEAD CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>e.target.files?.[0]&&handleDirectSourceUpload(e.target.files[0],\'TikTok Ads\')}/></label>';
    if (!text.includes('TikTok CSV Preview')) {
      if (!text.includes(tkUpload)) throw new Error('[O-RA lead preview patch] TikTok upload marker not found');
      const tkPreview = String.raw`${tkUpload}
              {leadCsvPreview.TikTok.at && <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-black text-fuchsia-900">TikTok CSV Preview</p><span className="text-[9px] font-bold text-fuchsia-700">{leadCsvPreview.TikTok.fileName}</span></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
                  <div className="rounded-xl bg-white p-2"><p className="text-[9px] font-bold text-gray-500">CSV TOTAL</p><p className="text-lg font-black text-gray-900">{leadCsvPreview.TikTok.total}</p></div>
                  <div className="rounded-xl bg-emerald-100 p-2"><p className="text-[9px] font-bold text-emerald-700">NEW</p><p className="text-lg font-black text-emerald-800">{leadCsvPreview.TikTok.newCount}</p></div>
                  <div className="rounded-xl bg-amber-100 p-2"><p className="text-[9px] font-bold text-amber-700">ALREADY IN</p><p className="text-lg font-black text-amber-800">{leadCsvPreview.TikTok.existingCount}</p></div>
                  <div className="rounded-xl bg-red-100 p-2"><p className="text-[9px] font-bold text-red-700">INVALID / FILE DUP</p><p className="text-lg font-black text-red-800">{leadCsvPreview.TikTok.invalidCount + leadCsvPreview.TikTok.duplicateInFile}</p></div>
                </div>
                <button type="button" disabled={leadCsvPreview.TikTok.sending || leadCsvPreview.TikTok.newCount < 1} onClick={()=>void handleSendLeadPreview('TikTok')} className="w-full rounded-xl bg-fuchsia-700 px-3 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{leadCsvPreview.TikTok.sending ? 'Sending fast batch...' : 'Send ' + leadCsvPreview.TikTok.newCount + ' New Orders to Google Sheet'}</button>
                <p className="text-[9px] leading-4 text-fuchsia-800">Nothing is sent to Google Sheet until this button is pressed. Duplicate protection is checked again on the server by TikTok + Lead ID.</p>
              </div>}`;
      text = text.replace(tkUpload, tkPreview);
    }

    return text === code ? null : { code: text, map: null };
  },
});
