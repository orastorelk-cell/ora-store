export const adminDashboardFardarHistoryDurablePatch = () => ({
  name: 'ora-admin-fardar-history-durable-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (!code.includes('Fardar CSV History')) return null;

    let text = code;

    const oldDerived = String.raw`        const fardarHistoryDates = Array.from(new Set(unifiedConfirmHistory.map(batch => unifiedHistoryDateKey(batch.at)).filter(Boolean))).sort().reverse();
        const selectedFardarHistoryDate = unifiedConfirmHistoryDate || fardarHistoryDates[0] || '';
        const selectedDateBatches = unifiedConfirmHistory
          .filter(batch => unifiedHistoryDateKey(batch.at) === selectedFardarHistoryDate)
          .sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        const selectedDateOrderNumbers = Array.from(new Set(selectedDateBatches.flatMap(batch => batch.orderNumbers)));
        const selectedDateOrders = orders.filter(order => selectedDateOrderNumbers.includes(order.order_number));
        const selectedDateReadyOrders = selectedDateOrders.filter(order =>
          order.call_center_status === 'Confirmed' &&
          order.stock_allocated &&
          Boolean(order.waybill_number) &&
          order.order_status !== 'Cancelled'
        );`;

    const newDerived = String.raw`        const activeOrderNumbers = new Set(orders.map(order => order.order_number));
        const activeSavedConfirmBatches = unifiedConfirmHistory.filter(batch => batch.orderNumbers.some(orderNumber => activeOrderNumbers.has(orderNumber)));
        const durableConfirmDates = orders.map(order => unifiedHistoryDateKey(order.call_center_updated_at)).filter(Boolean);
        const fardarHistoryDates = Array.from(new Set([
          ...activeSavedConfirmBatches.map(batch => unifiedHistoryDateKey(batch.at)).filter(Boolean),
          ...durableConfirmDates,
        ])).sort().reverse();
        const selectedFardarHistoryDate = unifiedConfirmHistoryDate || fardarHistoryDates[0] || '';
        const selectedDateBatches = activeSavedConfirmBatches
          .filter(batch => unifiedHistoryDateKey(batch.at) === selectedFardarHistoryDate)
          .sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        const selectedDateOrderNumbers = Array.from(new Set(selectedDateBatches.flatMap(batch => batch.orderNumbers)));
        const selectedDateOrders = orders.filter(order =>
          selectedDateOrderNumbers.includes(order.order_number) ||
          unifiedHistoryDateKey(order.call_center_updated_at) === selectedFardarHistoryDate
        );
        const selectedDateReadyOrders = selectedDateOrders.filter(order =>
          order.call_center_status === 'Confirmed' &&
          order.stock_allocated &&
          Boolean(order.waybill_number) &&
          order.order_status !== 'Cancelled'
        );`;

    if (!text.includes(oldDerived)) throw new Error('[O-RA Fardar durable history] derived history marker not found');
    text = text.replace(oldDerived, newDerived);

    text = text.replace(
      'Saved Batches {unifiedConfirmHistory.length}',
      'Saved Batches {activeSavedConfirmBatches.length}'
    );

    const oldEmpty = '<div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-center text-xs font-bold text-gray-500">No Confirm / Cancel upload history for this date.</div>';
    const newEmpty = '<div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-center text-xs font-bold text-gray-500">{selectedDateOrders.length > 0 ? `${selectedDateOrders.length} historical order(s) recovered from saved Confirm timestamps. Use Download Date CSV above.` : \'No Confirm / Cancel upload history for this date.\'}</div>';
    if (!text.includes(oldEmpty)) throw new Error('[O-RA Fardar durable history] empty-state marker not found');
    text = text.replace(oldEmpty, newEmpty);

    return { code: text, map: null };
  },
});
