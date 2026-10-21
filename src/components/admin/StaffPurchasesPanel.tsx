import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, Search, ShoppingBag, Trash2, Users } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { normalizedProductType, variantOptionSummary } from '../../lib/productVariants';
import { acknowledgeStaffPurchase, parseStaffPurchase, pendingStaffPurchases, rememberStaffPurchase, type StaffPurchase, type StaffPurchaseInput } from '../../lib/staffPurchases';
import { staffPurchaseRequest } from '../../lib/staffPurchaseClient';

type Line = { id: string; selection: string; quantity: string; price: string };
type Choice = { key: string; product_id: string; variant_id?: string; label: string; stock: number };
const newLine = (): Line => ({ id: crypto.randomUUID(), selection: '', quantity: '1', price: '' });
const field = 'w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-white disabled:opacity-50';
const money = (value: number) => 'Rs. ' + value.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' });

export const StaffPurchasesPanel: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { adminUser, products, refreshReturnInventory } = useStore();
  const user = String(adminUser?.id || '');
  const [staff, setStaff] = useState(''), [notes, setNotes] = useState(''), [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [pending, setPending] = useState<StaffPurchaseInput[]>([]), [saved, setSaved] = useState<StaffPurchase | null>(null);
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [error, setError] = useState(''), [refreshNeeded, setRefreshNeeded] = useState(false);
  const [search, setSearch] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [history, setHistory] = useState<{ purchases: StaffPurchase[]; total: number; total_quantity: number; total_amount: number } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState('');
  const choices = useMemo<Choice[]>(() => products.flatMap<Choice>(product => {
    if (normalizedProductType(product) === 'bundle') return [];
    if (normalizedProductType(product) === 'variant') return (product.variants || []).map(variant => ({
      key: JSON.stringify([product.id, variant.id]), product_id: product.id, variant_id: variant.id,
      label: '[' + variant.sku + '] ' + product.name_en + ' • ' + variantOptionSummary(variant), stock: Number(variant.stock_quantity || 0),
    }));
    return [{ key: JSON.stringify([product.id, '']), product_id: product.id, variant_id: undefined as string | undefined,
      label: '[' + product.sku + '] ' + product.name_en, stock: Number(product.stock_quantity || 0) }];
  }).sort((a, b) => a.label.localeCompare(b.label)), [products]);
  const choiceMap = new Map<string, Choice>(choices.map(choice => [choice.key, choice] as const));
  const total = lines.reduce((sum, line) => sum + Math.round(Number(line.price || 0) * 100) * Number(line.quantity || 0), 0) / 100;
  const locked = busy || pending.length > 0 || refreshNeeded;
  const readPending = () => {
    try { const values = pendingStaffPurchases(localStorage, user); setPending(values); return values; }
    catch { setError('A saved staff purchase in this browser could not be read. Keep this tab open and check its history before creating another purchase.'); setRefreshNeeded(true); return []; }
  };
  useEffect(() => {
    readPending();
    const onStorage = () => { if (!busyRef.current) readPending(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user]);
  useEffect(() => {
    let active = true;
    setHistoryLoading(true); setHistoryError('');
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ search, from, to, page: String(page) });
      void staffPurchaseRequest('?' + query).then(data => { if (active) setHistory(data); })
        .catch(error => { if (active) setHistoryError(error.message); }).finally(() => { if (active) setHistoryLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, from, to, page, reload]);
  const update = (id: string, patch: Partial<Line>) => setLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line));
  const refreshStock = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await refreshReturnInventory(); setRefreshNeeded(false); setReload(value => value + 1); }
    catch (error: any) { setError(error.message); setRefreshNeeded(true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = async (retry?: StaffPurchaseInput) => {
    if (busyRef.current || !canEdit) return;
    busyRef.current = true; setBusy(true); setError(''); setSaved(null);
    let input = retry;
    try {
      if (!input) {
        const awaiting = pendingStaffPurchases(localStorage, user);
        if (awaiting.length) { setPending(awaiting); throw new Error('Finish the saved purchase before starting another one.'); }
        await refreshReturnInventory();
        input = parseStaffPurchase({ operation_id: crypto.randomUUID(), staff_name: staff, notes, items: lines.map(line => {
          const choice = choiceMap.get(line.selection);
          return { product_id: choice?.product_id, ...(choice?.variant_id ? { variant_id: choice.variant_id } : {}), quantity: Number(line.quantity), unit_price: line.price.trim() ? Number(line.price) : null };
        }) });
      }
      rememberStaffPurchase(localStorage, user, input); readPending();
      const result = await staffPurchaseRequest('', input);
      setSaved(result.purchase);
      acknowledgeStaffPurchase(localStorage, user, input); readPending();
      setStaff(''); setNotes(''); setLines([newLine()]); setReload(value => value + 1);
      try { await refreshReturnInventory(); setRefreshNeeded(false); }
      catch { setRefreshNeeded(true); setError('Purchase saved. Refresh stock before adding another staff purchase.'); }
    } catch (error: any) {
      setError(error.message);
      // These rejections are known to happen before the atomic commit. Keep
      // uncertain responses and in-progress stock locks for the exact retry.
      if (input && [400, 403, 409].includes(error.status) && !/finishing/i.test(error.message)) {
        acknowledgeStaffPurchase(localStorage, user, input); readPending();
      }
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <section className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-black text-gray-900"><Users className="text-orange-500"/>Staff Purchases</h2>
      <p className="mt-1 text-sm text-gray-600">Staff ගන්න බඩු සහ එකකට දෙන මිල දාලා stock එකෙන් අඩු කරන්න.</p></div>
      <button type="button" data-ora-view-allowed="true" onClick={refreshStock} disabled={busy} className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 disabled:opacity-40"><RefreshCw size={16}/>Refresh Stock</button></div>
    {pending.map(input => <div key={input.operation_id} className="space-y-2 rounded-2xl border border-amber-500/40 bg-neutral-900 p-4 text-sm text-white">
      <b>Purchase awaiting confirmation • {input.staff_name}</b>
      {input.items.map((item, index) => <p key={index}>{choices.find(choice => choice.product_id === item.product_id && choice.variant_id === item.variant_id)?.label || item.product_id} × {item.quantity} • {money(item.unit_price)} each</p>)}
      <button type="button" disabled={busy || !canEdit} onClick={() => void save(input)} className="rounded-xl bg-amber-400 px-4 py-2 font-black text-black disabled:opacity-40">{busy ? 'Saving…' : 'Retry Saved Purchase'}</button>
    </div>)}
    {saved && <div role="status" className="space-y-1 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"><b>Staff purchase saved • {saved.purchase_number}</b>
      <p>{saved.staff_name} • {money(saved.total_amount)}</p>{saved.stock_history.map(row => <p key={row.id}>{row.product_name}: {row.previous_stock} → {row.new_stock} available</p>)}</div>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
    {canEdit && <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5 text-white">
      <div><h3 className="flex items-center gap-2 font-black"><ShoppingBag size={18} className="text-orange-400"/>New Staff Purchase</h3><p className="mt-1 text-xs text-neutral-400">එකකට දෙන staff මිල manually දාන්න. Total එක quantity අනුව ගණනය වේ.</p></div>
      <label className="block text-xs font-bold text-neutral-300">Staff member name<input aria-label="Staff member name" required maxLength={120} value={staff} onChange={event => setStaff(event.target.value)} disabled={locked} className={field + ' mt-2'} placeholder="Enter staff name"/></label>
      {lines.map((line, index) => { const choice = choiceMap.get(line.selection); return <div key={line.id} className="grid grid-cols-2 gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 lg:grid-cols-[minmax(0,1fr)_100px_150px_130px_40px] lg:items-end">
        <label className="col-span-2 text-xs font-bold text-neutral-300 lg:col-span-1">Item / exact colour
          <select aria-label={'Staff item ' + (index + 1)} value={line.selection} required disabled={locked} onChange={event => update(line.id, { selection: event.target.value, price: '' })} className={field + ' mt-2'}>
            <option value="">Select item / colour…</option>{choices.map(option => <option key={option.key} value={option.key}>{option.label} • Stock {option.stock}</option>)}
          </select><span className="mt-1 block text-[11px] text-neutral-500">Available stock: {choice?.stock ?? '—'}</span>
        </label>
        <label className="text-xs font-bold text-neutral-300">Quantity<input aria-label={'Staff quantity ' + (index + 1)} required type="number" min="1" max={choice?.stock ?? 1_000_000} step="1" value={line.quantity} disabled={locked} onChange={event => update(line.id, { quantity: event.target.value })} className={field + ' mt-2'}/></label>
        <label className="text-xs font-bold text-neutral-300">Staff price / each (Rs.)<input aria-label={'Staff unit price ' + (index + 1)} required type="number" min="0.01" max="1000000000" step="0.01" placeholder="Enter price" value={line.price} disabled={locked} onChange={event => update(line.id, { price: event.target.value })} className={field + ' mt-2'}/></label>
        <div className="self-center text-sm"><p className="text-[11px] text-neutral-400">Line total</p><b className="text-emerald-300">{money(Math.round(Number(line.price || 0) * 100) * Number(line.quantity || 0) / 100)}</b></div>
        <button type="button" aria-label={'Remove staff item ' + (index + 1)} disabled={locked || lines.length === 1} onClick={() => setLines(current => current.filter(value => value.id !== line.id))} className="justify-self-end rounded-xl p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-30"><Trash2 size={17}/></button>
      </div>; })}
      <button type="button" disabled={locked || lines.length >= 50} onClick={() => setLines(current => [...current, newLine()])} className="flex items-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-xs font-bold disabled:opacity-40"><Plus size={15}/>Add Another Item</button>
      <label className="block text-xs font-bold text-neutral-300">Notes (optional)<textarea aria-label="Staff purchase notes" rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} disabled={locked} className={field + ' mt-2'}/></label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 pt-4"><div><p className="text-xs text-neutral-400">Staff purchase total</p><b className="text-2xl text-emerald-300">{money(total)}</b></div>
        <button type="submit" disabled={locked} className="rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-black hover:bg-orange-400 disabled:opacity-40">{busy ? 'Saving Staff Purchase…' : 'Save Purchase & Deduct Stock'}</button></div>
    </form>}
    <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 text-white">
      <div className="space-y-3 border-b border-neutral-800 p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-black">Staff Purchase History</h3><button data-ora-view-allowed="true" type="button" disabled={historyLoading} onClick={() => setReload(value => value + 1)} className="text-xs font-bold text-orange-300">{historyLoading ? 'Loading…' : 'Refresh History'}</button></div>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_160px]"><label className="relative"><Search className="absolute left-3 top-3 text-neutral-500" size={16}/><input data-ora-view-allowed="true" aria-label="Search staff purchases" value={search} maxLength={200} placeholder="Search staff, item code or purchase…" onChange={event => { setSearch(event.target.value); setPage(1); }} className={field + ' pl-9'}/></label>
          <label className="text-xs text-neutral-400">From<input data-ora-view-allowed="true" aria-label="Staff purchases from date" type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} className={field}/></label>
          <label className="text-xs text-neutral-400">To<input data-ora-view-allowed="true" aria-label="Staff purchases to date" type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} className={field}/></label></div>
        {history && !historyLoading && !historyError && <p className="text-xs text-neutral-400">{history.total} purchases • {history.total_quantity} items • <b className="text-emerald-300">{money(history.total_amount)}</b></p>}
        {historyError && <p role="alert" className="text-sm text-red-300">{historyError}</p>}
      </div>
      {history && !historyLoading && !historyError && <>{history.purchases.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-neutral-950 text-xs text-neutral-400"><tr><th className="p-3">Date / purchase</th><th className="p-3">Staff member</th><th className="p-3">Items & staff prices</th><th className="p-3 text-right">Total</th><th className="p-3">Recorded by</th></tr></thead><tbody className="divide-y divide-neutral-800">
        {history.purchases.map(purchase => <tr key={purchase.operation_id}><td className="p-3 align-top text-xs text-neutral-400">{date(purchase.created_at)}<p className="mt-1 font-mono text-orange-300">{purchase.purchase_number}</p></td><td className="p-3 align-top font-bold">{purchase.staff_name}{purchase.notes && <p className="mt-1 max-w-56 whitespace-pre-wrap text-xs font-normal text-neutral-400">{purchase.notes}</p>}</td>
          <td className="p-3">{purchase.items.map((item, index) => <p key={index} className="mb-1">{item.product_name}{item.variant_name ? ' • ' + item.variant_name : ''}<span className="block text-xs text-neutral-400">{item.sku} • {item.quantity} × {money(item.unit_price)} = {money(item.line_total)}</span></p>)}</td><td className="p-3 text-right align-top font-black text-emerald-300">{money(purchase.total_amount)}</td><td className="p-3 align-top text-xs text-neutral-400">{purchase.created_by}</td></tr>)}
      </tbody></table></div> : <p className="p-6 text-center text-sm text-neutral-400">No staff purchases found.</p>}
        <div className="flex items-center justify-between border-t border-neutral-800 p-3 text-xs"><button data-ora-view-allowed="true" type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="px-3 py-2 font-bold disabled:opacity-30">Previous</button><span>Page {page} of {Math.max(1, Math.ceil(history.total / 30))}</span><button data-ora-view-allowed="true" type="button" disabled={page * 30 >= history.total} onClick={() => setPage(value => value + 1)} className="px-3 py-2 font-bold disabled:opacity-30">Next</button></div>
      </>}
    </div>
  </section>;
};
