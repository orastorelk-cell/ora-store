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
  }>) => Promise<void>;
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
  // Daily multi-shop purchase is one idempotent server transaction.
  // Never credit inventory in local React state before the shared R2
  // purchase receipt and catalog mutation have both been committed.
  const addPurchaseOrdersBatch=async(rows:Array<{supplier_name:string;product_id:string;variant_id?:string;quantity_added:number;unit_buying_price:number;invoice_ref?:string;bill_image_url?:string;notes?:string;performed_by?:string;po_number?:string;}>)=>{
    await commitInventoryPurchaseBatch(rows);
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
      await addPurchaseOrdersBatch(dailyBatchRows);`;
      if (text.includes(oldMutation)) text = text.replace(oldMutation, atomicMutation);
      else if (!text.includes('addPurchaseOrdersBatch(dailyBatchRows);')) throw new Error('[O-RA atomic purchase] daily purchase mutation marker not found');

      return text === code ? null : { code: text, map: null };
    }

    return null;
  },
});
