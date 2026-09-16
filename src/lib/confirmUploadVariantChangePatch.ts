export const confirmUploadVariantChangePatch = () => ({
  name: 'ora-confirm-upload-variant-change-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;

    const oldLine = "        const existingItem=!applyRequested ? (sameExistingItem(indexedExisting)?indexedExisting:(order.items||[]).find(it=>sameExistingItem(it))) : undefined;";
    if (!code.includes(oldLine)) {
      // confirmUploadPackingBatchPatch may run before this plugin and inject the line.
      // If the marker is absent here, do nothing rather than touching unrelated order logic.
      return null;
    }

    const replacement = String.raw`        // The Confirm Sheet's Variant / Color column is authoritative for fulfilment.
        // A same-SKU variant change (for example Twin Tub -> Single Tub in a Combo)
        // must rebuild the item snapshot even when Apply Item Change is FALSE. The old
        // behaviour preserved the original bundle_components and could allocate stock
        // from the old variant while the invoice snapshot showed the new variant.
        const requestedVariant=variantI>=0?String(c[variantI]||'').trim():'';
        const existingCandidate=sameExistingItem(indexedExisting)?indexedExisting:(order.items||[]).find(it=>sameExistingItem(it));
        const existingVariant=String(existingCandidate?.variant_name||'').trim();
        const variantChanged=Boolean(requestedVariant && existingVariant && requestedVariant.toLowerCase()!==existingVariant.toLowerCase());
        const existingItem=!applyRequested && !variantChanged ? existingCandidate : undefined;`;

    const next = code.replace(oldLine, replacement);
    return next === code ? null : { code: next, map: null };
  },
});
