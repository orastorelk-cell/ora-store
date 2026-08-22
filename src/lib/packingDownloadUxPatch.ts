export const packingDownloadUxPatch = () => ({
  name: 'ora-packing-download-ux-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    let text = code;

    const stateMarker = "  const [packingFilter, setPackingFilter] = useState<'pending'|'today'|'downloaded'|'all'>('pending');";
    if (!text.includes('const [packingDownloadBusy, setPackingDownloadBusy]')) {
      if (!text.includes(stateMarker)) throw new Error('[O-RA packing download UX] state marker not found');
      text = text.replace(stateMarker, stateMarker + "\n  const [packingDownloadBusy, setPackingDownloadBusy] = useState<string>('');");
    }

    const wrap = (name: string, key: string, oldBody: string, newBody: string) => {
      if (text.includes(newBody)) return;
      if (!text.includes(oldBody)) throw new Error(`[O-RA packing download UX] ${name} marker not found`);
      text = text.replace(oldBody, newBody);
    };

    wrap('A6', 'a6',
`              const downloadSingleA6 = async () => {
                if(!singlePageOrders.length) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                try { await generateBatchInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A6-Singles.pdf\`); }
                catch(e:any){ alert(e.message || 'A6 invoice download failed.'); return; }
                await savePackingDownloaded(singlePageOrders,setDate,setNumber);
              };`,
`              const downloadSingleA6 = async () => {
                if(!singlePageOrders.length || packingDownloadBusy) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                setPackingDownloadBusy('a6');
                try {
                  await generateBatchInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A6-Singles.pdf\`);
                  await savePackingDownloaded(singlePageOrders,setDate,setNumber);
                } catch(e:any){ alert(e.message || 'A6 invoice download failed.'); }
                finally { setPackingDownloadBusy(''); }
              };`);

    wrap('A4', 'a4',
`              const downloadSingleA4 = async () => {
                if(!singlePageOrders.length) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                try { await generateA4FourUpInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A4-4-Up.pdf\`); }
                catch(e:any){ alert(e.message || 'A4 4-up invoice download failed.'); return; }
                await savePackingDownloaded(singlePageOrders,setDate,setNumber);
              };`,
`              const downloadSingleA4 = async () => {
                if(!singlePageOrders.length || packingDownloadBusy) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                setPackingDownloadBusy('a4');
                try {
                  await generateA4FourUpInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A4-4-Up.pdf\`);
                  await savePackingDownloaded(singlePageOrders,setDate,setNumber);
                } catch(e:any){ alert(e.message || 'A4 4-up invoice download failed.'); }
                finally { setPackingDownloadBusy(''); }
              };`);

    const a6Button = `{singleDownloaded?'A6 Singles Again':\`A6 Singles (${'${singlePageOrders.length}'})\`}`;
    if (text.includes(a6Button)) {
      text = text.replace(a6Button, `{packingDownloadBusy==='a6'?'Preparing PDF…':singleDownloaded?'A6 Singles Again':\`A6 Singles (${'${singlePageOrders.length}'})\`}`);
    }
    const a4Button = `{singleDownloaded?'A4 4-Up Again':\`A4 4-Up (${'${singlePageOrders.length}'})\`}`;
    if (text.includes(a4Button)) {
      text = text.replace(a4Button, `{packingDownloadBusy==='a4'?'Preparing PDF…':singleDownloaded?'A4 4-Up Again':\`A4 4-Up (${'${singlePageOrders.length}'})\`}`);
    }

    // Disable every packing-download action while one PDF is rendering. This gives
    // immediate visual feedback and prevents accidental double-generation.
    text = text.replace(/data-ora-action="packing_download" type="button" onClick=\{([^}]+)\}/g,
      'data-ora-action="packing_download" type="button" disabled={Boolean(packingDownloadBusy)} onClick={$1}');

    return text === code ? null : { code: text, map: null };
  },
});
