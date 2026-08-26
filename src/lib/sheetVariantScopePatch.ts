const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA Sheet variant scope] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Google Sheet variant safety only.
 *
 * - A normal/combo order row never exports a stale Variant / Color value.
 * - Product Catalog sync strips stale variants[] from products explicitly saved as
 *   non-variant, without mutating the real in-memory product catalog.
 *
 * This does not change product prices, orders, stock, invoice math or confirmation logic.
 */
export const sheetVariantScopePatch = () => ({
  name: 'ora-sheet-variant-scope-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/lib/googleSheets.ts')) return null;

    let text = code;

    text = replaceRequired(
      text,
      "const buildOrderSheetRow = (order: any, item: any, isFirst: boolean, settings:Record<string,any>) => {",
      "const sheetVariantValue = (item:any) => {\n  const type = String(item?.product_type || '').trim().toLowerCase();\n  const isVariant = type ? type === 'variant' : Boolean(item?.variant_id);\n  return isVariant ? String(item?.variant_name || '') : '';\n};\n\nconst buildOrderSheetRow = (order: any, item: any, isFirst: boolean, settings:Record<string,any>) => {",
      'row helper',
    );

    text = replaceRequired(
      text,
      "    'Variant / Color': String(item?.variant_name || ''),",
      "    'Variant / Color': sheetVariantValue(item),",
      'variant column',
    );

    text = replaceRequired(
      text,
      "    'Original Variant / Color': String(item?.variant_name || ''),",
      "    'Original Variant / Color': sheetVariantValue(item),",
      'original variant column',
    );

    text = replaceRequired(
      text,
      "  const posted = await postToAppsScript(webhookUrl, { action: 'catalog_sync', products });",
      "  const catalogProducts = (products || []).map((product:any) => {\n    const explicitType = String(product?.product_type || '').trim().toLowerCase();\n    const hasVariants = Array.isArray(product?.variants) && product.variants.length > 0;\n    const isVariant = explicitType ? explicitType === 'variant' : hasVariants;\n    return isVariant ? product : { ...product, variants: [] };\n  });\n  const posted = await postToAppsScript(webhookUrl, { action: 'catalog_sync', products: catalogProducts });",
      'catalog sync sanitization',
    );

    return { code: text, map: null };
  },
});
