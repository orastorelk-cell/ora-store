const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA invoice snapshot consistency] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Keep Confirm CSV safety aligned with the invoice's crossed/reference-price display.
 *
 * - CSV Unit Price / Line Total are reference/crossed values when a Special Offer is active.
 * - order.items[].unit_price/subtotal remain the real charged values.
 * - Gift Wrap must be included in Final Total. A legacy/current Sheet row that says
 *   Gift Wrap YES but whose final is exactly the no-wrap equation is corrected narrowly.
 *
 * The safety guard remains enabled; only the comparison source/formula is corrected.
 */
export const invoiceSnapshotConsistencyPatch = () => ({
  name: 'ora-invoice-snapshot-consistency-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const snapshotMarker = `      const invoiceConfirmSnapshot={`;
      if (!text.includes('const safeInvoiceFinalTotal=')) {
        const snapshotPrep = `      const rawCsvFinalTotal=csvMoney(finalTotalI);\n      const rawCsvNormalTotal=csvMoney(normalTotalI);\n      const rawCsvDiscount=csvMoney(discountI);\n      const rawCsvDelivery=csvMoney(deliveryFeeI);\n      const csvNoWrapTotal=Math.round(Math.max(0,rawCsvNormalTotal-rawCsvDiscount+rawCsvDelivery));\n      const csvWithWrapTotal=Math.round(Math.max(0,csvNoWrapTotal+(gift_wrap_selected?gift_wrap_fee:0)));\n      const csvFinalMissedWrap=Boolean(gift_wrap_selected && gift_wrap_fee>0 && rawCsvFinalTotal>0 && Math.abs(rawCsvFinalTotal-csvNoWrapTotal)<=1);\n      const safeInvoiceFinalTotal=csvFinalMissedWrap?csvWithWrapTotal:(rawCsvFinalTotal||stableTotalAmount);\n`;
        if (!text.includes(snapshotMarker)) throw new Error('[O-RA invoice snapshot consistency] Confirm snapshot marker not found');
        text = text.replace(snapshotMarker, snapshotPrep + snapshotMarker);
      }

      text = replaceRequired(
        text,
        `        final_total:csvMoney(finalTotalI),`,
        `        final_total:safeInvoiceFinalTotal,`,
        'Confirm snapshot final total',
      );

      return { code: text, map: null };
    }

    if (id.endsWith('/src/lib/exactInvoiceTemplateBase.ts')) {
      const wrapMarker = `  const wrappingCost = order.gift_wrap_selected ? Math.max(0, Number(order.gift_wrap_fee || 0)) : 0;`;
      const wrapReplacement = wrapMarker + `\n  const invoiceSnapshot:any=(order as any).invoice_confirm_snapshot || {};\n  const invoiceSnapshotWrapText=String(invoiceSnapshot.gift_wrap||'').trim().toLowerCase();\n  const invoiceSnapshotWrapEnabled=['yes','true','1','on','add wrap','gift wrap'].includes(invoiceSnapshotWrapText);\n  const invoiceSnapshotNormal=Math.max(0,Number(invoiceSnapshot.normal_total||0));\n  const invoiceSnapshotDiscount=Math.max(0,Number(invoiceSnapshot.discount||0));\n  const invoiceSnapshotDelivery=Math.max(0,Number(invoiceSnapshot.delivery_fee||0));\n  const invoiceSnapshotFinal=Math.max(0,Number(invoiceSnapshot.final_total||0));\n  const invoiceSnapshotNoWrap=Math.max(0,Math.round((invoiceSnapshotNormal-invoiceSnapshotDiscount+invoiceSnapshotDelivery)*100)/100);\n  const invoiceOrderFinal=Math.max(0,Number(order.total_amount||0));\n  const invoiceLegacyMissedWrap=Boolean(invoiceSnapshotWrapEnabled && wrappingCost>0 && invoiceSnapshotFinal>0 && Math.abs(invoiceSnapshotFinal-invoiceSnapshotNoWrap)<=1 && Math.abs(invoiceOrderFinal-invoiceSnapshotNoWrap)<=1);\n  const invoiceSafeTotalAmount=invoiceLegacyMissedWrap?Math.max(0,Math.round((invoiceSnapshotNoWrap+wrappingCost)*100)/100):invoiceOrderFinal;`;
      text = replaceRequired(text, wrapMarker, wrapReplacement, 'normal invoice legacy wrap total');

      text = replaceRequired(
        text,
        `<text class=\"t table\" x=\"1475\" y=\"\${policyY+191}\" text-anchor=\"end\">\${money(order.total_amount)}</text>`,
        `<text class=\"t table\" x=\"1475\" y=\"\${policyY+191}\" text-anchor=\"end\">\${money(invoiceSafeTotalAmount)}</text>`,
        'normal invoice final total render',
      );
      return { code: text, map: null };
    }

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      const oldItemChecks = `    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-repairMoney(a.unit_price))>0.01) reasons.push('item '+(i+1)+' price');\n    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-repairMoney(a.subtotal))>0.01) reasons.push('item '+(i+1)+' total');`;
      const newItemChecks = `    const actualUnit=repairMoney(a.unit_price);\n    const referenceUnit=Math.max(actualUnit,repairMoney((a as any).regular_unit_price),actualUnit+repairMoney((a as any).supplier_offer_discount_per_unit));\n    const referenceLine=Math.round(referenceUnit*Math.max(1,Number(a.quantity||1))*100)/100;\n    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-referenceUnit)>0.01) reasons.push('item '+(i+1)+' price');\n    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-referenceLine)>0.01) reasons.push('item '+(i+1)+' total');`;
      text = replaceRequired(text, oldItemChecks, newItemChecks, 'crossed-price safety checks');

      const oldFinalCheck = `  if(repairMoney(snapshot.final_total)>0 && Math.abs(repairMoney(snapshot.final_total)-repairMoney(order.total_amount))>0.01) reasons.push('final total');`;
      const newFinalCheck = `  const snapshotFinal=repairMoney(snapshot.final_total);\n  const snapshotWrapEnabled=['yes','true','1','on','add wrap','gift wrap'].includes(wrapText);\n  const snapshotWrapFee=snapshotWrapEnabled?repairMoney(snapshot.wrapping_cost):0;\n  const snapshotNoWrap=Math.max(0,Math.round((repairMoney(snapshot.normal_total)-repairMoney(snapshot.discount)+repairMoney(snapshot.delivery_fee))*100)/100);\n  const expectedSnapshotFinal=(snapshotWrapEnabled && snapshotWrapFee>0 && snapshotFinal>0 && Math.abs(snapshotFinal-snapshotNoWrap)<=1)\n    ? Math.max(0,Math.round((snapshotNoWrap+snapshotWrapFee)*100)/100)\n    : snapshotFinal;\n  const orderFinal=repairMoney(order.total_amount);\n  const legacyOrderMissedWrap=Boolean(snapshotWrapEnabled && snapshotWrapFee>0 && snapshotFinal>0 && Math.abs(snapshotFinal-snapshotNoWrap)<=1 && Math.abs(orderFinal-snapshotNoWrap)<=1);\n  if(expectedSnapshotFinal>0 && !legacyOrderMissedWrap && Math.abs(expectedSnapshotFinal-orderFinal)>0.01) reasons.push('final total');`;
      text = replaceRequired(text, oldFinalCheck, newFinalCheck, 'Gift Wrap final safety check');

      // Repair path remains unchanged in behavior; it already produces the correct total.
      const oldRepairFinal = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const finalTotal=parsedFinal || computed;`;
      const newRepairFinal = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const noWrapComputed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery)*100)/100);\n  const parsedFinalMissedWrap=Boolean(giftWrap && wrapFee>0 && parsedFinal>0 && Math.abs(parsedFinal-noWrapComputed)<=1);\n  const finalTotal=parsedFinalMissedWrap?computed:(parsedFinal||computed);`;
      text = replaceRequired(text, oldRepairFinal, newRepairFinal, 'Repair Gift Wrap final total');

      return { code: text, map: null };
    }

    return null;
  },
});
