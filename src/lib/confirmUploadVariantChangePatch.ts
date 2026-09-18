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
        const existingVariant=String(
          existingCandidate?.variant_name ||
          (existingCandidate?.bundle_components || []).map((component:any)=>String(component?.variant_name||'').trim()).find(Boolean) ||
          ''
        ).trim();
        // A requested Sheet variant is authoritative even when an older combo snapshot
        // did not store a top-level variant_name. Blank old metadata must rebuild too.
        const variantChanged=Boolean(requestedVariant && requestedVariant.toLowerCase()!==existingVariant.toLowerCase());
        const existingItem=!applyRequested && !variantChanged ? existingCandidate : undefined;`;

    let next = code.replace(oldLine, replacement);

    // confirmUploadPackingBatchPatch builds a fresh snapshot when variantChanged=true.
    // For combo packs, the resolved bundle component already points at the selected
    // child variant; also persist the Sheet-selected variant at item level so invoice,
    // Fardar CSV, later uploads and future comparisons all read the same value.
    const freshItemLine = "            const freshItem=buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products);";
    if (next.includes(freshItemLine) && !next.includes("freshItem.variant_name=requestedVariant")) {
      next = next.replace(
        freshItemLine,
        freshItemLine + "\n            if(normalizedProductType(selection.product)==='bundle' && requestedVariant) freshItem.variant_name=requestedVariant;"
      );
    }

    return next === code ? null : { code: next, map: null };
  },
});
