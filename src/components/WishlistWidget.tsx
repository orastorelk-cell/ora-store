import React from 'react';
import { Heart, ShoppingBag, Trash2, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { activeVariants, normalizedProductType, productPriceRange } from '../lib/productVariants';
import { formatLkr } from '../lib/currency';
import {
  readWishlistIds,
  removeFromWishlist,
  WISHLIST_CHANGED_EVENT,
  WISHLIST_OPEN_EVENT,
} from '../lib/wishlist';

export const WishlistWidget: React.FC = () => {
  const { products, settings, setSelectedProduct, addToCart } = useStore();
  const [ids, setIds] = React.useState<string[]>(() => readWishlistIds());
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const sync = () => setIds(readWishlistIds());
    const show = () => { sync(); setOpen(true); };
    window.addEventListener(WISHLIST_CHANGED_EVENT, sync);
    window.addEventListener(WISHLIST_OPEN_EVENT, show);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(WISHLIST_CHANGED_EVENT, sync);
      window.removeEventListener(WISHLIST_OPEN_EVENT, show);
      window.removeEventListener('storage', sync);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const savedProducts = ids
    .map((id) => products.find((product) => product.id === id && product.status !== 'Draft'))
    .filter(Boolean) as typeof products;

  const viewProduct = (product: typeof products[number]) => {
    setOpen(false);
    setSelectedProduct(product);
  };

  const addProduct = (product: typeof products[number]) => {
    if (normalizedProductType(product) === 'variant') {
      viewProduct(product);
      return;
    }
    addToCart(product, 1);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-30 hidden items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-xs font-black text-gray-800 shadow-xl transition hover:border-rose-200 hover:text-rose-600 md:flex"
        title="Wishlist"
      >
        <Heart className={`h-4 w-4 ${savedProducts.length ? 'fill-rose-500 text-rose-500' : 'text-gray-500'}`} />
        <span>Wishlist</span>
        {savedProducts.length > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] text-white">
            {savedProducts.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex justify-end bg-black/40" onMouseDown={() => setOpen(false)}>
          <aside
            className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/95 px-4 py-4 backdrop-blur-md">
              <div>
                <div className="flex items-center gap-2">
                  <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
                  <h2 className="text-lg font-black text-gray-900">My Wishlist</h2>
                </div>
                <p className="mt-0.5 text-[11px] font-bold text-gray-400">{savedProducts.length} saved item{savedProducts.length === 1 ? '' : 's'}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-gray-100 p-2 text-gray-500 hover:text-black" aria-label="Close wishlist">
                <X className="h-5 w-5" />
              </button>
            </div>

            {savedProducts.length === 0 ? (
              <div className="flex min-h-[65vh] flex-col items-center justify-center px-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50">
                  <Heart className="h-8 w-8 text-rose-400" />
                </div>
                <h3 className="mt-4 text-base font-black text-gray-900">Your wishlist is empty</h3>
                <p className="mt-2 max-w-xs text-sm leading-6 text-gray-500">Tap the heart on any product to save it here for later.</p>
                <button type="button" onClick={() => setOpen(false)} className="mt-5 rounded-xl bg-black px-5 py-2.5 text-xs font-black text-white hover:bg-orange-600">Continue Shopping</button>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                {savedProducts.map((product) => {
                  const type = normalizedProductType(product);
                  const range = productPriceRange(product, settings);
                  const image = product.images?.[0] || activeVariants(product).find((variant) => String(variant.image || '').trim())?.image || '';
                  return (
                    <div key={product.id} className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                      <div className="flex gap-3">
                        <button type="button" onClick={() => viewProduct(product)} className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-gray-50">
                          {image ? <img src={image} alt={product.name_en} className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-300">No image</div>}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <button type="button" onClick={() => viewProduct(product)} className="min-w-0 text-left">
                              <p className="line-clamp-2 text-sm font-black leading-5 text-gray-900 hover:text-orange-600">{product.name_en}</p>
                              <p className="mt-0.5 text-[10px] font-mono text-gray-400">{product.sku}</p>
                            </button>
                            <button type="button" onClick={() => removeFromWishlist(product.id)} className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600" title="Remove from wishlist">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="mt-2 text-base font-black text-orange-600">
                            {range.min === range.max ? `Rs. ${formatLkr(range.min)}` : `Rs. ${formatLkr(range.min)} - ${formatLkr(range.max)}`}
                          </p>
                          <button
                            type="button"
                            onClick={() => addProduct(product)}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-black px-3 py-2 text-[11px] font-black text-white hover:bg-orange-600"
                          >
                            <ShoppingBag className="h-3.5 w-3.5" />
                            {type === 'variant' ? 'Choose Option' : 'Add to Cart'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
};
