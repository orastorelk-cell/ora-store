const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA order cross actual source] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Product Catalog Selling Price can exclude a delivery amount already embedded in
 * an order's actual customer Unit Price. Therefore the historical incoming/order
 * Unit Price must win; catalog Selling Price is only a fallback and a source for
 * crossed/reference metadata.
 */
export const orderCrossPriceActualSourcePatch = () => ({
  name: 'ora-order-cross-price-actual-source-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/lib/googleAppsScriptOrderCrossPriceFix.ts')) return null;
    let text = code;

    text = replaceRequired(
      text,
      `      if (!(actual > 0)) actual = snap && snap.actual > 0 ? snap.actual : (cat && cat.actual > 0 ? cat.actual : currentUnit);`,
      `      if (!(actual > 0)) actual = snap && snap.actual > 0 ? snap.actual : (currentUnit > 0 ? currentUnit : (cat && cat.actual > 0 ? cat.actual : 0));`,
      'incoming actual price priority',
    );

    text = replaceRequired(
      text,
      `    if (!(actual > 0)) actual = cat && cat.actual > 0 ? cat.actual : currentUnit;`,
      `    if (!(actual > 0)) actual = currentUnit > 0 ? currentUnit : (cat && cat.actual > 0 ? cat.actual : 0);`,
      'recalc actual price priority',
    );

    return { code: text, map: null };
  },
});
