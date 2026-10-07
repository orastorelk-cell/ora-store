import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, RefreshCw, Search, Upload, ArrowLeft, ScanLine, X, Download, PackageCheck, AlertTriangle, ChevronLeft, ChevronRight, ImagePlus } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { CameraBarcodeScanner } from './CameraBarcodeScanner';
import { compressImageFile } from '../../lib/imageUpload';
import { actualReturnItems, returnCatalogItems, wrongReturnQty, parseReturnCsv, parcelFullyReceived, parcelReturnStatus, pendingReturnQty, summarizeReturnSheet, type ReturnParcel, type ReturnSheet, type ReturnSheetSummary } from '../../lib/returnSheets';
import { downloadReturnBlob, downloadReturnSheetPdf, returnPackingCsv } from '../../lib/returnExports';
import { StoreOnlyZip } from '../../lib/productFolderZip';
import { buildReturnPackingInvoiceBlob } from '../../lib/pdfGenerator';

export const returnSheetRequest = async (path: string, body?: unknown) => {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(path,{ method: body === undefined ? 'GET' : 'POST',cache: 'no-store',
        headers: { 'content-type': 'application/json',authorization: 'Bearer ' + (localStorage.getItem('ora_staff_session_token') || '') },body: serialized });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) { const error: any = new Error(result.error || 'Return request failed (' + response.status + ').'); error.status = response.status; throw error; } return result;
    } catch (error: any) { if (attempt >= 2 || (error.status && ![429,500,502,503,504].includes(error.status))) throw error; await new Promise(resolve => setTimeout(resolve,[900,2200][attempt])); }
  }
};
type Entry = { choice: string; good: string; damaged: string; different?: boolean; receivedId?: string };
const field = 'w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 min-h-9 text-sm text-white';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 min-h-9 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-40';
const retryKey = (waybill: string) => 'ora_return_receipt_retry:parcel:' + waybill;
const packingKey = 'ora_return_packing_retry';
const date = (value?: string) => value ? new Date(value).toLocaleString() : '—';
const day = (value: string) => new Date(value).toLocaleDateString();
const Photo: React.FC<{id: string}> = ({id}) => {
  const [url,setUrl] = useState(''), [failed,setFailed] = useState(false);
  useEffect(() => { let active = true, object = ''; void fetch('/api/returns/photos/' + id,{ headers: { authorization: 'Bearer ' + (localStorage.getItem('ora_staff_session_token') || '') },cache: 'no-store' }).then(async response => { if (!response.ok) throw new Error('Photo unavailable'); object = URL.createObjectURL(await response.blob()); if (active) setUrl(object); else URL.revokeObjectURL(object); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; if (object) URL.revokeObjectURL(object); }; },[id]);
  return url ? <a href={url} target="_blank" rel="noreferrer" className="block"><img src={url} alt="Damage evidence" className="h-16 w-16 rounded-lg object-cover border border-neutral-700"/></a> : <span className="text-xs text-neutral-500">{failed ? 'Photo unavailable — retry' : 'Loading photo…'}</span>;
};
const Qty: React.FC<{parcel: ReturnParcel}> = ({parcel}) => <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2"><span className="text-emerald-300">Good <b>{parcel.items.reduce((n,i) => n + i.good_qty,0)}</b></span><span className="text-amber-300">Damage <b>{parcel.items.reduce((n,i) => n + i.damaged_qty,0)}</b></span><span className="text-red-300">Pending <b>{parcel.items.reduce((n,i) => n + pendingReturnQty(i),0)}</b></span></div>;

export const ReturnSheetsPanel: React.FC<{ canEdit: boolean }> = ({canEdit}) => {
  const { adminUser,products,refreshReturnInventory,returnPackingPending,returnPackingBatches } = useStore();
  const [sheets,setSheets] = useState<ReturnSheetSummary[]>([]), [total,setTotal] = useState(0), [counts,setCounts] = useState({pending: 0,complete: 0});
  const [search,setSearch] = useState(''), [listTab,setListTab] = useState('pending'), [dateFilter,setDateFilter] = useState('');
  const [sheet,setSheet] = useState<ReturnSheet | null>(null), [unlisted,setUnlisted] = useState<ReturnParcel[]>([]), [waybill,setWaybill] = useState(''), [selected,setSelected] = useState('');
  const [preview,setPreview] = useState<{filename: string;csv: string;sheet: ReturnSheet;unchanged: boolean}[]>([]);
  const [busy,setBusy] = useState(''), [message,setMessage] = useState(''), [error,setError] = useState(''), [camera,setCamera] = useState(false), [popup,setPopup] = useState(false);
  const [entries,setEntries] = useState<Record<string,Entry>>({}), [photos,setPhotos] = useState<Record<string,string[]>>({}), [notes,setNotes] = useState(''), [filter,setFilter] = useState('pending');
  const [retry,setRetry] = useState<any>(null), [itemIndex,setItemIndex] = useState(0), [mode,setMode] = useState<'receive'|'correct'>('receive'), [correction,setCorrection] = useState('1');
  const [productSearch,setProductSearch] = useState(''), [correctionItem,setCorrectionItem] = useState('');
  const catalogItems = useMemo(() => returnCatalogItems(products),[products]);
  const [packingRetry,setPackingRetry] = useState(() => localStorage.getItem(packingKey) || '');
  const uploadRef = useRef<HTMLInputElement>(null), scanRef = useRef<HTMLInputElement>(null), busyRef = useRef(false);
  const viewRef = useRef({id: '',search: '',tab: '',popup: false,waybill:''}); viewRef.current = {id: sheet?.id || '',search,tab: listTab,popup,waybill:sheet&&!sheet.id?selected:''};
  const parcel = sheet?.parcels.find(value => value.waybill === selected), summary = sheet ? summarizeReturnSheet(sheet) : null;
  const item = parcel?.items[itemIndex], entry = item ? entries[item.id] || {choice: '',good: '0',damaged: '0'} : null;
  const receivedItems = item ? actualReturnItems(item) : [], goodItems = receivedItems.filter(value => value.good_qty > 0);
  const correctionTarget = goodItems.find(value => value.id === correctionItem) || goodItems[0];
  const choices = catalogItems.filter(value => value.id !== item?.id && (!productSearch.trim() || (value.name + ' ' + value.sku).toLowerCase().includes(productSearch.trim().toLowerCase()) || value.id === entry?.receivedId));
  const work = async (label: string,action: () => Promise<void>) => { if (busyRef.current) return; busyRef.current = true; setBusy(label); setError(''); setMessage(''); try { await action(); } catch (error: any) { setError(error.message || 'Please retry.'); } finally { busyRef.current = false; setBusy(''); } };
  const loadList = async (query = search,tab = listTab) => {
    const result = await returnSheetRequest('/api/returns/sheets?search=' + encodeURIComponent(query) + '&status=' + (tab === 'unlisted' ? 'all' : tab));
    if (query !== viewRef.current.search || tab !== viewRef.current.tab) return;
    setSheets(result.sheets); setTotal(result.total); setCounts({pending: result.pending,complete: result.complete});
    if (tab === 'unlisted') { const data = await returnSheetRequest('/api/returns/unlisted'); setUnlisted(data.parcels); }
  };
  const loadSheet = async (id: string) => { const result = await returnSheetRequest('/api/returns/sheets/' + id); setSheet(result.sheet); setFilter(result.summary.all_received ? 'complete' : 'pending'); };
  const loadParcel = async (wb: string) => { const result = await returnSheetRequest('/api/returns/parcels/' + encodeURIComponent(wb)); setSheet(result.sheet); setSelected(wb); return result; };
  useEffect(() => { const timer = setTimeout(() => { void loadList(search,listTab).catch(error => setError(error.message)); },250); return () => clearTimeout(timer); },[search,listTab]);
  useEffect(() => {
    let active = true;
    const refresh = async () => { const view = viewRef.current; if (busyRef.current || view.popup || document.visibilityState !== 'visible') return; try { if (view.id||view.waybill) { const data = await returnSheetRequest(view.id?'/api/returns/sheets/' + view.id:'/api/returns/parcels/'+view.waybill); if (active && !busyRef.current && view.id === viewRef.current.id && view.waybill === viewRef.current.waybill && !viewRef.current.popup) setSheet(data.sheet); } else await loadList(view.search,view.tab); } catch (error: any) { if (active) setError(error.message); } };
    const timer = setInterval(refresh,20000); window.addEventListener('focus',refresh); return () => { active = false; clearInterval(timer); window.removeEventListener('focus',refresh); };
  },[]);
  useEffect(() => {
    if (!parcel) return; setEntries(Object.fromEntries(parcel.items.map(value => [value.id,{choice: pendingReturnQty(value) ? '' : 'complete',good: '0',damaged: '0'}]))); setPhotos({}); setNotes(parcel.notes || ''); setItemIndex(0); setMode('receive'); setProductSearch(''); setCorrectionItem('');
    try { setRetry(JSON.parse(localStorage.getItem(retryKey(parcel.waybill)) || 'null')); } catch { setRetry(null); }
  },[parcel?.waybill,parcel?.revision]);
  useEffect(() => { if (!popup) return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busyRef.current) setPopup(false); }; window.addEventListener('keydown',onKey); return () => { document.body.style.overflow = previous; window.removeEventListener('keydown',onKey); }; },[popup]);
  const scan = (value: string) => work('Opening parcel',async () => { if (!canEdit) throw new Error('Returns edit access is required.'); if (!value.trim()) throw new Error('Scan or type a waybill first.'); const result = await returnSheetRequest('/api/returns/scan',{waybill: value.trim()}); setSheet(result.sheet); setSelected(value.trim()); setPopup(true); setWaybill(''); setCamera(false); setMessage(result.message); await refreshReturnInventory(); });
  const prepareFiles = (files: File[]) => work('Reading CSVs',async () => { const prepared = []; for (const file of files) { if (file.size > 2_000_000) throw new Error(file.name + ' is too large.'); const csv = await file.text(); parseReturnCsv(file.name,csv); const result = await returnSheetRequest('/api/returns/preview',{filename: file.name,csv}); prepared.push({filename: file.name,csv,sheet: result.sheet,unchanged: result.unchanged}); } setPreview(prepared); });
  const importFiles = () => work('Uploading return sheets',async () => { const done = []; for (const file of preview) { const result = await returnSheetRequest('/api/returns/sheets',{filename: file.filename,csv: file.csv}); done.push(result.sheet.id); setSheet(result.sheet); setSelected(''); setPreview(current => current.filter(value => value.filename !== file.filename)); } await loadList(); await refreshReturnInventory(); setMessage('Sheets saved: ' + done.join(', ') + '. Earlier receipts were linked with their quantities and photos. Stock was not added again.'); });
  const uploadPhotos = (files: File[],itemId: string) => work('Uploading damage photos',async () => {
    if (!parcel) return;
    if (files.length + (photos[itemId]?.length || 0) > 10) throw new Error('Attach up to 10 new photos per item check.');
    for (const file of files) {
      const data = await compressImageFile(file,1000,300000);
      const result = await returnSheetRequest('/api/returns/photos',{upload_id: crypto.randomUUID(),waybill: parcel.waybill,item_id: itemId,data_url: data});
      setPhotos(current => ({...current,[itemId]: [...(current[itemId] || []),result.photo_id]}));
    }
    setMessage('Photos uploaded. Save the item check or correction to attach them.');
  });
  const saveReceipt = () => work(mode === 'correct' ? 'Saving damage correction' : 'Saving checked items',async () => {
    if (!sheet || !parcel || !canEdit) return; const key = retryKey(parcel.waybill); let saved = retry;
    if (!saved) {
      let items: any[];
      if (mode === 'correct') {
        if (!item || !correctionTarget) return;
        const qty = Number(correction);
        if (!Number.isSafeInteger(qty) || qty < 1 || qty > correctionTarget.good_qty) throw new Error('Enter the number of saved good units that are damaged.');
        items = [{id: item.id,quantity: qty,photo_ids: photos[item.id] || [], ...(correctionTarget.id === item.id ? {} : {received_product_id: correctionTarget.product_id,...(correctionTarget.variant_id ? {received_variant_id: correctionTarget.variant_id} : {})})}];
      } else items = parcel.items.map(value => {
        const entry = entries[value.id];
        if (pendingReturnQty(value) && !entry?.choice) throw new Error('Check ' + value.name + '. Use Next item to check every item.');
        const good = Number(entry?.good || 0), damaged = Number(entry?.damaged || 0);
        if (!Number.isSafeInteger(good) || !Number.isSafeInteger(damaged) || good < 0 || damaged < 0 || good + damaged > pendingReturnQty(value)) throw new Error('Enter valid remaining quantities for ' + value.name + '.');
        if (entry?.choice === 'received' && good + damaged === 0) throw new Error('Enter the received quantity for ' + value.name + '.');
        const actual = entry?.choice === 'received' && entry.different ? catalogItems.find(choice => choice.id === entry.receivedId) : undefined;
        if (entry?.choice === 'received' && entry.different && !actual) throw new Error('Select the item actually received instead of ' + value.name + '.');
        return {id: value.id,good_qty: entry?.choice === 'missing' ? 0 : good,damaged_qty: entry?.choice === 'missing' ? 0 : damaged,not_received: entry?.choice === 'missing',photo_ids: photos[value.id] || [],...(actual ? {received_product_id: actual.product_id,...(actual.variant_id ? {received_variant_id: actual.variant_id} : {})} : {})};
      });
      saved = {action: mode,body: {operation_id: crypto.randomUUID(),expected_revision: parcel.revision,waybill: parcel.waybill,items,notes}}; localStorage.setItem(key,JSON.stringify(saved)); setRetry(saved);
    }
    try {
      const result = await returnSheetRequest('/api/returns/parcels/' + parcel.waybill + '/' + (saved.action === 'correct' ? 'correct' : 'receive'),saved.body || saved);
      localStorage.removeItem(key); setRetry(null); setSheet(result.sheet); setPopup(false);
      setMessage(result.receipt.kind === 'damage_correction' ? 'Good units changed to Damaged. Existing invoices are preserved.' + (result.receipt.balance_qty ? ' ' + result.receipt.balance_qty + ' units will balance against the next stock inflow.' : '') : 'Saved. Good received: ' + result.receipt.good_qty + ' · Damaged: ' + result.receipt.damaged_qty + (result.receipt.wrong_item_qty ? ' · Different items recorded: ' + result.receipt.wrong_item_qty : '') + ' · Available stock added: ' + result.receipt.stock_added_qty + (result.receipt.balance_qty ? ' · Shortage balanced: ' + result.receipt.balance_qty : '') + '. Packing stays manual.');
      await refreshReturnInventory(); await loadList(); scanRef.current?.focus();
    } catch (error: any) { if ([400,403,404,409].includes(error.status)) { localStorage.removeItem(key); setRetry(null); await loadParcel(parcel.waybill).catch(() => {}); } throw error; }
  });
  const downloadPacking = async (operation: string,create = false) => {
    const data = create ? await returnSheetRequest('/api/returns/packing',{operation_id: operation}) : await returnSheetRequest('/api/returns/packing/' + operation);
    await refreshReturnInventory();
    if (!data.orders.length) { localStorage.removeItem(packingKey); setPackingRetry(''); setMessage('No orders can be packed yet. Pending stock: ' + data.skipped.stock + ' · Waybills: ' + data.skipped.waybills + ' · Order details: ' + data.skipped.details + '.'); return; }
    const zip = new StoreOnlyZip();
    for (let offset = 0; offset < data.orders.length; offset += 50) { setBusy('Preparing invoice PDF ' + (Math.floor(offset / 50) + 1)); const blob = await buildReturnPackingInvoiceBlob(data.orders.slice(offset,offset + 50),data.settings); zip.addFile(data.batch_id + '_Invoices_' + (Math.floor(offset / 50) + 1) + '.pdf',new Uint8Array(await blob.arrayBuffer())); }
    zip.addText(data.batch_id + '_Fardar.csv',returnPackingCsv(data.orders,data.settings));
    const blob = zip.build(); await returnSheetRequest('/api/returns/packing/' + operation + '/downloaded',{});
    downloadReturnBlob(blob,data.batch_id + '.zip'); localStorage.removeItem(packingKey); setPackingRetry('');
    await refreshReturnInventory(); setMessage(data.orders.length + ' packing invoices and their Fardar CSV downloaded together. Batch: ' + data.batch_id + (data.skipped.stock || data.skipped.waybills || data.skipped.details ? '. Other orders remain pending.' : '.'));
  };
  const createPacking = () => work('Creating packing batch',async () => { const id = packingRetry || crypto.randomUUID(); localStorage.setItem(packingKey,id); setPackingRetry(id); try { await downloadPacking(id,true); } catch (error: any) { if (/start a new packing operation/i.test(error.message)) { localStorage.removeItem(packingKey); setPackingRetry(''); } throw error; } });
  const visible = sheet?.parcels.filter(value => filter === 'all' || (filter === 'pending' && !parcelFullyReceived(value)) || (filter === 'complete' && parcelFullyReceived(value)) || (filter === 'damage' && value.items.some(i => i.damaged_qty))) || [];
  const list = sheets.filter(value => !dateFilter || day(value.uploaded_at) === dateFilter);
  const days = [...new Set(sheets.map(value => day(value.uploaded_at)))];
  const parcelCard = (value: ReturnParcel) => <button key={value.waybill} className="w-full min-w-0 text-left rounded-xl border border-neutral-800 bg-neutral-950 p-3 hover:border-orange-500/40" disabled={!!busy} onClick={() => { if (value.scanned_at) void work('Opening parcel',async () => { await loadParcel(value.waybill); setPopup(true); }); else void scan(value.waybill); }}><div className="flex justify-between gap-2"><div className="min-w-0"><b className="font-mono text-orange-300 break-all">{value.waybill}</b><p className="text-xs text-neutral-400 mt-1">Order: {value.order_number || value.csv_order_id || 'Unmatched'}</p></div>{parcelFullyReceived(value) && <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0"/>}</div><p className="mt-3 text-xs text-neutral-300 break-words">{value.items.map(i => i.name + ' × ' + i.expected_qty + (wrongReturnQty(i) ? ' → ' + actualReturnItems(i).map(actual => actual.name + ' × ' + (actual.good_qty + actual.damaged_qty)).join(', ') : '')).join(' · ') || 'Order match required'}</p><Qty parcel={value}/><p className="text-xs text-neutral-500 mt-2">{parcelReturnStatus(value)}{value.checked_at ? ' · ' + date(value.checked_at) : ''}</p>{value.review_reason && <p className="text-xs text-amber-300 mt-2">{value.review_reason}</p>}</button>;

  return <div data-ora-action="return_process" data-ora-view-allowed="true" className="space-y-3 text-neutral-200 min-w-0">
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-black text-white">Return Sheets</h2><p className="text-xs text-neutral-400 mt-1">Scan → check items → save → create packing batch.</p></div>{adminUser?.role === 'admin' && <button className={button} disabled={!!busy} onClick={() => uploadRef.current?.click()}><Upload className="w-4 h-4"/>Upload CSVs</button>}<input ref={uploadRef} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={event => { const files = Array.from(event.currentTarget.files || []) as File[]; event.target.value = ''; if (files.length) void prepareFiles(files); }}/></div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
        <input ref={scanRef} className={field + ' col-span-2 sm:col-span-1'} value={waybill} onChange={event => setWaybill(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void scan(waybill); } }} placeholder="Scan / type return waybill" aria-label="Return waybill" disabled={!!busy || !canEdit}/>
        <button className={button + ' !bg-orange-600 !border-orange-500'} disabled={!!busy || !canEdit} onClick={() => void scan(waybill)}><ScanLine className="h-4 w-4"/>Scan & Check</button>
        <button className={button} aria-label="Scan with camera" disabled={!!busy || !canEdit} onClick={() => setCamera(true)}><Camera className="h-4 w-4"/></button>
      </div>
      <p className="text-xs text-neutral-400">CSV නැති parcel එකත් receive කරන්න. CSV ආ පසු sheet එකට link වෙයි.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={button + ' w-full sm:w-auto !bg-emerald-600 !border-emerald-500'} disabled={!!busy || !canEdit || (!returnPackingPending && !packingRetry)} onClick={() => void createPacking()}><PackageCheck className="h-4 w-4 shrink-0"/>{packingRetry ? 'Retry Invoices + Fardar CSV' : 'Create Invoices + Fardar CSV'}</button>
        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto"><div className="relative flex-1 min-w-0"><Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500"/><input className={field + ' pl-9 sm:max-w-xs'} value={search} onChange={event => { setSearch(event.target.value); setSheet(null); setSelected(''); }} placeholder="Search Sheet ID" aria-label="Search Sheet ID"/></div><button className={button} aria-label="Refresh returns" disabled={!!busy} onClick={() => void work('Refreshing',async () => { await loadList(); if (sheet?.id) await loadSheet(sheet.id); else if(selected)await loadParcel(selected); await refreshReturnInventory(); })}><RefreshCw className="h-4 w-4"/></button></div>
      </div>
      {busy && <p role="status" className="text-sm text-orange-300">{busy}…</p>}{error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300 break-words">{error}</p>}{message && <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300 break-words">{message}</p>}
    </div>
    {!!preview.length && <div className="rounded-2xl border border-orange-500/30 bg-neutral-900 p-4 space-y-3"><h3 className="font-bold text-white">CSV preview</h3>{preview.map(file => { const s = summarizeReturnSheet(file.sheet); return <div key={file.filename} className="rounded-xl bg-neutral-950 p-3 text-sm"><b className="text-orange-300">Sheet {s.id}</b> · {s.parcels} parcels · {s.expected_qty} expected units · {s.review_parcels} need review{file.unchanged && <span className="text-emerald-300"> · Already uploaded</span>}</div>; })}<p className="text-xs text-neutral-400">Item details come from matched orders. Previously received parcels retain their quantities, photos and history.</p><div className="flex gap-2"><button className={button + ' bg-orange-500 !text-black'} disabled={!!busy} onClick={() => void importFiles()}>Upload {preview.length} sheets</button><button className={button} disabled={!!busy} onClick={() => setPreview([])}>Close</button></div></div>}
    {!sheet && <div className="space-y-3"><div className="inline-flex flex-wrap gap-1 rounded-xl border border-neutral-700 bg-neutral-900 p-1">{[['pending','Pending (' + counts.pending + ')'],['complete','Completed (' + counts.complete + ')'],['unlisted','Awaiting CSV']].map(([value,label]) => <button key={value} className={button + (listTab === value ? ' !border-orange-500 !bg-orange-500/20 !text-orange-300' : '')} onClick={() => { setListTab(value); setDateFilter(''); }}>{label}</button>)}</div>
      {listTab === 'unlisted' ? <><p className="text-sm text-neutral-400">These parcels have no Sheet ID. Their receipts link when the matching Fardar CSV is uploaded.</p><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">{unlisted.map(parcelCard)}</div>{!unlisted.length && <p className="text-neutral-500 text-sm">No parcels awaiting CSV.</p>}</> : <><select className={field + ' sm:max-w-xs'} aria-label="Filter by upload date" value={dateFilter} onChange={event => setDateFilter(event.target.value)}><option value="">All upload dates</option>{days.map(value => <option key={value}>{value}</option>)}</select>{!list.length && <p className="text-neutral-500 text-sm p-3">No {listTab === 'complete' ? 'completed' : 'pending'} sheets{search ? ' match this Sheet ID' : ''}.</p>}{[...new Set(list.map(value => day(value.uploaded_at)))].map(uploadDay => <section key={uploadDay}><h3 className="text-sm font-bold text-neutral-400 mb-3">Uploaded {uploadDay}</h3><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">{list.filter(value => day(value.uploaded_at) === uploadDay).map(s => <button key={s.id} className="text-left min-w-0 rounded-2xl border border-neutral-800 bg-neutral-900 p-3 space-y-1.5" disabled={!!busy} onClick={() => void work('Opening sheet',() => loadSheet(s.id))}><div className="flex justify-between items-center gap-3"><b className="text-base font-black font-mono text-orange-300">{s.id}</b>{s.all_received && <CheckCircle2 className="h-6 w-6 text-emerald-400"/>}</div>{s.all_received && <p className="font-black text-emerald-400">ALL RECEIVED</p>}<p className="text-xs text-neutral-400">Completed parcels {s.completed_parcels}/{s.parcels} · Confirmed items {s.confirmed_items}/{s.item_lines}</p><p className="text-xs">Good <b className="text-emerald-300">{s.good_qty}</b> · Damage <b className="text-amber-300">{s.damaged_qty}</b> · Pending <b className="text-red-300">{s.pending_qty}</b></p><p className="text-xs text-neutral-500">{s.uploaded_by} · Updated {date(s.updated_at)}</p>{s.wrong_item_qty > 0 && <p className="text-xs text-amber-300">Different items received: {s.wrong_item_qty}</p>}{s.review_parcels > 0 && <p className="text-xs text-amber-300">{s.review_parcels} parcels need review</p>}</button>)}</div></section>)}{total > 100 && <p className="text-xs text-neutral-500">Latest 100 shown. Search a Sheet ID for older sheets.</p>}</>}
    </div>}
    {sheet && summary && <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 space-y-3"><button className="text-sm text-neutral-400" onClick={() => { setSheet(null); setSelected(''); void loadList(); }}><ArrowLeft className="inline h-4 w-4 mr-1"/>Return sheets</button><div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-base font-black text-orange-300">{sheet.id ? 'Sheet ' + sheet.id : 'Awaiting CSV — no Sheet ID'}</h3><p className="text-xs text-neutral-500 mt-1">{sheet.id ? sheet.filename + ' · Uploaded ' + date(sheet.uploaded_at) : 'Scanned ' + date(sheet.parcels[0]?.scanned_at)}</p><p className="text-xs text-neutral-500 mt-1">Updated {date(summary.updated_at)}</p></div>{sheet.id && <button className={button} disabled={!!busy} onClick={() => void work('Preparing sheet PDF',async () => { const data = await returnSheetRequest('/api/returns/sheets/' + sheet.id); setSheet(data.sheet); downloadReturnSheetPdf(data.sheet); })}><Download className="inline w-4 h-4 mr-1"/>Sheet PDF</button>}</div>
      {summary.all_received && <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4"><CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0"/><div><p className="text-base font-black text-emerald-400">ALL RECEIVED</p><p className="text-xs text-emerald-200">All parcel units received. Damage and different items are recorded separately.</p></div></div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[['Parcels complete',summary.completed_parcels + '/' + summary.parcels],['Confirmed items',summary.confirmed_items + '/' + summary.item_lines],['Good received',summary.good_qty],['Pending units',summary.pending_qty]].map(([label,value]) => <div key={label} className="bg-neutral-950 rounded-xl p-3"><p className="text-xs text-neutral-500">{label}</p><b className="text-lg text-white">{value}</b></div>)}</div><p className="text-xs text-neutral-400">Expected {summary.expected_qty} · Received {summary.good_qty + summary.damaged_qty} · Damaged {summary.damaged_qty} · Different items {summary.wrong_item_qty} · Needs review {summary.review_parcels}</p>
      <div className="flex flex-wrap gap-2">{[['pending','Pending'],['complete','Completed'],['damage','Damaged'],['all','All']].map(([value,label]) => <button key={value} className={button + (filter === value ? ' !border-orange-500 !bg-orange-500/20 !text-orange-300' : '')} onClick={() => setFilter(value)}>{label}</button>)}{summary.review_parcels > 0 && <button className={button} disabled={!!busy || !canEdit} onClick={() => void work('Refreshing order matches',async () => { const result = await returnSheetRequest(sheet.id ? '/api/returns/sheets/' + sheet.id + '/rematch' : '/api/returns/parcels/' + sheet.parcels[0].waybill + '/rematch',{}); setSheet(result.sheet); })}>Refresh matches</button>}</div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">{visible.map(parcelCard)}</div>{!visible.length && <p className="text-neutral-500 text-sm">No parcels in this view.</p>}
      {!!sheet.receipts.length && <details><summary className="text-sm font-bold cursor-pointer">Receipt & correction history ({sheet.receipts.length})</summary><div className="mt-3 space-y-2">{sheet.receipts.slice(-30).reverse().map(receipt => <div key={receipt.operation_id} className="rounded-xl bg-neutral-950 p-3 text-xs"><b className="font-mono text-orange-300">{receipt.waybill}</b> · {receipt.kind === 'damage_correction' ? 'Good → Damaged' : 'Receipt'} · Good {receipt.good_qty} · Damaged {receipt.damaged_qty}{!!receipt.wrong_item_qty && <> · Different items {receipt.wrong_item_qty}</>}<p className="mt-1 text-neutral-500">{receipt.actor} · {date(receipt.at)}</p></div>)}</div></details>}
    </div>}
    {!!returnPackingBatches?.length && <details className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"><summary className="font-bold text-sm cursor-pointer">Return packing history</summary><div className="space-y-3 mt-3">{returnPackingBatches.map(batch => <div key={batch.operation_id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-neutral-950 p-3"><div className="min-w-0"><p className="text-xs text-neutral-300 break-all">{batch.batch_id}</p><p className="text-xs text-neutral-500">{batch.count} invoices · {date(batch.created_at)}</p></div>{batch.count > 0 && <button className={button} disabled={!!busy} onClick={() => void work('Preparing saved packing ZIP',() => downloadPacking(batch.operation_id))}>Download again</button>}</div>)}</div></details>}
    {popup && parcel && <div className="fixed inset-0 z-[150] bg-black/80 flex items-center justify-center p-2 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="return-popup-title"><div className="w-full max-w-lg max-h-[96dvh] flex flex-col rounded-2xl border border-orange-500/40 bg-neutral-900 overflow-hidden shadow-2xl min-w-0"><div className="flex justify-between gap-3 p-3 border-b border-neutral-800"><div className="min-w-0"><h3 id="return-popup-title" className="font-black text-white font-mono break-all">{parcel.waybill}</h3><p className="text-xs text-neutral-400 mt-1">{parcel.order_number || 'Order unmatched'} · {sheet?.id ? 'Sheet ' + sheet.id : 'Awaiting CSV'}</p></div><button className="text-neutral-400 shrink-0" aria-label="Close parcel popup" disabled={!!busy} onClick={() => { setPopup(false); scanRef.current?.focus(); }}><X className="w-6 h-6"/></button></div>
      <div className="overflow-y-auto overscroll-contain min-h-0 p-3 space-y-3 break-words">{busy && <p role="status" className="text-xs text-orange-300">{busy}…</p>}{error && <p role="alert" className="text-xs text-red-300">{error}</p>}{retry && <p className="text-xs text-amber-300">A saved request needs confirmation. Retry it before another change.</p>}
        {parcel.review_reason ? <div className="text-sm text-amber-300"><AlertTriangle className="inline h-4 w-4 mr-2"/>{parcel.review_reason}<p className="mt-3 text-xs text-neutral-400">Check the system order and refresh its match before receiving stock.</p></div> : item && entry && <><p className="text-xs text-neutral-500">Item {itemIndex + 1} of {parcel.items.length}</p><h4 className="text-base font-black text-white">{item.name}</h4><p className="text-xs font-mono text-neutral-500">{item.sku}{item.bundle_name ? ' · Bundle: ' + item.bundle_name : ''}</p><p className="text-xs text-neutral-400">Expected <b>{item.expected_qty}</b> · Good <b className="text-emerald-300">{item.good_qty}</b> · Damage <b className="text-amber-300">{item.damaged_qty}</b> · Pending <b className="text-red-300">{pendingReturnQty(item)}</b></p>
          {!!receivedItems.length && <div className="rounded-lg border border-neutral-700 bg-neutral-950 p-2 space-y-1">
            <p className="text-xs text-neutral-400">Saved received items</p>
            {receivedItems.map(value => <p key={value.id} className="text-sm text-neutral-200 break-words">{value.name} <span className="text-xs text-neutral-400">{value.sku} · Good {value.good_qty} · Damaged {value.damaged_qty}</span>{value.id !== item.id && <span className="text-xs text-amber-300"> · Packing mistake</span>}</p>)}
          </div>}
          {mode === 'correct' ? <>
            <p className="text-sm text-amber-300 font-bold">Change saved Good to Damaged</p>
            <label className="block text-sm text-neutral-300">Received item to correct
              <select className={field + ' mt-1'} aria-label="Received item to correct" value={correctionTarget?.id || ''} disabled={!!busy || !!retry || !canEdit} onChange={event => { setCorrectionItem(event.target.value); setCorrection('1'); }}>
                {goodItems.map(value => <option key={value.id} value={value.id}>{value.sku} — {value.name} (Good {value.good_qty})</option>)}
              </select>
            </label>
            <label className="block text-sm text-neutral-300">Damaged units from saved good qty
              <input className={field + ' mt-1'} aria-label="Good to damaged quantity" inputMode="numeric" type="number" min="1" max={correctionTarget?.good_qty || 0} step="1" value={correction} disabled={!!busy || !!retry || !canEdit} onChange={event => setCorrection(event.target.value)}/>
            </label>
            <p className="text-xs text-neutral-400">Any shortage balances against the next purchase or good return.</p>
            <button className="text-sm text-neutral-300 underline" disabled={!!busy || !!retry} onClick={() => setMode('receive')}>Back to item receipt</button>
          </> : <>
            {pendingReturnQty(item) > 0 && <>
              <div className="grid grid-cols-2 gap-2">{[['received','Received'],['missing','Not Received']].map(([value,label]) => <button key={value} className={button + (entry.choice === value ? value === 'received' ? ' !border-emerald-500 !bg-emerald-500/20 !text-emerald-200' : ' !border-amber-500 !bg-amber-500/20 !text-amber-200' : '')} disabled={!!busy || !!retry || !canEdit} onClick={() => setEntries(current => ({...current,[item.id]: {...entry,choice: value,good: value === 'received' ? String(pendingReturnQty(item)) : '0',damaged: '0'}}))}>{label}</button>)}</div>
              {entry.choice === 'received' && <>
                <label className="flex items-center gap-2 text-sm text-amber-200 cursor-pointer">
                  <input type="checkbox" aria-label="Different item received" checked={!!entry.different} disabled={!!busy || !!retry || !canEdit} onChange={event => { setEntries(current => ({...current,[item.id]: {...entry,different: event.target.checked,receivedId: ''}})); setProductSearch(''); }}/>
                  Different item received (packing mistake)
                </label>
                {entry.different && <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 space-y-2">
                  <input className={field} aria-label="Find actual received item" placeholder="Search received item / SKU" value={productSearch} disabled={!!busy || !!retry || !canEdit} onChange={event => setProductSearch(event.target.value)}/>
                  <label className="block text-sm text-amber-200">Item actually received
                    <select className={field + ' mt-1'} aria-label="Actual received item" value={entry.receivedId || ''} disabled={!!busy || !!retry || !canEdit} onChange={event => setEntries(current => ({...current,[item.id]: {...entry,receivedId: event.target.value}}))}>
                      <option value="">Select received item / colour</option>
                      {choices.map(value => <option key={value.id} value={value.id}>{value.sku} — {value.name}</option>)}
                    </select>
                  </label>
                  <p className="text-xs text-amber-200/80">Good qty goes into the selected item's stock. The expected order item stays in the record.</p>
                </div>}
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm text-emerald-300">Good qty now<input className={field + ' mt-1'} aria-label="Good received quantity" inputMode="numeric" type="number" min="0" max={pendingReturnQty(item)} step="1" value={entry.good} disabled={!!busy || !!retry || !canEdit} onChange={event => setEntries(current => ({...current,[item.id]: {...entry,good: event.target.value}}))}/></label>
                  <label className="text-sm text-amber-300">Damaged qty now<input className={field + ' mt-1'} aria-label="Damaged received quantity" inputMode="numeric" type="number" min="0" max={pendingReturnQty(item)} step="1" value={entry.damaged} disabled={!!busy || !!retry || !canEdit} onChange={event => { const damaged = event.target.value, qty = Number(damaged); setEntries(current => ({...current,[item.id]: {...entry,damaged,good: Number.isSafeInteger(qty) && qty >= 0 && qty <= pendingReturnQty(item) && Number(entry.good) + qty > pendingReturnQty(item) ? String(pendingReturnQty(item) - qty) : entry.good}})); }}/></label>
                </div>
              </>}
            </>}
            {!pendingReturnQty(item) && <p className="text-sm text-emerald-300 font-bold"><CheckCircle2 className="inline w-4 h-4 mr-1"/>All units received</p>}
            {item.good_qty > 0 && <button className="text-sm font-bold text-amber-300 underline" disabled={!!busy || !!retry || !canEdit} onClick={() => { setMode('correct'); setCorrectionItem(goodItems[0]?.id || ''); setCorrection('1'); }}>Change Good to Damaged</button>}
          </>}
          {(mode === 'correct' || Number(entry.damaged) > 0 || item.damaged_qty > 0) && <fieldset className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 space-y-2">
            <legend className="px-1 text-sm font-bold text-amber-200">Damage photos</legend>
            <div className="flex flex-wrap gap-2">
              <label className={button + ' cursor-pointer'}><ImagePlus className="w-4 h-4"/>Upload photos<input type="file" aria-label="Upload damage photos" accept="image/*" multiple className="hidden" disabled={!!busy || !!retry || !canEdit || (photos[item.id]?.length || 0) >= 10} onChange={event => { const files = Array.from(event.target.files || []) as File[]; event.target.value = ''; if (files.length) void uploadPhotos(files,item.id); }}/></label>
              <label className={button + ' cursor-pointer'}><Camera className="w-4 h-4"/>Take photo<input type="file" aria-label="Take damage photo" accept="image/*" capture="environment" className="hidden" disabled={!!busy || !!retry || !canEdit || (photos[item.id]?.length || 0) >= 10} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadPhotos([file],item.id); }}/></label>
            </div>
            <div className="flex flex-wrap gap-2">
              {(item.damage_photo_ids || []).map(id => <Photo key={id} id={id}/>)}
              {(photos[item.id] || []).map(id => <div key={id} className="relative"><Photo id={id}/><button className="absolute -top-1 -right-1 rounded-full bg-neutral-800 p-1 text-white" aria-label="Remove uploaded damage photo" disabled={!!busy || !!retry} onClick={() => setPhotos(current => ({...current,[item.id]: current[item.id].filter(value => value !== id)}))}><X className="w-3 h-3"/></button></div>)}
            </div>
            <p className="text-xs text-amber-200/80">{photos[item.id]?.length ? photos[item.id].length + ' new photo(s). Save below to attach them to this item.' : 'Attach photos of the damaged item, then save below.'}</p>
          </fieldset>}
          <label className="block text-xs text-neutral-400">Notes<textarea rows={2} className={field + ' mt-1'} maxLength={2000} value={notes} disabled={!!busy || !!retry || !canEdit} onChange={event => setNotes(event.target.value)}/></label>
          {mode === 'receive' && parcel.items.length > 1 && <div className="grid grid-cols-2 gap-2"><button className={button} disabled={itemIndex === 0 || !!busy} onClick={() => { setItemIndex(n => n - 1); setProductSearch(''); }}><ChevronLeft className="inline h-4 w-4"/>Previous</button><button className={button} disabled={itemIndex === parcel.items.length - 1 || !!busy} onClick={() => { setItemIndex(n => n + 1); setProductSearch(''); }}>Next item<ChevronRight className="inline h-4 w-4"/></button></div>}
        </>}
      </div><div className="p-3 border-t border-neutral-800 bg-neutral-900">{!parcel.review_reason && <button className="w-full rounded-lg bg-emerald-500 px-3 py-2 font-black text-sm text-black disabled:opacity-40" disabled={!!busy || !canEdit} onClick={() => void saveReceipt()}>{retry ? 'Retry saved request' : mode === 'correct' ? 'Save Damage Correction' : 'Save Checked Items'}</button>}<p className="text-[11px] text-neutral-500 mt-2 text-center">{parcel.checked_at ? 'Last checked ' + date(parcel.checked_at) : 'Check actual items before saving stock.'}</p></div>
    </div></div>}
    <CameraBarcodeScanner open={camera} title="Scan return waybill" onClose={() => setCamera(false)} onDetected={value => { setCamera(false); void scan(value); }}/>
  </div>;
};
