const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA special offer percentage rule] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Runs immediately after roundSpecialOfferPatch.
 * Keeps the approved storefront appearance exactly the same and changes only the
 * rule that creates the crossed-out reference price: Admin chooses an offer %, the
 * real customer price stays unchanged, and the reference price is calculated back
 * from that %. Free Delivery is not a condition.
 */
export const specialOfferPercentageRulePatch = () => ({
  name: 'ora-special-offer-percentage-rule-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/lib/productVariants.ts')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from './roundSpecialOffer';",
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForProduct } from './roundSpecialOffer';",
        'productVariants helper import',
      );
      text = replaceRequired(
        text,
        "    enabled: normalizedProductType(product) !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n    freeDeliveryEnabled: Boolean(settings?.free_delivery_enabled),",
        "    enabled: normalizedProductType(product) !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n    percent: roundSpecialOfferPercentForProduct(product),\n    freeDeliveryEnabled: Boolean(settings?.free_delivery_enabled),",
        'order snapshot percentage',
      );
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductCard.tsx')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../lib/roundSpecialOffer';",
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForProduct } from '../lib/roundSpecialOffer';",
        'ProductCard helper import',
      );
      text = text.replace(
        /enabled: roundSpecialOfferEnabledForProduct\(product\),\n\s*freeDeliveryEnabled:/g,
        "enabled: roundSpecialOfferEnabledForProduct(product),\n          percent: roundSpecialOfferPercentForProduct(product),\n          freeDeliveryEnabled:",
      );
      text = text.replace(
        /enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct\(product\),\n\s*freeDeliveryEnabled:/g,
        "enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n        percent: roundSpecialOfferPercentForProduct(product),\n        freeDeliveryEnabled:",
      );
      if (!text.includes('percent: roundSpecialOfferPercentForProduct(product)')) {
        throw new Error('[O-RA special offer percentage rule] ProductCard percentage markers not found');
      }
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductDetailModal.tsx')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../lib/roundSpecialOffer';",
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForProduct } from '../lib/roundSpecialOffer';",
        'ProductDetail helper import',
      );
      text = replaceRequired(
        text,
        "    enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct(selectedProduct),\n    freeDeliveryEnabled: Boolean(settings.free_delivery_enabled),",
        "    enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct(selectedProduct),\n    percent: roundSpecialOfferPercentForProduct(selectedProduct),\n    freeDeliveryEnabled: Boolean(settings.free_delivery_enabled),",
        'ProductDetail percentage',
      );
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      let text = code;
      text = replaceRequired(
        text,
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../../lib/roundSpecialOffer';",
        "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForProduct } from '../../lib/roundSpecialOffer';",
        'Admin helper import',
      );

      const oldBlock = `                        const enabled = roundSpecialOfferEnabledForProduct(p);\n                        const currentPrice = displayUnitPrice(p, settings);\n                        const hasExistingDiscount = normalizedProductType(p) !== 'variant' && p.discount_enabled !== false && Number(p.discount_price || 0) > 0 && Number(p.discount_price || 0) < Number(p.selling_price || 0);\n                        const preview = calculateRoundSpecialOffer({ currentPrice, enabled, freeDeliveryEnabled:Boolean(settings.free_delivery_enabled), hasExistingDiscount });\n                        const note = enabled\n                          ? !settings.free_delivery_enabled\n                            ? 'Waiting for Free Delivery ON'\n                            : normalizedProductType(p) === 'variant'\n                              ? 'Checks each variant price automatically'\n                              : preview.active\n                                ? \`Rs. \${preview.regularPrice.toLocaleString()} → Rs. \${preview.offerPrice.toLocaleString()}\`\n                                : preview.reason === 'existing-offer'\n                                  ? 'Existing saved offer has priority'\n                                  : 'Current customer price is already round'\n                          : 'Works only on non-round customer prices';\n                        return <div className=\"mt-1.5\">\n                          <button\n                            type=\"button\"\n                            onClick={() => updateProduct({ ...(p as any), auto_round_special_offer_enabled: !enabled } as any)}\n                            className={\`rounded-full border px-2 py-1 text-[8px] font-black \${enabled ? 'border-orange-500/40 bg-orange-500/10 text-orange-300' : 'border-neutral-700 bg-neutral-950 text-neutral-500'}\`}\n                            title=\"Automatic Special Offer works only while Free Delivery is ON. It never changes the actual charged customer price.\"\n                          >\n                            SPECIAL OFFER {enabled ? 'ON' : 'OFF'}\n                          </button>\n                          <p className=\"mt-1 max-w-[190px] whitespace-normal text-[8px] leading-3 text-neutral-500\">{note}</p>\n                        </div>;`;

      const newBlock = `                        const enabled = roundSpecialOfferEnabledForProduct(p);\n                        const offerPercent = roundSpecialOfferPercentForProduct(p);\n                        const currentPrice = displayUnitPrice(p, settings);\n                        const hasExistingDiscount = normalizedProductType(p) !== 'variant' && p.discount_enabled !== false && Number(p.discount_price || 0) > 0 && Number(p.discount_price || 0) < Number(p.selling_price || 0);\n                        const preview = calculateRoundSpecialOffer({ currentPrice, enabled, percent:offerPercent, freeDeliveryEnabled:Boolean(settings.free_delivery_enabled), hasExistingDiscount });\n                        const note = enabled\n                          ? normalizedProductType(p) === 'variant'\n                            ? \`\${offerPercent}% Special Offer • checks each variant price\`\n                            : preview.active\n                              ? \`\${offerPercent}% OFF • Rs. \${preview.regularPrice.toLocaleString()} → Rs. \${preview.offerPrice.toLocaleString()}\`\n                              : preview.reason === 'existing-offer'\n                                ? 'Existing saved offer has priority'\n                                : 'Enter a valid offer percentage'\n                          : 'Turn ON and choose the offer %';\n                        return <div className=\"mt-1.5\">\n                          <div className=\"flex items-center gap-1.5\">\n                            <button\n                              type=\"button\"\n                              onClick={() => updateProduct({ ...(p as any), auto_round_special_offer_enabled: !enabled, auto_round_special_offer_percent: offerPercent } as any)}\n                              className={\`rounded-full border px-2 py-1 text-[8px] font-black \${enabled ? 'border-orange-500/40 bg-orange-500/10 text-orange-300' : 'border-neutral-700 bg-neutral-950 text-neutral-500'}\`}\n                              title=\"The real customer price never changes. Choose the offer percentage to calculate the crossed reference price automatically.\"\n                            >\n                              SPECIAL OFFER {enabled ? 'ON' : 'OFF'}\n                            </button>\n                            <div className=\"flex items-center rounded-lg border border-neutral-700 bg-neutral-950 px-1.5 py-0.5\">\n                              <input\n                                type=\"number\"\n                                min=\"1\"\n                                max=\"80\"\n                                step=\"1\"\n                                value={offerPercent}\n                                disabled={!enabled}\n                                onChange={(e) => {\n                                  const value = Math.max(1, Math.min(80, Number(e.target.value || 5)));\n                                  updateProduct({ ...(p as any), auto_round_special_offer_enabled: true, auto_round_special_offer_percent: value } as any);\n                                }}\n                                className=\"w-9 bg-transparent text-center text-[9px] font-black text-white outline-none disabled:text-neutral-600\"\n                                aria-label=\"Special Offer percentage\"\n                              />\n                              <span className=\"text-[8px] font-black text-neutral-400\">%</span>\n                            </div>\n                          </div>\n                          <p className=\"mt-1 max-w-[210px] whitespace-normal text-[8px] leading-3 text-neutral-500\">{note}</p>\n                        </div>;`;

      text = replaceRequired(text, oldBlock, newBlock, 'Admin percentage control');
      return { code: text, map: null };
    }

    return null;
  },
});
