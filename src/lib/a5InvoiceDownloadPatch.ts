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

      const addition = "export async function generateA5SingleInvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {\n  const batch=orders.slice(0,200);\n  if(!batch.length) throw new Error('No invoices are available for A5 printing.');\n\n  const invalid=batch.filter(o=>validateInvoiceOrder(o).length>0);\n  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);\n  assertInvoiceConfirmSnapshot(batch);\n\n  // Reuse the exact current invoice SVG. Only the physical paper size changes.\n  // The artwork is scaled proportionally, never stretched or redesigned.\n  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a5',compress:true});\n  const invoiceHeight=148;\n  const invoiceWidth=invoiceHeight*(148/105);\n  const x=(210-invoiceWidth)/2;\n  let renderedPages=0;\n\n  for(const order of batch){\n    const itemPages=splitInvoiceItems(order);\n    for(let pageIndex=0;pageIndex<itemPages.length;pageIndex++){\n      if(renderedPages>0) doc.addPage('a5','landscape');\n      try {\n        const svg=await buildInvoiceSvg(order,settings,itemPages[pageIndex],pageIndex,itemPages.length);\n        const pngBytes=await svgToBrowserPngBytes(svg);\n        doc.addImage(pngBytes,'PNG',x,0,invoiceWidth,invoiceHeight,undefined,'FAST');\n      } catch (e:any) {\n        throw new Error(`${order.order_number}: ${e?.message || 'Invoice render failed'}`);\n      }\n      renderedPages++;\n    }\n  }\n\n  downloadPdfBlob(doc, fileName || `O-RA_A5_Invoices_${batch.length}_${Date.now()}.pdf`);\n}\n\nexport async function generateA4TwoUpA5InvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {\n  const batch=orders.slice(0,200);\n  if(!batch.length) throw new Error('No invoices are available for A4 2 x A5 printing.');\n\n  const invalid=batch.filter(o=>validateInvoiceOrder(o).length>0);\n  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);\n  assertInvoiceConfirmSnapshot(batch);\n\n  // A4 portrait = 210 x 297 mm. Two A5 landscape invoice pages stack vertically.\n  // Every page reuses the exact current invoice SVG and keeps its original aspect ratio.\n  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});\n  const slotHeight=148.5;\n  const invoiceHeight=148;\n  const invoiceWidth=invoiceHeight*(148/105);\n  const x=(210-invoiceWidth)/2;\n  let renderedPages=0;\n\n  const addCutGuides=()=>{\n    const centreY=148.5;\n    const mark=6;\n    doc.setDrawColor(120,120,120);\n    doc.setLineWidth(0.18);\n    doc.line(0,centreY,mark,centreY);\n    doc.line(210-mark,centreY,210,centreY);\n  };\n\n  for(const order of batch){\n    const itemPages=splitInvoiceItems(order);\n    for(let pageIndex=0;pageIndex<itemPages.length;pageIndex++){\n      if(renderedPages>0 && renderedPages%2===0){\n        addCutGuides();\n        doc.addPage('a4','portrait');\n      }\n\n      const slot=renderedPages%2;\n      const y=slot*slotHeight+0.25;\n      try {\n        const svg=await buildInvoiceSvg(order,settings,itemPages[pageIndex],pageIndex,itemPages.length);\n        const pngBytes=await svgToBrowserPngBytes(svg);\n        doc.addImage(pngBytes,'PNG',x,y,invoiceWidth,invoiceHeight,undefined,'FAST');\n      } catch (e:any) {\n        throw new Error(`${order.order_number}: ${e?.message || 'Invoice render failed'}`);\n      }\n      renderedPages++;\n    }\n  }\n\n  addCutGuides();\n  downloadPdfBlob(doc, fileName || `O-RA_A4_2xA5_Invoices_${batch.length}_${Date.now()}.pdf`);\n}\n\n";

      text = replaceRequired(text, marker, addition + marker, 'PDF function insertion');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const importOld = "import { generateOrderInvoicePDF, generateRepairedOrderInvoicePDF, generateRepairedOrderInvoicePDFFromCsv, generateRepairedBatchInvoicesPDFFromCsv, generateRepairedA4FourUpInvoicesPDFFromCsv, generateRepairedMultiPageInvoicesPDFFromCsv, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';";
      const importNew = "import { generateOrderInvoicePDF, generateRepairedOrderInvoicePDF, generateRepairedOrderInvoicePDFFromCsv, generateRepairedBatchInvoicesPDFFromCsv, generateRepairedA4FourUpInvoicesPDFFromCsv, generateRepairedMultiPageInvoicesPDFFromCsv, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, generateA5SingleInvoicesPDF, generateA4TwoUpA5InvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';";
      text = replaceRequired(text, importOld, importNew, 'Admin PDF import');

      if (!text.includes('const downloadBatchA5 = async () =>')) {
        const functionMarker = `              const downloadMultiPage = async () => {`;
        const functions = "              const downloadBatchA5 = async () => {\n                if(!batchOrders.length || packingDownloadBusy) return;\n                const {setDate,setNumber,stem}=resolveDownloadSet();\n                setPackingDownloadBusy('a5');\n                try {\n                  await generateA5SingleInvoicesPDF(batchOrders,settings,`${stem}_A5.pdf`);\n                  await savePackingDownloaded(batchOrders,setDate,setNumber);\n                } catch(e:any){ alert(e.message || 'A5 invoice download failed.'); }\n                finally { setPackingDownloadBusy(''); }\n              };\n\n              const downloadBatchA4TwoUp = async () => {\n                if(!batchOrders.length || packingDownloadBusy) return;\n                const {setDate,setNumber,stem}=resolveDownloadSet();\n                setPackingDownloadBusy('a4-a5x2');\n                try {\n                  await generateA4TwoUpA5InvoicesPDF(batchOrders,settings,`${stem}_A4-2xA5.pdf`);\n                  await savePackingDownloaded(batchOrders,setDate,setNumber);\n                } catch(e:any){ alert(e.message || 'A4 2 x A5 invoice download failed.'); }\n                finally { setPackingDownloadBusy(''); }\n              };\n\n";
        text = replaceRequired(text, functionMarker, functions + functionMarker, 'Packing A5 functions');
      }

      if (!text.includes('A5 • 1 per Page')) {
        const actionMarker = `                      {singlePageOrders.length>0 && <>`;
        const buttons = "                      <button data-ora-action=\"packing_download\" type=\"button\" disabled={Boolean(packingDownloadBusy)} onClick={downloadBatchA5}\n                        className={`rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2 ${downloaded?'bg-neutral-800 text-neutral-300':'bg-teal-500 text-black'}`}>\n                        <Download className=\"w-4 h-4\"/>\n                        {packingDownloadBusy==='a5'?'Preparing A5…':downloaded?'A5 Again':`A5 • 1 per Page (${batchOrders.length})`}\n                      </button>\n                      <button data-ora-action=\"packing_download\" type=\"button\" disabled={Boolean(packingDownloadBusy)} onClick={downloadBatchA4TwoUp}\n                        className={`rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2 ${downloaded?'bg-neutral-800 text-neutral-300':'bg-cyan-500 text-black'}`}>\n                        <Printer className=\"w-4 h-4\"/>\n                        {packingDownloadBusy==='a4-a5x2'?'Preparing A4 2×A5…':downloaded?'A4 2×A5 Again':`A4 • 2 × A5 (${batchOrders.length})`}\n                      </button>\n";
        text = replaceRequired(text, actionMarker, buttons + actionMarker, 'Packing A5 buttons');
      }

      const helpOld = 'Single-page orders can be printed as individual A6 pages or 4 invoices on one A4 sheet. Orders that need 2+ A6 pages stay separate for packing clarity.';
      const helpNew = 'Existing invoice layout stays unchanged. Download the same invoice as A6, A5, 4 × A6 on A4, or 2 × A5 on A4. Multi-page invoices keep the same page order.';
      if (text.includes(helpOld)) text = text.replace(helpOld, helpNew);

      const invoiceHistoryOld = "<td className=\"p-3\">{o.invoice_locked ? <button onClick={() => generateOrderInvoicePDF(o,settings)} className=\"px-2 py-1 rounded bg-blue-500/20 text-blue-300 font-bold\">Re-download</button> : <span className=\"text-neutral-500\">Not Generated</span>}</td>";
      const invoiceHistoryNew = "<td className=\"p-3\">{o.invoice_locked ? <div className=\"flex flex-wrap gap-1.5\"><button onClick={() => generateOrderInvoicePDF(o,settings)} className=\"px-2 py-1 rounded bg-blue-500/20 text-blue-300 font-bold\">Re-download</button><button onClick={() => generateA5SingleInvoicesPDF([o],settings,`O-RA_A5_${o.invoice_number || o.order_number}.pdf`)} className=\"px-2 py-1 rounded bg-teal-500/20 text-teal-300 font-bold\">A5 PDF</button></div> : <span className=\"text-neutral-500\">Not Generated</span>}</td>";
      if (!text.includes('>A5 PDF</button>')) {
        text = replaceRequired(text, invoiceHistoryOld, invoiceHistoryNew, 'Existing invoice A5 re-download button');
      }

      return text === code ? null : { code: text, map: null };
    }

    return null;
  },
});
