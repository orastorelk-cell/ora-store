import type { Plugin } from 'vite';

/**
 * Business rule: free delivery and Qty Offer must never be active together.
 * This keeps website cart totals correct and also persists Qty Offer OFF whenever
 * Free Delivery is enabled, so Facebook auto-lead orders read the safe setting too.
 */
export const freeDeliveryQtyOfferGuardPatch = (): Plugin => ({
  name: 'ora-free-delivery-qty-offer-guard-patch',
  enforce: 'pre',
  transform(code, rawId) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;

    let next = code;

    const oldRateGuard = `  const getMultiBuyDiscountRate = (qty: number) => {\n    if (settings.multi_buy_discount_enabled === false || qty <= 1) return 0;`;
    const newRateGuard = `  const getMultiBuyDiscountRate = (qty: number) => {\n    if (settings.free_delivery_enabled === true || settings.multi_buy_discount_enabled === false || qty <= 1) return 0;`;
    if (!next.includes(oldRateGuard)) {
      throw new Error('Free-delivery Qty Offer guard: cart discount anchor not found.');
    }
    next = next.replace(oldRateGuard, newRateGuard);

    const oldSettingsMerge = `  const updateSettings = (newSettings: Partial<StoreSettings>) => {\n    const nextSettings={...settings,...newSettings};`;
    const newSettingsMerge = `  const updateSettings = (newSettings: Partial<StoreSettings>) => {\n    const nextSettings={...settings,...newSettings};\n    // Free Delivery and Qty Offer are mutually exclusive. Persist Qty Offer OFF\n    // whenever Free Delivery is active so every order source uses the same rule.\n    if (nextSettings.free_delivery_enabled === true) {\n      nextSettings.multi_buy_discount_enabled = false;\n    }`;
    if (!next.includes(oldSettingsMerge)) {
      throw new Error('Free-delivery Qty Offer guard: settings anchor not found.');
    }
    next = next.replace(oldSettingsMerge, newSettingsMerge);

    return { code: next, map: null };
  },
});
