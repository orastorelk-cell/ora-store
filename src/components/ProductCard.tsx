import React from 'react';
import { Heart, ShoppingBag, Zap, Eye, Image as ImageIcon } from 'lucide-react';
import { Product } from '../types';
import { useStore } from '../context/StoreContext';
import { activeVariants, normalizedProductType, productPriceRange, regularDisplayUnitPrice, selectionDiscountPercent } from '../lib/productVariants';
import { formatLkr } from '../lib/currency';
import { isInWishlist, toggleWishlist, WISHLIST_CHANGED_EVENT } from '../lib/wishlist';

interface ProductCardProps {
  product: Product;
}

const LEGACY_DEFAULT_IMAGE = 'photo-1523275335684-37898b6baf30';

const cleanImages = (images: string[] = []) => {
  const seen = new Set<string>();
  const rows = images.map((raw) => String(raw || '').trim()).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
  const realRows = rows.filter((value) => !value.includes(LEGACY_DEFAULT_IMAGE));
  return realRows.length ? realRows : rows;
};

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { language, addToCart, setSelectedProduct, startBuyNow, settings } = useStore();
  const [wishlisted, setWishlisted] = React.useState(() => isInWishlist(product.id));

  React.useEffect(() => {
    const sync = () => setWishlisted(isInWishlist(product.id));
    sync();
    window.addEventListener(WISHLIST_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(WISHLIST_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [product.id]);

  const type = normalizedProductType(product);
  const range = productPriceRange(product, settings);
  const variantDiscounts = type === 'variant'
    ? activeVariants(product).map((v) => ({ v, pct: selectionDiscountPercent(product, v, settings) })).filter((x) => x.pct > 0)
    : [];
  const normalDiscountPercent = type !== 'variant' ? selectionDiscountPercent(product, undefined, settings) : 0;
  const discountPercent = type === 'variant' ? Math.max(0, ...variantDiscounts.map((x) => x.pct)) : normalDiscountPercent;
  const hasDiscount = discountPercent > 0;
  const regularPrice = type !== 'variant' ? regularDisplayUnitPrice(product, settings) : 0;
  const needsSelection = type === 'variant';
  const selectableVariants = type === 'variant' ? activeVariants(product) : [];
  const forcedOutOfStock = type === 'variant'
    ? selectableVariants.length > 0 && selectableVariants.every((variant) => Boolean(variant.force_out_of_stock))
    : Boolean(product.force_out_of_stock);
  const images = cleanImages(product.images);
  const primaryImage = images[0] || activeVariants(product).find((v) => String(v.image || '').trim())?.image || '';
  const deliveryLabel = settings.free_delivery_enabled
    ? 'FREE Islandwide Delivery'
    : `Islandwide Delivery: Rs. ${formatLkr(Math.max(0, Number(settings.delivery_fee || 0)))}`;

  const handleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    setWishlisted(toggleWishlist(product.id));
  };

  const handleBuyNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (forcedOutOfStock) return;
    if (needsSelection) { setSelectedProduct(product); return; }
    startBuyNow(product, 1);
  };

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (forcedOutOfStock) return;
    if (needsSelection) { setSelectedProduct(product); return; }
    addToCart(product, 1);
  };

  return (
    <div
      onClick={() => setSelectedProduct(product)}
      className="ora-product-card group self-start bg-white border border-gray-100 hover:border-gray-200 rounded-2xl p-3 cursor-pointer hover:shadow-md transition-all duration-300"
    >
      <div className="ora-product-card-image relative aspect-square overflow-hidden bg-gray-50 rounded-xl mb-2.5">
        {primaryImage ? (
          <img
            src={primaryImage}
            alt={product.name_en}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center text-gray-300">
            <ImageIcon className="h-9 w-9" />
            <span className="mt-1 text-[10px] font-bold">Image coming soon</span>
          </div>
        )}

        {forcedOutOfStock ? (
          <div className="absolute top-2 left-2 rounded-xl bg-red-600 px-2.5 py-1.5 text-xs sm:text-sm font-black text-white shadow-lg">
            OUT OF STOCK
          </div>
        ) : hasDiscount && (
          <div className="ora-product-card-discount absolute top-2 left-2 bg-orange-600 text-white text-xs sm:text-sm font-black px-2.5 py-1.5 rounded-xl shadow-lg">
            {type === 'variant' ? `UP TO ${discountPercent}% OFF` : `${discountPercent}% OFF`}
          </div>
        )}

        <button
          type="button"
          onClick={handleWishlist}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          title={wishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
          className={`absolute right-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-full border shadow-md backdrop-blur-md transition-all ${wishlisted ? 'border-rose-200 bg-rose-50 text-rose-500' : 'border-white/80 bg-white/90 text-gray-500 hover:text-rose-500'}`}
        >
          <Heart className={`h-4.5 w-4.5 ${wishlisted ? 'fill-rose-500 text-rose-500' : ''}`} />
        </button>

        <div className="ora-product-card-sku absolute bottom-2 left-2 sm:bottom-auto sm:left-auto sm:top-12 sm:right-2 bg-white/90 backdrop-blur-md text-gray-500 text-[9px] font-mono px-2 py-0.5 rounded-md border border-gray-200">
          {product.sku}
        </div>

        <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="bg-white/95 text-gray-900 text-xs font-bold px-3 py-1.5 rounded-full border border-gray-200 flex items-center space-x-1 shadow-md">
            <Eye className="w-3.5 h-3.5 text-orange-600" />
            <span>View Product</span>
          </span>
        </div>
      </div>

      <div className="ora-product-card-content space-y-1.5">
        <div className="flex min-w-0 items-center justify-end text-[10px]">
          <span className="ora-product-card-category max-w-full truncate text-gray-400 uppercase text-[9px] font-bold tracking-wider">{type === 'bundle' ? 'Combo Pack' : product.category_slug}</span>
        </div>

        <h3 className="ora-product-card-title text-xs sm:text-sm font-bold leading-5 text-gray-900 line-clamp-2 group-hover:text-orange-600 transition-colors">
          {language === 'si' && product.name_si ? product.name_si : product.name_en}
        </h3>

        <div>
          {hasDiscount && type !== 'variant' && (
            <div className="ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {formatLkr(regularPrice)}</div>
          )}
          <span className="ora-product-card-price text-base sm:text-lg font-black text-orange-600">
            {range.min === range.max ? `Rs. ${formatLkr(range.min)}` : `Rs. ${formatLkr(range.min)} - ${formatLkr(range.max)}`}
          </span>
          <p className={`ora-product-card-delivery mt-1 flex items-center gap-1 whitespace-nowrap text-[9px] font-black leading-tight ${settings.free_delivery_enabled ? 'text-emerald-600' : 'text-gray-500'}`}>
            <span aria-hidden="true">🚚</span>
            <span>{deliveryLabel}</span>
          </p>
        </div>
      </div>

      <div className="ora-product-card-actions grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={handleAddToCart}
          disabled={forcedOutOfStock}
          className={`ora-product-card-action min-w-0 py-2 px-1.5 rounded-xl text-[11px] sm:text-xs font-black flex items-center justify-center gap-1 border transition-colors ${forcedOutOfStock ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400' : 'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200'}`}
        >
          <ShoppingBag className={`ora-product-card-action-icon w-3.5 h-3.5 shrink-0 ${forcedOutOfStock ? 'text-gray-400' : 'text-orange-600'}`} />
          <span className="ora-product-card-action-label whitespace-nowrap">{forcedOutOfStock ? 'Out of Stock' : needsSelection ? 'Choose Option' : 'Add to Cart'}</span>
        </button>

        <button
          onClick={handleBuyNow}
          disabled={forcedOutOfStock}
          className={`ora-product-card-action min-w-0 py-2 px-2 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1 shadow-xs transition-colors ${forcedOutOfStock ? 'cursor-not-allowed bg-gray-400' : 'bg-black hover:bg-orange-600'}`}
        >
          <Zap className={`ora-product-card-action-icon w-3.5 h-3.5 shrink-0 fill-current ${forcedOutOfStock ? 'text-gray-200' : 'text-orange-400'}`} />
          <span className="ora-product-card-action-label whitespace-nowrap">{forcedOutOfStock ? 'Unavailable' : needsSelection ? 'Choose' : 'Buy Now'}</span>
        </button>
      </div>
    </div>
  );
};
