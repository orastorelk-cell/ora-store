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

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      const helperMarker = `const repairItemCancelled = (value:unknown) => ['cancel','cancelled','canceled','cancel item'].includes(String(value||'').trim().toLowerCase());\n\nconst invoiceConfirmMismatchReasons = (order:Order):string[] => {`;
      const helperReplacement = `const repairItemCancelled = (value:unknown) => ['cancel','cancelled','canceled','cancel item'].includes(String(value||'').trim().toLowerCase());\n\nconst invoiceOrderWithSafeSnapshotTotal = (order:Order):Order => {\n  const snapshot=(order as any).invoice_confirm_snapshot as InvoiceRepairSnapshot|undefined;\n  if(!snapshot) return order;\n  const wrapText=String(snapshot.gift_wrap||'').trim().toLowerCase();\n  const wrapEnabled=['yes','true','1','on','add wrap','gift wrap'].includes(wrapText);\n  const wrapFee=wrapEnabled?repairMoney(snapshot.wrapping_cost):0;\n  if(!wrapEnabled || wrapFee<=0) return order;\n  const normal=repairMoney(snapshot.normal_total);\n  const discount=repairMoney(snapshot.discount);\n  const delivery=repairMoney(snapshot.delivery_fee);\n  const snapshotFinal=repairMoney(snapshot.final_total);\n  const storedFinal=repairMoney(order.total_amount);\n  const noWrap=Math.max(0,Math.round((normal-discount+delivery)*100)/100);\n  const withWrap=Math.max(0,Math.round((noWrap+wrapFee)*100)/100);\n  const snapshotMissedWrap=snapshotFinal>0 && Math.abs(snapshotFinal-noWrap)<=1;\n  const storedMissedWrap=storedFinal>0 && Math.abs(storedFinal-noWrap)<=1;\n  if((snapshotMissedWrap || storedMissedWrap) && withWrap>0){\n    return {...order,total_amount:withWrap} as Order;\n  }\n  return order;\n};\n\nconst invoiceConfirmMismatchReasons = (order:Order):string[] => {`;
      text = replaceRequired(text, helperMarker, helperReplacement, 'legacy Gift Wrap total helper');

      const renderOld = `  const svg = buildExactInvoiceSvg(order,settings,false,pageItems,pageIndex,totalPages);\n  if (String((order as any).district || '').trim()) return svg;\n  const district = await resolveInvoiceDistrict(order, settings);`;
      const renderNew = `  const safeOrder=invoiceOrderWithSafeSnapshotTotal(order);\n  const svg = buildExactInvoiceSvg(safeOrder,settings,false,pageItems,pageIndex,totalPages);\n  if (String((safeOrder as any).district || '').trim()) return svg;\n  const district = await resolveInvoiceDistrict(safeOrder, settings);`;
      text = replaceRequired(text, renderOld, renderNew, 'normal invoice legacy Gift Wrap render');

      const oldItemChecks = `    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-repairMoney(a.unit_price))>0.01) reasons.push('item '+(i+1)+' price');\n    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-repairMoney(a.subtotal))>0.01) reasons.push('item '+(i+1)+' total');`;
      const newItemChecks = `    const actualUnit=repairMoney(a.unit_price);\n    const referenceUnit=Math.max(actualUnit,repairMoney((a as any).regular_unit_price),actualUnit+repairMoney((a as any).supplier_offer_discount_per_unit));\n    const referenceLine=Math.round(referenceUnit*Math.max(1,Number(a.quantity||1))*100)/100;\n    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-referenceUnit)>0.01) reasons.push('item '+(i+1)+' price');\n    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-referenceLine)>0.01) reasons.push('item '+(i+1)+' total');`;
      text = replaceRequired(text, oldItemChecks, newItemChecks, 'crossed-price safety checks');

      const oldFinalCheck = `  if(repairMoney(snapshot.final_total)>0 && Math.abs(repairMoney(snapshot.final_total)-repairMoney(order.total_amount))>0.01) reasons.push('final total');`;
      const newFinalCheck = `  const snapshotFinal=repairMoney(snapshot.final_total);\n  const snapshotWrapEnabled=['yes','true','1','on','add wrap','gift wrap'].includes(wrapText);\n  const snapshotWrapFee=snapshotWrapEnabled?repairMoney(snapshot.wrapping_cost):0;\n  const snapshotNoWrap=Math.max(0,Math.round((repairMoney(snapshot.normal_total)-repairMoney(snapshot.discount)+repairMoney(snapshot.delivery_fee))*100)/100);\n  const expectedSnapshotFinal=(snapshotWrapEnabled && snapshotWrapFee>0 && snapshotFinal>0 && Math.abs(snapshotFinal-snapshotNoWrap)<=1)\n    ? Math.max(0,Math.round((snapshotNoWrap+snapshotWrapFee)*100)/100)\n    : snapshotFinal;\n  const safeOrderTotal=repairMoney(invoiceOrderWithSafeSnapshotTotal(order).total_amount);\n  if(expectedSnapshotFinal>0 && Math.abs(expectedSnapshotFinal-safeOrderTotal)>0.01) reasons.push('final total');`;
      text = replaceRequired(text, oldFinalCheck, newFinalCheck, 'Gift Wrap final safety check');

      // invoiceRepairMoneyParsingPatch runs before this patch and intentionally replaces
      // the original one-line final-total assignment with parsedFinal + validity guard.
      // Target that transformed block so build order remains deterministic.
      const oldRepairFinal = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const finalTotal=parsedFinal || computed;`;
      const newRepairFinal = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const noWrapComputed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery)*100)/100);\n  const parsedFinalMissedWrap=Boolean(giftWrap && wrapFee>0 && parsedFinal>0 && Math.abs(parsedFinal-noWrapComputed)<=1);\n  const finalTotal=parsedFinalMissedWrap?computed:(parsedFinal||computed);`;
      text = replaceRequired(text, oldRepairFinal, newRepairFinal, 'Repair Gift Wrap final total');

      return { code: text, map: null };
    }

    return null;
  },
});
