const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA paid upload] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Separate paid/advance Confirm CSV upload.
 *
 * Safety:
 * - Reuses the exact existing Confirm/Cancel CSV parser and validation flow.
 * - Normal COD Confirm Upload is untouched.
 * - Payment type is selected BEFORE upload.
 * - Full Payment => Bank Payment, Paid/Full, courier COD Rs. 0.
 * - 50% Advance => 50% recorded as received, invoice says 50% ADVANCE PAID,
 *   courier COD is only the remaining balance.
 * - Each paid/advance upload gets its own packing batch.
 */
export const fullPaymentConfirmUploadPatch = () => ({
  name: 'ora-paid-confirm-upload-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const asyncTypeOld = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string) => Promise<{ confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] }>;";
      const asyncTypeNew = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string, paymentMode?: 'normal' | 'full_paid' | 'advance_50') => Promise<{ confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] }>;";
      const syncTypeOld = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string) => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };";
      const syncTypeNew = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string, paymentMode?: 'normal' | 'full_paid' | 'advance_50') => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };";
      if (text.includes(asyncTypeOld)) text = text.replace(asyncTypeOld, asyncTypeNew);
      else if (text.includes(syncTypeOld)) text = text.replace(syncTypeOld, syncTypeNew);
      else if (!text.includes(asyncTypeNew) && !text.includes(syncTypeNew)) {
        throw new Error('[O-RA paid upload] StoreContext method type marker not found');
      }

      const asyncSignatureOld = "  const importConfirmedOrdersCsv = async (csvText: string, source?: OrderSource, packingBatchId?: string) => {";
      const asyncSignatureNew = "  const importConfirmedOrdersCsv = async (csvText: string, source?: OrderSource, packingBatchId?: string, paymentMode: 'normal' | 'full_paid' | 'advance_50' = 'normal') => {";
      const syncSignatureOld = "  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource, packingBatchId?: string) => {";
      const syncSignatureNew = "  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource, packingBatchId?: string, paymentMode: 'normal' | 'full_paid' | 'advance_50' = 'normal') => {";
      if (text.includes(asyncSignatureOld)) text = text.replace(asyncSignatureOld, asyncSignatureNew);
      else if (text.includes(syncSignatureOld)) text = text.replace(syncSignatureOld, syncSignatureNew);
      else if (!text.includes(asyncSignatureNew) && !text.includes(syncSignatureNew)) {
        throw new Error('[O-RA paid upload] importConfirmedOrdersCsv signature marker not found');
      }

      const confirmedUpdateMarker = "confirm_upload_batch_id:uploadPackingBatchId,invoice_confirm_snapshot:invoiceConfirmSnapshot,call_center_status:'Confirmed'";
      const confirmedUpdateWithPayment = "confirm_upload_batch_id:uploadPackingBatchId,invoice_confirm_snapshot:invoiceConfirmSnapshot,...(paymentMode==='full_paid'?{payment_method:'Bank Payment' as PaymentMethod,payment_status:'Paid' as const,payment_paid_type:'Full' as const,payment_received_amount:stableTotalAmount,payment_verification_status:'Approved' as const,payment_reviewed_at:now,payment_reviewed_by:'Full Payment Upload',is_advance_required:false,advance_amount:0,advance_confirmed:false,invoice_payment_label_snapshot:'FULLY PAID'}:paymentMode==='advance_50'?{payment_method:'COD' as PaymentMethod,payment_status:'Pending' as const,payment_paid_type:'Advance' as const,payment_received_amount:Math.round(stableTotalAmount*0.5),payment_verification_status:'Approved' as const,payment_reviewed_at:now,payment_reviewed_by:'50% Advance Upload',is_advance_required:true,advance_amount:Math.round(stableTotalAmount*0.5),advance_confirmed:true,invoice_payment_label_snapshot:'50% ADVANCE PAID'}:{}),call_center_status:'Confirmed'";
      text = replaceRequired(text, confirmedUpdateMarker, confirmedUpdateWithPayment, 'confirmed order payment update');
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      // adminDashboardUnifiedUploadPatch runs before this patch and keeps this marker.
      // Use it instead of a fragile state variable that may be rewritten/removed.
      const stateMarker = "  // Branding changes stay as a draft until the admin explicitly saves them.\n";
      if (!text.includes("const [paidUploadMode, setPaidUploadMode] = useState<'full_paid'|'advance_50'>")) {
        text = replaceRequired(
          text,
          stateMarker,
          "  const [paidUploadMode, setPaidUploadMode] = useState<'full_paid'|'advance_50'>('full_paid');\n\n" + stateMarker,
          'payment mode state',
        );
      }

      const sourceHandlerMarker = "  const handleSourceConfirmedCsvUpload = (file:File,source:'Facebook Ads'|'TikTok Ads') => {";
      if (!text.includes('const handlePaidConfirmedCsvUpload = async (file: File) =>')) {
        if (!text.includes(sourceHandlerMarker)) throw new Error('[O-RA paid upload] source confirm handler marker not found');
        const paidHandler = String.raw`  const handlePaidConfirmedCsvUpload = async (file: File) => {
    const isFull = paidUploadMode === 'full_paid';
    const warning = isFull
      ? 'FULL PAYMENT Upload: confirmed orders will be marked FULLY PAID and courier COD will be Rs. 0.'
      : '50% ADVANCE Upload: confirmed orders will record 50% paid and courier COD will be the remaining 50%.';
    if (!window.confirm(warning + '\n\nContinue with this CSV?')) return;
    try {
      const now = new Date();
      const prefix = isFull ? 'FULL-PAID-' : 'ADVANCE-50-';
      const paidBatchId = prefix +
        now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '-' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0') + '-' +
        String(now.getMilliseconds()).padStart(3, '0');
      const result = await importConfirmedOrdersCsv(await file.text(), undefined, paidBatchId, paidUploadMode);
      alert((isFull ? 'FULL PAYMENT' : '50% ADVANCE') + ' Confirm + Cancel Upload\n' +
        'Processed: ' + result.confirmedCount + '\n' +
        'Not Found: ' + result.notFoundCount + '\n' +
        'Ignored: ' + result.ignoredCount +
        (result.errors.length ? '\n\n' + result.errors.slice(0, 8).join('\n') : ''));
    } catch (error: any) {
      alert(error?.message || 'Paid / advance CSV upload failed.');
    }
  };

`;
        text = text.replace(sourceHandlerMarker, paidHandler + sourceHandlerMarker);
      }

      // Existing Fardar rule is COD total for COD orders and zero for non-COD.
      // Add only one special case: a confirmed 50% advance collects the balance.
      const fardarCodOld = "      const cod = o.payment_method === 'COD' ? Math.round(o.total_amount) : 0;";
      const fardarCodNew = "      const cod = o.payment_paid_type === 'Advance' && Number(o.payment_received_amount || 0) > 0 ? Math.max(0, Math.round(Number(o.total_amount || 0) - Number(o.payment_received_amount || 0))) : o.payment_method === 'COD' ? Math.round(o.total_amount) : 0;";
      if (text.includes(fardarCodOld)) text = text.replace(fardarCodOld, fardarCodNew);
      else if (!text.includes(fardarCodNew)) throw new Error('[O-RA paid upload] Fardar COD marker not found');

      if (!text.includes('PAID / ADVANCE ORDERS • SEPARATE UPLOAD')) {
        // Unified upload plugin turns Confirm Upload into an IIFE. Locate that exact
        // section first, then inject the panel only inside its returned page wrapper.
        const unifiedScopeMarker = "      {activeTab === 'confirm_upload' && (() => {";
        const legacyScopeMarker = "      {activeTab === 'confirm_upload' && (";
        let scopeStart = text.indexOf(unifiedScopeMarker);
        if (scopeStart < 0) scopeStart = text.indexOf(legacyScopeMarker);
        if (scopeStart < 0) throw new Error('[O-RA paid upload] Confirm Upload scope not found');

        const pageDivMarker = '<div className="space-y-6">';
        const pageDivAt = text.indexOf(pageDivMarker, scopeStart);
        if (pageDivAt < 0) throw new Error('[O-RA paid upload] Confirm Upload page wrapper not found');
        const insertAt = pageDivAt + pageDivMarker.length;

        const panel = `
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-50 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <WalletCards className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">PAID / ADVANCE ORDERS • SEPARATE UPLOAD</p>
                <h2 className="mt-1 text-base font-black text-gray-900">Paid Order Confirm Upload</h2>
                <p className="mt-1 text-xs leading-5 text-gray-600">Use the exact same completed Confirm / Cancel CSV. Choose the payment type first, then upload. Normal COD orders still use the normal upload section below.</p>
              </div>
            </div>

            <label className="block text-xs font-black text-gray-800">
              Payment Type
              <select value={paidUploadMode} onChange={e=>setPaidUploadMode(e.target.value as 'full_paid'|'advance_50')} className="mt-2 w-full rounded-xl border border-emerald-300 bg-white px-3 py-3 text-sm font-black text-gray-900 outline-none">
                <option value="full_paid">Full Payment — Courier COD Rs. 0</option>
                <option value="advance_50">50% Advance — Courier collects remaining 50%</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-200 bg-white p-2 text-center font-black text-emerald-700">{paidUploadMode==='full_paid'?'FULLY PAID':'50% PAID'}</div>
              <div className="rounded-xl border border-emerald-200 bg-white p-2 text-center font-black text-emerald-700">{paidUploadMode==='full_paid'?'Bank Payment':'Advance Paid'}</div>
              <div className="rounded-xl border border-emerald-200 bg-white p-2 text-center font-black text-emerald-700">Invoice: {paidUploadMode==='full_paid'?'FULLY PAID':'50% ADVANCE PAID'}</div>
              <div className="rounded-xl border border-emerald-200 bg-white p-2 text-center font-black text-emerald-700">Courier COD: {paidUploadMode==='full_paid'?'Rs. 0':'Remaining 50%'}</div>
            </div>

            <label className="block cursor-pointer rounded-xl bg-emerald-600 px-4 py-3 text-center text-xs font-black text-white">
              <Upload className="mr-1 inline h-4 w-4"/> Upload Paid / Advance Confirm + Cancel CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value='';if(file)void handlePaidConfirmedCsvUpload(file);}}/>
            </label>
            <p className="text-[10px] leading-4 text-gray-500">Same CSV template. This upload creates its own paid/advance packing batch and does not alter the normal COD upload path.</p>
          </div>`;

        text = text.slice(0, insertAt) + panel + text.slice(insertAt);
      }
    }

    return text === code ? null : { code: text, map: null };
  },
});
