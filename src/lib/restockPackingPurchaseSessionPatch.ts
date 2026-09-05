export const restockPackingPurchaseSessionPatch = () => ({
  name: 'ora-restock-packing-purchase-session-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      // Packing batches must represent the moment an invoice is actually generated.
      // confirm_upload_batch_id remains history only; it must never pull a later
      // restock invoice back into an old Confirm/Cancel upload batch.
      const inheritedAuto = "      invoice_pack_batch_id:o.invoice_pack_batch_id || (o.confirm_upload_batch_id && !orders.some(existing=>existing.confirm_upload_batch_id===o.confirm_upload_batch_id && Boolean(existing.invoice_pack_downloaded_at)) ? o.confirm_upload_batch_id : batchId),";
      const isolatedAuto = "      invoice_pack_batch_id:o.invoice_pack_batch_id || batchId,";
      if (text.includes(inheritedAuto)) text = text.replace(inheritedAuto, isolatedAuto);

      const inheritedManual = "      invoice_pack_batch_id: o.invoice_pack_batch_id || (o.confirm_upload_batch_id && !orders.some(existing=>existing.confirm_upload_batch_id===o.confirm_upload_batch_id && Boolean(existing.invoice_pack_downloaded_at)) ? o.confirm_upload_batch_id : batchId),";
      const isolatedManual = "      invoice_pack_batch_id: o.invoice_pack_batch_id || batchId,";
      if (text.includes(inheritedManual)) text = text.replace(inheritedManual, isolatedManual);

      return text === code ? null : { code: text, map: null };
    }

    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (text.includes('DAILY PURCHASE SESSION • SAVE ALL STOCK ONCE')) return null;

    const stateMarker = "  // Change Password & Staff Accounts Modals";
    if (!text.includes(stateMarker)) throw new Error('[O-RA daily purchase] state insertion marker not found');

    const stateAndHelpers = `  type DailyPurchaseLineDraft = {
    id: string;
    item_code: string;
    quantity_added: number;
    unit_buying_price: number;
  };
  type DailyPurchaseShopDraft = {
    id: string;
    supplier_name: string;
    invoice_ref: string;
    notes: string;
    bill_file: File | null;
    lines: DailyPurchaseLineDraft[];
  };
  const [isDailyPurchaseOpen, setIsDailyPurchaseOpen] = useState(false);
  const [dailyPurchaseSaving, setDailyPurchaseSaving] = useState(false);
  const [dailyPurchaseShops, setDailyPurchaseShops] = useState<DailyPurchaseShopDraft[]>([]);

  const makeDailyPurchaseLine = (): DailyPurchaseLineDraft => ({
    id: 'daily-line-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
    item_code: '',
    quantity_added: 1,
    unit_buying_price: 0,
  });

  const makeDailyPurchaseShop = (): DailyPurchaseShopDraft => ({
    id: 'daily-shop-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
    supplier_name: '',
    invoice_ref: '',
    notes: '',
    bill_file: null,
    lines: [makeDailyPurchaseLine()],
  });

  const resolveDailyPurchaseSelection = (rawCode: string): { product: Product; variant?: ProductVariant } | null => {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) return null;
    const direct = products.find((product) => String(product.sku || '').trim().toUpperCase() === code);
    if (direct) return { product: direct };
    for (const product of products) {
      const variant = (product.variants || []).find((row) => String(row.sku || '').trim().toUpperCase() === code);
      if (variant) return { product, variant };
    }
    return null;
  };

  const openDailyPurchaseSession = () => {
    setDailyPurchaseShops([makeDailyPurchaseShop()]);
    setDailyPurchaseSaving(false);
    setIsDailyPurchaseOpen(true);
  };

  const setDailyPurchaseCode = (shopId: string, lineId: string, itemCode: string) => {
    const selection = resolveDailyPurchaseSelection(itemCode);
    const suggestedCost = selection
      ? Number(selection.variant?.buying_price ?? selection.product.buying_price ?? 0)
      : undefined;
    setDailyPurchaseShops((current) => current.map((shop) => shop.id !== shopId ? shop : {
      ...shop,
      lines: shop.lines.map((line) => line.id !== lineId ? line : {
        ...line,
        item_code: itemCode,
        ...(suggestedCost !== undefined ? { unit_buying_price: suggestedCost } : {}),
      }),
    }));
  };

  const saveDailyPurchaseSession = async () => {
    if (dailyPurchaseSaving) return;
    setDailyPurchaseSaving(true);
    try {
      if (!dailyPurchaseShops.length) throw new Error('Add at least one shop.');

      // Validate the COMPLETE day first. Nothing touches stock until every shop
      // and every line is known to be valid and all optional bill images upload.
      const validated = dailyPurchaseShops.map((shop, shopIndex) => {
        const supplier = String(shop.supplier_name || '').trim();
        if (!supplier) throw new Error('Shop ' + (shopIndex + 1) + ': Supplier / Shop Name is required.');
        if (!shop.lines.length) throw new Error('Shop ' + (shopIndex + 1) + ': Add at least one item.');

        const lines = shop.lines.map((line, lineIndex) => {
          const selection = resolveDailyPurchaseSelection(line.item_code);
          if (!selection) throw new Error('Shop ' + (shopIndex + 1) + ', item ' + (lineIndex + 1) + ': Item Code not found.');
          if (normalizedProductType(selection.product) === 'bundle') {
            throw new Error('Shop ' + (shopIndex + 1) + ', item ' + (lineIndex + 1) + ': Add stock to bundle component items instead.');
          }
          if (normalizedProductType(selection.product) === 'variant' && !selection.variant) {
            throw new Error('Shop ' + (shopIndex + 1) + ', item ' + (lineIndex + 1) + ': Enter the exact variant / color Item Code.');
          }
          const quantity = Math.floor(Number(line.quantity_added || 0));
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Shop ' + (shopIndex + 1) + ', item ' + (lineIndex + 1) + ': Quantity must be greater than 0.');
          }
          const cost = Number(line.unit_buying_price);
          if (!Number.isFinite(cost) || cost < 0) {
            throw new Error('Shop ' + (shopIndex + 1) + ', item ' + (lineIndex + 1) + ': Buying price is invalid.');
          }
          return { selection, quantity, cost };
        });

        return { shop, supplier, lines };
      });

      const uploaded: Array<{ shop: DailyPurchaseShopDraft; supplier: string; billImageUrl: string; lines: Array<{ selection: { product: Product; variant?: ProductVariant }; quantity: number; cost: number }> }> = [];
      for (const entry of validated) {
        const billImageUrl = entry.shop.bill_file
          ? await uploadPublicImage(entry.shop.bill_file, 'purchase-bill')
          : '';
        uploaded.push({ ...entry, billImageUrl });
      }

      const firstPoNumber = purchaseOrders.length + 1;
      const year = new Date().getFullYear();
      let lineNumber = 0;

      // All stock mutations happen together in this single final pass. React batches
      // these synchronous updates, so FIFO sees the completed day's stock instead of
      // one shop at a time and generates one NEW packing session for newly-ready orders.
      uploaded.forEach((entry) => {
        entry.lines.forEach((line) => {
          addPurchaseOrder({
            supplier_name: entry.supplier,
            product_id: line.selection.product.id,
            variant_id: line.selection.variant?.id,
            quantity_added: line.quantity,
            unit_buying_price: line.cost,
            invoice_ref: String(entry.shop.invoice_ref || '').trim(),
            bill_image_url: entry.billImageUrl || undefined,
            notes: String(entry.shop.notes || '').trim(),
            performed_by: adminUser?.name || 'Admin',
            po_number: 'PO-' + year + '-' + String(firstPoNumber + lineNumber).padStart(4, '0'),
          });
          lineNumber += 1;
        });
      });

      const shopCount = uploaded.length;
      const itemCount = uploaded.reduce((sum, entry) => sum + entry.lines.length, 0);
      setDailyPurchaseShops([]);
      setIsDailyPurchaseOpen(false);
      alert('Daily purchase saved. ' + shopCount + ' shop(s), ' + itemCount + ' stock line(s) were added together.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to save the daily purchase session.');
    } finally {
      setDailyPurchaseSaving(false);
    }
  };

`;
    text = text.replace(stateMarker, stateAndHelpers + stateMarker);

    const addPurchaseMarker = `              <PlusCircle className="w-4 h-4" /> Add Purchase
            </button>`;
    if (!text.includes(addPurchaseMarker)) throw new Error('[O-RA daily purchase] Add Purchase button marker not found');
    const purchaseButtons = `              <PlusCircle className="w-4 h-4" /> Single Shop Purchase
            </button>
            <button
              type="button"
              onClick={openDailyPurchaseSession}
              className="px-4 py-2 rounded-xl bg-emerald-500 text-neutral-950 font-black text-xs flex items-center gap-2 hover:bg-emerald-400"
            >
              <PlusCircle className="w-4 h-4" /> Daily Purchase Session
            </button>`;
    text = text.replace(addPurchaseMarker, purchaseButtons);

    const modalMarker = `      {isPurchaseOpen && (`;
    if (!text.includes(modalMarker)) throw new Error('[O-RA daily purchase] purchase modal marker not found');

    const dailyModal = `      {isDailyPurchaseOpen && (
        <div className="fixed inset-0 z-[125] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-6xl max-h-[94vh] overflow-y-auto rounded-3xl border border-emerald-500/30 bg-neutral-950 p-4 sm:p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-800 pb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">DAILY PURCHASE SESSION • SAVE ALL STOCK ONCE</p>
                <h3 className="mt-1 text-lg font-black text-white">Today's Shops & Purchase Details</h3>
                <p className="mt-1 text-xs leading-5 text-neutral-400">Add every shop first. Stock is not increased while you are filling this screen. The final button validates everything, uploads each shop bill, then adds all stock together.</p>
              </div>
              <button type="button" disabled={dailyPurchaseSaving} onClick={() => { setDailyPurchaseShops([]); setIsDailyPurchaseOpen(false); }} className="rounded-lg bg-neutral-900 p-2 text-neutral-400 disabled:opacity-40"><X className="h-4 w-4" /></button>
            </div>

            <datalist id="ora-daily-purchase-items">
              {products.filter((product) => normalizedProductType(product) !== 'bundle').flatMap((product) => {
                if (normalizedProductType(product) === 'variant') {
                  return (product.variants || []).map((variant) => (
                    <option key={'daily-option-' + variant.id} value={variant.sku}>{product.name_en} - {variant.option_value}</option>
                  ));
                }
                return [<option key={'daily-option-' + product.id} value={product.sku}>{product.name_en}</option>];
              })}
            </datalist>

            <div className="space-y-4">
              {dailyPurchaseShops.map((shop, shopIndex) => (
                <div key={shop.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-white">Shop {shopIndex + 1}</p>
                      <p className="text-[10px] text-neutral-500">This shop keeps its own supplier, invoice reference, bill image and notes.</p>
                    </div>
                    {dailyPurchaseShops.length > 1 && (
                      <button type="button" disabled={dailyPurchaseSaving} onClick={() => setDailyPurchaseShops((current) => current.filter((row) => row.id !== shop.id))} className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-bold text-red-300 disabled:opacity-40">
                        Remove Shop
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <label className="text-xs text-neutral-400">Supplier / Shop Name
                      <input required value={shop.supplier_name} disabled={dailyPurchaseSaving} onChange={(event) => setDailyPurchaseShops((current) => current.map((row) => row.id === shop.id ? { ...row, supplier_name:event.target.value } : row))} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" />
                    </label>
                    <label className="text-xs text-neutral-400">Supplier Invoice Ref
                      <input value={shop.invoice_ref} disabled={dailyPurchaseSaving} onChange={(event) => setDailyPurchaseShops((current) => current.map((row) => row.id === shop.id ? { ...row, invoice_ref:event.target.value } : row))} className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" />
                    </label>
                    <label className="text-xs text-neutral-400">Bill Image <span className="text-neutral-600">(Optional)</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={dailyPurchaseSaving} onChange={(event) => { const file=event.target.files?.[0] || null; setDailyPurchaseShops((current) => current.map((row) => row.id === shop.id ? { ...row, bill_file:file } : row)); }} className="mt-1 block w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-[10px] text-neutral-300 file:mr-2 file:rounded-lg file:border-0 file:bg-emerald-500 file:px-2 file:py-1.5 file:font-bold file:text-neutral-950" />
                      {shop.bill_file && <span className="mt-1 block break-all text-[9px] text-emerald-400">{shop.bill_file.name}</span>}
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div className="hidden grid-cols-[minmax(180px,1fr)_100px_150px_42px] gap-2 px-1 text-[9px] font-black uppercase tracking-wider text-neutral-500 md:grid">
                      <span>Item / Variant Code</span><span>Qty</span><span>Buying Price</span><span></span>
                    </div>
                    {shop.lines.map((line) => {
                      const selection = resolveDailyPurchaseSelection(line.item_code);
                      return (
                        <div key={line.id} className="grid grid-cols-1 gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3 md:grid-cols-[minmax(180px,1fr)_100px_150px_42px] md:items-start">
                          <div>
                            <input list="ora-daily-purchase-items" value={line.item_code} disabled={dailyPurchaseSaving} onChange={(event) => setDailyPurchaseCode(shop.id,line.id,event.target.value)} placeholder="Type exact Item Code" className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-mono font-bold uppercase text-white" />
                            {selection ? <p className="mt-1 text-[9px] text-emerald-400">{selection.product.name_en}{selection.variant ? ' - ' + selection.variant.option_value : ''}</p> : line.item_code ? <p className="mt-1 text-[9px] text-red-300">Exact Item Code not found yet</p> : null}
                          </div>
                          <input type="number" min="1" step="1" value={line.quantity_added} disabled={dailyPurchaseSaving} onChange={(event) => setDailyPurchaseShops((current) => current.map((row) => row.id !== shop.id ? row : { ...row, lines:row.lines.map((item) => item.id === line.id ? { ...item, quantity_added:Math.max(1,Number(event.target.value || 1)) } : item) }))} className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white" />
                          <input type="number" min="0" step="0.01" value={line.unit_buying_price} disabled={dailyPurchaseSaving} onChange={(event) => setDailyPurchaseShops((current) => current.map((row) => row.id !== shop.id ? row : { ...row, lines:row.lines.map((item) => item.id === line.id ? { ...item, unit_buying_price:Math.max(0,Number(event.target.value || 0)) } : item) }))} className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white" />
                          <button type="button" disabled={dailyPurchaseSaving || shop.lines.length <= 1} onClick={() => setDailyPurchaseShops((current) => current.map((row) => row.id === shop.id ? { ...row, lines:row.lines.filter((item) => item.id !== line.id) } : row))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      );
                    })}
                    <button type="button" disabled={dailyPurchaseSaving} onClick={() => setDailyPurchaseShops((current) => current.map((row) => row.id === shop.id ? { ...row, lines:[...row.lines,makeDailyPurchaseLine()] } : row))} className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-[10px] font-bold text-neutral-300 disabled:opacity-40">
                      <PlusCircle className="mr-1.5 inline h-4 w-4" /> Add Item / Variant to This Shop
                    </button>
                  </div>

                  <label className="block text-xs text-neutral-400">Shop Notes
                    <textarea value={shop.notes} disabled={dailyPurchaseSaving} onChange={(event) => setDailyPurchaseShops((current) => current.map((row) => row.id === shop.id ? { ...row, notes:event.target.value } : row))} className="mt-1 min-h-16 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" />
                  </label>
                  <div className="text-right text-[10px] text-neutral-500">Shop Total: <span className="font-black text-amber-300">Rs. {shop.lines.reduce((sum,line) => sum + Math.max(0,Number(line.quantity_added || 0)) * Math.max(0,Number(line.unit_buying_price || 0)),0).toLocaleString()}</span></div>
                </div>
              ))}
            </div>

            <button type="button" disabled={dailyPurchaseSaving} onClick={() => setDailyPurchaseShops((current) => [...current,makeDailyPurchaseShop()])} className="w-full rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-xs font-black text-emerald-300 disabled:opacity-40">
              <PlusCircle className="mr-1.5 inline h-4 w-4" /> Add Another Shop
            </button>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">TODAY'S TOTAL PURCHASE COST</p>
                  <p className="mt-1 text-2xl font-black text-amber-400">Rs. {dailyPurchaseShops.reduce((shopSum,shop) => shopSum + shop.lines.reduce((lineSum,line) => lineSum + Math.max(0,Number(line.quantity_added || 0)) * Math.max(0,Number(line.unit_buying_price || 0)),0),0).toLocaleString()}</p>
                  <p className="mt-1 text-[10px] text-neutral-500">Nothing is added to stock until the final button below succeeds.</p>
                </div>
                <p className="text-[10px] font-bold text-emerald-300">{dailyPurchaseShops.length} shop(s) • {dailyPurchaseShops.reduce((sum,shop) => sum + shop.lines.length,0)} stock line(s)</p>
              </div>
            </div>

            <button type="button" disabled={dailyPurchaseSaving || !dailyPurchaseShops.length} onClick={() => void saveDailyPurchaseSession()} className="w-full rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">
              {dailyPurchaseSaving ? 'Validating Bills & Saving All Stock…' : 'Save Today’s Purchases & Add All Stock'}
            </button>
            <p className="text-center text-[9px] leading-4 text-neutral-600">Existing Single Shop Purchase, old Purchase History, product prices, offers, orders, waybills, Google Sheet and Fardar flows are not modified by this session screen.</p>
          </div>
        </div>
      )}

`;
    text = text.replace(modalMarker, dailyModal + modalMarker);

    return { code: text, map: null };
  },
});
