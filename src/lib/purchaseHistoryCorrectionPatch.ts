const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA purchase history correction] ${label} marker not found`);
  return text.replace(from, to);
};

export const purchaseHistoryCorrectionPatch = () => ({
  name: 'ora-purchase-history-correction-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      if (!text.includes('applyPurchaseHistoryCorrections: (rows: Array<{')) {
        const settingsTypeMarker = '  settings: StoreSettings;';
        const correctionType = [
          '  applyPurchaseHistoryCorrections: (rows: Array<{',
          '    id: string;',
          '    product_id: string;',
          '    variant_id?: string;',
          '    supplier_name: string;',
          '    quantity_added: number;',
          '    unit_buying_price: number;',
          '    invoice_ref?: string;',
          '    notes?: string;',
          '    created_at: string;',
          '  }>) => Promise<{ correctedCount: number; netQuantityChange: number; deallocatedOrderNumbers: string[] }>;',
        ].join('\n') + '\n';
        if (!text.includes(settingsTypeMarker)) throw new Error('[O-RA purchase history correction] StoreContext settings marker not found');
        text = text.replace(settingsTypeMarker, correctionType + settingsTypeMarker);
      }

      if (!text.includes('const applyPurchaseHistoryCorrections=async(rows:Array<{')) {
        const implementationMarker = '  // Category CRUD\n  const addCategory =';
        const at = text.indexOf(implementationMarker);
        if (at < 0) throw new Error('[O-RA purchase history correction] implementation marker not found');

        const correctionFunction = [
          '',
          '  const applyPurchaseHistoryCorrections=async(rows:Array<{id:string;product_id:string;variant_id?:string;supplier_name:string;quantity_added:number;unit_buying_price:number;invoice_ref?:string;notes?:string;created_at:string;}>):Promise<{correctedCount:number;netQuantityChange:number;deallocatedOrderNumbers:string[]}>=>{',
          "    if(adminUser?.role!=='admin')throw new Error('Super Admin access is required to correct Purchase History.');",
          "    if(!rows.length)return{correctedCount:0,netQuantityChange:0,deallocatedOrderNumbers:[]};",
          '    const originalById=new Map(purchaseOrders.map(row=>[String(row.id),row] as [string,PurchaseOrder]));',
          '    const clean=rows.map(row=>{',
          "      const original=originalById.get(String(row.id));if(!original)throw new Error('A Purchase History row is no longer available. Refresh and try again.');",
          "      const product=products.find(item=>String(item.id)===String(row.product_id));if(!product||normalizedProductType(product)==='bundle')throw new Error('Choose an existing non-bundle Item Code.');",
          '      const variant=row.variant_id?(product.variants||[]).find(item=>String(item.id)===String(row.variant_id)):undefined;',
          "      if(row.variant_id&&!variant)throw new Error('The selected colour / variant no longer exists. Refresh and try again.');",
          "      return{id:String(row.id),product_id:String(product.id),...(variant?{variant_id:String(variant.id)}:{}),supplier_name:String(row.supplier_name||''),quantity_added:Number(row.quantity_added),unit_buying_price:Number(row.unit_buying_price),invoice_ref:String(row.invoice_ref||''),notes:String(row.notes||''),created_at:String(row.created_at),};",
          '    });',
          "    const result=await sharedStaffRequest('/api/admin/inventory-history',{method:'POST',body:JSON.stringify({action:'correct-history',operation_id:crypto.randomUUID(),rows:clean})});",
          "    if(result?.ok!==true||!Array.isArray(result.purchases)||!Array.isArray(result.stock_history))throw new Error(result?.error||'Server did not confirm the Purchase History correction. Nothing was saved.');",
          '    if(result.state)applySharedStorefrontState(result.state,true);',
          '    setPurchaseOrders(result.purchases);',
          '    setStockHistory(result.stock_history);',
          "    logActivity({action:'Purchase History Corrected',module:'Stock',details:rows.length+' purchase row(s) corrected on the server'});",
          '    return{correctedCount:Number(result.correctedCount||rows.length),netQuantityChange:Number(result.netQuantityChange||0),deallocatedOrderNumbers:Array.isArray(result.deallocatedOrderNumbers)?result.deallocatedOrderNumbers:[]};',
          '  };',
          '',
        ].join('\n');

        text = text.slice(0, at) + correctionFunction + text.slice(at);
      }

      const providerOld = '        addPurchaseOrder,\n        addPurchaseOrdersBatch,\n        settings,';
      const providerNew = '        addPurchaseOrder,\n        addPurchaseOrdersBatch,\n        applyPurchaseHistoryCorrections,\n        settings,';
      text = replaceRequired(text, providerOld, providerNew, 'StoreContext provider');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const destructureOld = '    addPurchaseOrder,\n    addPurchaseOrdersBatch,\n    settings,';
      const destructureNew = '    addPurchaseOrder,\n    addPurchaseOrdersBatch,\n    applyPurchaseHistoryCorrections,\n    settings,';
      text = replaceRequired(text, destructureOld, destructureNew, 'Admin StoreContext destructure');

      if (!text.includes('purchaseCorrectionDrafts, setPurchaseCorrectionDrafts')) {
        const stateMarker = "  const [selectedStockReportSku, setSelectedStockReportSku] = useState('');";
        const stateWithCorrection = [
          stateMarker,
          "  const [purchaseCorrectionDrafts, setPurchaseCorrectionDrafts] = useState<Record<string,{product_id:string;variant_id?:string;target_sku:string;supplier_name:string;quantity_added:number;unit_buying_price:number;invoice_ref:string;notes:string;created_at:string}>>({});",
          '  const [purchaseCorrectionSaving, setPurchaseCorrectionSaving] = useState(false);',
          "  const [purchaseCorrectionMessage, setPurchaseCorrectionMessage] = useState('');",
        ].join('\n');
        text = replaceRequired(text, stateMarker, stateWithCorrection, 'Admin correction state');
      }

      if (!text.includes('const selectedPurchaseHistory = useMemo(')) {
        const movementMarker = [
          '  const selectedStockMovementRows = useMemo(',
          '    () => selectedStockDailyReport.filter((row)=>row.purchased>0 || row.packed>0).slice().reverse(),',
          '    [selectedStockDailyReport]',
          '  );',
          '',
        ].join('\n');
        const helpers = [
          movementMarker,
          "  const toPurchaseLocalInput=(value:string)=>{ const date=new Date(value); if(Number.isNaN(date.getTime()))return ''; const local=new Date(date.getTime()-date.getTimezoneOffset()*60000); return local.toISOString().slice(0,16); };",
          "  const purchaseCorrectionCodeOptions=useMemo(()=>products.flatMap(product=>normalizedProductType(product)==='bundle'?[]:[{product_id:String(product.id),variant_id:undefined,sku:String(product.sku||''),label:String(product.sku||'')+' · '+String(product.name_en||'')},...(product.variants||[]).map(variant=>({product_id:String(product.id),variant_id:String(variant.id),sku:String(variant.sku||''),label:String(variant.sku||'')+' · '+String(product.name_en||'')+' - '+String(variant.option_value||'')}))]).filter(option=>option.sku),[products]);",
          '  const selectedPurchaseHistory = useMemo(',
          "    () => purchaseOrders.filter((po)=>String(po.variant_sku||po.sku||'').trim().toUpperCase()===String(selectedStockReportSku||'').trim().toUpperCase()).slice().sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()),",
          '    [purchaseOrders,selectedStockReportSku]',
          '  );',
          '  useEffect(()=>{',
          '    const next:Record<string,{product_id:string;variant_id?:string;target_sku:string;supplier_name:string;quantity_added:number;unit_buying_price:number;invoice_ref:string;notes:string;created_at:string}>={};',
          "    selectedPurchaseHistory.forEach((po)=>{ next[String(po.id)]={product_id:String(po.product_id||''),variant_id:po.variant_id?String(po.variant_id):undefined,target_sku:String(po.variant_sku||po.sku||''),supplier_name:String(po.supplier_name||''),quantity_added:Math.max(0,Number(po.quantity_added||0)),unit_buying_price:Math.max(0,Number(po.unit_buying_price||0)),invoice_ref:String(po.invoice_ref||''),notes:String(po.notes||''),created_at:toPurchaseLocalInput(String(po.created_at||''))}; });",
          '    setPurchaseCorrectionDrafts(next);',
          '  },[selectedStockReportSku,purchaseOrders]);',
          '  const purchaseCorrectionNetQty=selectedPurchaseHistory.reduce((sum,po)=>sum+(Number(purchaseCorrectionDrafts[String(po.id)]?.quantity_added ?? po.quantity_added ?? 0)-Number(po.quantity_added||0)),0);',
          "  const updatePurchaseCorrectionDraft=(id:string,patch:Partial<{product_id:string;variant_id?:string;target_sku:string;supplier_name:string;quantity_added:number;unit_buying_price:number;invoice_ref:string;notes:string;created_at:string}>)=>setPurchaseCorrectionDrafts(current=>({...current,[id]:{...(current[id]||{product_id:'',variant_id:undefined,target_sku:'',supplier_name:'',quantity_added:0,unit_buying_price:0,invoice_ref:'',notes:'',created_at:''}),...patch}}));",
          '  const saveSelectedPurchaseCorrections=async()=>{',
          '    if(purchaseCorrectionSaving||!selectedPurchaseHistory.length)return;',
          '    setPurchaseCorrectionSaving(true);',
          "    setPurchaseCorrectionMessage('Saving Purchase History correction to the server…');",
          '    try{',
          "      const payload=selectedPurchaseHistory.map((po)=>{const draft=purchaseCorrectionDrafts[String(po.id)];if(!draft?.product_id)throw new Error('Search and select a valid target Item Code for '+po.po_number+'.');return{id:String(po.id),product_id:String(draft.product_id),...(draft.variant_id?{variant_id:String(draft.variant_id)}:{}),supplier_name:String(draft?.supplier_name??po.supplier_name??''),quantity_added:Number(draft?.quantity_added??po.quantity_added??0),unit_buying_price:Number(draft?.unit_buying_price??po.unit_buying_price??0),invoice_ref:String(draft?.invoice_ref??po.invoice_ref??''),notes:String(draft?.notes??po.notes??''),created_at:String(draft?.created_at||toPurchaseLocalInput(String(po.created_at||'')))};});",
          '      const result=await applyPurchaseHistoryCorrections(payload);',
          "      setPurchaseCorrectionMessage('Saved to server: '+result.correctedCount+' Purchase History row(s). Check the updated Item Code before continuing.');",
          "    }catch(error:any){setPurchaseCorrectionMessage(error?.message||'Purchase History correction failed. No changes were saved.');}",
          '    finally{setPurchaseCorrectionSaving(false);}',
          '  };',
          '',
        ].join('\n');
        text = replaceRequired(text, movementMarker, helpers, 'Admin purchase correction helpers');
      }

      if (!text.includes('PURCHASE HISTORY CORRECTION • SAVE ONCE')) {
        const detailGridMarker = '              <div className="grid grid-cols-1 gap-4 p-4 pt-0 xl:grid-cols-[1.5fr_1fr]">';
        const editor = [
          '              <div className="mx-4 mb-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 p-4">',
          '                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">',
          '                  <div>',
          '                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">AVAILABLE STOCK NOW • {selectedStockReportSku}</p>',
          '                    <p className="mt-1 text-4xl font-black text-emerald-300">{selectedStockReportRow.available}</p>',
          '                    <p className="mt-1 text-[10px] text-neutral-400">Packing Now: <b className="text-orange-300">{selectedStockReportRow.packing}</b> • Physical Now: <b className="text-violet-300">{selectedStockReportRow.currentPhysical}</b></p>',
          '                  </div>',
          '                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-right">',
          '                    <p className="text-[9px] uppercase text-neutral-500">Purchase Qty Change Draft</p>',
          '                    <p className={(purchaseCorrectionNetQty<0?"text-red-300":purchaseCorrectionNetQty>0?"text-emerald-300":"text-neutral-300")+" mt-1 text-2xl font-black"}>{purchaseCorrectionNetQty>0?"+":""}{purchaseCorrectionNetQty}</p>',
          '                    <p className="text-[9px] text-neutral-600">No stock changes until Save.</p>',
          '                  </div>',
          '                </div>',
          '              </div>',
          '',
          '              <div className="mx-4 mb-4 overflow-hidden rounded-2xl border border-cyan-500/25 bg-neutral-900">',
          '                <div className="flex flex-col gap-2 border-b border-neutral-800 p-4 sm:flex-row sm:items-center sm:justify-between">',
          '                  <div>',
          '                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-400">PURCHASE HISTORY CORRECTION • SAVE ONCE</p>',
          '                    <h4 className="mt-1 text-sm font-black text-white">{selectedStockReportSku} • {selectedPurchaseHistory.length} Purchase Record(s)</h4>',
          '                    <p className="mt-1 text-[10px] text-neutral-500">Correct the Item Code and bill details here. Archive-only history edits do not change physical stock; original stock-in corrections are checked against available stock before saving.</p>',
          '                  </div>',
          '                  <button type="button" disabled={purchaseCorrectionSaving||!selectedPurchaseHistory.length} onClick={saveSelectedPurchaseCorrections} className="rounded-xl bg-cyan-400 px-4 py-3 text-[10px] font-black text-neutral-950 disabled:opacity-40">{purchaseCorrectionSaving?"Saving to Server…":"Save Corrections to Server"}</button>',
          '                </div>',
          '                {purchaseCorrectionMessage&&<p className={"border-b border-neutral-800 px-4 py-3 text-xs "+(purchaseCorrectionMessage.startsWith("Saved")?"text-emerald-300":"text-rose-300")}>{purchaseCorrectionMessage}</p>}',
          '                {selectedPurchaseHistory.length ? (',
          '                  <div className="overflow-x-auto">',
          '                    <datalist id="purchase-correction-item-codes">{purchaseCorrectionCodeOptions.map(option=><option key={option.product_id+"::"+(option.variant_id||"base")} value={option.sku} label={option.label} />)}</datalist>',
          '                    <table className="w-full min-w-[1320px] text-left text-[10px] text-neutral-300">',
          '                      <thead className="bg-neutral-950 uppercase text-neutral-500"><tr><th className="p-3">PO</th><th className="p-3">Correct Item Code</th><th className="p-3">Correct Date / Time</th><th className="p-3">Supplier</th><th className="p-3">Qty</th><th className="p-3">Unit Cost</th><th className="p-3">Total</th><th className="p-3">Invoice Ref</th><th className="p-3">Notes</th></tr></thead>',
          '                      <tbody className="divide-y divide-neutral-800">',
          '                        {selectedPurchaseHistory.map((po)=>{const draft=purchaseCorrectionDrafts[String(po.id)]||{product_id:String(po.product_id||""),variant_id:po.variant_id?String(po.variant_id):undefined,target_sku:String(po.variant_sku||po.sku||""),supplier_name:String(po.supplier_name||""),quantity_added:Number(po.quantity_added||0),unit_buying_price:Number(po.unit_buying_price||0),invoice_ref:String(po.invoice_ref||""),notes:String(po.notes||""),created_at:toPurchaseLocalInput(String(po.created_at||""))};return (',
          '                          <tr key={po.id} className="align-top">',
          '                            <td className="p-3"><p className="font-mono font-black text-white">{po.po_number}</p><p className="mt-1 font-mono text-[9px] text-cyan-400">{po.variant_sku||po.sku}</p></td>',
          '                            <td className="p-3"><input list="purchase-correction-item-codes" value={draft.target_sku} placeholder="Search Item Code" disabled={purchaseCorrectionSaving} onChange={(e)=>{const value=e.target.value.trim();const match=purchaseCorrectionCodeOptions.find(option=>option.sku.toUpperCase()===value.toUpperCase());updatePurchaseCorrectionDraft(String(po.id),{target_sku:value,product_id:match?.product_id||"",variant_id:match?.variant_id});}} className="w-[180px] rounded-lg border border-cyan-700 bg-neutral-950 px-2 py-2 font-mono text-white" /></td>',
          '                            <td className="p-3"><input type="datetime-local" value={draft.created_at} disabled={purchaseCorrectionSaving} onChange={(e)=>updatePurchaseCorrectionDraft(String(po.id),{created_at:e.target.value})} className="w-[190px] rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" /></td>',
          '                            <td className="p-3"><input value={draft.supplier_name} disabled={purchaseCorrectionSaving} onChange={(e)=>updatePurchaseCorrectionDraft(String(po.id),{supplier_name:e.target.value})} className="w-[170px] rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" /></td>',
          '                            <td className="p-3"><input type="number" min="0" step="1" value={draft.quantity_added} disabled={purchaseCorrectionSaving} onChange={(e)=>updatePurchaseCorrectionDraft(String(po.id),{quantity_added:Number(e.target.value)})} className="w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-center font-black text-white" /></td>',
          '                            <td className="p-3"><input type="number" min="0" step="0.01" value={draft.unit_buying_price} disabled={purchaseCorrectionSaving} onChange={(e)=>updatePurchaseCorrectionDraft(String(po.id),{unit_buying_price:Number(e.target.value)})} className="w-28 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-right text-white" /></td>',
          '                            <td className="p-3 font-black text-emerald-300">Rs. {(Number(draft.quantity_added||0)*Number(draft.unit_buying_price||0)).toLocaleString()}</td>',
          '                            <td className="p-3"><input value={draft.invoice_ref} disabled={purchaseCorrectionSaving} onChange={(e)=>updatePurchaseCorrectionDraft(String(po.id),{invoice_ref:e.target.value})} className="w-[140px] rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" /></td>',
          '                            <td className="p-3"><input value={draft.notes} disabled={purchaseCorrectionSaving} onChange={(e)=>updatePurchaseCorrectionDraft(String(po.id),{notes:e.target.value})} className="w-[220px] rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-white" /></td>',
          '                          </tr>',
          '                        );})}',
          '                      </tbody>',
          '                    </table>',
          '                  </div>',
          '                ) : <div className="p-4 text-xs text-neutral-500">No Purchase History found for this exact Item Code.</div>}',
          '                <div className="border-t border-neutral-800 bg-neutral-950/60 p-3 text-[10px] leading-5 text-neutral-500"><b className="text-amber-300">Safety:</b> A stock-credited row is saved only when the exact stock reduction is currently available. If not, Save is blocked and no Packing, invoice, dispatch or return record is changed.</div>',
          '              </div>',
          '',
          detailGridMarker,
        ].join('\n');
        text = replaceRequired(text, detailGridMarker, editor, 'Admin selected stock correction editor');
      }

      return { code: text, map: null };
    }

    return null;
  },
});
