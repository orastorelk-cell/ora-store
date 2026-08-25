const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA round special offer] ${label} marker not found`);
  return text.replace(from, to);
};

export const roundSpecialOfferPatch = () => ({
  name: 'ora-round-special-offer-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/lib/productVariants.ts')) {
      let text = code;
      const importMarker = "import { BundleComponent, Order, Product, ProductVariant, StoreSettings } from '../types';\n";
      if (!text.includes("from './roundSpecialOffer'")) {
        text = replaceRequired(
          text,
          importMarker,
          importMarker + "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from './roundSpecialOffer';\n",
          'productVariants import',
        );
      }

      const oldPricing = `  const unitPrice = displayUnitPrice(product, settings, variant);\n  const regularUnitPrice = regularDisplayUnitPrice(product, settings, variant);\n  const actualBuyingPrice = effectiveBuyingPrice(product, variant);\n  const supplierOfferDiscountPerUnit = Math.max(0, regularUnitPrice - unitPrice);`;
      const newPricing = `  const unitPrice = displayUnitPrice(product, settings, variant);\n  const savedRegularUnitPrice = regularDisplayUnitPrice(product, settings, variant);\n  const existingOfferActive = savedRegularUnitPrice > unitPrice + 0.001;\n  const roundSpecialOffer = calculateRoundSpecialOffer({\n    currentPrice: unitPrice,\n    enabled: normalizedProductType(product) !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n    freeDeliveryEnabled: Boolean(settings?.free_delivery_enabled),\n    hasExistingDiscount: existingOfferActive,\n  });\n  const regularUnitPrice = roundSpecialOffer.active ? roundSpecialOffer.regularPrice : savedRegularUnitPrice;\n  const actualBuyingPrice = effectiveBuyingPrice(product, variant);\n  // This existing snapshot field feeds Invoice V6's \"Special Offer\" row. For the\n  // automatic round offer it stores only the display saving; the charged unit price\n  // remains unitPrice and therefore profit/cart/payment calculations stay unchanged.\n  const supplierOfferDiscountPerUnit = Math.max(0, regularUnitPrice - unitPrice);`;
      text = replaceRequired(text, oldPricing, newPricing, 'order snapshot pricing');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductCard.tsx')) {
      let text = code;
      const oldImport = "import { activeVariants, normalizedProductType, productPriceRange, regularDisplayUnitPrice, selectionDiscountPercent } from '../lib/productVariants';\n";
      const newImport = "import { activeVariants, displayUnitPrice, normalizedProductType, productPriceRange, regularDisplayUnitPrice, selectionDiscountPercent } from '../lib/productVariants';\nimport { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../lib/roundSpecialOffer';\n";
      text = replaceRequired(text, oldImport, newImport, 'ProductCard imports');

      const oldCalc = `  const hasDiscount = discountPercent > 0;\n  const regularPrice = type !== 'variant' ? regularDisplayUnitPrice(product, settings) : 0;\n  const needsSelection = type === 'variant';`;
      const newCalc = `  const hasDiscount = discountPercent > 0;\n  const regularPrice = type !== 'variant' ? regularDisplayUnitPrice(product, settings) : 0;\n  const autoRoundOffers = type === 'variant'\n    ? activeVariants(product).map((variant) => {\n        const current = displayUnitPrice(product, settings, variant);\n        const savedRegular = regularDisplayUnitPrice(product, settings, variant);\n        return calculateRoundSpecialOffer({\n          currentPrice: current,\n          enabled: roundSpecialOfferEnabledForProduct(product),\n          freeDeliveryEnabled: Boolean(settings.free_delivery_enabled),\n          hasExistingDiscount: savedRegular > current + 0.001,\n        });\n      })\n    : [calculateRoundSpecialOffer({\n        currentPrice: range.min,\n        enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n        freeDeliveryEnabled: Boolean(settings.free_delivery_enabled),\n        hasExistingDiscount: hasDiscount,\n      })];\n  const hasAutoRoundOffer = !hasDiscount && autoRoundOffers.some((offer) => offer.active);\n  const autoReferencePrice = !hasDiscount && range.min === range.max\n    ? (autoRoundOffers.find((offer) => offer.active && Math.abs(offer.offerPrice - range.min) < 0.01)?.regularPrice || 0)\n    : 0;\n  const needsSelection = type === 'variant';`;
      text = replaceRequired(text, oldCalc, newCalc, 'ProductCard offer calculation');

      const oldBadge = `        {hasDiscount && (\n          <div className=\"ora-product-card-discount absolute top-2 left-2 bg-orange-600 text-white text-xs sm:text-sm font-black px-2.5 py-1.5 rounded-xl shadow-lg\">\n            {type === 'variant' ? \`UP TO \${discountPercent}% OFF\` : \`\${discountPercent}% OFF\`}\n          </div>\n        )}`;
      const newBadge = `        {(hasDiscount || hasAutoRoundOffer) && (\n          <div className=\"ora-product-card-discount absolute top-2 left-2 bg-orange-600 text-white text-xs sm:text-sm font-black px-2.5 py-1.5 rounded-xl shadow-lg\">\n            {hasDiscount ? (type === 'variant' ? \`UP TO \${discountPercent}% OFF\` : \`\${discountPercent}% OFF\`) : 'SPECIAL OFFER'}\n          </div>\n        )}`;
      text = replaceRequired(text, oldBadge, newBadge, 'ProductCard badge');

      const oldPrice = `          {hasDiscount && type !== 'variant' && (\n            <div className=\"ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold\">Rs. {formatLkr(regularPrice)}</div>\n          )}`;
      const newPrice = `          {hasDiscount && type !== 'variant' && (\n            <div className=\"ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold\">Rs. {formatLkr(regularPrice)}</div>\n          )}\n          {!hasDiscount && autoReferencePrice > 0 && (\n            <div className=\"ora-product-card-regular-price text-xs sm:text-sm text-gray-400 line-through font-bold\">Rs. {formatLkr(autoReferencePrice)}</div>\n          )}`;
      text = replaceRequired(text, oldPrice, newPrice, 'ProductCard reference price');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductDetailModal.tsx')) {
      let text = code;
      const importMarker = "import { formatLkr } from '../lib/currency';\n";
      if (!text.includes("from '../lib/roundSpecialOffer'")) {
        text = replaceRequired(
          text,
          importMarker,
          importMarker + "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../lib/roundSpecialOffer';\n",
          'ProductDetail import',
        );
      }

      const oldCalc = `  const discountPercent = selectionDiscountPercent(selectedProduct, selectedVariant, settings);\n  const hasDiscount = discountPercent > 0;\n  const deliveryLabel = settings.free_delivery_enabled`;
      const newCalc = `  const discountPercent = selectionDiscountPercent(selectedProduct, selectedVariant, settings);\n  const hasDiscount = discountPercent > 0;\n  const autoRoundSpecialOffer = calculateRoundSpecialOffer({\n    currentPrice: unitPrice,\n    enabled: type !== 'bundle' && roundSpecialOfferEnabledForProduct(selectedProduct),\n    freeDeliveryEnabled: Boolean(settings.free_delivery_enabled),\n    hasExistingDiscount: regularUnitPrice > unitPrice + 0.001,\n  });\n  const hasDisplayedSpecialOffer = hasDiscount || autoRoundSpecialOffer.active;\n  const displayedRegularPrice = hasDiscount ? regularUnitPrice : autoRoundSpecialOffer.regularPrice;\n  const deliveryLabel = settings.free_delivery_enabled`;
      text = replaceRequired(text, oldCalc, newCalc, 'ProductDetail offer calculation');

      const oldImageBadge = `{hasDiscount && <span className=\"absolute left-4 top-4 rounded-xl bg-orange-600 px-3 py-2 text-sm font-black text-white shadow-lg\">{discountPercent}% OFF</span>}`;
      const newImageBadge = `{hasDisplayedSpecialOffer && <span className=\"absolute left-4 top-4 rounded-xl bg-orange-600 px-3 py-2 text-sm font-black text-white shadow-lg\">{hasDiscount ? \`\${discountPercent}% OFF\` : 'SPECIAL OFFER'}</span>}`;
      text = replaceRequired(text, oldImageBadge, newImageBadge, 'ProductDetail image badge');

      const oldPriceBlock = `              {hasDiscount && <div className=\"mb-1 text-sm font-bold text-gray-400 line-through\">Rs. {formatLkr(regularUnitPrice)}</div>}\n              <div className=\"flex flex-wrap items-center gap-2\"><span className=\"text-3xl font-black text-orange-600\">Rs. {formatLkr(unitPrice)}</span>{hasDiscount && <span className=\"rounded-full bg-orange-100 px-2 py-1 text-[10px] font-black text-orange-700\">SPECIAL OFFER</span>}</div>`;
      const newPriceBlock = `              {hasDisplayedSpecialOffer && <div className=\"mb-1 text-sm font-bold text-gray-400 line-through\">Rs. {formatLkr(displayedRegularPrice)}</div>}\n              <div className=\"flex flex-wrap items-center gap-2\"><span className=\"text-3xl font-black text-orange-600\">Rs. {formatLkr(unitPrice)}</span>{hasDisplayedSpecialOffer && <span className=\"rounded-full bg-orange-100 px-2 py-1 text-[10px] font-black text-orange-700\">SPECIAL OFFER</span>}</div>`;
      text = replaceRequired(text, oldPriceBlock, newPriceBlock, 'ProductDetail price block');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      let text = code;
      const importMarker = "import { createProductBackup, PRODUCT_BACKUP_MAX_BYTES, validateProductBackup } from '../../lib/productBackup';\n";
      if (!text.includes("from '../../lib/roundSpecialOffer'")) {
        text = replaceRequired(
          text,
          importMarker,
          importMarker + "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct } from '../../lib/roundSpecialOffer';\n",
          'Admin import',
        );
      }

      const oldCustomerPrice = `                    <td className=\"p-3 whitespace-nowrap\">\n                      <p className=\"font-black text-emerald-300\">{adminWithDeliveryPrice(p, settings)}</p>\n                      <p className=\"mt-0.5 text-[9px] text-neutral-500\">Includes Rs. {Math.max(0, Number(settings.delivery_fee || 0)).toLocaleString()} delivery</p>\n                    </td>`;
      const newCustomerPrice = `                    <td className=\"p-3 whitespace-nowrap\">\n                      <p className=\"font-black text-emerald-300\">{adminWithDeliveryPrice(p, settings)}</p>\n                      <p className=\"mt-0.5 text-[9px] text-neutral-500\">Includes Rs. {Math.max(0, Number(settings.delivery_fee || 0)).toLocaleString()} delivery</p>\n                      {normalizedProductType(p) !== 'bundle' && (() => {\n                        const enabled = roundSpecialOfferEnabledForProduct(p);\n                        const currentPrice = displayUnitPrice(p, settings);\n                        const hasExistingDiscount = normalizedProductType(p) !== 'variant' && p.discount_enabled !== false && Number(p.discount_price || 0) > 0 && Number(p.discount_price || 0) < Number(p.selling_price || 0);\n                        const preview = calculateRoundSpecialOffer({ currentPrice, enabled, freeDeliveryEnabled:Boolean(settings.free_delivery_enabled), hasExistingDiscount });\n                        const note = enabled\n                          ? !settings.free_delivery_enabled\n                            ? 'Waiting for Free Delivery ON'\n                            : normalizedProductType(p) === 'variant'\n                              ? 'Checks each variant price automatically'\n                              : preview.active\n                                ? \`Rs. \${preview.regularPrice.toLocaleString()} → Rs. \${preview.offerPrice.toLocaleString()}\`\n                                : preview.reason === 'existing-offer'\n                                  ? 'Existing saved offer has priority'\n                                  : 'Current customer price is already round'\n                          : 'Works only on non-round customer prices';\n                        return <div className=\"mt-1.5\">\n                          <button\n                            type=\"button\"\n                            onClick={() => updateProduct({ ...(p as any), auto_round_special_offer_enabled: !enabled } as any)}\n                            className={\`rounded-full border px-2 py-1 text-[8px] font-black \${enabled ? 'border-orange-500/40 bg-orange-500/10 text-orange-300' : 'border-neutral-700 bg-neutral-950 text-neutral-500'}\`}\n                            title=\"Automatic Special Offer works only while Free Delivery is ON. It never changes the actual charged customer price.\"\n                          >\n                            SPECIAL OFFER {enabled ? 'ON' : 'OFF'}\n                          </button>\n                          <p className=\"mt-1 max-w-[190px] whitespace-normal text-[8px] leading-3 text-neutral-500\">{note}</p>\n                        </div>;\n                      })()}\n                    </td>`;
      text = replaceRequired(text, oldCustomerPrice, newCustomerPrice, 'Admin customer price toggle');
      return { code: text, map: null };
    }

    if (id.endsWith('/src/lib/googleSheets.ts')) {
      let text = code;
      const startMarker = 'const orderQtyOfferLabel = (order: any): string => {';
      const endMarker = '\n\nconst sheetQtyOfferRules =';
      const start = text.indexOf(startMarker);
      const end = text.indexOf(endMarker, start);
      if (start < 0 || end < 0) throw new Error('[O-RA round special offer] Google Sheet offer helper markers not found');
      const helperBlock = `const orderItemSpecialOfferDiscount = (order: any) => roundMoney((Array.isArray(order?.items) ? order.items : []).reduce(\n  (sum: number, item: any) => sum + Math.max(0, Number(item?.supplier_offer_discount_per_unit || 0)) * Math.max(1, Number(item?.quantity || 1)),\n  0,\n));\n\nconst orderQtyOfferLabel = (order: any): string => {\n  const items = Array.isArray(order?.items) ? order.items : [];\n  const totalQty = items.reduce(\n    (sum: number, item: any) => sum + Math.max(1, Number(item?.quantity || 1)),\n    0,\n  );\n  const special = Math.max(0, orderItemSpecialOfferDiscount(order));\n  const qtyDiscount = Math.max(0, roundMoney(order?.special_offer_discount || order?.discount || 0));\n  const labels: string[] = [];\n  if (special > 0) labels.push(\`Special Offer Rs. \${special}\`);\n  if (qtyDiscount > 0) labels.push(\`Qty Offer Rs. \${qtyDiscount} (\${totalQty} items)\`);\n  return labels.length ? labels.join(' + ') : 'No Offer';\n};\n\nconst orderTotalOfferDiscount = (order: any) => roundMoney(\n  orderItemSpecialOfferDiscount(order) + Math.max(0, roundMoney(order?.special_offer_discount || order?.discount || 0)),\n);\n\nconst orderNormalDisplayTotal = (order: any) => roundMoney(\n  Math.max(0, Number(order?.subtotal || 0)) + orderItemSpecialOfferDiscount(order),\n);`;
      text = text.slice(0, start) + helperBlock + text.slice(end);
      text = replaceRequired(
        text,
        "    'Discount (Rs)': isFirst ? roundMoney(order?.special_offer_discount || order?.discount || 0) : '',\n    'Normal Total (Rs)': isFirst ? roundMoney(order?.subtotal || 0) : '',",
        "    'Discount (Rs)': isFirst ? orderTotalOfferDiscount(order) : '',\n    'Normal Total (Rs)': isFirst ? orderNormalDisplayTotal(order) : '',",
        'Google Sheet totals',
      );
      return { code: text, map: null };
    }

    return null;
  },
});
