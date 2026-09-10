const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA Apps Script order cross price] ${label} marker not found`);
  return text.replace(from, to);
};

export const googleAppsScriptOrderCrossPricePatch = () => ({
  name: 'ora-google-apps-script-order-cross-price-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/lib/googleSheets.ts')) return null;
    let text = code;

    const importMarker = "import { GOOGLE_APPS_SCRIPT_CATALOG_IMAGE } from './googleAppsScriptCatalogImage';\n";
    if (!text.includes("from './googleAppsScriptOrderCrossPriceFix'")) {
      text = replaceRequired(
        text,
        importMarker,
        importMarker + "import { GOOGLE_APPS_SCRIPT_ORDER_CROSS_PRICE_FIX } from './googleAppsScriptOrderCrossPriceFix';\n",
        'order cross price import',
      );
    }

    const currencyTail = '${GOOGLE_APPS_SCRIPT_CURRENCY_PARSE_FIX}`;';
    const orderTail = '${GOOGLE_APPS_SCRIPT_CURRENCY_PARSE_FIX}\\n\\n${GOOGLE_APPS_SCRIPT_ORDER_CROSS_PRICE_FIX}`;';
    if (text.includes(currencyTail)) {
      text = text.replace(currencyTail, orderTail);
    } else {
      const offerTail = '${GOOGLE_APPS_SCRIPT_CATALOG_OFFER_COLUMNS}`;';
      const offerOrderTail = '${GOOGLE_APPS_SCRIPT_CATALOG_OFFER_COLUMNS}\\n\\n${GOOGLE_APPS_SCRIPT_ORDER_CROSS_PRICE_FIX}`;';
      text = replaceRequired(text, offerTail, offerOrderTail, 'Apps Script append');
    }

    return { code: text, map: null };
  },
});
