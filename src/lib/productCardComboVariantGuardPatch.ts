export const productCardComboVariantGuardPatch = () => ({
  name: 'ora-product-card-combo-variant-guard-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/ProductCard.tsx')) return null;
    let text = code;

    const oldStore = "  const { language, addToCart, setSelectedProduct, startBuyNow, settings } = useStore();";
    const newStore = "  const { language, addToCart, setSelectedProduct, startBuyNow, settings, products } = useStore();";
    if (text.includes(oldStore)) text = text.replace(oldStore, newStore);

    const oldNeeds = "  const needsSelection = type === 'variant';";
    const newNeeds = `  const comboNeedsSelection = type === 'bundle' && (product.bundle_components || []).some((component) => {\n    if (component.variant_id) return false;\n    const child = products.find((row) => row.id === component.product_id);\n    return Boolean(child && normalizedProductType(child) === 'variant' && activeVariants(child).length > 0);\n  });\n  const needsSelection = type === 'variant' || comboNeedsSelection;`;
    if (text.includes(oldNeeds)) text = text.replace(oldNeeds, newNeeds);

    if (text === code) return null;
    return { code: text, map: null };
  },
});
