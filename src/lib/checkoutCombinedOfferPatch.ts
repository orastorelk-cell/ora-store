const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA checkout combined offer] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Checkout + Website-order Sheet metadata follow-up.
 *
 * Customer payable totals are NOT changed. The display-only product Special Offer
 * is shown separately from the existing Qty Offer, and a combined Total Discount is
 * shown for clarity. The order keeps special_offer_discount as the Qty Offer only so
 * all existing order/payment/call-center calculations remain unchanged.
 *
 * For Google Sheets we only attach values using the already-deployed existing columns
 * (Offer, Discount (Rs), Normal Total (Rs)). No Apps Script/header change is required.
 */
export const checkoutCombinedOfferPatch = () => ({
  name: 'ora-checkout-combined-offer-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/components/CheckoutModal.tsx')) {
      let text = code;

      text = replaceRequired(
        text,
        "import { displayUnitPrice } from '../lib/productVariants';",
        "import { displayUnitPrice, normalizedProductType, regularDisplayUnitPrice } from '../lib/productVariants';\nimport { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../lib/roundSpecialOffer';",
        'Checkout imports',
      );

      text = replaceRequired(
        text,
        `  const finalTotal = cartFinalProductsTotal + deliveryFee + giftWrapFee;\n\n  // Configurable advance rule controlled by Main Admin`,
        `  const finalTotal = cartFinalProductsTotal + deliveryFee + giftWrapFee;\n\n  // Product-level Special Offer is display-only: it raises only the crossed reference\n  // price. Qty Offer is the only discount that reduces the real payable cart total.\n  const checkoutProductSpecialOfferDiscount = Math.round(cart.reduce((sum, item) => {\n    const currentUnitPrice = displayUnitPrice(item.product, settings, item.variant);\n    const savedRegularUnitPrice = regularDisplayUnitPrice(item.product, settings, item.variant);\n    const quantity = Math.max(1, Number(item.quantity || 1));\n\n    // Existing saved/supplier offers have priority and use their already-saved crossed price.\n    if (savedRegularUnitPrice > currentUnitPrice + 0.001) {\n      return sum + (savedRegularUnitPrice - currentUnitPrice) * quantity;\n    }\n\n    const preview = calculateRoundSpecialOffer({\n      currentPrice: currentUnitPrice,\n      enabled: normalizedProductType(item.product) !== 'bundle' && roundSpecialOfferEnabledForProduct(item.product),\n      percent: roundSpecialOfferPercentForSelection(item.product, item.variant),\n      hasExistingDiscount: false,\n    });\n    return sum + (preview.active ? preview.saving * quantity : 0);\n  }, 0) * 100) / 100;\n  const checkoutTotalOfferDiscount = Math.round((checkoutProductSpecialOfferDiscount + cartSpecialOfferDiscount) * 100) / 100;\n  const checkoutNormalProductsTotal = Math.round((cartSubtotal + checkoutProductSpecialOfferDiscount) * 100) / 100;\n\n  // Configurable advance rule controlled by Main Admin`,
        'Checkout offer totals',
      );

      const oldSummary = `                <div className="flex justify-between text-gray-500">\n                  <span>Products Subtotal</span>\n                  <span className="font-bold text-gray-800">Rs. {formatLkr(cartSubtotal)}</span>\n                </div>\n                {cartSpecialOfferDiscount > 0 && (\n                  <div className="my-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">\n                    <div className="flex items-center justify-between text-orange-700">\n                      <span className="font-black">🎉 SPECIAL MULTI-BUY OFFER • {cartMultiBuyDiscountRate}% OFF</span>\n                      <span className="font-black">- Rs. {formatLkr(cartSpecialOfferDiscount)}</span>\n                    </div>\n                    <p className="mt-0.5 text-[9px] font-semibold text-orange-600">You save more when you buy more!</p>\n                  </div>\n                )}`;

      const newSummary = `                <div className="flex justify-between text-gray-500">\n                  <span>{checkoutProductSpecialOfferDiscount > 0 ? 'Products Normal Total' : 'Products Subtotal'}</span>\n                  <span className="font-bold text-gray-800">Rs. {formatLkr(checkoutProductSpecialOfferDiscount > 0 ? checkoutNormalProductsTotal : cartSubtotal)}</span>\n                </div>\n                {checkoutProductSpecialOfferDiscount > 0 && (\n                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">\n                    <div className="flex items-center justify-between gap-3 text-amber-800">\n                      <span className="font-black">🏷️ SPECIAL OFFER</span>\n                      <span className="shrink-0 font-black">- Rs. {formatLkr(checkoutProductSpecialOfferDiscount)}</span>\n                    </div>\n                    <p className="mt-0.5 text-[9px] font-semibold text-amber-700">Special Offer saving from the crossed product prices.</p>\n                  </div>\n                )}\n                {cartSpecialOfferDiscount > 0 && (\n                  <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">\n                    <div className="flex items-center justify-between gap-3 text-orange-700">\n                      <span className="font-black">🎉 QTY OFFER • {cartMultiBuyDiscountRate}% OFF</span>\n                      <span className="shrink-0 font-black">- Rs. {formatLkr(cartSpecialOfferDiscount)}</span>\n                    </div>\n                    <p className="mt-0.5 text-[9px] font-semibold text-orange-600">You save more when you buy more!</p>\n                  </div>\n                )}\n                {checkoutTotalOfferDiscount > 0 && (\n                  <div className="mt-2 flex items-center justify-between rounded-lg bg-gray-900 px-3 py-2 text-white">\n                    <span className="font-black">Total Discount</span>\n                    <span className="font-black">- Rs. {formatLkr(checkoutTotalOfferDiscount)}</span>\n                  </div>\n                )}`;

      text = replaceRequired(text, oldSummary, newSummary, 'Checkout summary UI');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      let text = code;
      const orderEnd = `      notes: formData.notes,\n      created_at: new Date().toISOString(),\n    };\n\n    // Stock is NOT deducted when the order is created.`;
      const orderEndWithSheetMetadata = `      notes: formData.notes,\n      created_at: new Date().toISOString(),\n    };\n\n    // Keep the real order math untouched. These extra fields are Sheet/display metadata\n    // only, using columns that already exist in the deployed Google Apps Script.\n    const sheetProductSpecialOfferDiscount = Math.round((newOrder.items || []).reduce(\n      (sum: number, item: any) => sum + Math.max(0, Number(item?.supplier_offer_discount_per_unit || 0)) * Math.max(1, Number(item?.quantity || 1)),\n      0,\n    ) * 100) / 100;\n    const sheetCombinedOfferDiscount = Math.round((sheetProductSpecialOfferDiscount + special_offer_discount) * 100) / 100;\n    const sheetNormalDisplayTotal = Math.round((subtotal + sheetProductSpecialOfferDiscount) * 100) / 100;\n    const sheetOfferParts: string[] = [];\n    if (sheetProductSpecialOfferDiscount > 0) sheetOfferParts.push(\`Special Offer Rs. \${sheetProductSpecialOfferDiscount}\`);\n    if (special_offer_discount > 0) sheetOfferParts.push(\`Qty Offer Rs. \${special_offer_discount} (\${totalQuantity} items)\`);\n    Object.assign(newOrder as any, {\n      display_special_offer_discount: sheetProductSpecialOfferDiscount,\n      qty_offer_discount: special_offer_discount,\n      combined_offer_discount: sheetCombinedOfferDiscount,\n      Offer: sheetOfferParts.length ? sheetOfferParts.join(' + ') : 'No Offer',\n      'Discount (Rs)': sheetCombinedOfferDiscount,\n      'Normal Total (Rs)': sheetNormalDisplayTotal,\n    });\n\n    // Stock is NOT deducted when the order is created.`;

      text = replaceRequired(text, orderEnd, orderEndWithSheetMetadata, 'Website order Sheet metadata');
      return { code: text, map: null };
    }

    return null;
  },
});
