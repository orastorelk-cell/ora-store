import React, { useRef, useState } from 'react';
import { Upload, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { profitMoney } from '../../lib/paidWaybillProfit';
import { latestFacebookAdLedger, mergeFacebookAdLedger, parseFacebookAdCostCsv, type FacebookAdAllocation, type FacebookAdCost, type FacebookAdLedger } from '../../lib/facebookProfitAds';

export interface FacebookProfitAdsPanelProps {
  ledger: FacebookAdLedger; allocation: FacebookAdAllocation; ready: boolean; error?: string; canImport: boolean; knownCodes: string[];
  onImport: (csv: string, fileName: string) => Promise<FacebookAdLedger>;
  onReload: () => Promise<void>;
  onImportStateChange?: (state: 'ready' | 'saving' | 'failed') => void;
}

export function FacebookProfitAdsPanel({ ledger: storedLedger, allocation, ready, error, canImport, knownCodes, onImport, onReload, onImportStateChange }: FacebookProfitAdsPanelProps) {
  const ledger = latestFacebookAdLedger(storedLedger);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ csv: string; fileName: string; rows: FacebookAdCost[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (read: () => Promise<NonNullable<typeof pending>>) => {
    if (inFlight.current || !canImport || !ready || error) return;
    inFlight.current = true;
    setBusy(true); setUploadFailed(false); setMessage('Saving the new Facebook CSV and replacing the previous report...');
    onImportStateChange?.('saving');
    try {
      const selected = await read();
      setPending(selected);
      const saved = await onImport(selected.csv, selected.fileName);
      setMessage(saved.version === ledger.version ? 'This CSV is already the current report. No cost was added twice.' : 'Current Facebook CSV saved. The entire previous FB report was replaced and profit recalculated.');
      setPending(null);
      onImportStateChange?.('ready');
    } catch (e: any) {
      setUploadFailed(true);
      setMessage(`${e.message || 'The new CSV could not be saved.'} New cost is not confirmed; retry the upload. Profit and PDF are paused to avoid using the previous report.`);
      onImportStateChange?.('failed');
    } finally { inFlight.current = false; setBusy(false); }
  };
  const choose = async (file?: File) => {
    if (!file) return;
    await save(async () => {
      setPending(null);
      if (file.size > 2_000_000) throw new Error('Choose a CSV report smaller than 2 MB.');
      const csv = await file.text(), rows = parseFacebookAdCostCsv(csv, knownCodes);
      mergeFacebookAdLedger(ledger, rows, { expectedVersion: ledger.version, fileName: file.name, importedAt: new Date().toISOString(), importedBy: 'Upload', replaceExisting: true });
      return { csv, fileName: file.name, rows };
    });
  };
  const reload = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await onReload(); setUploadFailed(false); setPending(null); onImportStateChange?.('ready'); setMessage('Current saved Facebook CSV refreshed.'); }
    catch (e: any) { setMessage(e.message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const periods = pending ? [...new Set(pending.rows.map(row => `${row.from} to ${row.to}`))] : [];
  const promotionCount = pending?.rows.filter(row => !row.code).length || 0;
  return <div className="mt-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-black">Facebook Cost CSV</p><p className="mt-1 text-sm text-gray-500">CSV එක තෝරන සැණින් save වෙලා පරණ FB report එක සම්පූර්ණයෙන් replace වෙනවා.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={reload} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh Ad Costs</button>
        {canImport && <button type="button" disabled={!ready || busy || Boolean(error)} onClick={() => input.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><Upload className="h-4 w-4" />Upload Facebook Cost CSV</button>}
        <input ref={input} aria-label="Facebook cost CSV file" className="hidden" type="file" accept=".csv,text/csv" onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
    </div>
    {(!ready || error) && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error || 'Loading saved advertising costs...'}</p>}
    {message && <p role="status" className="rounded-xl bg-orange-50 p-3 text-sm text-orange-800">{message}</p>}
    {pending && <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
      <p className="break-all text-sm font-bold">{pending.fileName}</p>
      <p className="mt-2 text-sm">{pending.rows.length} ad rows · Item ads: {profitMoney(pending.rows.filter(row => row.code).reduce((sum, row) => sum + row.spend, 0))} · Commercial: {profitMoney(pending.rows.filter(row => !row.code).reduce((sum, row) => sum + row.spend, 0))}</p>
      <p className="mt-2 text-sm text-orange-900">{periods.length > 3 ? `${periods[0]} through ${periods.at(-1)} (${periods.length} reporting periods)` : periods.join(' / ')}</p>
      <p className="mt-2 text-sm text-orange-900">Codes: {[...new Set(pending.rows.map(row => row.code || 'Commercial'))].join(', ')}</p>
      {promotionCount > 0 && <p className="mt-2 text-sm text-orange-900">Commercial total includes {promotionCount} code-free promotion / boosted-post ads. Full spend is saved; the selected paid orders' share is deducted using this period's form-lead count. Messages and views are not counted as item leads.</p>}
      <p className="mt-2 text-sm text-orange-900">This CSV replaces the entire previous Facebook report, including its dates and item codes.</p>
      {busy ? <p className="mt-3 text-sm font-bold">Saving...</p> : uploadFailed && <button type="button" disabled={!ready || Boolean(error)} onClick={() => void save(async () => pending)} className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Retry CSV upload</button>}
    </div>}
    {ready && !error && !busy && !uploadFailed && <>
      {!ledger.rows.length && <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">Upload the current Facebook cost CSV. Each new upload replaces the previous FB report.</p>}
      {ledger.rows.length > 0 && <>
        <div aria-label="Current saved Facebook CSV" className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900"><p className="break-all font-bold">Current file: {ledger.rows[0].fileName}</p><p className="mt-2">{[...new Set(ledger.rows.map(row => `${row.from} to ${row.to}`))].join(' / ')}</p><p className="mt-2 font-bold">Full CSV spend: {profitMoney(ledger.rows.reduce((sum, row) => sum + row.spend, 0))} · {ledger.rows.length} ad rows</p></div>
        {allocation.waybillScoped && <div aria-label="Selected Facebook CSV costs" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><p className="font-bold">Selected Facebook CSV spend: {profitMoney(allocation.totalSpend)}</p><p className="mt-2">තෝරාගත් CSV date range එකේ FB cost විතරයි මේ report එකට ගන්නේ.</p>{allocation.outsidePeriodOrderIds.size > 0 && <p className="mt-2">{allocation.outsidePeriodOrderIds.size} waybill(s) have lead dates outside this range: their revenue and parcel costs are included, with Rs.0 FB cost from this CSV.</p>}</div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
          ['Paid orders: allocated Facebook cost', allocation.paidCost], ['Returned waybills: own Facebook cost', allocation.returnedCost], ['FB loss deducted from profit', allocation.lostCost],
          ['Pending lead cost', allocation.pendingCost], ['Commercial / promotion share included', allocation.commercialCost],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-gray-50 p-3"><p className="text-sm text-gray-500">{label}</p><p className="mt-1 text-lg font-black">{profitMoney(Number(value))}</p></div>)}</div>
        {allocation.lossCohorts.length > 0 && <section className="rounded-xl border border-red-200 bg-red-50 p-4" aria-label="Facebook loss cost deduction">
          <p className="text-sm font-bold text-red-900">FB Lost Cost — profit එකෙන් අඩු කළ කොටස</p>
          <p className="mt-2 text-sm text-red-900">Cancelled / returned සහ zero-lead ads වල loss එක, ඒ CSV period එකේ ඉතිරි form leads අතර බෙදනවා. Upload කළ paid orders වල කොටස profit එකෙන් අඩු කරනවා. Selected return එකේම FB cost එක වෙනම අඩු කර ඇති නිසා එය මේ loss pool එකට නැවත දාන්නේ නැහැ.</p>
          <p className="mt-2 text-sm text-red-900">Known loss: {profitMoney(allocation.lossSpend)} · Deducted: {profitMoney(allocation.lostCost)} · Other / pending share: {profitMoney(allocation.lossRemainingCost)}</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-sm" aria-label="Facebook loss allocation details"><thead className="text-left"><tr>{['CSV dates', 'Known loss', 'Remaining allocation leads', 'Selected paid', 'Loss deducted', 'Other / pending share'].map(label => <th key={label} scope="col" className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{allocation.lossCohorts.map(row => <tr key={`${row.from}|${row.to}`} className="border-t border-red-200"><th scope="row" className="px-2 py-2 text-left font-normal">{row.from}<br />{row.to}</th><td className="px-2 py-2">{profitMoney(row.spend)}</td><td className="px-2 py-2">{row.leads}</td><td className="px-2 py-2">{row.selectedPaid}</td><td className="px-2 py-2 font-bold">{profitMoney(-row.selectedCost)}</td><td className="px-2 py-2">{profitMoney(row.remainingCost)}</td></tr>)}</tbody></table></div>
        </section>}
        {allocation.commercialCohorts.length > 0 && <section className="rounded-xl border border-blue-200 bg-blue-50 p-4" aria-label="Commercial promotion cost allocation">
          <p className="text-sm font-bold text-blue-900">Commercial / code-free promotion cost</p>
          <p className="mt-2 text-sm text-blue-900">Period spend ÷ allocation leads × selected sales and returns. When unique system leads exceed Facebook Results, the actual lead count keeps the allocation within the CSV spend. Pending and other leads' share stays separate.</p>
          <p className="mt-2 text-sm text-blue-900">Recorded: {profitMoney(allocation.commercialSpend)} · Included: {profitMoney(allocation.commercialCost)} · Remaining: {profitMoney(allocation.commercialRemainingCost)}</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-sm" aria-label="Commercial promotion allocation details"><thead className="text-left"><tr>{['CSV dates', 'Recorded spend', 'Allocation leads', 'Selected sale / return', 'Cost deducted', 'Other / pending share'].map(label => <th key={label} scope="col" className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{allocation.commercialCohorts.map(row => <tr key={`${row.from}|${row.to}`} className="border-t border-blue-200"><th scope="row" className="px-2 py-2 text-left font-normal">{row.from}<br />{row.to}</th><td className="px-2 py-2">{profitMoney(row.spend)}</td><td className="px-2 py-2">{row.leads}</td><td className="px-2 py-2">{row.selectedPaid} / {row.selectedReturned}</td><td className="px-2 py-2 font-bold">{profitMoney(row.selectedCost)}</td><td className="px-2 py-2">{profitMoney(row.remainingCost)}</td></tr>)}</tbody></table></div>
        </section>}
        {allocation.unmatchedCost > 0 && <p role="alert" className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="h-5 w-5 shrink-0" />{profitMoney(allocation.unmatchedCost)} remains unmatched to unique system leads. {allocation.waybillScoped ? 'It stays separate from this waybill selection. Selected waybills still need their own cost match.' : 'Check lead sync, ad codes and report dates before using the final profit.'}</p>}
        {allocation.missingOrderIds.length > 0 && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{allocation.missingOrderIds.length} selected Facebook order(s) need a cost match or delivery confirmation within the selected reporting dates.</p>}
        {allocation.cohorts.flatMap(row => row.warnings.map(warning => <p key={`${row.code}|${row.from}|${warning}`} className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{row.code}: {warning}</p>))}
        {allocation.issues.map(issue => <p key={issue} role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{issue}</p>)}
        <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[960px] text-sm" aria-label="Facebook ad cost allocation"><thead className="bg-gray-50 text-left"><tr>{['Code', 'Lead period', 'Ad spend', 'FB leads / matched', 'Delivered + Paid', 'Pending', 'Ad loss', 'Unmatched'].map(label => <th scope="col" key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{allocation.cohorts.map(row => <tr key={`${row.code}|${row.from}|${row.to}`}><th scope="row" className="px-3 py-3 text-left font-mono">{row.code}</th><td className="whitespace-nowrap px-3 py-3">{row.from}<br />{row.to}</td><td className="whitespace-nowrap px-3 py-3 font-semibold">{profitMoney(row.spend)}</td><td className="px-3 py-3">{row.leads} / {row.matched}{row.fallbackDates > 0 && <p className="mt-1 text-xs text-amber-700">{row.fallbackDates} use system date</p>}</td>{(['paid', 'pending', 'lost', 'unmatched'] as const).map(state => <td key={state} className="whitespace-nowrap px-3 py-3"><p>{row[state]} leads</p><p className="mt-1 font-semibold">{profitMoney(row[`${state}Cost`])}</p></td>)}</tr>)}</tbody></table></div>
        <details className="text-sm"><summary className="cursor-pointer font-bold">Current Facebook CSV ({ledger.rows.length} ad rows)</summary><div className="mt-3 max-h-64 overflow-auto rounded-xl border border-gray-200"><table className="w-full min-w-[680px] text-sm"><thead className="bg-gray-50 text-left"><tr>{['Code / Campaign', 'Reporting dates', 'Spend', 'File'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{ledger.rows.slice().reverse().map((row, index) => <tr key={index} className="border-t border-gray-100"><td className="px-3 py-2 font-bold">{row.code || 'Commercial'}<p className="text-xs font-normal text-gray-500">{row.campaign} / {row.adSet}</p></td><td className="whitespace-nowrap px-3 py-2">{row.from} to {row.to}</td><td className="whitespace-nowrap px-3 py-2">{profitMoney(row.spend)}</td><td className="break-all px-3 py-2 text-gray-500">{row.fileName}</td></tr>)}</tbody></table></div></details>
        <p className="flex items-start gap-2 text-sm text-gray-500"><CheckCircle2 className="h-4 w-4 shrink-0" />Only the latest uploaded Facebook CSV is active. Each new upload replaces the previous report; re-uploading the same file adds no duplicate expense.</p>
        <p className="text-sm text-gray-500">{allocation.waybillScoped ? 'The summary and order profits deduct item-ad cost, the selected share of known FB losses, and Commercial / promotion cost. The table shows all leads in those cost periods.' : 'This is an average cost allocation for paid orders.'} Pending and unmatched costs remain visible. Full incurred advertising spend remains recorded separately.</p>
      </>}
    </>}
  </div>;
}
