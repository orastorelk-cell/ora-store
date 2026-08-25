const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA invoice crossed math] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Invoice presentation rule:
 * - item Unit Price / line Total ALWAYS show the actual customer selling price
 * - Normal Total shows the higher crossed/reference-price total
 * - Offer Discount subtracts every saved/Special Offer + Qty Offer amount
 * - final payable amount remains the locked order total
 *
 * Example: actual Unit Price 850, crossed price 950 => row shows 850,
 * Normal Total shows 950, Offer Discount shows -100, final remains 850.
 * No cart, payment, stock, Sheet selling price, or customer charged price is changed.
 */
export const invoiceCrossedPriceMathPatch = () => ({
  name: 'ora-invoice-crossed-price-math-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/lib/exactInvoiceTemplateBase.ts')) {
      const priceMathMarker = `  const deliveryFree = order.delivery_included_in_item_price || Number(order.delivery_fee || 0) <= 0;`;
      const helper = `  const invoiceReferenceUnitPrice = (item:any) => {\n    const actual = Math.max(0, Number(item?.unit_price || 0));\n    const savedRegular = Math.max(0, Number(item?.regular_unit_price || 0));\n    const offerSaving = Math.max(0, Number(item?.supplier_offer_discount_per_unit || 0));\n    const derivedRegular = actual + offerSaving;\n    return Math.max(actual, savedRegular, derivedRegular);\n  };\n  const invoiceReferenceLineTotal = (item:any) =>\n    invoiceReferenceUnitPrice(item) * Math.max(0, Number(item?.quantity || 0));\n\n` + priceMathMarker;
      if (!text.includes('const invoiceReferenceUnitPrice = (item:any) =>')) {
        if (!text.includes(priceMathMarker)) throw new Error('[O-RA invoice crossed math] price helper marker not found');
        text = text.replace(priceMathMarker, helper);
      }

      // IMPORTANT: item rows intentionally remain item.unit_price / item.subtotal.
      // Only the summary's Normal Total uses crossed/reference prices.
      const oldNormalSubtotal = `  const normalSubtotal = Math.max(0, Number(order.subtotal || 0) + supplierOfferDiscount);`;
      const newNormalSubtotal = `  const normalSubtotal = Math.max(0, (order.items || []).reduce((sum,item) => sum + invoiceReferenceLineTotal(item), 0));`;
      text = replaceRequired(text, oldNormalSubtotal, newNormalSubtotal, 'normal crossed subtotal');

      text = replaceRequired(
        text,
        `{ label:'Sub Total', value:money(normalSubtotal) },`,
        `{ label:'Normal Total', value:money(normalSubtotal) },`,
        'Normal Total label',
      );

      return { code: text, map: null };
    }

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      // For existing orders, first reuse the old locked per-item crossed price when
      // it still agrees with the Confirm/Sheet Normal Total. If that old snapshot is
      // corrupt, rebuild only the reference-price metadata. The repaired item's
      // unit_price/subtotal remain the actual confirmed customer prices.
      const repairedItemMarker = `      unit_price:unit,\n      subtotal:line,\n      supplier_offer_discount_per_unit:0,`;
      const repairedItemReplacement = `      unit_price:unit,\n      subtotal:line,\n      regular_unit_price:Math.max(unit,repairMoney(prior?.regular_unit_price),unit+repairMoney(prior?.supplier_offer_discount_per_unit)),\n      supplier_offer_discount_per_unit:Math.max(0,Math.max(unit,repairMoney(prior?.regular_unit_price),unit+repairMoney(prior?.supplier_offer_discount_per_unit))-unit),`;
      text = replaceRequired(text, repairedItemMarker, repairedItemReplacement, 'repair item crossed price seed');

      const oldDisplaySpecial = `  const displaySpecial=Math.max(0,Math.round((normalTotal-subtotal)*100)/100);\n  if(displaySpecial>0 && repairedItems[0]){\n    repairedItems[0]={...repairedItems[0],supplier_offer_discount_per_unit:displaySpecial/Math.max(1,Number(repairedItems[0].quantity||1))};\n  }`;
      const newDisplaySpecial = `  const displaySpecial=Math.max(0,Math.round((normalTotal-subtotal)*100)/100);\n  const candidateCrossed=Math.round(repairedItems.reduce((sum,item)=>sum+Math.max(repairMoney(item.unit_price),repairMoney((item as any).regular_unit_price))*Math.max(1,Number(item.quantity||1)),0)*100)/100;\n  if(Math.abs(candidateCrossed-normalTotal)>0.01){\n    let allocated=0;\n    for(let i=0;i<repairedItems.length;i++){\n      const item=repairedItems[i];\n      const qty=Math.max(1,Number(item.quantity||1));\n      const actualLine=repairMoney(item.subtotal);\n      const saving=i===repairedItems.length-1\n        ? Math.max(0,Math.round((displaySpecial-allocated)*100)/100)\n        : Math.max(0,Math.round((displaySpecial*(subtotal>0?actualLine/subtotal:0))*100)/100);\n      allocated=Math.round((allocated+saving)*100)/100;\n      const perUnit=saving/qty;\n      repairedItems[i]={\n        ...item,\n        regular_unit_price:repairMoney(item.unit_price)+perUnit,\n        supplier_offer_discount_per_unit:perUnit,\n      };\n    }\n  }`;
      text = replaceRequired(text, oldDisplaySpecial, newDisplaySpecial, 'repair crossed-price reconstruction');

      // Guard the mathematical identity before a repaired PDF can download.
      const computedMarker = `  const computed=Math.max(0,Math.round((subtotal-qtyOffer+delivery+wrapFee)*100)/100);`;
      const computedReplacement = `  const crossedSubtotal=Math.round((subtotal+displaySpecial)*100)/100;\n  const allDiscount=Math.round((displaySpecial+qtyOffer)*100)/100;\n  const computed=Math.max(0,Math.round((crossedSubtotal-allDiscount+delivery+wrapFee)*100)/100);`;
      text = replaceRequired(text, computedMarker, computedReplacement, 'repair crossed-total equation');

      return { code: text, map: null };
    }

    return null;
  },
});
