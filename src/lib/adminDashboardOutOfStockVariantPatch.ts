import type { Plugin } from 'vite';

/**
 * Makes the Admin Out of Stock page selection-aware without changing stock allocation.
 * Variant products are shown as separate rows by exact variant SKU/name. Combo/bundle
 * orders are expanded into their exact physical component Item Codes, so purchasing
 * never sees a CB-* pseudo-stock row.
 */
export const adminDashboardOutOfStockVariantPatch = (): Plugin => ({
  name: 'ora-admin-dashboard-out-of-stock-variant-patch',
  enforce: 'pre',
  transform(code, rawId) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let next = code;
    const startMarker = '  // ONLY zero-stock products that are currently blocking at least one Confirmed waiting order.\n  const outOfStockNeeds = (() => {';
    const endMarker = '\n  })();';
    const start = next.indexOf(startMarker);
    const end = next.indexOf(endMarker, start);
    if (start < 0 || end < 0) {
      throw new Error('[O-RA out-of-stock variant patch] calculation markers not found');
    }

    const replacement = `  // ONLY exact physical Item Codes currently blocking Confirmed waiting orders.\n  // Combo/bundle orders are expanded into their child Item Codes; CB-* itself is never treated as stock.\n  const outOfStockNeeds = (() => {\n    const activeUnallocatedOrders = orders.filter((o) =>\n      o.call_center_status === 'Confirmed' &&\n      o.order_status !== 'Cancelled' &&\n      !o.is_duplicate_order &&\n      !o.stock_allocated\n    );\n\n    type OutOfStockDemand = { neededQty: number; orderIds: Set<string> };\n    const demandBySelection = new Map<string, OutOfStockDemand>();\n    const productById = new Map(products.map((product) => [product.id, product] as [string, Product]));\n    const selectionKey = (productId: string, variantId?: string) => productId + '::' + (variantId || 'base');\n\n    const addDemand = (input: { product_id?: string; variant_id?: string; sku?: string; quantity?: number; allow_variant_base?: boolean }, orderId: string) => {\n      const product = productById.get(String(input.product_id || ''));\n      if (!product || normalizedProductType(product) === 'bundle') return;\n\n      let variantId = String(input.variant_id || '').trim() || undefined;\n      if (normalizedProductType(product) === 'variant') {\n        if (!variantId) {\n          const targetSku = String(input.sku || '').trim().toUpperCase();\n          const matched = (product.variants || []).find((variant) => String(variant.sku || '').trim().toUpperCase() === targetSku);\n          variantId = matched?.id;\n        }\n        if (!variantId && !input.allow_variant_base) return;\n      } else {\n        variantId = undefined;\n      }\n\n      const qty = Math.max(0, Number(input.quantity || 0));\n      if (!(qty > 0)) return;\n      const key = selectionKey(product.id, variantId);\n      const current = demandBySelection.get(key) || { neededQty: 0, orderIds: new Set<string>() };\n      current.neededQty += qty;\n      current.orderIds.add(orderId);\n      demandBySelection.set(key, current);\n    };\n\n    activeUnallocatedOrders.forEach((order) => {\n      (order.items || []).forEach((item) => {\n        const orderQty = Math.max(1, Number(item.quantity || 1));\n        const catalogProduct = productById.get(String(item.product_id || ''));\n        const isBundle = item.product_type === 'bundle' || normalizedProductType(catalogProduct) === 'bundle';\n\n        if (isBundle) {\n          const snapshotComponents = Array.isArray(item.bundle_components) ? item.bundle_components : [];\n          const catalogComponents = catalogProduct && normalizedProductType(catalogProduct) === 'bundle'\n            ? (catalogProduct.bundle_components || [])\n            : [];\n          const components: any[] = snapshotComponents.length ? snapshotComponents : catalogComponents;\n\n          components.forEach((component: any) => {\n            const child = productById.get(String(component.product_id || ''));\n            const childVariant = child && component.variant_id ? variantById(child, component.variant_id) : undefined;\n            const qtyPerBundle = Math.max(1, Number(component.quantity_per_bundle ?? component.quantity ?? 1));\n            addDemand({\n              product_id: component.product_id,\n              variant_id: component.variant_id,\n              sku: component.sku || childVariant?.sku || child?.sku,\n              quantity: orderQty * qtyPerBundle,\n              allow_variant_base: Boolean(child && normalizedProductType(child) === 'variant' && !component.variant_id),\n            }, order.id);\n          });\n          return;\n        }\n\n        addDemand({\n          product_id: item.product_id,\n          variant_id: item.variant_id,\n          sku: item.sku || item.main_sku,\n          quantity: orderQty,\n        }, order.id);\n      });\n    });\n\n    const rows: Array<{\n      product: Product;\n      variant?: ProductVariant;\n      itemCode: string;\n      itemLabel: string;\n      currentStock: number;\n      pendingOrders: number;\n      neededQty: number;\n    }> = [];\n\n    products.forEach((product) => {\n      const productType = normalizedProductType(product);\n      if (productType === 'bundle') return;\n\n      if (productType === 'variant' && (product.variants || []).length > 0) {\n        (product.variants || []).forEach((variant) => {\n          const demand = demandBySelection.get(selectionKey(product.id, variant.id));\n          if (!demand || demand.neededQty <= 0) return;\n          const currentStock = Math.max(0, Number(variant.stock_quantity || 0));\n          if (currentStock >= demand.neededQty) return;\n\n          const optionLabel = variantOptions(variant).map((row) => row.value).join(' / ') || String(variant.option_value || '').trim();\n          rows.push({\n            product,\n            variant,\n            itemCode: variant.sku || product.sku,\n            itemLabel: optionLabel ? product.name_en + ' — ' + optionLabel : product.name_en,\n            currentStock,\n            pendingOrders: demand.orderIds.size,\n            neededQty: demand.neededQty,\n          });\n        });\n\n        // If a combo uses a customer-selected child variant, keep the Out of Stock\n        // demand visible under the original component SKU (for example R0010)\n        // until the exact variant is available on the order snapshot.\n        const baseDemand = demandBySelection.get(selectionKey(product.id));\n        if (baseDemand && baseDemand.neededQty > 0) {\n          const currentStock = Math.max(0, Number(product.stock_quantity || 0));\n          if (currentStock < baseDemand.neededQty) {\n            rows.push({\n              product,\n              itemCode: product.sku,\n              itemLabel: product.name_en,\n              currentStock,\n              pendingOrders: baseDemand.orderIds.size,\n              neededQty: baseDemand.neededQty,\n            });\n          }\n        }\n        return;\n      }\n\n      const demand = demandBySelection.get(selectionKey(product.id));\n      if (!demand || demand.neededQty <= 0) return;\n      const currentStock = Math.max(0, Number(product.stock_quantity || 0));\n      if (currentStock >= demand.neededQty) return;\n\n      rows.push({\n        product,\n        itemCode: product.sku,\n        itemLabel: product.name_en,\n        currentStock,\n        pendingOrders: demand.orderIds.size,\n        neededQty: demand.neededQty,\n      });\n    });\n\n    return rows.sort((x,y) => y.pendingOrders - x.pendingOrders || y.neededQty - x.neededQty);`;

    next = next.slice(0, start) + replacement + next.slice(end);

    next = next.replaceAll(
      'outOfStockNeeds.map(({product,pendingOrders,neededQty}) => (',
      'outOfStockNeeds.map(({product,variant,itemCode,itemLabel,currentStock,pendingOrders,neededQty}) => ('
    );
    next = next.replaceAll('key={product.id}', 'key={`${product.id}:${variant?.id || itemCode}`}');
    next = next.replaceAll('>{product.sku}</div>', '>{itemCode}</div>');
    next = next.replaceAll('>{product.name_en}</div>', '>{itemLabel}</div>');
    next = next.replaceAll('>{product.sku}</td>', '>{itemCode}</td>');
    next = next.replaceAll('>{product.name_en}</td>', '>{itemLabel}</td>');
    next = next.replaceAll('>0</td>', '>{currentStock}</td>');

    // The page now reports physical component shortages, not synthetic Combo Pack stock.
    next = next.replaceAll(
      'Only stock-0 item codes that are actually blocking active pending / waiting orders are shown here.',
      'Only exact single-item codes that are actually blocking active pending / waiting orders are shown here. Combo Packs are split into their component Item Codes.'
    );

    return { code: next, map: null };
  },
});
