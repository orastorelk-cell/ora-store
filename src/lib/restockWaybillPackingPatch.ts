export const restockWaybillPackingPatch = () => ({
  name: 'ora-restock-waybill-packing-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      // An already generated invoice must never be queued again just because
      // its lock flag was lost in an older snapshot.
      const autoQueue = "        Boolean(o.waybill_number) &&\n        !o.invoice_locked";
      const safeAutoQueue = "        Boolean(o.waybill_number) &&\n        !o.invoice_locked &&\n        !o.invoice_generated_at &&\n        !o.invoice_number &&\n        !o.invoice_pack_downloaded_at";
      if (!text.includes(autoQueue)) throw new Error('[O-RA restock packing] auto invoice guard marker not found');
      text = text.replace(autoQueue, safeAutoQueue);

      const manualQueue = "      !o.invoice_locked &&\n      Boolean(o.waybill_number) &&";
      const safeManualQueue = "      !o.invoice_locked &&\n      !o.invoice_generated_at &&\n      !o.invoice_number &&\n      !o.invoice_pack_downloaded_at &&\n      Boolean(o.waybill_number) &&";
      if (!text.includes(manualQueue)) throw new Error('[O-RA restock packing] manual invoice guard marker not found');
      text = text.replace(manualQueue, safeManualQueue);

      const marker = "    if(allocatedIds.size){\n      setOrders(prev=>prev.map(o=>{\n        if(!allocatedIds.has(o.id)) return o;\n        const updated={...o,stock_allocated:true,stock_status:'Allocated' as const,stock_allocated_at:now,stock_allocated_by:'System FIFO Allocator'} as Order;";
      const replacement = "    if(allocatedIds.size){\n      // Reserve one durable packing batch for orders released by this restock.\n      // A waybill may arrive later; the invoice queue keeps this batch ID.\n      const restockBatchId='PACK-RESTOCK-'+now.replace(/[^0-9]/g,'').slice(0,17);\n      setOrders(prev=>prev.map(o=>{\n        if(!allocatedIds.has(o.id)) return o;\n        const wasWaiting=Boolean(o.stock_waiting_since) || (o.call_center_updated_at ? Date.now()-new Date(o.call_center_updated_at).getTime()>10*60*1000 : false);\n        const updated={...o,stock_allocated:true,stock_status:'Allocated' as const,stock_allocated_at:now,stock_allocated_by:'System FIFO Allocator',...(wasWaiting && !o.invoice_pack_batch_id ? {invoice_pack_batch_id:restockBatchId}: {})} as Order;";
      if (!text.includes(marker)) throw new Error('[O-RA restock packing] FIFO marker not found');
      text = text.replace(marker, replacement);
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const derived = "        const pendingCount = allGroups.filter(([,os])=>!os.every(o=>Boolean(o.invoice_pack_downloaded_at))).length;";
      const withWaiting = derived + `
        const awaitingWaybillGroups = Array.from(orders
          .filter(o => o.invoice_pack_batch_id?.startsWith('PACK-RESTOCK-') &&
            o.call_center_status === 'Confirmed' && o.stock_allocated &&
            o.order_status !== 'Cancelled' && !o.invoice_locked)
          .reduce((map,o) => {
            const batchId=o.invoice_pack_batch_id!;
            map.set(batchId,[...(map.get(batchId)||[]),o]);
            return map;
          },new Map<string,Order[]>()).entries());`;
      if (!text.includes(derived)) throw new Error('[O-RA restock packing] pending groups marker not found');
      text = text.replace(derived, withWaiting);

      const panelMarker = '            {grouped.length===0 ? (';
      const panel = `            {awaitingWaybillGroups.map(([batchId,pendingOrders]) => (
              <div key={'waiting-'+batchId} className="rounded-2xl border border-amber-500/30 bg-neutral-900 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-mono font-black text-amber-300">{batchId}</h3>
                    <p className="mt-1 text-xs text-neutral-300">{pendingOrders.length} restocked order(s) reserved for this new batch. {pendingOrders.filter(o=>!o.waybill_number).length} need a waybill before invoices and Fardar CSV can be generated.</p>
                    <p className="mt-1 text-[10px] text-neutral-500">{pendingOrders.map(o=>o.order_number).join(', ')}</p>
                  </div>
                  <button type="button" onClick={()=>setActiveTab('delivery')} className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-neutral-950">Import / Assign Waybills</button>
                </div>
              </div>
            ))}

            {grouped.length===0 && awaitingWaybillGroups.length===0 ? (`;
      if (!text.includes(panelMarker)) throw new Error('[O-RA restock packing] panel marker not found');
      text = text.replace(panelMarker, panel);

      const buttonMarker = '                <div key={batchId} className="rounded-2xl border border-neutral-800 bg-neutral-900 overflow-hidden">';
      const button = buttonMarker + `
                  {batchOrders.some(o => o.waybill_number && !o.fardar_csv_exported_at) && (
                    <div className="border-b border-violet-500/20 px-4 py-3 text-right">
                      <button type="button" onClick={()=>void downloadFardarUploadCsv(batchOrders,batchId)} className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-3.5 py-2.5 text-xs font-black text-violet-300">
                        <Download className="mr-1 h-4 w-4"/> Fardar Upload CSV
                      </button>
                    </div>
                  )}`;
      if (!text.includes(buttonMarker)) throw new Error('[O-RA restock packing] batch CSV marker not found');
      text = text.replace(buttonMarker, button);
    }
    return text === code ? null : { code: text, map: null };
  },
});
