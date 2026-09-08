export const waybillAssignmentAtomicPatch = () => ({
  name: 'ora-waybill-assignment-atomic-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;
    if (code.includes('WAYBILL ATOMIC RESERVATION')) return null;

    const startMarker = "  const assignNextWaybill = (orderId: string, courierName = settings.courier_provider || 'Fardar'): string | null => {";
    const endMarker = "  const unassignWaybill = (orderId: string) => {";
    const start = code.indexOf(startMarker);
    const end = code.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('[O-RA waybill atomic] assignNextWaybill markers not found');

    const replacement = String.raw`  // WAYBILL ATOMIC RESERVATION
  // React state updates can be batched. Without a synchronous reservation, two
  // orders assigned in the same tick can both read the same "Available" waybill.
  // Keep an immediate in-memory reservation set so one waybill can only be picked once.
  const waybillAssignmentReservationsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const active = new Set<string>();
    orders.forEach((o) => {
      const key = String(o.waybill_number || '').trim().toLowerCase();
      if (key) active.add(key);
    });
    waybillRecords.forEach((w) => {
      if (w.status !== 'Assigned') return;
      const key = String(w.waybill_number || '').trim().toLowerCase();
      if (key) active.add(key);
    });
    waybillAssignmentReservationsRef.current = active;
  }, [orders, waybillRecords]);

  const assignNextWaybill = (orderId: string, courierName = settings.courier_provider || 'Fardar'): string | null => {
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
    const next = waybillRecords.find((w) => {
      const key = String(w.waybill_number || '').trim().toLowerCase();
      return Boolean(
        key &&
        w.status === 'Available' &&
        w.courier_name === courierName &&
        !alreadyOnOrders.has(key) &&
        !waybillAssignmentReservationsRef.current.has(key)
      );
    });
    if (!next) return null;

    const reservedKey = String(next.waybill_number || '').trim().toLowerCase();
    // Reserve synchronously BEFORE either React state setter runs.
    waybillAssignmentReservationsRef.current.add(reservedKey);

    const now = new Date().toISOString();
    setWaybillRecords((prev) => prev.map((w) => w.id === next.id ? { ...w, status: 'Assigned', assigned_order_id: order.id, assigned_order_number: order.order_number, assigned_at: now } : w));
    setOrders((prev) => {
      const latestOrder = prev.find((o) => o.id === orderId);
      if (!latestOrder || latestOrder.waybill_number) return prev;
      const duplicateExists = prev.some((o) => o.id !== orderId && String(o.waybill_number || '').trim().toLowerCase() === reservedKey);
      if (duplicateExists) {
        waybillAssignmentReservationsRef.current.delete(reservedKey);
        return prev;
      }
      return prev.map((o) => o.id === orderId ? { ...o, courier_name: courierName, waybill_number: next.waybill_number, fardar_city: resolvedCity || o.fardar_city, city_verified: Boolean(resolvedCity) ? true : o.city_verified, shipment_mode: 'manual', tracking_status: 'Waybill Assigned', delivery_status: 'Ready to Ship' } : o);
    });
    logActivity({ action: 'Waybill Assigned', module: 'Delivery', target_id: orderId, target_label: order.order_number, details: String(next.waybill_number) + ' (' + courierName + ')' });
    return next.waybill_number;
  };

`;

    let text = code.slice(0, start) + replacement + code.slice(end);

    const unassignGuard = "    if (!order?.waybill_number) return;";
    if (text.includes(unassignGuard) && !text.includes('waybillAssignmentReservationsRef.current.delete(String(order.waybill_number')) {
      text = text.replace(
        unassignGuard,
        unassignGuard + "\n    waybillAssignmentReservationsRef.current.delete(String(order.waybill_number || '').trim().toLowerCase());"
      );
    }

    return { code: text, map: null };
  },
});
