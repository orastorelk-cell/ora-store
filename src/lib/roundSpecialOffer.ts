export interface RoundSpecialOfferResult {
  active: boolean;
  offerPrice: number;
  regularPrice: number;
  saving: number;
  percent: number;
  reason: 'active' | 'disabled' | 'free-delivery-required' | 'existing-offer' | 'already-round' | 'invalid-price';
}

const money = (value: unknown) => Math.max(0, Math.round(Number(value || 0) * 100) / 100);

/**
 * O-RA display-only automatic Special Offer helper.
 *
 * The charged customer price never changes here. When the saved product toggle is ON,
 * Free Delivery is ON, and no real/supplier discount is already active, a non-round
 * customer price receives a higher clean reference price for the Special Offer display.
 *
 * The rule matches the approved examples:
 *   860 -> 900
 *   1110 -> 1150
 *   1140 -> 1200
 *   1190 -> 1200
 *   1240 -> 1300
 *   2090 -> 2100
 * Prices already ending in 00/50 stay untouched.
 */
export const calculateRoundSpecialOffer = (input: {
  currentPrice: number;
  enabled: boolean;
  freeDeliveryEnabled: boolean;
  hasExistingDiscount?: boolean;
}): RoundSpecialOfferResult => {
  const offerPrice = money(input.currentPrice);
  const inactive = (reason: RoundSpecialOfferResult['reason']): RoundSpecialOfferResult => ({
    active: false,
    offerPrice,
    regularPrice: offerPrice,
    saving: 0,
    percent: 0,
    reason,
  });

  if (!input.enabled) return inactive('disabled');
  if (!input.freeDeliveryEnabled) return inactive('free-delivery-required');
  if (input.hasExistingDiscount) return inactive('existing-offer');
  if (!(offerPrice > 0)) return inactive('invalid-price');

  const whole = Math.round(offerPrice);
  if (whole % 50 === 0) return inactive('already-round');

  const nextHundred = Math.ceil(whole / 100) * 100;
  const nextFifty = Math.ceil(whole / 50) * 50;
  // Prefer a clean hundred. If that jump would exceed Rs.60, use the next Rs.50 mark.
  // This keeps the display saving small and reproduces the approved current-price examples.
  let regularPrice = nextHundred - whole > 60 ? nextFifty : nextHundred;
  if (regularPrice <= offerPrice) regularPrice = nextFifty > offerPrice ? nextFifty : nextHundred;
  if (regularPrice <= offerPrice) return inactive('already-round');

  const saving = money(regularPrice - offerPrice);
  const percent = regularPrice > 0 ? Math.max(1, Math.round((saving / regularPrice) * 100)) : 0;
  return {
    active: saving > 0,
    offerPrice,
    regularPrice: money(regularPrice),
    saving,
    percent,
    reason: saving > 0 ? 'active' : 'already-round',
  };
};

export const roundSpecialOfferEnabledForProduct = (product: any) =>
  product?.auto_round_special_offer_enabled === true;
