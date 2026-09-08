const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA purchase stock durability] ${label} marker not found`);
  return text.replace(from, to);
};

export const purchaseHistoryStockDurabilityPatch = () => ({
  name: 'ora-purchase-history-stock-durability-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;
    if (!code.includes('const applyPurchaseHistoryCorrections=async(rows:Array<{')) return null;

    let text = code;

    if (!text.includes('const purchaseLedgerTouched=new Map<string')) {
      const anchor = [
        '        netQuantityChange+=delta;',
        '      }',
        '    }',
        '',
        '    const workingProducts=cloneInventoryProducts(products);',
      ].join('\n');

      const replacement = [
        '        netQuantityChange+=delta;',
        '      }',
        '    }',
        '',
        '    // Purchase History is the authoritative purchase ledger. Older builds could',
        '    // save corrected PO quantities while leaving the live product stock at the',
        '    // old quantity. Reconcile only the purchase contribution here; manual stock',
        '    // adjustments, returns and order allocations remain untouched.',
        '    const nextPurchases=purchaseOrders.map(original=>edits.get(String(original.id))||original);',
        "    const purchaseLedgerTouched=new Map<string,{product_id:string;variant_id?:string;sku:string}>();",
        '    for(const row of rows){',
        '      const original=originalById.get(String(row.id));',
        '      if(!original)continue;',
        "      const key=String(original.product_id)+'::'+String(original.variant_id||'base');",
        "      purchaseLedgerTouched.set(key,{product_id:String(original.product_id),variant_id:original.variant_id,sku:String(original.variant_sku||original.sku||'').trim().toUpperCase()});",
        '    }',
        '    let purchaseLedgerDriftRepaired=0;',
        '    for(const [key,info] of purchaseLedgerTouched.entries()){',
        "      const matchingPurchases=nextPurchases.filter(po=>String(po.product_id)===info.product_id && String(po.variant_id||'base')===String(info.variant_id||'base'));",
        '      const poNumbers=new Set(matchingPurchases.map(po=>String(po.po_number||\'\').trim()).filter(Boolean));',
        '      const purchaseInflows=stockHistory.filter(log=>',
        "        String(log.product_id)===info.product_id && log.change_type==='Purchase Inflow' &&",
        "        Array.from(poNumbers).some(po=>String(log.reason||'').startsWith(po))",
        '      );',
        '      // If old stock history was cleared, do not invent a baseline. Normal edited',
        '      // quantity delta handling below remains active and safe.',
        '      if(!purchaseInflows.length)continue;',
        '      const expectedPurchaseQty=matchingPurchases.reduce((sum,po)=>sum+Math.max(0,Number(po.quantity_added||0)),0);',
        '      const loggedPurchaseQty=purchaseInflows.reduce((sum,log)=>sum+Math.max(0,Number(log.quantity||0)),0);',
        '      const priorCorrectionDelta=stockHistory.filter(log=>{',
        "        if(String(log.product_id)!==info.product_id)return false;",
        "        const reason=String(log.reason||'');",
        "        if(!reason.startsWith('Purchase History quantity correction') && !reason.startsWith('Purchase Ledger Reconcile'))return false;",
        "        if(!info.variant_id)return true;",
        "        return String(log.product_name||'').toUpperCase().includes('('+info.sku+')');",
        '      }).reduce((sum,log)=>sum+(Number(log.new_stock||0)-Number(log.previous_stock||0)),0);',
        '      const currentEditDelta=Number(deltaByKey.get(key)?.delta||0);',
        '      const residual=expectedPurchaseQty-(loggedPurchaseQty+priorCorrectionDelta+currentEditDelta);',
        '      if(!residual)continue;',
        "      const existing=deltaByKey.get(key)||{product_id:info.product_id,variant_id:info.variant_id,sku:info.sku,delta:0};",
        '      deltaByKey.set(key,{...existing,delta:Number(existing.delta||0)+residual});',
        '      purchaseLedgerDriftRepaired+=residual;',
        '    }',
        '',
        '    const workingProducts=cloneInventoryProducts(products);',
      ].join('\n');

      text = replaceRequired(text, anchor, replacement, 'purchase-ledger reconciliation');
    }

    if (!text.includes("Purchase correction stock could not be saved to the shared storefront")) {
      const anchor = [
        '    const nextPurchases=purchaseOrders.map(original=>edits.get(String(original.id))||original);',
        '    const deallocatedUpdateMap=new Map(deallocatedUpdates.map(order=>[order.id,order] as [string,Order]));',
        '    setProducts(Array.from(productMap.values()));',
      ].join('\n');

      const replacement = [
        '    const nextProducts=Array.from(productMap.values());',
        '    try{',
        "      await sharedStaffRequest('/api/admin/storefront/state',{method:'PUT',body:JSON.stringify({products:nextProducts,categories,settings})});",
        '    }catch(error:any){',
        '      // Order deallocations were already mirrored above. Roll them back if the',
        '      // authoritative stock snapshot cannot be saved, so orders and stock never',
        '      // end up in two different states.',
        '      for(const saved of persisted.slice().reverse()){',
        '        const original=deallocatedOriginals.get(saved.id);',
        '        if(!original)continue;',
        "        try{await sharedStaffRequest('/api/orders/'+encodeURIComponent(original.id),{method:'PUT',body:JSON.stringify({order:original})});}catch{}",
        '      }',
        "      throw new Error('Purchase correction stock could not be saved to the shared storefront. Nothing was applied locally. '+String(error?.message||''));",
        '    }',
        '    const deallocatedUpdateMap=new Map(deallocatedUpdates.map(order=>[order.id,order] as [string,Order]));',
        '    setProducts(nextProducts);',
      ].join('\n');

      text = replaceRequired(text, anchor, replacement, 'durable storefront stock save');
    }

    if (!text.includes("' • Ledger Drift Repair '")) {
      const from = "    logActivity({action:'Purchase History Corrected',module:'Stock',details:rows.length+' purchase row(s) corrected • Net Qty '+(netQuantityChange>=0?'+':'')+netQuantityChange+(deallocatedUpdates.length?' • '+deallocatedUpdates.length+' packing order(s) returned to Waiting for Stock':'')});";
      const to = "    logActivity({action:'Purchase History Corrected',module:'Stock',details:rows.length+' purchase row(s) corrected • Net Qty '+(netQuantityChange>=0?'+':'')+netQuantityChange+(purchaseLedgerDriftRepaired?' • Ledger Drift Repair '+(purchaseLedgerDriftRepaired>0?'+':'')+purchaseLedgerDriftRepaired:'')+(deallocatedUpdates.length?' • '+deallocatedUpdates.length+' packing order(s) returned to Waiting for Stock':'')});";
      text = replaceRequired(text, from, to, 'activity log drift detail');
    }

    return { code: text, map: null };
  },
});
