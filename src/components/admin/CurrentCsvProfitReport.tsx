import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, RefreshCw, Upload, X } from 'lucide-react';
import { facebookRequiredCostDates } from '../../lib/facebookProfitAds';
import { staffJsonRequest } from '../../lib/staffRequest';
import { autoMapHeader, downloadCsv, parseCsv, parseFlexibleDate } from '../../lib/csv';
import type { Order, PurchaseOrder, ReturnRecord } from '../../types';
import { buildPaidWaybillProfitReport, parseProfitWaybillUpload, profitMoney, profitSystemDay, type PaymentAmountBasis, type ProfitCatalogProduct, aggregateProfitByItemCode, normalizeProfitWaybill } from '../../lib/paidWaybillProfit';
import { allocateCurrentCsvCosts, currentFacebookCsv, currentFacebookInsights, currentCsvProfitSummary, type CurrentFacebookCsv } from '../../lib/currentCsvProfit';

export interface CurrentCsvProfitReportProps {
  orders: Order[]; purchases: PurchaseOrder[]; products: ProfitCatalogProduct[]; returns: ReturnRecord[];
  ready: boolean; error?: string; onRefresh: () => Promise<void>;
  resetError?: string; onResetPrevious?: () => Promise<void>;
}

// Complete TikTok invoice transaction export supplied for this paid-order set.
const TIKTOK_INVOICE_COST = { from: '2026-09-07', to: '2026-09-29', amount: 3451.37, invoices: 3 };

/** Every visit starts with no Facebook cost. Inputs never enter localStorage. */
export const CurrentCsvProfitReport: React.FC<CurrentCsvProfitReportProps> = ({ orders, purchases, products, returns, ready, error, onRefresh, resetError, onResetPrevious }) => {
  const [waybills, setWaybills] = useState<string[]>([]), [waybillFile, setWaybillFile] = useState('');
  const [facebook, setFacebook] = useState<CurrentFacebookCsv | null>(null);
  const [facebookStatus, setFacebookStatus] = useState<'missing' | 'reading' | 'ready' | 'failed'>('missing');
  const [basis, setBasis] = useState<PaymentAmountBasis>('auto');
  const [fromDate, setFromDate] = useState(''), [toDate, setToDate] = useState('');
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [calculated, setCalculated] = useState(false);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const waybillInput = useRef<HTMLInputElement>(null), facebookInput = useRef<HTMLInputElement>(null), mergeCsvInput = useRef<HTMLInputElement>(null);
  const [mergeBusy, setMergeBusy] = useState(false), [mergeMessage, setMergeMessage] = useState('');
  const fbSequence = useRef(0), waybillSequence = useRef(0), metaSequence = useRef(0);
  const [verifiedLeads, setVerifiedLeads] = useState<Record<string, { lead_id: string; created_at: string; ad_id: string; adset_id: string; campaign_id: string; ad_day?: string }>>({});
  useEffect(() => () => { metaSequence.current++; }, []);
  const costOrders = useMemo(() => {
    // Before verification there is no metadata to overlay. Preserve the store
    // array rather than cloning thousands of orders on every tab entry.
    if (!Object.keys(verifiedLeads).length) return orders;
    return orders.map(order => {
    const verified = verifiedLeads[order.id];
    return verified && verified.lead_id && verified.lead_id === order.platform_lead_id ? { ...order, platform_lead_created_at: verified.created_at,
      platform_ad_id: verified.ad_id, platform_adset_id: verified.adset_id, platform_campaign_id: verified.campaign_id,
      platform_ad_account_day: verified.ad_day } : order;
    });
  }, [orders, verifiedLeads]);
  const knownCodes = useMemo(() => products.flatMap(product => [product.sku, ...(product.variants || []).map(variant => variant.sku)]), [products]);
  const scopedWaybills = useMemo(() => {
    if (!fromDate && !toDate) return waybills;
    const daysByWaybill = new Map<string, string[]>();
    orders.forEach(order => {
      const key = normalizeProfitWaybill(order.waybill_number);
      const day = profitSystemDay(order.created_at);
      if (key && day) daysByWaybill.set(key, [...(daysByWaybill.get(key) || []), day]);
    });
    return waybills.filter(waybill => (daysByWaybill.get(normalizeProfitWaybill(waybill)) || [])
      .some(day => (!fromDate || day >= fromDate) && (!toDate || day <= toDate)));
  }, [waybills, orders, fromDate, toDate]);
  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);
  const report = useMemo(() => buildPaidWaybillProfitReport({ orders, purchases, products, returns, waybills: invalidDateRange ? [] : scopedWaybills, paymentBasis: basis }),
    [orders, purchases, products, returns, scopedWaybills, basis, invalidDateRange]);
  const tiktokInvoiceApplies = Boolean(report.ranges.TikTok && report.ranges.TikTok.from <= TIKTOK_INVOICE_COST.to && report.ranges.TikTok.to >= TIKTOK_INVOICE_COST.from);
  const tiktok = tiktokInvoiceApplies ? TIKTOK_INVOICE_COST.amount.toFixed(2) : '0';
  const selectedRangeOverlapsTikTokInvoice = (!toDate || toDate >= TIKTOK_INVOICE_COST.from) && (!fromDate || fromDate <= TIKTOK_INVOICE_COST.to);
  const partialTikTokInvoiceRange = Boolean((fromDate || toDate) && tiktokInvoiceApplies && selectedRangeOverlapsTikTokInvoice
    && (!fromDate || fromDate > TIKTOK_INVOICE_COST.from || !toDate || toDate < TIKTOK_INVOICE_COST.to));
  const requiredDates = useMemo(() => facebookRequiredCostDates(costOrders, report), [costOrders, report]);
  const allocation = useMemo(() => facebook ? allocateCurrentCsvCosts(facebook, costOrders, report) : null, [facebook, costOrders, report]);
  const summary = useMemo(() => currentCsvProfitSummary(report, facebook, tiktok, allocation), [report, facebook, tiktok, allocation]);
  const accountNetProfit = !fromDate && !toDate ? summary.accountNetProfit : null;
  const itemCodeSummary = useMemo(() => aggregateProfitByItemCode(report, allocation?.orderCosts ? new Map<string, number>(Array.from(allocation.orderCosts, ([id, cost]) => [id, cost.total] as [string, number])) : new Map<string, number>(), Number(summary.tiktok || 0)), [report, allocation, summary.tiktok]);
  const estimatedPurchasingRows = report.rows.filter(row => row.estimatedPurchasing).length;
  const referenceSeenPriceRows = report.rows.filter(row => row.referenceShopSeenPrice).length;
  const filtered = report.rows.filter(row => !search.trim() || [row.waybill, row.orderNumber, ...row.items.map(item => item.sku + ' ' + item.name)].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const money = (value: number | null | undefined) => value === null || value === undefined ? 'Pending' : profitMoney(value);
  // Do not publish an exact net-profit number or PDF while historic
  // purchasing cost/Fardar rows still require review.
  const canCalculate = ready && !error && report.rows.length > 0 && facebookStatus === 'ready'
    && Boolean(facebook) && !summary.invalid && !summary.facebookMissing
    && !summary.tiktokMissing && !partialTikTokInvoiceRange && !busy && report.totals.review===0;
  const freshReport = () => {
    fbSequence.current++; waybillSequence.current++; metaSequence.current++; setVerifiedLeads({});
    setWaybills([]); setWaybillFile(''); setFacebook(null); setFacebookStatus('missing'); setBasis('auto'); setFromDate(''); setToDate(''); setCalculated(false); setMessage(''); setSearch(''); setPage(1);
  };
  const mergeAndDownloadCsv = async (files?: FileList | null) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setMergeBusy(true); setMergeMessage('');
    try {
      if (selected.length < 2) throw new Error('Select all four CSV files together to merge them.');
      const parsedFiles = await Promise.all(selected.map(async file => ({ name: file.name, ...parseCsv(await file.text()) })));
      if (parsedFiles.some(file => !file.headers.length)) throw new Error('One of the selected files has no CSV header or rows.');
      const allHeaders = [...new Set(parsedFiles.flatMap(file => file.headers))];
      const waybillColumns = parsedFiles.map(file => autoMapHeader(file.headers, ['Waybill ID', 'Waybill Number', 'Waybill', 'Tracking Number']));
      const missingHeader = parsedFiles.findIndex((file, index) => !waybillColumns[index]);
      if (missingHeader >= 0) throw new Error(`${parsedFiles[missingHeader].name} has no Waybill ID column.`);
      const dateColumns = parsedFiles.map(file => autoMapHeader(file.headers, ['Last Scan Date', 'Last Scan', 'Date Last Scanned', 'Scan Date']));
      const latestByWaybill = new Map<string, { row: Record<string, string>; scannedAt: number; sequence: number }>();
      let missingWaybillRows = 0, duplicateRows = 0, sequence = 0;
      parsedFiles.forEach((file, fileIndex) => file.rows.forEach(row => {
        sequence++;
        const waybill = normalizeProfitWaybill(row[waybillColumns[fileIndex]]);
        if (!waybill) { missingWaybillRows++; return; }
        const dateText = dateColumns[fileIndex] ? parseFlexibleDate(row[dateColumns[fileIndex]]) : '';
        const scannedAt = dateText ? Date.parse(dateText) : Number.NEGATIVE_INFINITY;
        const previous = latestByWaybill.get(waybill);
        if (previous) {
          duplicateRows++;
          const isNewer = scannedAt > previous.scannedAt || (scannedAt === previous.scannedAt && sequence > previous.sequence);
          const combinedRow = { ...previous.row };
          allHeaders.forEach(header => {
            const value = row[header] || '';
            if (value && (isNewer || !combinedRow[header])) combinedRow[header] = value;
          });
          latestByWaybill.set(waybill, { row: combinedRow, scannedAt: isNewer ? scannedAt : previous.scannedAt, sequence: isNewer ? sequence : previous.sequence });
          return;
        }
        latestByWaybill.set(waybill, { row, scannedAt, sequence });
      }));
      if (!latestByWaybill.size) throw new Error('No rows with a Waybill ID were found in the selected files.');
      const outputRows: (string | number)[][] = [allHeaders, ...[...latestByWaybill.values()].map(value => allHeaders.map(header => value.row[header] || ''))];
      const fileDate = new Date().toISOString().slice(0, 10);
      downloadCsv(`ORA_Merged_Waybills_${fileDate}.csv`, outputRows);
      setMergeMessage(`${selected.length} CSV files merged: ${latestByWaybill.size} unique waybills downloaded; ${duplicateRows} duplicate row(s) consolidated${missingWaybillRows ? `; ${missingWaybillRows} row(s) without a Waybill ID skipped` : ''}. The latest Last Scan Date was kept for duplicates.`);
    } catch (error: any) {
      setMergeMessage(error?.message || 'CSV merge failed. Select the source files again and retry.');
    } finally { setMergeBusy(false); }
  };
  const uploadWaybills = async (file?: File) => {
    if (!file) return;
    const sequence = ++waybillSequence.current;
    fbSequence.current++; metaSequence.current++; setVerifiedLeads({}); setFacebook(null); setFacebookStatus('missing'); setCalculated(false); setWaybills([]); setWaybillFile(''); setBasis('auto'); setFromDate(''); setToDate(''); setBusy('waybills'); setMessage('');
    try {
      if (file.size > 2_000_000) throw new Error('Choose a waybill CSV smaller than 2 MB.');
      const selected = parseProfitWaybillUpload(await file.text(), orders.map(order => order.waybill_number || ''));
      if (sequence !== waybillSequence.current) return;
      setWaybills([...new Set(selected)]); setWaybillFile(file.name); setPage(1); setSearch('');
      setMessage(`${new Set(selected).size} waybills selected. Fetch Facebook costs automatically, or use a new Facebook CSV if the Meta Ads connection is not ready.`);
    } catch (e: any) { if (sequence === waybillSequence.current) setMessage(e.message || 'Waybill CSV could not be read.'); }
    finally { if (sequence === waybillSequence.current) setBusy(''); }
  };
  const uploadFacebook = async (file?: File) => {
    if (!file) return;
    const sequence = ++fbSequence.current;
    metaSequence.current++; setVerifiedLeads({}); setBusy(current => current === 'facebook' ? '' : current);
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
  const verifyFacebook = async () => {
    if (!facebook) return;
    const sequence = ++metaSequence.current;
    const selectedIds = new Set(report.rows.map(row => row.orderId));
    const candidates = costOrders.filter(order => order.order_source === 'Facebook Ads' && !order.is_test_order && !order.is_replacement_order
      && /^\d{1,64}$/.test(order.platform_lead_id || '')
      && (selectedIds.has(order.id) || facebook.periods.some(period => { const day = profitSystemDay(order.platform_lead_created_at || order.created_at); return day >= period.from && day <= period.to; })));
    if (!candidates.length) { setMessage('No original numeric Facebook Lead IDs are available to verify. Current CSV estimates remain in use.'); return; }
    setBusy('facebook'); setCalculated(false); let verified = 0, failed = 0; const failures: string[] = [];
    try {
      for (let start = 0; start < candidates.length; start += 5) {
        setMessage(`Checking Facebook Lead / Ad IDs: ${start} of ${candidates.length}...`);
        const batch = candidates.slice(start, start + 5);
        const data = await staffJsonRequest('/api/admin/profit-facebook-leads', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('ora_staff_session_token') || ''}`, 'content-type': 'application/json' }, body: JSON.stringify({ order_ids: batch.map(order => order.id) }) });
        if (sequence !== metaSequence.current) return;
        if (!Array.isArray(data.results) || data.results.length !== batch.length || batch.some(order => data.results.filter((result: any) => result.order_id === order.id && result.lead_id === order.platform_lead_id).length !== 1)) throw new Error('Facebook verification response was incomplete. Retry the check.');
        const received: typeof verifiedLeads = {};
        for (const result of data.results) {
          if (result.error) { failed++; failures.push(`${batch.find(order => order.id === result.order_id)?.order_number}: ${result.error}`); }
          else if ([result.ad_id, result.adset_id, result.campaign_id].every(id => typeof id === 'string' && /^\d{1,64}$/.test(id)) && Number.isFinite(Date.parse(result.created_at))) { received[result.order_id] = result; verified++; }
          else throw new Error('Facebook returned invalid ad IDs. Retry the check.');
        }
        setVerifiedLeads(current => ({ ...current, ...received }));
      }
      setMessage(`Facebook verified ${verified} lead / ad identities. ${failed} could not be verified. ${failures.slice(0, 3).join(' ')} Spend still comes only from the current CSV. Press Calculate Profit.`);
    } catch (failure: any) { if (sequence === metaSequence.current) setMessage(`Verified ${verified} identities. ${failure.message || 'Facebook check failed.'} Spend still comes only from the current CSV; unverified orders use the available code estimate.`); }
    finally { if (sequence === metaSequence.current) setBusy(''); }
  };
  const fetchFacebookFromMeta = async () => {
    const selectedIds = [...new Set(report.rows.filter(row => row.source === 'Facebook' && row.eligible && row.orderId).map(row => row.orderId!))];
    const selectedOrders = costOrders.filter(order => selectedIds.includes(order.id));
    const missingLeadOrders = selectedOrders.filter(order => !/^\d{1,64}$/.test((order.platform_lead_id || '').trim()));
    const selected = selectedOrders.map(order => order.id);
    if (!selected.length) {
      setMessage('මේ payment batches වල paid Facebook orders නැහැ; Facebook ad cost fetch කරන්න order එකක් නැහැ.');
      return;
    }
    const sequence = ++metaSequence.current;
    fbSequence.current++; setVerifiedLeads({}); setFacebook(null); setFacebookStatus('reading'); setCalculated(false); setBusy('facebook-api'); setMessage('Meta Ads account එකෙන් daily spend ගෙන paid Facebook orders වලට බෙදනවා…');
    try {
      const data = await staffJsonRequest('/api/admin/profit-facebook-ad-insights', { method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('ora_staff_session_token') || ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ order_ids: selected, known_codes: knownCodes }) });
      if (sequence !== metaSequence.current) return;
      if (!Array.isArray(data.verified) || data.verified.length !== selected.length
        || selected.some(id => data.verified.filter((row: any) => row.order_id === id).length !== 1))
        throw new Error('Meta lead verification was incomplete. No profit was calculated.');
      const matched: typeof verifiedLeads = {};
      for (const row of data.verified) {
        if (typeof row.lead_id !== 'string' || typeof row.ad_id !== 'string' || (row.ad_id && !/^\d{1,64}$/.test(row.ad_id))
          || ![row.adset_id, row.campaign_id].every((id: any) => typeof id === 'string' && (!id || /^\d{1,64}$/.test(id)))
          || typeof row.ad_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.ad_day) || !Number.isFinite(Date.parse(row.created_at)))
          throw new Error('Meta returned an invalid Lead / Ad identity. No profit was calculated.');
        matched[row.order_id] = row;
      }
      const selectedFacebook = currentFacebookInsights(data);
      setVerifiedLeads(matched); setFacebook(selectedFacebook); setFacebookStatus('ready');
      const missingText = missingLeadOrders.length
        ? ` Lead ID නැති ${missingLeadOrders.length} ඇණවුම් product code සහ ad-account date අනුව වියදමට ගැළපුවා.`
        : '';
      setMessage(`Meta Ads API එකෙන් ${profitMoney(selectedFacebook.totalSpend)} account spend ගත්තා. Saved Ad ID තිබෙන ඒවා Ad ID අනුවත්, නැති ඒවා product code සහ ad-account date අනුවත් බෙදුවා.${missingText}`);
    } catch (e: any) {
      if (sequence === metaSequence.current) { setFacebookStatus('failed'); setMessage(e.message || 'Meta Ads cost fetch අසාර්ථකයි. Meta ads_read permission සහ Ad Account ID පරීක්ෂා කරන්න.'); }
    } finally { if (sequence === metaSequence.current) setBusy(''); }
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
      const doc = createPaidWaybillProfitPdf(report, { facebook: String(facebook.totalSpend), tiktok, sourceName: `Date range: ${fromDate || 'All dates'} to ${toDate || 'All dates'} | Waybills: ${waybillFile} | Facebook source: ${facebook.fileName} | TikTok invoice dates: ${TIKTOK_INVOICE_COST.from} to ${TIKTOK_INVOICE_COST.to}`,
        paymentBasis: basis, facebookReportingPeriods: facebook.periods, currentFacebookCsv: facebook, currentCsvAllocation: allocation!, itemCodeBreakdown: itemCodeSummary, includeAccountNet: accountNetProfit !== null });
      doc.save(`O-RA_Current_CSV_Profit_${profitSystemDay(new Date().toISOString())}.pdf`);
    } catch (e: any) { setMessage(e.message || 'PDF could not be created.'); }
    finally { setBusy(''); }
  };
  const values: Array<[string, number | null]> = [
    ['Recorded gross revenue', report.totals.received], ['Purchasing Cost', -report.totals.purchasing], ['Fardar Delivery Cost', -report.totals.courier],
    ['Return Fees — once per return', -report.totals.returnFees], ['Packing — Rs.100 per delivered order; waived for returned-stock repacks', -report.totals.packing],
    ['Profit Before Advertising', report.totals.beforeAds], ['Facebook Cost — selected paid / returned leads only', summary.facebook === null ? null : -summary.facebook],
    ['TikTok Cost — this report only', summary.tiktok === null ? report.ranges.TikTok ? null : 0 : -summary.tiktok],
  ];
  return <div data-ora-view-allowed="true" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-black"><BarChart3 className="h-6 w-6 text-orange-600" />Profit Report — Meta Cost Flow</h2><p className="mt-2 text-sm text-gray-500">Payment sets සියල්ලේ waybills සහ Facebook Ads account එකෙන් ගත් current cost එක භාවිතා කර ලාභය ගණනය කරන්න.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={freshReport} disabled={Boolean(busy)} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Start New Report</button><button type="button" onClick={refresh} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold"><RefreshCw className={`h-4 w-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />Refresh System Records</button></div>
    </div>
    <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">Facebook Ads account එකෙන් වියදම auto fetch කරලා, saved Ad ID තිබේ නම් ඒ අනුවත් නැත්නම් product code සහ ad-account date අනුවත් allocate කරනවා. පරණ report cost මෙයට එකතු වෙන්නේ නැහැ.</p>
    {(!ready || error) && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{error || 'Loading saved payment, return and Purchasing records...'}</p>}
    {resetError && <div role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><p>{resetError}</p>{onResetPrevious && <button type="button" onClick={() => void onResetPrevious()} className="mt-2 underline">Retry previous-report reset</button>}</div>}
    {message && <p role="status" className="break-words rounded-xl bg-orange-50 p-4 text-sm text-orange-900">{message}</p>}
    {referenceSeenPriceRows>0 && waybills.length>0 && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
      {referenceSeenPriceRows} invoice(s) use the saved Reference Shop / Seen Price as the unit buying price for uncovered quantities. Saved FIFO Purchasing costs remain in place for covered quantities.
    </p>}
    {estimatedPurchasingRows>0 && waybills.length>0 && <p role="status" className="rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950">
      {estimatedPurchasingRows} invoice(s) use the latest saved unit price only when no FIFO receipt or Reference Shop / Seen Price is available. These portions are estimates.
    </p>}
    {report.totals.review>0 && waybills.length>0 && <p role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
      {report.totals.review} invoice(s) still need Purchasing, Fardar delivery/return fee or payment evidence that is unavailable. Latest saved item/variant prices are applied only to uncovered Purchasing quantities; unresolved payment and courier evidence still needs correction.
    </p>}
    {report.totals.review>0 && waybills.length>0 && <section aria-label="Waybills needing financial review" className="rounded-2xl border border-amber-300 bg-white p-5 shadow-sm">
      <h3 className="font-black">Waybills needing review ({report.totals.review})</h3>
      <p className="mt-1 text-sm text-gray-600">Each row shows the missing payment, Fardar or Purchasing detail. Update that record, then use Refresh System Records.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead className="bg-amber-50 text-left"><tr><th className="px-3 py-2">Waybill / Order</th><th className="px-3 py-2">Item / Variant</th><th className="px-3 py-2">Missing detail</th></tr></thead>
        <tbody className="divide-y">{report.rows.filter(row => row.profit === null).map(row => <tr key={row.waybill || row.orderId} className="align-top">
          <td className="px-3 py-3 font-mono">{row.waybill || 'No waybill'}<br /><span className="font-sans text-gray-500">{row.orderNumber || 'Order not found'}</span></td>
          <td className="px-3 py-3">{row.items.map(item => <p key={item.sku + item.name}>{item.name} · {item.sku} · Qty {item.quantity}</p>)}</td>
          <td className="px-3 py-3 text-amber-900">{row.issues.length ? row.issues.join(' ') : 'Recorded payment or delivery evidence is incomplete.'}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="font-black">1. All Payment / Return Waybills</h3><p className="mt-2 text-sm text-gray-500">Payment sets සියල්ල සහ Return Complete waybills ඇතුළත් CSV එක තෝරන්න. එකම waybill එක දෙපාරක් ගණනය වෙන්නේ නැහැ.</p>
      <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
        <p className="text-sm font-bold text-orange-950">Merge CSV files and download one file</p>
        <p className="mt-1 text-xs text-orange-900">Select the four Fardar delivery/return CSV files together. Duplicate waybills are kept once, using the row with the latest Last Scan Date.</p>
        <input ref={mergeCsvInput} aria-label="Select Fardar CSV files to merge" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" multiple className="hidden"
          onChange={event => { void mergeAndDownloadCsv(event.target.files); event.target.value = ''; }} />
        <button type="button" onClick={() => mergeCsvInput.current?.click()} disabled={mergeBusy || Boolean(busy)}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
          <Download className="h-4 w-4" />{mergeBusy ? 'Merging CSV files…' : 'Select CSVs and Download Merged CSV'}
        </button>
        {mergeMessage && <p role="status" className="mt-2 text-xs font-semibold text-orange-950">{mergeMessage}</p>}
      </div>
      <button type="button" onClick={() => waybillInput.current?.click()} disabled={Boolean(busy)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Upload className="h-4 w-4" />Upload Waybill CSV</button>
      <input ref={waybillInput} aria-label="Current report waybill CSV" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={event => { void uploadWaybills(event.target.files?.[0]); event.target.value = ''; }} />
      {waybillFile && <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm"><p className="break-all font-bold">{waybillFile}</p><p className="mt-2">{waybills.length} uploaded waybills · {report.rows.filter(row => row.outcome === 'sale').length} delivered · {report.rows.filter(row => row.outcome === 'returned').length} returned · {report.rows.filter(row => row.outcome === 'cancelled').length} cancelled · {report.excludedNonFinal} Fardar processing skipped · {report.totals.review} need review</p></div>}
    </section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="font-black">2. Facebook Ad Cost — automatic</h3><p className="mt-2 text-sm text-gray-500">Meta Ads account එකෙන් ad spend ගෙන, saved Ad ID තිබේ නම් ඒ අනුවත් නැත්නම් product code සහ ad-account date අනුවත් බෙදනවා. Paid / Return orders වල cost share විතරක් අඩු කරනවා; Pending lead cost වෙනම තබනවා.</p>
      {requiredDates.range && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Selected Facebook lead dates: <strong>{requiredDates.range.from} to {requiredDates.range.to}</strong>. Meta spend එක ad ID සහ ad-account date අනුව ගන්නවා; lead එකට අදාළ පෙර දින 7ක ad spend pool එකත් සලකනවා.</p>}
      <button type="button" onClick={() => void fetchFacebookFromMeta()} disabled={!waybills.length || Boolean(busy)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy === 'facebook-api' ? 'animate-spin' : ''}`} />{busy === 'facebook-api' ? 'Fetching from Facebook…' : 'Fetch Facebook Costs Automatically'}</button>
      <div className="mt-3"><button type="button" onClick={() => facebookInput.current?.click()} disabled={!waybills.length || Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold disabled:opacity-40"><Upload className="h-4 w-4" />CSV fallback</button><span className="ml-2 text-xs text-gray-500">Meta Ads API access නැත්නම් පමණක් CSV භාවිතා කරන්න.</span></div>
      <input ref={facebookInput} aria-label="Current report Facebook CSV" type="file" accept=".csv,text/csv" className="hidden" onChange={event => { void uploadFacebook(event.target.files?.[0]); event.target.value = ''; }} />
      {facebookStatus === 'reading' && <p role="status" className="mt-4 text-sm text-orange-800">Reading Facebook cost data. Previous report cost is cleared.</p>}
      {facebook && <div aria-label="Current report Facebook cost details" className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900"><p className="break-all font-bold">Source: {facebook.fileName}</p><p className="mt-2">{facebook.periods.map(period => `${period.from} to ${period.to}`).join(' / ')}</p><p className="mt-2 text-lg font-black">Facebook account spend: {profitMoney(facebook.totalSpend)}</p><p className="mt-2">Item ads: {profitMoney(facebook.itemSpend)} · Commercial: {profitMoney(facebook.commercialSpend)} · {facebook.rows.length} ad rows</p><button type="button" aria-label="Clear current Facebook costs" className="mt-3 inline-flex items-center gap-1 text-xs font-bold underline" disabled={Boolean(busy)} onClick={() => { fbSequence.current++; metaSequence.current++; setVerifiedLeads({}); setFacebook(null); setFacebookStatus('missing'); setCalculated(false); }}><X className="h-3 w-3" />Clear current Facebook costs</button></div>}
      {facebook && !facebook.fileName.startsWith('Facebook API · ') && <div className="mt-4 rounded-xl border bg-blue-50 p-4 text-sm"><button type="button" disabled={Boolean(busy) || !ready} onClick={() => void verifyFacebook()} className="rounded-lg bg-blue-700 px-4 py-2.5 font-bold text-white disabled:opacity-40">{busy === 'facebook' ? 'Checking Facebook IDs...' : 'Verify Facebook Lead / Ad IDs'}</button><p className="mt-2 text-xs text-blue-900">CSV path එකේදී existing Facebook Page connection එකෙන් Lead ID → Ad ID verify කරනවා. Meta permissions නැත්නම් message එක පෙන්වනවා.</p></div>}
      {report.ranges.TikTok && <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">TikTok ad cost from the provided invoice transactions: {TIKTOK_INVOICE_COST.invoices} invoices, {TIKTOK_INVOICE_COST.from} to {TIKTOK_INVOICE_COST.to}, total Rs. {TIKTOK_INVOICE_COST.amount.toFixed(2)}. This total is deducted once for the selected TikTok orders.</p>}
      <details className="mt-4 text-xs text-gray-500"><summary className="cursor-pointer font-bold">Payment amount settings</summary><label className="mt-3 block">Saved Fardar amount <select aria-label="Current report Fardar amount basis" value={basis} onChange={event => { setBasis(event.target.value as PaymentAmountBasis); setCalculated(false); }} className="rounded-lg border px-3 py-2"><option value="auto">Auto — reconcile saved amounts</option><option value="gross">Gross — before courier deduction</option><option value="net">Net — after courier deduction</option></select></label></details>
    </section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><h3 className="font-black">3. Calculate Profit by Date Range</h3><div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-xs font-bold text-gray-700">From date<input aria-label="Profit report start date" type="date" value={fromDate} onChange={event => { setFromDate(event.target.value); setCalculated(false); setPage(1); }} className="mt-1 block rounded-lg border px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-bold text-gray-700">To date<input aria-label="Profit report end date" type="date" value={toDate} onChange={event => { setToDate(event.target.value); setCalculated(false); setPage(1); }} className="mt-1 block rounded-lg border px-3 py-2 text-sm font-normal" /></label><button type="button" onClick={() => { setFromDate(''); setToDate(''); setCalculated(false); setPage(1); }} disabled={!fromDate && !toDate} className="rounded-lg border px-4 py-2.5 text-xs font-bold disabled:opacity-40">All dates</button><button type="button" disabled={!canCalculate} onClick={() => { setCalculated(true); setMessage(`Profit calculated for final Fardar orders (${fromDate || 'all dates'} to ${toDate || 'all dates'}). Processing orders are excluded from profit and selected Facebook cost.`); }} className="rounded-xl bg-gray-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">Calculate Profit</button></div>{invalidDateRange && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">Start date must be on or before the end date.</p>}{partialTikTokInvoiceRange && <p role="alert" className="mt-3 text-sm font-semibold text-amber-800">This range includes only part of the TikTok invoice period ({TIKTOK_INVOICE_COST.from}–{TIKTOK_INVOICE_COST.to}). Select the full invoice period to include its total cost accurately.</p>}{waybills.length > 0 && !invalidDateRange && <p className="mt-3 text-sm text-gray-500">{report.rows.length} final order(s) in this date range. {report.excludedNonFinal} Fardar processing / non-final order(s) excluded from profit and Facebook cost. The date uses the order’s system created date.</p>}{!facebook && <p className="mt-3 text-sm text-gray-500">Fetch current Facebook Ads costs automatically or choose the CSV fallback to calculate.</p>}</section>
    {facebook && allocation && summary.facebookMissing && <p role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
      {allocation.missingOrderIds.length > 0 && <span>{allocation.missingOrderIds.length} Facebook ඇණවුම්වල වියදම තවම තහවුරු වී නැහැ. </span>}
      {allocation.issues.length > 0 && <span>{allocation.issues[0]} </span>}
      මේවා නිවැරදි කරන තුරු අවසන් ලාභය ගණනය කිරීම සහ PDF අපනයනය අවහිරයි.
    </p>}
    {calculated && facebook && allocation && canCalculate && <>
      <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-black">Profit for {report.rows.length} Final Orders</h3><button type="button" disabled={!canCalculate} onClick={download} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Download className="h-4 w-4" />Download Summary PDF</button></div><dl className="mt-4 divide-y">{values.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-gray-600">{label}</dt><dd className="whitespace-nowrap font-bold">{money(value)}</dd></div>)}</dl>
        <div className={`mt-4 rounded-xl p-5 ${summary.recordedCostProfit === null ? 'bg-amber-50 text-amber-900' : summary.recordedCostProfit >= 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}><p className="text-sm font-black">{summary.netProfit !== null ? 'Allocated Net Profit — Final Fardar Orders' : summary.facebookMissing ? 'Provisional Profit — Facebook Matches Need Review' : summary.tiktokMissing && summary.recordedCostProfit !== null ? 'Profit After FB — TikTok Cost Not Yet Deducted' : 'Profit — Financial Records Need Review'}</p><p className="mt-2 text-3xl font-black">{money(summary.recordedCostProfit)}</p>{summary.tiktokMissing && <p className="mt-3 text-sm">TikTok cost එක තවම දාලා නැහැ. සම්පූර්ණ net profit එකට ඒක දාන්න; නැත්නම් 0 දාන්න.</p>}{report.totals.review > 0 && <p className="mt-3 text-sm">{report.totals.review} waybill(s) need payment / cost review. Check the highlighted rows below.</p>}<p className="mt-3 text-xs">Delivered sales and returns − Purchasing − actual delivery fee − one Return Fee per return − Rs.100 packing for delivered orders (waived if returned-stock packaging is reused) − Facebook cost for final delivered / returned / cancelled leads − this report's TikTok cost. Fardar processing orders are excluded.</p></div>
        {accountNetProfit !== null && <div className={`mt-4 rounded-xl border p-5 ${accountNetProfit >= 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-red-300 bg-red-50 text-red-950'}`}><p className="text-sm font-black">සම්පූර්ණ Facebook වියදමත් අඩු කළ පසු — account-level ගණනය</p><p className="mt-2 text-2xl font-black">{money(accountNetProfit)}</p><p className="mt-2 text-xs">මේක මුළු Facebook account spend එකත් TikTok වියදමත් අඩු කරලා ගත් අගයයි. Facebook spend එක ORA Store එකේ මේ report එකටම අදාළ නම් පමණක් මුළු business profit එක ලෙස ගන්න. Item-by-item ලාභය සඳහා ඉහළ තියෙන matched order cost share භාවිතා වෙනවා.</p></div>}
        <div aria-label="Facebook cost reconciliation" className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-900"><p className="font-bold">{facebook.fileName.startsWith('Facebook API · ') ? 'Meta live ad/day spend · allocated cost per lead' : 'Current CSV ad/day spend · allocated cost per lead'}</p><p className="mt-2">Deducted for final delivered / returned / cancelled Facebook orders: {profitMoney(allocation.assignedSpend)}</p><p className="mt-2">Pending leads — NOT deducted: {profitMoney(allocation.pendingSpend)}</p><p className="mt-2">Other orders outside this waybill list — NOT deducted: {profitMoney(allocation.otherSpend)}</p><p className="mt-2">Unmatched / zero-lead spend — NOT deducted: {profitMoney(allocation.unmatchedSpend)}</p><p className="mt-2">Total Facebook account spend: {profitMoney(allocation.totalSpend)}</p><p className="mt-2 text-xs">Lead ID identifies its ad. Meta provides ad/day spend, so each order receives its share of that ad’s cost per lead; it does not provide a separate spend amount per order ID.</p></div>
        {allocation.issues.length > 0 && <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">{allocation.missingOrderIds.length} Facebook orders need a matching current Ad ID / cost period. The amount above is provisional; unresolved costs are not deducted.</p>{allocation.issues.map(issue => <p key={issue} className="mt-2">{issue}</p>)}</div>}
        {allocation.warnings.length > 0 && <details className="mt-4 text-xs text-gray-500"><summary>Lead count / attribution notes</summary>{allocation.warnings.map(warning => <p key={warning} className="mt-2">{warning}</p>)}</details>}
      </section>
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="p-4"><h3 className="font-black">Profit by Item Code</h3><p className="mt-1 text-xs text-gray-500">Order receipts, delivery, packing and ad costs are shared across the order’s item codes by saved item sales value. TikTok invoice cost is divided evenly across included TikTok orders, then by item value.</p></div><div className="overflow-x-auto"><table aria-label="Profit by item code" className="w-full min-w-[1050px] text-xs"><thead className="bg-gray-50 text-left"><tr>{['Item code','Qty','Received','Purchasing','Delivery','Return fee','Packing','Ads','Profit'].map(label => <th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{itemCodeSummary.map(item => <tr key={item.sku}><th className="px-3 py-3 text-left font-mono">{item.sku}</th>{[item.quantity,item.received,item.purchasing,item.delivery,item.returnFee,item.packing,item.advertising,item.profit].map((value,index)=><td key={index} className="whitespace-nowrap px-3 py-3 font-semibold">{index===0 ? value : money(value)}</td>)}</tr>)}</tbody></table></div></section>
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><h3 className="font-black">All Selected Sales / Returns</h3><input aria-label="Search current Facebook profit" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Waybill / Order / Item" className="rounded-lg border px-3 py-2 text-sm" /></div><div className="overflow-x-auto"><table aria-label="Current Facebook waybill profit" className="w-full min-w-[1180px] text-xs"><thead className="bg-gray-50 text-left"><tr>{['Waybill / Order', 'Items / Qty', 'Received', 'Purchasing', 'Delivery / Return', 'Packing', 'Before FB', 'Facebook cost share', 'After FB'].map(label => <th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{visible.map(row => { const cost = row.orderId ? allocation.orderCosts.get(row.orderId) : undefined; const missingFb = row.source === 'Facebook' && !cost; return <tr key={row.waybill || row.orderId} className={row.profit === null || missingFb ? 'bg-amber-50' : ''}><th scope="row" className="px-3 py-4 text-left"><p className="font-mono font-black">{row.waybill}</p><p className="mt-1 font-normal text-gray-500">{row.orderNumber || 'Not found'}</p><p className="mt-1">{row.outcome === 'returned' ? 'Return Complete' : row.outcome === 'cancelled' ? 'Cancelled' : row.paymentKind === 'cod' ? 'COD Received' : 'Online Paid'}</p>{missingFb && <p className="mt-2 font-normal text-amber-800">Facebook cost needs a verified Lead ID / Ad ID match</p>}{cost && <p className="mt-2 font-normal text-gray-500">{cost.match}{cost.leadId ? ` · Lead ${cost.leadId}` : ''}</p>}{row.referenceShopSeenPrice && <p className="mt-2 max-w-xs font-normal text-emerald-800">Reference Shop / Seen Price used as buying price for uncovered quantity</p>}{row.reusedReturnPackaging && <p className="mt-2 max-w-xs font-normal text-emerald-800">Good returned stock reused; Rs.100 packing charge waived</p>}{row.estimatedPurchasing && <p className="mt-2 max-w-xs font-normal text-sky-800">Latest saved item/variant unit price used only when FIFO and Seen Price are unavailable</p>}{row.issues.map(issue => <p key={issue} className="mt-2 max-w-xs font-normal text-amber-800">{issue}</p>)}</th><td className="px-3 py-4">{row.items.map((item, index) => <p key={index} className={index ? 'mt-2' : ''}>{item.name}<br />{item.sku} · Qty {item.quantity}</p>)}</td>{[row.received, row.purchasing, row.outcome === 'returned' ? row.returnFee : row.courier, row.packing, row.profit, missingFb ? null : cost?.total ?? 0, row.profit === null || missingFb ? null : Math.round((row.profit - (cost?.total || 0)) * 100) / 100].map((value, index) => <td key={index} className="whitespace-nowrap px-3 py-4 font-semibold">{money(value)}</td>)}</tr>; })}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs"><p>{filtered.length} waybills · 10 per page · Summary and PDF include every selected waybill</p><div className="flex items-center gap-3"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">Previous</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">Next</button></div></div></section>
    </>}
  </div>;
};
