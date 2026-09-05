const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA full payment upload] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Adds a separate FULL PAYMENT upload path while reusing the exact existing
 * Confirm/Cancel CSV parser and validation flow.
 *
 * Normal COD confirm uploads are intentionally left unchanged.
 * Only orders confirmed through the dedicated full-payment input are marked:
 * - Bank Payment
 * - Paid / Full
 * - payment received = final order total
 * - invoice label snapshot = FULLY PAID
 *
 * Existing Fardar export already writes COD = 0 for every non-COD order, so no
 * courier/export logic is modified here.
 */
export const fullPaymentConfirmUploadPatch = () => ({
  name: 'ora-full-payment-confirm-upload-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const asyncTypeOld = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string) => Promise<{ confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] }>;";
      const asyncTypeNew = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string, paymentMode?: 'normal' | 'full_paid') => Promise<{ confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] }>;";
      const syncTypeOld = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string) => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };";
      const syncTypeNew = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string, paymentMode?: 'normal' | 'full_paid') => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };";
      if (text.includes(asyncTypeOld)) text = text.replace(asyncTypeOld, asyncTypeNew);
      else if (text.includes(syncTypeOld)) text = text.replace(syncTypeOld, syncTypeNew);
      else if (!text.includes(asyncTypeNew) && !text.includes(syncTypeNew)) {
        throw new Error('[O-RA full payment upload] StoreContext method type marker not found');
      }

      const asyncSignatureOld = "  const importConfirmedOrdersCsv = async (csvText: string, source?: OrderSource, packingBatchId?: string) => {";
      const asyncSignatureNew = "  const importConfirmedOrdersCsv = async (csvText: string, source?: OrderSource, packingBatchId?: string, paymentMode: 'normal' | 'full_paid' = 'normal') => {";
      const syncSignatureOld = "  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource, packingBatchId?: string) => {";
      const syncSignatureNew = "  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource, packingBatchId?: string, paymentMode: 'normal' | 'full_paid' = 'normal') => {";
      if (text.includes(asyncSignatureOld)) text = text.replace(asyncSignatureOld, asyncSignatureNew);
      else if (text.includes(syncSignatureOld)) text = text.replace(syncSignatureOld, syncSignatureNew);
      else if (!text.includes(asyncSignatureNew) && !text.includes(syncSignatureNew)) {
        throw new Error('[O-RA full payment upload] importConfirmedOrdersCsv signature marker not found');
      }

      const confirmedUpdateMarker = "confirm_upload_batch_id:uploadPackingBatchId,invoice_confirm_snapshot:invoiceConfirmSnapshot,call_center_status:'Confirmed'";
      const confirmedUpdateWithFullPayment = "confirm_upload_batch_id:uploadPackingBatchId,invoice_confirm_snapshot:invoiceConfirmSnapshot,...(paymentMode==='full_paid'?{payment_method:'Bank Payment' as PaymentMethod,payment_status:'Paid' as const,payment_paid_type:'Full' as const,payment_received_amount:stableTotalAmount,payment_verification_status:'Approved' as const,payment_reviewed_at:now,payment_reviewed_by:'Full Payment Upload',is_advance_required:false,advance_amount:0,advance_confirmed:false,invoice_payment_label_snapshot:'FULLY PAID'}:{}),call_center_status:'Confirmed'";
      text = replaceRequired(text, confirmedUpdateMarker, confirmedUpdateWithFullPayment, 'confirmed order payment update');
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const sourceHandlerMarker = "  const handleSourceConfirmedCsvUpload = (file:File,source:'Facebook Ads'|'TikTok Ads') => {";
      if (!text.includes('const handleFullPaymentConfirmedCsvUpload = async (file: File) =>')) {
        if (!text.includes(sourceHandlerMarker)) throw new Error('[O-RA full payment upload] source confirm handler marker not found');
        const fullPaymentHandler = String.raw`  const handleFullPaymentConfirmedCsvUpload = async (file: File) => {
    if (!window.confirm('FULL PAYMENT Upload: confirmed orders in this CSV will be marked Bank Payment + PAID, invoice will show FULLY PAID, and courier COD amount will be Rs. 0. Continue?')) return;
    try {
      const now = new Date();
      const fullPaymentBatchId = 'FULL-PAID-' +
        now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '-' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0') + '-' +
        String(now.getMilliseconds()).padStart(3, '0');
      const result = await importConfirmedOrdersCsv(await file.text(), undefined, fullPaymentBatchId, 'full_paid');
      alert('FULL PAYMENT Confirm + Cancel Upload\n' +
        'Processed: ' + result.confirmedCount + '\n' +
        'Not Found: ' + result.notFoundCount + '\n' +
        'Ignored: ' + result.ignoredCount +
        (result.errors.length ? '\n\n' + result.errors.slice(0, 8).join('\n') : ''));
    } catch (error: any) {
      alert(error?.message || 'Full Payment CSV upload failed.');
    }
  };

`;
        text = text.replace(sourceHandlerMarker, fullPaymentHandler + sourceHandlerMarker);
      }

      const confirmPageMarker = `      {activeTab === 'confirm_upload' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-5">`;
      if (!text.includes('FULL PAYMENT ORDERS • SEPARATE UPLOAD')) {
        if (!text.includes(confirmPageMarker)) throw new Error('[O-RA full payment upload] Confirm Upload page marker not found');
        const confirmPageWithFullPayment = `      {activeTab === 'confirm_upload' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <WalletCards className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">FULL PAYMENT ORDERS • SEPARATE UPLOAD</p>
                <h2 className="mt-1 text-base font-black text-white">Prepaid / Fully Paid Confirm Upload</h2>
                <p className="mt-1 text-xs leading-5 text-neutral-400">Use the exact same completed Confirm / Cancel CSV template. Upload only orders where the customer has already transferred the FULL final amount. Normal COD orders must continue through the normal upload boxes below.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-500/20 bg-neutral-950 p-2 text-center font-black text-emerald-300">Bank Payment</div>
              <div className="rounded-xl border border-emerald-500/20 bg-neutral-950 p-2 text-center font-black text-emerald-300">Status: PAID</div>
              <div className="rounded-xl border border-emerald-500/20 bg-neutral-950 p-2 text-center font-black text-emerald-300">Invoice: FULLY PAID</div>
              <div className="rounded-xl border border-emerald-500/20 bg-neutral-950 p-2 text-center font-black text-emerald-300">Courier COD: Rs. 0</div>
            </div>
            <label className="block cursor-pointer rounded-xl bg-emerald-500 px-4 py-3 text-center text-xs font-black text-neutral-950">
              <Upload className="mr-1 inline h-4 w-4"/> Upload FULL PAYMENT Confirm + Cancel CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value='';if(file)void handleFullPaymentConfirmedCsvUpload(file);}}/>
            </label>
            <p className="text-[10px] leading-4 text-neutral-500">Safety: this creates its own FULL-PAID packing batch. It does not change the normal COD upload path.</p>
          </div>

          <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-5">`;
        text = text.replace(confirmPageMarker, confirmPageWithFullPayment);
      }
    }

    return text === code ? null : { code: text, map: null };
  },
});
