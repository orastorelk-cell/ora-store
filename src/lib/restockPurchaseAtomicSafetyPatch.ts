export const restockPurchaseAtomicSafetyPatch = () => ({
  name: 'ora-restock-purchase-atomic-safety-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      // Preserve a freshly-created Confirm/Paid batch only when stock was allocated
      // immediately after that upload. A genuinely waiting/restocked order must get
      // the NEW invoice-generation batch instead of returning to an old batch.
      const isolatedAuto = "      invoice_pack_batch_id:o.invoice_pack_batch_id || batchId,";
      const freshAuto = "      invoice_pack_batch_id:o.invoice_pack_batch_id || (o.confirm_upload_batch_id && o.stock_allocated_at && (o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at) && Math.abs(new Date(o.stock_allocated_at).getTime()-new Date(o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at || 0).getTime())<=10*60*1000 ? o.confirm_upload_batch_id : batchId),";
      if (text.includes(isolatedAuto)) text = text.replace(isolatedAuto, freshAuto);

      const isolatedManual = "      invoice_pack_batch_id: o.invoice_pack_batch_id || batchId,";
      const freshManual = "      invoice_pack_batch_id: o.invoice_pack_batch_id || (o.confirm_upload_batch_id && o.stock_allocated_at && (o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at) && Math.abs(new Date(o.stock_allocated_at).getTime()-new Date(o.invoice_confirm_snapshot?.captured_at || o.call_center_updated_at || 0).getTime())<=10*60*1000 ? o.confirm_upload_batch_id : batchId),";
      if (text.includes(isolatedManual)) text = text.replace(isolatedManual, freshManual);

      if (!text.includes('addPurchaseOrdersBatch: (rows: Array<{')) {
        const settingsTypeMarker = "  settings: StoreSettings;";
        if (!text.includes(settingsTypeMarker)) throw new Error('[O-RA atomic purchase] StoreContext settings type marker not found');
        const batchType = `  addPurchaseOrdersBatch: (rows: Array<{
    supplier_name: string;
    product_id: string;
    variant_id?: string;
    quantity_added: number;
    unit_buying_price: number;
    invoice_ref?: string;
    bill_image_url?: string;
    notes?: string;
    performed_by?: string;
    po_number?: string;
  }>) => void;
`;
        text = text.replace(settingsTypeMarker, batchType + settingsTypeMarker);
      }

      if (!text.includes('const addPurchaseOrdersBatch=(rows:Array<{')) {
        // IMPORTANT: there is also a "// Category CRUD" comment inside the
        // StoreContextType interface. Anchor to the implementation's addCategory
        // declaration so executable code can never be injected into the interface.
        const categoryImplementationMarker = "  // Category CRUD\n  const addCategory =";
        const categoryImplementationAt = text.indexOf(categoryImplementationMarker);
        if (categoryImplementationAt < 0) throw new Error('[O-RA atomic purchase] purchase implementation insertion marker not found');
        const batchFunction = `
  const addPurchaseOrdersBatch=(rows:Array<{supplier_name:string;product_id:string;variant_id?:string;quantity_added:number;unit_buying_price:number;invoice_ref?:string;bill_image_url?:string;notes?:string;performed_by?:string;po_number?:string;}>)=>{
    if(!rows.length)return;

    // Build the complete purchase against a private inventory clone first. If any
    // line is invalid, throw BEFORE React/localStorage/shared-catalog state changes.
    const workingProducts=cloneInventoryProducts(products);
    const productMap=new Map(workingProducts.map(product=>[product.id,product] as [string,Product]));
    const purchases:PurchaseOrder[]=[];
    const logs:StockHistory[]=[];
    const basePoNumber=purchaseOrders.length+1;
    const year=new Date().getFullYear();

    rows.forEach((poData,rowIndex)=>{
      const product=productMap.get(poData.product_id);
      if(!product)throw new Error('Selected product was not found.');
      const quantity=Math.floor(Number(poData.quantity_added||0));
      if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Purchase quantity must be greater than zero.');
      const unitCost=Number(poData.unit_buying_price);
      if(!Number.isFinite(unitCost)||unitCost<0)throw new Error('Purchase buying price is invalid.');
      if(normalizedProductType(product)==='bundle')throw new Error('Add purchases to component products, not the bundle.');
      const variant=poData.variant_id?variantById(product,poData.variant_id):undefined;
      if(normalizedProductType(product)==='variant'&&!variant)throw new Error('Select the exact variant/color for this purchase.');

      const now=new Date().toISOString();
      const before=variant?Number(variant.stock_quantity||0):Number(product.stock_quantity||0);
      const after=before+quantity;
      const poNumber=String(poData.po_number||'').trim()||('PO-'+year+'-'+String(basePoNumber+rowIndex).padStart(4,'0'));

      purchases.push({
        id:'po-'+Date.now()+'-'+rowIndex+'-'+Math.random().toString(36).slice(2,7),
        po_number:poNumber,
        supplier_name:String(poData.supplier_name||'').trim(),
        product_id:product.id,
        product_name:product.name_en,
        sku:variant?.sku||product.sku,
        variant_id:variant?.id,
        variant_name:variant?.option_value,
        variant_sku:variant?.sku,
        quantity_added:quantity,
        unit_buying_price:unitCost,
        total_cost:quantity*unitCost,
        invoice_ref:String(poData.invoice_ref||'').trim()||undefined,
        bill_image_url:String(poData.bill_image_url||'').trim()||undefined,
        notes:String(poData.notes||'').trim()||undefined,
        performed_by:poData.performed_by||adminUser?.name||'Admin',
        created_at:now,
      });

      if(variant){
        product.variants=(product.variants||[]).map(current=>current.id===variant.id?{...current,stock_quantity:after,status:'Active' as const}:current);
        product.stock_quantity=(product.variants||[]).reduce((sum,current)=>sum+Number(current.stock_quantity||0),0);
        product.status='Active';
      }else{
        product.stock_quantity=after;
        product.status='Active';
      }

      logs.push({
        id:'stk-purchase-batch-'+Date.now()+'-'+rowIndex+'-'+Math.random().toString(36).slice(2,7),
        product_id:product.id,
        product_name:product.name_en+(variant?' - '+variant.option_value:''),
        change_type:'Purchase Inflow',
        quantity,
        previous_stock:before,
        new_stock:after,
        reason:poNumber+' • '+String(poData.supplier_name||'').trim(),
        performed_by:poData.performed_by||adminUser?.name||'Admin',
        created_at:now,
      });
    });

    // Exactly three React updates for the whole day: inventory, purchase history,
    // and stock history. FIFO therefore evaluates the final combined stock once.
    setProducts(Array.from(productMap.values()));
    setPurchaseOrders(prev=>[...[...purchases].reverse(),...prev]);
    setStockHistory(prev=>[...[...logs].reverse(),...prev]);
  };
`;
        text = text.slice(0, categoryImplementationAt) + batchFunction + text.slice(categoryImplementationAt);
      }

      const providerMarker = "        addPurchaseOrder,\n        settings,";
      const providerWithBatch = "        addPurchaseOrder,\n        addPurchaseOrdersBatch,\n        settings,";
      if (text.includes(providerMarker)) text = text.replace(providerMarker, providerWithBatch);
      else if (!text.includes(providerWithBatch)) throw new Error('[O-RA atomic purchase] StoreContext provider marker not found');

      return text === code ? null : { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const destructureMarker = "    addPurchaseOrder,\n    settings,";
      const destructureWithBatch = "    addPurchaseOrder,\n    addPurchaseOrdersBatch,\n    settings,";
      if (text.includes(destructureMarker)) text = text.replace(destructureMarker, destructureWithBatch);
      else if (!text.includes(destructureWithBatch)) throw new Error('[O-RA atomic purchase] Admin StoreContext destructure marker not found');

      const oldMutation = `      uploaded.forEach((entry) => {
        entry.lines.forEach((line) => {
          addPurchaseOrder({
            supplier_name: entry.supplier,
            product_id: line.selection.product.id,
            variant_id: line.selection.variant?.id,
            quantity_added: line.quantity,
            unit_buying_price: line.cost,
            invoice_ref: String(entry.shop.invoice_ref || '').trim(),
            bill_image_url: entry.billImageUrl || undefined,
            notes: String(entry.shop.notes || '').trim(),
            performed_by: adminUser?.name || 'Admin',
            po_number: 'PO-' + year + '-' + String(firstPoNumber + lineNumber).padStart(4, '0'),
          });
          lineNumber += 1;
        });
      });`;
      const atomicMutation = `      const dailyBatchRows = uploaded.flatMap((entry) => entry.lines.map((line) => {
        const poNumber = 'PO-' + year + '-' + String(firstPoNumber + lineNumber).padStart(4, '0');
        lineNumber += 1;
        return {
          supplier_name: entry.supplier,
          product_id: line.selection.product.id,
          variant_id: line.selection.variant?.id,
          quantity_added: line.quantity,
          unit_buying_price: line.cost,
          invoice_ref: String(entry.shop.invoice_ref || '').trim(),
          bill_image_url: entry.billImageUrl || undefined,
          notes: String(entry.shop.notes || '').trim(),
          performed_by: adminUser?.name || 'Admin',
          po_number: poNumber,
        };
      }));
      addPurchaseOrdersBatch(dailyBatchRows);`;
      if (text.includes(oldMutation)) text = text.replace(oldMutation, atomicMutation);
      else if (!text.includes('addPurchaseOrdersBatch(dailyBatchRows);')) throw new Error('[O-RA atomic purchase] daily purchase mutation marker not found');

      return text === code ? null : { code: text, map: null };
    }

    return null;
  },
});
