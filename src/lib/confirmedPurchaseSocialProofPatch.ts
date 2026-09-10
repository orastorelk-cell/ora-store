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

      const cardEffectMarker = String.raw`  React.useEffect(() => {
    const sync = () => setWishlisted(isInWishlist(product.id));`;
      const cardEffectInsert = String.raw`  React.useEffect(() => {
    let cancelled = false;
    confirmedPurchaseCountForSku(product.sku).then((count) => {
      if (!cancelled) setConfirmedPurchaseCount(count);
    });
    return () => { cancelled = true; };
  }, [product.sku]);

  React.useEffect(() => {
    const sync = () => setWishlisted(isInWishlist(product.id));`;
      text = replaceRequired(text, cardEffectMarker, cardEffectInsert, 'ProductCard count effect');

      const cardUiOld = String.raw`          <p className={`ora-product-card-delivery mt-1 flex items-center gap-1 whitespace-nowrap text-[9px] font-black leading-tight ${settings.free_delivery_enabled ? 'text-emerald-600' : 'text-gray-500'}`}>
            <span aria-hidden="true">🚚</span>
            <span>{deliveryLabel}</span>
          </p>
        </div>`;
      const cardUiNew = String.raw`          <p className={`ora-product-card-delivery mt-1 flex items-center gap-1 whitespace-nowrap text-[9px] font-black leading-tight ${settings.free_delivery_enabled ? 'text-emerald-600' : 'text-gray-500'}`}>
            <span aria-hidden="true">🚚</span>
            <span>{deliveryLabel}</span>
          </p>
          {confirmedPurchaseCount > 0 && (
            <p className="mt-1 flex items-center gap-1 text-[9px] font-bold leading-tight text-gray-500">
              <span aria-hidden="true">👥</span>
              <span>{language === 'si' ? `පාරිභෝගිකයින් ${confirmedPurchaseCount} දෙනෙක් මෙම භාණ්ඩය ඇණවුම් කර ඇත` : `${confirmedPurchaseCount} customer${confirmedPurchaseCount === 1 ? '' : 's'} ordered this item`}</span>
            </p>
          )}
        </div>`;
      text = replaceRequired(text, cardUiOld, cardUiNew, 'ProductCard social proof UI');
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

      const detailEffectMarker = String.raw`  useEffect(() => {
    if (!selectedProduct) {`;
      const detailEffectInsert = String.raw`  useEffect(() => {
    if (!selectedProduct) {
      setConfirmedPurchaseCount(0);
      return;
    }
    let cancelled = false;
    confirmedPurchaseCountForSku(selectedProduct.sku).then((count) => {
      if (!cancelled) setConfirmedPurchaseCount(count);
    });
    return () => { cancelled = true; };
  }, [selectedProduct?.sku]);

  useEffect(() => {
    if (!selectedProduct) {`;
      text = replaceRequired(text, detailEffectMarker, detailEffectInsert, 'ProductDetail count effect');

      const detailUiOld = String.raw`              <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-black ${settings.free_delivery_enabled ? 'text-emerald-600' : 'text-gray-600'}`}><span aria-hidden="true">🚚</span><span>{deliveryLabel}</span></p>
              {(forcedOutOfStock || allVariantsForcedOut) && (`;
      const detailUiNew = String.raw`              <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-black ${settings.free_delivery_enabled ? 'text-emerald-600' : 'text-gray-600'}`}><span aria-hidden="true">🚚</span><span>{deliveryLabel}</span></p>
              {confirmedPurchaseCount > 0 && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-orange-100 bg-white px-3 py-1.5 text-[11px] font-black text-gray-700 shadow-sm">
                  <span aria-hidden="true">👥</span>
                  <span>{language === 'si' ? `පාරිභෝගිකයින් ${confirmedPurchaseCount} දෙනෙක් මෙම භාණ්ඩය ඇණවුම් කර ඇත` : `${confirmedPurchaseCount} customer${confirmedPurchaseCount === 1 ? '' : 's'} ordered this item`}</span>
                </div>
              )}
              {(forcedOutOfStock || allVariantsForcedOut) && (`;
      text = replaceRequired(text, detailUiOld, detailUiNew, 'ProductDetail social proof UI');
      return { code: text, map: null };
    }

    return null;
  },
});
