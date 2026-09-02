const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA combo component offer display] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Combo Pack display metadata only.
 *
 * The combo customer/payable price is intentionally untouched. Crossed price,
 * saving and derived % come from the exact component items and their quantities.
 */
export const bundleComponentOfferDisplayPatch = () => ({
  name: 'ora-bundle-component-offer-display-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/components/ProductCard.tsx')) {
      let text = code;

      const offerImport = "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../lib/roundSpecialOffer';\n";
      text = replaceRequired(
        text,
        offerImport,
        offerImport + "import { bundleComponentOfferDisplay } from '../lib/bundleComponentOfferDisplay';\n",
        'ProductCard helper import',
      );

      text = replaceRequired(
        text,
        "  const { language, addToCart, setSelectedProduct, startBuyNow, settings } = useStore();",
        "  const { language, addToCart, setSelectedProduct, startBuyNow, settings, products } = useStore();",
        'ProductCard products access',
      );

      const calcMarker = `  const autoReferencePrice = !product.force_out_of_stock && !hasDiscount && range.min === range.max\n    ? (autoRoundOffers.find((offer) => offer.active && Math.abs(offer.offerPrice - range.min) < 0.01)?.regularPrice || 0)\n    : 0;\n  const needsSelection = type === 'variant';`;
      const calcReplacement = `  const autoReferencePrice = !product.force_out_of_stock && !hasDiscount && range.min === range.max\n    ? (autoRoundOffers.find((offer) => offer.active && Math.abs(offer.offerPrice - range.min) < 0.01)?.regularPrice || 0)\n    : 0;\n  const bundleOffer = type === 'bundle'\n    ? bundleComponentOfferDisplay(product, products, settings)\n    : { active: false, referencePrice: 0, customerPrice: range.min, saving: 0, percent: 0 };\n  const hasBundleOffer = !product.force_out_of_stock && type === 'bundle' && bundleOffer.active;\n  const needsSelection = type === 'variant';`;
      text = replaceRequired(text, calcMarker, calcReplacement, 'ProductCard combo calculation');

      const crossedBlock = `            {hasDiscount && type !== 'variant' && (\n              <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(regularPrice)}</div>\n            )}\n            {!hasDiscount && autoReferencePrice > 0 && (\n              <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(autoReferencePrice)}</div>\n            )}`;
      const crossedReplacement = `            {hasBundleOffer && (\n              <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(bundleOffer.referencePrice)}</div>\n            )}\n            {!hasBundleOffer && hasDiscount && type !== 'variant' && (\n              <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(regularPrice)}</div>\n            )}\n            {!hasBundleOffer && !hasDiscount && autoReferencePrice > 0 && (\n              <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(autoReferencePrice)}</div>\n            )}`;
      text = replaceRequired(text, crossedBlock, crossedReplacement, 'ProductCard crossed price');

      text = replaceRequired(
        text,
        "            {!forcedOutOfStock && (hasDiscount || hasAutoRoundOffer) && (",
        "            {!forcedOutOfStock && (hasBundleOffer || hasDiscount || hasAutoRoundOffer) && (",
        'ProductCard offer badge visibility',
      );

      const badgeLabel = "                {hasDiscount ? (type === 'variant' ? `UP TO ${discountPercent}% OFF` : `${discountPercent}% OFF`) : (type === 'variant' ? `UP TO ${autoRoundDiscountPercent}% OFF` : `${autoRoundDiscountPercent}% OFF`)}";
      const badgeReplacement = "                {hasBundleOffer ? `SAVE Rs. ${formatLkr(bundleOffer.saving)}` : (hasDiscount ? (type === 'variant' ? `UP TO ${discountPercent}% OFF` : `${discountPercent}% OFF`) : (type === 'variant' ? `UP TO ${autoRoundDiscountPercent}% OFF` : `${autoRoundDiscountPercent}% OFF`))}";
      text = replaceRequired(text, badgeLabel, badgeReplacement, 'ProductCard combo saving badge');

      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductDetailModal.tsx')) {
      let text = code;

      const offerImport = "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../lib/roundSpecialOffer';\n";
      text = replaceRequired(
        text,
        offerImport,
        offerImport + "import { bundleComponentOfferDisplay } from '../lib/bundleComponentOfferDisplay';\n",
        'ProductDetail helper import',
      );

      const calcMarker = `  const hasDisplayedSpecialOffer = !selectedProduct.force_out_of_stock && (hasDiscount || autoRoundSpecialOffer.active);\n  const displayedRegularPrice = hasDiscount ? regularUnitPrice : autoRoundSpecialOffer.regularPrice;\n  const deliveryLabel = settings.free_delivery_enabled`;
      const calcReplacement = `  const bundleOffer = type === 'bundle'\n    ? bundleComponentOfferDisplay(selectedProduct, products, settings)\n    : { active: false, referencePrice: 0, customerPrice: unitPrice, saving: 0, percent: 0 };\n  const hasBundleOffer = !selectedProduct.force_out_of_stock && type === 'bundle' && bundleOffer.active;\n  const hasDisplayedSpecialOffer = !selectedProduct.force_out_of_stock && (hasBundleOffer || hasDiscount || autoRoundSpecialOffer.active);\n  const displayedRegularPrice = hasBundleOffer ? bundleOffer.referencePrice : (hasDiscount ? regularUnitPrice : autoRoundSpecialOffer.regularPrice);\n  const deliveryLabel = settings.free_delivery_enabled`;
      text = replaceRequired(text, calcMarker, calcReplacement, 'ProductDetail combo calculation');

      const imageBadge = "{hasDisplayedSpecialOffer && <span className=\"absolute left-4 top-4 rounded-xl bg-orange-600 px-3 py-2 text-sm font-black text-white shadow-lg\">{hasDiscount ? `${discountPercent}% OFF` : `${autoRoundSpecialOffer.percent}% OFF`}</span>}";
      const imageBadgeReplacement = "{hasDisplayedSpecialOffer && <span className=\"absolute left-4 top-4 rounded-xl bg-orange-600 px-3 py-2 text-sm font-black text-white shadow-lg\">{hasBundleOffer ? `SAVE Rs. ${formatLkr(bundleOffer.saving)}` : (hasDiscount ? `${discountPercent}% OFF` : `${autoRoundSpecialOffer.percent}% OFF`)}</span>}";
      text = replaceRequired(text, imageBadge, imageBadgeReplacement, 'ProductDetail image saving badge');

      const priceBadge = "{hasDisplayedSpecialOffer && <span className=\"rounded-full bg-orange-100 px-2 py-1 text-[10px] font-black text-orange-700\">SPECIAL OFFER</span>}";
      const priceBadgeReplacement = "{hasDisplayedSpecialOffer && <span className=\"rounded-full bg-orange-100 px-2 py-1 text-[10px] font-black text-orange-700\">{hasBundleOffer ? `SAVE Rs. ${formatLkr(bundleOffer.saving)}` : 'SPECIAL OFFER'}</span>}";
      text = replaceRequired(text, priceBadge, priceBadgeReplacement, 'ProductDetail price saving badge');

      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      let text = code;

      const offerImport = "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from '../../lib/roundSpecialOffer';\n";
      text = replaceRequired(
        text,
        offerImport,
        offerImport + "import { bundleComponentOfferDisplay } from '../../lib/bundleComponentOfferDisplay';\n",
        'Admin helper import',
      );

      const nonBundleOfferStart = "                      {normalizedProductType(p) !== 'bundle' && (() => {";
      const comboSummary = `                      {normalizedProductType(p) === 'bundle' && (() => {\n                        const comboOffer = bundleComponentOfferDisplay(p, products, settings);\n                        if (!comboOffer.active) return <p className="mt-1 text-[8px] font-bold text-neutral-600">Combo offer unavailable</p>;\n                        return <div className="mt-1.5">\n                          <p className="text-[9px] font-black text-orange-300">{comboOffer.percent}% OFF</p>\n                          <p className="mt-0.5 text-[8px] font-bold text-neutral-500">Crossed: Rs. {comboOffer.referencePrice.toLocaleString()}</p>\n                          <p className="mt-0.5 text-[8px] font-bold text-emerald-400">Save Rs. {comboOffer.saving.toLocaleString()}</p>\n                        </div>;\n                      })()}\n` + nonBundleOfferStart;
      text = replaceRequired(text, nonBundleOfferStart, comboSummary, 'Admin Product List combo offer summary');

      return { code: text, map: null };
    }

    return null;
  },
});
