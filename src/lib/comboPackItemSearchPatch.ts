export const comboPackItemSearchPatch = () => ({
  name: 'ora-combo-pack-item-search-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/ComboPacksPanel.tsx')) return null;
    if (code.includes('combo-item-options-${index}')) return null;

    const oldBlock = `                <label className="text-[10px] font-bold text-neutral-400">Exact Single Item Code
                  <select value={resolved.code} onChange={(event) => updateComponent(index, event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-white">
                    <option value="">Choose Item Code...</option>
                    {selectableItems.map((item) => <option key={\`${item.product_id}-${item.variant_id || 'base'}\`} value={item.code}>{item.code} — {item.name}{item.detail ? \` / ${item.detail}\` : ''}</option>)}
                  </select>
                </label>`;

    if (!code.includes(oldBlock)) return null;

    const newBlock = `                <label className="text-[10px] font-bold text-neutral-400">Exact Single Item Code
                  <input
                    key={\`${component.product_id}-${component.variant_id || 'base'}\`}
                    list={\`combo-item-options-${index}\`}
                    defaultValue={resolved.code ? \`${resolved.code} — ${resolved.product?.name_en || ''}${resolved.variant ? \` / ${variantOptionSummary(resolved.variant)}\` : ''}\` : ''}
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      const codePart = raw.includes(' — ') ? raw.split(' — ')[0] : raw;
                      const normalized = normalizeSku(codePart);
                      if (selectableItems.some((item) => item.code === normalized)) updateComponent(index, normalized);
                    }}
                    placeholder="Type item code or part of item name..."
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-white"
                  />
                  <datalist id={\`combo-item-options-${index}\`}>
                    {selectableItems.map((item) => (
                      <option key={\`${item.product_id}-${item.variant_id || 'base'}\`} value={\`${item.code} — ${item.name}${item.detail ? \` / ${item.detail}\` : ''}\`} />
                    ))}
                  </datalist>
                  <span className="mt-1 block text-[9px] font-normal text-neutral-500">Search by item code or any part of the item name.</span>
                </label>`;

    return { code: code.replace(oldBlock, newBlock), map: null };
  },
});
