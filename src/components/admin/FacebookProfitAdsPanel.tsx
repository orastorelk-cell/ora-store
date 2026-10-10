import React, { useRef, useState } from 'react';
import { Upload, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { profitMoney } from '../../lib/paidWaybillProfit';
import { mergeFacebookAdLedger, parseFacebookAdCostCsv, type FacebookAdAllocation, type FacebookAdCost, type FacebookAdLedger } from '../../lib/facebookProfitAds';

export interface FacebookProfitAdsPanelProps {
  ledger: FacebookAdLedger; allocation: FacebookAdAllocation; ready: boolean; error?: string; canImport: boolean; knownCodes: string[];
  onImport: (csv: string, fileName: string) => Promise<FacebookAdLedger>;
  onReload: () => Promise<void>;
}

export function FacebookProfitAdsPanel({ ledger, allocation, ready, error, canImport, knownCodes, onImport, onReload }: FacebookProfitAdsPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ csv: string; fileName: string; rows: FacebookAdCost[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const choose = async (file?: File) => {
    if (!file) return;
    setMessage(''); setPending(null);
    try {
      if (file.size > 2_000_000) throw new Error('Choose a CSV report smaller than 2 MB.');
      const csv = await file.text(), rows = parseFacebookAdCostCsv(csv, knownCodes);
      mergeFacebookAdLedger(ledger, rows, { expectedVersion: ledger.version, fileName: file.name, importedAt: new Date().toISOString(), importedBy: 'Preview' });
      setPending({ csv, fileName: file.name, rows });
    } catch (e: any) { setMessage(e.message || 'The CSV could not be read.'); }
  };
  const save = async () => {
    if (!pending) return;
    setBusy(true); setMessage('');
    try {
      const saved = await onImport(pending.csv, pending.fileName);
      setMessage(saved.version === ledger.version ? 'This report was already saved. No cost was added twice.' : 'Facebook costs saved. Paid-order profit has been recalculated.');
      setPending(null);
    } catch (e: any) { setMessage(e.message || 'Save was not confirmed. The selected CSV is kept; retry it.'); }
    finally { setBusy(false); }
  };
  const reload = async () => { setBusy(true); try { await onReload(); setMessage('Saved advertising history refreshed.'); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); } };
  const periods = pending ? [...new Set(pending.rows.map(row => `${row.from} to ${row.to}`))] : [];
  return <div className="mt-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-black">Facebook Cost CSV</p><p className="mt-1 text-sm text-gray-500">Code එක සහ මුල් lead date එක අනුව cost බෙදනවා. Pending orders වල කොටස වෙනම පෙන්වනවා.</p></div>
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
      <p className="mt-2 text-sm text-orange-900">Include all ads for each code and reporting period. Saving replaces that code's previous report for the same dates.</p>
      <div className="mt-3 flex gap-2"><button type="button" disabled={busy || !ready || Boolean(error)} onClick={save} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Saving...' : 'Save Cost Report'}</button><button type="button" disabled={busy} onClick={() => setPending(null)} className="rounded-lg border border-orange-200 px-4 py-2 text-sm font-bold">Cancel</button></div>
    </div>}
    {ready && !error && <>
      {!ledger.rows.length && <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">Upload the Facebook report for the original lead dates. Saved reports remain available when later orders are delivered and paid.</p>}
      {ledger.rows.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
          ['Paid orders: allocated Facebook cost', allocation.paidCost], ['Known cancelled / return ad losses', allocation.lostCost],
          ['Pending lead cost', allocation.pendingCost], ['Commercial cost included', allocation.commercialCost],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-gray-50 p-3"><p className="text-sm text-gray-500">{label}</p><p className="mt-1 text-lg font-black">{profitMoney(Number(value))}</p></div>)}</div>
        {allocation.unmatchedCost > 0 && <p role="alert" className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="h-5 w-5 shrink-0" />{profitMoney(allocation.unmatchedCost)} remains unmatched to unique system leads. {allocation.waybillScoped ? 'It stays separate from this waybill selection. Selected waybills still need their own cost match.' : 'Check lead sync, ad codes and report dates before using the final profit.'}</p>}
        {allocation.missingOrderIds.length > 0 && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{allocation.missingOrderIds.length} selected Facebook order(s) need a matching cost period or delivery confirmation. Older leads need their original period's report.</p>}
        {allocation.issues.map(issue => <p key={issue} role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{issue}</p>)}
        <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[960px] text-sm" aria-label="Facebook ad cost allocation"><thead className="bg-gray-50 text-left"><tr>{['Code', 'Lead period', 'Ad spend', 'FB leads / matched', 'Delivered + Paid', 'Pending', 'Ad loss', 'Unmatched'].map(label => <th scope="col" key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{allocation.cohorts.map(row => <tr key={`${row.code}|${row.from}|${row.to}`}><th scope="row" className="px-3 py-3 text-left font-mono">{row.code}</th><td className="whitespace-nowrap px-3 py-3">{row.from}<br />{row.to}</td><td className="whitespace-nowrap px-3 py-3 font-semibold">{profitMoney(row.spend)}</td><td className="px-3 py-3">{row.leads} / {row.matched}{row.fallbackDates > 0 && <p className="mt-1 text-xs text-amber-700">{row.fallbackDates} use system date</p>}</td>{(['paid', 'pending', 'lost', 'unmatched'] as const).map(state => <td key={state} className="whitespace-nowrap px-3 py-3"><p>{row[state]} leads</p><p className="mt-1 font-semibold">{profitMoney(row[`${state}Cost`])}</p></td>)}</tr>)}</tbody></table></div>
        <details className="text-sm"><summary className="cursor-pointer font-bold">Saved cost reports ({ledger.rows.length} ad rows)</summary><div className="mt-3 max-h-64 overflow-auto rounded-xl border border-gray-200"><table className="w-full min-w-[680px] text-sm"><thead className="bg-gray-50 text-left"><tr>{['Code / Campaign', 'Reporting dates', 'Spend', 'File'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{ledger.rows.slice().reverse().map((row, index) => <tr key={index} className="border-t border-gray-100"><td className="px-3 py-2 font-bold">{row.code || 'Commercial'}<p className="text-xs font-normal text-gray-500">{row.campaign} / {row.adSet}</p></td><td className="whitespace-nowrap px-3 py-2">{row.from} to {row.to}</td><td className="whitespace-nowrap px-3 py-2">{profitMoney(row.spend)}</td><td className="break-all px-3 py-2 text-gray-500">{row.fileName}</td></tr>)}</tbody></table></div></details>
        <p className="flex items-start gap-2 text-sm text-gray-500"><CheckCircle2 className="h-4 w-4 shrink-0" />Same code and dates replace the saved report; re-uploading adds no duplicate expense. Use non-overlapping dates, and export daily reports for new periods if needed.</p>
        <p className="text-sm text-gray-500">{allocation.waybillScoped ? 'The summary includes item-ad costs for uploaded waybills and full Commercial costs for the selected CSV period. The table shows all leads in those cost periods.' : 'This is an average cost allocation for paid orders.'} Pending and unmatched costs remain visible. Full incurred advertising spend remains recorded separately.</p>
      </>}
    </>}
  </div>;
}
