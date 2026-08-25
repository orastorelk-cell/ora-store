const replaceOnce = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA special offer percent badge] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * UI-only follow-up to roundSpecialOfferPatch.
 * Changes only the orange badge drawn on product images from "SPECIAL OFFER"
 * to the calculated "% OFF" value. The price-area "SPECIAL OFFER" label,
 * charged price, order snapshots, Sheet values and Invoice values are untouched.
 */
export const roundSpecialOfferPercentBadgePatch = () => ({
  name: 'ora-round-special-offer-percent-badge-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/components/ProductCard.tsx')) {
      let text = code;
      text = replaceOnce(
        text,
        "  const hasAutoRoundOffer = !hasDiscount && autoRoundOffers.some((offer) => offer.active);\n  const autoReferencePrice = !hasDiscount && range.min === range.max",
        "  const hasAutoRoundOffer = !hasDiscount && autoRoundOffers.some((offer) => offer.active);\n  const autoRoundDiscountPercent = Math.max(0, ...autoRoundOffers.filter((offer) => offer.active).map((offer) => offer.percent));\n  const autoReferencePrice = !hasDiscount && range.min === range.max",
        'ProductCard percent calculation',
      );
      text = replaceOnce(
        text,
        "            {hasDiscount ? (type === 'variant' ? `UP TO ${discountPercent}% OFF` : `${discountPercent}% OFF`) : 'SPECIAL OFFER'}",
        "            {hasDiscount ? (type === 'variant' ? `UP TO ${discountPercent}% OFF` : `${discountPercent}% OFF`) : (type === 'variant' ? `UP TO ${autoRoundDiscountPercent}% OFF` : `${autoRoundDiscountPercent}% OFF`)}",
        'ProductCard image badge',
      );
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductDetailModal.tsx')) {
      let text = code;
      text = replaceOnce(
        text,
        "{hasDisplayedSpecialOffer && <span className=\"absolute left-4 top-4 rounded-xl bg-orange-600 px-3 py-2 text-sm font-black text-white shadow-lg\">{hasDiscount ? `${discountPercent}% OFF` : 'SPECIAL OFFER'}</span>}",
        "{hasDisplayedSpecialOffer && <span className=\"absolute left-4 top-4 rounded-xl bg-orange-600 px-3 py-2 text-sm font-black text-white shadow-lg\">{hasDiscount ? `${discountPercent}% OFF` : `${autoRoundSpecialOffer.percent}% OFF`}</span>}",
        'ProductDetail image badge',
      );
      return { code: text, map: null };
    }

    return null;
  },
});
