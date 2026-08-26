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
 * - Gift Wrap must be included in Final Total. Legacy locked orders can have the wrap
 *   selected while total_amount still equals the no-wrap payable equation.
 * - Call Center / invoice totals are whole-rupee values, so sub-rupee differences
 *   from percentage discounts must not be treated as invoice corruption.
 *
 * The safety guard remains enabled; only the exact missed-wrap / rounding cases are normalized.
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
      const helperReplacement = `const repairItemCancelled = (value:unknown) => ['cancel','cancelled','canceled','cancel item'].includes(String(value||'').trim().toLowerCase());\n\nconst invoiceOrderWithSafeSnapshotTotal = (order:Order):Order => {\n  const snapshot=(order as any).invoice_confirm_snapshot as InvoiceRepairSnapshot|undefined;\n  const snapshotWrapText=String(snapshot?.gift_wrap||'').trim().toLowerCase();\n  const snapshotWrapEnabled=['yes','true','1','on','add wrap','gift wrap'].includes(snapshotWrapText);\n  const orderWrapEnabled=Boolean((order as any).gift_wrap_selected);\n  const wrapEnabled=snapshotWrapEnabled || orderWrapEnabled;\n  const wrapFee=Math.max(\n    snapshotWrapEnabled?repairMoney(snapshot?.wrapping_cost):0,\n    orderWrapEnabled?repairMoney((order as any).gift_wrap_fee):0\n  );\n  if(!wrapEnabled || wrapFee<=0) return order;\n\n  const storedFinal=repairMoney(order.total_amount);\n\n  // Use the same whole-rupee rule as Call Center / invoice output. Percentage offers\n  // can leave .25/.50/.75 internally, but the printed Final Total is a whole rupee.\n  const orderSubtotal=repairMoney((order as any).subtotal);\n  const orderQtyDiscount=repairMoney((order as any).special_offer_discount);\n  const orderDelivery=repairMoney((order as any).delivery_fee);\n  const orderNoWrap=Math.max(0,Math.round(orderSubtotal-orderQtyDiscount+orderDelivery));\n  const orderWithWrap=Math.max(0,Math.round(orderNoWrap+wrapFee));\n  if(storedFinal>0 && Math.abs(storedFinal-orderNoWrap)<=1 && orderWithWrap>0){\n    return {...order,total_amount:orderWithWrap} as Order;\n  }\n\n  if(snapshot){\n    const normal=repairMoney(snapshot.normal_total);\n    const discount=repairMoney(snapshot.discount);\n    const delivery=repairMoney(snapshot.delivery_fee);\n    const snapshotFinal=repairMoney(snapshot.final_total);\n    const snapshotNoWrap=Math.max(0,Math.round(normal-discount+delivery));\n    const snapshotWithWrap=Math.max(0,Math.round(snapshotNoWrap+wrapFee));\n    const snapshotMissedWrap=snapshotFinal>0 && Math.abs(snapshotFinal-snapshotNoWrap)<=1;\n    const storedMatchesSnapshotNoWrap=storedFinal>0 && Math.abs(storedFinal-snapshotNoWrap)<=1;\n    if((snapshotMissedWrap || storedMatchesSnapshotNoWrap) && snapshotWithWrap>0){\n      return {...order,total_amount:snapshotWithWrap} as Order;\n    }\n    if(snapshotFinal>0 && storedFinal>0 && Math.abs(Math.abs(snapshotFinal-storedFinal)-wrapFee)<=1){\n      return {...order,total_amount:Math.max(snapshotFinal,storedFinal)} as Order;\n    }\n  }\n  return order;\n};\n\nconst invoiceConfirmMismatchReasons = (order:Order):string[] => {`;
      text = replaceRequired(text, helperMarker, helperReplacement, 'legacy Gift Wrap total helper');

      const renderOld = `  const svg = buildExactInvoiceSvg(order,settings,false,pageItems,pageIndex,totalPages);\n  if (String((order as any).district || '').trim()) return svg;\n  const district = await resolveInvoiceDistrict(order, settings);`;
      const renderNew = `  const safeOrder=invoiceOrderWithSafeSnapshotTotal(order);\n  const svg = buildExactInvoiceSvg(safeOrder,settings,false,pageItems,pageIndex,totalPages);\n  if (String((safeOrder as any).district || '').trim()) return svg;\n  const district = await resolveInvoiceDistrict(safeOrder, settings);`;
      text = replaceRequired(text, renderOld, renderNew, 'normal invoice legacy Gift Wrap render');

      const oldItemChecks = `    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-repairMoney(a.unit_price))>0.01) reasons.push('item '+(i+1)+' price');\n    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-repairMoney(a.subtotal))>0.01) reasons.push('item '+(i+1)+' total');`;
      const newItemChecks = `    const actualUnit=repairMoney(a.unit_price);\n    const referenceUnit=Math.max(actualUnit,repairMoney((a as any).regular_unit_price),actualUnit+repairMoney((a as any).supplier_offer_discount_per_unit));\n    const referenceLine=Math.round(referenceUnit*Math.max(1,Number(a.quantity||1))*100)/100;\n    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-referenceUnit)>0.01) reasons.push('item '+(i+1)+' price');\n    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-referenceLine)>0.01) reasons.push('item '+(i+1)+' total');`;
      text = replaceRequired(text, oldItemChecks, newItemChecks, 'crossed-price safety checks');

      const oldFinalCheck = `  if(repairMoney(snapshot.final_total)>0 && Math.abs(repairMoney(snapshot.final_total)-repairMoney(order.total_amount))>0.01) reasons.push('final total');`;
      const newFinalCheck = `  const snapshotFinal=repairMoney(snapshot.final_total);\n  const snapshotWrapEnabled=['yes','true','1','on','add wrap','gift wrap'].includes(wrapText);\n  const orderWrapEnabled=Boolean((order as any).gift_wrap_selected);\n  const finalWrapEnabled=snapshotWrapEnabled || orderWrapEnabled;\n  const finalWrapFee=Math.max(\n    snapshotWrapEnabled?repairMoney(snapshot.wrapping_cost):0,\n    orderWrapEnabled?repairMoney((order as any).gift_wrap_fee):0\n  );\n  const snapshotNoWrap=Math.max(0,Math.round(repairMoney(snapshot.normal_total)-repairMoney(snapshot.discount)+repairMoney(snapshot.delivery_fee)));\n  const expectedSnapshotFinal=(snapshotWrapEnabled && finalWrapFee>0 && snapshotFinal>0 && Math.abs(snapshotFinal-snapshotNoWrap)<=1)\n    ? Math.max(0,Math.round(snapshotNoWrap+finalWrapFee))\n    : snapshotFinal;\n  const safeOrderTotal=repairMoney(invoiceOrderWithSafeSnapshotTotal(order).total_amount);\n  const finalDelta=Math.abs(expectedSnapshotFinal-safeOrderTotal);\n  const exactLegacyWrapDelta=Boolean(finalWrapEnabled && finalWrapFee>0 && Math.abs(finalDelta-finalWrapFee)<=1);\n  // Printed/Sheet totals are whole-rupee values. Ignore <= Rs.1 sub-rupee rounding only.\n  if(expectedSnapshotFinal>0 && finalDelta>1 && !exactLegacyWrapDelta) reasons.push('final total');`;
      text = replaceRequired(text, oldFinalCheck, newFinalCheck, 'Gift Wrap final safety check');

      const oldRepairFinal = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const finalTotal=parsedFinal || computed;`;
      const newRepairFinal = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const noWrapComputed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery)*100)/100);\n  const parsedFinalMissedWrap=Boolean(giftWrap && wrapFee>0 && parsedFinal>0 && Math.abs(parsedFinal-noWrapComputed)<=1);\n  const finalTotal=parsedFinalMissedWrap?computed:(parsedFinal||computed);`;
      text = replaceRequired(text, oldRepairFinal, newRepairFinal, 'Repair Gift Wrap final total');

      return { code: text, map: null };
    }

    return null;
  },
});
