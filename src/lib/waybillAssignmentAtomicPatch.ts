export const waybillAssignmentAtomicPatch = () => ({
  name: 'ora-waybill-assignment-atomic-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      let text = code;
      text = text.replace('const wb = assignNextWaybill(order.id, provider);', 'const wb = await assignNextWaybill(order.id, provider);');
      text = text.replace('const assigned = assignNextWaybill(order.id, apiCourierName);', 'const assigned = await assignNextWaybill(order.id, apiCourierName);');
      text = text.replace('const fallback = assignNextWaybill(order.id, provider);', 'const fallback = await assignNextWaybill(order.id, provider);');
      return text === code ? null : { code: text, map: null };
    }

    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;
    if (code.includes('WAYBILL SERVER-ATOMIC ASSIGNMENT')) return null;

    let text = code;

    text = text.replace(
      "  assignNextWaybill: (orderId: string, courierName?: string) => string | null;",
      "  assignNextWaybill: (orderId: string, courierName?: string) => Promise<string | null>;"
    );

    const startMarker = "  const assignNextWaybill = (orderId: string, courierName = settings.courier_provider || 'Fardar'): string | null => {";
    const endMarker = "  const unassignWaybill = (orderId: string) => {";
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('[O-RA waybill atomic] assignNextWaybill markers not found');

    const replacement = String.raw`  // WAYBILL SERVER-ATOMIC ASSIGNMENT
  // Browser state / localStorage can be stale on another PC or tab. Therefore a
  // waybill is NOT considered assigned until the durable /api/orders/:id write
  // succeeds. Supabase has a unique index on non-empty order waybill numbers, so
  // simultaneous staff sessions cannot persist the same waybill to two orders.
  const waybillAssignmentReservationsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const active = new Set<string>();
    orders.forEach((o) => {
      const key = String(o.waybill_number || '').trim().toLowerCase();
      if (key) active.add(key);
    });
    waybillRecords.forEach((w) => {
      if (w.status !== 'Assigned' && w.status !== 'Used') return;
      const key = String(w.waybill_number || '').trim().toLowerCase();
      if (key) active.add(key);
    });
    waybillAssignmentReservationsRef.current = active;
  }, [orders, waybillRecords]);

  const assignNextWaybill = async (orderId: string, courierName = settings.courier_provider || 'Fardar'): Promise<string | null> => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;
    if (order.waybill_number) return order.waybill_number;
    const resolvedCity = order.fardar_city || resolveFardarCity(order.city).city || String(order.city || '').trim();
    if (!resolvedCity) return null;

    const alreadyOnOrders = new Set(
      orders
        .map((o) => String(o.waybill_number || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const candidates = waybillRecords.filter((w) => {
      const key = String(w.waybill_number || '').trim().toLowerCase();
      return Boolean(
        key &&
        w.status === 'Available' &&
        w.courier_name === courierName &&
        !alreadyOnOrders.has(key) &&
        !waybillAssignmentReservationsRef.current.has(key)
      );
    });

    for (const candidate of candidates) {
      const reservedKey = String(candidate.waybill_number || '').trim().toLowerCase();
      if (!reservedKey) continue;
      waybillAssignmentReservationsRef.current.add(reservedKey);

      const now = new Date().toISOString();
      const updatedOrder = {
        ...order,
        courier_name: courierName,
        waybill_number: candidate.waybill_number,
        fardar_city: resolvedCity || order.fardar_city,
        city_verified: Boolean(resolvedCity) ? true : order.city_verified,
        shipment_mode: 'manual' as const,
        tracking_status: 'Waybill Assigned',
        delivery_status: 'Ready to Ship',
      } as Order;

      try {
        // Durable write FIRST. The database unique-waybill constraint is the final
        // authority across all browsers / PCs. Only update the local UI after success.
        await sharedStaffRequest('/api/orders/' + encodeURIComponent(order.id), {
          method: 'PUT',
          body: JSON.stringify({ order: updatedOrder }),
        });

        setWaybillRecords((prev) => prev.map((w) => w.id === candidate.id ? {
          ...w,
          status: 'Assigned',
          assigned_order_id: order.id,
          assigned_order_number: order.order_number,
          assigned_at: now,
        } : w));
        setOrders((prev) => prev.map((o) => o.id === orderId ? updatedOrder : o));
        logActivity({
          action: 'Waybill Assigned',
          module: 'Delivery',
          target_id: orderId,
          target_label: order.order_number,
          details: String(candidate.waybill_number) + ' (' + courierName + ')',
        });
        return candidate.waybill_number;
      } catch (error: any) {
        const message = String(error?.message || error || '');
        const duplicateConflict = /duplicate key|unique constraint|23505|order_snapshots_unique_waybill_idx/i.test(message);

        if (duplicateConflict) {
          // This number is already owned by another durable order, even if this
          // browser's local pool was stale. Protect it locally and try the next CSV
          // waybill automatically in the same click.
          setWaybillRecords((prev) => prev.map((w) => w.id === candidate.id ? {
            ...w,
            status: 'Used',
            assigned_order_id: undefined,
            assigned_order_number: undefined,
            assigned_at: w.assigned_at || now,
          } : w));
          continue;
        }

        waybillAssignmentReservationsRef.current.delete(reservedKey);
        console.warn('Waybill durable assignment failed:', message);
        return null;
      }
    }

    void refreshOrdersFromServer().catch((err) => console.warn('Waybill conflict refresh failed:', err?.message || err));
    return null;
  };

`;

    text = text.slice(0, start) + replacement + text.slice(end);

    const unassignGuard = "    if (!order?.waybill_number) return;";
    if (text.includes(unassignGuard) && !text.includes('waybillAssignmentReservationsRef.current.delete(String(order.waybill_number')) {
      text = text.replace(
        unassignGuard,
        unassignGuard + "\n    waybillAssignmentReservationsRef.current.delete(String(order.waybill_number || '').trim().toLowerCase());"
      );
    }

    // Background FIFO allocation also mirrors order updates. If another browser
    // already claimed the same waybill, the DB rejects it. Quarantine that stale
    // local pool number and reload authoritative orders so the allocator can retry.
    const mirrorOld = [
      "  const mirrorOrderUpdate = (order: Order) => {",
      "    if (!getStaffSessionToken()) return;",
      "    sharedStaffRequest(`/api/orders/${encodeURIComponent(order.id)}`, {",
      "      method:'PUT',",
      "      body:JSON.stringify({order}),",
      "    }).catch(err=>console.warn('Order mirror update failed:',err?.message||err));",
      "  };",
    ].join('\n');

    const mirrorNew = [
      "  const mirrorOrderUpdate = (order: Order) => {",
      "    if (!getStaffSessionToken()) return;",
      "    sharedStaffRequest(`/api/orders/${encodeURIComponent(order.id)}`, {",
      "      method:'PUT',",
      "      body:JSON.stringify({order}),",
      "    }).catch(async (err) => {",
      "      const message = String(err?.message || err || '');",
      "      const waybillKey = String(order.waybill_number || '').trim().toLowerCase();",
      "      const duplicateConflict = Boolean(waybillKey) && /duplicate key|unique constraint|23505|order_snapshots_unique_waybill_idx/i.test(message);",
      "      if (duplicateConflict) {",
      "        setWaybillRecords((prev) => prev.map((w) => String(w.waybill_number || '').trim().toLowerCase() === waybillKey ? { ...w, status:'Used' } : w));",
      "        waybillAssignmentReservationsRef.current.add(waybillKey);",
      "        try { await refreshOrdersFromServer(); } catch (refreshError: any) { console.warn('Waybill conflict refresh failed:', refreshError?.message || refreshError); }",
      "        return;",
      "      }",
      "      console.warn('Order mirror update failed:', message);",
      "    });",
      "  };",
    ].join('\n');

    if (text.includes(mirrorOld)) text = text.replace(mirrorOld, mirrorNew);

    return { code: text, map: null };
  },
});
