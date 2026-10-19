import { transientStaffFailure } from './confirmCsvSave';
import { invoiceDownloadBatches, invoiceDownloadRequest, saveInvoiceDownloadRequest, type InvoiceDownloadRequest } from './invoiceDownloadStatus';

type State = { message: string; pending: number; busy: boolean; canRetry: boolean };
type Options = {
  storage: Storage;
  user: string;
  request: (url: string, options?: RequestInit) => Promise<any>;
  onSaved: (orders: Record<string, any>[]) => void;
  onState: (state: State) => void;
  pause?: (ms: number) => Promise<void>;
};

// Persist each receipt separately so another tab cannot replace this tab's
// pending downloads. Only a verified server receipt removes its exact event.
export const createInvoiceDownloadQueue = ({ storage, user, request, onSaved, onState, pause }: Options) => {
  const prefix = 'ora_invoice_download_pending_v1:' + encodeURIComponent(user) + ':';
  const queued = new Map<string, InvoiceDownloadRequest>(), durable = new Set<string>(), acknowledged = new Set<string>();
  const errors = new Map<string, { message: string; manual: boolean }>();
  let active = true, inFlight: Promise<void> | null = null, storageProblem = false, invalidRecord = false, hadWork = false;
  const collect = () => {
    invalidRecord = false;
    try {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix) || acknowledged.has(key)) continue;
        let raw: any;
        try { raw = JSON.parse(storage.getItem(key) || 'null'); } catch { invalidRecord = true; continue; }
        // Recovery must never invent a new time or staff name for an old event.
        const body = raw?.downloadedAt && typeof raw.downloadedBy === 'string' ? invoiceDownloadRequest(raw) : null;
        if (!body) { invalidRecord = true; continue; }
        if (!queued.has(key)) queued.set(key, body);
        durable.add(key); hadWork = true;
      }
      for (const [key, body] of queued) if (!durable.has(key)) {
        storage.setItem(key, JSON.stringify(body)); durable.add(key);
      }
      storageProblem = false;
    } catch { storageProblem = true; }
  };
  const publish = (busy: boolean) => {
    if (!active) return;
    const pending = new Set([...queued.values()].flatMap(body => body.orderIds)).size;
    let message = '';
    if (pending) {
      message = `PDF downloaded; ${busy ? 'saving' : 'download status is pending for'} ${pending} invoice(s).`;
      if (!busy) message += [...errors.values()].some(error => error.manual)
        ? ' Review the save error and use Retry Status Save.' : ' It will retry automatically; you can also use Retry Status Save.';
      if (!busy && errors.size) message += ' ' + [...errors.values()][0].message;
      if (storageProblem || [...queued.keys()].some(key => !durable.has(key))) message += ' Keep this tab open: browser recovery storage is unavailable.';
    } else if (invalidRecord) message = 'A saved invoice download record could not be verified. Keep this tab open and review its download status.';
    else if (hadWork) message = 'Invoice download status saved.';
    onState({ message, pending, busy, canRetry: pending > 0 && !busy });
  };
  const flush = (manual = false): Promise<void> => {
    if (inFlight) return inFlight;
    if (!active) return Promise.resolve();
    if (manual) errors.clear();
    inFlight = (async () => {
      collect();
      while (active) {
        const entry = [...queued].find(([key]) => !errors.get(key)?.manual);
        if (!entry) break;
        const [key, body] = entry;
        publish(true);
        try {
          const orders = await saveInvoiceDownloadRequest(body, async (url, options) => {
            if (!active) { const error: any = new Error('Sign in again to resume the saved download status.'); error.status = 401; throw error; }
            return request(url, options);
          }, pause);
          // Even when sign-out happens in flight, retain the confirmed receipt
          // for this user without replacing the next user's order list.
          acknowledged.add(key); queued.delete(key); durable.delete(key); errors.delete(key);
          try { storage.removeItem(key); } catch { /* A later replay is idempotent. */ }
          if (active) onSaved(orders);
        } catch (error: any) {
          const retryable = transientStaffFailure(error) || Number(error?.status) === 409;
          errors.set(key, { message: String(error?.message || 'The save was not confirmed.'), manual: !retryable });
          if (retryable) break;
        }
        if (active) collect();
      }
    })().finally(() => { inFlight = null; publish(false); });
    return inFlight;
  };
  return {
    enqueue(ids: string[], downloadedBy: string, downloadSet?: InvoiceDownloadRequest['downloadSet'], invoices?: InvoiceDownloadRequest['invoices']) {
      if (!active) throw new Error('Sign in again before saving invoice download status.');
      // Validate all groups before recording any part of the download.
      const batches = invoiceDownloadBatches(ids, downloadedBy, downloadSet, invoices);
      for (const body of batches) queued.set(prefix + crypto.randomUUID(), body);
      hadWork ||= batches.length > 0;
      collect(); publish(false);
      void flush();
    },
    flush,
    pendingSets() { return [...queued.values()].filter(body=>body.downloadSet).map(body=>({...body.downloadSet!,orderIds:body.orderIds})); },
    dispose() { active = false; },
  };
};
