import React from 'react';
import {
  X,
  Trash2,
  ShoppingBag,
  ArrowRight,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTranslation } from '../lib/i18n';
import { displayUnitPrice } from '../lib/productVariants';
import { formatLkr } from '../lib/currency';

export const CartDrawer: React.FC = () => {
  const {
    language,
    cart,
    isCartOpen,
    setIsCartOpen,
    removeFromCart,
    updateCartQuantity,
    cartSubtotal,
    cartSpecialOfferDiscount,
    cartMultiBuyDiscountRate,
    cartFinalProductsTotal,
    cartItemCount,
    settings,
    setIsCheckoutOpen,
  } = useStore();

  if (!isCartOpen) return null;

  const deliveryFee = settings.free_delivery_enabled ? 0 : Math.max(0, Number(settings.delivery_fee || 0));
  const finalTotal = cartFinalProductsTotal + deliveryFee;

  const advanceQtyThreshold = Math.max(0, Number(settings.advance_qty_threshold ?? 4));
  const advancePercentage = Math.min(100, Math.max(1, Number(settings.advance_percentage ?? 50)));
  const isAdvanceRequired = cartItemCount > advanceQtyThreshold;
  const advanceAmount = isAdvanceRequired ? Math.round(finalTotal * (advancePercentage / 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white border-l border-gray-100 h-full flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-300 text-gray-900">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-white">
          <div className="flex items-center space-x-2">
            <ShoppingBag className="w-5 h-5 text-orange-600" />
            <h2 className="text-base font-bold text-gray-900">
              {getTranslation(language, 'cart')} ({cartItemCount})
            </h2>
          </div>
          <button
            onClick={() => setIsCartOpen(false)}
            className="p-1.5 rounded-full bg-gray-100 text-gray-500 hover:text-black hover:bg-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-gray-100">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                <ShoppingBag className="w-8 h-8" />
              </div>
              <p className="text-sm font-bold text-gray-500">
                {getTranslation(language, 'cartEmpty')}
              </p>
              <button
                onClick={() => setIsCartOpen(false)}
                className="px-5 py-2.5 rounded-full bg-black text-white font-bold text-xs hover:bg-orange-600 transition-colors"
              >
                Browse Marketplace Products
              </button>
            </div>
          ) : (
            cart.map((item) => {
              const unitPrice = displayUnitPrice(item.product, settings, item.variant);
              const itemTotal = unitPrice * item.quantity;

              return (
                <div key={item.line_id || `${item.product.id}::${item.variant?.id || 'base'}`} className="pt-3 flex space-x-3 items-center">
                  <img
                    src={item.variant?.image || item.product.images[0]}
                    alt={item.product.name_en}
                    className="w-16 h-16 object-cover rounded-2xl border border-gray-100 shrink-0 bg-gray-50"
                    referrerPolicy="no-referrer"
                  />

                  <div className="flex-1 min-w-0 space-y-1">
                    <h4 className="text-xs font-bold text-gray-900 truncate">
                      {language === 'si' ? item.product.name_si : item.product.name_en}
                    </h4>
                    <p className="text-[10px] text-gray-400 font-mono">
                      SKU: {item.variant?.sku || item.product.sku}{item.variant?.option_value ? ` • ${item.variant.option_value}` : ''}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs font-black text-orange-600">
                        Rs. {formatLkr(itemTotal)}
                      </span>

                      {/* Quantity Controls */}
                      <div className="flex items-center bg-gray-100 border border-gray-200 rounded-lg">
                        <button
                          onClick={() => updateCartQuantity(item.line_id || `${item.product.id}::${item.variant?.id || 'base'}`, item.quantity - 1)}
                          className="px-2 py-0.5 text-gray-600 hover:text-black font-bold text-xs"
                        >
                          -
                        </button>
                        <span className="px-2 text-xs font-bold text-gray-900">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateCartQuantity(item.line_id || `${item.product.id}::${item.variant?.id || 'base'}`, item.quantity + 1)}
                          className="px-2 py-0.5 text-gray-600 hover:text-black font-bold text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => removeFromCart(item.line_id || `${item.product.id}::${item.variant?.id || 'base'}`)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer & Calculations */}
        {cart.length > 0 && (
          <div className="p-4 border-t border-gray-100 bg-gray-50/50 space-y-3">
            {/* Bilingual configurable advance payment rule */}
            {isAdvanceRequired && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3 text-xs text-orange-950 space-y-2">
                <div className="flex items-center space-x-1.5 font-black text-orange-700">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{advancePercentage}% Advance Payment Required / {advancePercentage}% අත්තිකාරම් ගෙවීම අවශ්‍යයි</span>
                </div>
                <p className="text-[11px] text-orange-900 leading-relaxed">
                  Your cart contains <b>{cartItemCount} items</b> (&gt; {advanceQtyThreshold} items). A <b>{advancePercentage}% advance payment of Rs. {formatLkr(advanceAmount)}</b> is required to confirm this order.
                </p>
                <p className="text-[11px] text-orange-900 leading-relaxed">
                  ඔබගේ කරත්තයේ <b>භාණ්ඩ {cartItemCount}ක්</b> ඇත ({advanceQtyThreshold}කට වැඩි). මෙම ඇණවුම තහවුරු කිරීමට <b>Rs. {formatLkr(advanceAmount)} ක {advancePercentage}% අත්තිකාරම් ගෙවීමක්</b> අවශ්‍ය වේ.
                </p>
              </div>
            )}

            {/* Calculations Breakdown */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>{getTranslation(language, 'subtotal')}</span>
                <span>Rs. {formatLkr(cartSubtotal)}</span>
              </div>
              {cartSpecialOfferDiscount > 0 && (
                <div className="my-2 rounded-xl border border-orange-200 bg-orange-50 p-2">
                  <div className="flex justify-between font-black text-orange-700">
                    <span>🎉 Special Multi-Buy Offer ({cartMultiBuyDiscountRate}% OFF)</span>
                    <span>- Rs. {formatLkr(cartSpecialOfferDiscount)}</span>
                  </div>
                  <p className="mt-1 text-[10px] font-semibold text-orange-600">You save more when you buy more!</p>
                </div>
              )}
              <div className="flex justify-between text-gray-500">
                <span>{getTranslation(language, 'deliveryFee')}</span>
                <span>{settings.free_delivery_enabled ? 'FREE' : `Rs. ${formatLkr(deliveryFee)}`}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-gray-900 pt-2 border-t border-gray-200">
                <span>{getTranslation(language, 'total')}</span>
                <span className="text-orange-600 font-black">Rs. {formatLkr(finalTotal)}</span>
              </div>
            </div>

            {/* Checkout Action Button */}
            <button
              onClick={() => {
                setIsCartOpen(false);
                setIsCheckoutOpen(true);
              }}
              className="w-full py-3 rounded-full bg-black hover:bg-orange-600 text-white font-bold text-sm shadow-md flex items-center justify-center space-x-2 transition-colors"
            >
              <span>{getTranslation(language, 'checkout')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
