import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, FileUp, Trash2 } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { autoMapHeader, downloadCsv, parseCsv, parseFlexibleDate, toNumber } from '../../lib/csv';

type AdRow={id:string;date:string;end_date?:string;code:string;amount_spent:number;cost_per_result:number;results:number};
type Mapping={date:string;endDate:string;code:string;amount:string;cpr:string;results:string};
const emptyMapping:Mapping={date:'',endDate:'',code:'',amount:'',cpr:'',results:''};
const token=()=>localStorage.getItem('ora_staff_session_token')||'';
const headers=()=>({'Content-Type':'application/json',Authorization:`Bearer ${token()}`});
const dayKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const money=(n:number)=>`Rs. ${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})}`;
const extractCampaignCode=(v:unknown)=>{const t=String(v||'').trim().toUpperCase();if(!t)return'UNMAPPED';const c=t.match(/\bCB-R\d+(?:-R\d+)+\b/i)?.[0];if(c)return c.toUpperCase();return t.match(/\bR\d{3,}\b/i)?.[0]?.toUpperCase()||t};
const reportCode=(v:unknown)=>{const t=String(v||'').trim().toUpperCase();if(!t)return'NO-SKU';if(/^CB-R\d+(?:-R\d+)+$/.test(t))return t;return t.match(/^R\d{3,}/)?.[0]||t};
const dateInside=(iso:string|undefined,from:string,to:string)=>{if(!iso)return false;const d=new Date(iso);if(Number.isNaN(d.getTime()))return false;const k=dayKey(d);return k>=from&&k<=to};
const dateKey=(iso:string|undefined)=>{if(!iso)return'';const d=new Date(iso);return Number.isNaN(d.getTime())?'':dayKey(d)};
const addDays=(key:string,n:number)=>{const d=new Date(`${key}T00:00:00`);d.setDate(d.getDate()+n);return dayKey(d)};
const daysBetweenInclusive=(start:string,end:string)=>{const a=new Date(`${start}T00:00:00`).getTime(),b=new Date(`${end}T00:00:00`).getTime();return Math.max(1,Math.floor((b-a)/86400000)+1)};
const deliveredAt=(o:any)=>{
  const history=Array.isArray(o.fardar_tracking_history)?o.fardar_tracking_history:[];
  const deliveredHistory=history.filter((h:any)=>/deliver/i.test(String(h?.status||''))&&h?.at).sort((a:any,b:any)=>new Date(b.at).getTime()-new Date(a.at).getTime());
  if(deliveredHistory[0]?.at)return deliveredHistory[0].at;
  if((/deliver/i.test(String(o.delivery_status||''))||/deliver/i.test(String(o.tracking_status||'')))&&o.fardar_tracking_updated_at)return o.fardar_tracking_updated_at;
  if(o.cod_payment_received_at)return o.cod_payment_received_at;
  return o.created_at;
};
const orderAdDate=(o:any)=>dateKey(o.platform_lead_created_at||o.lead_imported_at||o.created_at);

export const ReportsPanel:React.FC=()=>{
  const{orders,returnRecords}=useStore();
  const now=new Date(),weekStart=new Date(now);weekStart.setDate(now.getDate()-6);
  const[mode,setMode]=useState<'weekly'|'monthly'|'custom'>('weekly');
  const[from,setFrom]=useState(dayKey(weekStart));
  const[to,setTo]=useState(dayKey(now));
  const[adRows,setAdRows]=useState<AdRow[]>([]);
  const[csvHeaders,setCsvHeaders]=useState<string[]>([]);
  const[csvRows,setCsvRows]=useState<Record<string,string>[]>([]);
  const[mapping,setMapping]=useState<Mapping>(emptyMapping);
  const[message,setMessage]=useState('');

  useEffect(()=>{fetch('/api/admin-data/ads-report-rows',{headers:headers()}).then(async r=>{const d=await r.json().catch(()=>({}));if(r.ok)setAdRows(Array.isArray(d?.payload)?d.payload:[])}).catch(()=>{})},[]);
  useEffect(()=>{if(mode==='weekly'){const e=new Date(),s=new Date(e);s.setDate(e.getDate()-6);setFrom(dayKey(s));setTo(dayKey(e))}else if(mode==='monthly'){const e=new Date(),s=new Date(e.getFullYear(),e.getMonth(),1);setFrom(dayKey(s));setTo(dayKey(e))}},[mode]);

  const saveAds=async(next:AdRow[])=>{const r=await fetch('/api/admin-data/ads-report-rows',{method:'PUT',headers:headers(),body:JSON.stringify({payload:next})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error||'Could not save ad report rows.');setAdRows(next)};
  const loadCsv=async(file?:File)=>{if(!file)return;const p=parseCsv(await file.text());setCsvHeaders(p.headers);setCsvRows(p.rows);setMapping({date:autoMapHeader(p.headers,['date','day','reporting starts','reporting start']),endDate:autoMapHeader(p.headers,['reporting ends','reporting end','end date']),code:autoMapHeader(p.headers,['item code','product code','sku','code','ad name','campaign name','campaign']),amount:autoMapHeader(p.headers,['amount spent','spend','amount']),cpr:autoMapHeader(p.headers,['cost per result','cost/result','cpr']),results:autoMapHeader(p.headers,['results','result','purchases','leads'])});setMessage(`Loaded ${p.rows.length} Ads Manager row(s). Check the mapping before import.`)};
  const importAds=async()=>{if(!mapping.date||!mapping.amount){setMessage('Map at least Start Date and Amount Spent.');return}const normalized=csvRows.map((r,i)=>{const a=parseFlexibleDate(r[mapping.date]),b=mapping.endDate?parseFlexibleDate(r[mapping.endDate]):'';const start=a?dayKey(new Date(a)):'',end=b?dayKey(new Date(b)):start;return{id:`${Date.now()}-${i}`,date:start,end_date:end>=start?end:start,code:mapping.code?extractCampaignCode(r[mapping.code]):'UNMAPPED',amount_spent:toNumber(r[mapping.amount]),cost_per_result:mapping.cpr?toNumber(r[mapping.cpr]):0,results:mapping.results?toNumber(r[mapping.results]):0}as AdRow}).filter(r=>r.date&&r.amount_spent>=0);const d=new Map<string,AdRow>();[...adRows,...normalized].forEach(r=>d.set(`${r.date}|${r.end_date||r.date}|${r.code}|${r.amount_spent}|${r.cost_per_result}|${r.results}`,r));try{await saveAds([...d.values()].slice(-10000));const ranged=normalized.filter(r=>(r.end_date||r.date)!==r.date).length;setMessage(`Imported ${normalized.length} ad row(s). ${ranged?`${ranged} row(s) cover multiple days; exact daily profit is best with a daily Ads Manager export.`:'Daily dates detected.'}`)}catch(e:any){setMessage(e?.message||'Could not save Ads Manager data.')}};

  const deliveredOrders=useMemo(()=>orders.filter((o:any)=>o.order_status==='Delivered'&&!o.is_test_order&&!o.is_duplicate_order&&dateInside(deliveredAt(o),from,to)),[orders,from,to]);
  const deliveredIds=useMemo(()=>new Set(deliveredOrders.map((o:any)=>o.id)),[deliveredOrders]);
  const deliveredSales=deliveredOrders.reduce((s:number,o:any)=>s+Number(o.total_amount||0),0);
  const purchasingCost=deliveredOrders.reduce((s:number,o:any)=>s+o.items.reduce((x:number,i:any)=>x+Number(i.buying_price||0)*Number(i.quantity||0),0),0);
  const deliveryCost=deliveredOrders.reduce((s:number,o:any)=>s+Number(o.fardar_delivery_fee??o.internal_delivery_fee??0),0);

  const receivedByOrder=useMemo(()=>{const m=new Map<string,number>();deliveredOrders.forEach((o:any)=>{if(o.payment_method==='COD'&&o.cod_payment_received)m.set(o.id,Number(o.cod_payment_amount||o.total_amount||0));else if(o.payment_method==='Bank Payment'&&o.payment_status==='Paid'){const amt=o.payment_paid_type==='Advance'?Number(o.payment_detected_amount||o.payment_received_amount||o.advance_amount||0):Number(o.payment_received_amount||o.payment_detected_amount||o.total_amount||0);m.set(o.id,amt)}});return m},[deliveredOrders]);
  const totalReceived=[...receivedByOrder.values()].reduce((s,n)=>s+n,0);
  const pendingRemittance=Math.max(0,deliveredSales-totalReceived);

  const adDatesByCode=useMemo(()=>{const m=new Map<string,Set<string>>();deliveredOrders.forEach((o:any)=>{const d=orderAdDate(o);if(!d)return;o.items.forEach((i:any)=>{const code=reportCode(i.sku);const set=m.get(code)||new Set<string>();set.add(d);m.set(code,set)})});return m},[deliveredOrders]);
  const allocatedAds=useMemo(()=>{const out:{code:string;spend:number;results:number;cpr:number;matchedDays:number;sourceDays:number}[]=[];adRows.forEach(a=>{const code=reportCode(a.code),wanted=adDatesByCode.get(code);if(!wanted?.size)return;const end=a.end_date||a.date,totalDays=daysBetweenInclusive(a.date,end);let matched=0;for(let i=0;i<totalDays;i++){if(wanted.has(addDays(a.date,i)))matched++}if(!matched)return;const ratio=matched/totalDays;out.push({code,spend:Number(a.amount_spent||0)*ratio,results:Number(a.results||0)*ratio,cpr:Number(a.cost_per_result||0),matchedDays:matched,sourceDays:totalDays})});return out},[adRows,adDatesByCode]);
  const adSpend=allocatedAds.reduce((s,a)=>s+a.spend,0);
  const deliveredProfit=deliveredSales-purchasingCost-deliveryCost-adSpend;
  const cashProfit=totalReceived-purchasingCost-deliveryCost-adSpend;
  const returnsCount=returnRecords.filter((r:any)=>deliveredIds.has(r.order_id)&&dateInside(r.checked_at||r.created_at,from,to)).length;

  const productRows=useMemo(()=>{const map=new Map<string,any>();const get=(code:string,product:string)=>map.get(code)||{code,product,orders:new Set<string>(),qty:0,sales:0,received:0,purchasing:0,delivery:0,adSpend:0,results:0,cprTotal:0,cprCount:0};deliveredOrders.forEach((o:any)=>{const itemTotal=o.items.reduce((s:number,i:any)=>s+Number(i.subtotal||0),0)||1;o.items.forEach((i:any)=>{const code=reportCode(i.sku),r=get(code,i.product_name),share=Number(i.subtotal||0)/itemTotal;r.orders.add(o.id);r.qty+=Number(i.quantity||0);r.sales+=Number(i.subtotal||0);r.received+=Number(receivedByOrder.get(o.id)||0)*share;r.purchasing+=Number(i.buying_price||0)*Number(i.quantity||0);r.delivery+=Number(o.fardar_delivery_fee??o.internal_delivery_fee??0)*share;map.set(code,r)})});allocatedAds.forEach(a=>{const r=get(a.code,'No matching delivered product');r.adSpend+=a.spend;r.results+=a.results;if(a.cpr>0){r.cprTotal+=a.cpr;r.cprCount++}map.set(a.code,r)});return[...map.values()].map(r=>({...r,orderCount:r.orders.size,totalCost:r.purchasing+r.delivery+r.adSpend,avgCpr:r.cprCount?r.cprTotal/r.cprCount:0,profit:r.sales-r.purchasing-r.delivery-r.adSpend,cashProfit:r.received-r.purchasing-r.delivery-r.adSpend})).sort((a,b)=>b.sales-a.sales)},[deliveredOrders,receivedByOrder,allocatedAds]);

  const exportReport=()=>downloadCsv(`O-RA_Delivered_Report_${from}_to_${to}.csv`,[['Item Code','Product','Delivered Orders','Qty Delivered','Delivered Sales','Money Received','Pending Remittance','Purchasing Cost','Delivery Cost','Related Ad Spend','Total Cost','Results','Avg CPR','Delivered Profit','Cash Profit'],...productRows.map(r=>[r.code,r.product,r.orderCount,r.qty,r.sales,r.received,Math.max(0,r.sales-r.received),r.purchasing,r.delivery,r.adSpend,r.totalCost,r.results.toFixed(2),r.avgCpr.toFixed(2),r.profit,r.cashProfit])]);
  const clearAds=async()=>{if(!window.confirm('Clear all imported Ads Manager report rows?'))return;try{await saveAds([]);setMessage('Imported ad report rows cleared.')}catch(e:any){setMessage(e?.message||'Could not clear rows.')}};

  const cards=[['Delivered Orders',deliveredOrders.length],['Delivered Sales',money(deliveredSales)],['Money Received',money(totalReceived)],['Pending Remittance',money(pendingRemittance)],['Purchasing Cost',money(purchasingCost)],['Delivery Cost',money(deliveryCost)],['Related FB Ad Spend',money(adSpend)],['Returns',returnsCount],['Total Cost',money(purchasingCost+deliveryCost+adSpend)],['DELIVERED PROFIT',money(deliveredProfit)],['CASH PROFIT',money(cashProfit)]];
  const hasAggregateAds=adRows.some(a=>(a.end_date||a.date)!==a.date);

  return <div className="space-y-5">
    <div className="rounded-2xl bg-white border border-gray-100 p-4 flex flex-col lg:flex-row lg:items-end gap-3 justify-between"><div><h2 className="font-black flex items-center gap-2"><BarChart3 className="w-5 h-5 text-orange-600"/>Delivered Order Profit Report</h2><p className="text-xs text-gray-500 mt-1">Only delivered orders are included. Pending, processing, packed and shipped orders are excluded.</p></div><div className="flex flex-wrap gap-2 items-end"><select value={mode} onChange={e=>setMode(e.target.value as any)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold"><option value="weekly">Last 7 Days</option><option value="monthly">This Month</option><option value="custom">Custom</option></select><input type="date" value={from} onChange={e=>{setMode('custom');setFrom(e.target.value)}} className="rounded-xl border border-gray-200 px-3 py-2 text-xs"/><input type="date" value={to} onChange={e=>{setMode('custom');setTo(e.target.value)}} className="rounded-xl border border-gray-200 px-3 py-2 text-xs"/><button onClick={exportReport} className="rounded-xl bg-black text-white px-3 py-2 text-xs font-bold inline-flex items-center gap-2"><Download className="w-4 h-4"/>CSV</button></div></div>

    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">{cards.map(([l,v])=><div key={String(l)} className={`rounded-2xl border p-3 ${l==='DELIVERED PROFIT'?'bg-green-50 border-green-200':l==='CASH PROFIT'?'bg-blue-50 border-blue-200':'bg-white border-gray-100'}`}><p className="text-[10px] uppercase font-bold text-gray-500">{l}</p><p className="mt-1 text-base font-black text-gray-900 break-words">{v}</p></div>)}</div>

    <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 text-xs text-gray-600 space-y-1"><p><b>Delivered Profit</b> = delivered order value − purchasing cost − actual/internal delivery cost − Facebook ad spend related to those delivered orders' original order/lead dates.</p><p><b>Cash Profit</b> uses only money already marked received. Courier remittance that has not arrived yet appears under Pending Remittance.</p><p>Pending/Processing/Packed/Shipped orders do not affect this report.</p>{hasAggregateAds&&<p className="font-bold text-amber-700">Your imported Facebook file contains multi-day totals. The system only allocates the matching delivered-order dates proportionally. For exact daily ad spend, export Ads Manager with a daily breakdown (one campaign row per day).</p>}</div>

    <div className="rounded-2xl bg-white border border-gray-100 p-5 space-y-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><FileUp className="w-5 h-5 text-orange-600"/><div><h3 className="font-black">Facebook Ads Manager CSV</h3><p className="text-xs text-gray-500">Only campaign dates connected to delivered orders are used in profit.</p></div></div><button onClick={clearAds} className="text-xs font-bold text-red-600 inline-flex items-center gap-1"><Trash2 className="w-4 h-4"/>Clear Imported</button></div><input type="file" accept=".csv,text/csv" onChange={e=>loadCsv(e.target.files?.[0])} className="block w-full text-xs"/>{csvHeaders.length>0&&<><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">{([['date','Start Date *'],['endDate','End Date'],['code','Item/Product Code'],['amount','Amount Spent *'],['cpr','Cost Per Result'],['results','Results']]as[keyof Mapping,string][]).map(([k,l])=><label key={k} className="text-xs font-bold text-gray-600">{l}<select value={mapping[k]} onChange={e=>setMapping({...mapping,[k]:e.target.value})} className="mt-1 w-full rounded-xl border border-gray-200 px-2 py-2 text-xs font-normal"><option value="">Not mapped</option>{csvHeaders.map(h=><option key={h}>{h}</option>)}</select></label>)}</div><button onClick={importAds} className="rounded-xl bg-orange-600 text-white px-4 py-2.5 text-xs font-bold">Import Ad Data</button></>}{message&&<p className="text-xs font-semibold text-orange-700">{message}</p>}</div>

    <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden"><div className="p-4 border-b border-gray-100"><h3 className="font-black text-sm">Delivered Product Profit Breakdown</h3></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-500"><tr>{['Code','Product','Delivered','Qty','Sales','Received','Pending','Purchasing','Delivery','Related Ads','Total Cost','Results','Avg CPR','Profit','Cash Profit'].map(h=><th key={h} className="text-left p-3 whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{productRows.map(r=><tr key={r.code} className="border-t border-gray-50"><td className="p-3 font-mono font-bold">{r.code}</td><td className="p-3 min-w-40">{r.product}</td><td className="p-3">{r.orderCount}</td><td className="p-3">{r.qty}</td><td className="p-3">{money(r.sales)}</td><td className="p-3">{money(r.received)}</td><td className="p-3">{money(Math.max(0,r.sales-r.received))}</td><td className="p-3">{money(r.purchasing)}</td><td className="p-3">{money(r.delivery)}</td><td className="p-3">{money(r.adSpend)}</td><td className="p-3">{money(r.totalCost)}</td><td className="p-3">{r.results.toFixed(2)}</td><td className="p-3">{r.avgCpr?money(r.avgCpr):'-'}</td><td className="p-3 font-black">{money(r.profit)}</td><td className="p-3 font-bold">{money(r.cashProfit)}</td></tr>)}</tbody></table></div></div>
  </div>;
};
