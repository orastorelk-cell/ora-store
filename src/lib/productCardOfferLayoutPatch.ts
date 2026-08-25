const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (to && text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA product card offer layout] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Storefront ProductCard UI-only refinement.
 *
 * - Removes the % OFF badge from the product image.
 * - Shows the same % OFF badge beside the selling price instead.
 * - Makes cards stretch to the same row height and anchors action buttons at the bottom.
 *
 * Pricing, cart, order, Google Sheet and Invoice calculations are untouched.
 */
export const productCardOfferLayoutPatch = () => ({
  name: 'ora-product-card-offer-layout-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/ProductCard.tsx')) return null;

    let text = code;

    text = replaceRequired(
      text,
      'className="ora-product-card group self-start bg-white border border-gray-100 hover:border-gray-200 rounded-2xl p-3 cursor-pointer hover:shadow-md transition-all duration-300"',
      'className="ora-product-card group flex h-full flex-col bg-white border border-gray-100 hover:border-gray-200 rounded-2xl p-3 cursor-pointer hover:shadow-md transition-all duration-300"',
      'card stretch layout',
    );

    text = replaceRequired(
      text,
      '      <div className="ora-product-card-content space-y-1.5">',
      '      <div className="ora-product-card-content flex flex-1 flex-col space-y-1.5">',
      'content flex layout',
    );

    const imageBadge = `        {(hasDiscount || hasAutoRoundOffer) && (\n          <div className="ora-product-card-discount absolute top-2 left-2 bg-orange-600 text-white text-xs sm:text-sm font-black px-2.5 py-1.5 rounded-xl shadow-lg">\n            {hasDiscount ? (type === 'variant' ? \`UP TO \${discountPercent}% OFF\` : \`\${discountPercent}% OFF\`) : (type === 'variant' ? \`UP TO \${autoRoundDiscountPercent}% OFF\` : \`\${autoRoundDiscountPercent}% OFF\`)}\n          </div>\n        )}\n\n`;
    text = replaceRequired(text, imageBadge, '', 'remove image offer badge');

    const oldPriceArea = `        <div>\n          {hasDiscount && type !== 'variant' && (\n            <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(regularPrice)}</div>\n          )}\n          {!hasDiscount && autoReferencePrice > 0 && (\n            <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(autoReferencePrice)}</div>\n          )}\n          <span className="ora-product-card-price text-base sm:text-lg font-black text-orange-600">\n            {range.min === range.max ? \`Rs. \${formatLkr(range.min)}\` : \`Rs. \${formatLkr(range.min)} - \${formatLkr(range.max)}\`}\n          </span>\n          <p className={\`ora-product-card-delivery mt-1 flex items-center gap-1 whitespace-nowrap text-[9px] font-black leading-tight \${settings.free_delivery_enabled ? 'text-emerald-600' : 'text-gray-500'}\`}>\n            <span aria-hidden="true">🚚</span>\n            <span>{deliveryLabel}</span>\n          </p>\n        </div>`;

    const newPriceArea = `        <div className="mt-auto pt-1">\n          <div className="min-h-[18px]">\n            {hasDiscount && type !== 'variant' && (\n              <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(regularPrice)}</div>\n            )}\n            {!hasDiscount && autoReferencePrice > 0 && (\n              <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(autoReferencePrice)}</div>\n            )}\n          </div>\n          <div className="flex min-h-[28px] flex-wrap items-center gap-1.5">\n            <span className="ora-product-card-price text-base sm:text-lg font-black text-orange-600">\n              {range.min === range.max ? \`Rs. \${formatLkr(range.min)}\` : \`Rs. \${formatLkr(range.min)} - \${formatLkr(range.max)}\`}\n            </span>\n            {(hasDiscount || hasAutoRoundOffer) && (\n              <span className="ora-product-card-discount inline-flex rounded-full bg-orange-600 px-2 py-1 text-[9px] font-black leading-none text-white shadow-sm">\n                {hasDiscount ? (type === 'variant' ? \`UP TO \${discountPercent}% OFF\` : \`\${discountPercent}% OFF\`) : (type === 'variant' ? \`UP TO \${autoRoundDiscountPercent}% OFF\` : \`\${autoRoundDiscountPercent}% OFF\`)}\n              </span>\n            )}\n          </div>\n          <p className={\`ora-product-card-delivery mt-1 flex items-center gap-1 whitespace-nowrap text-[9px] font-black leading-tight \${settings.free_delivery_enabled ? 'text-emerald-600' : 'text-gray-500'}\`}>\n            <span aria-hidden="true">🚚</span>\n            <span>{deliveryLabel}</span>\n          </p>\n        </div>`;

    text = replaceRequired(text, oldPriceArea, newPriceArea, 'price-area offer badge');

    text = replaceRequired(
      text,
      '      <div className="ora-product-card-actions grid grid-cols-2 gap-2 mt-3">',
      '      <div className="ora-product-card-actions mt-3 grid grid-cols-2 gap-2">',
      'action row normalization',
    );

    return { code: text, map: null };
  },
});
