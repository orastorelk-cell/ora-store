const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA invoice combined discount] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Invoice discount source-of-truth fix.
 *
 * Call Center / Confirm CSV already stores one combined Discount (Rs) value that
 * includes crossed-price Special Offer + Qty Offer. The invoice must show that
 * exact combined amount instead of accidentally showing only the Qty Offer part.
 */
export const invoiceCombinedDiscountPatch = () => ({
  name: 'ora-invoice-combined-discount-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/lib/exactInvoiceTemplateBase.ts')) {
      const oldLines = `    ...(supplierOfferDiscount > 0 ? [{ label:'Special Offer', value:\`- \${money(supplierOfferDiscount)}\` }] : []),\n    ...(qtyOfferDiscount > 0 ? [{ label:'Qty Offer', value:\`- \${money(qtyOfferDiscount)}\` }] : []),`;
      const newLines = `    ...((supplierOfferDiscount + qtyOfferDiscount) > 0 ? [{ label:'Offer Discount', value:\`- \${money(supplierOfferDiscount + qtyOfferDiscount)}\` }] : []),`;
      text = replaceRequired(text, oldLines, newLines, 'invoice discount summary rows');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      const oldAllDiscount = `  const allDiscount=Math.round((displaySpecial+qtyOffer)*100)/100;\n  const computed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery+wrapFee)*100)/100);`;
      const newAllDiscount = `  const confirmedDiscount=repairMoney(snapshot.discount);\n  const allDiscount=confirmedDiscount>0?confirmedDiscount:Math.round((displaySpecial+qtyOffer)*100)/100;\n  const computed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery+wrapFee)*100)/100);`;
      text = replaceRequired(text, oldAllDiscount, newAllDiscount, 'repair combined discount source');

      const oldDiscountField = `    special_offer_discount:qtyOffer,`;
      const newDiscountField = `    special_offer_discount:Math.max(0,Math.round((allDiscount-displaySpecial)*100)/100),`;
      text = replaceRequired(text, oldDiscountField, newDiscountField, 'repair invoice discount snapshot');

      return { code: text, map: null };
    }

    return null;
  },
});
