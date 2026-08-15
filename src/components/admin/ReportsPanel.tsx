import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, FileUp, Trash2 } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { autoMapHeader, downloadCsv, parseCsv, parseFlexibleDate, toNumber } from '../../lib/csv';

type AdRow = { id: string; date: string; code: string; amount_spent: number; cost_per_result: number; results: number };
type Mapping = { date: string; code: string; amount: string; cpr: string; results: string };
const emptyMapping: Mapping = { date: '', code: '', amount: '', cpr: '', results: '' };
const token = () => localStorage.getItem('ora_staff_session_token') || '';
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });
const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
const dateInside = (iso: string | undefined, from: string, to: string) => {
  if (!iso) return false;
  const key = dayKey(new Date(iso));
  return key >= from && key <= to;
};

export const ReportsPanel: React.FC = () => {
  const { orders, returnRecords } = useStore();
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6);
  const [mode, setMode] = useState<'weekly'|'monthly'|'custom'>('weekly');
  const [from, setFrom] = useState(dayKey(weekStart));
  const [to, setTo] = useState(dayKey(now));
  const [adRows, setAdRows] = useState<AdRow[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string,string>[]>([]);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/admin-data/ads-report-rows', { headers: headers() }).then(async (response) => {
      const data = await response.json().catch(()=>({}));
      if (response.ok) setAdRows(Array.isArray(data?.payload) ? data.payload : []);
    }).catch(()=>{});
  }, []);

  useEffect(() => {
    if (mode === 'weekly') {
      const end = new Date(); const start = new Date(end); start.setDate(end.getDate()-6);
      setFrom(dayKey(start)); setTo(dayKey(end));
    } else if (mode === 'monthly') {
      const end = new Date(); const start = new Date(end.getFullYear(), end.getMonth(), 1);
      setFrom(dayKey(start)); setTo(dayKey(end));
    }
  }, [mode]);

  const saveAds = async (next: AdRow[]) => {
    const response = await fetch('/api/admin-data/ads-report-rows', { method:'PUT', headers: headers(), body: JSON.stringify({ payload: next }) });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data?.error || 'Could not save ad report rows.');
    setAdRows(next);
  };

  const loadCsv = async (file?: File) => {
    if (!file) return;
    const parsed = parseCsv(await file.text());
    setCsvHeaders(parsed.headers); setCsvRows(parsed.rows);
    setMapping({
      date: autoMapHeader(parsed.headers, ['date','day','reporting starts','reporting start']),
      code: autoMapHeader(parsed.headers, ['item code','product code','sku','code','ad name']),
      amount: autoMapHeader(parsed.headers, ['amount spent','spend','amount']),
      cpr: autoMapHeader(parsed.headers, ['cost per result','cost/result','cpr']),
      results: autoMapHeader(parsed.headers, ['results','result','purchases','leads']),
    });
    setMessage(`Loaded ${parsed.rows.length} Ads Manager row(s). Check the mapping before import.`);
  };

  const importAds = async () => {
    if (!mapping.date || !mapping.amount) { setMessage('Map at least Date and Amount Spent.'); return; }
    const normalized = csvRows.map((row, index) => {
      const parsedDate = parseFlexibleDate(row[mapping.date]);
      return {
        id: `${Date.now()}-${index}`,
        date: parsedDate ? dayKey(new Date(parsedDate)) : '',
        code: mapping.code ? String(row[mapping.code] || '').trim().toUpperCase() : 'UNMAPPED',
        amount_spent: toNumber(row[mapping.amount]),
        cost_per_result: mapping.cpr ? toNumber(row[mapping.cpr]) : 0,
        results: mapping.results ? toNumber(row[mapping.results]) : 0,
      } as AdRow;
    }).filter((row) => row.date && row.amount_spent >= 0);
    const dedupe = new Map<string,AdRow>();
    [...adRows, ...normalized].forEach((row) => dedupe.set(`${row.date}|${row.code}|${row.amount_spent}|${row.cost_per_result}|${row.results}`, row));
    const next = [...dedupe.values()].slice(-10000);
    try { await saveAds(next); setMessage(`Imported ${normalized.length} normalized ad row(s). Raw CSV was not stored.`); }
    catch (error:any) { setMessage(error?.message || 'Could not save Ads Manager data.'); }
  };

  const filteredOrders = useMemo(() => orders.filter((o) => dateInside(o.created_at, from, to)), [orders,from,to]);
  const salesOrders = filteredOrders.filter((o) => o.order_status !== 'Cancelled' && !o.is_test_order && !o.is_duplicate_order);
  const filteredAds = adRows.filter((row) => row.date >= from && row.date <= to);
  const codCollectedOrders = orders.filter((o) => o.cod_payment_received && dateInside(o.cod_payment_received_at, from, to));
  const orderedRevenue = salesOrders.reduce((sum,o)=>sum+Number(o.total_amount||0),0);
  const cogs = salesOrders.reduce((sum,o)=>sum+o.items.reduce((s,i)=>s+Number(i.buying_price||0)*Number(i.quantity||0),0),0);
  const deliveryCost = salesOrders.reduce((sum,o)=>sum+Number(o.internal_delivery_fee||0),0);
  const adSpend = filteredAds.reduce((sum,row)=>sum+Number(row.amount_spent||0),0);
  const codCollected = codCollectedOrders.reduce((sum,o)=>sum+Number(o.cod_payment_amount||o.total_amount||0),0);
  const bankCollected = salesOrders.filter((o)=>o.payment_method==='Bank Payment' && o.payment_status==='Paid').reduce((sum,o)=>{
    if (o.payment_paid_type === 'Advance') return sum + Number(o.payment_detected_amount || o.advance_amount || 0);
    return sum + Number(o.payment_detected_amount || o.total_amount || 0);
  },0);
  const returnsCount = returnRecords.filter((r:any)=>dateInside(r.checked_at || r.created_at,from,to)).length;
  const cancelled = filteredOrders.filter((o)=>o.order_status==='Cancelled').length;
  const contribution = orderedRevenue-cogs-deliveryCost-adSpend;

  const productRows = useMemo(() => {
    const map = new Map<string,{code:string;product:string;qty:number;orders:Set<string>;revenue:number;cogs:number;adSpend:number;results:number;cprTotal:number;cprCount:number}>();
    salesOrders.forEach((order) => order.items.forEach((item) => {
      const code=String(item.sku||'NO-SKU').toUpperCase();
      const row=map.get(code)||{code,product:item.product_name,qty:0,orders:new Set<string>(),revenue:0,cogs:0,adSpend:0,results:0,cprTotal:0,cprCount:0};
      row.qty+=Number(item.quantity||0); row.orders.add(order.id); row.revenue+=Number(item.subtotal||0); row.cogs+=Number(item.buying_price||0)*Number(item.quantity||0); map.set(code,row);
    }));
    filteredAds.forEach((ad)=>{
      const code=String(ad.code||'UNMAPPED').toUpperCase();
      const row=map.get(code)||{code,product:'No matching system product',qty:0,orders:new Set<string>(),revenue:0,cogs:0,adSpend:0,results:0,cprTotal:0,cprCount:0};
      row.adSpend+=Number(ad.amount_spent||0); row.results+=Number(ad.results||0); if(ad.cost_per_result>0){row.cprTotal+=ad.cost_per_result;row.cprCount+=1;} map.set(code,row);
    });
    return [...map.values()].map((row)=>({ ...row, orderCount:row.orders.size, avgCpr:row.cprCount?row.cprTotal/row.cprCount:0, contribution:row.revenue-row.cogs-row.adSpend })).sort((a,b)=>b.revenue-a.revenue);
  },[salesOrders,filteredAds]);

  const exportReport = () => downloadCsv(`O-RA_Report_${from}_to_${to}.csv`, [
    ['Item Code','Product','Orders','Qty Sold','Sales Revenue','COGS','Ad Spend','Results','Avg Cost Per Result','Est Contribution'],
    ...productRows.map((row)=>([row.code,row.product,row.orderCount,row.qty,row.revenue,row.cogs,row.adSpend,row.results,row.avgCpr.toFixed(2),row.contribution] as (string|number)[])),
  ]);

  const clearAds = async () => { if (!window.confirm('Clear all imported Ads Manager report rows?')) return; try { await saveAds([]); setMessage('Imported ad report rows cleared.'); } catch(error:any){setMessage(error?.message||'Could not clear rows.');} };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white border border-gray-100 p-4 flex flex-col lg:flex-row lg:items-end gap-3 justify-between">
        <div><h2 className="font-black flex items-center gap-2"><BarChart3 className="w-5 h-5 text-orange-600"/>Business Reports</h2><p className="text-xs text-gray-500 mt-1">System sales + COD collections + optional Facebook Ads Manager CSV.</p></div>
        <div className="flex flex-wrap gap-2 items-end">
          <select value={mode} onChange={(e)=>setMode(e.target.value as any)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold"><option value="weekly">Last 7 Days</option><option value="monthly">This Month</option><option value="custom">Custom</option></select>
          <input type="date" value={from} onChange={(e)=>{setMode('custom');setFrom(e.target.value)}} className="rounded-xl border border-gray-200 px-3 py-2 text-xs"/>
          <input type="date" value={to} onChange={(e)=>{setMode('custom');setTo(e.target.value)}} className="rounded-xl border border-gray-200 px-3 py-2 text-xs"/>
          <button onClick={exportReport} className="rounded-xl bg-black text-white px-3 py-2 text-xs font-bold inline-flex items-center gap-2"><Download className="w-4 h-4"/>CSV</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        {[
          ['Orders',salesOrders.length],['Revenue',`Rs. ${orderedRevenue.toLocaleString()}`],['COD Collected',`Rs. ${codCollected.toLocaleString()}`],['Bank Collected',`Rs. ${bankCollected.toLocaleString()}`],['COGS',`Rs. ${cogs.toLocaleString()}`],['Ad Spend',`Rs. ${adSpend.toLocaleString()}`],['Returns',returnsCount],['Est. Contribution',`Rs. ${contribution.toLocaleString()}`],
        ].map(([label,value])=><div key={String(label)} className="rounded-2xl bg-white border border-gray-100 p-3"><p className="text-[10px] uppercase font-bold text-gray-400">{label}</p><p className="mt-1 text-base font-black text-gray-900 break-words">{value}</p></div>)}
      </div>
      <p className="text-[11px] text-gray-400">Cancelled in range: {cancelled}. Estimated Contribution = ordered sales revenue − product buying cost − internal delivery cost − imported ad spend. It is an operational estimate, not audited accounting profit.</p>

      <div className="rounded-2xl bg-white border border-gray-100 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><FileUp className="w-5 h-5 text-orange-600"/><div><h3 className="font-black">Facebook Ads Manager CSV</h3><p className="text-xs text-gray-500">Flexible mapping works even before you know the exact Ads Manager export format.</p></div></div><button onClick={clearAds} className="text-xs font-bold text-red-600 inline-flex items-center gap-1"><Trash2 className="w-4 h-4"/>Clear Imported</button></div>
        <input type="file" accept=".csv,text/csv" onChange={(e)=>loadCsv(e.target.files?.[0])} className="block w-full text-xs"/>
        {csvHeaders.length>0&&<><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">{([['date','Date *'],['code','Item/Product Code'],['amount','Amount Spent *'],['cpr','Cost Per Result'],['results','Results']] as [keyof Mapping,string][]).map(([key,label])=><label key={key} className="text-xs font-bold text-gray-600">{label}<select value={mapping[key]} onChange={(e)=>setMapping({...mapping,[key]:e.target.value})} className="mt-1 w-full rounded-xl border border-gray-200 px-2 py-2 text-xs font-normal"><option value="">Not mapped</option>{csvHeaders.map((h)=><option key={h}>{h}</option>)}</select></label>)}</div><button onClick={importAds} className="rounded-xl bg-orange-600 text-white px-4 py-2.5 text-xs font-bold">Import Normalized Data</button></>}
        <p className="text-[11px] text-gray-400">Storage saver: the original CSV file is never stored. Only the small normalized Date / Code / Spend / Cost-per-result / Results rows are kept.</p>
        {message&&<p className="text-xs font-semibold text-orange-700">{message}</p>}
      </div>

      <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100"><h3 className="font-black text-sm">Product / Ad Performance</h3></div>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-500"><tr>{['Code','Product','Orders','Qty','Revenue','COGS','Ad Spend','Results','Avg CPR','Est. Contribution'].map((h)=><th key={h} className="text-left p-3 whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{productRows.map((row)=><tr key={row.code} className="border-t border-gray-50"><td className="p-3 font-mono font-bold">{row.code}</td><td className="p-3 min-w-40">{row.product}</td><td className="p-3">{row.orderCount}</td><td className="p-3">{row.qty}</td><td className="p-3">Rs. {row.revenue.toLocaleString()}</td><td className="p-3">Rs. {row.cogs.toLocaleString()}</td><td className="p-3">Rs. {row.adSpend.toLocaleString()}</td><td className="p-3">{row.results}</td><td className="p-3">{row.avgCpr?`Rs. ${row.avgCpr.toFixed(2)}`:'-'}</td><td className="p-3 font-bold">Rs. {row.contribution.toLocaleString()}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
};
