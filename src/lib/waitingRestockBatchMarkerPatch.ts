export const waitingRestockBatchMarkerPatch = () => ({
  name: 'ora-waiting-restock-batch-marker-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/types.ts')) {
      const marker = "  stock_allocated_by?: string;";
      if (text.includes(marker) && !text.includes('stock_waiting_since?: string;')) {
        text = text.replace(marker, marker + "\n  /** Set only when FIFO actually found insufficient stock at least once. */\n  stock_waiting_since?: string;");
      }
      return text === code ? null : { code: text, map: null };
    }

    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;

    const allocatedMarker = "    const allocatedIds=new Set<string>();\n    const allocationLogs:StockHistory[]=[];";
    const allocatedWithWaiting = "    const allocatedIds=new Set<string>();\n    const newlyWaitingIds=new Set<string>();\n    const allocationLogs:StockHistory[]=[];";
    if (text.includes(allocatedMarker)) text = text.replace(allocatedMarker, allocatedWithWaiting);
    else if (!text.includes(allocatedWithWaiting)) throw new Error('[O-RA waiting restock] allocator set marker not found');

    const noStockMarker = "      if(!canAllocate) continue;";
    const noStockWithMarker = "      if(!canAllocate){ if(!order.stock_waiting_since) newlyWaitingIds.add(order.id); continue; }";
    if (text.includes(noStockMarker)) text = text.replace(noStockMarker, noStockWithMarker);
    else if (!text.includes(noStockWithMarker)) throw new Error('[O-RA waiting restock] insufficient-stock marker not found');

    const earlyReturn = "    if(!allocatedIds.size && !autoAssignments.size) return;";
    const waitingAwareReturn = "    if(!allocatedIds.size && !autoAssignments.size && !newlyWaitingIds.size) return;";
    if (text.includes(earlyReturn)) text = text.replace(earlyReturn, waitingAwareReturn);
    else if (!text.includes(waitingAwareReturn)) throw new Error('[O-RA waiting restock] allocator return marker not found');

    const updaterOld = `    setOrders(prev=>prev.map(o=>{
      const newlyAllocated=allocatedIds.has(o.id); const wb=autoAssignments.get(o.id);
      if(!newlyAllocated && !wb) return o;
      const updated={...o,
        ...(newlyAllocated?{stock_allocated:true,stock_status:'Allocated' as const,stock_allocated_at:now,stock_allocated_by:'System FIFO Allocator'}:{}),
        ...(wb?{waybill_number:wb.waybill_number,courier_name:wb.courier_name,shipment_mode:'manual' as const,delivery_status:'Waybill Assigned',tracking_status:'Ready for Packing'}:{})
      } as Order;`;
    const updaterNew = `    setOrders(prev=>prev.map(o=>{
      const newlyAllocated=allocatedIds.has(o.id); const wb=autoAssignments.get(o.id); const newlyWaiting=newlyWaitingIds.has(o.id);
      if(!newlyAllocated && !wb && !newlyWaiting) return o;
      const updated={...o,
        ...(newlyWaiting?{stock_waiting_since:o.stock_waiting_since || now}:{}),
        ...(newlyAllocated?{stock_allocated:true,stock_status:'Allocated' as const,stock_allocated_at:now,stock_allocated_by:'System FIFO Allocator'}:{}),
        ...(wb?{waybill_number:wb.waybill_number,courier_name:wb.courier_name,shipment_mode:'manual' as const,delivery_status:'Waybill Assigned',tracking_status:'Ready for Packing'}:{})
      } as Order;`;
    if (text.includes(updaterOld)) text = text.replace(updaterOld, updaterNew);
    else if (!text.includes('const newlyWaiting=newlyWaitingIds.has(o.id);')) throw new Error('[O-RA waiting restock] allocator order update marker not found');

    const freshAuto = "      invoice_pack_batch_id:o.invoice_pack_batch_id || (o.confirm_upload_batch_id && o.stock_allocated_at && (o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at) && Math.abs(new Date(o.stock_allocated_at).getTime()-new Date(o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at || 0).getTime())<=10*60*1000 ? o.confirm_upload_batch_id : batchId),";
    const waitingSafeAuto = "      invoice_pack_batch_id:o.invoice_pack_batch_id || (o.confirm_upload_batch_id && !o.stock_waiting_since && o.stock_allocated_at && (o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at) && Math.abs(new Date(o.stock_allocated_at).getTime()-new Date(o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at || 0).getTime())<=10*60*1000 ? o.confirm_upload_batch_id : batchId),";
    if (text.includes(freshAuto)) text = text.replace(freshAuto, waitingSafeAuto);

    const freshManual = "      invoice_pack_batch_id: o.invoice_pack_batch_id || (o.confirm_upload_batch_id && o.stock_allocated_at && (o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at) && Math.abs(new Date(o.stock_allocated_at).getTime()-new Date(o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at || 0).getTime())<=10*60*1000 ? o.confirm_upload_batch_id : batchId),";
    const waitingSafeManual = "      invoice_pack_batch_id: o.invoice_pack_batch_id || (o.confirm_upload_batch_id && !o.stock_waiting_since && o.stock_allocated_at && (o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at) && Math.abs(new Date(o.stock_allocated_at).getTime()-new Date(o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at || 0).getTime())<=10*60*1000 ? o.confirm_upload_batch_id : batchId),";
    if (text.includes(freshManual)) text = text.replace(freshManual, waitingSafeManual);

    return text === code ? null : { code: text, map: null };
  },
});
