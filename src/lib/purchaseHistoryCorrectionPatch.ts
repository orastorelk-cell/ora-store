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
          '  const applyPurchaseHistoryCorrections=async(rows:Array<{id:string;supplier_name:string;quantity_added:number;unit_buying_price:number;invoice_ref?:string;notes?:string;created_at:string;}>):Promise<{correctedCount:number;netQuantityChange:number;deallocatedOrderNumbers:string[]}>=>{',
          "    if(adminUser?.role!=='admin')throw new Error('Super Admin access is required to correct Purchase History.');",
          "    if(!rows.length)return{correctedCount:0,netQuantityChange:0,deallocatedOrderNumbers:[]};",
          '',
          '    const originalById=new Map(purchaseOrders.map(row=>[String(row.id),row] as [string,PurchaseOrder]));',
          '    const edits=new Map<string,PurchaseOrder>();',
          "    const deltaByKey=new Map<string,{product_id:string;variant_id?:string;sku:string;delta:number}>();",
          '    let netQuantityChange=0;',
          '',
          '    for(const row of rows){',
          '      const original=originalById.get(String(row.id));',
          "      if(!original)throw new Error('A Purchase History row is no longer available. Refresh and try again.');",
          '      const quantity=Math.floor(Number(row.quantity_added));',
          "      if(!Number.isFinite(quantity)||quantity<0)throw new Error(original.po_number+': quantity must be 0 or greater.');",
          '      const unitCost=Number(row.unit_buying_price);',
          "      if(!Number.isFinite(unitCost)||unitCost<0)throw new Error(original.po_number+': buying price is invalid.');",
          '      const parsedDate=new Date(row.created_at);',
          "      if(Number.isNaN(parsedDate.getTime()))throw new Error(original.po_number+': purchase date is invalid.');",
          "      const supplier=String(row.supplier_name||'').trim();",
          "      const next:PurchaseOrder={...original,supplier_name:supplier,quantity_added:quantity,unit_buying_price:unitCost,total_cost:quantity*unitCost,invoice_ref:String(row.invoice_ref||'').trim()||undefined,notes:String(row.notes||'').trim()||undefined,created_at:parsedDate.toISOString()};",
          '      edits.set(String(original.id),next);',
          '      const delta=quantity-Math.max(0,Number(original.quantity_added||0));',
          '      if(delta!==0){',
          "        const key=String(original.product_id)+'::'+String(original.variant_id||'base');",
          "        const previous=deltaByKey.get(key)||{product_id:original.product_id,variant_id:original.variant_id,sku:String(original.variant_sku||original.sku||'').trim().toUpperCase(),delta:0};",
          '        deltaByKey.set(key,{...previous,delta:previous.delta+delta});',
          '        netQuantityChange+=delta;',
          '      }',
          '    }',
          '',
          '    const workingProducts=cloneInventoryProducts(products);',
          '    const productMap=new Map(workingProducts.map(product=>[product.id,product] as [string,Product]));',
          '    const workingOrders=orders.map(order=>({...order} as Order));',
          '    const workingOrderMap=new Map(workingOrders.map(order=>[order.id,order] as [string,Order]));',
          '    let workingWaybills=waybillRecords.map(row=>({...row}));',
          '    const deallocatedOriginals=new Map<string,Order>();',
          '    const correctionLogs:StockHistory[]=[];',
          '    const now=new Date().toISOString();',
          '',
          '    const exactAvailable=(product:Product,variantId?:string)=>{',
          '      if(variantId)return Math.max(0,Number(variantById(product,variantId)?.stock_quantity||0));',
          "      if(normalizedProductType(product)==='variant')return -1;",
          '      return Math.max(0,Number(product.stock_quantity||0));',
          '    };',
          '',
          '    const changeExactStock=(product:Product,variantId:string|undefined,delta:number,label:string,reason:string)=>{',
          '      if(!delta)return;',
          '      if(variantId){',
          '        const target=variantById(product,variantId);',
          "        if(!target)throw new Error('Variant stock no longer exists for '+label+'.');",
          '        const before=Math.max(0,Number(target.stock_quantity||0));',
          '        const after=before+delta;',
          "        if(after<0)throw new Error(label+': stock correction would make available stock negative.');",
          "        product.variants=(product.variants||[]).map(current=>current.id===variantId?{...current,stock_quantity:after,status:(after<=0?'Out of Stock':'Active') as Product['status']}:current);",
          '        product.stock_quantity=(product.variants||[]).reduce((sum,current)=>sum+Math.max(0,Number(current.stock_quantity||0)),0);',
          "        product.status=product.stock_quantity<=0?'Out of Stock':'Active';",
          "        correctionLogs.push({id:'stk-purchase-correction-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),product_id:product.id,product_name:label,change_type:'Adjustment',quantity:Math.abs(delta),previous_stock:before,new_stock:after,reason,performed_by:adminUser?.name||'Admin',created_at:now});",
          '        return;',
          '      }',
          '      const before=Math.max(0,Number(product.stock_quantity||0));',
          '      const after=before+delta;',
          "      if(after<0)throw new Error(label+': stock correction would make available stock negative.');",
          '      product.stock_quantity=after;',
          "      product.status=after<=0?'Out of Stock':'Active';",
          "      correctionLogs.push({id:'stk-purchase-correction-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),product_id:product.id,product_name:label,change_type:'Adjustment',quantity:Math.abs(delta),previous_stock:before,new_stock:after,reason,performed_by:adminUser?.name||'Admin',created_at:now});",
          '    };',
          '',
          '    const restoreOrderToAvailable=(order:Order)=>{',
          '      if(deallocatedOriginals.has(order.id))return;',
          '      deallocatedOriginals.set(order.id,{...order});',
          '      for(const item of order.items||[]){',
          '        for(const req of inventoryRequirementsForOrderItem(item)){',
          '          const product=productMap.get(req.product_id);',
          '          if(!product)continue;',
          '          const label=req.label;',
          "          changeExactStock(product,req.variant_id,Math.max(1,Number(req.quantity||1)),label,'Purchase History correction returned '+order.order_number+' to Waiting for Stock');",
          '        }',
          '      }',
          "      const updated={...order,stock_allocated:false,stock_status:'Waiting for Stock' as const,stock_allocated_at:undefined,stock_allocated_by:undefined,stock_waiting_since:order.stock_waiting_since||now,waybill_number:undefined,courier_name:undefined,shipment_mode:undefined,tracking_status:'Not Shipped',delivery_status:'Pending'} as Order;",
          '      workingOrderMap.set(order.id,updated);',
          '      if(order.waybill_number){',
          "        workingWaybills=workingWaybills.map(record=>record.waybill_number===order.waybill_number?{...record,status:'Available' as const,assigned_order_id:undefined,assigned_order_number:undefined,assigned_at:undefined}:record);",
          '      }',
          '    };',
          '',
          '    const requirementQtyForKey=(order:Order,key:string)=>{',
          '      let qty=0;',
          '      for(const item of order.items||[])for(const req of inventoryRequirementsForOrderItem(item)){',
          "        const reqKey=String(req.product_id)+'::'+String(req.variant_id||'base');",
          '        if(reqKey===key)qty+=Math.max(1,Number(req.quantity||1));',
          '      }',
          '      return qty;',
          '    };',
          '',
          '    for(const [key,change] of deltaByKey.entries()){',
          '      if(!change.delta)continue;',
          '      const product=productMap.get(change.product_id);',
          "      if(!product)throw new Error(change.sku+': product no longer exists.');",
          '      const variant=change.variant_id?variantById(product,change.variant_id):undefined;',
          "      const label=product.name_en+(variant?' - '+variant.option_value:'')+' ('+change.sku+')';",
          '      if(change.delta<0){',
          '        const reduceBy=Math.abs(change.delta);',
          '        let available=exactAvailable(product,change.variant_id);',
          "        if(available<0)throw new Error(change.sku+': exact variant is required for this stock correction.');",
          '        if(available<reduceBy){',
          '          const candidates=Array.from(workingOrderMap.values())',
          "            .filter(order=>order.stock_allocated && order.order_status!=='Cancelled' && order.call_center_status==='Confirmed' && !order.invoice_locked && order.dispatch_status!=='Handed Over' && order.order_status!=='Shipped' && order.order_status!=='Delivered' && !order.invoice_number && !order.invoice_generated_at && !order.invoice_pack_batch_id && !order.invoice_pack_downloaded_at && !(order as any).fardar_csv_exported_at && requirementQtyForKey(order,key)>0)",
          "            .sort((a,b)=>new Date(b.stock_allocated_at||b.created_at).getTime()-new Date(a.stock_allocated_at||a.created_at).getTime());",
          '          for(const candidate of candidates){',
          '            if(available>=reduceBy)break;',
          '            restoreOrderToAvailable(candidate);',
          '            available=exactAvailable(product,change.variant_id);',
          '          }',
          '        }',
          '        available=exactAvailable(product,change.variant_id);',
          '        if(available<reduceBy){',
          "          throw new Error(change.sku+': correction needs '+reduceBy+' stock removed, but only '+available+' is safely available. Remaining packing stock is invoice/dispatch locked, so nothing was saved.');",
          '        }',
          "        changeExactStock(product,change.variant_id,-reduceBy,label,'Purchase History quantity correction • net '+change.delta);",
          '      }else{',
          "        changeExactStock(product,change.variant_id,change.delta,label,'Purchase History quantity correction • net +'+change.delta);",
          '      }',
          '    }',
          '',
          '    const deallocatedUpdates=Array.from(deallocatedOriginals.keys()).map(orderId=>workingOrderMap.get(orderId)!).filter(Boolean);',
          '    const persisted:Order[]=[];',
          '    try{',
          '      for(const updated of deallocatedUpdates){',
          "        await sharedStaffRequest('/api/orders/'+encodeURIComponent(updated.id),{method:'PUT',body:JSON.stringify({order:updated})});",
          '        persisted.push(updated);',
          '      }',
          '    }catch(error:any){',
          '      for(const saved of persisted.slice().reverse()){',
          '        const original=deallocatedOriginals.get(saved.id);',
          '        if(!original)continue;',
          "        try{await sharedStaffRequest('/api/orders/'+encodeURIComponent(original.id),{method:'PUT',body:JSON.stringify({order:original})});}catch{}",
          '      }',
          "      throw new Error('Purchase correction was not saved because an order update failed. No local stock/history changes were applied. '+String(error?.message||''));",
          '    }',
          '',
          '    const nextPurchases=purchaseOrders.map(original=>edits.get(String(original.id))||original);',
          '    const deallocatedUpdateMap=new Map(deallocatedUpdates.map(order=>[order.id,order] as [string,Order]));',
          '    setProducts(Array.from(productMap.values()));',
          '    setPurchaseOrders(nextPurchases);',
          '    if(correctionLogs.length)setStockHistory(prev=>[...correctionLogs,...prev].slice(0,5000));',
          "    if(deallocatedUpdates.length){fifoAllocatorSignatureRef.current='';setOrders(prev=>prev.map(order=>deallocatedUpdateMap.get(order.id)||order));}",
          '    if(deallocatedUpdates.length)setWaybillRecords(workingWaybills);',
          "    logActivity({action:'Purchase History Corrected',module:'Stock',details:rows.length+' purchase row(s) corrected • Net Qty '+(netQuantityChange>=0?'+':'')+netQuantityChange+(deallocatedUpdates.length?' • '+deallocatedUpdates.length+' packing order(s) returned to Waiting for Stock':'')});",
          '    return{correctedCount:rows.length,netQuantityChange,deallocatedOrderNumbers:deallocatedUpdates.map(order=>order.order_number)};',
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
          "  const [purchaseCorrectionDrafts, setPurchaseCorrectionDrafts] = useState<Record<string,{supplier_name:string;quantity_added:number;unit_buying_price:number;invoice_ref:string;notes:string;created_at:string}>>({});",
          '  const [purchaseCorrectionSaving, setPurchaseCorrectionSaving] = useState(false);',
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
          '  const selectedPurchaseHistory = useMemo(',
          "    () => purchaseOrders.filter((po)=>String(po.variant_sku||po.sku||'').trim().toUpperCase()===String(selectedStockReportSku||'').trim().toUpperCase()).slice().sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()),",
          '    [purchaseOrders,selectedStockReportSku]',
          '  );',
          '  useEffect(()=>{',
          '    const next:Record<string,{supplier_name:string;quantity_added:number;unit_buying_price:number;invoice_ref:string;notes:string;created_at:string}>={};',
          "    selectedPurchaseHistory.forEach((po)=>{ next[String(po.id)]={supplier_name:String(po.supplier_name||''),quantity_added:Math.max(0,Number(po.quantity_added||0)),unit_buying_price:Math.max(0,Number(po.unit_buying_price||0)),invoice_ref:String(po.invoice_ref||''),notes:String(po.notes||''),created_at:toPurchaseLocalInput(String(po.created_at||''))}; });",
          '    setPurchaseCorrectionDrafts(next);',
          '  },[selectedStockReportSku,purchaseOrders]);',
          '  const purchaseCorrectionNetQty=selectedPurchaseHistory.reduce((sum,po)=>sum+(Number(purchaseCorrectionDrafts[String(po.id)]?.quantity_added ?? po.quantity_added ?? 0)-Number(po.quantity_added||0)),0);',
          "  const updatePurchaseCorrectionDraft=(id:string,patch:Partial<{supplier_name:string;quantity_added:number;unit_buying_price:number;invoice_ref:string;notes:string;created_at:string}>)=>setPurchaseCorrectionDrafts(current=>({...current,[id]:{...(current[id]||{supplier_name:'',quantity_added:0,unit_buying_price:0,invoice_ref:'',notes:'',created_at:''}),...patch}}));",
          '  const saveSelectedPurchaseCorrections=async()=>{',
          '    if(purchaseCorrectionSaving||!selectedPurchaseHistory.length)return;',
          "    const accepted=window.confirm('Save all edited Purchase History rows for '+selectedStockReportSku+' and reconcile stock now? Stock/packing will change only after this Save.');",
          '    if(!accepted)return;',
          '    setPurchaseCorrectionSaving(true);',
          '    try{',
          "      const payload=selectedPurchaseHistory.map((po)=>{const draft=purchaseCorrectionDrafts[String(po.id)];return{id:String(po.id),supplier_name:String(draft?.supplier_name??po.supplier_name??''),quantity_added:Number(draft?.quantity_added??po.quantity_added??0),unit_buying_price:Number(draft?.unit_buying_price??po.unit_buying_price??0),invoice_ref:String(draft?.invoice_ref??po.invoice_ref??''),notes:String(draft?.notes??po.notes??''),created_at:String(draft?.created_at||toPurchaseLocalInput(String(po.created_at||'')))};});",
          '      const result=await applyPurchaseHistoryCorrections(payload);',
          "      alert('Purchase History saved. '+result.correctedCount+' row(s) corrected. Net Qty '+(result.netQuantityChange>=0?'+':'')+result.netQuantityChange+(result.deallocatedOrderNumbers.length?' • Packing returned to Waiting: '+result.deallocatedOrderNumbers.join(', '):''));",
          "    }catch(error:any){alert(error?.message||'Purchase History correction failed. No changes were saved.');}",
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
          '                    <p className="mt-1 text-[10px] text-neutral-500">Date, supplier, Qty, buying cost, invoice ref and notes can be corrected together. Editing does not touch stock or Packing until the final Save button.</p>',
          '                  </div>',
          '                  <button type="button" disabled={purchaseCorrectionSaving||!selectedPurchaseHistory.length} onClick={saveSelectedPurchaseCorrections} className="rounded-xl bg-cyan-400 px-4 py-3 text-[10px] font-black text-neutral-950 disabled:opacity-40">{purchaseCorrectionSaving?"Saving & Reconciling…":"Save All Corrections & Reconcile Stock"}</button>',
          '                </div>',
          '                {selectedPurchaseHistory.length ? (',
          '                  <div className="overflow-x-auto">',
          '                    <table className="w-full min-w-[1120px] text-left text-[10px] text-neutral-300">',
          '                      <thead className="bg-neutral-950 uppercase text-neutral-500"><tr><th className="p-3">PO</th><th className="p-3">Correct Date / Time</th><th className="p-3">Supplier</th><th className="p-3">Qty</th><th className="p-3">Unit Cost</th><th className="p-3">Total</th><th className="p-3">Invoice Ref</th><th className="p-3">Notes</th></tr></thead>',
          '                      <tbody className="divide-y divide-neutral-800">',
          '                        {selectedPurchaseHistory.map((po)=>{const draft=purchaseCorrectionDrafts[String(po.id)]||{supplier_name:String(po.supplier_name||""),quantity_added:Number(po.quantity_added||0),unit_buying_price:Number(po.unit_buying_price||0),invoice_ref:String(po.invoice_ref||""),notes:String(po.notes||""),created_at:toPurchaseLocalInput(String(po.created_at||""))};return (',
          '                          <tr key={po.id} className="align-top">',
          '                            <td className="p-3"><p className="font-mono font-black text-white">{po.po_number}</p><p className="mt-1 font-mono text-[9px] text-cyan-400">{po.variant_sku||po.sku}</p></td>',
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
          '                <div className="border-t border-neutral-800 bg-neutral-950/60 p-3 text-[10px] leading-5 text-neutral-500"><b className="text-amber-300">Safety:</b> If a Qty correction reduces stock below Available, only safe/unlocked newest Packing orders may return to Waiting for Stock. Invoice-locked, dispatched, shipped or delivered orders are never changed; Save is blocked instead.</div>',
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
