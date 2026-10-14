import React, { useState } from 'react';
import { useStore } from '../../context/StoreContext';
import { generateOrderInvoicePDF } from '../../lib/pdfGenerator';
import { downloadReturnBlob, returnPackingCsv } from '../../lib/returnExports';
import { returnSheetRequest } from './ReturnSheetsPanel';

export const OrderVariantCorrection: React.FC<{orderId: string}> = ({orderId}) => {
  const { settings, refreshReturnInventory, markFardarCsvExported, markInvoiceBatchDownloaded } = useStore();
  const [preview, setPreview] = useState<any>(null), [choices, setChoices] = useState<string[]>([]);
  const [reason, setReason] = useState('Correct customer-selected colors'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [saved, setSaved] = useState<any>(null), retryKey = 'ora_variant_correction_retry:' + orderId;
  const open = async () => {
    setBusy(true); setError('');
    try { const data = await returnSheetRequest('/api/orders/variant-correction?order_id=' + encodeURIComponent(orderId)); setPreview(data); setChoices(data.order.items.map((item: any) => item.variant_id)); }
    catch (error: any) { setError(error.message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const pending = localStorage.getItem(retryKey);
      const input = pending ? JSON.parse(pending) : { order_id: orderId, operation_id: crypto.randomUUID(), expected_identity: preview.expected_identity,
        waybill_number: preview.order.waybill_number, variant_ids: choices, reason: reason.trim() };
      localStorage.setItem(retryKey, JSON.stringify(input));
      const result = await returnSheetRequest('/api/orders/variant-correction', input);
      localStorage.removeItem(retryKey); setSaved(result); await refreshReturnInventory();
    } catch (error: any) { setError(error.message); if (error.status && error.status < 500 && error.status !== 429) localStorage.removeItem(retryKey); }
    finally { setBusy(false); }
  };
  return <div className="w-full rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-gray-900">
    {!preview && !saved && <button type="button" onClick={open} disabled={busy} className="font-bold text-blue-700 disabled:opacity-40">{busy ? 'Loading colors…' : 'Correct Invoiced Colors'}</button>}
    {preview && !saved && <div className="space-y-3">
      <b>{preview.order.order_number} • Invoice color correction</b>
      <p>Keep quantities and total Rs. {Number(preview.order.total_amount).toLocaleString()}. Create a corrected batch with the same invoice and waybill {preview.order.waybill_number}.</p>
      {preview.order.items.map((item: any, index: number) => <label key={index} className="block">Item {index + 1}: {item.product_name} × {item.quantity}
        <select aria-label={'Item ' + (index + 1) + ' color'} disabled={busy || Boolean(localStorage.getItem(retryKey))} value={choices[index]} onChange={event => setChoices(previous => previous.map((value, at) => at === index ? event.target.value : value))} className="mt-1 block w-full rounded-lg border border-blue-200 bg-white px-3 py-2">
          {preview.options[index].map((variant: any) => <option key={variant.id} value={variant.id}>{variant.name} • {variant.sku} • stock {variant.stock}</option>)}
        </select>
      </label>)}
      <label className="block">Correction reason<input aria-label="Color correction reason" value={reason} onChange={event => setReason(event.target.value)} disabled={busy} className="mt-1 block w-full rounded-lg border border-blue-200 bg-white px-3 py-2"/></label>
      <p>Stock will be adjusted by the difference between the old and selected colors.</p>
      <button type="button" disabled={busy || !reason.trim()} onClick={save} className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-40">{busy ? 'Saving…' : localStorage.getItem(retryKey) ? 'Retry Saved Color Correction' : 'Save Colors & Adjust Stock'}</button>
      {!busy && !localStorage.getItem(retryKey) && <button type="button" onClick={() => setPreview(null)} className="ml-3 font-bold">Close</button>}
    </div>}
    {saved && <div className="space-y-2">
      <b>Colors and stock saved • {saved.order.order_number}</b>
      <p>Waybill: {saved.order.waybill_number} • Invoice: {saved.order.invoice_number} • Total: Rs. {saved.order.total_amount.toLocaleString()}</p>
      <p>New batch: {saved.order.invoice_pack_batch_id}</p>
      {saved.order.items.map((item: any, index: number) => <p key={index}>{item.variant_name} × {item.quantity}</p>)}
      {saved.stock_history.map((row: any) => <p key={row.id}>{row.sku}: {row.previous_stock} → {row.new_stock}</p>)}
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await generateOrderInvoicePDF(saved.order, settings); await markInvoiceBatchDownloaded([saved.order.id]); } catch (error: any) { setError(error.message); } finally { setBusy(false); } }} className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-40">Download Corrected Invoice</button>
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try {
        await markFardarCsvExported([saved.order.id]);
        downloadReturnBlob(new Blob([returnPackingCsv([saved.order], settings)], {type: 'text/csv;charset=utf-8;'}), saved.order.order_number + '_Fardar_Corrected.csv');
      } catch (error: any) { setError(error.message); } finally { setBusy(false); } }} className="ml-2 rounded-lg bg-green-700 px-4 py-2 font-bold text-white disabled:opacity-40">Download Corrected Fardar CSV</button>
    </div>}
    {error && <p role="alert" className="mt-2 font-bold text-red-700">{error}</p>}
  </div>;
};
