/**
 * Restores the ProductCard OUT OF STOCK badge class order expected by the later
 * productCardOfferLayoutPatch after roundSpecialOfferPatch has run.
 * UI-only; no pricing, cart, stock, order, Sheet or invoice logic.
 */
export const wishlistRoundOfferPostCompatPatch = () => ({
  name: 'ora-wishlist-round-offer-post-compat-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/ProductCard.tsx')) return null;

    const legacy = 'className="absolute top-2 left-2 rounded-xl bg-red-600 px-2.5 py-1.5 text-xs font-black text-white shadow-lg sm:text-sm"';
    const current = 'className="absolute top-2 left-2 rounded-xl bg-red-600 px-2.5 py-1.5 text-xs sm:text-sm font-black text-white shadow-lg"';
    if (!code.includes(legacy)) return null;
    return { code: code.replace(legacy, current), map: null };
  },
});
