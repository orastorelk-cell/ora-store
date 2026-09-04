/**
 * Normalizes the ProductCard OUT OF STOCK badge class order to the exact legacy
 * marker expected by roundSpecialOfferPatch. UI-only; no pricing/order logic.
 */
export const wishlistRoundOfferCompatPatch = () => ({
  name: 'ora-wishlist-round-offer-compat-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/ProductCard.tsx')) return null;

    const current = 'className="absolute top-2 left-2 rounded-xl bg-red-600 px-2.5 py-1.5 text-xs sm:text-sm font-black text-white shadow-lg"';
    const legacy = 'className="absolute top-2 left-2 rounded-xl bg-red-600 px-2.5 py-1.5 text-xs font-black text-white shadow-lg sm:text-sm"';
    if (!code.includes(current)) return null;
    return { code: code.replace(current, legacy), map: null };
  },
});
