import React, { useMemo, useState } from 'react';
import { CheckCircle2, Eye, Search, ShieldAlert, WalletCards, X, XCircle } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { Order } from '../../types';

const statusClass = (status?: string) => {
  if (status === 'Approved') return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';
  if (status === 'Rejected') return 'bg-red-500/15 border-red-500/30 text-red-300';
  if (status === 'Auto Check Passed') return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  return 'bg-amber-500/15 border-amber-500/30 text-amber-300';
};

const matchBadge = (label: string, value?: boolean) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-black ${value ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
    {label}: {value ? 'MATCH' : 'NOT CONFIRMED'}
  </span>
);

export const BankTransferCheckPanel: React.FC = () => {
  const { orders, reviewPayment, adminUser } = useStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'receipt' | 'awaiting' | 'approved' | 'rejected' | 'all'>('receipt');
  const [preview, setPreview] = useState<Order | null>(null);

  const bankOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((order) => order.payment_method === 'Bank Payment')
      .filter((order) => {
        const status = order.payment_verification_status || 'Needs Review';
        if (filter === 'receipt' && (!order.bank_receipt_url || status === 'Approved' || status === 'Rejected')) return false;
        if (filter === 'awaiting' && (order.bank_receipt_url || status === 'Approved' || status === 'Rejected')) return false;
        if (filter === 'approved' && status !== 'Approved') return false;
        if (filter === 'rejected' && status !== 'Rejected') return false;
        if (!q) return true;
        return [order.order_number, order.customer_name, order.phone, order.payment_reference, order.payment_detected_bank]
          .some((value) => String(value || '').toLowerCase().includes(q));
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [orders, query, filter]);

  const receiptCheckCount = orders.filter((o) => o.payment_method === 'Bank Payment' && Boolean(o.bank_receipt_url) && o.payment_verification_status !== 'Approved' && o.payment_verification_status !== 'Rejected').length;
  const awaitingReceiptCount = orders.filter((o) => o.payment_method === 'Bank Payment' && !o.bank_receipt_url && o.payment_verification_status !== 'Approved' && o.payment_verification_status !== 'Rejected').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-white">
            <WalletCards className="h-5 w-5 text-orange-400" />
            <h2 className="text-base font-black">Bank Transfer Check</h2>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">Receipt OCR is only a helper. Approve only after you confirm the money actually arrived in the bank account.</p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center">
            <div className="text-[10px] font-bold uppercase text-amber-300">Receipts to Check</div>
            <div className="text-xl font-black text-white">{receiptCheckCount}</div>
          </div>
          <div className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-center">
            <div className="text-[10px] font-bold uppercase text-neutral-400">Awaiting Receipt</div>
            <div className="text-xl font-black text-white">{awaitingReceiptCount}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-3 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2">
          <Search className="h-4 w-4 text-neutral-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Order ID, customer, phone, reference..." className="w-full bg-transparent text-xs text-white outline-none" />
        </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-bold text-white outline-none">
          <option value="receipt">Receipt to Check</option>
          <option value="awaiting">Awaiting Receipt</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All Bank Transfers</option>
        </select>
      </div>

      {bankOrders.length === 0 ? (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center text-xs text-neutral-500">No bank transfers in this view.</div>
      ) : (
        <div className="space-y-3">
          {bankOrders.map((order) => {
            const expectedAmount = order.is_advance_required ? order.advance_amount : order.total_amount;
            const status = order.payment_verification_status || 'Needs Review';
            const canReview = Boolean(order.bank_receipt_url) && status !== 'Approved' && status !== 'Rejected';
            return (
              <div key={order.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex flex-col gap-4 lg:flex-row">
                  <button type="button" onClick={() => order.bank_receipt_url && setPreview(order)} className="h-32 w-full shrink-0 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 lg:w-36">
                    {order.bank_receipt_url ? <img src={order.bank_receipt_url} alt="Bank receipt" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-neutral-600">No receipt</div>}
                  </button>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-black text-white">{order.order_number}</span>
                          <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${statusClass(status)}`}>{status}</span>
                        </div>
                        <p className="mt-1 text-xs text-neutral-300">{order.customer_name} • {order.phone}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase text-neutral-500">Expected Transfer</p>
                        <p className="text-lg font-black text-orange-400">Rs. {expectedAmount.toLocaleString()}</p>
                        <p className="text-[10px] text-neutral-500">{order.is_advance_required ? 'Advance payment' : 'Full payment'}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {matchBadge('Account', order.payment_account_match)}
                      {matchBadge('Amount', order.payment_amount_match)}
                      <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-black ${order.payment_receipt_like ? 'bg-blue-500/10 border-blue-500/30 text-blue-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>OCR pre-check: {order.payment_receipt_like ? 'RECEIPT-LIKE' : 'UNCLEAR'}</span>
                    </div>

                    <div className="grid gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[11px] text-neutral-300 sm:grid-cols-2 lg:grid-cols-5">
                      <div><span className="text-neutral-500">Detected amount</span><div className="font-bold text-white">{order.payment_detected_amount ? `Rs. ${order.payment_detected_amount.toLocaleString()}` : 'Not detected'}</div></div><div><span className="text-neutral-500">Confirmed bank credit</span><div className="font-bold text-white">{order.payment_received_amount ? `Rs. ${order.payment_received_amount.toLocaleString()}` : 'Not approved yet'}</div></div>
                      <div><span className="text-neutral-500">Bank/App</span><div className="font-bold text-white">{order.payment_detected_bank || 'Not detected'}</div></div>
                      <div><span className="text-neutral-500">Reference</span><div className="break-all font-mono font-bold text-white">{order.payment_reference || 'Not detected'}</div></div>
                      <div><span className="text-neutral-500">OCR confidence</span><div className="font-bold text-white">{Number.isFinite(order.payment_ocr_confidence) ? `${Math.round(Number(order.payment_ocr_confidence))}%` : 'N/A'}</div></div>
                    </div>

                    {order.payment_check_notes && <p className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[10px] leading-relaxed text-neutral-400">{order.payment_check_notes}</p>}

                    <div className="flex flex-wrap gap-2">
                      {order.bank_receipt_url && <button type="button" onClick={() => setPreview(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-[10px] font-black text-white"><Eye className="h-3.5 w-3.5" />View Receipt</button>}
                      {canReview && <button type="button" onClick={() => {
                        const raw = window.prompt(`Enter the amount ACTUALLY received in the bank for ${order.order_number}:`, String(expectedAmount));
                        if (raw === null) return;
                        const actual = Number(String(raw).replace(/,/g, '').trim());
                        if (!Number.isFinite(actual) || actual <= 0) return alert('Enter a valid received amount.');
                        if (window.confirm(`Confirm bank credit of Rs. ${actual.toLocaleString()} for ${order.order_number}?`)) reviewPayment(order.id, 'approve', adminUser?.name, actual);
                      }} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-[10px] font-black text-neutral-950"><CheckCircle2 className="h-3.5 w-3.5" />Money Received — Approve</button>}
                      {order.bank_receipt_url && status !== 'Rejected' && <button type="button" onClick={() => { if (window.confirm(`Reject payment proof for ${order.order_number}?`)) reviewPayment(order.id, 'reject', adminUser?.name); }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10px] font-black text-red-300"><XCircle className="h-3.5 w-3.5" />Reject / New Receipt</button>}
                    </div>

                    {status !== 'Approved' && <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] text-amber-200"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{order.bank_receipt_url ? 'Receipt received. OCR is only a pre-check. Confirm the actual bank credit before approving. This order stays out of Google Sheet / fulfilment until approval.' : 'Customer has not submitted a receipt yet. Keep this order in Awaiting Receipt; there is nothing to approve until a receipt is received.'}</span></div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview?.bank_receipt_url && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4" onClick={() => setPreview(null)}>
          <button type="button" onClick={() => setPreview(null)} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"><X className="h-5 w-5" /></button>
          <img onClick={(e) => e.stopPropagation()} src={preview.bank_receipt_url} alt="Payment receipt full view" className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
};
