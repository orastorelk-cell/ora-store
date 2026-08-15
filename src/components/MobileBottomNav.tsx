import React from 'react';
import { Home, Grid, ShoppingBag, Package } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTranslation } from '../lib/i18n';

export const MobileBottomNav: React.FC = () => {
  const {
    language,
    cartItemCount,
    setIsCartOpen,
    setIsTrackingOpen,
    setSelectedCategorySlug,
    setIsAdminView,
    isAdminView,
  } = useStore();

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-100 py-2 px-3 shadow-lg">
      <div className="grid grid-cols-4 gap-1 text-center">
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
          <span className="text-[10px]">Home</span>
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
          <span className="text-[10px]">Categories</span>
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
              <span className="absolute -top-2 -right-2.5 bg-black text-white text-[9px] font-black min-w-4 h-4 px-1 rounded-full flex items-center justify-center border border-white">
                {cartItemCount}
              </span>
            )}
          </div>
          <span className={`text-[10px] font-black ${cartItemCount > 0 ? 'text-white' : 'text-orange-600'}`}>Basket</span>
        </button>

        {/* Orders */}
        <button
          onClick={() => setIsTrackingOpen(true)}
          className="flex flex-col items-center justify-center py-1 rounded-xl text-gray-400 hover:text-black font-medium"
        >
          <Package className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Orders</span>
        </button>
      </div>
    </div>
  );
};
