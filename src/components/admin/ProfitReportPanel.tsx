import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, RefreshCw, Search, WalletCards } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { Order, PurchaseOrder, ReturnRecord } from '../../types';
import { staffJsonRequest } from '../../lib/staffRequest';
import { allocateFacebookAdCosts, emptyFacebookAdLedger, facebookAllocatedAdvertisingSummary, readFacebookAdLedger, type FacebookAdLedger } from '../../lib/facebookProfitAds';
import { FacebookProfitAdsPanel } from './FacebookProfitAdsPanel';
import {
  buildPaidWaybillProfitReport, selectSavedPaidProfitOrders, profitAdvertisingPeriodKey, profitAdvertisingSummary, profitMoney, PROFIT_PAGE_SIZE,
  type PaymentAmountBasis, type ProfitDateRange, type ProfitPaymentFilter,
} from '../../lib/paidWaybillProfit';

export interface ProfitReportDraft {
  paymentFilter: ProfitPaymentFilter;
  fromDate: string;
  toDate: string;
  facebook: string;
  tiktok: string;
  paymentBasis: PaymentAmountBasis;
  advertisingPeriod?: string;
}
const emptyDraft = (): ProfitReportDraft => ({ paymentFilter: 'all', fromDate: '', toDate: '', facebook: '', tiktok: '', paymentBasis: 'auto' });
const readDraft = (key: string): ProfitReportDraft => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || typeof saved !== 'object') return emptyDraft();
    const day = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    return { paymentFilter: ['all', 'cod', 'online'].includes(saved.paymentFilter) ? saved.paymentFilter : 'all',
      fromDate: day(saved.fromDate), toDate: day(saved.toDate), facebook: String(saved.facebook || ''), tiktok: String(saved.tiktok || ''),
      paymentBasis: ['auto', 'gross', 'net'].includes(saved.paymentBasis) ? saved.paymentBasis : 'auto',
      advertisingPeriod: typeof saved.advertisingPeriod === 'string' ? saved.advertisingPeriod : undefined };
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
  advertisingLedger?: FacebookAdLedger;
  advertisingReady?: boolean;
  advertisingError?: string;
  canImportAds?: boolean;
  knownAdCodes?: string[];
  onImportAds?: (csv: string, fileName: string) => Promise<FacebookAdLedger>;
  onReloadAds?: () => Promise<void>;
}

export const ProfitReportWorkspace: React.FC<ProfitReportWorkspaceProps> = ({ orders, purchases, returns, ready, loadError, storageKey, onRefresh, initialDraft,
  advertisingLedger, advertisingReady = true, advertisingError, canImportAds = false, knownAdCodes = [], onImportAds, onReloadAds }) => {
  const [draft, setDraft] = useState<ProfitReportDraft>(() => initialDraft || readDraft(storageKey));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'refresh' | 'pdf' | ''>('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'complete' | 'review'>('all');
  const [page, setPage] = useState(1);
  const selection = useMemo(() => ({ paymentFilter: draft.paymentFilter, fromDate: draft.fromDate, toDate: draft.toDate }), [draft.paymentFilter, draft.fromDate, draft.toDate]);
  const paidOrders = useMemo(() => selectSavedPaidProfitOrders(orders), [orders]);
  const report = useMemo(() => buildPaidWaybillProfitReport({ orders, purchases, returns, paymentBasis: draft.paymentBasis, selection }), [orders, purchases, returns, draft.paymentBasis, selection]);
  const sourceName = `${draft.paymentFilter === 'cod' ? 'Saved COD Received orders' : draft.paymentFilter === 'online' ? 'Saved paid online orders' : 'Saved COD Received and paid online orders'} | System dates: ${draft.fromDate || 'All'} to ${draft.toDate || 'All'}`;
  const emptyLedger = useMemo(emptyFacebookAdLedger, []);
  const csvMode = Boolean(onImportAds || advertisingLedger?.rows.length);
  const facebookAllocation = useMemo(() => allocateFacebookAdCosts(advertisingLedger || emptyLedger, orders, report, selection), [advertisingLedger, emptyLedger, orders, report, selection]);
  const ads = useMemo(() => {
    const result = csvMode ? facebookAllocatedAdvertisingSummary(report, facebookAllocation, draft.tiktok) : profitAdvertisingSummary(report, draft.facebook, draft.tiktok);
    return csvMode && (!advertisingReady || advertisingError) ? { ...result, netProfit: null } : result;
  }, [csvMode, report, facebookAllocation, draft.facebook, draft.tiktok, advertisingReady, advertisingError]);
  const currentPeriod = profitAdvertisingPeriodKey(report, selection);
  useEffect(() => {
    if (!ready || loadError) return;
    setDraft(current => current.advertisingPeriod === currentPeriod ? current : { ...current,
      facebook: current.advertisingPeriod ? '' : current.facebook, tiktok: current.advertisingPeriod ? '' : current.tiktok,
      advertisingPeriod: currentPeriod });
  }, [currentPeriod, ready, loadError]);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch {} }, [draft, storageKey]);
  useEffect(() => { setPage(1); }, [search, filter, selection]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return report.rows.filter(row => (filter === 'all' || (filter === 'complete' ? row.profit !== null : row.profit === null))
      && (!needle || [row.waybill, row.orderNumber, ...row.items.map(item => `${item.sku} ${item.name}`)].join(' ').toLowerCase().includes(needle)));
  }, [report, filter, search]);
  const pages = Math.max(1, Math.ceil(visible.length / PROFIT_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = visible.slice((currentPage - 1) * PROFIT_PAGE_SIZE, currentPage * PROFIT_PAGE_SIZE);
  const available = ready && !loadError;
  const invalidDates = Boolean(draft.fromDate && draft.toDate && draft.fromDate > draft.toDate);
  const changeSelection = (changes: Partial<Pick<ProfitReportDraft, 'paymentFilter' | 'fromDate' | 'toDate'>>) => {
    setDraft(current => ({ ...current, ...changes, facebook: '', tiktok: '', advertisingPeriod: undefined }));
    setMessage(''); setPage(1);
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
      const doc = createPaidWaybillProfitPdf(report, { facebook: draft.facebook, tiktok: draft.tiktok, sourceName, paymentBasis: draft.paymentBasis,
        facebookAllocation: csvMode ? facebookAllocation : undefined, advertisingError: csvMode && (!advertisingReady || advertisingError) ? advertisingError || 'Advertising history is still loading.' : undefined });
      doc.save(`O-RA_Paid_Waybill_Profit_${new Date().toISOString().slice(0, 10)}.pdf`);
      setMessage('PDF downloaded with the summary and all selected paid orders.');
    } catch (error: any) { setMessage(error?.message || 'PDF download failed.'); }
    finally { setBusy(''); }
  };
  const summaryRows: Array<[string, number | null, boolean?]> = [
    ['Recorded revenue (including customer delivery)', report.totals.received],
    ['Purchasing Cost', report.totals.purchasing], ['Fardar Delivery Cost', report.totals.courier],
    [`Packing Cost (${report.totals.ready} orders × Rs.100)`, report.totals.packing],
    ['Profit Before Advertising', report.totals.beforeAds, true],
    ...(csvMode ? [
      ['Facebook Cost — selected delivered / paid orders', facebookAllocation.paidCost],
      ['Facebook Ad Loss — cancelled / returned / zero leads', facebookAllocation.lostCost],
      ['Commercial Facebook Cost', facebookAllocation.commercialCost],
    ] as Array<[string, number]> : [['Facebook Cost', ads.facebook ?? (report.ranges.Facebook ? null : 0)]] as Array<[string, number | null]>),
    ['TikTok Cost', ads.tiktok ?? (report.ranges.TikTok ? null : 0)],
  ];

  return <div data-ora-view-allowed="true" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-black"><BarChart3 className="h-6 w-6 text-orange-600" />Profit Report</h2><p className="mt-1 text-sm text-gray-500">System එකේ save වූ paid orders අනුව වියදම් සහ ඉතිරි ලාභය.</p></div>
      <button type="button" onClick={refresh} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />Refresh Orders</button>
    </div>
    {(!ready || loadError) && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{loadError || 'Loading saved system data. The report will be available when loading finishes.'}</div>}

    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-black"><WalletCards className="h-5 w-5 text-orange-600" />1. Saved Paid Orders</h3>
      <p className="mt-1 text-sm text-gray-500">COD Received සහ සම්පූර්ණ online payment ලැබුණු orders මෙතැනට ස්වයංක්‍රීයව එනවා.</p>
      {available && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">Saved COD Received</p><p className="mt-1 text-xl font-black text-emerald-900">{paidOrders.filter(order => order.cod_payment_received).length}</p></div>
        <div className="rounded-xl bg-blue-50 p-3"><p className="text-xs font-bold text-blue-700">Saved Paid Online Orders</p><p className="mt-1 text-xl font-black text-blue-900">{paidOrders.filter(order => !order.cod_payment_received).length}</p></div>
      </div>}
      <div className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block text-xs font-bold">Payments<select aria-label="Profit payment source" value={draft.paymentFilter} disabled={!available || Boolean(busy)} onChange={event => changeSelection({ paymentFilter: event.target.value as ProfitPaymentFilter })} className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 font-normal"><option value="all">COD Received + Online Paid</option><option value="cod">COD Received</option><option value="online">Online Paid</option></select></label>
        <label className="block text-xs font-bold">System date from<input aria-label="Profit system date from" type="date" value={draft.fromDate} max={draft.toDate || undefined} disabled={!available || Boolean(busy)} onChange={event => changeSelection({ fromDate: event.target.value })} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 font-normal" /></label>
        <label className="block text-xs font-bold">System date to<input aria-label="Profit system date to" type="date" value={draft.toDate} min={draft.fromDate || undefined} disabled={!available || Boolean(busy)} onChange={event => changeSelection({ toDate: event.target.value })} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 font-normal" /></label>
        <button type="button" disabled={!available || Boolean(busy)} onClick={() => changeSelection({ paymentFilter: 'all', fromDate: '', toDate: '' })} className="rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-bold disabled:opacity-40">Show All Paid Orders</button>
      </div>
      <p className="mt-3 text-xs text-gray-500">Date filters use when the order arrived in the system. Choose fixed start and end dates to keep the same advertising period as later payments arrive.</p>
      {invalidDates && <p role="alert" className="mt-3 text-xs font-bold text-red-700">The start date must be on or before the end date.</p>}
      {available && !invalidDates && <p className="mt-3 text-xs font-bold text-gray-700">{report.rows.length} paid orders selected for this report.</p>}
    </section>
    {message && <div role="status" className="rounded-xl border border-orange-100 bg-orange-50 p-3 text-xs font-semibold text-orange-800">{message}</div>}

    {available && !invalidDates && report.rows.length === 0 && <div role="status" className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">No saved paid orders match these filters.</div>}
    {available && !invalidDates &&
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 font-black"><CalendarDays className="h-5 w-5 text-orange-600" />2. Advertising Costs</h3>
        {onImportAds && onReloadAds && <FacebookProfitAdsPanel ledger={advertisingLedger || emptyLedger} allocation={facebookAllocation} ready={advertisingReady}
          error={advertisingError} canImport={canImportAds} knownCodes={knownAdCodes} onImport={onImportAds} onReload={onReloadAds} />}
        <p className="mt-4 text-sm text-gray-500">{csvMode ? 'Facebook costs use saved CSV reports. Enter the TikTok total for the selected system-date period, or 0 if none.' : 'Enter the total spend once for the shown system-date period; enter 0 if none. This report recalculates the cumulative profit when later payments arrive.'}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{(csvMode ? ['TikTok'] as const : ['Facebook', 'TikTok'] as const).map(source => <div key={source} className="rounded-xl border border-gray-200 p-4"><p className="text-sm font-black">{source}</p><p className="mt-2 text-lg font-bold text-orange-700">{rangeLabel(report.ranges[source])}</p><p className="mt-1 text-xs text-gray-500">{report.ranges[source]?.count || 0} paid orders</p><label className="mt-3 block text-xs font-bold">{source} Cost (Rs.)<input aria-label={`${source} Cost (Rs.)`} type="number" min="0" step="0.01" inputMode="decimal" value={source === 'Facebook' ? draft.facebook : draft.tiktok} onChange={event => setDraft(current => ({ ...current, [source === 'Facebook' ? 'facebook' : 'tiktok']: event.target.value, advertisingPeriod: currentPeriod }))} placeholder="Enter cost, or 0" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-normal" /></label></div>)}</div>
        <details className="mt-4 text-xs text-gray-500"><summary className="cursor-pointer font-bold text-gray-700">Payment amount settings</summary><p className="mt-2">Auto checks whether the saved Fardar amount is the full COD collection or the remittance after courier charges. If the amount cannot be reconciled, select the basis used in your payment import.</p><label className="mt-3 block font-bold">Saved Fardar amount<select aria-label="Saved Fardar amount" value={draft.paymentBasis} onChange={event => setDraft(current => ({ ...current, paymentBasis: event.target.value as PaymentAmountBasis }))} className="ml-3 rounded-lg border border-gray-200 bg-white px-3 py-2 font-normal"><option value="auto">Auto - reconcile saved amounts</option><option value="gross">Gross collection - before courier deduction</option><option value="net">Net remittance - after courier deduction</option></select></label></details>
      </section>
    }
    {report.rows.length > 0 && available && !invalidDates && <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
        ['Selected Paid Orders', report.rows.length, 'text-gray-900'], ['Complete Orders', report.totals.ready, 'text-emerald-700'], ['Needs Review', report.totals.review, report.totals.review ? 'text-amber-700' : 'text-gray-900'], ['Profit Before Ads', money(report.totals.beforeAds), report.totals.beforeAds >= 0 ? 'text-emerald-700' : 'text-red-700'],
      ].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-[11px] font-bold text-gray-500">{label}</p><p className={`mt-1 break-words text-xl font-black ${color}`}>{value}</p></div>)}</div>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4"><div><h3 className="font-black">3. Order Details</h3><p className="mt-1 text-xs text-gray-500">One paid order per row · 10 orders per page · All values in Rs.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" /><input aria-label="Search profit report" value={search} onChange={event => setSearch(event.target.value)} placeholder="Waybill / order / item" className="rounded-lg border border-gray-200 py-2 pl-8 pr-3 text-xs" /></label><select aria-label="Profit report status" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"><option value="all">All paid orders</option><option value="complete">Complete orders</option><option value="review">Needs review</option></select></div></div>
        <div className="overflow-x-auto"><table className={`w-full ${csvMode ? 'min-w-[1400px]' : 'min-w-[1120px]'} text-xs`} aria-label="Paid waybill profit details"><caption className="sr-only">Each saved paid order, its saved costs, profit before advertising and allocated Facebook cost.</caption><thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr>{['Waybill / Order', 'System Date', 'Item / Qty', 'Sale / Received', 'Purchasing Cost', 'Fardar Cost', 'Packing', 'Order Profit', ...(csvMode ? ['FB Ad Cost', 'Profit After FB'] : [])].map((label, index) => <th key={label} scope="col" className={`whitespace-nowrap px-4 py-3 ${index >= 3 ? 'text-right' : 'text-left'} ${index === 0 ? 'sticky left-0 z-10 bg-gray-50' : ''}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{pageRows.map(row => <tr key={row.orderId || row.waybill} className="align-top">
          <th scope="row" className="sticky left-0 z-10 w-40 bg-white p-4 text-left"><p className="break-all font-mono text-sm font-black">{row.waybill || 'Not assigned'}</p><p className="mt-1 font-normal text-gray-500">{row.orderNumber || 'Not found'}</p><p className="mt-1 font-normal text-gray-500">{row.source} · {row.paymentKind === 'cod' ? 'COD Received' : 'Online Paid'}</p><span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${row.profit === null ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{row.profit === null ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{row.profit === null ? 'Needs Review' : 'Complete'}</span></th>
          <td className="whitespace-nowrap p-4 font-semibold">{dateLabel(row.systemDate || '')}</td>
          <td className="w-60 p-4">{row.items.map((item, index) => <div key={index} className={`${index ? 'mt-3 border-t border-gray-100 pt-3' : ''}`}><p className="font-bold">{item.name}</p><p className="mt-1 text-gray-500">{item.sku} · Qty <b className="text-gray-700">{item.quantity}</b></p></div>)}{!row.items.length && <span className="text-gray-400">-</span>}{row.issues.length > 0 && <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-2 text-[10px] text-amber-800">{row.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}</td>
          <td className="p-4 text-right">{row.items.map((item, index) => <div key={index} className={`${index ? 'mt-3 border-t border-gray-100 pt-3' : ''}`}><p className="whitespace-nowrap font-semibold">{money(item.sales)}</p><p className="mt-1 whitespace-nowrap text-[10px] text-gray-500">{item.quantity} × {money(item.unitSale)}</p></div>)}<div className="mt-3 border-t border-gray-200 pt-2"><p className="text-[10px] text-gray-500">Recorded Revenue</p><p className="mt-1 whitespace-nowrap font-black">{money(row.received)}</p><p className="mt-1 max-w-36 text-[10px] text-gray-400">{row.paymentNote}</p></div></td>
          <td className="p-4 text-right">{row.items.map((item, index) => <div key={index} className={`${index ? 'mt-3 border-t border-gray-100 pt-3' : ''}`}><p className="whitespace-nowrap font-semibold">{money(item.purchasing)}</p><p className="mt-1 text-[10px] text-gray-500">From Purchasing</p></div>)}{row.items.length > 1 && <p className="mt-3 whitespace-nowrap border-t border-gray-200 pt-2 font-black">Total {money(row.purchasing)}</p>}{row.items.some(item => item.allocations.length > 0) && <details className="mt-3 text-[10px] text-gray-500"><summary className="cursor-pointer text-orange-700">Purchase details</summary>{row.items.flatMap((item, index) => item.allocations.map((allocation, part) => <p key={`${index}-${part}`} className="mt-2 max-w-44">{allocation.sku} · {allocation.reference}<br />{allocation.quantity} × {money(allocation.unitCost)}</p>))}</details>}</td>
          <td className="whitespace-nowrap p-4 text-right font-semibold">{money(row.courier)}</td><td className="whitespace-nowrap p-4 text-right font-semibold">{money(row.packing)}</td><td className={`whitespace-nowrap p-4 text-right font-black ${row.profit === null ? 'text-amber-700' : row.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money(row.profit)}<p className="mt-1 text-[10px] font-normal text-gray-400">Before ads</p></td>
          {csvMode && <>
            <td className="whitespace-nowrap p-4 text-right font-semibold">{row.source !== 'Facebook' ? '—' : money(row.orderId && facebookAllocation.orderCosts.get(row.orderId)?.state === 'paid' ? facebookAllocation.orderCosts.get(row.orderId)!.cost : null)}</td>
            <td className="whitespace-nowrap p-4 text-right font-bold">{row.source !== 'Facebook' ? '—' : money(row.profit !== null && row.orderId && facebookAllocation.orderCosts.get(row.orderId)?.state === 'paid' ? row.profit - facebookAllocation.orderCosts.get(row.orderId)!.cost : null)}<p className="mt-1 text-[10px] font-normal text-gray-400">Shared ad losses / Commercial in summary</p></td>
          </>}
        </tr>)}{pageRows.length === 0 && <tr><td colSpan={csvMode ? 10 : 8} className="p-8 text-center text-gray-500">No paid orders match this search.</td></tr>}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-xs"><p className="text-gray-500">{visible.length ? `${(currentPage - 1) * PROFIT_PAGE_SIZE + 1}-${Math.min(currentPage * PROFIT_PAGE_SIZE, visible.length)}` : '0'} of {visible.length} paid orders · Summary and PDF include all selected paid orders.</p><div className="flex items-center gap-3"><button type="button" aria-label="Previous profit page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-gray-200 p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><span className="font-bold">Page {currentPage} / {pages}</span><button type="button" aria-label="Next profit page" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-gray-200 p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div></div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black">4. Profit Summary</h3><p className="mt-1 text-xs text-gray-500">{report.totals.review ? `Totals below cover ${report.totals.ready} complete orders. Resolve ${report.totals.review} paid orders to show the final profit.` : `Totals for all ${report.totals.ready} selected paid orders.`}</p></div><button type="button" onClick={downloadPdf} disabled={!available || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-xs font-bold text-white disabled:opacity-40"><Download className="h-4 w-4" />{busy === 'pdf' ? 'Preparing PDF...' : 'Download Summary PDF'}</button></div>
        <dl className="mt-4 divide-y divide-gray-100">{summaryRows.map(([label, value, bold]) => <div key={label} className={`flex items-center justify-between gap-4 py-3 text-sm ${bold ? 'font-black' : ''}`}><dt className="text-gray-600">{label}</dt><dd className="whitespace-nowrap font-bold">{money(value)}</dd></div>)}</dl>
        <div className={`mt-4 rounded-xl p-5 ${ads.netProfit === null ? 'bg-amber-50 text-amber-900' : ads.netProfit >= 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}><p className="text-sm font-black">{csvMode ? 'Paid-order Profit After Advertising / මුදල් ලැබුණු orders වල ලාභය' : 'Final Net Profit / ඉතිරි මුළු ලාභය'}</p><p className="mt-2 text-3xl font-black">{ads.netProfit === null ? 'Pending' : profitMoney(ads.netProfit)}</p>{ads.netProfit === null && <p className="mt-2 text-sm">{report.totals.review > 0 ? `${report.totals.review} paid order(s) need review. ` : ''}{ads.missing.length ? `Enter ${ads.missing.join(' / ')} cost, or 0 if none. ` : ''}{ads.invalid ? 'Advertising costs must be valid amounts of 0 or more. ' : ''}{csvMode && (!advertisingReady || advertisingError) ? 'Saved advertising costs have not loaded. ' : ''}{csvMode && (facebookAllocation.missingOrderIds.length || facebookAllocation.unmatchedCost > 0 || facebookAllocation.issues.length) ? 'Review the Facebook cost matching above before treating this profit as complete.' : ''}</p>}<p className="mt-3 text-xs">{csvMode ? 'Recorded revenue − Purchasing − Fardar − Packing − Allocated Facebook cost − Known ad losses − Commercial − TikTok' : 'Recorded revenue − Purchasing − Fardar − Packing − Facebook − TikTok'}</p></div>
        <p className="mt-4 text-[11px] leading-relaxed text-gray-500">Purchasing costs follow purchased quantities in date order (FIFO), including other allocated orders and verified good returns. Packing is Rs.100 per order. The report uses actual Purchasing records and actual Fardar charges.</p>
      </section>
    </>}
  </div>;
};

export const ProfitReportPanel: React.FC = () => {
  const { orders, products, purchaseOrders, returnRecords, sharedStoreReady, sharedOrdersReady, orderLoadError, refreshOrdersFromServer, adminUser } = useStore();
  const [ledger, setLedger] = useState<FacebookAdLedger>(emptyFacebookAdLedger);
  const [advertisingReady, setAdvertisingReady] = useState(false);
  const [advertisingError, setAdvertisingError] = useState('');
  const loadAdvertising = useCallback(async () => {
    setAdvertisingReady(false); setAdvertisingError('');
    try {
      const data = await staffJsonRequest('/api/admin/profit-ad-costs', { headers: { Authorization: `Bearer ${localStorage.getItem('ora_staff_session_token') || ''}` } });
      if (!data.ledger) throw new Error('Advertising history response was incomplete. Refresh Ad Costs to retry.');
      const saved = readFacebookAdLedger(data.ledger);
      setLedger(current => saved.version >= current.version ? saved : current);
      setAdvertisingReady(true);
    } catch (error: any) { setAdvertisingError(error.message || 'Saved ad costs could not load. Refresh Ad Costs to retry.'); throw error; }
  }, [adminUser?.id]);
  useEffect(() => {
    setLedger(emptyFacebookAdLedger()); setAdvertisingReady(false); setAdvertisingError('');
    if (adminUser && sharedStoreReady) void loadAdvertising().catch(() => {});
  }, [adminUser?.id, sharedStoreReady, loadAdvertising]);
  const importAdvertising = async (csv: string, fileName: string) => {
    const data = await staffJsonRequest('/api/admin/profit-ad-costs', { method: 'POST', headers: {
      Authorization: `Bearer ${localStorage.getItem('ora_staff_session_token') || ''}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ csv, fileName, expectedVersion: ledger.version }) });
    if (!data.ledger) throw new Error('Advertising save was not confirmed. Retry the same CSV.');
    const saved = readFacebookAdLedger(data.ledger);
    setLedger(current => saved.version >= current.version ? saved : current);
    setAdvertisingReady(true); setAdvertisingError('');
    return saved;
  };
  const refresh = async () => { await Promise.all([refreshOrdersFromServer(), loadAdvertising()]); };
  const canImport = adminUser?.role === 'admin' || Boolean(adminUser?.permissions?.includes('profit_report') && !adminUser?.permissions?.includes('level:profit_report:view'));
  return <ProfitReportWorkspace key={adminUser?.id} orders={orders} purchases={purchaseOrders} returns={returnRecords} ready={sharedStoreReady && sharedOrdersReady}
    loadError={orderLoadError} storageKey={`ora_paid_waybill_profit_v2:${adminUser?.id || 'staff'}`} onRefresh={refresh}
    advertisingLedger={ledger} advertisingReady={advertisingReady} advertisingError={advertisingError} canImportAds={canImport}
    knownAdCodes={products.flatMap(product => [product.sku, ...(product.variants || []).map(variant => variant.sku)])}
    onImportAds={importAdvertising} onReloadAds={loadAdvertising} />;
};
