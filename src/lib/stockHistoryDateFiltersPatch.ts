const replaceOnce = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA stock date filters] ${label} marker not found`);
  return text.replace(from, to);
};

export const stockHistoryDateFiltersPatch = () => ({
  name: 'ora-stock-history-date-filters-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    if (!text.includes("const [stockMovementDate, setStockMovementDate] = useState('');")) {
      const marker = [
        "  const [stockItemSearch, setStockItemSearch] = useState('');",
        "  const [selectedStockReportSku, setSelectedStockReportSku] = useState('');",
      ].join('\n');
      const replacement = [
        "  const [stockItemSearch, setStockItemSearch] = useState('');",
        "  const [stockMovementDate, setStockMovementDate] = useState('');",
        "  const [stockAvailableOnly, setStockAvailableOnly] = useState(false);",
        "  const [purchaseHistoryDate, setPurchaseHistoryDate] = useState('');",
        "  const [stockAuditDate, setStockAuditDate] = useState('');",
        "  const [selectedStockReportSku, setSelectedStockReportSku] = useState('');",
      ].join('\n');
      text = replaceOnce(text, marker, replacement, 'filter state');
    }

    if (!text.includes('const filteredPurchaseHistory = useMemo(() => {')) {
      const marker = '  const stockMovementBySku = useMemo(() => {';
      const block = [
        "  const filteredPurchaseHistory = useMemo(() => {",
        "    if (!purchaseHistoryDate) return purchaseOrders;",
        "    return purchaseOrders.filter((po) => stockLocalDayKey(po.created_at) === purchaseHistoryDate);",
        "  }, [purchaseOrders, purchaseHistoryDate]);",
        "",
        "  const filteredStockAuditHistory = useMemo(() => {",
        "    if (!stockAuditDate) return stockHistory;",
        "    return stockHistory.filter((row) => stockLocalDayKey(row.created_at) === stockAuditDate);",
        "  }, [stockHistory, stockAuditDate]);",
        "",
        marker,
      ].join('\n');
      text = replaceOnce(text, marker, block, 'dated history rows');
    }

    if (!text.includes('const visibleStockItemReportRows = useMemo(() => {')) {
      const marker = '  const selectedStockReportRow = useMemo(';
      const block = [
        "  const visibleStockItemReportRows = useMemo(() => {",
        "    const purchasedBySku = new Map<string, number>();",
        "    const packedBySku = new Map<string, number>();",
        "    const add = (map: Map<string, number>, sku: unknown, qty: unknown) => {",
        "      const key = String(sku || '').trim().toUpperCase();",
        "      const amount = Math.max(0, Number(qty || 0));",
        "      if (!key || !amount) return;",
        "      map.set(key, (map.get(key) || 0) + amount);",
        "    };",
        "",
        "    if (stockMovementDate) {",
        "      purchaseOrders.forEach((po) => {",
        "        if (stockLocalDayKey(po.created_at) !== stockMovementDate) return;",
        "        add(purchasedBySku, po.variant_sku || po.sku, po.quantity_added);",
        "      });",
        "",
        "      orders",
        "        .filter((order) =>",
        "          order.stock_allocated &&",
        "          Boolean(order.stock_allocated_at) &&",
        "          stockLocalDayKey(order.stock_allocated_at) === stockMovementDate &&",
        "          order.order_status !== 'Cancelled' &&",
        "          !order.is_duplicate_order &&",
        "          !order.is_test_order",
        "        )",
        "        .forEach((order) => {",
        "          (order.items || []).forEach((item) => {",
        "            const orderQty = Math.max(1, Number(item.quantity || 1));",
        "            add(packedBySku, item.sku || item.main_sku, orderQty);",
        "            if (item.product_type === 'bundle' && Array.isArray(item.bundle_components)) {",
        "              item.bundle_components.forEach((component) => {",
        "                add(",
        "                  packedBySku,",
        "                  component.sku,",
        "                  orderQty * Math.max(1, Number(component.quantity_per_bundle || 1))",
        "                );",
        "              });",
        "            }",
        "          });",
        "        });",
        "    }",
        "",
        "    return stockItemReportRows",
        "      .map((row) => stockMovementDate ? {",
        "        ...row,",
        "        todayPurchased: purchasedBySku.get(row.sku) || 0,",
        "        todayPacked: packedBySku.get(row.sku) || 0,",
        "      } : row)",
        "      .filter((row) => !stockAvailableOnly || Number(row.available || 0) > 0)",
        "      .filter((row) => !stockMovementDate || row.todayPurchased > 0 || row.todayPacked > 0);",
        "  }, [stockItemReportRows, stockMovementDate, stockAvailableOnly, purchaseOrders, orders]);",
        "",
        marker,
      ].join('\n');
      text = replaceOnce(text, marker, block, 'visible stock movement rows');
    }

    if (!text.includes('setStockMovementDate(e.target.value)')) {
      const marker = [
        '                  {stockItemSearch && (',
        '                    <button type="button" onClick={()=>setStockItemSearch(\'\')}',
        '                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-neutral-400 hover:text-white">',
        '                      Clear',
        '                    </button>',
        '                  )}',
        '                </div>',
        '              </div>',
        '              <p className="mt-2 text-[10px] text-neutral-500">',
      ].join('\n');
      const replacement = [
        '                  {stockItemSearch && (',
        '                    <button type="button" onClick={()=>setStockItemSearch(\'\')}',
        '                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-neutral-400 hover:text-white">',
        '                      Clear',
        '                    </button>',
        '                  )}',
        '                </div>',
        '              </div>',
        '              <div className="mt-3 flex flex-wrap items-end gap-2">',
        '                <label className="text-[10px] font-bold text-neutral-400">',
        '                  Date',
        '                  <input',
        '                    type="date"',
        '                    value={stockMovementDate}',
        '                    onChange={(e)=>setStockMovementDate(e.target.value)}',
        '                    className="mt-1 block rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs text-white outline-none focus:border-amber-500"',
        '                  />',
        '                </label>',
        '                <button',
        '                  type="button"',
        '                  onClick={()=>setStockAvailableOnly((value)=>!value)}',
        "                  className={'rounded-lg border px-3 py-2 text-[10px] font-black transition-colors ' + (stockAvailableOnly ? 'border-emerald-400 bg-emerald-400 text-neutral-950' : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:text-white')}",
        '                >',
        '                  Available',
        '                </button>',
        '                {(stockMovementDate || stockAvailableOnly) && (',
        '                  <button',
        '                    type="button"',
        "                    onClick={()=>{setStockMovementDate('');setStockAvailableOnly(false);}}",
        '                    className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-[10px] font-black text-neutral-300 hover:text-white"',
        '                  >',
        '                    Clear Filter',
        '                  </button>',
        '                )}',
        '              </div>',
        '              <p className="mt-2 text-[10px] text-neutral-500">',
      ].join('\n');
      text = replaceOnce(text, marker, replacement, 'stock report controls');
    }

    text = replaceOnce(
      text,
      "                Showing {stockItemReportRows.length} of {stockByItemCodeRows.length} item code{stockByItemCodeRows.length===1?'':'s'}",
      "                Showing {visibleStockItemReportRows.length} of {stockByItemCodeRows.length} item code{stockByItemCodeRows.length===1?'':'s'}",
      'stock report showing count'
    );

    text = replaceOnce(
      text,
      '<th className="p-3 text-center">Today Purchase</th>',
      '<th className="p-3 text-center">{stockMovementDate ? \'Date Purchase\' : \'Today Purchase\'}</th>',
      'stock purchase heading'
    );

    text = replaceOnce(
      text,
      '<th className="p-3 text-center">Today Packed</th>',
      '<th className="p-3 text-center">{stockMovementDate ? \'Date Packed\' : \'Today Packed\'}</th>',
      'stock packed heading'
    );

    text = replaceOnce(
      text,
      '                  {stockItemReportRows.map((row) => (',
      '                  {visibleStockItemReportRows.map((row) => (',
      'stock report table rows'
    );

    text = replaceOnce(
      text,
      '                  {stockItemReportRows.length===0 && (',
      '                  {visibleStockItemReportRows.length===0 && (',
      'stock report empty state'
    );

    text = replaceOnce(
      text,
      "{stockItemSearch.trim()?'No matching Item Code / Item Name.':'No stock item codes available.'}",
      "{stockMovementDate?'No Purchase or Packing movement found for the selected date.':stockAvailableOnly?'No available stock items match the current filter.':stockItemSearch.trim()?'No matching Item Code / Item Name.':'No stock item codes available.'}",
      'stock report empty message'
    );

    text = replaceOnce(
      text,
      '<div><b className="text-sky-300">Today Purchase</b> = quantity entered through Add Purchase today.</div>',
      '<div><b className="text-sky-300">{stockMovementDate ? \'Date Purchase\' : \'Today Purchase\'}</b> = {stockMovementDate ? \'quantity entered through Add Purchase on the selected date.\' : \'quantity entered through Add Purchase today.\'}</div>',
      'stock report purchase help'
    );

    text = replaceOnce(
      text,
      '<div><b className="text-orange-300">Today Packed</b> = quantity allocated to confirmed orders today.</div>',
      '<div><b className="text-orange-300">{stockMovementDate ? \'Date Packed\' : \'Today Packed\'}</b> = {stockMovementDate ? \'quantity allocated to confirmed orders on the selected date.\' : \'quantity allocated to confirmed orders today.\'}</div>',
      'stock report packed help'
    );

    if (!text.includes('setPurchaseHistoryDate(e.target.value)')) {
      const marker = '<div className="p-4 border-b border-neutral-800"><h3 className="font-bold text-white text-sm">Purchase History</h3></div>';
      const replacement = [
        '<div className="flex flex-col gap-3 border-b border-neutral-800 p-4 sm:flex-row sm:items-end sm:justify-between">',
        '  <h3 className="font-bold text-white text-sm">Purchase History</h3>',
        '  <div className="flex flex-wrap items-end gap-2">',
        '    <label className="text-[10px] font-bold text-neutral-400">Date',
        '      <input type="date" value={purchaseHistoryDate} onChange={(e)=>setPurchaseHistoryDate(e.target.value)} className="mt-1 block rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs text-white outline-none focus:border-amber-500" />',
        '    </label>',
        '    {purchaseHistoryDate && <button type="button" onClick={()=>setPurchaseHistoryDate(\'\')} className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-[10px] font-black text-neutral-300 hover:text-white">Clear Date</button>}',
        '  </div>',
        '</div>',
      ].join('\n');
      text = replaceOnce(text, marker, replacement, 'purchase history date control');
    }

    text = replaceOnce(
      text,
      '<tbody className="divide-y divide-neutral-800">{purchaseOrders.map((po) => <tr key={po.id}>',
      '<tbody className="divide-y divide-neutral-800">{filteredPurchaseHistory.map((po) => <tr key={po.id}>',
      'purchase history rows'
    );

    if (!text.includes('setStockAuditDate(e.target.value)')) {
      const marker = '<div className="p-4 border-b border-neutral-800"><h3 className="font-bold text-white text-sm">Stock Audit History Logs</h3></div>';
      const replacement = [
        '<div className="flex flex-col gap-3 border-b border-neutral-800 p-4 sm:flex-row sm:items-end sm:justify-between">',
        '  <h3 className="font-bold text-white text-sm">Stock Audit History Logs</h3>',
        '  <div className="flex flex-wrap items-end gap-2">',
        '    <label className="text-[10px] font-bold text-neutral-400">Date',
        '      <input type="date" value={stockAuditDate} onChange={(e)=>setStockAuditDate(e.target.value)} className="mt-1 block rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs text-white outline-none focus:border-amber-500" />',
        '    </label>',
        '    {stockAuditDate && <button type="button" onClick={()=>setStockAuditDate(\'\')} className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-[10px] font-black text-neutral-300 hover:text-white">Clear Date</button>}',
        '  </div>',
        '</div>',
      ].join('\n');
      text = replaceOnce(text, marker, replacement, 'stock audit date control');
    }

    text = replaceOnce(
      text,
      '<tbody className="divide-y divide-neutral-800">{stockHistory.map((stk) => <tr key={stk.id} className="hover:bg-neutral-800/50">',
      '<tbody className="divide-y divide-neutral-800">{filteredStockAuditHistory.map((stk) => <tr key={stk.id} className="hover:bg-neutral-800/50">',
      'stock audit rows'
    );

    return text === code ? null : { code: text, map: null };
  },
});
