const replaceOnce = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA combo inherited variants] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Allows a combo component to reference a variant product at product level
 * (customer chooses the exact variant later), and binds the Sheet-selected
 * Variant / Color to that component when Call Center confirms the order.
 * Stock continues to come only from the underlying component variant.
 */
export const comboInheritedVariantStockPatch = () => ({
  name: 'ora-combo-inherited-variant-stock-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/components/admin/ComboPacksPanel.tsx')) {
      const oldRows = `if (normalizedProductType(product) === 'variant') {\n        for (const variant of activeVariants(product)) {\n          rows.push({ product_id: product.id, variant_id: variant.id, code: normalizeSku(variant.sku), name: product.name_en, detail: variantOptionSummary(variant) });\n        }\n      } else {`;
      const newRows = `if (normalizedProductType(product) === 'variant') {\n        const variants = activeVariants(product);\n        const inheritedSummary = variants.map((variant) => variantOptionSummary(variant)).filter(Boolean).join(' / ');\n        rows.push({ product_id: product.id, code: normalizeSku(product.sku), name: product.name_en, detail: inheritedSummary ? \`Customer Selects: \${inheritedSummary}\` : 'Customer Selects Variant' });\n        for (const variant of variants) {\n          rows.push({ product_id: product.id, variant_id: variant.id, code: normalizeSku(variant.sku), name: product.name_en, detail: variantOptionSummary(variant) });\n        }\n      } else {`;
      text = replaceOnce(text, oldRows, newRows, 'combo selectable inherited variant row');

      const oldGuard = `    if (components.some((component) => normalizedProductType(products.find((product) => product.id === component.product_id)) === 'variant' && !component.variant_id)) return alert('Select the exact variant Item Code for every variant product.');\n`;
      const newGuard = `    // A variant product may intentionally be saved without variant_id. In a Combo this means\n    // the customer/call-center selects the exact variant later; stock is then deducted from that exact variant.\n`;
      text = replaceOnce(text, oldGuard, newGuard, 'combo save inherited variant guard');

      const oldHelp = `<p className="text-[10px] text-neutral-500">Choose the exact Item Code and enter how many units of it go into one pack.</p>`;
      const newHelp = `<p className="text-[10px] text-neutral-500">Choose the main Item Code to let the customer select its variant, or choose one exact variant to lock it. Stock always comes from the selected component variant.</p>`;
      text = replaceOnce(text, oldHelp, newHelp, 'combo editor help');
    }

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const oldBuild = `        try{nextItems.push(buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products));}catch(e:any){errors.push(\`\${id}: \${e?.message||'Invalid item selection.'}\`);bad=true;}\n`;
      const newBuild = `        try{\n          const snapshot=buildOrderItemSnapshot(selection.product,qty,settings,selection.variant,products);\n          // Combo components can inherit a variant from the Call Center Sheet.\n          // Example: CB-R0010-R0044 + \"Twin Tub\" binds R0010/Twin Tub before stock allocation.\n          if(normalizedProductType(selection.product)==='bundle' && variantValue && snapshot.bundle_components?.length){\n            const wanted=String(variantValue).trim().toLowerCase();\n            let matched=false;\n            snapshot.bundle_components=snapshot.bundle_components.map((component:any)=>{\n              if(component.variant_id) return component; // explicitly locked combo component stays locked\n              const componentProduct=products.find((p:any)=>p.id===component.product_id);\n              if(!componentProduct || normalizedProductType(componentProduct)!=='variant') return component;\n              const componentVariant=activeVariants(componentProduct).find((v:any)=>{\n                const summary=String(variantOptionSummary(v)||'').trim().toLowerCase();\n                const name=String(v.name||v.variant_name||v.color||v.value||'').trim().toLowerCase();\n                const sku=String(v.sku||'').trim().toLowerCase();\n                return summary===wanted || name===wanted || sku===wanted || summary.split('/').map((x:string)=>x.trim()).includes(wanted);\n              });\n              if(!componentVariant) return component;\n              matched=true;\n              return {...component,variant_id:componentVariant.id,variant_name:variantOptionSummary(componentVariant),sku:componentVariant.sku||component.sku};\n            });\n            if(!matched) throw new Error(\`Variant \"\${variantValue}\" was not found inside combo \${selection.product.sku}.\`);\n            snapshot.variant_name=variantValue;\n          }\n          nextItems.push(snapshot);\n        }catch(e:any){errors.push(\`\${id}: \${e?.message||'Invalid item selection.'}\`);bad=true;}\n`;
      text = replaceOnce(text, oldBuild, newBuild, 'confirmed combo variant binding');
    }

    return text === code ? null : { code: text, map: null };
  },
});
