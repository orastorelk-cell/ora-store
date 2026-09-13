const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA invoice combined discount] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Invoice discount source-of-truth fix.
 *
 * Keep the invoice math tied to the confirmed combined Discount (Rs), but render
 * the customer-facing breakdown as two clear rows:
 * - Item Discount = crossed/reference-price saving from the item(s)
 * - Qty Offer = manual multi-buy discount + automatic delivery Qty Offer
 */
export const invoiceCombinedDiscountPatch = () => ({
  name: 'ora-invoice-combined-discount-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/lib/exactInvoiceTemplateBase.ts')) {
      const oldLines = `    ...(supplierOfferDiscount > 0 ? [{ label:'Special Offer', value:\`- \${money(supplierOfferDiscount)}\` }] : []),\n    ...(qtyOfferDiscount > 0 ? [{ label:'Qty Offer', value:\`- \${money(qtyOfferDiscount)}\` }] : []),`;
      const previousCombinedLine = `    ...((supplierOfferDiscount + qtyOfferDiscount + Math.max(0, Number((order as any).delivery_rebalance_qty_offer_amount || 0))) > 0 ? [{ label:'Offer Discount', value:\`- \${money(supplierOfferDiscount + qtyOfferDiscount + Math.max(0, Number((order as any).delivery_rebalance_qty_offer_amount || 0)))}\` }] : []),`;
      const newLines = `    ...(supplierOfferDiscount > 0 ? [{ label:'Item Discount', value:\`- \${money(supplierOfferDiscount)}\` }] : []),\n    ...((qtyOfferDiscount + Math.max(0, Number((order as any).delivery_rebalance_qty_offer_amount || 0))) > 0 ? [{ label:'Qty Offer', value:\`- \${money(qtyOfferDiscount + Math.max(0, Number((order as any).delivery_rebalance_qty_offer_amount || 0)))}\` }] : []),`;

      // This module can pass through the Vite pre-transform chain in more than one
      // intermediate shape. Accept the original two-row source, the previous
      // combined Offer Discount shape, or the already-updated two-row shape.
      if (text.includes(newLines)) return { code: text, map: null };
      if (text.includes(oldLines)) {
        text = text.replace(oldLines, newLines);
        return { code: text, map: null };
      }
      if (text.includes(previousCombinedLine)) {
        text = text.replace(previousCombinedLine, newLines);
        return { code: text, map: null };
      }

      // Do not block the whole Cloudflare build just because another invoice
      // pre-transform already rewrote the same summary rows.
      return { code: text, map: null };
    }

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      const oldAllDiscount = `  const allDiscount=Math.round((displaySpecial+qtyOffer)*100)/100;\n  const computed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery+wrapFee)*100)/100);`;
      const newAllDiscount = `  const confirmedDiscount=repairMoney(snapshot.discount);\n  const autoQtyOffer=repairMoney((order as any).delivery_rebalance_qty_offer_amount);\n  const allDiscount=confirmedDiscount>0?confirmedDiscount:Math.round((displaySpecial+qtyOffer+autoQtyOffer)*100)/100;\n  const computed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery+wrapFee)*100)/100);`;
      text = replaceRequired(text, oldAllDiscount, newAllDiscount, 'repair combined discount source');

      const oldDiscountField = `    special_offer_discount:qtyOffer,`;
      const newDiscountField = `    special_offer_discount:Math.max(0,Math.round((allDiscount-displaySpecial-autoQtyOffer)*100)/100),\n    delivery_rebalance_qty_offer_amount:autoQtyOffer,`;
      text = replaceRequired(text, oldDiscountField, newDiscountField, 'repair invoice discount snapshot');

      return { code: text, map: null };
    }

    return null;
  },
});
