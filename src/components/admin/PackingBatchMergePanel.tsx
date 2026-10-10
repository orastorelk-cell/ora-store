import { useRef, useState } from 'react';
import { useStore } from '../../context/StoreContext';
import { packingMergeEligible } from '../../lib/packingBatchMerge';
import { confirmCsvRequestWithRetry } from '../../lib/confirmCsvSave';
import { staffJsonRequest } from '../../lib/staffRequest';

export default function PackingBatchMergePanel() {
  const { orders, adminUser, refreshOrdersFromServer } = useStore();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const operation = useRef<any>(null);
  const groups = new Map<string, typeof orders>();
  orders.forEach(order => {
    const id = String(order.invoice_pack_batch_id || '');
    if (id.startsWith('PACK-RESTOCK-')) groups.set(id, [...(groups.get(id) || []), order]);
  });
  const eligible = [...groups].filter(([, batch]) => batch.every(packingMergeEligible));
  const selected = eligible.flatMap(([, batch]) => batch);
  if (adminUser?.role !== 'admin' || (eligible.length < 2 && !message)) return null;
  const merge = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const body = operation.current || {
        batch_ids: eligible.map(([id]) => id), order_ids: selected.map(order => order.id),
        target_batch_id: 'PACK-RESTOCK-MERGED-' + new Date().toISOString().replace(/[^0-9]/g, '')
      };
      operation.current = body;
      const data = await confirmCsvRequestWithRetry(async (url, options) => {
        const headers = new Headers(options?.headers);
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', 'Bearer ' + (localStorage.getItem('ora_staff_session_token') || ''));
        const result = await staffJsonRequest(url, { ...options, headers });
        if (result.ok !== true || result.batch_id !== body.target_batch_id ||
          !Array.isArray(result.orders) || result.orders.length !== body.order_ids.length ||
          new Set(result.orders.map((order: any) => order.id)).size !== body.order_ids.length ||
          result.orders.some((order: any) => !body.order_ids.includes(order.id) || order.invoice_pack_batch_id !== body.target_batch_id)) {
          const error: any = new Error('The merged batch was not fully acknowledged. Retry the saved merge.'); error.status = 503; throw error;
        }
        return result;
      }, '/api/orders/invoices/merge-batches', { method: 'POST', body: JSON.stringify(body) });
      // Obtain a fresh snapshot even if an older poll was already in flight.
      await refreshOrdersFromServer(true);
      operation.current = null;
      setMessage(data.orders.length + ' invoices merged into ' + data.batch_id + '. Download its invoice PDF and Fardar CSV below.');
    } catch (error: any) {
      if (error?.status === 400 || error?.status === 409) operation.current = null;
      setMessage(error?.message || 'Merge did not finish. Retry the saved merge.');
    } finally { setBusy(false); }
  };
  return <div data-ora-view-allowed="true" className="rounded-2xl border border-orange-500/40 bg-neutral-900 p-5">
    <h3 className="font-black text-white">Merge Undownloaded Restock Batches</h3>
    <p className="mt-2 text-xs text-neutral-300">{eligible.length} batches • {selected.length} invoices. Save them as one batch for a single invoice PDF and Fardar CSV.</p>
    <p className="mt-1 text-xs text-neutral-400">Existing invoice numbers, waybills and amounts are preserved.</p>
    <button type="button" onClick={merge} disabled={busy || (!operation.current && eligible.length < 2) || selected.length > 200}
      className="mt-3 rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-neutral-950 disabled:opacity-40">
      {busy ? 'Merging Batches…' : operation.current ? 'Retry Saved Merge' : 'Merge All Undownloaded Restock Batches'}
    </button>
    {selected.length > 200 && <p className="mt-2 text-xs text-amber-300">Maximum 200 invoices per merged batch.</p>}
    {message && <p role="status" className="mt-3 break-words text-xs text-orange-200">{message}</p>}
  </div>;
}
