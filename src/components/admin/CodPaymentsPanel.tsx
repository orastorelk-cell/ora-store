import React, { useMemo, useState } from 'react';
import { CheckCircle2, FileUp, WalletCards } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { autoMapHeader, parseCsv, parseFlexibleDate, toNumber } from '../../lib/csv';

interface Mapping { waybill: string; status: string; amount: string; date: string; reference: string; }
const blankMapping: Mapping = { waybill: '', status: '', amount: '', date: '', reference: '' };
const paidWords = /paid|received|collected|settled|success|remit|complete/i;

export const CodPaymentsPanel: React.FC = () => {
  const { orders, recordCodPayments, adminUser } = useStore();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string,string>[]>([]);
  const [mapping, setMapping] = useState<Mapping>(blankMapping);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [manual, setManual] = useState({ waybill: '', amount: '', date: new Date().toISOString().slice(0,10), reference: '' });

  const codOrders = useMemo(() => orders.filter((o) => o.payment_method === 'COD' && o.waybill_number), [orders]);
  const received = codOrders.filter((o) => o.cod_payment_received);

  const loadCsv = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping({
      waybill: autoMapHeader(parsed.headers, ['waybill','way bill','tracking','awb','barcode','consignment']),
      status: autoMapHeader(parsed.headers, ['payment status','cod status','status','payment']),
      amount: autoMapHeader(parsed.headers, ['cod amount','amount','collected amount','payment amount','net amount']),
      date: autoMapHeader(parsed.headers, ['payment date','received date','settlement date','date']),
      reference: autoMapHeader(parsed.headers, ['reference','ref','transaction','settlement id']),
    });
    setMessage(`Loaded ${parsed.rows.length} CSV row(s). Check the column mapping, then import.`);
  };

  const importCsv = async () => {
    if (!mapping.waybill) { setMessage('Select the Waybill column first.'); return; }
    setWorking(true); setMessage('');
    try {
      const entries = rows
        .filter((row) => String(row[mapping.waybill] || '').trim())
        .filter((row) => !mapping.status || paidWords.test(String(row[mapping.status] || '')))
        .map((row) => ({
          waybill: String(row[mapping.waybill] || '').trim(),
          amount: mapping.amount ? toNumber(row[mapping.amount]) : undefined,
          received_at: mapping.date ? parseFlexibleDate(row[mapping.date]) : undefined,
          reference: mapping.reference ? String(row[mapping.reference] || '').trim() : undefined,
          source: 'Fardar CSV' as const,
        }));
      const result = await recordCodPayments(entries, adminUser?.name || 'Admin');
      setMessage(`Updated ${result.updatedCount} COD payment(s).${result.notFound.length ? ` ${result.notFound.length} waybill(s) were not found.` : ''}`);
    } catch (error: any) { setMessage(error?.message || 'COD payment import failed.'); }
    finally { setWorking(false); }
  };

  const saveManual = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manual.waybill.trim()) return;
    setWorking(true); setMessage('');
    try {
      const result = await recordCodPayments([{
        waybill: manual.waybill.trim(),
        amount: manual.amount ? Number(manual.amount) : undefined,
        received_at: manual.date ? new Date(`${manual.date}T12:00:00`).toISOString() : undefined,
        reference: manual.reference.trim() || undefined,
        source: 'Manual',
      }], adminUser?.name || 'Admin');
      setMessage(result.updatedCount ? 'COD payment recorded successfully.' : `Waybill not found: ${result.notFound.join(', ')}`);
      if (result.updatedCount) setManual({ waybill: '', amount: '', date: new Date().toISOString().slice(0,10), reference: '' });
    } catch (error: any) { setMessage(error?.message || 'Could not record payment.'); }
    finally { setWorking(false); }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white border border-gray-100 p-4"><p className="text-[11px] font-bold text-gray-400 uppercase">COD Waybills</p><p className="text-2xl font-black mt-1">{codOrders.length}</p></div>
        <div className="rounded-2xl bg-white border border-gray-100 p-4"><p className="text-[11px] font-bold text-gray-400 uppercase">Payment Received</p><p className="text-2xl font-black mt-1 text-emerald-600">{received.length}</p></div>
        <div className="rounded-2xl bg-white border border-gray-100 p-4"><p className="text-[11px] font-bold text-gray-400 uppercase">Recorded Amount</p><p className="text-2xl font-black mt-1">Rs. {received.reduce((s,o)=>s+Number(o.cod_payment_amount||0),0).toLocaleString()}</p></div>
      </div>

      <div className="rounded-2xl bg-white border border-gray-100 p-5 space-y-4">
        <div className="flex items-center gap-2"><FileUp className="w-5 h-5 text-orange-600"/><div><h3 className="font-black">Fardar COD Payment CSV Import</h3><p className="text-xs text-gray-500">No fixed Fardar template is required. Upload the file and map its columns.</p></div></div>
        <input type="file" accept=".csv,text/csv" onChange={(e)=>loadCsv(e.target.files?.[0])} className="block w-full text-xs" />
        {headers.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {([
                ['waybill','Waybill *'],['status','Payment Status'],['amount','Amount'],['date','Payment Date'],['reference','Reference']
              ] as [keyof Mapping,string][]).map(([key,label]) => (
                <label key={key} className="text-xs font-bold text-gray-600">{label}
                  <select value={mapping[key]} onChange={(e)=>setMapping({...mapping,[key]:e.target.value})} className="mt-1 w-full rounded-xl border border-gray-200 px-2 py-2 text-xs font-normal">
                    <option value="">Not mapped</option>{headers.map((h)=><option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">If Payment Status is mapped, only rows containing Paid/Received/Collected/Settled/Success-type statuses are imported. Leave it unmapped to import every row.</p>
            <button onClick={importCsv} disabled={working} className="rounded-xl bg-black text-white px-4 py-2.5 text-xs font-bold disabled:opacity-50">{working?'Importing…':`Import & Match ${rows.length} Row(s)`}</button>
          </>
        )}
      </div>

      <form onSubmit={saveManual} className="rounded-2xl bg-white border border-gray-100 p-5 space-y-4">
        <div className="flex items-center gap-2"><WalletCards className="w-5 h-5 text-orange-600"/><div><h3 className="font-black">Manual COD Payment</h3><p className="text-xs text-gray-500">Use this before Fardar CSV reports are available.</p></div></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input value={manual.waybill} onChange={(e)=>setManual({...manual,waybill:e.target.value})} placeholder="Waybill *" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" required />
          <input value={manual.amount} onChange={(e)=>setManual({...manual,amount:e.target.value})} type="number" min="0" placeholder="Amount (blank = order total)" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <input value={manual.date} onChange={(e)=>setManual({...manual,date:e.target.value})} type="date" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <input value={manual.reference} onChange={(e)=>setManual({...manual,reference:e.target.value})} placeholder="Reference (optional)" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <button disabled={working} className="rounded-xl bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/>Mark Payment Received</button>
      </form>

      {message && <div className="rounded-xl bg-orange-50 border border-orange-100 p-3 text-xs font-semibold text-orange-800">{message}</div>}

      <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100"><h3 className="font-black text-sm">Recorded COD Payments</h3></div>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-500"><tr><th className="text-left p-3">Waybill</th><th className="text-left p-3">Order</th><th className="text-left p-3">Customer</th><th className="text-right p-3">Amount</th><th className="text-left p-3">Date</th><th className="text-left p-3">Source</th></tr></thead><tbody>{received.slice().sort((a,b)=>new Date(b.cod_payment_received_at||0).getTime()-new Date(a.cod_payment_received_at||0).getTime()).map((o)=><tr key={o.id} className="border-t border-gray-50"><td className="p-3 font-mono font-bold">{o.waybill_number}</td><td className="p-3">{o.order_number}</td><td className="p-3">{o.customer_name}</td><td className="p-3 text-right font-bold">Rs. {Number(o.cod_payment_amount||0).toLocaleString()}</td><td className="p-3">{o.cod_payment_received_at?new Date(o.cod_payment_received_at).toLocaleDateString():'-'}</td><td className="p-3">{o.cod_payment_source||'-'}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
};
