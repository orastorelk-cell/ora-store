const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA confirm crossed price] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Confirm CSV Unit Price is a Call Center display/reference price when a crossed
 * Special Offer is active. The real charged order item price must remain in
 * item.unit_price, while the CSV value is stored as regular_unit_price for invoice
 * display/discount reconstruction.
 */
export const confirmUploadCrossPriceSnapshotPatch = () => ({
  name: 'ora-confirm-upload-cross-price-snapshot-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;
    let text = code;

    const oldBlock = String.raw`        if(existingItem){
          const preservedUnit=Math.max(0,Number(existingItem.unit_price||0));
          nextItems.push({...existingItem,quantity:qty,subtotal:Math.round(preservedUnit*qty*100)/100});
        }else{
          try{nextItems.push(buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products));}catch(e:any){errors.push(id + ': ' + (e?.message||'Invalid item selection.'));bad=true;}
        }`;

    const newBlock = String.raw`        const referenceRaw=unitPriceI>=0?String(c[unitPriceI]||'').trim().replace(/,/g,''):'';
        const referenceMatch=referenceRaw.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/);
        const sheetReferenceUnit=referenceMatch?Math.max(0,Number(referenceMatch[0])||0):0;
        if(existingItem){
          const preservedUnit=Math.max(0,Number(existingItem.unit_price||0));
          const preservedReference=Math.max(
            preservedUnit,
            sheetReferenceUnit,
            Math.max(0,Number((existingItem as any).regular_unit_price||0)),
            preservedUnit+Math.max(0,Number((existingItem as any).supplier_offer_discount_per_unit||0))
          );
          nextItems.push({
            ...existingItem,
            quantity:qty,
            unit_price:preservedUnit,
            subtotal:Math.round(preservedUnit*qty*100)/100,
            regular_unit_price:preservedReference,
            supplier_offer_discount_per_unit:Math.max(0,preservedReference-preservedUnit),
          });
        }else{
          try{
            const fresh=buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products);
            const actualUnit=Math.max(0,Number(fresh.unit_price||0));
            const referenceUnit=Math.max(
              actualUnit,
              sheetReferenceUnit,
              Math.max(0,Number((fresh as any).regular_unit_price||0)),
              actualUnit+Math.max(0,Number((fresh as any).supplier_offer_discount_per_unit||0))
            );
            nextItems.push({
              ...fresh,
              regular_unit_price:referenceUnit,
              supplier_offer_discount_per_unit:Math.max(0,referenceUnit-actualUnit),
            });
          }catch(e:any){errors.push(id + ': ' + (e?.message||'Invalid item selection.'));bad=true;}
        }`;

    text = replaceRequired(text, oldBlock, newBlock, 'confirmed item snapshot');
    return { code: text, map: null };
  },
});
