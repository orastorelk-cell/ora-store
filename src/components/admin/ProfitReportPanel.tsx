import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FileUp, RefreshCw, Search } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { Order, PurchaseOrder, ReturnRecord } from '../../types';
import {
  buildPaidWaybillProfitReport, parseProfitWaybillFile, profitAdvertisingSummary, profitMoney, PROFIT_PAGE_SIZE,
  type PaymentAmountBasis, type ProfitDateRange,
} from '../../lib/paidWaybillProfit';

export interface ProfitReportDraft {
  waybills: string[];
  sourceName: string;
  facebook: string;
  tiktok: string;
  paymentBasis: PaymentAmountBasis;
}
const emptyDraft = (): ProfitReportDraft => ({ waybills: [], sourceName: '', facebook: '', tiktok: '', paymentBasis: 'auto' });
const readDraft = (key: string): ProfitReportDraft => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || !Array.isArray(saved.waybills)) return emptyDraft();
    return { waybills: saved.waybills.filter((value: unknown) => typeof value === 'string' && value.length <= 100).slice(0, 10000),
      sourceName: String(saved.sourceName || '').slice(0, 255), facebook: String(saved.facebook || ''), tiktok: String(saved.tiktok || ''),
      paymentBasis: ['auto', 'gross', 'net'].includes(saved.paymentBasis) ? saved.paymentBasis : 'auto' };
  } catch { return emptyDraft(); }
};
const dateLabel = (day: string) => day ? day.split('-').reverse().join('/') : '-';
const rangeLabel = (range: ProfitDateRange | null) => range ? `${dateLabel(range.from)} - ${dateLabel(range.to)}` : 'No paid orders from this source';
const money = (value: number | null) => value === null ? 'Pending' : profitMoney(value);

export interface ProfitReportWorkspaceProps {
  orders: Order[];
  purchases: PurchaseOrder[];
  returns: ReturnRecord[];
  ready: boolean;
  loadError?: string;
  storageKey: string;
  onRefresh: () => Promise<void>;
  initialDraft?: ProfitReportDraft;
}

export const ProfitReportWorkspace: React.FC<ProfitReportWorkspaceProps> = ({ orders, purchases, returns, ready, loadError, storageKey, onRefresh, initialDraft }) => {
  const [draft, setDraft] = useState<ProfitReportDraft>(() => initialDraft || readDraft(storageKey));
  const [fileData, setFileData] = useState<ReturnType<typeof parseProfitWaybillFile> | null>(null);
  const [column, setColumn] = useState(-1);
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'upload' | 'refresh' | 'pdf' | ''>('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'complete' | 'review'>('all');
  const [page, setPage] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const report = useMemo(() => buildPaidWaybillProfitReport({ waybills: draft.waybills, orders, purchases, returns, paymentBasis: draft.paymentBasis }), [draft.waybills, orders, purchases, returns, draft.paymentBasis]);
  const ads = useMemo(() => profitAdvertisingSummary(report, draft.facebook, draft.tiktok), [report, draft.facebook, draft.tiktok]);
  const currentRanges = JSON.stringify(report.ranges);
  const previousRanges = useRef(currentRanges);
  useEffect(() => {
    if (ready && previousRanges.current !== currentRanges) {
      setDraft(current => ({ ...current, facebook: '', tiktok: '' }));
      previousRanges.current = currentRanges;
    }
  }, [currentRanges, ready]);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch {} }, [draft, storageKey]);
  useEffect(() => { setPage(1); }, [search, filter, draft.waybills]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return report.rows.filter(row => (filter === 'all' || (filter === 'complete' ? row.profit !== null : row.profit === null))
      && (!needle || [row.waybill, row.orderNumber, ...row.items.map(item => `${item.sku} ${item.name}`)].join(' ').toLowerCase().includes(needle)));
  }, [report, filter, search]);
  const pages = Math.max(1, Math.ceil(visible.length / PROFIT_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = visible.slice((currentPage - 1) * PROFIT_PAGE_SIZE, currentPage * PROFIT_PAGE_SIZE);
  const available = ready && !loadError;
  const useWaybills = (values: string[], sourceName: string) => {
    const list = values.map(value => String(value || '').trim()).filter(Boolean);
    if (!list.length) throw new Error('No waybill numbers were found in the selected column.');
    if (list.length > 10000 || list.some(value => value.length > 100)) throw new Error('Use up to 10,000 waybills, with one number per row.');
    setDraft(current => ({ ...current, waybills: list, sourceName, facebook: '', tiktok: '' }));
    setSearch(''); setFilter('all'); setPage(1);
    setMessage(`Loaded ${list.length} waybill entries. Matching them with saved orders and payments.`);
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    setBusy('upload'); setMessage('');
    try {
      if (file.size > 2_000_000) throw new Error('The waybill file must be smaller than 2 MB.');
      const parsed = parseProfitWaybillFile(await file.text(), orders.map(order => order.waybill_number || ''));
      setFileData(parsed); setColumn(parsed.column);
      if (parsed.column >= 0) useWaybills(parsed.rows.map(row => row[parsed.column] || ''), file.name);
      else { setDraft(emptyDraft()); setMessage('Choose the Waybill column below, then build the report.'); }
    } catch (error: any) { setMessage(error?.message || 'Could not read this waybill file.'); }
    finally { setBusy(''); }
  };
  const refresh = async () => {
    setBusy('refresh');
    try { await onRefresh(); setMessage('Order and payment details refreshed.'); }
    catch (error: any) { setMessage(error?.message || 'Refresh failed. Please try again.'); }
    finally { setBusy(''); }
  };
  const downloadPdf = async () => {
    setBusy('pdf');
    try {
      const { createPaidWaybillProfitPdf } = await import('../../lib/paidWaybillProfitPdf');
      const doc = createPaidWaybillProfitPdf(report, { facebook: draft.facebook, tiktok: draft.tiktok, sourceName: draft.sourceName, paymentBasis: draft.paymentBasis });
      doc.save(`O-RA_Paid_Waybill_Profit_${new Date().toISOString().slice(0, 10)}.pdf`);
      setMessage('PDF downloaded with the summary and all uploaded waybills.');
    } catch (error: any) { setMessage(error?.message || 'PDF download failed.'); }
    finally { setBusy(''); }
  };
  const summaryRows: Array<[string, number | null, boolean?]> = [
    ['Recorded revenue (including customer delivery)', report.totals.received],
    ['Purchasing Cost', report.totals.purchasing], ['Fardar Delivery Cost', report.totals.courier],
    [`Packing Cost (${report.totals.ready} orders × Rs.100)`, report.totals.packing],
    ['Profit Before Advertising', report.totals.beforeAds, true],
    ['Facebook Cost', ads.facebook ?? (report.ranges.Facebook ? null : 0)], ['TikTok Cost', ads.tiktok ?? (report.ranges.TikTok ? null : 0)],
  ];

  return <div data-ora-view-allowed="true" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-black"><BarChart3 className="h-6 w-6 text-orange-600" />Profit Report</h2><p className="mt-1 text-sm text-gray-500">Payment ලැබුණු waybills අනුව වියදම් සහ ඉතිරි ලාභය.</p></div>
      <button type="button" onClick={refresh} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />Refresh Orders</button>
    </div>
    {(!ready || loadError) && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{loadError || 'Loading saved system data. The report will be available when loading finishes.'}</div>}

    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-black"><FileUp className="h-5 w-5 text-orange-600" />1. Upload Paid Waybills</h3>
      <p className="mt-1 text-xs text-gray-500">Upload a CSV / TSV / TXT file, or paste one waybill per line.</p>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <label className="block rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-xs font-bold">Waybill file
          <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" aria-label="Waybill file" disabled={!available || Boolean(busy)} onChange={event => void loadFile(event.target.files?.[0])} className="mt-3 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-orange-100 file:px-3 file:py-2 file:font-bold file:text-orange-800" />
          {draft.sourceName && <span className="mt-3 block break-all font-normal text-gray-500">Current: {draft.sourceName}</span>}
        </label>
        <div><label className="block text-xs font-bold" htmlFor="profit-waybill-paste">Paste waybill numbers</label><textarea id="profit-waybill-paste" value={paste} disabled={!available || Boolean(busy)} onChange={event => setPaste(event.target.value)} rows={3} placeholder={'18160001\n18160002'} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs" /><button type="button" disabled={!available || Boolean(busy) || !paste.trim()} onClick={() => { try { const parsed = parseProfitWaybillFile(paste, orders.map(order => order.waybill_number || '')); if (parsed.column < 0) throw new Error('Paste one waybill per line.'); useWaybills(parsed.rows.map(row => row[parsed.column] || ''), 'Pasted waybill list'); setFileData(null); } catch (error: any) { setMessage(error.message); } }} className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Build Profit Report</button></div>
      </div>
      {fileData && <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-gray-50 p-3"><label className="text-xs font-bold">Waybill column<select aria-label="Waybill column" value={column} disabled={Boolean(busy)} onChange={event => setColumn(Number(event.target.value))} className="ml-3 rounded-lg border border-gray-200 bg-white px-3 py-2 font-normal"><option value={-1}>Choose column</option>{fileData.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></label><button type="button" disabled={column < 0 || !available || Boolean(busy)} onClick={() => { try { useWaybills(fileData.rows.map(row => row[column] || ''), fileInput.current?.files?.[0]?.name || draft.sourceName); } catch (error: any) { setMessage(error.message); } }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold disabled:opacity-40">Use This Column</button></div>}
    </section>
    {message && <div role="status" className="rounded-xl border border-orange-100 bg-orange-50 p-3 text-xs font-semibold text-orange-800">{message}</div>}

    {report.rows.length > 0 && available && <>
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 font-black"><CalendarDays className="h-5 w-5 text-orange-600" />2. Add Advertising Costs</h3>
        <p className="mt-1 text-xs text-gray-500">Dates below are when these orders arrived in the system, in Sri Lanka time. Enter the spend for each shown range; enter 0 if there was no spend.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{(['Facebook', 'TikTok'] as const).map(source => <div key={source} className="rounded-xl border border-gray-200 p-4"><p className="text-sm font-black">{source}</p><p className="mt-2 text-lg font-bold text-orange-700">{rangeLabel(report.ranges[source])}</p><p className="mt-1 text-xs text-gray-500">{report.ranges[source]?.count || 0} paid orders</p><label className="mt-3 block text-xs font-bold">{source} Cost (Rs.)<input aria-label={`${source} Cost (Rs.)`} type="number" min="0" step="0.01" inputMode="decimal" value={source === 'Facebook' ? draft.facebook : draft.tiktok} onChange={event => setDraft(current => ({ ...current, [source === 'Facebook' ? 'facebook' : 'tiktok']: event.target.value }))} placeholder="Enter cost, or 0" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-normal" /></label></div>)}</div>
        <details className="mt-4 text-xs text-gray-500"><summary className="cursor-pointer font-bold text-gray-700">Payment amount settings</summary><p className="mt-2">Auto checks whether the saved Fardar amount is the full COD collection or the remittance after courier charges. If the amount cannot be reconciled, select the basis used in your payment import.</p><label className="mt-3 block font-bold">Saved Fardar amount<select aria-label="Saved Fardar amount" value={draft.paymentBasis} onChange={event => setDraft(current => ({ ...current, paymentBasis: event.target.value as PaymentAmountBasis }))} className="ml-3 rounded-lg border border-gray-200 bg-white px-3 py-2 font-normal"><option value="auto">Auto - reconcile saved amounts</option><option value="gross">Gross collection - before courier deduction</option><option value="net">Net remittance - after courier deduction</option></select></label></details>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
        ['Uploaded Waybills', report.rows.length, 'text-gray-900'], ['Complete Orders', report.totals.ready, 'text-emerald-700'], ['Needs Review', report.totals.review, report.totals.review ? 'text-amber-700' : 'text-gray-900'], ['Profit Before Ads', money(report.totals.beforeAds), report.totals.beforeAds >= 0 ? 'text-emerald-700' : 'text-red-700'],
      ].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-[11px] font-bold text-gray-500">{label}</p><p className={`mt-1 break-words text-xl font-black ${color}`}>{value}</p></div>)}</div>
      {report.duplicates > 0 && <p className="text-xs text-gray-500">{report.duplicates} duplicate upload entries removed. Each waybill is counted once.</p>}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4"><div><h3 className="font-black">3. Order Details</h3><p className="mt-1 text-xs text-gray-500">One waybill per row · 10 orders per page · All values in Rs.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" /><input aria-label="Search profit report" value={search} onChange={event => setSearch(event.target.value)} placeholder="Waybill / order / item" className="rounded-lg border border-gray-200 py-2 pl-8 pr-3 text-xs" /></label><select aria-label="Profit report status" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"><option value="all">All waybills</option><option value="complete">Complete orders</option><option value="review">Needs review</option></select></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-xs" aria-label="Paid waybill profit details"><caption className="sr-only">Each uploaded waybill and its system date, item sale prices, purchasing costs, courier cost, packing cost and profit before advertising.</caption><thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr>{['Waybill / Order', 'System Date', 'Item / Qty', 'Sale / Received', 'Purchasing Cost', 'Fardar Cost', 'Packing', 'Order Profit'].map((label, index) => <th key={label} scope="col" className={`whitespace-nowrap px-4 py-3 ${index >= 3 ? 'text-right' : 'text-left'} ${index === 0 ? 'sticky left-0 z-10 bg-gray-50' : ''}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{pageRows.map(row => <tr key={row.waybill} className="align-top">
          <th scope="row" className="sticky left-0 z-10 w-40 bg-white p-4 text-left"><p className="break-all font-mono text-sm font-black">{row.waybill}</p><p className="mt-1 font-normal text-gray-500">{row.orderNumber || 'Not found'}</p><p className="mt-1 font-normal text-gray-500">{row.source}</p><span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${row.profit === null ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{row.profit === null ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{row.profit === null ? 'Needs Review' : 'Complete'}</span></th>
          <td className="whitespace-nowrap p-4 font-semibold">{dateLabel(row.systemDate || '')}</td>
          <td className="w-60 p-4">{row.items.map((item, index) => <div key={index} className={`${index ? 'mt-3 border-t border-gray-100 pt-3' : ''}`}><p className="font-bold">{item.name}</p><p className="mt-1 text-gray-500">{item.sku} · Qty <b className="text-gray-700">{item.quantity}</b></p></div>)}{!row.items.length && <span className="text-gray-400">-</span>}{row.issues.length > 0 && <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-2 text-[10px] text-amber-800">{row.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}</td>
          <td className="p-4 text-right">{row.items.map((item, index) => <div key={index} className={`${index ? 'mt-3 border-t border-gray-100 pt-3' : ''}`}><p className="whitespace-nowrap font-semibold">{money(item.sales)}</p><p className="mt-1 whitespace-nowrap text-[10px] text-gray-500">{item.quantity} × {money(item.unitSale)}</p></div>)}<div className="mt-3 border-t border-gray-200 pt-2"><p className="text-[10px] text-gray-500">Recorded Revenue</p><p className="mt-1 whitespace-nowrap font-black">{money(row.received)}</p><p className="mt-1 max-w-36 text-[10px] text-gray-400">{row.paymentNote}</p></div></td>
          <td className="p-4 text-right">{row.items.map((item, index) => <div key={index} className={`${index ? 'mt-3 border-t border-gray-100 pt-3' : ''}`}><p className="whitespace-nowrap font-semibold">{money(item.purchasing)}</p><p className="mt-1 text-[10px] text-gray-500">From Purchasing</p></div>)}{row.items.length > 1 && <p className="mt-3 whitespace-nowrap border-t border-gray-200 pt-2 font-black">Total {money(row.purchasing)}</p>}{row.items.some(item => item.allocations.length > 0) && <details className="mt-3 text-[10px] text-gray-500"><summary className="cursor-pointer text-orange-700">Purchase details</summary>{row.items.flatMap((item, index) => item.allocations.map((allocation, part) => <p key={`${index}-${part}`} className="mt-2 max-w-44">{allocation.sku} · {allocation.reference}<br />{allocation.quantity} × {money(allocation.unitCost)}</p>))}</details>}</td>
          <td className="whitespace-nowrap p-4 text-right font-semibold">{money(row.courier)}</td><td className="whitespace-nowrap p-4 text-right font-semibold">{money(row.packing)}</td><td className={`whitespace-nowrap p-4 text-right font-black ${row.profit === null ? 'text-amber-700' : row.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money(row.profit)}<p className="mt-1 text-[10px] font-normal text-gray-400">Before ads</p></td>
        </tr>)}{pageRows.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-gray-500">No waybills match this search.</td></tr>}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-xs"><p className="text-gray-500">{visible.length ? `${(currentPage - 1) * PROFIT_PAGE_SIZE + 1}-${Math.min(currentPage * PROFIT_PAGE_SIZE, visible.length)}` : '0'} of {visible.length} waybills · Summary and PDF include the full upload.</p><div className="flex items-center gap-3"><button type="button" aria-label="Previous profit page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-gray-200 p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><span className="font-bold">Page {currentPage} / {pages}</span><button type="button" aria-label="Next profit page" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-gray-200 p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div></div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black">4. Profit Summary</h3><p className="mt-1 text-xs text-gray-500">{report.totals.review ? `Totals below cover ${report.totals.ready} complete orders. Resolve ${report.totals.review} waybills to show the final profit.` : `Totals for all ${report.totals.ready} uploaded orders.`}</p></div><button type="button" onClick={downloadPdf} disabled={!available || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-xs font-bold text-white disabled:opacity-40"><Download className="h-4 w-4" />{busy === 'pdf' ? 'Preparing PDF...' : 'Download Summary PDF'}</button></div>
        <dl className="mt-4 divide-y divide-gray-100">{summaryRows.map(([label, value, bold]) => <div key={label} className={`flex items-center justify-between gap-4 py-3 text-sm ${bold ? 'font-black' : ''}`}><dt className="text-gray-600">{label}</dt><dd className="whitespace-nowrap font-bold">{money(value)}</dd></div>)}</dl>
        <div className={`mt-4 rounded-xl p-5 ${ads.netProfit === null ? 'bg-amber-50 text-amber-900' : ads.netProfit >= 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}><p className="text-xs font-black uppercase tracking-wide">Final Net Profit / ඉතිරි මුළු ලාභය</p><p className="mt-2 text-3xl font-black">{ads.netProfit === null ? 'Pending' : profitMoney(ads.netProfit)}</p>{ads.netProfit === null && <p className="mt-2 text-xs">{report.totals.review > 0 ? `${report.totals.review} waybill(s) need review. ` : ''}{ads.missing.length ? `Enter ${ads.missing.join(' / ')} cost, or 0 if none. ` : ''}{ads.invalid ? 'Advertising costs must be valid amounts of 0 or more.' : ''}</p>}<p className="mt-3 text-xs">Recorded revenue − Purchasing − Fardar − Packing − Facebook − TikTok</p></div>
        <p className="mt-4 text-[11px] leading-relaxed text-gray-500">Purchasing costs follow purchased quantities in date order (FIFO), including other allocated orders and verified good returns. Packing is Rs.100 per order. The report uses actual Purchasing records and actual Fardar charges.</p>
      </section>
    </>}
  </div>;
};

export const ProfitReportPanel: React.FC = () => {
  const { orders, purchaseOrders, returnRecords, sharedStoreReady, sharedOrdersReady, orderLoadError, refreshOrdersFromServer, adminUser } = useStore();
  return <ProfitReportWorkspace key={adminUser?.id} orders={orders} purchases={purchaseOrders} returns={returnRecords} ready={sharedStoreReady && sharedOrdersReady}
    loadError={orderLoadError} storageKey={`ora_paid_waybill_profit_v1:${adminUser?.id || 'staff'}`} onRefresh={refreshOrdersFromServer} />;
};
