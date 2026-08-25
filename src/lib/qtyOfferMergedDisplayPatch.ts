const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA merged qty offer display] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Presentation-only merge for the new percentage Special Offer.
 *
 * No new Google Sheet field and no new Invoice row is introduced. Invoice keeps one
 * combined Offer Discount row, while the Sheet's existing Offer cell clearly names
 * Special Offer and Qty Offer separately. The real charged/final total is unchanged.
 */
export const qtyOfferMergedDisplayPatch = () => ({
  name: 'ora-qty-offer-merged-display-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/lib/exactInvoiceTemplateBase.ts')) {
      let text = code;
      const oldLines = `    ...(supplierOfferDiscount > 0 ? [{ label:'Special Offer', value:\`- \${money(supplierOfferDiscount)}\` }] : []),\n    ...(qtyOfferDiscount > 0 ? [{ label:'Qty Offer', value:\`- \${money(qtyOfferDiscount)}\` }] : []),`;
      const newLines = `    ...((supplierOfferDiscount + qtyOfferDiscount) > 0 ? [{ label:'Offer Discount', value:\`- \${money(supplierOfferDiscount + qtyOfferDiscount)}\` }] : []),`;
      text = replaceRequired(text, oldLines, newLines, 'Invoice Offer Discount merge');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/lib/googleSheets.ts')) {
      let text = code;
      const startMarker = 'const orderQtyOfferLabel = (order: any): string => {';
      const endMarker = '\n\nconst orderTotalOfferDiscount =';
      const start = text.indexOf(startMarker);
      const end = text.indexOf(endMarker, start);
      if (start < 0 || end < 0) {
        throw new Error('[O-RA merged qty offer display] Google Sheet offer helper markers not found');
      }
      const mergedHelper = `const orderQtyOfferLabel = (order: any): string => {\n  const items = Array.isArray(order?.items) ? order.items : [];\n  const totalQty = items.reduce(\n    (sum: number, item: any) => sum + Math.max(1, Number(item?.quantity || 1)),\n    0,\n  );\n  const special = Math.max(0, roundMoney(orderItemSpecialOfferDiscount(order)));\n  const qtyDiscount = Math.max(0, roundMoney(order?.special_offer_discount || order?.discount || 0));\n  const labels: string[] = [];\n  if (special > 0) labels.push(\`Special Offer Rs. \${special}\`);\n  if (qtyDiscount > 0) labels.push(\`Qty Offer Rs. \${qtyDiscount} (\${totalQty} items)\`);\n  return labels.length ? labels.join(' + ') : 'No Offer';\n};`;
      text = text.slice(0, start) + mergedHelper + text.slice(end);
      return { code: text, map: null };
    }

    return null;
  },
});
