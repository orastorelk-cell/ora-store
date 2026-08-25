const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA special offer live preview] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Admin-only follow-up for Special Offer editing.
 * - Allows decimal percentages such as 8.5% and 9.4%.
 * - Makes the right-side LIVE PREVIEW show the same crossed price and offer badge.
 *
 * Storefront, charged prices, order snapshots, Google Sheet and Invoice logic are untouched.
 */
export const specialOfferLivePreviewDecimalPatch = () => ({
  name: 'ora-special-offer-live-preview-decimal-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    text = replaceRequired(
      text,
      '<input type="number" min="1" max="80" step="1" disabled={!enabled} value={offerPercent}',
      '<input type="number" min="1" max="80" step="0.1" disabled={!enabled} value={offerPercent}',
      'main offer decimal input',
    );

    text = replaceRequired(
      text,
      '<input type="number" min="1" max="80" step="1" value={offerPercent}',
      '<input type="number" min="1" max="80" step="0.1" value={offerPercent}',
      'variant offer decimal input',
    );

    const oldImagePreview = `<div className="relative aspect-square bg-gray-100"><img src={productForm.images[0] || 'https://placehold.co/600x600?text=O-RA'} alt="Product preview" className="h-full w-full object-cover" />{productForm.discount_enabled && productForm.discount_price > 0 && productForm.discount_price < productForm.selling_price && <div className="absolute left-3 top-3 rounded-xl bg-orange-600 px-3 py-1.5 text-sm font-black text-white shadow-lg">{Math.max(1,Math.round(((productForm.selling_price-productForm.discount_price)/Math.max(1,productForm.selling_price))*100))}% OFF</div>}</div>`;
    const newImagePreview = `{(() => {
                    const deliveryReserve = settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0;
                    const savedDiscountActive = productForm.discount_enabled && Number(productForm.discount_price || 0) > 0 && Number(productForm.discount_price || 0) < Number(productForm.selling_price || 0);
                    const actualPrice = (savedDiscountActive ? Number(productForm.discount_price || 0) : Number(productForm.selling_price || 0)) + deliveryReserve;
                    const specialOffer = calculateRoundSpecialOffer({
                      currentPrice: actualPrice,
                      enabled: Boolean(productForm.auto_round_special_offer_enabled),
                      percent: roundSpecialOfferPercentForSelection(productForm),
                      hasExistingDiscount: savedDiscountActive,
                    });
                    const badgeText = savedDiscountActive
                      ? \`${Math.max(1,Math.round(((Number(productForm.selling_price||0)-Number(productForm.discount_price||0))/Math.max(1,Number(productForm.selling_price||0)))*100))}% OFF\`
                      : specialOffer.active ? \`${specialOffer.percent}% OFF\` : '';
                    return <div className="relative aspect-square bg-gray-100"><img src={productForm.images[0] || 'https://placehold.co/600x600?text=O-RA'} alt="Product preview" className="h-full w-full object-cover" />{badgeText && <div className="absolute left-3 top-3 rounded-xl bg-orange-600 px-3 py-1.5 text-sm font-black text-white shadow-lg">{badgeText}</div>}</div>;
                  })()}`;
    text = replaceRequired(text, oldImagePreview, newImagePreview, 'LIVE PREVIEW image badge');

    const oldPricePreview = `<div className="pt-1">{productForm.discount_enabled && productForm.discount_price > 0 && productForm.discount_price < productForm.selling_price && <p className="text-sm font-bold text-gray-400 line-through">Rs. {(productForm.selling_price + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0)).toLocaleString()}</p>}<p className="text-xl font-black text-orange-600">Rs. {((productForm.discount_enabled && productForm.discount_price > 0 && productForm.discount_price < productForm.selling_price ? productForm.discount_price : productForm.selling_price) + (settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0)).toLocaleString()}</p>{settings.free_delivery_enabled ? <p className="text-[10px] font-bold text-emerald-600">🚚 FREE Islandwide Delivery</p> : <p className="text-[10px] text-gray-500">Delivery added at checkout</p>}</div>`;
    const newPricePreview = `{(() => {
                      const deliveryReserve = settings.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0;
                      const savedDiscountActive = productForm.discount_enabled && Number(productForm.discount_price || 0) > 0 && Number(productForm.discount_price || 0) < Number(productForm.selling_price || 0);
                      const actualPrice = (savedDiscountActive ? Number(productForm.discount_price || 0) : Number(productForm.selling_price || 0)) + deliveryReserve;
                      const specialOffer = calculateRoundSpecialOffer({
                        currentPrice: actualPrice,
                        enabled: Boolean(productForm.auto_round_special_offer_enabled),
                        percent: roundSpecialOfferPercentForSelection(productForm),
                        hasExistingDiscount: savedDiscountActive,
                      });
                      const crossedPrice = savedDiscountActive
                        ? Number(productForm.selling_price || 0) + deliveryReserve
                        : specialOffer.active ? specialOffer.regularPrice : 0;
                      return <div className="pt-1">{crossedPrice > actualPrice && <p className="text-sm font-bold text-gray-400 line-through">Rs. {crossedPrice.toLocaleString()}</p>}<div className="flex flex-wrap items-center gap-2"><p className="text-xl font-black text-orange-600">Rs. {actualPrice.toLocaleString()}</p>{specialOffer.active && <span className="rounded-full bg-orange-100 px-2 py-1 text-[9px] font-black text-orange-700">SPECIAL OFFER</span>}</div>{settings.free_delivery_enabled ? <p className="text-[10px] font-bold text-emerald-600">🚚 FREE Islandwide Delivery</p> : <p className="text-[10px] text-gray-500">Delivery added at checkout</p>}</div>;
                    })()}`;
    text = replaceRequired(text, oldPricePreview, newPricePreview, 'LIVE PREVIEW crossed price');

    return { code: text, map: null };
  },
});
