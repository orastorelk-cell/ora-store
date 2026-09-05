export const purchaseBillHistoryPatch = () => ({
  name: 'ora-purchase-bill-history-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    const stateMarker = "  const [stockItemSearch, setStockItemSearch] = useState('');";
    if (text.includes(stateMarker) && !text.includes("const [purchaseHistorySearch, setPurchaseHistorySearch]")) {
      text = text.replace(
        stateMarker,
        stateMarker + "\n  const [purchaseHistorySearch, setPurchaseHistorySearch] = useState('');"
      );
    }

    const totalMarker = "  const totalPurchasedCost = purchaseOrders.reduce((sum, purchase) => sum + purchase.total_cost, 0);";
    if (text.includes(totalMarker) && !text.includes('const visiblePurchaseOrders = useMemo')) {
      const derived = String.raw`
  const visiblePurchaseOrders = useMemo(() => {
    const q = purchaseHistorySearch.trim().toLowerCase();
    return [...purchaseOrders]
      .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())
      .filter((po)=>{
        if (!q) return true;
        return [po.po_number, po.supplier_name, po.product_name, po.sku, po.variant_sku, po.invoice_ref, po.notes]
          .some((value)=>String(value || '').toLowerCase().includes(q));
      });
  }, [purchaseOrders, purchaseHistorySearch]);

  const purchaseBillGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      billUrl: string;
      invoiceRef: string;
      supplier: string;
      createdAt: string;
      total: number;
      rows: typeof visiblePurchaseOrders;
    }>();

    visiblePurchaseOrders.forEach((po) => {
      if (!po.bill_image_url && !po.invoice_ref) return;
      const key = String(
        po.bill_image_url ||
        ('REF:' + String(po.invoice_ref || '') + '|' + String(po.supplier_name || '') + '|' + String(po.created_at || '').slice(0,10))
      );
      const current = groups.get(key) || {
        key,
        billUrl: String(po.bill_image_url || ''),
        invoiceRef: String(po.invoice_ref || ''),
        supplier: String(po.supplier_name || ''),
        createdAt: String(po.created_at || ''),
        total: 0,
        rows: [] as typeof visiblePurchaseOrders,
      };
      current.rows.push(po);
      current.total += Math.max(0, Number(po.total_cost || 0));
      if (new Date(po.created_at).getTime() > new Date(current.createdAt).getTime()) current.createdAt = po.created_at;
      groups.set(key, current);
    });

    return Array.from(groups.values()).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  }, [visiblePurchaseOrders]);`;
      text = text.replace(totalMarker, totalMarker + derived);
    }

    const historyHeader = '<div className="p-4 border-b border-neutral-800"><h3 className="font-bold text-white text-sm">Purchase History</h3></div>';
    if (text.includes(historyHeader) && !text.includes('Uploaded Purchase Bills')) {
      const billPanel = String.raw`<div className="p-4 border-b border-neutral-800 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-bold text-white text-sm">Purchase History</h3>
                  <p className="mt-1 text-[10px] text-neutral-500">Each uploaded supplier bill is grouped once below. Item rows stay available underneath.</p>
                </div>
                <label className="flex min-w-0 items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 sm:w-[360px]">
                  <Search className="h-4 w-4 shrink-0 text-neutral-500"/>
                  <input
                    value={purchaseHistorySearch}
                    onChange={e=>setPurchaseHistorySearch(e.target.value)}
                    placeholder="Search PO, supplier, item code, invoice..."
                    className="w-full bg-transparent text-xs text-white outline-none placeholder:text-neutral-600"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-sky-300">Uploaded Purchase Bills</p>
                    <p className="mt-1 text-[10px] text-neutral-500">One card per uploaded bill / invoice, not one copy per item line.</p>
                  </div>
                  <span className="rounded-lg bg-neutral-950 px-2.5 py-1 text-[10px] font-black text-sky-300">{purchaseBillGroups.length} bill(s)</span>
                </div>

                {purchaseBillGroups.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-neutral-700 bg-neutral-950 p-4 text-center text-[10px] text-neutral-500">No matching uploaded bills.</div>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                    {purchaseBillGroups.map((group)=>(
                      <div key={group.key} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black text-white">{group.invoiceRef || 'Purchase Bill'}</p>
                            <p className="mt-1 truncate text-[10px] text-neutral-400">{group.supplier || 'Supplier'} • {new Date(group.createdAt).toLocaleString()}</p>
                          </div>
                          <p className="shrink-0 text-xs font-black text-emerald-300">Rs. {group.total.toLocaleString()}</p>
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-neutral-500">{group.rows.length} item line(s): {group.rows.slice(0,5).map(row=>String(row.variant_sku || row.sku || '')).filter(Boolean).join(' • ')}{group.rows.length>5?' • …':''}</p>
                        {group.billUrl && <a href={group.billUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-black text-sky-300"><ImageIcon className="h-3.5 w-3.5"/>View This Bill</a>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>`;
      text = text.replace(historyHeader, billPanel);
    }

    const mapMarker = 'purchaseOrders.map((po) => <tr key={po.id}>';
    if (text.includes(mapMarker)) {
      text = text.replace(mapMarker, 'visiblePurchaseOrders.map((po) => <tr key={po.id}>');
    }

    const repeatedBillCell = '<td className="p-3"><div>{po.invoice_ref || \'-\'}</div>{po.bill_image_url && <a href={po.bill_image_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-300"><ImageIcon className="h-3 w-3"/>View Bill</a>}</td>';
    if (text.includes(repeatedBillCell)) {
      text = text.replace(repeatedBillCell, '<td className="p-3"><div>{po.invoice_ref || \'-\'}</div><div className="mt-1 text-[9px] text-neutral-600">Bill grouped above</div></td>');
    }

    return text === code ? null : { code: text, map: null };
  },
});
