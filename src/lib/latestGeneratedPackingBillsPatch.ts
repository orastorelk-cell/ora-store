/**
 * Packing-only convenience panel for invoices that were generated close together
 * after a restock/purchase allocation run.
 *
 * It is deliberately read-only: it does not change batch IDs, download flags,
 * invoice locks, stock, waybills, order status, or any purchase data.
 *
 * This patch is intentionally tolerant. If the packing-combine markers are not
 * present it simply does nothing instead of failing the production build.
 */
export const latestGeneratedPackingBillsPatch = () => ({
  name: 'ora-latest-generated-packing-bills-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (code.includes('LATEST GENERATED PACKING BILLS')) return null;

    let text = code;

    // packingBatchCombinePatch runs before this patch and adds both markers.
    // Never throw here: a missing marker must not break Cloudflare builds.
    const derivedMarker = `        const combineTooLarge = combineSelectedOrders.length > 200;\n\n        const downloadCombinedBatchesA4TwoUp = async () => {`;
    const panelMarker = `            <div data-ora-view-allowed="true" className="rounded-2xl border border-cyan-500/30 bg-neutral-900 p-5">\n              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                <div>\n                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300">Separate Print Tool</p>\n                  <h3 className="mt-1 text-base font-black text-white">Combine Selected Batches → A4 2xA5</h3>`;

    if (!text.includes(derivedMarker) || !text.includes(panelMarker)) return null;

    const derivedReplacement = `        const combineTooLarge = combineSelectedOrders.length > 200;\n\n        // Latest generated packing session: combine invoices even when FIFO/restock\n        // placed them into different historical batch IDs. The 30-minute window is\n        // anchored to the newest generated invoice, not to the current clock.\n        const latestPackingPool = Array.from(new Map(\n          allGroups\n            .flatMap(([,batchOrders])=>batchOrders)\n            .filter(order=>Boolean(order.invoice_locked) && Boolean(order.invoice_generated_at) && order.order_status!=='Cancelled')\n            .map(order=>[order.id,order] as [string,Order])\n        ).values());\n        const latestPackingGeneratedMs = latestPackingPool.reduce((max,order)=>{\n          const time=new Date(String(order.invoice_generated_at||'')).getTime();\n          return Number.isFinite(time)?Math.max(max,time):max;\n        },0);\n        const latestGeneratedPackingOrders = latestPackingGeneratedMs>0\n          ? latestPackingPool\n              .filter(order=>{\n                const time=new Date(String(order.invoice_generated_at||'')).getTime();\n                return Number.isFinite(time) && time>0 && latestPackingGeneratedMs-time<=30*60*1000;\n              })\n              .sort((a,b)=>{\n                const at=new Date(String(a.invoice_generated_at||'')).getTime()||0;\n                const bt=new Date(String(b.invoice_generated_at||'')).getTime()||0;\n                return at-bt || String(a.order_number).localeCompare(String(b.order_number));\n              })\n          : [];\n        const latestGeneratedPackingPages = latestGeneratedPackingOrders.reduce((sum,order)=>sum+getInvoicePageCount(order),0);\n        const latestGeneratedPackingA4Sheets = Math.ceil(latestGeneratedPackingPages/2);\n        const latestGeneratedPackingFirstAt = latestGeneratedPackingOrders[0]?.invoice_generated_at || '';\n        const latestGeneratedPackingLastAt = latestGeneratedPackingOrders[latestGeneratedPackingOrders.length-1]?.invoice_generated_at || '';\n\n        const downloadLatestGeneratedPackingBills = async () => {\n          if(!latestGeneratedPackingOrders.length) return;\n          try {\n            const newest=new Date(latestPackingGeneratedMs);\n            const stamp=[\n              newest.getFullYear(),\n              String(newest.getMonth()+1).padStart(2,'0'),\n              String(newest.getDate()).padStart(2,'0'),\n              '-',\n              String(newest.getHours()).padStart(2,'0'),\n              String(newest.getMinutes()).padStart(2,'0')\n            ].join('');\n            await generateA4TwoUpA5InvoicesPDF(\n              latestGeneratedPackingOrders,\n              settings,\n              stamp+'_Latest-'+latestGeneratedPackingOrders.length+'-Packing-Bills_A4-2xA5.pdf'\n            );\n          } catch(e:any) {\n            alert(e?.message || 'Latest packing bills PDF generation failed.');\n          }\n        };\n\n        const downloadCombinedBatchesA4TwoUp = async () => {`;

    text = text.replace(derivedMarker, derivedReplacement);

    const latestPanel = `            <div data-ora-view-allowed="true" className="rounded-2xl border-2 border-emerald-400/60 bg-emerald-500/10 p-5 shadow-sm">\n              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">\n                <div className="min-w-0">\n                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">LATEST GENERATED PACKING BILLS</p>\n                  <h3 className="mt-1 text-lg font-black text-white">Latest Session • {latestGeneratedPackingOrders.length} Bills Together</h3>\n                  <p className="mt-1 text-[11px] leading-5 text-neutral-300">\n                    Automatically gathers invoices generated within 30 minutes of the newest packing invoice, even when they were split across old batch IDs.\n                  </p>\n                  {latestGeneratedPackingOrders.length>0 && <p className="mt-2 text-[10px] font-bold text-emerald-200">\n                    {new Date(latestGeneratedPackingFirstAt).toLocaleTimeString()} → {new Date(latestGeneratedPackingLastAt).toLocaleTimeString()} • {latestGeneratedPackingPages} invoice page{latestGeneratedPackingPages===1?'':'s'} • {latestGeneratedPackingA4Sheets} A4 sheet{latestGeneratedPackingA4Sheets===1?'':'s'}\n                  </p>}\n                  {latestGeneratedPackingOrders.length>0 && <p className="mt-2 max-w-4xl break-words font-mono text-[9px] leading-4 text-neutral-400">\n                    {latestGeneratedPackingOrders.map(order=>order.order_number).join(' • ')}\n                  </p>}\n                </div>\n                <button\n                  type="button"\n                  disabled={latestGeneratedPackingOrders.length===0}\n                  onClick={()=>void downloadLatestGeneratedPackingBills()}\n                  className="shrink-0 rounded-xl bg-emerald-400 px-5 py-3 text-xs font-black text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"\n                >\n                  <Printer className="mr-1.5 inline h-4 w-4"/>\n                  Download All {latestGeneratedPackingOrders.length} • A4 2×A5\n                </button>\n              </div>\n              <p className="mt-3 text-[9px] leading-4 text-neutral-500">Print-only shortcut: old batch IDs, Downloaded status, invoice locks, stock and order status are not changed.</p>\n            </div>\n\n`;

    text = text.replace(panelMarker, latestPanel + panelMarker);
    return { code: text, map: null };
  },
});
