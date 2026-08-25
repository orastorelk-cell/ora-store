import { Product, StoreSettings } from '../types';
import { displayUnitPrice, normalizedProductType, regularDisplayUnitPrice, variantById } from './productVariants';
import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from './roundSpecialOffer';

export interface BundleComponentOfferDisplay {
  active: boolean;
  referencePrice: number;
  customerPrice: number;
  saving: number;
  percent: number;
}

const money = (value: unknown) => Math.max(0, Math.round(Number(value || 0) * 100) / 100);

/**
 * Display-only Combo Pack reference price.
 *
 * The combo's real/customer price is never recalculated here. The higher crossed
 * price is built from the CURRENT storefront reference price of every exact child
 * item/variant in the bundle. Existing saved supplier offers have priority; when a
 * child has no saved offer, its automatic percentage Special Offer reference price
 * is used. Children with no offer simply contribute their current selling price.
 *
 * The returned combo percent is derived only for display/catalog metadata:
 * saving / referencePrice * 100. It never changes the payable combo price.
 */
export const bundleComponentOfferDisplay = (
  bundle: Product,
  allProducts: Product[],
  settings?: StoreSettings,
): BundleComponentOfferDisplay => {
  const customerPrice = money(displayUnitPrice(bundle, settings));
  const inactive = (): BundleComponentOfferDisplay => ({
    active: false,
    referencePrice: 0,
    customerPrice,
    saving: 0,
    percent: 0,
  });

  if (normalizedProductType(bundle) !== 'bundle') return inactive();

  const components = bundle.bundle_components || [];
  if (!components.length) return inactive();

  let referencePrice = 0;
  for (const component of components) {
    const child = allProducts.find((product) => product.id === component.product_id);
    if (!child || normalizedProductType(child) === 'bundle') return inactive();

    const variant = component.variant_id ? variantById(child, component.variant_id) : undefined;
    if (normalizedProductType(child) === 'variant' && !variant) return inactive();

    const quantity = Math.max(1, Number(component.quantity || 1));
    const current = money(displayUnitPrice(child, settings, variant));
    const savedRegular = money(regularDisplayUnitPrice(child, settings, variant));
    const hasSavedDiscount = savedRegular > current + 0.001;

    let childReference = hasSavedDiscount ? savedRegular : current;
    if (!hasSavedDiscount) {
      const automatic = calculateRoundSpecialOffer({
        currentPrice: current,
        enabled: roundSpecialOfferEnabledForProduct(child),
        percent: roundSpecialOfferPercentForSelection(child, variant),
        hasExistingDiscount: false,
      });
      if (automatic.active) childReference = automatic.regularPrice;
    }

    referencePrice += childReference * quantity;
  }

  referencePrice = money(referencePrice);
  const saving = money(Math.max(0, referencePrice - customerPrice));
  const percent = referencePrice > 0 && saving > 0
    ? Math.round((saving / referencePrice) * 1000) / 10
    : 0;

  return {
    active: referencePrice > customerPrice + 0.001 && saving > 0,
    referencePrice,
    customerPrice,
    saving,
    percent,
  };
};
