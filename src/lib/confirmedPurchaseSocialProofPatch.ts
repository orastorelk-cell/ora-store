const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA confirmed purchase social proof] ${label} marker not found`);
  return text.replace(from, to);
};

export const confirmedPurchaseSocialProofPatch = () => ({
  name: 'ora-confirmed-purchase-social-proof-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/components/ProductCard.tsx')) {
      text = replaceRequired(
        text,
        "import { formatLkr } from '../lib/currency';",
        "import { formatLkr } from '../lib/currency';\nimport { confirmedPurchaseCountForSku } from '../lib/confirmedPurchaseCounts';",
        'ProductCard import',
      );

      text = replaceRequired(
        text,
        "  const [wishlisted, setWishlisted] = React.useState(() => isInWishlist(product.id));",
        "  const [wishlisted, setWishlisted] = React.useState(() => isInWishlist(product.id));\n  const [confirmedPurchaseCount, setConfirmedPurchaseCount] = React.useState(0);",
        'ProductCard state',
      );

      text = replaceRequired(
        text,
        "  React.useEffect(() => {\n    const sync = () => setWishlisted(isInWishlist(product.id));",
        "  React.useEffect(() => {\n    let cancelled = false;\n    confirmedPurchaseCountForSku(product.sku).then((count) => {\n      if (!cancelled) setConfirmedPurchaseCount(count);\n    });\n    return () => { cancelled = true; };\n  }, [product.sku]);\n\n  React.useEffect(() => {\n    const sync = () => setWishlisted(isInWishlist(product.id));",
        'ProductCard count effect',
      );

      text = replaceRequired(
        text,
        "            <span>{deliveryLabel}</span>\n          </p>\n        </div>",
        "            <span>{deliveryLabel}</span>\n          </p>\n          {confirmedPurchaseCount > 0 && (\n            <p className=\"mt-1 flex items-center gap-1 text-[9px] font-bold leading-tight text-gray-500\">\n              <span aria-hidden=\"true\">👥</span>\n              <span>{language === 'si' ? ('පාරිභෝගිකයින් ' + confirmedPurchaseCount + ' දෙනෙක් මෙම භාණ්ඩය ඇණවුම් කර ඇත') : (confirmedPurchaseCount + ' customer' + (confirmedPurchaseCount === 1 ? '' : 's') + ' ordered this item')}</span>\n            </p>\n          )}\n        </div>",
        'ProductCard social proof UI',
      );

      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductDetailModal.tsx')) {
      text = replaceRequired(
        text,
        "import { formatLkr } from '../lib/currency';",
        "import { formatLkr } from '../lib/currency';\nimport { confirmedPurchaseCountForSku } from '../lib/confirmedPurchaseCounts';",
        'ProductDetail import',
      );

      text = replaceRequired(
        text,
        "  const [addedToCart, setAddedToCart] = useState(false);",
        "  const [addedToCart, setAddedToCart] = useState(false);\n  const [confirmedPurchaseCount, setConfirmedPurchaseCount] = useState(0);",
        'ProductDetail state',
      );

      text = replaceRequired(
        text,
        "  useEffect(() => {\n    if (!selectedProduct) {",
        "  useEffect(() => {\n    if (!selectedProduct) {\n      setConfirmedPurchaseCount(0);\n      return;\n    }\n    let cancelled = false;\n    confirmedPurchaseCountForSku(selectedProduct.sku).then((count) => {\n      if (!cancelled) setConfirmedPurchaseCount(count);\n    });\n    return () => { cancelled = true; };\n  }, [selectedProduct?.sku]);\n\n  useEffect(() => {\n    if (!selectedProduct) {",
        'ProductDetail count effect',
      );

      text = replaceRequired(
        text,
        "<span>{deliveryLabel}</span></p>\n              {(forcedOutOfStock || allVariantsForcedOut) && (",
        "<span>{deliveryLabel}</span></p>\n              {confirmedPurchaseCount > 0 && (\n                <div className=\"mt-3 inline-flex items-center gap-2 rounded-full border border-orange-100 bg-white px-3 py-1.5 text-[11px] font-black text-gray-700 shadow-sm\">\n                  <span aria-hidden=\"true\">👥</span>\n                  <span>{language === 'si' ? ('පාරිභෝගිකයින් ' + confirmedPurchaseCount + ' දෙනෙක් මෙම භාණ්ඩය ඇණවුම් කර ඇත') : (confirmedPurchaseCount + ' customer' + (confirmedPurchaseCount === 1 ? '' : 's') + ' ordered this item')}</span>\n                </div>\n              )}\n              {(forcedOutOfStock || allVariantsForcedOut) && (",
        'ProductDetail social proof UI',
      );

      return { code: text, map: null };
    }

    return null;
  },
});
