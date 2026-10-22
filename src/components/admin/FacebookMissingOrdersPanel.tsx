import React, {useRef, useState} from 'react';
import {useStore} from '../../context/StoreContext';
import {compareFacebookLeads, type FacebookAuditLead, type FacebookMissingSnapshot} from '../../lib/facebookMissingOrders';
import {facebookMissingRequest, scanMissingFacebookLeads} from '../../lib/facebookMissingClient';

const dateAt = (offset = 0) => new Date(Date.now() + 330 * 60000 + offset * 86400000).toISOString().slice(0, 10);
const button = 'rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-40';
type Pending = {page_id: string; leads: FacebookAuditLead[]};

export const FacebookMissingOrdersPanel: React.FC = () => {
  const {adminUser, refreshReturnInventory} = useStore();
  const key = 'ora_facebook_missing_retry_v1:' + adminUser?.id;
  const saved = (): Pending | null => {try {const value = JSON.parse(localStorage.getItem(key) || 'null'); return value?.page_id && Array.isArray(value.leads) && value.leads.length ? value : null;} catch {return null;}};
  const [pending, setPending] = useState<Pending | null>(saved);
  const [from, setFrom] = useState(dateAt(-20)), [to, setTo] = useState(dateAt());
  const [leads, setLeads] = useState<FacebookAuditLead[]>([]), [pageId, setPageId] = useState('');
  const [snapshot, setSnapshot] = useState<FacebookMissingSnapshot | null>(null), [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [receipt, setReceipt] = useState(''), [errors, setErrors] = useState<Record<string, string>>({}), busyRef = useRef(false);
  const remember = (value: Pending | null) => {if (value?.leads.length) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); setPending(value?.leads.length ? value : null);};
  const work = async (task: () => Promise<void>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setReceipt('');
    try {await task();} catch (error: any) {setError(error.message || 'The check did not complete. Retry it.');}
    finally {busyRef.current = false; setBusy(false); setProgress('');}
  };
  const check = () => work(async () => {
    setSnapshot(null); setLeads([]); setSelected(new Set()); setErrors({});
    const since = new Date(from + 'T00:00:00+05:30').toISOString();
    const until = new Date(Math.min(Date.now(), Date.parse(to + 'T23:59:59+05:30'))).toISOString();
    if (Date.parse(since) > Date.parse(until) || Date.parse(since) < Date.now() - 91 * 86400000) throw new Error('Choose a valid date range within the last 90 days.');
    const result = await scanMissingFacebookLeads(since, until, setProgress);
    setLeads(result.leads); setPageId(result.page_id); setSnapshot(result.snapshot);
    setSelected(new Set(compareFacebookLeads(result.leads, result.snapshot).filter(row => row.can_import).map(row => row.lead_id)));
  });
  const rows = snapshot ? compareFacebookLeads(leads, snapshot) : [];
  const missing = rows.filter(row => !row.system_found || !row.sheet_found || row.issue);
  const sheetReview = snapshot?.sheet_review_orders || [];
  const reviewCount = new Set([...rows.filter(row => row.issue).map(row => row.order_number || row.lead_id), ...sheetReview.map(row => row.order_number), ...(snapshot?.unlinked_sheet_orders || [])]).size;
  const importable = rows.filter(row => row.can_import), chosen = importable.filter(row => selected.has(row.lead_id));
  const runImport = (input: Pending) => work(async () => {
    remember(input); setErrors({}); let left = [...input.leads], done = 0;
    for (let offset = 0; offset < input.leads.length; offset += 3) {
      const batch = input.leads.slice(offset, offset + 3);
      setProgress('Importing ' + (offset + 1) + '–' + Math.min(offset + 3, input.leads.length) + ' / ' + input.leads.length + '…');
      const data = await facebookMissingRequest({action: 'import', page_id: input.page_id, leads: batch});
      if (!Array.isArray(data.results) || data.results.length !== batch.length || !batch.every(lead => data.results.filter((result: any) => result.lead_id === lead.lead_id && typeof result.ok === 'boolean').length === 1))
        throw new Error('The import acknowledgment is incomplete. Retry the saved import.');
      if (data.snapshot) setSnapshot(data.snapshot);
      const success = new Set(data.results.filter((result: any) => result.ok).map((result: any) => result.lead_id));
      left = left.filter(lead => !success.has(lead.lead_id)); done += success.size;
      remember(left.length ? {...input, leads: left} : null);
      setErrors(previous => ({...previous, ...Object.fromEntries(data.results.filter((result: any) => !result.ok).map((result: any) => [result.lead_id, result.error || 'Retry this order.']))}));
    }
    setReceipt(done + ' order' + (done === 1 ? '' : 's') + ' verified in both the system and Google Sheet.' + (left.length ? ' ' + left.length + ' need review / retry.' : ''));
    setSelected(new Set(left.map(lead => lead.lead_id)));
    await refreshReturnInventory();
  });
  const retry = () => {
    if (!pending) return;
    if (!leads.length) {setLeads(pending.leads); setPageId(pending.page_id);}
    return runImport(pending);
  };
  if (adminUser?.role !== 'admin') return null;
  return <div className="space-y-5 rounded-2xl bg-white p-4 text-neutral-900 sm:p-6">
    <div><h2 className="text-xl font-bold">FB Missing Orders</h2><p className="mt-1 text-sm text-neutral-600">Facebook → Google Sheet → System. Check the last 3 weeks, then import the missing orders.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-bold">From · Sri Lanka<input aria-label="Check from date" type="date" min={dateAt(-89)} max={dateAt()} value={from} onChange={event => setFrom(event.target.value)} disabled={busy} className="mt-1 block rounded-xl border px-3 py-2 text-sm" /></label>
      <label className="text-xs font-bold">To · Sri Lanka<input aria-label="Check to date" type="date" min={from} max={dateAt()} value={to} onChange={event => setTo(event.target.value)} disabled={busy} className="mt-1 block rounded-xl border px-3 py-2 text-sm" /></label>
      <button type="button" className={button} disabled={busy || !from || !to} onClick={check}>Check Missing Orders</button>
      <button type="button" className={button} disabled={busy || !snapshot || !chosen.length || Boolean(pending)} onClick={() => runImport({page_id: pageId, leads: chosen})}>Import Selected Missing Orders ({chosen.length})</button>
    </div>
    <p className="text-xs text-neutral-600">Original Order IDs and Sheet edits are preserved. New leads enter as Pending. Confirm / Cancel decisions remain in the Sheet for the normal finalize workflow. Stock, invoices and waybills are handled there.</p>
    {pending && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><span>{pending.leads.length} saved import{pending.leads.length === 1 ? '' : 's'} waiting for verification.</span><button type="button" className={button} disabled={busy} onClick={retry}>Retry Saved Missing Orders</button><button type="button" disabled={busy} className="text-xs underline" onClick={() => remember(null)}>Dismiss saved retry</button></div>}
    {progress && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{progress}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Check / import incomplete: {error}</p>}
    {receipt && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{receipt}</p>}
    {snapshot && <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Facebook leads', rows.length], ['Missing in system', rows.filter(row => !row.system_found).length], ['Missing in Sheet', rows.filter(row => !row.sheet_found && !row.sheet_unverified).length], ['Need review', reviewCount]].map(([label, count]) => <div key={String(label)} className="rounded-xl bg-neutral-100 p-3"><p className="text-xs text-neutral-600">{label}</p><p className="text-2xl font-bold">{count}</p></div>)}</div>
      <p className="text-xs text-neutral-500">Checked {new Date(snapshot.checked_at).toLocaleString('en-LK', {timeZone: 'Asia/Colombo'})} · Sheet: {snapshot.target_tab} · {importable.length} ready to import.</p>
      {snapshot.unlinked_sheet_orders.length > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm">Sheet-only orders with missing or unverified Lead IDs: {snapshot.unlinked_sheet_orders.slice(0, 20).join(', ')}{snapshot.unlinked_sheet_orders.length > 20 ? '…' : ''}. Confirm the original IDs for these orders before importing a new order that may already be in the Sheet.</p>}
      {sheetReview.length > 0 && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-bold">Sheet Lead IDs to review ({sheetReview.length})</p><p className="mt-1 text-xs">Readable numeric IDs are accepted. Rounded IDs are matched using the original system Order ID. These remaining rows need their original Lead IDs:</p><ul className="mt-2 list-inside list-disc text-xs">{sheetReview.slice(0, 20).map(row => <li key={row.order_number}>{row.issue}</li>)}</ul>{sheetReview.length > 20 && <p className="mt-1 text-xs">{sheetReview.length - 20} more Sheet orders need review.</p>}</div>}
      {!missing.length ? <p role="status" className={'rounded-xl p-4 font-bold ' + (reviewCount ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800')}>{reviewCount ? 'Facebook leads checked. Review the Sheet Order IDs listed above before treating this check as complete.' : 'Check complete. No missing orders found in this date range.'}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2"><input aria-label="Select all missing orders" type="checkbox" disabled={busy || !importable.length} checked={Boolean(importable.length) && chosen.length === importable.length} onChange={event => setSelected(new Set(event.target.checked ? importable.map(row => row.lead_id) : []))} /></th><th className="p-2">Facebook lead / Order ID</th><th className="p-2">System</th><th className="p-2">Sheet</th><th className="p-2">Action / review</th></tr></thead><tbody>{missing.map(row => <tr key={row.lead_id} className="border-b align-top"><td className="p-2"><input aria-label={'Select lead ' + row.lead_id} type="checkbox" disabled={busy || !row.can_import} checked={selected.has(row.lead_id)} onChange={event => setSelected(previous => {const next = new Set(previous); event.target.checked ? next.add(row.lead_id) : next.delete(row.lead_id); return next;})} /></td><td className="p-2"><p className="font-mono text-xs">{row.order_number || 'New Order ID on import'}</p><p className="font-mono text-xs">Lead {row.lead_id}</p><p className="mt-1 text-xs text-neutral-500">{row.form_name || row.form_id} · {new Date(row.created_at).toLocaleDateString('en-LK', {timeZone: 'Asia/Colombo'})}</p></td><td className="p-2">{row.system_found ? 'Present' : 'Missing'}</td><td className="p-2">{row.sheet_unverified ? 'Verify Lead ID' : row.sheet_found ? 'Present' : 'Missing'}</td><td className="p-2 text-xs">{row.issue || (row.can_import ? 'Import to ' + (!row.system_found && !row.sheet_found ? 'system + Sheet' : !row.system_found ? 'system' : 'Sheet') : 'Verified')}{errors[row.lead_id] && <p className="mt-1 text-red-700">{errors[row.lead_id]}</p>}</td></tr>)}</tbody></table></div>}
    </>}
  </div>;
};
