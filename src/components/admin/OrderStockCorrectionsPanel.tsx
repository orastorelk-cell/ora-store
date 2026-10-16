import React, { useRef, useState } from 'react';
import { Search, PackageCheck, RotateCcw, ShieldAlert } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { staffJsonRequest } from '../../lib/staffRequest';

const retryKey = 'ora_order_stock_correction_retry_v1';
const request = async (path: string, input?: unknown) => {
  const result = await staffJsonRequest(path, {method: input === undefined ? 'GET' : 'POST', headers: {
    authorization: 'Bearer ' + (localStorage.getItem('ora_staff_session_token') || ''), 'content-type': 'application/json',
  }, ...(input === undefined ? {} : {body: JSON.stringify(input)})});
  if (!result.ok) throw new Error(result.error || 'The server did not confirm this action.');
  return result;
};
const field = 'rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-white disabled:opacity-50';
const readRetry = () => {try {return JSON.parse(localStorage.getItem(retryKey) || 'null');} catch {return null;}};

export const OrderStockCorrectionsPanel: React.FC = () => {
  const {adminUser, refreshReturnInventory} = useStore();
  const [search, setSearch] = useState(''), [preview, setPreview] = useState<any>(null);
  const [quantities, setQuantities] = useState<string[]>([]), [reason, setReason] = useState('');
  const [mode, setMode] = useState<'quantity'|'cancel'>('quantity'), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState<any>(null);
  const [pending, setPending] = useState<any>(readRetry), busyRef = useRef(false);
  const work = async (action: () => Promise<void>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try {await action();} catch (error: any) {setError(error.message || 'Retry the saved action.');} finally {busyRef.current = false; setBusy(false);}
  };
  const lookup = (value = search) => work(async () => {
    if (pending) throw new Error('Finish the saved action below before opening another order.');
    setPreview(null); setSaved(null); setConfirmed(false); setReason('');
    const result = await request('/api/orders/stock-quantity?search=' + encodeURIComponent(value.trim()));
    setPreview(result); setQuantities(result.item_quantities.map(String));
  });
  const execute = (action: any) => work(async () => {
    localStorage.setItem(retryKey, JSON.stringify(action)); setPending(action);
    let result: any;
    try {result = await request(action.path, action.input);} catch (error: any) {
      // The same durable request stays available after timeouts and partial saves.
      // A known validation rejection requires a fresh current-order preview.
      if (error.status && error.status < 500 && error.status !== 429 && !/finishing|retry.*saved|operation/i.test(error.message)) {
        localStorage.removeItem(retryKey); setPending(null); setPreview(null);
      }
      throw error;
    }
    localStorage.removeItem(retryKey); setPending(null); setSaved({mode: action.mode, result}); setPreview(null); setConfirmed(false);
    try {await refreshReturnInventory();} catch {setError('The action is saved. Refresh the system to see the latest stock.');}
  });
  const save = () => {
    if (!preview || !confirmed || !reason.trim()) return;
    const order = preview.order;
    execute({mode, path: mode === 'cancel' ? '/api/orders/cancel-before-dispatch' : '/api/orders/stock-quantity', input: {
      order_id: order.id, waybill_number: String(order.waybill_number || ''), reason: reason.trim(),
      ...(mode === 'quantity' ? {operation_id: crypto.randomUUID(), expected_identity: preview.expected_identity, item_quantities: quantities.map(Number)} : {}),
    }});
  };
  if (adminUser?.role !== 'admin') return null;
  const valid = preview && quantities.every((value, index) => value.trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= preview.order.items[index].quantity);
  const changed = preview && quantities.some((value, index) => Number(value) !== preview.item_quantities[index]);
  return <section className="mx-auto max-w-5xl space-y-5 text-white">
    <div><h2 className="flex items-center gap-2 text-2xl font-black text-gray-900"><PackageCheck className="text-orange-400"/>Order Stock Corrections</h2>
      <p className="mt-2 text-sm text-gray-600">යවපු ප්‍රමාණය අනුව stock හදන්න, නැත්නම් නොයවපු printed order එක cancel කරන්න.</p></div>
    <form onSubmit={event => {event.preventDefault(); void lookup();}} className="flex flex-wrap gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <label className="min-w-48 flex-1 text-xs font-bold text-neutral-300">Order ID or waybill
        <input aria-label="Order ID or waybill" placeholder="FB-000657 or 18160739" value={search} onChange={event => setSearch(event.target.value)} disabled={busy || !!pending} className={field + ' mt-2 w-full'}/></label>
      <button type="submit" disabled={busy || !!pending || !search.trim()} className="mt-auto flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-black text-black disabled:opacity-40"><Search size={16}/>{busy ? 'Loading…' : 'Search Order'}</button>
    </form>
    {pending && <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-neutral-900 p-5">
      <b>Saved action needs confirmation from the server</b><p className="text-sm">Order {pending.input.order_id} • waybill {pending.input.waybill_number}. Retry this same action to finish safely.</p>
      <button type="button" disabled={busy} onClick={() => execute(pending)} className="rounded-xl bg-amber-400 px-4 py-2 font-bold text-black disabled:opacity-40">{busy ? 'Finishing…' : 'Retry Saved Action'}</button>
    </div>}
    {preview && !pending && <div className="space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-xl font-black">{preview.order.order_number}</h3><p className="mt-1 text-sm text-neutral-400">Waybill {preview.order.waybill_number || '—'} • {preview.order.order_status}</p></div>
        <div className="text-sm text-neutral-300">Invoice {preview.order.invoice_number || '—'}<p className="mt-1 text-xs text-neutral-500">{preview.order.invoice_pack_batch_id}</p></div></div>
      {preview.order.stock_quantity_correction && <div className="space-y-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
        <b>Last quantity correction saved</b><p>{preview.order.stock_quantity_correction.reason}</p>
        {(preview.stock_history || []).map((row: any) => <p key={row.id}>{row.sku}: {row.previous_stock} → {row.new_stock} available at correction</p>)}
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => {setMode('quantity'); setConfirmed(false);}} className={'rounded-xl border px-4 py-2 text-sm font-bold ' + (mode === 'quantity' ? 'border-orange-400 bg-orange-500/15 text-orange-300' : 'border-neutral-700')}>Correct Deducted Quantity</button>
        <button type="button" disabled={busy} onClick={() => {setMode('cancel'); setConfirmed(false);}} className={'rounded-xl border px-4 py-2 text-sm font-bold ' + (mode === 'cancel' ? 'border-red-400 bg-red-500/15 text-red-300' : 'border-neutral-700')}>Cancel Before Dispatch</button>
      </div>
      {mode === 'quantity' ? <>
        <p className="text-sm text-neutral-300">Enter the quantity actually sent. For 5 ordered and 2 sent, enter 2 to release 3 to available stock. Invoice quantities, totals and the existing waybill stay as saved.</p>
        {!preview.can_correct && <p role="alert" className="text-sm text-amber-300">{preview.correction_error}</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-neutral-400"><tr><th className="p-2">Item</th><th className="p-2">Ordered</th><th className="p-2">Currently deducted</th><th className="p-2">Actually sent / deduct</th><th className="p-2">Stock change</th></tr></thead>
          <tbody>{preview.order.items.map((item: any, index: number) => {const delta = preview.item_quantities[index] - Number(quantities[index]); return <tr key={index} className="border-t border-neutral-800"><td className="p-2 font-bold">{item.product_name}<p className="mt-1 text-xs text-neutral-400">{item.sku} {item.variant_name}{item.product_type === 'bundle' ? ' • bundle units' : ''}</p></td><td className="p-2">{item.quantity}</td><td className="p-2">{preview.item_quantities[index]}</td><td className="p-2"><input type="number" min="0" max={item.quantity} step="1" aria-label={'Actual quantity item ' + (index + 1)} value={quantities[index]} onChange={event => {const value = event.target.value; setQuantities(previous => previous.map((qty, at) => at === index ? value : qty)); setConfirmed(false);}} disabled={busy || !preview.can_correct} className={field + ' w-28'}/></td><td className={'p-2 font-black ' + (delta >= 0 ? 'text-emerald-300' : 'text-amber-300')}>{Number.isFinite(delta) ? (delta > 0 ? '+' : '') + delta : '—'}</td></tr>;})}</tbody></table></div>
        <p className="text-xs text-neutral-400">Bundle changes apply to their exact components. A quantity correction creates no invoice, packing batch, waybill or follow-up order.</p>
      </> : <>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><b className="flex items-center gap-2 text-red-300"><ShieldAlert size={16}/>Cancel this unshipped parcel</b><p className="mt-2">Release only its remaining deducted stock and permanently block waybill {preview.order.waybill_number || 'if assigned'} from reuse. The original invoice stays in history.</p></div>
        <div className="space-y-2 text-sm">{preview.cancellation.items.map((item: any, index: number) => <p key={index}>{item.item} • {item.sku} • return {item.quantity} to stock</p>)}</div>
        {preview.cancellation.complete ? <p className="text-emerald-300">Already cancelled. Stock restored and waybill blocked.</p> : !preview.cancellation.can_cancel && <p role="alert" className="text-amber-300">{preview.cancellation.cancellation_error}</p>}
      </>}
      <label className="block text-xs font-bold text-neutral-300">Reason<textarea aria-label="Stock correction reason" value={reason} onChange={event => setReason(event.target.value)} disabled={busy} rows={2} maxLength={2000} className={field + ' mt-2 w-full'}/></label>
      <label className="flex items-start gap-3 text-sm text-neutral-300"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy}/>{mode === 'quantity' ? 'I checked the actual quantities sent and the stock change above.' : 'This parcel was not dispatched. Cancel it, restore its stock and permanently block its waybill.'}</label>
      <button type="button" onClick={save} disabled={busy || !confirmed || !reason.trim() || (mode === 'quantity' ? !preview.can_correct || !valid || !changed : !preview.cancellation.can_cancel || preview.cancellation.complete)} className={'flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black disabled:opacity-40 ' + (mode === 'quantity' ? 'bg-orange-500 text-black' : 'bg-red-600 text-white')}><RotateCcw size={16}/>{busy ? 'Saving…' : mode === 'quantity' ? 'Save Quantity & Adjust Stock' : 'Cancel Order, Restore Stock & Block Waybill'}</button>
    </div>}
    {saved && <div role="status" className="space-y-2 rounded-2xl border border-emerald-500/40 bg-neutral-900 p-5">
      <h3 className="font-black text-emerald-300">{saved.mode === 'quantity' ? 'Stock quantity saved' : 'Order cancelled, stock restored and waybill blocked'} • {saved.result.order?.order_number || saved.result.order_number}</h3>
      {(saved.result.stock_history || saved.result.stock_restored || []).map((row: any) => <p key={row.id} className="text-sm">{row.sku || row.product_name}: {row.previous_stock} → {row.new_stock} available</p>)}
      <p className="text-sm">Waybill {saved.result.order?.waybill_number || saved.result.waybill_number} • Invoice {saved.result.order?.invoice_number || saved.result.invoice_number} preserved.</p>
      <p className="text-xs text-neutral-400">No new invoice was created.</p>
    </div>}
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">{error}</p>}
  </section>;
};
