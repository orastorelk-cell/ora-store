const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA merged qty offer display] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Presentation-only merge for the new percentage Special Offer.
 *
 * No new Google Sheet field and no new Invoice row is introduced. The display-only
 * percentage saving is added to the existing Qty Offer amount, while the real charged
 * price/final total remains unchanged.
 */
export const qtyOfferMergedDisplayPatch = () => ({
  name: 'ora-qty-offer-merged-display-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/lib/exactInvoiceTemplateBase.ts')) {
      let text = code;
      const oldLines = `    ...(supplierOfferDiscount > 0 ? [{ label:'Special Offer', value:\`- \${money(supplierOfferDiscount)}\` }] : []),\n    ...(qtyOfferDiscount > 0 ? [{ label:'Qty Offer', value:\`- \${money(qtyOfferDiscount)}\` }] : []),`;
      const newLines = `    ...((supplierOfferDiscount + qtyOfferDiscount) > 0 ? [{ label:'Qty Offer', value:\`- \${money(supplierOfferDiscount + qtyOfferDiscount)}\` }] : []),`;
      text = replaceRequired(text, oldLines, newLines, 'Invoice Qty Offer merge');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/lib/googleSheets.ts')) {
      let text = code;
      const startMarker = 'const orderQtyOfferLabel = (order: any): string => {';
      const endMarker = '\n\nconst orderTotalOfferDiscount =';
      const start = text.indexOf(startMarker);
      const end = text.indexOf(endMarker, start);
      if (start < 0 || end < 0) {
        throw new Error('[O-RA merged qty offer display] Google Sheet Qty Offer helper markers not found');
      }
      const mergedHelper = `const orderQtyOfferLabel = (order: any): string => {\n  const items = Array.isArray(order?.items) ? order.items : [];\n  const totalQty = items.reduce(\n    (sum: number, item: any) => sum + Math.max(1, Number(item?.quantity || 1)),\n    0,\n  );\n  const discount = Math.max(0, roundMoney(\n    orderItemSpecialOfferDiscount(order) + Math.max(0, roundMoney(order?.special_offer_discount || order?.discount || 0)),\n  ));\n  return discount > 0 ? \`Qty Offer Rs. \${discount} (\${totalQty} items)\` : 'No Qty Offer';\n};`;
      text = text.slice(0, start) + mergedHelper + text.slice(end);
      return { code: text, map: null };
    }

    return null;
  },
});
