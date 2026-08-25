export interface RoundSpecialOfferResult {
  active: boolean;
  offerPrice: number;
  regularPrice: number;
  saving: number;
  percent: number;
  reason: 'active' | 'disabled' | 'free-delivery-required' | 'existing-offer' | 'already-round' | 'invalid-price' | 'invalid-percent';
}

const money = (value: unknown) => Math.max(0, Math.round(Number(value || 0) * 100) / 100);

/**
 * O-RA display-only automatic Special Offer helper.
 *
 * The saved/current customer price is always the price actually charged. The admin
 * selects the offer percentage and this helper works backwards to create only the
 * higher crossed-out reference price. Free Delivery is intentionally NOT a condition;
 * the feature works whether Free Delivery is ON or OFF.
 *
 * Example: current price Rs.1,110 + 5% offer => crossed reference about Rs.1,170,
 * while the charged customer price remains exactly Rs.1,110.
 */
export const calculateRoundSpecialOffer = (input: {
  currentPrice: number;
  enabled: boolean;
  percent?: number;
  freeDeliveryEnabled?: boolean; // retained for backward compatibility; not a gate
  hasExistingDiscount?: boolean;
}): RoundSpecialOfferResult => {
  const offerPrice = money(input.currentPrice);
  const requestedPercent = Math.max(0, Math.min(80, Number(input.percent || 0)));
  const inactive = (reason: RoundSpecialOfferResult['reason']): RoundSpecialOfferResult => ({
    active: false,
    offerPrice,
    regularPrice: offerPrice,
    saving: 0,
    percent: requestedPercent,
    reason,
  });

  if (!input.enabled) return inactive('disabled');
  if (input.hasExistingDiscount) return inactive('existing-offer');
  if (!(offerPrice > 0)) return inactive('invalid-price');
  if (!(requestedPercent > 0 && requestedPercent < 100)) return inactive('invalid-percent');

  // Work backwards from the real customer price. Round the display-only reference
  // UP to the next Rs.10 so the crossed price stays clean and never drops below the
  // percentage-derived reference value.
  const rawRegularPrice = offerPrice / (1 - requestedPercent / 100);
  const regularPrice = money(Math.ceil(rawRegularPrice / 10) * 10);
  if (!(regularPrice > offerPrice)) return inactive('invalid-percent');

  const saving = money(regularPrice - offerPrice);
  return {
    active: saving > 0,
    offerPrice,
    regularPrice,
    saving,
    percent: requestedPercent,
    reason: saving > 0 ? 'active' : 'invalid-percent',
  };
};

export const roundSpecialOfferEnabledForProduct = (product: any) =>
  product?.auto_round_special_offer_enabled === true;

export const roundSpecialOfferPercentForProduct = (product: any) => {
  const value = Number(product?.auto_round_special_offer_percent ?? 5);
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(80, Math.round(value * 10) / 10));
};

/**
 * Variants inherit the product-level percentage by default. A variant only needs
 * its own saved percentage when the admin intentionally overrides it in Product Edit.
 * This means equal-price sub-items automatically share the same offer setup, while
 * different-price sub-items can be tuned independently without changing real prices.
 */
export const roundSpecialOfferPercentForSelection = (product: any, variant?: any) => {
  const override = variant?.auto_round_special_offer_percent;
  if (override === undefined || override === null || override === '') {
    return roundSpecialOfferPercentForProduct(product);
  }
  const value = Number(override);
  if (!Number.isFinite(value)) return roundSpecialOfferPercentForProduct(product);
  return Math.max(1, Math.min(80, Math.round(value * 10) / 10));
};
