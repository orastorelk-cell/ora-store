export const confirmUploadPackingBatchPatch = () => ({
  name: 'ora-confirm-upload-packing-batch-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/types.ts')) {
      const marker = "  invoice_pack_batch_id?: string;";
      if (!text.includes(marker)) throw new Error('[O-RA confirm invoice safety] Order invoice batch type marker not found');
      if (!text.includes('confirm_upload_batch_id?: string;')) {
        text = text.replace(marker,
          "  /** Stable logical packing group for one Confirm/Cancel upload action. */\n" +
          "  confirm_upload_batch_id?: string;\n" +
          "  /** Read-only recovery snapshot captured from the Confirm CSV before invoice lock. */\n" +
          "  invoice_confirm_snapshot?: {\n" +
          "    captured_at: string; city?: string; district?: string; normal_total?: number; offer?: string; discount?: number; delivery_fee?: number; gift_wrap?: string; wrapping_cost?: number; final_total?: number;\n" +
          "    items: Array<{ item_code:string; item_name?:string; variant?:string; qty:number; unit_price:number; line_total:number; item_action?:string }>;\n" +
          "  };\n" + marker
        );
      }
    }

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const oldMirror =
        "  const mirrorOrderUpdate = (order: Order) => {\n" +
        "    if (!getStaffSessionToken()) return;\n" +
        "    sharedStaffRequest(`/api/orders/${encodeURIComponent(order.id)}`, {\n" +
        "      method:'PUT',\n" +
        "      body:JSON.stringify({order}),\n" +
        "    }).catch(err=>console.warn('Order mirror update failed:',err?.message||err));\n" +
        "  };";
      if (!text.includes('const orderMirrorQueueRef = useRef<Map<string,Promise<void>>>')) {
        if (!text.includes(oldMirror)) throw new Error('[O-RA confirm invoice safety] order mirror marker not found');
        const queuedMirror = String.raw`  const orderMirrorQueueRef = useRef<Map<string,Promise<void>>>(new Map());
  const mirrorOrderUpdate = (order: Order) => {
    if (!getStaffSessionToken()) return;
    const key=String(order.id||order.order_number||'');
    const prior=orderMirrorQueueRef.current.get(key) || Promise.resolve();
    let queued:Promise<void>;
    queued=prior.catch(()=>undefined).then(async()=>{
      await sharedStaffRequest('/api/orders/'+encodeURIComponent(order.id), {
        method:'PUT',
        body:JSON.stringify({order}),
      });
    }).catch(err=>{
      console.warn('Order mirror update failed:',err?.message||err);
    }).finally(()=>{
      if(orderMirrorQueueRef.current.get(key)===queued) orderMirrorQueueRef.current.delete(key);
    });
    orderMirrorQueueRef.current.set(key,queued);
  };`;
        text = text.replace(oldMirror, queuedMirror);
      }

      const oldType = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource) => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };";
      const newType = "  importConfirmedOrdersCsv: (csvText: string, source?: OrderSource, packingBatchId?: string) => { confirmedCount: number; notFoundCount: number; ignoredCount: number; orderNumbers: string[]; errors: string[] };";
      if (text.includes(oldType)) text = text.replace(oldType, newType);
      else if (!text.includes(newType)) throw new Error('[O-RA confirm invoice safety] StoreContext method type marker not found');

      const oldSignature = "  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource) => {";
      const newSignature = "  const importConfirmedOrdersCsv = (csvText: string, source?: OrderSource, packingBatchId?: string) => {";
      if (text.includes(oldSignature)) text = text.replace(oldSignature, newSignature);
      else if (!text.includes(newSignature)) throw new Error('[O-RA confirm invoice safety] importConfirmedOrdersCsv signature marker not found');

      const indexMarker = "    const wrappingCostI=idx(['wrapping_cost_rs','wrapping_cost','gift_wrap_fee','wrapping_fee_rs','wrapping_fee']);";
      if (!text.includes('const applyItemChangeI=idx(')) {
        if (!text.includes(indexMarker)) throw new Error('[O-RA confirm invoice safety] CSV index marker not found');
        text = text.replace(indexMarker, indexMarker + String.raw`
    const applyItemChangeI=idx(['apply_item_change','apply_change']);
    const itemNameI=idx(['item_name','product_name']);
    const unitPriceI=idx(['unit_price_rs','unit_price','price']);
    const lineTotalI=idx(['line_total_rs','line_total']);
    const normalTotalI=idx(['normal_total_rs','normal_total']);
    const offerI=idx(['offer']);
    const discountI=idx(['discount_rs','discount']);
    const deliveryFeeI=idx(['delivery_fee_rs','delivery_fee']);
    const finalTotalI=idx(['final_total_rs','final_total']);
    const cityI=idx(['city']);
    const districtI=idx(['district']);`);
      }

      const nowMarker = "    const now=new Date().toISOString(); const updates=new Map<string,Partial<Order>>();";
      if (!text.includes('const uploadPackingBatchId=')) {
        if (!text.includes(nowMarker)) throw new Error('[O-RA confirm invoice safety] confirm timestamp marker not found');
        text = text.replace(nowMarker, nowMarker + "\n    const uploadPackingBatchId=String(packingBatchId || ('PACK-UPLOAD-' + now.replace(/[^0-9]/g,'').slice(0,17)));" );
      }

      const oldSnapshotPush = "        try{nextItems.push(buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products));}catch(e:any){errors.push(`${id}: ${e?.message||'Invalid item selection.'}`);bad=true;}";
      if (!text.includes('const applyRequested=applyItemChangeI>=0')) {
        if (!text.includes(oldSnapshotPush)) throw new Error('[O-RA confirm invoice safety] item snapshot marker not found');
        const safeSnapshotPush = String.raw`        const applyRequested=applyItemChangeI>=0 && ['true','yes','1','on','apply'].includes(String(c[applyItemChangeI]||'').trim().toLowerCase());
        const requestedCode=String(actualCode||mainCode||'').trim().toUpperCase();
        const sameExistingItem=(it:Order['items'][number]|undefined)=>Boolean(it && requestedCode && [String(it.sku||''),String(it.main_sku||'')].map(v=>v.trim().toUpperCase()).includes(requestedCode));
        const indexedExisting=(order.items||[])[rowIndex];
        const existingItem=!applyRequested ? (sameExistingItem(indexedExisting)?indexedExisting:(order.items||[]).find(it=>sameExistingItem(it))) : undefined;
        if(existingItem){
          const preservedUnit=Math.max(0,Number(existingItem.unit_price||0));
          nextItems.push({...existingItem,quantity:qty,subtotal:Math.round(preservedUnit*qty*100)/100});
        }else{
          try{nextItems.push(buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products));}catch(e:any){errors.push(id + ': ' + (e?.message||'Invalid item selection.'));bad=true;}
        }`;
        text = text.replace(oldSnapshotPush, safeSnapshotPush);
      }

      const changedMarker = "      const changed=JSON.stringify(oldShape)!==JSON.stringify(newShape);";
      if (!text.includes('const stableQtyOfferDiscount=')) {
        if (!text.includes(changedMarker)) throw new Error('[O-RA confirm invoice safety] changed-shape marker not found');
        const snapshotInsert = String.raw`
      const stableQtyOfferDiscount=changed?special_offer_discount:Math.max(0,Number(order.special_offer_discount||0));
      const stableTotalAmount=Math.round(Math.max(0,subtotal-stableQtyOfferDiscount+order.delivery_fee+gift_wrap_fee));
      const csvMoney=(col:number)=>col>=0?Number(String(rows.map(c=>c[col]).find(v=>String(v||'').trim())||0).replace(/[^0-9.-]/g,'')):0;
      const csvText=(col:number)=>col>=0?String(rows.map(c=>c[col]).find(v=>String(v||'').trim())||'').trim():'';
      const sheetCity=csvText(cityI) || order.city;
      const sheetDistrict=csvText(districtI) || String(order.district||'');
      const invoiceConfirmSnapshot={
        captured_at:now,
        city:sheetCity,
        district:sheetDistrict,
        normal_total:csvMoney(normalTotalI),
        offer:csvText(offerI),
        discount:csvMoney(discountI),
        delivery_fee:csvMoney(deliveryFeeI),
        gift_wrap:giftWrapRaw,
        wrapping_cost:sheetWrappingCost,
        final_total:csvMoney(finalTotalI),
        items:confirmed.map(c=>({
          item_code:String(c[codeI]||'').trim(),
          item_name:itemNameI>=0?String(c[itemNameI]||'').trim():'',
          variant:variantI>=0?String(c[variantI]||'').trim():'',
          qty:Math.max(1,Number(qtyI>=0?c[qtyI]:1)||1),
          unit_price:unitPriceI>=0?Number(String(c[unitPriceI]||0).replace(/[^0-9.-]/g,'')):0,
          line_total:lineTotalI>=0?Number(String(c[lineTotalI]||0).replace(/[^0-9.-]/g,'')):0,
          item_action:itemStatusI>=0?String(c[itemStatusI]||'').trim():''
        }))
      };
`;
        text = text.replace(changedMarker, changedMarker + snapshotInsert);
      }

      const oldUpdate = "      updates.set(id,{items:nextItems,subtotal,special_offer_discount,gift_wrap_selected,gift_wrap_fee,total_amount,is_advance_required:adv,advance_amount:adv?Math.round(total_amount*pct/100):0,call_center_status:'Confirmed',order_status:'Processing',call_center_updated_at:now,stock_allocated:false,stock_status:'Waiting for Stock',product_change_history:changed?[...(order.product_change_history||[]),{changed_at:now,changed_by:'Call Center Confirm Upload',old_items:oldShape,new_items:newShape,reason:reason||undefined}]:(order.product_change_history||[]),notes:[order.notes,cancelled.length?`Call Center cancelled ${cancelled.length} item row(s).`:'',reason?`Call Center: ${reason}`:''].filter(Boolean).join(' | ')});";
      const newUpdate = "      updates.set(id,{items:nextItems,subtotal,special_offer_discount:stableQtyOfferDiscount,gift_wrap_selected,gift_wrap_fee,total_amount:stableTotalAmount,is_advance_required:adv,advance_amount:adv?Math.round(stableTotalAmount*pct/100):0,city:sheetCity,district:sheetDistrict,confirm_upload_batch_id:uploadPackingBatchId,invoice_confirm_snapshot:invoiceConfirmSnapshot,call_center_status:'Confirmed',order_status:'Processing',call_center_updated_at:now,stock_allocated:false,stock_status:'Waiting for Stock',product_change_history:changed?[...(order.product_change_history||[]),{changed_at:now,changed_by:'Call Center Confirm Upload',old_items:oldShape,new_items:newShape,reason:reason||undefined}]:(order.product_change_history||[]),notes:[order.notes,cancelled.length?`Call Center cancelled ${cancelled.length} item row(s).`:'',reason?`Call Center: ${reason}`:''].filter(Boolean).join(' | ')});";
      if (text.includes(oldUpdate)) text = text.replace(oldUpdate, newUpdate);
      else if (!text.includes(newUpdate)) throw new Error('[O-RA confirm invoice safety] confirmed order update marker not found');

      text = text.replace("    const batch = unseen.slice(0,50);", "    const batch = unseen.slice(0,100);");

      const autoBatchOld = "      invoice_pack_batch_id:o.invoice_pack_batch_id || batchId,";
      const autoBatchNew = "      invoice_pack_batch_id:o.invoice_pack_batch_id || (o.confirm_upload_batch_id && !orders.some(existing=>existing.confirm_upload_batch_id===o.confirm_upload_batch_id && Boolean(existing.invoice_pack_downloaded_at)) ? o.confirm_upload_batch_id : batchId),";
      if (text.includes(autoBatchOld)) text = text.replace(autoBatchOld, autoBatchNew);
      else if (!text.includes(autoBatchNew)) throw new Error('[O-RA confirm invoice safety] auto invoice batch marker not found');

      const manualBatchOld = "      invoice_pack_batch_id: o.invoice_pack_batch_id || batchId,";
      const manualBatchNew = "      invoice_pack_batch_id: o.invoice_pack_batch_id || (o.confirm_upload_batch_id && !orders.some(existing=>existing.confirm_upload_batch_id===o.confirm_upload_batch_id && Boolean(existing.invoice_pack_downloaded_at)) ? o.confirm_upload_batch_id : batchId),";
      if (text.includes(manualBatchOld)) text = text.replace(manualBatchOld, manualBatchNew);

      text = text.replace("    const uniqueIds = Array.from(new Set(orderIds)).slice(0, 50);", "    const uniqueIds = Array.from(new Set(orderIds)).slice(0, 200);");
      text = text.replace("    const uniqueIds=Array.from(new Set(orderIds.map(String).filter(Boolean))).slice(0,50);", "    const uniqueIds=Array.from(new Set(orderIds.map(String).filter(Boolean))).slice(0,200);");
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const ignoredMarker = "    let ignored = 0;\n\n    for (const file of files) {";
      if (!text.includes('const unifiedPackingBatchId =')) {
        if (!text.includes(ignoredMarker)) throw new Error('[O-RA confirm invoice safety] unified upload loop marker not found');
        const batchInsert = String.raw`    let ignored = 0;
    const packingNow = new Date();
    const unifiedPackingBatchId = 'PACK-UPLOAD-' +
      packingNow.getFullYear() +
      String(packingNow.getMonth() + 1).padStart(2, '0') +
      String(packingNow.getDate()).padStart(2, '0') + '-' +
      String(packingNow.getHours()).padStart(2, '0') +
      String(packingNow.getMinutes()).padStart(2, '0') +
      String(packingNow.getSeconds()).padStart(2, '0') + '-' +
      String(packingNow.getMilliseconds()).padStart(3, '0');

    for (const file of files) {`;
        text = text.replace(ignoredMarker, batchInsert);
      }

      const oldImport = "        const result = importConfirmedOrdersCsv(await file.text());";
      const newImport = "        const result = importConfirmedOrdersCsv(await file.text(), undefined, unifiedPackingBatchId);";
      if (text.includes(oldImport)) text = text.replace(oldImport, newImport);
      else if (!text.includes(newImport)) throw new Error('[O-RA confirm invoice safety] unified confirm import call marker not found');
    }

    return text === code ? null : { code: text, map: null };
  },
});
