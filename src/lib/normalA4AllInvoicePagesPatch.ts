const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA normal A4 all pages] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Normal Packing A4 4-Up must print invoice PAGES, not only one-page orders.
 * A 5-item order creates two A6 invoice pages; both pages must occupy A4 slots.
 * This keeps the existing Invoice V6 renderer/layout unchanged.
 */
export const normalA4AllInvoicePagesPatch = () => ({
  name: 'ora-normal-a4-all-invoice-pages-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      const oldStart = `export async function generateA4FourUpInvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {\n  const singles=orders.filter(o=>getInvoicePageCount(o)===1).slice(0,200);\n  if(!singles.length) throw new Error('No single-page A6 invoices are available for A4 4-up printing.');`;
      const newStart = `export async function generateA4FourUpInvoicesPDF(orders: Order[], settings: StoreSettings = {} as StoreSettings, fileName?: string) {\n  const invoicePages=orders.slice(0,200).flatMap(order=>{\n    const pages=splitInvoiceItems(order);\n    return pages.map((pageItems,pageIndex)=>({order,pageItems,pageIndex,totalPages:pages.length}));\n  });\n  const singles=invoicePages.map(page=>page.order);\n  if(!singles.length) throw new Error('No invoice pages are available for A4 4-up printing.');`;
      text = replaceRequired(text, oldStart, newStart, 'A4 page source');

      const oldOrder = `    const order=singles[i];`;
      const newOrder = `    const page=invoicePages[i];\n    const order=page.order;`;
      text = replaceRequired(text, oldOrder, newOrder, 'A4 page selection');

      const oldRender = `      const svg=await buildInvoiceSvg(order,settings,order.items || [],0,1);`;
      const newRender = `      const svg=await buildInvoiceSvg(order,settings,page.pageItems,page.pageIndex,page.totalPages);`;
      text = replaceRequired(text, oldRender, newRender, 'A4 page render');

      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const oldFn = `              const downloadSingleA4 = async () => {\n                if(!singlePageOrders.length || packingDownloadBusy) return;\n                const {setDate,setNumber,stem}=resolveDownloadSet();\n                setPackingDownloadBusy('a4');\n                try {\n                  await generateA4FourUpInvoicesPDF(singlePageOrders,settings,\`${'${stem}'}_A4-4-Up.pdf\`);\n                  await savePackingDownloaded(singlePageOrders,setDate,setNumber);\n                } catch(e:any){ alert(e.message || 'A4 4-up invoice download failed.'); }\n                finally { setPackingDownloadBusy(''); }\n              };`;
      const newFn = `              const downloadSingleA4 = async () => {\n                if(!batchOrders.length || packingDownloadBusy) return;\n                const {setDate,setNumber,stem}=resolveDownloadSet();\n                setPackingDownloadBusy('a4');\n                try {\n                  await generateA4FourUpInvoicesPDF(batchOrders,settings,\`${'${stem}'}_A4-4-Up.pdf\`);\n                  await savePackingDownloaded(batchOrders,setDate,setNumber);\n                } catch(e:any){ alert(e.message || 'A4 4-up invoice download failed.'); }\n                finally { setPackingDownloadBusy(''); }\n              };`;
      text = replaceRequired(text, oldFn, newFn, 'normal A4 download function');

      // Keep A6 Singles as a singles-only action, but always expose A4 for the batch.
      // If a batch has only multi-page orders the A6 button is harmlessly disabled.
      const oldActionsOpen = `                      {singlePageOrders.length>0 && <>\n                        <button data-ora-action=\"packing_download\" type=\"button\" disabled={Boolean(packingDownloadBusy)} onClick={downloadSingleA6}`;
      const newActionsOpen = `                      {<>\n                        <button data-ora-action=\"packing_download\" type=\"button\" disabled={Boolean(packingDownloadBusy) || !singlePageOrders.length} onClick={downloadSingleA6}`;
      text = replaceRequired(text, oldActionsOpen, newActionsOpen, 'A4 action visibility');

      const oldA4Label = `{packingDownloadBusy==='a4'?'Preparing PDF…':singleDownloaded?'A4 4-Up Again':\`A4 • 4 per Page (${'${singlePageOrders.length}'})\`}`;
      const newA4Label = `{packingDownloadBusy==='a4'?'Preparing PDF…':downloaded?'A4 4-Up Again':\`A4 • 4 per Page (${'${batchOrders.reduce((sum,o)=>sum+getInvoicePageCount(o),0)}'} pages)\`}`;
      if (text.includes(oldA4Label)) text = text.replace(oldA4Label, newA4Label);

      return { code: text, map: null };
    }

    return null;
  },
});
