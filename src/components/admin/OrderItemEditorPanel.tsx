import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../context/StoreContext';
import { orderItemEditRequest } from '../../lib/orderItemEditClient';
import { buildOrderItemSnapshot, normalizedProductType, variantOptionSummary } from '../../lib/productVariants';
import { canonicalJson } from '../../lib/confirmCsvSave';
import { correctedInvoiceFormats, downloadCorrectedInvoice, type CorrectedInvoiceFormat } from '../../lib/correctedInvoiceDownload';
import { downloadReturnBlob, returnPackingCsv } from '../../lib/returnExports';
import { editMoney, type EditableItem, type ItemEditInput } from '../../lib/orderItemEdit';

const field = 'w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 disabled:opacity-50';
const button = 'rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-40';
const amount = (value: number) => value.toLocaleString('en-LK', {minimumFractionDigits: 2, maximumFractionDigits: 2});
type DraftRow = Omit<EditableItem, 'quantity'|'unit_price'> & {quantity: string; unit_price: string};

export const OrderItemEditorPanel: React.FC<{initialOrderId?: string}> = ({initialOrderId}) => {
  const {adminUser, refreshReturnInventory, markInvoiceBatchDownloaded, markFardarCsvExported} = useStore();
  const key = 'ora_order_item_edit_retry_v1:' + adminUser?.id;
  const readPending = () => {try {return JSON.parse(localStorage.getItem(key) || 'null');} catch {return null;}};
  const [pending, setPending] = useState<{input: ItemEditInput; order_number: string} | null>(readPending);
  const [search, setSearch] = useState(''), [preview, setPreview] = useState<any>(null), [rows, setRows] = useState<DraftRow[]>([]);
  const [discount, setDiscount] = useState('0'), [delivery, setDelivery] = useState('0'), [wrapping, setWrapping] = useState('0');
  const [reason, setReason] = useState('Customer requested item / colour change'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), busyRef = useRef(false);
  const applyPreview = (data: any) => {
    setPreview(data); setRows(data.draft.items.map((item: EditableItem) => ({...item, quantity: String(item.quantity), unit_price: String(item.unit_price)})));
    setDiscount(String(data.draft.discount)); setDelivery(String(data.draft.delivery_fee)); setWrapping(String(data.draft.wrapping_fee));
  };
  const work = async (action: () => Promise<void>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {await action();} catch (error: any) {setError(error.message || 'The server did not confirm this action.');}
    finally {busyRef.current = false; setBusy(false);}
  };
  const lookup = (query: string) => work(async () => {
    if (pending) throw new Error('Finish the saved item edit below before opening another order.');
    setSaved(false); setPreview(null); applyPreview(await orderItemEditRequest(query));
  });
  useEffect(() => {if (initialOrderId && !pending) void lookup('?order_id=' + encodeURIComponent(initialOrderId));}, [initialOrderId]);
  const draft = {items: rows.map(row => ({...row, quantity: Number(row.quantity), unit_price: Number(row.unit_price)})),
    discount: Number(discount), delivery_fee: Number(delivery), wrapping_fee: Number(wrapping)};
  const subtotal = editMoney(rows.reduce((sum, row) => sum + Number(row.quantity) * Number(row.unit_price), 0));
  const total = editMoney(subtotal - Number(discount) + Number(delivery) + Number(wrapping));
  const validMoney = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) < 0.00001;
  const valid = rows.length > 0 && rows.every(row => row.product_id && row.quantity.trim() && Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity) > 0 && validMoney(row.unit_price)) &&
    [discount, delivery, wrapping].every(validMoney) && Number(discount) <= subtotal;
  const changed = preview && canonicalJson(draft) !== canonicalJson(preview.draft);
  const patchRow = (index: number, patch: Partial<DraftRow>) => {setRows(previous => previous.map((row, at) => at === index ? {...row, ...patch} : row)); setSaved(false);};
  const chooseProduct = (index: number, id: string) => {
    const product = preview.products.find((value: any) => value.id === id);
    let price = '';
    if (product && normalizedProductType(product) !== 'variant') price = String(buildOrderItemSnapshot(product, 1, preview.settings, undefined, preview.products).unit_price);
    patchRow(index, {product_id: id, variant_id: undefined, bundle_variants: undefined, source_index: undefined, unit_price: price});
  };
  const chooseVariant = (index: number, id: string) => {
    const row = rows[index], product = preview.products.find((value: any) => value.id === row.product_id), variant = product.variants.find((value: any) => value.id === id);
    const previous = product.variants.find((value: any) => value.id === row.variant_id);
    const price = variant ? String(previous && Number(previous.selling_price) === Number(variant.selling_price) ? row.unit_price : buildOrderItemSnapshot(product, 1, preview.settings, variant, preview.products).unit_price) : '';
    patchRow(index, {variant_id: id || undefined, unit_price: price});
  };
  const execute = (action: {input: ItemEditInput; order_number: string}) => work(async () => {
    localStorage.setItem(key, JSON.stringify(action)); setPending(action);
    let result: any;
    try {result = await orderItemEditRequest('', action.input);} catch (error: any) {
      if (error.retryRequired === false) {localStorage.removeItem(key); setPending(null); setPreview(null);}
      throw error;
    }
    localStorage.removeItem(key); setPending(null); setSaved(true);
    setPreview((previous: any) => previous ? {...previous, order: result.order, stock_history: result.stock_history} : {order: result.order, stock_history: result.stock_history});
    // Lookup afresh so downloads and a second edit use the committed snapshot.
    try {applyPreview(await orderItemEditRequest('?order_id=' + encodeURIComponent(result.order.id)));}
    catch {setNotice('Items and stock saved. Search this order again to refresh its editor.');}
    try {await refreshReturnInventory();} catch {setNotice('Items and stock saved. Refresh the system to see its latest stock.');}
  });
  const save = () => {
    if (!preview || !valid || !changed || !reason.trim()) return;
    void execute({order_number: preview.order.order_number, input: {...draft, order_id: preview.order.id, operation_id: crypto.randomUUID(),
      expected_identity: preview.expected_identity, reason: reason.trim()}});
  };
  const freshInvoice = async () => {
    const current = await orderItemEditRequest('?order_id=' + encodeURIComponent(preview.order.id));
    if (!current.order.invoice_locked || !current.order.stock_allocated || !current.order.waybill_number) throw new Error('This order has no printable invoice yet.');
    if (current.order.item_edit_lock || current.edit_error?.includes('finishing')) throw new Error('Finish the saved item edit before printing its invoice.');
    if (preview.order.invoice_pack_batch_id !== current.order.invoice_pack_batch_id) {applyPreview(current); throw new Error('The invoice changed. Its latest items are now shown; download again.');}
    return current;
  };
  const download = (format: CorrectedInvoiceFormat) => work(async () => {
    const current = await freshInvoice();
    await downloadCorrectedInvoice(current.order, current.settings, format);
    await markInvoiceBatchDownloaded([current.order.id], undefined, undefined, [current.order]);
    setNotice('Invoice downloaded.');
  });
  if (adminUser?.role !== 'admin') return null;
  const editing = preview?.can_edit && !busy && !pending;
  return <section className="mx-auto max-w-6xl space-y-5 text-neutral-900">
    <div><h2 className="text-2xl font-black">Edit Order Items</h2><p className="mt-2 text-sm text-neutral-600">Order ID / Waybill එකෙන් හොයලා items, colours, quantities සහ ගණන් හදන්න.</p></div>
    <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-neutral-200 bg-white p-4" onSubmit={event => {event.preventDefault(); void lookup('?search=' + encodeURIComponent(search.trim()));}}>
      <label className="min-w-48 flex-1 text-xs font-bold">Order ID or waybill<input aria-label="Order ID or waybill" value={search} onChange={event => setSearch(event.target.value)} placeholder="FB-000659 or 18160741" disabled={busy || !!pending} className={field + ' mt-2'}/></label>
      <button className={button} type="submit" disabled={busy || !!pending || !search.trim()}>{busy ? 'Loading…' : 'Search Order'}</button>
    </form>
    {pending && <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5"><b>Finish saved item edit • {pending.order_number}</b><p className="text-sm">The server has not confirmed this edit yet. Retry the same saved details.</p><button type="button" disabled={busy} onClick={() => void execute(pending)} className={button}>{busy ? 'Finishing…' : 'Retry Saved Item Edit'}</button></div>}
    {preview?.order && !pending && <div className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-xl font-black">{preview.order.order_number}</h3><p className="mt-1 text-sm text-neutral-600">{preview.order.customer_name} • {preview.order.order_status}</p></div><p className="text-sm">Waybill: <b>{preview.order.waybill_number || 'Not assigned'}</b><br/>Invoice: <b>{preview.order.invoice_number || 'Not generated'}</b></p></div>
      {saved && <p role="status" className="rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">Items, amounts and stock saved.</p>}
      {preview.edit_error && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{preview.edit_error}</p>}
      {preview.draft && <>
        <p className="text-sm text-neutral-600">{preview.order.stock_allocated ? 'Old stock is released and the new items consume only the difference. Existing invoice and waybill numbers are retained.' : 'These items have no stock allocated yet. Normal stock allocation will use the saved items.'}</p>
        <div className="space-y-3">{rows.map((row, index) => {
          const product = preview.products.find((value: any) => value.id === row.product_id), type = normalizedProductType(product);
          return <div key={index} className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.5fr_.7fr_1fr_1fr]">
              <label className="text-xs font-bold">Item {index + 1}<select aria-label={'Product ' + (index + 1)} value={row.product_id} disabled={!editing} onChange={event => chooseProduct(index, event.target.value)} className={field + ' mt-1'}><option value="">Select item</option>{!product && row.product_id && <option value={row.product_id}>Missing: {row.product_id}</option>}{preview.products.map((value: any) => <option key={value.id} value={value.id}>{value.sku} · {value.name_en}</option>)}</select></label>
              <label className="text-xs font-bold">Colour / variant{type === 'variant' ? <select aria-label={'Variant ' + (index + 1)} value={row.variant_id || ''} onChange={event => chooseVariant(index, event.target.value)} disabled={!editing} className={field + ' mt-1'}><option value="">Select exact colour</option>{product.variants.map((variant: any) => <option key={variant.id} value={variant.id}>{variantOptionSummary(variant)} · stock {variant.stock_quantity}</option>)}</select> : <p className="mt-3 text-sm font-normal">{type === 'bundle' ? 'Combo components below' : 'Standard item'}</p>}</label>
              <label className="text-xs font-bold">Quantity<input type="number" min="1" step="1" aria-label={'Quantity ' + (index + 1)} value={row.quantity} onChange={event => patchRow(index, {quantity: event.target.value})} disabled={!editing} className={field + ' mt-1'}/></label>
              <label className="text-xs font-bold">Unit price (Rs.)<input type="number" min="0" step="0.01" aria-label={'Unit price ' + (index + 1)} value={row.unit_price} onChange={event => patchRow(index, {unit_price: event.target.value})} disabled={!editing} className={field + ' mt-1'}/></label>
              <div className="text-xs font-bold">Line total<p className="mt-3 text-base">Rs. {amount(editMoney(Number(row.quantity) * Number(row.unit_price)))}</p></div>
            </div>
            {type === 'bundle' && (product.bundle_components || []).map((component: any, at: number) => {const child = preview.products.find((value: any) => value.id === component.product_id); return normalizedProductType(child) === 'variant' && <label key={at} className="block text-xs font-bold">{child?.name_en} × {component.quantity}<select aria-label={'Combo colour ' + (index + 1) + '-' + at} value={row.bundle_variants?.[String(at)] || component.variant_id || ''} onChange={event => patchRow(index, {bundle_variants: {...row.bundle_variants, [String(at)]: event.target.value}})} disabled={!editing} className={field + ' mt-1'}><option value="">Select exact colour</option>{(child?.variants || []).map((variant: any) => <option key={variant.id} value={variant.id}>{variantOptionSummary(variant)} · stock {variant.stock_quantity}</option>)}</select></label>;})}
            <div className="flex flex-wrap gap-4 text-xs font-bold"><button type="button" disabled={!editing || Number(row.quantity) < 2 || rows.length >= 100} onClick={() => {setRows(previous => previous.flatMap((value, at) => at === index ? [{...value, quantity: String(Number(value.quantity) - 1)}, {...value, quantity: '1'}] : [value])); setSaved(false);}} className="text-blue-700 disabled:opacity-30">Split colour / item row</button><button type="button" disabled={!editing || rows.length <= 1} onClick={() => {setRows(previous => previous.filter((_, at) => at !== index)); setSaved(false);}} className="text-red-700 disabled:opacity-30">Remove item</button></div>
          </div>;
        })}</div>
        <button type="button" disabled={!editing || rows.length >= 100} onClick={() => {setRows(previous => [...previous, {product_id: '', quantity: '1', unit_price: ''}]); setSaved(false);}} className="rounded-xl border border-blue-300 px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-40">+ Add Item / Variant</button>
        <div className="grid gap-4 rounded-xl bg-neutral-50 p-4 sm:grid-cols-3">
          {[['Order discount (Rs.)', discount, setDiscount], ['Delivery (Rs.)', delivery, setDelivery], ['Wrapping (Rs.)', wrapping, setWrapping]].map(([label, value, setter]: any) => <label key={label} className="text-xs font-bold">{label}<input type="number" min="0" step="0.01" aria-label={label} value={value} onChange={event => {setter(event.target.value); setSaved(false);}} disabled={!editing} className={field + ' mt-1'}/></label>)}
        </div>
        <p className="text-xs text-neutral-600">Order discount applies after the unit prices above. Check the discount when changing quantity. Colour changes with the same price keep the saved unit price.</p>
        <div className="flex flex-wrap justify-end gap-6 text-sm"><p>Items subtotal: <b>Rs. {amount(subtotal)}</b></p><p className="text-lg">New total: <b>Rs. {amount(total)}</b></p></div>
        <label className="block text-xs font-bold">Reason<input aria-label="Item edit reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={!editing} className={field + ' mt-1'}/></label>
        <button type="button" disabled={!editing || !valid || !changed || !reason.trim()} onClick={save} className={button}>{busy ? 'Saving…' : 'Save Items, Amounts & Stock'}</button>
      </>}
      {(preview.stock_history || []).length > 0 && <div className="text-sm text-emerald-800">{preview.stock_history.map((row: any) => <p key={row.id}>{row.sku}: {row.previous_stock} → {row.new_stock} available</p>)}</div>}
      {preview.order.invoice_locked && <div className="space-y-3 border-t border-neutral-200 pt-5"><h4 className="font-black">Download Current Invoice</h4><p className="text-xs text-neutral-600">Waybill {preview.order.waybill_number} · Invoice {preview.order.invoice_number}. All item pages are included.</p><div className="flex flex-wrap gap-2">{correctedInvoiceFormats.map(format => <button key={format.id} type="button" disabled={busy || !!pending || !!changed} onClick={() => void download(format.id)} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{format.label}</button>)}<button type="button" disabled={busy || !!pending || !!changed} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => void work(async () => {const current = await freshInvoice(); await markFardarCsvExported([current.order.id]); downloadReturnBlob(new Blob([returnPackingCsv([current.order], current.settings)], {type: 'text/csv;charset=utf-8;'}), current.order.order_number + '_Corrected_Fardar.csv'); setNotice('Fardar CSV downloaded.');})}>Fardar CSV</button></div></div>}
    </div>}
    {notice && <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">{notice}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800">{error}</p>}
  </section>;
};
