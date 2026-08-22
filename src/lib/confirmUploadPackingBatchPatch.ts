export const confirmUploadPackingBatchPatch = () => ({
  name: 'ora-confirm-upload-packing-batch-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/types.ts')) {
      const typeMarker = "  invoice_pack_batch_id?: string;";
      if (!text.includes(typeMarker)) throw new Error('[O-RA packing batch] Order batch type marker not found');
      if (!text.includes('confirm_upload_batch_id?: string;')) {
        text = text.replace(
          typeMarker,
          "  /** Shared hidden batch seed from one Confirm/Cancel upload action. */\n  confirm_upload_batch_id?: string;\n" + typeMarker
        );
      }
    }

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const oldType = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource) => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };";
      const newType = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string) => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };";
      if (!text.includes(oldType)) throw new Error('[O-RA packing batch] StoreContext type marker not found');
      text = text.replace(oldType, newType);

      const oldSignature = "  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource) => {";
      const newSignature = "  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource, packingBatchId?: string) => {";
      if (!text.includes(oldSignature)) throw new Error('[O-RA packing batch] importConfirmedOrdersCsv signature not found');
      text = text.replace(oldSignature, newSignature);

      const nowMarker = "    const now=new Date().toISOString(); const updates=new Map<string,Partial<Order>>();";
      if (!text.includes(nowMarker)) throw new Error('[O-RA packing batch] confirm timestamp marker not found');
      text = text.replace(
        nowMarker,
        "    const now=new Date().toISOString(); const updates=new Map<string,Partial<Order>>();\n    const uploadPackingBatchId = String(packingBatchId || ('PACK-UPLOAD-' + now.replace(/[^0-9]/g,'').slice(0,14)));"
      );

      // Keep the upload group separate from invoice_pack_batch_id until the
      // order is actually invoice-ready. This preserves the existing Packing
      // sidebar counts and readiness rules.
      const confirmedMarker = "call_center_status:'Confirmed',order_status:'Processing',call_center_updated_at:now,stock_allocated:false";
      const confirmedReplacement = "call_center_status:'Confirmed',order_status:'Processing',call_center_updated_at:now,confirm_upload_batch_id:uploadPackingBatchId,stock_allocated:false";
      if (!text.includes(confirmedMarker)) throw new Error('[O-RA packing batch] confirmed order update marker not found');
      text = text.replace(confirmedMarker, confirmedReplacement);

      // Both the automatic invoice queue and the manual invoice-lock path must
      // respect the shared upload seed. A slower stock/waybill arrival can no
      // longer create a second PACK-AUTO set for the same upload.
      const invoiceBatchMarker = "invoice_pack_batch_id:o.invoice_pack_batch_id || batchId,";
      if (!text.includes(invoiceBatchMarker)) throw new Error('[O-RA packing batch] invoice batch assignment marker not found');
      text = text.split(invoiceBatchMarker).join("invoice_pack_batch_id:o.invoice_pack_batch_id || o.confirm_upload_batch_id || batchId,");
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      // The unified upload patch runs before this plugin. One picker action gets
      // one shared batch ID, even if multiple CSV files were selected together.
      const ignoredMarker = "    let ignored = 0;\n\n    for (const file of files) {";
      if (text.includes('const unifiedPackingBatchId =')) {
        // already transformed
      } else {
        if (!text.includes(ignoredMarker)) throw new Error('[O-RA packing batch] unified upload loop marker not found');
        const batchInsert = String.raw`    let ignored = 0;
    const packingNow = new Date();
    const unifiedPackingBatchId = 'PACK-UPLOAD-' +
      packingNow.getFullYear() +
      String(packingNow.getMonth() + 1).padStart(2, '0') +
      String(packingNow.getDate()).padStart(2, '0') + '-' +
      String(packingNow.getHours()).padStart(2, '0') +
      String(packingNow.getMinutes()).padStart(2, '0') +
      String(packingNow.getSeconds()).padStart(2, '0');

    for (const file of files) {`;
        text = text.replace(ignoredMarker, batchInsert);
      }

      const oldImport = "        const result = importConfirmedOrdersCsv(await file.text());";
      const newImport = "        const result = importConfirmedOrdersCsv(await file.text(), undefined, unifiedPackingBatchId);";
      if (text.includes(oldImport)) text = text.replace(oldImport, newImport);
      else if (!text.includes(newImport)) throw new Error('[O-RA packing batch] unified import call marker not found');

      // Legacy repair for batches already split by the old auto-invoice timing.
      // Orders confirmed by the same CSV share the exact call_center_updated_at,
      // so old PACK-AUTO groups can safely display/download as one upload set.
      const helperMarker = "  // Branding changes stay as a draft until the admin explicitly saves them.\n";
      if (!text.includes('const packingUploadGroupKey =')) {
        if (!text.includes(helperMarker)) throw new Error('[O-RA packing batch] helper insertion marker not found');
        const helper = String.raw`  const packingUploadGroupKey = (order: Order) => {
    const current = String(order.invoice_pack_batch_id || 'LEGACY');
    if (current.startsWith('PACK-UPLOAD-')) return current;
    if (current.startsWith('PACK-AUTO-') && order.call_center_updated_at) {
      const d = new Date(order.call_center_updated_at);
      if (!Number.isNaN(d.getTime())) {
        return 'PACK-UPLOAD-' +
          d.getFullYear() +
          String(d.getMonth() + 1).padStart(2, '0') +
          String(d.getDate()).padStart(2, '0') + '-' +
          String(d.getHours()).padStart(2, '0') +
          String(d.getMinutes()).padStart(2, '0') +
          String(d.getSeconds()).padStart(2, '0');
      }
    }
    return current;
  };

`;
        text = text.replace(helperMarker, helper + helperMarker);
      }

      const oldGroupLine = "          const id=o.invoice_pack_batch_id || 'LEGACY';";
      const newGroupLine = "          const id=packingUploadGroupKey(o);";
      if (text.includes(oldGroupLine)) text = text.replace(oldGroupLine, newGroupLine);
      else if (!text.includes(newGroupLine)) throw new Error('[O-RA packing batch] packing grouping marker not found');

      const oldSidebar = "map(o=>o.invoice_pack_batch_id)).size})`";
      const newSidebar = "map(o=>packingUploadGroupKey(o))).size})`";
      if (text.includes(oldSidebar)) text = text.replace(oldSidebar, newSidebar);
    }

    return text === code ? null : { code: text, map: null };
  },
});
