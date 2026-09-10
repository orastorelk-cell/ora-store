const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA Facebook combo variant] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Facebook lead support for customer-select combo variants.
 * Keeps normal Facebook lead behavior unchanged.
 */
export const facebookComboVariantLeadPatch = () => ({
  name: 'ora-facebook-combo-variant-lead-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/worker/facebookLeadAuto.ts')) return null;

    let text = code;

    text = replaceRequired(
      text,
      `  const variantValue = pickField(fields, [\n    'selected_color',`,
      `  const variantValue = pickField(fields, [\n    'product_description',\n    'washing_machine_type',\n    'machine_type',\n    'selected_color',`,
      'variant field aliases',
    );

    text = replaceRequired(
      text,
      `  if (normalizedProductType(selection.product) === 'bundle') {\n    return applyFacebookBundleOfferSnapshot(selection.product, products, settings, item);\n  }`,
      `  if (normalizedProductType(selection.product) === 'bundle') {\n    const comboItem = variantValue ? { ...item, variant_name: variantValue } : item;\n    return applyFacebookBundleOfferSnapshot(selection.product, products, settings, comboItem);\n  }`,
      'combo variant name snapshot',
    );

    return { code: text, map: null };
  },
});
