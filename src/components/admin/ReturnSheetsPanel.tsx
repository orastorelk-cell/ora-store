import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, RefreshCw, Search, Upload, ArrowLeft, ScanLine } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { CameraBarcodeScanner } from './CameraBarcodeScanner';
import { parseReturnCsv, parcelReturnStatus, pendingReturnQty, summarizeReturnSheet, type ReturnParcel, type ReturnSheet, type ReturnSheetSummary } from '../../lib/returnSheets';

export const returnSheetRequest = async (path: string, body?: unknown) => {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (localStorage.getItem('ora_staff_session_token') || '') }, body: serialized });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) { const error: any = new Error(result.error || 'Return request failed (' + response.status + ').'); error.status = response.status; throw error; }
      return result;
    } catch (error: any) {
      if (attempt >= 2 || (error.status && ![429,500,502,503,504].includes(error.status))) throw error;
      await new Promise(resolve => setTimeout(resolve, [900,2200][attempt]));
    }
  }
};
type Entry = { choice: string; good: string; damaged: string };
const field = 'w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-white';
const button = 'rounded-xl border border-neutral-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-40';
const retryKey = (sheet: string, waybill: string) => 'ora_return_receipt_retry:' + sheet + ':' + waybill;

export const ReturnSheetsPanel: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { adminUser, refreshReturnInventory } = useStore();
  const [sheets,setSheets] = useState<ReturnSheetSummary[]>([]), [total,setTotal] = useState(0), [search,setSearch] = useState('');
  const [sheet,setSheet] = useState<ReturnSheet | null>(null), [waybill,setWaybill] = useState(''), [selected,setSelected] = useState('');
  const [preview,setPreview] = useState<{ filename: string; csv: string; sheet: ReturnSheet; unchanged: boolean }[]>([]);
  const [busy,setBusy] = useState(''), [message,setMessage] = useState(''), [error,setError] = useState(''), [camera,setCamera] = useState(false);
  const [entries,setEntries] = useState<Record<string,Entry>>({}), [notes,setNotes] = useState(''), [filter,setFilter] = useState('all');
  const [retry,setRetry] = useState<any>(null);
  const uploadRef = useRef<HTMLInputElement>(null), scanRef = useRef<HTMLInputElement>(null), busyRef = useRef(false);
  const viewRef = useRef({ id: '', search: '' }); viewRef.current = { id: sheet?.id || '', search };
  const parcel = sheet?.parcels.find(value => value.waybill === selected);
  const summary = sheet ? summarizeReturnSheet(sheet) : null;
  const loadList = async (query = search) => {
    const result = await returnSheetRequest('/api/returns/sheets?search=' + encodeURIComponent(query));
    if (query !== viewRef.current.search) return;
    setSheets(result.sheets); setTotal(result.total);
  };
  const loadSheet = async (id: string) => { const result = await returnSheetRequest('/api/returns/sheets/' + encodeURIComponent(id)); setSheet(result.sheet); };
  const work = async (label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(''); setMessage('');
    try { await action(); } catch (error: any) { setError(error.message || 'Please retry.'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { if (active) void loadList(search).catch(error => setError(error.message)); },250);
    return () => { active = false; clearTimeout(timer); };
  },[search]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (busyRef.current || document.visibilityState !== 'visible') return;
      const view = viewRef.current;
      try {
        const result = await returnSheetRequest(view.id ? '/api/returns/sheets/' + view.id : '/api/returns/sheets?search=' + encodeURIComponent(view.search));
        if (!active || busyRef.current || view.id !== viewRef.current.id || view.search !== viewRef.current.search) return;
        if (view.id) setSheet(result.sheet); else { setSheets(result.sheets); setTotal(result.total); }
      } catch (error: any) { if (active) setError(error.message); }
    };
    const timer = setInterval(refresh,20000); window.addEventListener('focus',refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus',refresh); };
  },[]);
  useEffect(() => {
    if (!parcel || !sheet) { setEntries({}); setRetry(null); return; }
    setEntries(Object.fromEntries(parcel.items.map(item => [item.id,{ choice: pendingReturnQty(item) ? '' : 'complete', good: '0', damaged: '0' }])));
    setNotes(parcel.notes || '');
    try { setRetry(JSON.parse(localStorage.getItem(retryKey(sheet.id,parcel.waybill)) || 'null')); } catch { setRetry(null); }
  },[sheet?.id,parcel?.waybill,parcel?.revision]);
  const scan = (value: string) => work('Opening parcel',async () => {
    if (!canEdit) throw new Error('Returns edit access is required to scan parcels.');
    if (!value.trim()) throw new Error('Scan or type a waybill first.');
    const result = await returnSheetRequest('/api/returns/scan',{ waybill: value.trim() });
    setSheet(result.sheet); setSelected(value.trim()); setWaybill(''); setCamera(false); setMessage(result.message);
  });
  const prepareFiles = (files: File[]) => work('Reading CSVs',async () => {
    const prepared = [];
    for (const file of files) {
      if (file.size > 2_000_000) throw new Error(file.name + ' is too large.');
      const csv = await file.text(); parseReturnCsv(file.name,csv);
      const result = await returnSheetRequest('/api/returns/preview',{ filename: file.name, csv });
      prepared.push({ filename: file.name, csv, sheet: result.sheet, unchanged: result.unchanged });
    }
    setPreview(prepared); setMessage('Preview ready. Upload creates expected parcels; it does not add stock.');
  });
  const importFiles = () => work('Uploading return sheets',async () => {
    const done: string[] = []; let last: ReturnSheet | null = null;
    for (const file of preview) {
      const result = await returnSheetRequest('/api/returns/sheets',{ filename: file.filename, csv: file.csv });
      done.push(result.sheet.id); last = result.sheet;
      setPreview(current => current.filter(value => value.filename !== file.filename));
      setSheet(last); setSelected('');
      setMessage('Sheets saved: ' + done.join(', ') + '. Stock is unchanged.');
    }
    await loadList();
    if (last) setSheet(last);
    setMessage('Sheets saved: ' + done.join(', ') + '. Vinodya can open these from her Returns page. Stock is unchanged.');
  });
  const saveReceipt = () => work('Saving received quantities',async () => {
    if (!sheet || !parcel || !canEdit) return;
    const key = retryKey(sheet.id,parcel.waybill);
    let input = retry;
    if (!input) {
      const items = parcel.items.map(item => {
        const entry = entries[item.id];
        if (pendingReturnQty(item) && !entry?.choice) throw new Error('Choose received or not received for ' + item.name + '.');
        const good = Number(entry?.good || 0), damaged = Number(entry?.damaged || 0);
        if (!Number.isSafeInteger(good) || !Number.isSafeInteger(damaged) || good < 0 || damaged < 0 || good + damaged > pendingReturnQty(item)) throw new Error('Enter valid remaining quantities for ' + item.name + '.');
        if (entry?.choice === 'received' && good + damaged === 0) throw new Error('Enter the quantity received for ' + item.name + '.');
        return { id: item.id, good_qty: entry?.choice === 'missing' ? 0 : good, damaged_qty: entry?.choice === 'missing' ? 0 : damaged, not_received: entry?.choice === 'missing' };
      });
      input = { operation_id: crypto.randomUUID(), expected_revision: parcel.revision, waybill: parcel.waybill, items, notes };
      localStorage.setItem(key,JSON.stringify(input)); setRetry(input);
    }
    try {
      const result = await returnSheetRequest('/api/returns/sheets/' + sheet.id + '/receive',input);
      localStorage.removeItem(key); setRetry(null); setSheet(result.sheet);
      setMessage('Saved. Good stock added: ' + result.receipt.good_qty + '. Damaged received: ' + result.receipt.damaged_qty + '. Remaining quantities stay pending.');
      await refreshReturnInventory(); await loadList(); scanRef.current?.focus();
    } catch (error: any) {
      if ([400,403,404,409].includes(error.status)) {
        localStorage.removeItem(key); setRetry(null);
        await loadSheet(sheet.id).catch(() => {});
      }
      throw error;
    }
  });
  const visible = sheet?.parcels.filter(parcel => filter === 'all' || (filter === 'pending' && parcel.items.some(item => pendingReturnQty(item)) && !parcel.review_reason) || (filter === 'review' && parcel.review_reason) || (filter === 'received' && parcel.items.length && !parcel.items.some(item => pendingReturnQty(item)) && !parcel.review_reason)) || [];

  return <div data-ora-action="return_process" data-ora-view-allowed="true" className="space-y-5 text-neutral-200">
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-black text-white">Return Sheets</h2><p className="mt-1 text-sm text-neutral-400">Upload Fardar CSV → scan parcel → check each item → save actual received quantities.</p><p className="mt-1 text-xs text-emerald-300">Only good quantities saved after checking are added to stock. 5 expected / 4 received leaves 1 pending.</p></div>
        {adminUser?.role === 'admin' && <button className={button} disabled={!!busy} onClick={() => uploadRef.current?.click()}><Upload className="mr-2 inline h-4 w-4"/>Upload return CSVs</button>}
        <input ref={uploadRef} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={event => { const files = Array.from(event.currentTarget.files || []) as File[]; event.target.value = ''; if (files.length) void prepareFiles(files); }}/>
      </div>
      <div className="flex flex-col sm:flex-row gap-2"><input ref={scanRef} className={field} value={waybill} onChange={event => setWaybill(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void scan(waybill); } }} placeholder="Scan / type return waybill" aria-label="Return waybill" disabled={!!busy || !canEdit}/><button className={button + ' whitespace-nowrap bg-orange-500 text-black'} disabled={!!busy || !canEdit} onClick={() => void scan(waybill)}><ScanLine className="inline h-4 w-4 mr-1"/>Scan & check items</button><button className={button + ' whitespace-nowrap'} disabled={!!busy || !canEdit} onClick={() => setCamera(true)}><Camera className="inline h-4 w-4 mr-1"/>Phone camera</button></div>
      <div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-neutral-500"/><input className={field + ' pl-9'} value={search} onChange={event => { setSearch(event.target.value); setSheet(null); setSelected(''); }} placeholder="Search Sheet ID, e.g. 368000" aria-label="Search Sheet ID"/></div><button className={button} disabled={!!busy} onClick={() => void work('Refreshing',async () => { await loadList(); if (sheet) await loadSheet(sheet.id); await refreshReturnInventory(); })}><RefreshCw className="h-4 w-4"/></button></div>
      {busy && <p role="status" className="text-sm text-orange-300">{busy}…</p>}{error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}{message && <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}
    </div>
    {!!preview.length && <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-5 space-y-3"><h3 className="font-bold text-white">CSV upload preview</h3>{preview.map(file => { const s = summarizeReturnSheet(file.sheet); return <div key={file.filename} className="rounded-xl bg-neutral-950 p-3 text-sm"><b className="text-orange-300">Sheet {s.id}</b> · {s.parcels} parcels · {s.expected_qty} expected item units · {s.review_parcels} need review{file.unchanged && <span className="ml-2 text-emerald-300">Already uploaded; quantities preserved</span>}</div>; })}<p className="text-xs text-neutral-400">Item names and quantities come from the matched system order. Unmatched parcels remain visible under Needs review.</p><div className="flex gap-2"><button className={button + ' bg-orange-500 text-black'} disabled={!!busy} onClick={() => void importFiles()}>Upload {preview.length} sheet{preview.length > 1 ? 's' : ''}</button><button className={button} disabled={!!busy} onClick={() => setPreview([])}>Close preview</button></div></div>}
    {!sheet && <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"><h3 className="font-bold text-white mb-3">Return sheets ({total})</h3>{!sheets.length ? <p className="text-sm text-neutral-400 py-5">{search ? 'No matching Sheet ID.' : 'Upload the daily Fardar CSVs to start. Receiving staff can then scan any waybill from those sheets.'}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="text-neutral-500 text-left"><tr><th className="p-3">Sheet ID / uploaded</th><th>Parcels complete</th><th>Confirmed items</th><th>Good qty</th><th>Damaged</th><th>Pending qty</th></tr></thead><tbody>{sheets.map(s => <tr key={s.id} className="border-t border-neutral-800 hover:bg-neutral-800 cursor-pointer" onClick={() => void work('Opening sheet',() => loadSheet(s.id))}><td className="p-3"><button className="font-mono font-black text-orange-300">{s.id}</button><div className="text-xs text-neutral-500">{new Date(s.uploaded_at).toLocaleDateString()} · {s.uploaded_by}</div>{s.review_parcels > 0 && <div className="text-xs text-amber-300">{s.review_parcels} need review</div>}</td><td>{s.completed_parcels} / {s.parcels}</td><td>{s.confirmed_items} / {s.item_lines}</td><td className="text-emerald-300">{s.good_qty}</td><td className="text-amber-300">{s.damaged_qty}</td><td className="text-red-300">{s.pending_qty}</td></tr>)}</tbody></table></div>}{total > 100 && <p className="mt-3 text-xs text-neutral-400">Showing the latest 100. Search the Sheet ID to find older sheets.</p>}</div>}
    {sheet && summary && <>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><button className="text-sm text-neutral-400 mb-2" onClick={() => { setSheet(null); setSelected(''); void loadList(); }}><ArrowLeft className="inline h-4 w-4 mr-1"/>All sheets</button><h3 className="text-xl font-black text-orange-300">Sheet {sheet.id}</h3><p className="text-xs text-neutral-500">{sheet.filename} · {sheet.uploaded_by} · {new Date(sheet.uploaded_at).toLocaleString()}</p></div>{summary.review_parcels > 0 && <button className={button} disabled={!!busy || !canEdit} onClick={() => void work('Refreshing order matches',async () => { const result = await returnSheetRequest('/api/returns/sheets/' + sheet.id + '/rematch',{}); setSheet(result.sheet); setMessage('Order matches refreshed. Parcels needing review remain visible.'); })}>Refresh order matches</button>}</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Parcels received',summary.completed_parcels + ' / ' + summary.parcels],['Confirmed item lines',summary.confirmed_items + ' / ' + summary.item_lines],['Good qty added to stock',summary.good_qty],['Qty still pending',summary.pending_qty]].map(([label,value]) => <div key={label} className="rounded-xl bg-neutral-950 p-3"><div className="text-xs text-neutral-400">{label}</div><div className="text-xl font-black text-white mt-1">{value}</div></div>)}</div><p className="text-xs text-neutral-400">Expected units: {summary.expected_qty} · Received units: {summary.good_qty + summary.damaged_qty} · Damaged: {summary.damaged_qty} · Scanned parcels: {summary.scanned_parcels} · Needs review: {summary.review_parcels}</p>
        <select className={field + ' sm:max-w-xs'} value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter return parcels"><option value="all">All parcels</option><option value="pending">Pending / partly received</option><option value="received">Received parcels</option><option value="review">Needs review</option></select>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="text-left text-xs uppercase text-neutral-500"><tr><th className="p-3">Order ID / waybill</th><th className="p-3">Expected items / qty</th><th className="p-3">Good / damaged / pending</th><th className="p-3">Status</th></tr></thead><tbody>{visible.map(p => <tr key={p.waybill} className={'border-t border-neutral-800 cursor-pointer hover:bg-neutral-800 ' + (selected === p.waybill ? 'bg-neutral-800' : '')} onClick={() => setSelected(p.waybill)}><td className="p-3 align-top"><button className="font-mono text-orange-300 font-bold">{p.order_number || p.csv_order_id || 'Order unmatched'}</button><div className="font-mono text-xs mt-1">{p.waybill}</div>{p.csv_order_id && p.csv_order_id !== p.order_number && <div className="text-xs text-neutral-500">CSV: {p.csv_order_id}</div>}</td><td className="p-3">{p.items.length ? p.items.map(item => <div key={item.id} className="mb-1"><span className="text-neutral-500 font-mono">{item.sku}</span> {item.name} <b>× {item.expected_qty}</b></div>) : <span className="text-amber-300">Order match required</span>}</td><td className="p-3 font-mono align-top"><span className="text-emerald-300">{p.items.reduce((n,i) => n+i.good_qty,0)}</span> / <span className="text-amber-300">{p.items.reduce((n,i) => n+i.damaged_qty,0)}</span> / <span className="text-red-300">{p.items.reduce((n,i) => n+pendingReturnQty(i),0)}</span></td><td className="p-3 align-top"><b className="text-xs">{parcelReturnStatus(p)}</b>{p.review_reason && <div className="text-amber-300 text-xs mt-1 max-w-xs">{p.review_reason}</div>}</td></tr>)}</tbody></table></div>
      </div>
      {parcel && <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-5 space-y-4"><div><h3 className="font-black text-white">Check parcel {parcel.waybill}</h3><p className="text-xs text-neutral-400 mt-1">{parcel.order_number || parcel.csv_order_id} · {parcelReturnStatus(parcel)}</p>{parcel.reason && <p className="text-xs text-neutral-500 mt-1">Fardar reason: {parcel.reason}</p>}</div>
        {parcel.review_reason ? <p className="text-sm text-amber-300">{parcel.review_reason} Stock cannot be added until this is resolved.</p> : !parcel.scanned_at ? <button className={button} disabled={!!busy || !canEdit} onClick={() => void scan(parcel.waybill)}>Open parcel for item checking</button> : <>
          <p className="text-xs text-neutral-400">Opened by {parcel.scanned_by} · {new Date(parcel.scanned_at).toLocaleString()}. Enter only the quantities received now; previous receipts are already counted.</p>
          {retry && <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-300">An earlier save needs confirmation. Retry that saved request before entering another receipt.</p>}
          {parcel.items.map(item => { const left = pendingReturnQty(item), entry = entries[item.id] || { choice: '', good: '0', damaged: '0' }; return <div key={item.id} className="rounded-xl border border-neutral-800 p-4 space-y-3"><div className="flex justify-between gap-3"><div><b className="text-white">{item.name}</b><div className="text-xs text-neutral-500 font-mono">{item.sku}</div>{item.bundle_name && <div className="text-xs text-neutral-500">Bundle: {item.bundle_name}</div>}</div>{!left && <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0"/>}</div><p className="text-xs text-neutral-400">Expected: <b>{item.expected_qty}</b> · Good received: <b className="text-emerald-300">{item.good_qty}</b> · Damaged: <b>{item.damaged_qty}</b> · Pending: <b className="text-red-300">{left}</b></p>{left > 0 && <><select className={field} disabled={!!busy || !!retry || !canEdit} value={entry.choice} aria-label={'Received status ' + item.name} onChange={event => setEntries(current => ({ ...current, [item.id]: { ...entry, choice: event.target.value, good: '0', damaged: '0' } }))}><option value="">Choose received / not received</option><option value="received">Received now — enter actual quantities</option><option value="missing">Not received yet — keep pending</option></select>{entry.choice === 'received' && <div className="grid grid-cols-2 gap-3"><label className="text-xs text-neutral-400">Good received now<input className={field + ' mt-1'} type="number" min="0" max={left} step="1" disabled={!!busy || !!retry || !canEdit} value={entry.good} onChange={event => setEntries(current => ({ ...current, [item.id]: { ...entry, good: event.target.value } }))}/></label><label className="text-xs text-neutral-400">Damaged received now<input className={field + ' mt-1'} type="number" min="0" max={left} step="1" disabled={!!busy || !!retry || !canEdit} value={entry.damaged} onChange={event => setEntries(current => ({ ...current, [item.id]: { ...entry, damaged: event.target.value } }))}/></label></div>}</>}</div>; })}
          <label className="block text-xs text-neutral-400">Notes / wrong item found<textarea className={field + ' mt-1'} maxLength={2000} value={notes} disabled={!!busy || !!retry || !canEdit} onChange={event => setNotes(event.target.value)}/></label>
          {(retry || parcel.items.some(item => pendingReturnQty(item))) && <button className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-black text-black disabled:opacity-40" disabled={!!busy || !canEdit} onClick={() => void saveReceipt()}>{retry ? 'Retry saved receipt safely' : 'Save checked items & add good stock'}</button>}
          {parcel.checked_at && <p className="text-xs text-neutral-400">Last checked by {parcel.checked_by} · {new Date(parcel.checked_at).toLocaleString()}</p>}
        </>}
      </div>}
      {!!sheet.receipts.length && <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5"><h3 className="font-bold text-white mb-3">Item receipt history</h3>{sheet.receipts.slice(-20).reverse().map(receipt => <div key={receipt.operation_id} className="border-t border-neutral-800 py-3 text-xs"><b className="font-mono text-orange-300">{receipt.waybill}</b> · Good added: {receipt.good_qty} · Damaged: {receipt.damaged_qty}<div className="text-neutral-500 mt-1">{receipt.actor} · {new Date(receipt.at).toLocaleString()}</div></div>)}</div>}
    </>}
    <CameraBarcodeScanner open={camera} title="Scan return waybill" onClose={() => setCamera(false)} onDetected={value => { setCamera(false); void scan(value); }}/>
  </div>;
};
