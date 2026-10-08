import React, { useEffect, useRef, useState } from 'react';
import { History, RefreshCw, Search } from 'lucide-react';
import { compareReturnScans, RETURN_SCAN_TIME_ZONE, type ReturnScan } from '../../lib/returnScanHistory';

type ScanPage = { scans: ReturnScan[]; total: number };
const field = 'w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 min-h-9 text-sm text-white';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 min-h-9 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-40';
const scanDate = new Intl.DateTimeFormat('en-GB',{ timeZone: RETURN_SCAN_TIME_ZONE,day: '2-digit',month: 'short',year: 'numeric' });
const scanTime = new Intl.DateTimeFormat('en-GB',{ timeZone: RETURN_SCAN_TIME_ZONE,hour: '2-digit',minute: '2-digit',second: '2-digit',hour12: true });
const mergeScans = (recent: ReturnScan[], previous: ReturnScan[]) => [...new Map([...previous,...recent].map(scan => [scan.id,scan])).values()]
  .sort(compareReturnScans);

// This component owns only history state. Polls and filters never load a parcel
// or replace a receiving popup, its draft quantities, or uploaded photos.
export const ReturnScanHistory: React.FC<{ request: (path: string) => Promise<ScanPage>; scanVersion: number }> = ({request,scanVersion}) => {
  const [search,setSearch] = useState(''), [date,setDate] = useState('');
  const [scans,setScans] = useState<ReturnScan[]>([]), [total,setTotal] = useState(0);
  const [loading,setLoading] = useState(true), [loadingMore,setLoadingMore] = useState(false), [error,setError] = useState('');
  const rowsRef = useRef(scans); rowsRef.current = scans;
  const queryRef = useRef(''); queryRef.current = search + '|' + date;
  const refreshRef = useRef<() => Promise<void>>(async () => {}), moreRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let active = true, refreshTicket = 0, totalTicket = 0, sequence = 0, moreRunning = false, keepOlder = false;
    const query = search + '|' + date;
    const path = '/api/returns/scans?search=' + encodeURIComponent(search) + '&date=' + encodeURIComponent(date);
    const current = () => active && queryRef.current === query;
    setScans([]); rowsRef.current = []; setTotal(0); setLoading(true); setLoadingMore(false); setError('');
    const apply = (data: ScanPage,ticket: number) => {
      setScans(previous => keepOlder ? mergeScans(data.scans,previous) : data.scans);
      if (ticket >= totalTicket) { totalTicket = ticket; setTotal(data.total); }
      setError('');
    };
    const refresh = async () => {
      const ticket = ++sequence; refreshTicket = ticket;
      try {
        const data = await request(path);
        if (current() && ticket === refreshTicket) apply(data,ticket);
      } catch (error: any) { if (current() && ticket === refreshTicket) setError(error.message || 'Scan history could not refresh.'); }
      finally { if (current() && ticket === refreshTicket) setLoading(false); }
    };
    const more = async () => {
      const before = rowsRef.current.at(-1)?.id;
      if (!before || moreRunning) return;
      moreRunning = true; keepOlder = true; setLoadingMore(true); const ticket = ++sequence;
      try {
        const data = await request(path + '&before=' + encodeURIComponent(before));
        if (current()) apply(data,ticket);
      } catch (error: any) { if (current()) setError(error.message || 'Older scans could not load.'); }
      finally { moreRunning = false; if (current()) setLoadingMore(false); }
    };
    refreshRef.current = refresh; moreRef.current = more;
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const initial = setTimeout(() => void refresh(),250), timer = setInterval(refreshVisible,20000);
    window.addEventListener('focus',refreshVisible);
    return () => { active = false; clearTimeout(initial); clearInterval(timer); window.removeEventListener('focus',refreshVisible); };
  },[search,date,request]);

  useEffect(() => { if (scanVersion) void refreshRef.current(); },[scanVersion]);

  return <section aria-labelledby="return-scan-history-title" className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 space-y-3 min-w-0">
    <div className="flex items-center justify-between gap-2">
      <div><h3 id="return-scan-history-title" className="flex items-center gap-2 text-sm font-bold text-white"><History className="h-4 w-4 text-orange-300"/>Scan history <span className="text-neutral-500 font-normal">({total})</span></h3><p className="text-xs text-neutral-500 mt-1">Newest scans first · Sri Lanka time</p></div>
      <button className={button} aria-label="Refresh scan history" onClick={() => void refreshRef.current()}><RefreshCw className="h-4 w-4"/></button>
    </div>
    <div className="grid sm:grid-cols-[minmax(0,1fr)_12rem_auto] gap-2 items-end">
      <label className="block min-w-0"><span className="block text-xs text-neutral-400 mb-1">Waybill search</span><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500"/><input className={field + ' pl-9'} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search scanned waybill"/></div></label>
      <label className="block min-w-0"><span className="block text-xs text-neutral-400 mb-1">Scan date</span><input className={field} style={{colorScheme: 'dark'}} type="date" value={date} onChange={event => setDate(event.target.value)}/></label>
      {(search || date) && <button className={button} onClick={() => { setSearch(''); setDate(''); }}>Clear filters</button>}
    </div>
    {error && <p role="status" className="text-xs text-amber-300">{error}</p>}
    {loading && !scans.length ? <p role="status" className="text-xs text-neutral-400">Loading scan history…</p> : !scans.length ? <p className="text-xs text-neutral-500">{search || date ? 'No scans match these filters.' : 'No return waybills scanned yet.'}</p> : <ol className="max-h-80 overflow-y-auto divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-950">
      {scans.map((scan,index) => <li key={scan.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
        <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><b className="font-mono text-sm text-orange-300 break-all">{scan.waybill}</b>{index === 0 && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">{search || date ? 'Latest match' : 'Latest'}</span>}</p><p className="text-[11px] text-neutral-500 break-words mt-0.5">{scan.scanned_by || 'Staff'} · {scan.sheet_id ? 'Sheet ' + scan.sheet_id : 'Awaiting CSV'}{scan.order_number ? ' · ' + scan.order_number : ''}</p></div>
        <time dateTime={scan.scanned_at} className="text-xs text-neutral-300 tabular-nums whitespace-nowrap">{scanDate.format(new Date(scan.scanned_at))} · <span className="text-neutral-400">{scanTime.format(new Date(scan.scanned_at))}</span></time>
      </li>)}
    </ol>}
    {scans.length < total && <div className="flex items-center justify-between gap-2"><p className="text-xs text-neutral-500">Showing {scans.length} of {total} scans</p><button className={button} disabled={loading || loadingMore} onClick={() => void moreRef.current()}>{loadingMore ? 'Loading…' : 'Load older scans'}</button></div>}
  </section>;
};
