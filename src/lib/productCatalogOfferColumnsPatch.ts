const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA catalog offer columns] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Adds display-only crossed-price metadata to PRODUCT CATALOG without changing any
 * existing catalog column positions or the Selling Price used by Call Center logic.
 */
export const productCatalogOfferColumnsPatch = () => ({
  name: 'ora-product-catalog-offer-columns-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/lib/googleSheets.ts')) return null;

    let text = code;

    const importMarker = "import { GOOGLE_APPS_SCRIPT_CATALOG_IMAGE } from './googleAppsScriptCatalogImage';\n";
    const imports = importMarker
      + "import { GOOGLE_APPS_SCRIPT_CATALOG_OFFER_COLUMNS } from './googleAppsScriptCatalogOfferColumns';\n"
      + "import { displayUnitPrice, normalizedProductType, regularDisplayUnitPrice, selectionDiscountPercent } from './productVariants';\n"
      + "import { calculateRoundSpecialOffer, roundSpecialOfferEnabledForProduct, roundSpecialOfferPercentForSelection } from './roundSpecialOffer';\n";
    text = replaceRequired(text, importMarker, imports, 'imports');

    const oldSync = `export async function syncProductCatalogToGoogleSheets(\n  products: any[],\n  webhookUrl: string,\n  _settings?: Record<string, any>,\n): Promise<SheetActionResult> {\n  const posted = await postToAppsScript(webhookUrl, { action: 'catalog_sync', products });\n  if (!posted.ok) return { success: false, message: posted.error || 'Google Sheet catalog sync failed.' };\n  const err = expectStatus(posted.result, ['catalog_synced']);\n  if (err) return { success: false, message: err };\n  return { success: true, message: 'Product catalog synced to Google Sheet.', rows: Number(posted.result?.rows || 0), status: posted.result?.status, version: posted.result?.version };\n}`;

    const newSync = `const catalogOfferMetaForSelection = (product: any, variant: any, settings: Record<string, any>) => {\n  const currentPrice = displayUnitPrice(product, settings as any, variant);\n  const regularPrice = regularDisplayUnitPrice(product, settings as any, variant);\n  const savedDiscountPercent = selectionDiscountPercent(product, variant, settings as any);\n\n  // If a real saved/supplier discount is already displayed, mirror that storefront\n  // crossed price. Otherwise calculate only the new display-only percentage offer.\n  if (savedDiscountPercent > 0 && regularPrice > currentPrice + 0.001) {\n    return { crossedPrice: regularPrice, offerPercent: savedDiscountPercent };\n  }\n\n  const preview = calculateRoundSpecialOffer({\n    currentPrice,\n    enabled: normalizedProductType(product) !== 'bundle' && roundSpecialOfferEnabledForProduct(product),\n    percent: roundSpecialOfferPercentForSelection(product, variant),\n    hasExistingDiscount: false,\n  });\n  return preview.active\n    ? { crossedPrice: preview.regularPrice, offerPercent: preview.percent }\n    : { crossedPrice: 0, offerPercent: 0 };\n};\n\nconst catalogProductsWithOfferMeta = (products: any[], settings: Record<string, any>) =>\n  (Array.isArray(products) ? products : []).map((product: any) => {\n    const productMeta = catalogOfferMetaForSelection(product, undefined, settings);\n    return {\n      ...product,\n      sheet_crossed_price: productMeta.crossedPrice,\n      sheet_offer_percent: productMeta.offerPercent,\n      variants: Array.isArray(product?.variants)\n        ? product.variants.map((variant: any) => {\n            const variantMeta = catalogOfferMetaForSelection(product, variant, settings);\n            return {\n              ...variant,\n              sheet_crossed_price: variantMeta.crossedPrice,\n              sheet_offer_percent: variantMeta.offerPercent,\n            };\n          })\n        : product?.variants,\n    };\n  });\n\nexport async function syncProductCatalogToGoogleSheets(\n  products: any[],\n  webhookUrl: string,\n  settings: Record<string, any> = {},\n): Promise<SheetActionResult> {\n  const catalogProducts = catalogProductsWithOfferMeta(products, settings);\n  const posted = await postToAppsScript(webhookUrl, { action: 'catalog_sync', products: catalogProducts });\n  if (!posted.ok) return { success: false, message: posted.error || 'Google Sheet catalog sync failed.' };\n  const err = expectStatus(posted.result, ['catalog_synced']);\n  if (err) return { success: false, message: err };\n  return { success: true, message: 'Product catalog synced to Google Sheet.', rows: Number(posted.result?.rows || 0), status: posted.result?.status, version: posted.result?.version };\n}`;
    text = replaceRequired(text, oldSync, newSync, 'catalog sync metadata');

    const oldScriptTail = '${GOOGLE_APPS_SCRIPT_WEBSITE_SPEED}\\n\\n${GOOGLE_APPS_SCRIPT_CATALOG_IMAGE}`;';
    const newScriptTail = '${GOOGLE_APPS_SCRIPT_WEBSITE_SPEED}\\n\\n${GOOGLE_APPS_SCRIPT_CATALOG_IMAGE}\\n\\n${GOOGLE_APPS_SCRIPT_CATALOG_OFFER_COLUMNS}`;';
    text = replaceRequired(text, oldScriptTail, newScriptTail, 'Apps Script append');

    return { code: text, map: null };
  },
});
