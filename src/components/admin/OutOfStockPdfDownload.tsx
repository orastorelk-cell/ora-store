import { useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { snapshotOutOfStockNeeds, type OutOfStockNeedRow } from '../../lib/outOfStockReport';

export function OutOfStockPdfDownload({ rows }: { rows: readonly OutOfStockNeedRow[] }) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');

  const download = async () => {
    if (active.current || !rows.length) return;
    const items = snapshotOutOfStockNeeds(rows);
    const generatedAt = new Date();
    active.current = true;
    setBusy(true);
    setMessage('');
    setProgress('Preparing PDF...');
    try {
      const { downloadOutOfStockPdf } = await import('../../lib/outOfStockPdf');
      const result = await downloadOutOfStockPdf(items, {
        generatedAt,
        onProgress: (done, total) => setProgress(`Photos ${done} / ${total}`),
      });
      setMessage(result.missingImages
        ? `PDF downloaded. ${result.missingImages} item photo(s) could not load; their details are included.`
        : 'PDF downloaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the PDF. Please try again.');
    } finally {
      active.current = false;
      setBusy(false);
      setProgress('');
    }
  };

  return <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
    <button type="button" onClick={download} disabled={busy || !rows.length}
      title="Download item photos, waiting quantities, Order IDs and saved shop references"
      className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-black text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {busy ? progress : 'Download PDF'}
    </button>
    {message && <p role="status" className="max-w-sm text-xs text-neutral-300">{message}</p>}
  </div>;
}
