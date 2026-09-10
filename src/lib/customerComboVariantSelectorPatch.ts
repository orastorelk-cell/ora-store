const replaceOnce = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA customer combo variant] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Shows customer-selectable variants for a combo component saved at main-product level.
 * The selected child variant is written into a cloned bundle product before Add to Cart / Buy Now,
 * so existing bundle stock allocation keeps deducting the exact underlying variant stock.
 */
export const customerComboVariantSelectorPatch = () => ({
  name: 'ora-customer-combo-variant-selector-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/ProductDetailModal.tsx')) return null;
    let text = code;

    const oldState = `  const [selectedVariantId, setSelectedVariantId] = useState<string>('');\n  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});`;
    const newState = `  const [selectedVariantId, setSelectedVariantId] = useState<string>('');\n  const [selectedBundleVariantId, setSelectedBundleVariantId] = useState<string>('');\n  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});`;
    text = replaceOnce(text, oldState, newState, 'state');

    const oldResetA = `      setSelectedVariantId('');\n      setSelectedOptions({});`;
    const newResetA = `      setSelectedVariantId('');\n      setSelectedBundleVariantId('');\n      setSelectedOptions({});`;
    text = replaceOnce(text, oldResetA, newResetA, 'closed reset');

    const oldResetB = `    setSelectedVariantId(first?.id || '');\n    setSelectedOptions(Object.fromEntries(variantOptions(first).map((option) => [option.name, option.value])));`;
    const newResetB = `    setSelectedVariantId(first?.id || '');\n    setSelectedBundleVariantId('');\n    setSelectedOptions(Object.fromEntries(variantOptions(first).map((option) => [option.name, option.value])));`;
    text = replaceOnce(text, oldResetB, newResetB, 'product reset');

    const oldType = `  const variants = type === 'variant' ? activeVariants(selectedProduct) : [];\n  const selectedVariant = type === 'variant' ? variantById(selectedProduct, selectedVariantId) : undefined;`;
    const newType = `  const variants = type === 'variant' ? activeVariants(selectedProduct) : [];\n  const selectedVariant = type === 'variant' ? variantById(selectedProduct, selectedVariantId) : undefined;\n  const inheritedBundleComponent = type === 'bundle'\n    ? (selectedProduct.bundle_components || [])\n        .map((component, index) => ({ component, index, product: products.find((p) => p.id === component.product_id) }))\n        .find((row) => !row.component.variant_id && row.product && normalizedProductType(row.product) === 'variant')\n    : undefined;\n  const inheritedBundleProduct = inheritedBundleComponent?.product;\n  const inheritedBundleVariants = inheritedBundleProduct ? activeVariants(inheritedBundleProduct) : [];\n  const selectedBundleVariant = inheritedBundleProduct ? variantById(inheritedBundleProduct, selectedBundleVariantId) : undefined;\n  const customerBundleProduct = inheritedBundleComponent && selectedBundleVariant\n    ? {\n        ...selectedProduct,\n        bundle_components: (selectedProduct.bundle_components || []).map((component, index) =>\n          index === inheritedBundleComponent.index ? { ...component, variant_id: selectedBundleVariant.id } : component\n        ),\n      }\n    : selectedProduct;`;
    text = replaceOnce(text, oldType, newType, 'bundle variant derivation');

    const oldCanOrder = `  const canOrder = !forcedOutOfStock && !allVariantsForcedOut && (type !== 'variant' || Boolean(selectedVariant));`;
    const newCanOrder = `  const canOrder = !forcedOutOfStock && !allVariantsForcedOut\n    && (type !== 'variant' || Boolean(selectedVariant))\n    && (!inheritedBundleComponent || Boolean(selectedBundleVariant));`;
    text = replaceOnce(text, oldCanOrder, newCanOrder, 'can order');

    const oldBuy = `    startBuyNow(selectedProduct, quantity, selectedVariant?.id);`;
    const newBuy = `    startBuyNow(customerBundleProduct, quantity, selectedVariant?.id);`;
    text = replaceOnce(text, oldBuy, newBuy, 'buy now');

    const oldCart = `    addToCart(selectedProduct, quantity, selectedVariant?.id);`;
    const newCart = `    addToCart(customerBundleProduct, quantity, selectedVariant?.id);`;
    text = replaceOnce(text, oldCart, newCart, 'add cart');

    const quantityMarker = `            <div className="flex flex-wrap items-center gap-3">\n              <span className="text-xs font-bold text-gray-700">Quantity:</span>`;
    const bundleSelector = `            {type === 'bundle' && inheritedBundleProduct && inheritedBundleVariants.length > 0 && (\n              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/50 p-4">\n                <p className="mb-2 text-xs font-black text-gray-900">Choose Washing Machine Type</p>\n                <div className="flex flex-wrap gap-2">\n                  {inheritedBundleVariants.map((variant) => {\n                    const value = variantOptions(variant).map((option) => option.value).filter(Boolean).join(' / ') || String(variant.option_value || '').trim() || variantOptionSummary(variant);\n                    const active = selectedBundleVariantId === variant.id;\n                    const unavailable = Boolean(variant.force_out_of_stock);\n                    return <button\n                      key={variant.id}\n                      type="button"\n                      disabled={unavailable}\n                      onClick={() => { if (!unavailable) { setSelectedBundleVariantId(variant.id); setQuantity(1); } }}\n                      className={\`min-h-10 rounded-xl border-2 px-4 py-2 text-xs font-black transition \${unavailable ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 line-through' : active ? 'border-cyan-600 bg-white text-cyan-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-cyan-300'}\`}\n                    >\n                      {value}{unavailable ? ' • Out of Stock' : ''}\n                    </button>;\n                  })}\n                </div>\n                {!selectedBundleVariant && <p className="mt-2 text-[10px] font-bold text-cyan-700">Please select one option before Add to Cart or Buy Now.</p>}\n              </div>\n            )}\n\n` + quantityMarker;
    text = replaceOnce(text, quantityMarker, bundleSelector, 'customer selector UI');

    return { code: text, map: null };
  },
});
