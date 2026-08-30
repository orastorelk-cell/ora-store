const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA A5 invoice download] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Adds optional print-size outputs without changing the existing invoice layout:
 * - A5 Single: one unchanged invoice design, scaled proportionally onto one A5 landscape page.
 * - A4 2 x A5: two unchanged A5-sized invoices stacked on one A4 portrait sheet.
 *
 * Existing A6, A4 4-up, invoice data, stock, Sheet/Fardar, repair, and locking flows are untouched.
 */
export const a5InvoiceDownloadPatch = () => ({
  name: 'ora-a5-invoice-download-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      if (text.includes('export async function generateA5SingleInvoicesPDF')) return null;

      const marker = `export async function generateBatchInvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {`;

      const addition = String.raw`
export async function generateA5SingleInvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {
  const singles=orders.filter(o=>getInvoicePageCount(o)===1).slice(0,200);
  if(!singles.length) throw new Error('No single-page invoices are available for A5 printing.');

  const invalid=singles.filter(o=>validateInvoiceOrder(o).length>0);
  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);
  assertInvoiceConfirmSnapshot(singles);

  // Preserve the current A6 invoice artwork exactly: same SVG, same proportions.
  // Only the physical PDF page/print size changes.
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a5',compress:true});
  const invoiceHeight=148;
  const invoiceWidth=invoiceHeight*(148/105);
  const x=(210-invoiceWidth)/2;

  for(let i=0;i<singles.length;i++){
    if(i>0) doc.addPage('a5','landscape');
    const order=singles[i];
    try {
      const svg=await buildInvoiceSvg(order,settings,order.items || [],0,1);
      const pngBytes=await svgToBrowserPngBytes(svg);
      doc.addImage(pngBytes,'PNG',x,0,invoiceWidth,invoiceHeight,undefined,'FAST');
    } catch (e:any) {
      throw new Error(`${order.order_number}: ${e?.message || 'Invoice render failed'}`);
    }
  }

  downloadPdfBlob(doc, fileName || `O-RA_A5_Single_Invoices_${singles.length}_${Date.now()}.pdf`);
}

export async function generateA4TwoUpA5InvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {
  const singles=orders.filter(o=>getInvoicePageCount(o)===1).slice(0,200);
  if(!singles.length) throw new Error('No single-page invoices are available for A4 2 x A5 printing.');

  const invalid=singles.filter(o=>validateInvoiceOrder(o).length>0);
  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);
  assertInvoiceConfirmSnapshot(singles);

  // A4 portrait = 210 x 297 mm. Two A5 landscape slots stack vertically.
  // The invoice artwork keeps the exact existing 148:105 aspect ratio.
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  const slotHeight=148.5;
  const invoiceHeight=148;
  const invoiceWidth=invoiceHeight*(148/105);
  const x=(210-invoiceWidth)/2;

  const addCutGuides=()=>{
    const centreY=148.5;
    const mark=6;
    doc.setDrawColor(120,120,120);
    doc.setLineWidth(0.18);
    doc.line(0,centreY,mark,centreY);
    doc.line(210-mark,centreY,210,centreY);
  };

  for(let i=0;i<singles.length;i++){
    if(i>0 && i%2===0) {
      addCutGuides();
      doc.addPage('a4','portrait');
    }

    const order=singles[i];
    const slot=i%2;
    const y=slot*slotHeight+0.25;

    try {
      const svg=await buildInvoiceSvg(order,settings,order.items || [],0,1);
      const pngBytes=await svgToBrowserPngBytes(svg);
      doc.addImage(pngBytes,'PNG',x,y,invoiceWidth,invoiceHeight,undefined,'FAST');
    } catch (e:any) {
      throw new Error(`${order.order_number}: ${e?.message || 'Invoice render failed'}`);
    }
  }

  addCutGuides();
  downloadPdfBlob(doc, fileName || `O-RA_A4_2xA5_Invoices_${singles.length}_${Date.now()}.pdf`);
}

`;

      text = replaceRequired(text, marker, addition + marker, 'PDF function insertion');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const importOld = "import { generateOrderInvoicePDF, generateRepairedOrderInvoicePDF, generateRepairedOrderInvoicePDFFromCsv, generateRepairedBatchInvoicesPDFFromCsv, generateRepairedA4FourUpInvoicesPDFFromCsv, generateRepairedMultiPageInvoicesPDFFromCsv, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';";
      const importNew = "import { generateOrderInvoicePDF, generateRepairedOrderInvoicePDF, generateRepairedOrderInvoicePDFFromCsv, generateRepairedBatchInvoicesPDFFromCsv, generateRepairedA4FourUpInvoicesPDFFromCsv, generateRepairedMultiPageInvoicesPDFFromCsv, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, generateA5SingleInvoicesPDF, generateA4TwoUpA5InvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';";
      text = replaceRequired(text, importOld, importNew, 'Admin PDF import');

      if (!text.includes('const downloadSingleA5 = async () =>')) {
        const functionMarker = `              const downloadMultiPage = async () => {`;
        const functions = String.raw`              const downloadSingleA5 = async () => {
                if(!singlePageOrders.length || packingDownloadBusy) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                setPackingDownloadBusy('a5');
                try {
                  await generateA5SingleInvoicesPDF(singlePageOrders,settings,`${stem}_A5-Singles.pdf`);
                  await savePackingDownloaded(singlePageOrders,setDate,setNumber);
                } catch(e:any){ alert(e.message || 'A5 invoice download failed.'); }
                finally { setPackingDownloadBusy(''); }
              };

              const downloadSingleA4TwoUp = async () => {
                if(!singlePageOrders.length || packingDownloadBusy) return;
                const {setDate,setNumber,stem}=resolveDownloadSet();
                setPackingDownloadBusy('a4-a5x2');
                try {
                  await generateA4TwoUpA5InvoicesPDF(singlePageOrders,settings,`${stem}_A4-2xA5.pdf`);
                  await savePackingDownloaded(singlePageOrders,setDate,setNumber);
                } catch(e:any){ alert(e.message || 'A4 2 x A5 invoice download failed.'); }
                finally { setPackingDownloadBusy(''); }
              };

`;
        text = replaceRequired(text, functionMarker, functions + functionMarker, 'Packing A5 functions');
      }

      if (!text.includes('A4 • 2 × A5')) {
        const buttonMarker = String.raw`                          {singleDownloaded?'A4 4-Up Again':`A4 • 4 per Page (${singlePageOrders.length})`}
                        </button>
                      </>}`;
        const buttons = String.raw`                          {singleDownloaded?'A4 4-Up Again':`A4 • 4 per Page (${singlePageOrders.length})`}
                        </button>
                        <button data-ora-action="packing_download" type="button" disabled={Boolean(packingDownloadBusy)} onClick={downloadSingleA5}
                          className={`rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2 ${singleDownloaded?'bg-neutral-800 text-neutral-300':'bg-teal-500 text-black'}`}>
                          <Download className="w-4 h-4"/>
                          {packingDownloadBusy==='a5'?'Preparing A5…':singleDownloaded?'A5 Singles Again':`A5 Singles (${singlePageOrders.length})`}
                        </button>
                        <button data-ora-action="packing_download" type="button" disabled={Boolean(packingDownloadBusy)} onClick={downloadSingleA4TwoUp}
                          className={`rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2 ${singleDownloaded?'bg-neutral-800 text-neutral-300':'bg-cyan-500 text-black'}`}>
                          <Printer className="w-4 h-4"/>
                          {packingDownloadBusy==='a4-a5x2'?'Preparing A4 2×A5…':singleDownloaded?'A4 2×A5 Again':`A4 • 2 × A5 (${singlePageOrders.length})`}
                        </button>
                      </>}`;
        text = replaceRequired(text, buttonMarker, buttons, 'Packing A5 buttons');
      }

      const helpOld = 'Single-page orders can be printed as individual A6 pages or 4 invoices on one A4 sheet. Orders that need 2+ A6 pages stay separate for packing clarity.';
      const helpNew = 'Single-page orders can be printed as A6, A5, 4 × A6 on A4, or 2 × A5 on A4. The invoice design/content stays unchanged; only print size changes. Orders that need 2+ pages stay separate for packing clarity.';
      if (text.includes(helpOld)) text = text.replace(helpOld, helpNew);

      return text === code ? null : { code: text, map: null };
    }

    return null;
  },
});
