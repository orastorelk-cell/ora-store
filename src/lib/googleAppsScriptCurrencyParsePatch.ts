const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA Apps Script currency parser] ${label} marker not found`);
  return text.replace(from, to);
};

export const googleAppsScriptCurrencyParsePatch = () => ({
  name: 'ora-google-apps-script-currency-parse-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/lib/googleSheets.ts')) return null;
    let text = code;

    const importMarker = "import { GOOGLE_APPS_SCRIPT_CATALOG_IMAGE } from './googleAppsScriptCatalogImage';\n";
    if (!text.includes("from './googleAppsScriptCurrencyParseFix'")) {
      text = replaceRequired(
        text,
        importMarker,
        importMarker + "import { GOOGLE_APPS_SCRIPT_CURRENCY_PARSE_FIX } from './googleAppsScriptCurrencyParseFix';\n",
        'currency parser import',
      );
    }

    const offerTail = '${GOOGLE_APPS_SCRIPT_CATALOG_OFFER_COLUMNS}`;';
    const fixedTail = '${GOOGLE_APPS_SCRIPT_CATALOG_OFFER_COLUMNS}\\n\\n${GOOGLE_APPS_SCRIPT_CURRENCY_PARSE_FIX}`;';
    if (text.includes(offerTail)) {
      text = text.replace(offerTail, fixedTail);
    } else {
      const baseTail = '${GOOGLE_APPS_SCRIPT_CATALOG_IMAGE}`;';
      const baseFixed = '${GOOGLE_APPS_SCRIPT_CATALOG_IMAGE}\\n\\n${GOOGLE_APPS_SCRIPT_CURRENCY_PARSE_FIX}`;';
      text = replaceRequired(text, baseTail, baseFixed, 'Apps Script append');
    }

    return { code: text, map: null };
  },
});
