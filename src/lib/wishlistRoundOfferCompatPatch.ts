const canonicalOfferBadge = `        {forcedOutOfStock ? (\n          <div className="absolute top-2 left-2 rounded-xl bg-red-600 px-2.5 py-1.5 text-xs sm:text-sm font-black text-white shadow-lg">\n            OUT OF STOCK\n          </div>\n        ) : (hasDiscount || hasAutoRoundOffer) && (\n          <div className="ora-product-card-discount absolute top-2 left-2 bg-orange-600 text-white text-xs sm:text-sm font-black px-2.5 py-1.5 rounded-xl shadow-lg">\n            {hasDiscount ? (type === 'variant' ? \`UP TO \${discountPercent}% OFF\` : \`\${discountPercent}% OFF\`) : 'SPECIAL OFFER'}\n          </div>\n        )}`;

/**
 * Keeps the existing round-special-offer ProductCard transform compatible with
 * the customer Wishlist heart inserted beside the image badges.
 * UI-only: no cart, pricing, stock, order, Sheet or invoice logic is changed.
 */
export const wishlistRoundOfferCompatPatch = () => ({
  name: 'ora-wishlist-round-offer-compat-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/ProductCard.tsx')) return null;
    if (code.includes(canonicalOfferBadge)) return { code, map: null };

    const start = code.indexOf('        {forcedOutOfStock ? (');
    const wishlistMarker = '\n\n        <button\n          type="button"\n          onClick={handleWishlist}';
    const end = code.indexOf(wishlistMarker, start);
    if (start < 0 || end < 0) return null;

    return {
      code: code.slice(0, start) + canonicalOfferBadge + code.slice(end),
      map: null,
    };
  },
});
