const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA combo checkout offer] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Checkout display-only follow-up for Combo Packs.
 *
 * Reuses the exact same component-derived crossed-price calculation as the storefront.
 * The combo's real customer/payable price and Qty Offer math are intentionally untouched.
 */
export const bundleCheckoutOfferPatch = () => ({
  name: 'ora-bundle-checkout-offer-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/CheckoutModal.tsx')) return null;

    let text = code;

    const offerImport = "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../lib/roundSpecialOffer';\n";
    text = replaceRequired(
      text,
      offerImport,
      offerImport + "import { bundleComponentOfferDisplay } from '../lib/bundleComponentOfferDisplay';\n",
      'Checkout combo helper import',
    );

    text = replaceRequired(
      text,
      "    cart,\n    isCheckoutOpen,",
      "    cart,\n    products,\n    isCheckoutOpen,",
      'Checkout products access',
    );

    const oldCalculation = `    // Existing saved/supplier offers have priority and use their already-saved crossed price.\n    if (savedRegularUnitPrice > currentUnitPrice + 0.001) {\n      return sum + (savedRegularUnitPrice - currentUnitPrice) * quantity;\n    }\n\n    const preview = calculateRoundSpecialOffer({\n      currentPrice: currentUnitPrice,\n      enabled: normalizedProductType(item.product) !== 'bundle' && roundSpecialOfferEnabledForProduct(item.product),\n      percent: roundSpecialOfferPercentForSelection(item.product, item.variant),\n      hasExistingDiscount: false,\n    });`;

    const newCalculation = `    // Combo Packs use the same component-derived crossed/reference total shown on\n    // the storefront. This is display-only; the real combo price stays unchanged.\n    if (normalizedProductType(item.product) === 'bundle') {\n      const comboOffer = bundleComponentOfferDisplay(item.product, products, settings);\n      return sum + (comboOffer.active ? comboOffer.saving * quantity : 0);\n    }\n\n    // Existing saved/supplier offers have priority and use their already-saved crossed price.\n    if (savedRegularUnitPrice > currentUnitPrice + 0.001) {\n      return sum + (savedRegularUnitPrice - currentUnitPrice) * quantity;\n    }\n\n    const preview = calculateRoundSpecialOffer({\n      currentPrice: currentUnitPrice,\n      enabled: roundSpecialOfferEnabledForProduct(item.product),\n      percent: roundSpecialOfferPercentForSelection(item.product, item.variant),\n      hasExistingDiscount: false,\n    });`;

    text = replaceRequired(text, oldCalculation, newCalculation, 'Checkout combo Special Offer calculation');

    return { code: text, map: null };
  },
});
