export const waybillAutoAssignmentServerGuardPatch = () => ({
  name: 'ora-waybill-auto-assignment-server-guard-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const from = "        settings.fardar_parcel_type || '',";
      const to = "        1,";
      if (!code.includes(from)) return null;
      return { code: code.replace(from, to), map: null };
    }

    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;
    if (code.includes('WAYBILL AUTO ASSIGN SERVER GUARD')) return null;

    let text = code;

    // Every browser must immediately reconcile its local waybill pool against the
    // durable order list. This prevents an old localStorage pool from presenting an
    // already-used number as Available after login / refresh / another-PC usage.
    const reservationMarker = "  const waybillAssignmentReservationsRef = useRef<Set<string>>(new Set());";
    if (!text.includes(reservationMarker)) {
      throw new Error('[O-RA waybill auto guard] server-atomic reservation marker not found');
    }
    text = text.replace(
      reservationMarker,
      reservationMarker + "\n  const waybillAssignmentOrderInFlightRef = useRef<Set<string>>(new Set());"
    );

    const activeMarker = "    waybillAssignmentReservationsRef.current = active;";
    if (!text.includes(activeMarker)) {
      throw new Error('[O-RA waybill auto guard] active reservation marker not found');
    }
    const reconciliation = String.raw`    // DURABLE WAYBILL POOL RECONCILIATION
    // Orders loaded from the server are authoritative. If this browser still has a
    // used number marked Available in localStorage, lock that pool row immediately.
    const durableOwners = new Map<string, Order>();
    orders.forEach((o) => {
      const key = String(o.waybill_number || '').trim().toLowerCase();
      if (key) durableOwners.set(key, o);
    });
    if (durableOwners.size) {
      setWaybillRecords((prev) => {
        let changed = false;
        const next = prev.map((w) => {
          const key = String(w.waybill_number || '').trim().toLowerCase();
          const owner = key ? durableOwners.get(key) : undefined;
          if (!owner) return w;
          const alreadyCorrect = w.status !== 'Available' && String(w.assigned_order_id || '') === String(owner.id || '');
          if (alreadyCorrect) return w;
          changed = true;
          return {
            ...w,
            status: owner.dispatch_status === 'Handed Over' || owner.order_status === 'Delivered' ? 'Used' : 'Assigned',
            assigned_order_id: owner.id,
            assigned_order_number: owner.order_number,
            assigned_at: w.assigned_at || owner.updated_at || owner.created_at || new Date().toISOString(),
          } as WaybillRecord;
        });
        return changed ? next : prev;
      });
    }
`;
    text = text.replace(activeMarker, reconciliation + activeMarker);

    // Prevent the same order from starting two concurrent server assignments if a
    // render happens while the first network request is still pending.
    const functionStart = "  const assignNextWaybill = async (orderId: string, courierName = settings.courier_provider || 'Fardar'): Promise<string | null> => {\n    const order = orders.find((o) => o.id === orderId);";
    if (!text.includes(functionStart)) {
      throw new Error('[O-RA waybill auto guard] async assign function marker not found');
    }
    text = text.replace(
      functionStart,
      "  const assignNextWaybill = async (orderId: string, courierName = settings.courier_provider || 'Fardar'): Promise<string | null> => {\n    if (waybillAssignmentOrderInFlightRef.current.has(orderId)) return null;\n    waybillAssignmentOrderInFlightRef.current.add(orderId);\n    try {\n    const order = orders.find((o) => o.id === orderId);"
    );

    const functionEnd = "    void refreshOrdersFromServer().catch((err) => console.warn('Waybill conflict refresh failed:', err?.message || err));\n    return null;\n  };";
    if (!text.includes(functionEnd)) {
      throw new Error('[O-RA waybill auto guard] async assign end marker not found');
    }
    text = text.replace(
      functionEnd,
      "    void refreshOrdersFromServer().catch((err) => console.warn('Waybill conflict refresh failed:', err?.message || err));\n    return null;\n    } finally {\n      waybillAssignmentOrderInFlightRef.current.delete(orderId);\n    }\n  };"
    );

    // ROOT FIX: the FIFO allocator used to assign a local Available waybill directly
    // and only mirror it to the server afterwards. That bypassed assignNextWaybill()
    // and was the remaining path that could show/reuse old waybills. Stock allocation
    // remains automatic, but every automatic waybill now goes through the exact same
    // server-first assignment function and Supabase unique constraint as manual clicks.
    const autoStart = "    const postStockOrders=confirmedActive.map(order=>allocatedIds.has(order.id)?{...order,stock_allocated:true,stock_status:'Allocated' as const,stock_allocated_at:now,stock_allocated_by:'System FIFO Allocator'}:order);";
    const autoEnd = "  }, [orders, products, waybillRecords]);";
    const start = text.indexOf(autoStart);
    const end = text.indexOf(autoEnd, start);
    if (start < 0 || end < 0) {
      throw new Error('[O-RA waybill auto guard] FIFO auto-waybill block marker not found');
    }

    const guardedBlock = String.raw`    // WAYBILL AUTO ASSIGN SERVER GUARD
    // Newly allocated stock is saved first. A later render sees stock_allocated=true
    // and then sends the waybill through assignNextWaybill(), which writes to the
    // durable server before changing any local waybill/order UI state.
    const readyWithoutWaybill=confirmedActive
      .filter(o=>o.stock_allocated && o.stock_status==='Allocated' && !o.waybill_number && !o.invoice_locked && o.order_status!=='Cancelled')
      .sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());
    if(!allocatedIds.size && !readyWithoutWaybill.length) return;

    if(allocatedIds.size){
      setOrders(prev=>prev.map(o=>{
        if(!allocatedIds.has(o.id)) return o;
        const updated={...o,stock_allocated:true,stock_status:'Allocated' as const,stock_allocated_at:now,stock_allocated_by:'System FIFO Allocator'} as Order;
        void mirrorOrderUpdate(updated);
        return updated;
      }));
    }

    if(readyWithoutWaybill.length){
      void (async()=>{
        for(const ready of readyWithoutWaybill){
          try{
            await assignNextWaybill(ready.id, settings.courier_provider || 'Fardar');
          }catch(error:any){
            console.warn('Automatic durable waybill assignment failed:',ready.order_number,error?.message||error);
          }
        }
      })();
    }
  }, [orders, products, waybillRecords]);`;

    text = text.slice(0, start) + guardedBlock + text.slice(end + autoEnd.length);
    return { code: text, map: null };
  },
});
