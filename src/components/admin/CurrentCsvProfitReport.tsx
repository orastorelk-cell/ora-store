import React, { useMemo, useRef, useState } from 'react';
import { BarChart3, Download, RefreshCw, Upload, X } from 'lucide-react';
import type { Order, PurchaseOrder, ReturnRecord } from '../../types';
import { buildPaidWaybillProfitReport, parseProfitWaybillUpload, profitMoney, profitSystemDay, type PaymentAmountBasis, type ProfitCatalogProduct } from '../../lib/paidWaybillProfit';
import { allocateCurrentCsvCosts, currentFacebookCsv, currentCsvProfitSummary, type CurrentFacebookCsv } from '../../lib/currentCsvProfit';

export interface CurrentCsvProfitReportProps {
  orders: Order[]; purchases: PurchaseOrder[]; products: ProfitCatalogProduct[]; returns: ReturnRecord[];
  ready: boolean; error?: string; onRefresh: () => Promise<void>;
  resetError?: string; onResetPrevious?: () => Promise<void>;
}

/** Every visit starts with no Facebook cost. Inputs never enter localStorage. */
export const CurrentCsvProfitReport: React.FC<CurrentCsvProfitReportProps> = ({ orders, purchases, products, returns, ready, error, onRefresh, resetError, onResetPrevious }) => {
  const [waybills, setWaybills] = useState<string[]>([]), [waybillFile, setWaybillFile] = useState('');
  const [facebook, setFacebook] = useState<CurrentFacebookCsv | null>(null);
  const [facebookStatus, setFacebookStatus] = useState<'missing' | 'reading' | 'ready' | 'failed'>('missing');
  const [tiktok, setTiktok] = useState(''), [basis, setBasis] = useState<PaymentAmountBasis>('auto');
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [calculated, setCalculated] = useState(false);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const waybillInput = useRef<HTMLInputElement>(null), facebookInput = useRef<HTMLInputElement>(null);
  const fbSequence = useRef(0), waybillSequence = useRef(0);
  const knownCodes = useMemo(() => products.flatMap(product => [product.sku, ...(product.variants || []).map(variant => variant.sku)]), [products]);
  const report = useMemo(() => buildPaidWaybillProfitReport({ orders, purchases, products, returns, waybills, paymentBasis: basis }), [orders, purchases, products, returns, waybills, basis]);
  const allocation = useMemo(() => facebook ? allocateCurrentCsvCosts(facebook, orders, report) : null, [facebook, orders, report]);
  const summary = useMemo(() => currentCsvProfitSummary(report, facebook, tiktok), [report, facebook, tiktok]);
  const filtered = report.rows.filter(row => !search.trim() || [row.waybill, row.orderNumber, ...row.items.map(item => item.sku + ' ' + item.name)].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const money = (value: number | null | undefined) => value === null || value === undefined ? 'Pending' : profitMoney(value);
  const canCalculate = ready && !error && waybills.length > 0 && facebookStatus === 'ready' && Boolean(facebook) && !summary.invalid && !busy;
  const freshReport = () => {
    fbSequence.current++; waybillSequence.current++;
    setWaybills([]); setWaybillFile(''); setFacebook(null); setFacebookStatus('missing'); setTiktok(''); setBasis('auto'); setCalculated(false); setMessage(''); setSearch(''); setPage(1);
  };
  const uploadWaybills = async (file?: File) => {
    if (!file) return;
    const sequence = ++waybillSequence.current;
    fbSequence.current++; setFacebook(null); setFacebookStatus('missing'); setCalculated(false); setWaybills([]); setWaybillFile(''); setTiktok(''); setBasis('auto'); setBusy('waybills'); setMessage('');
    try {
      if (file.size > 2_000_000) throw new Error('Choose a waybill CSV smaller than 2 MB.');
      const selected = parseProfitWaybillUpload(await file.text(), orders.map(order => order.waybill_number || ''));
      if (sequence !== waybillSequence.current) return;
      setWaybills([...new Set(selected)]); setWaybillFile(file.name); setPage(1); setSearch('');
      setMessage(`${new Set(selected).size} waybills selected. Now upload the new Facebook CSV covering all these payment batches.`);
    } catch (e: any) { if (sequence === waybillSequence.current) setMessage(e.message || 'Waybill CSV could not be read.'); }
    finally { if (sequence === waybillSequence.current) setBusy(''); }
  };
  const uploadFacebook = async (file?: File) => {
    if (!file) return;
    const sequence = ++fbSequence.current;
    setFacebook(null); setFacebookStatus('reading'); setCalculated(false); setMessage('');
    try {
      if (file.size > 2_000_000) throw new Error('Choose a Facebook CSV smaller than 2 MB.');
      const selected = currentFacebookCsv(await file.text(), file.name, knownCodes);
      if (sequence !== fbSequence.current) return;
      setFacebook(selected); setFacebookStatus('ready');
      setMessage(`${file.name}: ${profitMoney(selected.totalSpend)} from this CSV only. Press Calculate Profit for all selected waybills.`);
    } catch (e: any) {
      if (sequence !== fbSequence.current) return;
      setFacebookStatus('failed'); setMessage(`${e.message || 'Facebook CSV could not be read.'} Select a valid CSV. Previous Facebook cost is cleared.`);
    }
  };
  const refresh = async () => {
    setBusy('refresh');
    try { await onRefresh(); setMessage('Payments, returns and Purchasing refreshed. The Facebook CSV selected for this report stays the same.'); }
    catch (e: any) { setMessage(e.message || 'System records could not refresh.'); }
    finally { setBusy(''); }
  };
  const download = async () => {
    if (!facebook || !calculated || !canCalculate) return;
    setBusy('pdf');
    try {
      const { createPaidWaybillProfitPdf } = await import('../../lib/paidWaybillProfitPdf');
      const doc = createPaidWaybillProfitPdf(report, { facebook: String(facebook.totalSpend), tiktok, sourceName: `All payment batches | Waybills: ${waybillFile} | Current Facebook CSV: ${facebook.fileName}`,
        paymentBasis: basis, facebookReportingPeriods: facebook.periods, currentFacebookCsv: facebook, currentCsvAllocation: allocation! });
      doc.save(`O-RA_Current_CSV_Profit_${profitSystemDay(new Date().toISOString())}.pdf`);
    } catch (e: any) { setMessage(e.message || 'PDF could not be created.'); }
    finally { setBusy(''); }
  };
  const values: Array<[string, number | null]> = [
    ['Recorded gross revenue', report.totals.received], ['Purchasing Cost', -report.totals.purchasing], ['Fardar Delivery Cost', -report.totals.courier],
    ['Return Fees — once per return', -report.totals.returnFees], ['Packing — Rs.100 per sale, Rs.0 per return', -report.totals.packing],
    ['Profit Before Advertising', report.totals.beforeAds], ['Facebook Cost — FULL current CSV, deducted once', facebook ? -facebook.totalSpend : null],
    ['TikTok Cost — this report only', summary.tiktok === null ? report.ranges.TikTok ? null : 0 : -summary.tiktok],
  ];
  return <div data-ora-view-allowed="true" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-black"><BarChart3 className="h-6 w-6 text-orange-600" />Profit Report — New CSV Flow</h2><p className="mt-2 text-sm text-gray-500">Payment sets සියල්ලේ waybills + අලුත් FB cost CSV එකෙන්ම ලාභය ගණනය කරන්න.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={freshReport} disabled={Boolean(busy)} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Start New Report</button><button type="button" onClick={refresh} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold"><RefreshCw className={`h-4 w-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />Refresh System Records</button></div>
    </div>
    <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">පරණ FB cost කිසිවක් මේ report එකට ගන්නේ නැහැ. හැම අලුත් report එකකටම අලුත් Facebook CSV එක තෝරන්න.</p>
    {(!ready || error) && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{error || 'Loading saved payment, return and Purchasing records...'}</p>}
    {resetError && <div role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><p>{resetError}</p>{onResetPrevious && <button type="button" onClick={() => void onResetPrevious()} className="mt-2 underline">Retry previous-report reset</button>}</div>}
    {message && <p role="status" className="break-words rounded-xl bg-orange-50 p-4 text-sm text-orange-900">{message}</p>}
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="font-black">1. All Payment / Return Waybills</h3><p className="mt-2 text-sm text-gray-500">Payment sets සියල්ල සහ Return Complete waybills ඇතුළත් CSV එක තෝරන්න. එකම waybill එක දෙපාරක් ගණනය වෙන්නේ නැහැ.</p>
      <button type="button" onClick={() => waybillInput.current?.click()} disabled={Boolean(busy)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Upload className="h-4 w-4" />Upload Waybill CSV</button>
      <input ref={waybillInput} aria-label="Current report waybill CSV" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={event => { void uploadWaybills(event.target.files?.[0]); event.target.value = ''; }} />
      {waybillFile && <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm"><p className="break-all font-bold">{waybillFile}</p><p className="mt-2">{waybills.length} unique waybills · {report.rows.filter(row => row.outcome !== 'returned').length} sales · {report.rows.filter(row => row.outcome === 'returned').length} returns · {report.totals.review} need review</p></div>}
    </section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="font-black">2. New Facebook Cost CSV</h3><p className="mt-2 text-sm text-gray-500">මේ payment sets සියල්ලට අදාළ CSV එක තෝරන්න. CSV එකේ මුළු FB spend එක එකවරක් අඩු කරනවා.</p>
      <button type="button" onClick={() => facebookInput.current?.click()} disabled={!waybills.length || Boolean(busy)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Upload className="h-4 w-4" />Upload New Facebook CSV</button>
      <input ref={facebookInput} aria-label="Current report Facebook CSV" type="file" accept=".csv,text/csv" className="hidden" onChange={event => { void uploadFacebook(event.target.files?.[0]); event.target.value = ''; }} />
      {facebookStatus === 'reading' && <p role="status" className="mt-4 text-sm text-orange-800">Reading new CSV. Previous Facebook cost is cleared.</p>}
      {facebook && <div aria-label="Current report Facebook CSV details" className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900"><p className="break-all font-bold">Current file: {facebook.fileName}</p><p className="mt-2">{facebook.periods.map(period => `${period.from} to ${period.to}`).join(' / ')}</p><p className="mt-2 text-lg font-black">Full CSV spend: {profitMoney(facebook.totalSpend)}</p><p className="mt-2">Item ads: {profitMoney(facebook.itemSpend)} · Commercial: {profitMoney(facebook.commercialSpend)} · {facebook.rows.length} ad rows</p><button type="button" aria-label="Clear current Facebook CSV" className="mt-3 inline-flex items-center gap-1 text-xs font-bold underline" onClick={() => { fbSequence.current++; setFacebook(null); setFacebookStatus('missing'); setCalculated(false); }}><X className="h-3 w-3" />Clear current CSV</button></div>}
      <label className="mt-4 block text-sm font-bold">TikTok Cost for this report (Rs.)<input aria-label="Current report TikTok cost" type="number" min="0" step="0.01" value={tiktok} onChange={event => { setTiktok(event.target.value); setCalculated(false); }} placeholder="Enter cost, or 0 if none" className="mt-2 block w-full max-w-sm rounded-lg border px-3 py-2.5 font-normal" /></label>
      <details className="mt-4 text-xs text-gray-500"><summary className="cursor-pointer font-bold">Payment amount settings</summary><label className="mt-3 block">Saved Fardar amount <select aria-label="Current report Fardar amount basis" value={basis} onChange={event => { setBasis(event.target.value as PaymentAmountBasis); setCalculated(false); }} className="rounded-lg border px-3 py-2"><option value="auto">Auto — reconcile saved amounts</option><option value="gross">Gross — before courier deduction</option><option value="net">Net — after courier deduction</option></select></label></details>
    </section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><h3 className="font-black">3. Calculate All Selected Waybills</h3><button type="button" disabled={!canCalculate} onClick={() => { setCalculated(true); setMessage('Calculated all selected waybills using only the full spend from the current Facebook CSV.'); }} className="mt-4 rounded-xl bg-gray-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">Calculate Profit</button>{!facebook && <p className="mt-3 text-sm text-gray-500">Upload the new Facebook CSV to calculate. Previous reports are never used.</p>}</section>
    {calculated && facebook && allocation && <>
      <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-black">Profit for All {report.rows.length} Waybills</h3><button type="button" disabled={!canCalculate} onClick={download} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Download className="h-4 w-4" />Download Summary PDF</button></div><dl className="mt-4 divide-y">{values.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-gray-600">{label}</dt><dd className="whitespace-nowrap font-bold">{money(value)}</dd></div>)}</dl>
        <div className={`mt-4 rounded-xl p-5 ${summary.recordedCostProfit === null ? 'bg-amber-50 text-amber-900' : summary.recordedCostProfit >= 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}><p className="text-sm font-black">{summary.netProfit !== null ? 'Net Profit — All Selected Payment Batches' : summary.tiktokMissing && summary.recordedCostProfit !== null ? 'Profit After FB — TikTok Cost Not Yet Deducted' : 'Profit — Financial Records Need Review'}</p><p className="mt-2 text-3xl font-black">{money(summary.recordedCostProfit)}</p>{summary.tiktokMissing && <p className="mt-3 text-sm">TikTok cost එක තවම දාලා නැහැ. සම්පූර්ණ net profit එකට ඒක දාන්න; නැත්නම් 0 දාන්න.</p>}{report.totals.review > 0 && <p className="mt-3 text-sm">{report.totals.review} waybill(s) need payment / cost review. Check the highlighted rows below.</p>}<p className="mt-3 text-xs">All receipts − Purchasing − delivery − Return Fees − sale packing − FULL current Facebook CSV − this report's TikTok cost.</p></div>
        {allocation.unassignedSpend > 0 && <p className="mt-4 text-xs text-gray-500">{profitMoney(allocation.unassignedSpend)} for campaigns without a matching selected order is included once in the summary. It is not added again to individual rows.</p>}
      </section>
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><h3 className="font-black">All Selected Sales / Returns</h3><input aria-label="Search current CSV profit" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Waybill / Order / Item" className="rounded-lg border px-3 py-2 text-sm" /></div><div className="overflow-x-auto"><table aria-label="Current CSV waybill profit" className="w-full min-w-[1180px] text-xs"><thead className="bg-gray-50 text-left"><tr>{['Waybill / Order', 'Items / Qty', 'Received', 'Purchasing', 'Delivery / Return', 'Packing', 'Before FB', 'Current CSV share', 'After FB'].map(label => <th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{visible.map(row => { const cost = row.orderId ? allocation.orderCosts.get(row.orderId) : undefined; return <tr key={row.waybill || row.orderId} className={row.profit === null ? 'bg-amber-50' : ''}><th scope="row" className="px-3 py-4 text-left"><p className="font-mono font-black">{row.waybill}</p><p className="mt-1 font-normal text-gray-500">{row.orderNumber || 'Not found'}</p><p className="mt-1">{row.outcome === 'returned' ? 'Return Complete' : row.paymentKind === 'cod' ? 'COD Received' : 'Online Paid'}</p>{row.issues.map(issue => <p key={issue} className="mt-2 max-w-xs font-normal text-amber-800">{issue}</p>)}</th><td className="px-3 py-4">{row.items.map((item, index) => <p key={index} className={index ? 'mt-2' : ''}>{item.name}<br />{item.sku} · Qty {item.quantity}</p>)}</td>{[row.received, row.purchasing, row.outcome === 'returned' ? row.returnFee : row.courier, row.packing, row.profit, cost?.total ?? 0, row.profit === null ? null : Math.round((row.profit - (cost?.total || 0)) * 100) / 100].map((value, index) => <td key={index} className="whitespace-nowrap px-3 py-4 font-semibold">{money(value)}</td>)}</tr>; })}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs"><p>{filtered.length} waybills · 10 per page · Summary and PDF include every selected waybill</p><div className="flex items-center gap-3"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">Previous</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">Next</button></div></div></section>
    </>}
  </div>;
};
