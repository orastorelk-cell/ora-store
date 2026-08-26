const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA repair A4 CSV] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Repair A4 is intentionally SINGLE-PAGE only.
 * Multi-page orders stay in their own multi-page/A6 PDF so page 1/2, 2/2, etc.
 * never get mixed with unrelated single-page packing invoices.
 * Invoice V6 layout itself is not changed.
 */
export const repairA4FourUpCsvPatch = () => ({
  name: 'ora-repair-a4-four-up-csv-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      if (!text.includes('export async function generateRepairedA4FourUpInvoicesPDFFromCsv')) {
        const marker = `export async function generateRepairedBatchInvoicesPDFFromCsv(orders:Order[], settings:StoreSettings = {} as StoreSettings, csvText='', fileName?:string) {\n  if(!orders.length) throw new Error('No invoices are available in this packing batch.');\n  if(orders.length>120) throw new Error('Repair batch is over 120 orders. Repair it in separate packing parts.');\n  const repaired:Order[]=[];\n  for(const order of orders){\n    const snapshot=repairSnapshotFromCsv(order,csvText);\n    repaired.push(await buildRepairedInvoiceOrder({...(order as any),invoice_confirm_snapshot:snapshot} as Order,settings));\n  }\n  await generateBatchInvoicesPDF(repaired,settings,fileName || ('O-RA_REPAIRED_BATCH_'+Date.now()+'.pdf'));\n}\n`;
        const addition = marker + `\nexport async function generateRepairedA4FourUpInvoicesPDFFromCsv(orders:Order[], settings:StoreSettings = {} as StoreSettings, csvText='', fileName?:string) {\n  if(!orders.length) throw new Error('No invoices are available in this packing batch.');\n  const repaired:Order[]=[];\n  for(const order of orders){\n    const snapshot=repairSnapshotFromCsv(order,csvText);\n    repaired.push(await buildRepairedInvoiceOrder({...(order as any),invoice_confirm_snapshot:snapshot} as Order,settings));\n  }\n  const singlePage=repaired.filter(order=>getInvoicePageCount(order)===1);\n  if(!singlePage.length) throw new Error('This repaired batch has no single-page invoices for A4 4-up printing. Use the multi-page/Repair ALL download for multi-page orders.');\n  await generateA4FourUpInvoicesPDF(singlePage,settings,fileName || ('O-RA_REPAIRED_A4_4-UP_'+Date.now()+'.pdf'));\n}\n`;
        text = replaceRequired(text, marker, addition, 'repaired batch PDF function');
      }
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const importOld = "import { generateOrderInvoicePDF, generateRepairedOrderInvoicePDF, generateRepairedOrderInvoicePDFFromCsv, generateRepairedBatchInvoicesPDFFromCsv, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';";
      const importNew = "import { generateOrderInvoicePDF, generateRepairedOrderInvoicePDF, generateRepairedOrderInvoicePDFFromCsv, generateRepairedBatchInvoicesPDFFromCsv, generateRepairedA4FourUpInvoicesPDFFromCsv, generateBatchInvoicesPDF, generateA4FourUpInvoicesPDF, getInvoicePageCount, validateInvoiceOrder } from '../../lib/pdfGenerator';";
      text = replaceRequired(text, importOld, importNew, 'Admin PDF import');

      if (!text.includes('Repair A4 4-Up from CSV')) {
        const labelMarker = `                      <label className=\"cursor-pointer rounded-xl border border-sky-400/40 bg-sky-500/10 px-3.5 py-2.5 text-xs font-black text-sky-300\">\n                        {packingRepairBusy==='batch-'+batchId?'Repairing Batch…':'Repair ALL from CSV'}\n                        <input type=\"file\" accept=\".csv,text/csv\" className=\"hidden\" disabled={Boolean(packingRepairBusy)} onChange={async e=>{\n                          const input=e.currentTarget;\n                          const file=input.files?.[0];\n                          if(!file) return;\n                          setPackingRepairBusy('batch-'+batchId);\n                          try {\n                            const csv=await file.text();\n                            const chunkSize=100;\n                            const partCount=Math.ceil(batchOrders.length/chunkSize);\n                            for(let part=0;part<partCount;part++){\n                              const chunk=batchOrders.slice(part*chunkSize,(part+1)*chunkSize);\n                              const suffix=partCount>1?('_Part-'+(part+1)+'-of-'+partCount):'';\n                              await generateRepairedBatchInvoicesPDFFromCsv(chunk,settings,csv,'O-RA_REPAIRED_'+batchId+suffix+'.pdf');\n                            }\n                          } catch(err:any){ alert(err?.message || 'Batch CSV invoice repair failed.'); }\n                          finally { setPackingRepairBusy(''); input.value=''; }\n                        }}/>\n                      </label>`;
        const labelReplacement = labelMarker + `\n                      {singlePageOrders.length>0 && <label className=\"cursor-pointer rounded-xl border border-violet-400/40 bg-violet-500/10 px-3.5 py-2.5 text-xs font-black text-violet-300\">\n                        {packingRepairBusy==='a4-'+batchId?'Preparing Repaired A4…':'Repair A4 4-Up from CSV'}\n                        <input type=\"file\" accept=\".csv,text/csv\" className=\"hidden\" disabled={Boolean(packingRepairBusy)} onChange={async e=>{\n                          const input=e.currentTarget;\n                          const file=input.files?.[0];\n                          if(!file) return;\n                          setPackingRepairBusy('a4-'+batchId);\n                          try {\n                            const csv=await file.text();\n                            await generateRepairedA4FourUpInvoicesPDFFromCsv(singlePageOrders,settings,csv,'O-RA_REPAIRED_'+batchId+'_A4-4-Up.pdf');\n                          } catch(err:any){ alert(err?.message || 'Repaired A4 4-up download failed.'); }\n                          finally { setPackingRepairBusy(''); input.value=''; }\n                        }}/>\n                      </label>}`;
        text = replaceRequired(text, labelMarker, labelReplacement, 'Repair ALL CSV button');
      }

      return { code: text, map: null };
    }

    return null;
  },
});
