import React from 'react';
import { Home, Grid, Heart, ShoppingBag, Package } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { WishlistWidget } from './WishlistWidget';
import { openWishlist, readWishlistIds, WISHLIST_CHANGED_EVENT } from '../lib/wishlist';

export const MobileBottomNav: React.FC = () => {
  const {
    cartItemCount,
    setIsCartOpen,
    setIsTrackingOpen,
    setSelectedCategorySlug,
    setIsAdminView,
    isAdminView,
  } = useStore();
  const [wishlistCount, setWishlistCount] = React.useState(() => readWishlistIds().length);

  React.useEffect(() => {
    const sync = () => setWishlistCount(readWishlistIds().length);
    window.addEventListener(WISHLIST_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(WISHLIST_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return (
    <>
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-100 py-2 px-2 shadow-lg">
        <div className="grid grid-cols-5 gap-0.5 text-center">
          {/* Home */}
          <button
            onClick={() => {
              setIsAdminView(false);
              setSelectedCategorySlug(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`flex flex-col items-center justify-center py-1 rounded-xl transition-colors ${
              !isAdminView ? 'text-orange-600 font-bold' : 'text-gray-400'
            }`}
          >
            <Home className="w-5 h-5 mb-0.5" />
            <span className="text-[9px] sm:text-[10px]">Home</span>
          </button>

          {/* Categories */}
          <button
            onClick={() => {
              setIsAdminView(false);
              const el = document.getElementById('categories-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex flex-col items-center justify-center py-1 rounded-xl text-gray-400 hover:text-black font-medium"
          >
            <Grid className="w-5 h-5 mb-0.5" />
            <span className="text-[9px] sm:text-[10px]">Categories</span>
          </button>

          {/* Wishlist */}
          <button
            onClick={openWishlist}
            className={`relative flex flex-col items-center justify-center py-1 rounded-xl font-bold transition-colors ${wishlistCount > 0 ? 'text-rose-500' : 'text-gray-400 hover:text-rose-500'}`}
          >
            <div className="relative">
              <Heart className={`w-5 h-5 mb-0.5 ${wishlistCount > 0 ? 'fill-rose-500 text-rose-500' : ''}`} />
              {wishlistCount > 0 && (
                <span className="absolute -top-2 -right-2.5 bg-rose-500 text-white text-[8px] font-black min-w-4 h-4 px-1 rounded-full flex items-center justify-center border border-white">
                  {wishlistCount}
                </span>
              )}
            </div>
            <span className="text-[9px] sm:text-[10px]">Wishlist</span>
          </button>

          {/* Cart */}
          <button
            onClick={() => setIsCartOpen(true)}
            className={`relative flex flex-col items-center justify-center py-1 rounded-xl border font-bold transition-all ${
              cartItemCount > 0
                ? 'bg-orange-600 border-orange-600 text-white shadow-md shadow-orange-100'
                : 'bg-orange-50 border-orange-200 text-orange-600'
            }`}
          >
            <div className="relative">
              <ShoppingBag className={`w-5 h-5 mb-0.5 ${cartItemCount > 0 ? 'text-white' : 'text-orange-600'}`} />
              {cartItemCount > 0 && (
                <span className="absolute -top-2 -right-2.5 bg-black text-white text-[8px] font-black min-w-4 h-4 px-1 rounded-full flex items-center justify-center border border-white">
                  {cartItemCount}
                </span>
              )}
            </div>
            <span className={`text-[9px] sm:text-[10px] font-black ${cartItemCount > 0 ? 'text-white' : 'text-orange-600'}`}>Cart</span>
          </button>

          {/* Orders */}
          <button
            onClick={() => setIsTrackingOpen(true)}
            className="flex flex-col items-center justify-center py-1 rounded-xl text-gray-400 hover:text-black font-medium"
          >
            <Package className="w-5 h-5 mb-0.5" />
            <span className="text-[9px] sm:text-[10px]">Orders</span>
          </button>
        </div>
      </div>
      <WishlistWidget />
    </>
  );
};
