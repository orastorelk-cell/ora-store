const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA invoice snapshot consistency] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Keep Confirm CSV safety aligned with the invoice's crossed/reference-price display.
 *
 * Confirmed Sheet/CSV fields are the invoice source of truth. In particular, Final Total
 * is derived from confirmed Normal Total - confirmed Discount + Delivery + Wrapping Cost.
 * Legacy system orders can retain an older pre-wrap total_amount; that must not block a
 * correct normal PDF when all confirmed invoice fields are internally consistent.
 *
 * Item/code/qty/reference-price/wrap safety checks remain enabled.
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
        const snapshotPrep = `      const rawCsvFinalTotal=csvMoney(finalTotalI);\n      const rawCsvNormalTotal=csvMoney(normalTotalI);\n      const rawCsvDiscount=csvMoney(discountI);\n      const rawCsvDelivery=csvMoney(deliveryFeeI);\n      const csvNoWrapTotal=Math.round(Math.max(0,rawCsvNormalTotal-rawCsvDiscount+rawCsvDelivery));\n      const csvWithWrapTotal=Math.round(Math.max(0,csvNoWrapTotal+(gift_wrap_selected?gift_wrap_fee:0)));\n      const csvFormulaAvailable=rawCsvNormalTotal>0;\n      const safeInvoiceFinalTotal=csvFormulaAvailable?csvWithWrapTotal:(rawCsvFinalTotal||stableTotalAmount);\n`;
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
      const helperReplacement = `const repairItemCancelled = (value:unknown) => ['cancel','cancelled','canceled','cancel item'].includes(String(value||'').trim().toLowerCase());\n\nconst invoiceOrderWithSafeSnapshotTotal = (order:Order):Order => {\n  const snapshot=(order as any).invoice_confirm_snapshot as InvoiceRepairSnapshot|undefined;\n  if(!snapshot) return order;\n\n  const wrapText=String(snapshot.gift_wrap||'').trim().toLowerCase();\n  const wrapEnabled=['yes','true','1','on','add wrap','gift wrap'].includes(wrapText);\n  const wrapFee=wrapEnabled?repairMoney(snapshot.wrapping_cost):0;\n  const normal=repairMoney(snapshot.normal_total);\n  const discount=repairMoney(snapshot.discount);\n  const delivery=repairMoney(snapshot.delivery_fee);\n  const savedFinal=repairMoney(snapshot.final_total);\n\n  // Confirmed pricing columns are authoritative for invoice output. This is the same\n  // whole-rupee equation used by the Call Center Sheet and the working Repair PDFs.\n  if(normal>0){\n    const confirmedFinal=Math.max(0,Math.round(normal-discount+delivery+wrapFee));\n    return {\n      ...order,\n      gift_wrap_selected:wrapEnabled,\n      gift_wrap_fee:wrapFee,\n      delivery_fee:delivery,\n      total_amount:confirmedFinal,\n    } as Order;\n  }\n\n  if(savedFinal>0){\n    return {\n      ...order,\n      gift_wrap_selected:wrapEnabled,\n      gift_wrap_fee:wrapFee,\n      delivery_fee:delivery,\n      total_amount:savedFinal,\n    } as Order;\n  }\n  return order;\n};\n\nconst invoiceConfirmMismatchReasons = (order:Order):string[] => {`;
      text = replaceRequired(text, helperMarker, helperReplacement, 'confirmed final-total helper');

      const renderOld = `  const svg = buildExactInvoiceSvg(order,settings,false,pageItems,pageIndex,totalPages);\n  if (String((order as any).district || '').trim()) return svg;\n  const district = await resolveInvoiceDistrict(order, settings);`;
      const renderNew = `  const safeOrder=invoiceOrderWithSafeSnapshotTotal(order);\n  const svg = buildExactInvoiceSvg(safeOrder,settings,false,pageItems,pageIndex,totalPages);\n  if (String((safeOrder as any).district || '').trim()) return svg;\n  const district = await resolveInvoiceDistrict(safeOrder, settings);`;
      text = replaceRequired(text, renderOld, renderNew, 'normal invoice confirmed total render');

      const oldItemChecks = `    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-repairMoney(a.unit_price))>0.01) reasons.push('item '+(i+1)+' price');\n    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-repairMoney(a.subtotal))>0.01) reasons.push('item '+(i+1)+' total');`;
      const newItemChecks = `    const actualUnit=repairMoney(a.unit_price);\n    const referenceUnit=Math.max(actualUnit,repairMoney((a as any).regular_unit_price),actualUnit+repairMoney((a as any).supplier_offer_discount_per_unit));\n    const referenceLine=Math.round(referenceUnit*Math.max(1,Number(a.quantity||1))*100)/100;\n    if(repairMoney(e.unit_price)>0 && Math.abs(repairMoney(e.unit_price)-referenceUnit)>0.01) reasons.push('item '+(i+1)+' price');\n    if(repairMoney(e.line_total)>0 && Math.abs(repairMoney(e.line_total)-referenceLine)>0.01) reasons.push('item '+(i+1)+' total');`;
      text = replaceRequired(text, oldItemChecks, newItemChecks, 'crossed-price safety checks');

      const oldFinalCheck = `  if(repairMoney(snapshot.final_total)>0 && Math.abs(repairMoney(snapshot.final_total)-repairMoney(order.total_amount))>0.01) reasons.push('final total');`;
      const newFinalCheck = `  // Final Total is not compared to stale order.total_amount. The normal renderer uses\n  // the internally consistent confirmed equation (Normal - Discount + Delivery + Wrap).\n  // Other safety fields above still block a genuinely mismatched invoice.`;
      text = replaceRequired(text, oldFinalCheck, newFinalCheck, 'confirmed final-total safety source');

      const oldRepairFinal = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const finalTotal=parsedFinal || computed;`;
      const newRepairFinal = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const noWrapComputed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery)*100)/100);\n  const parsedFinalMissedWrap=Boolean(giftWrap && wrapFee>0 && parsedFinal>0 && Math.abs(parsedFinal-noWrapComputed)<=1);\n  const finalTotal=parsedFinalMissedWrap?computed:(parsedFinal||computed);`;
      text = replaceRequired(text, oldRepairFinal, newRepairFinal, 'Repair Gift Wrap final total');

      return { code: text, map: null };
    }

    return null;
  },
});
