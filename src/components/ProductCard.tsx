import React from 'react';
import { ShoppingBag, Zap, Eye, Image as ImageIcon } from 'lucide-react';
import { Product } from '../types';
import { useStore } from '../context/StoreContext';
import { activeVariants, normalizedProductType, productPriceRange, regularDisplayUnitPrice, selectionDiscountPercent } from '../lib/productVariants';

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
  const images = cleanImages(product.images);
  const primaryImage = images[0] || activeVariants(product).find((v) => String(v.image || '').trim())?.image || '';

  const handleBuyNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (needsSelection) { setSelectedProduct(product); return; }
    startBuyNow(product, 1);
  };

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (needsSelection) { setSelectedProduct(product); return; }
    addToCart(product, 1);
  };

  return (
    <div
      onClick={() => setSelectedProduct(product)}
      className="group self-start bg-white border border-gray-100 hover:border-gray-200 rounded-2xl p-3 cursor-pointer hover:shadow-md transition-all duration-300"
    >
      <div className="relative aspect-square overflow-hidden bg-gray-50 rounded-xl mb-2.5">
        {primaryImage ? (
          <img
            src={primaryImage}
            alt={product.name_en}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"                     loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center text-gray-300">
            <ImageIcon className="h-9 w-9" />
            <span className="mt-1 text-[10px] font-bold">Image coming soon</span>
          </div>
        )}

        {hasDiscount && (
          <div className="absolute top-2 left-2 bg-orange-600 text-white text-xs sm:text-sm font-black px-2.5 py-1.5 rounded-xl shadow-lg">
            {type === 'variant' ? `UP TO ${discountPercent}% OFF` : `${discountPercent}% OFF`}
          </div>
        )}

        <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-md text-gray-500 text-[9px] font-mono px-2 py-0.5 rounded-md border border-gray-200">
          {product.sku}
        </div>

        <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="bg-white/95 text-gray-900 text-xs font-bold px-3 py-1.5 rounded-full border border-gray-200 flex items-center space-x-1 shadow-md">
            <Eye className="w-3.5 h-3.5 text-orange-600" />
            <span>View Product</span>
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-end text-[10px]">
          <span className="text-gray-400 uppercase text-[9px] font-bold tracking-wider">{type === 'bundle' ? 'Combo Pack' : product.category_slug}</span>
        </div>

        <h3 className="text-xs sm:text-sm font-bold leading-5 text-gray-900 line-clamp-2 group-hover:text-orange-600 transition-colors">
          {language === 'si' && product.name_si ? product.name_si : product.name_en}
        </h3>

        <div>
          {hasDiscount && type !== 'variant' && (
            <div className="text-xs sm:text-sm text-gray-400 line-through font-bold">Rs. {regularPrice.toLocaleString()}</div>
          )}
          <span className="text-base sm:text-lg font-black text-orange-600">
            {range.min === range.max ? `Rs. ${range.min.toLocaleString()}` : `Rs. ${range.min.toLocaleString()} - ${range.max.toLocaleString()}`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={handleAddToCart}
          className="py-2 px-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 text-[11px] sm:text-xs font-black flex items-center justify-center space-x-1 border border-orange-200 transition-colors"
        >
          <ShoppingBag className="w-3.5 h-3.5 text-orange-600 shrink-0" />
          <span>{needsSelection ? 'Choose Option' : 'Add to Cart'}</span>
        </button>

        <button
          onClick={handleBuyNow}
          className="py-2 px-2 rounded-xl bg-black hover:bg-orange-600 text-white text-xs font-bold flex items-center justify-center space-x-1 shadow-xs transition-colors"
        >
          <Zap className="w-3.5 h-3.5 fill-current text-orange-400" />
          <span>{needsSelection ? 'Choose' : 'Buy Now'}</span>
        </button>
      </div>
    </div>
  );
};
