export const comboPackItemSearchPatch = () => ({
  name: 'ora-combo-pack-item-search-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/ComboPacksPanel.tsx')) return null;

    let text = code;

    // Variant products must also be selectable by their MAIN code. Choosing the
    // main code means the customer/call-center will select the exact variant later.
    const oldRows = `if (normalizedProductType(product) === 'variant') {\n        for (const variant of activeVariants(product)) {\n          rows.push({ product_id: product.id, variant_id: variant.id, code: normalizeSku(variant.sku), name: product.name_en, detail: variantOptionSummary(variant) });\n        }\n      } else {`;
    const newRows = `if (normalizedProductType(product) === 'variant') {\n        const variants = activeVariants(product);\n        const inheritedSummary = variants.map((variant) => variantOptionSummary(variant)).filter(Boolean).join(' / ');\n        rows.push({ product_id: product.id, code: normalizeSku(product.sku), name: product.name_en, detail: inheritedSummary ? \`Customer Selects: \${inheritedSummary}\` : 'Customer Selects Variant' });\n        for (const variant of variants) {\n          rows.push({ product_id: product.id, variant_id: variant.id, code: normalizeSku(variant.sku), name: product.name_en, detail: variantOptionSummary(variant) });\n        }\n      } else {`;
    if (text.includes(oldRows)) text = text.replace(oldRows, newRows);

    // Do not force a fixed variant for a combo component. A blank variant_id on a
    // variant product intentionally means "inherit the Variant / Color chosen for
    // the order". Stock allocation resolves that to the underlying variant.
    const oldGuard = `    if (components.some((component) => normalizedProductType(products.find((product) => product.id === component.product_id)) === 'variant' && !component.variant_id)) return alert('Select the exact variant Item Code for every variant product.');\n`;
    if (text.includes(oldGuard)) {
      text = text.replace(oldGuard, `    // Variant products may stay at main-code level so the order can choose the exact variant later.\n`);
    }

    const oldHelp = `<p className="text-[10px] text-neutral-500">Choose the exact Item Code and enter how many units of it go into one pack.</p>`;
    const newHelp = `<p className="text-[10px] text-neutral-500">Choose a main Item Code for Customer Select variants, or choose an exact variant to lock it. Stock always comes from the selected underlying variant.</p>`;
    if (text.includes(oldHelp)) text = text.replace(oldHelp, newHelp);

    // Keep the existing searchable combo item picker, but also show inherited
    // variants clearly when the saved component is using the product main code.
    if (!text.includes('combo-item-options-${index}')) {
      const oldBlock = `                <label className="text-[10px] font-bold text-neutral-400">Exact Single Item Code\n                  <select value={resolved.code} onChange={(event) => updateComponent(index, event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-white">\n                    <option value="">Choose Item Code...</option>\n                    {selectableItems.map((item) => <option key={\`\${item.product_id}-\${item.variant_id || 'base'}\`} value={item.code}>{item.code} — {item.name}{item.detail ? \` / \${item.detail}\` : ''}</option>)}\n                  </select>\n                </label>`;

      const newBlock = `                <label className="text-[10px] font-bold text-neutral-400">Single Item Code / Variant\n                  <input\n                    key={\`\${component.product_id}-\${component.variant_id || 'base'}\`}\n                    list={\`combo-item-options-\${index}\`}\n                    defaultValue={resolved.code ? \`\${resolved.code} — \${resolved.product?.name_en || ''}\${resolved.variant ? \` / \${variantOptionSummary(resolved.variant)}\` : ''}\` : ''}\n                    onChange={(event) => {\n                      const raw = event.target.value.trim();\n                      const codePart = raw.includes(' — ') ? raw.split(' — ')[0] : raw;\n                      const normalized = normalizeSku(codePart);\n                      if (selectableItems.some((item) => item.code === normalized)) updateComponent(index, normalized);\n                    }}\n                    placeholder="Type item code or part of item name..."\n                    autoComplete="off"\n                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-white"\n                  />\n                  <datalist id={\`combo-item-options-\${index}\`}>\n                    {selectableItems.map((item) => (\n                      <option key={\`\${item.product_id}-\${item.variant_id || 'base'}\`} value={\`\${item.code} — \${item.name}\${item.detail ? \` / \${item.detail}\` : ''}\`} />\n                    ))}\n                  </datalist>\n                  {resolved.product && normalizedProductType(resolved.product) === 'variant' && !resolved.variant && (\n                    <span className="mt-1 block rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1.5 text-[9px] font-bold text-emerald-300">\n                      Customer Select: {activeVariants(resolved.product).map((variant) => variant.option_value).filter(Boolean).join(' / ')}\n                    </span>\n                  )}\n                  <span className="mt-1 block text-[9px] font-normal text-neutral-500">Main code = customer selects variant later. Exact variant code = locked variant.</span>\n                </label>`;

      if (text.includes(oldBlock)) text = text.replace(oldBlock, newBlock);
    }

    return text === code ? null : { code: text, map: null };
  },
});
