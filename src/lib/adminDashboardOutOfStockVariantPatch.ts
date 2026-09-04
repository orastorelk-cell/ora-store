import type { Plugin } from 'vite';

/**
 * Makes the Admin Out of Stock page variant-aware without changing stock allocation.
 * Variant products are shown as separate rows by exact variant SKU/name; normal
 * products keep their existing single-row behaviour.
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

    const replacement = `  // ONLY zero-stock product selections that are currently blocking at least one Confirmed waiting order.\n  // Variant products are split by exact variant so purchasing can see the required colour/size/design.\n  const outOfStockNeeds = (() => {\n    const activeUnallocatedOrders = orders.filter((o) =>\n      o.call_center_status === 'Confirmed' &&\n      o.order_status !== 'Cancelled' &&\n      !o.is_duplicate_order &&\n      !o.stock_allocated\n    );\n\n    const rows: Array<{\n      product: Product;\n      variant?: ProductVariant;\n      itemCode: string;\n      itemLabel: string;\n      currentStock: number;\n      pendingOrders: number;\n      neededQty: number;\n    }> = [];\n\n    products.forEach((product) => {\n      const productType = normalizedProductType(product);\n\n      if (productType === 'variant' && (product.variants || []).length > 0) {\n        (product.variants || []).forEach((variant) => {\n          const currentStock = Math.max(0, Number(variant.stock_quantity || 0));\n          if (currentStock > 0) return;\n\n          const affected = activeUnallocatedOrders.filter((order) =>\n            (order.items || []).some((item) => {\n              if (item.product_id !== product.id) return false;\n              if (item.variant_id && variant.id) return item.variant_id === variant.id;\n              return String(item.sku || '').trim().toUpperCase() === String(variant.sku || '').trim().toUpperCase();\n            })\n          );\n\n          const neededQty = affected.reduce((sum, order) =>\n            sum + (order.items || [])\n              .filter((item) => {\n                if (item.product_id !== product.id) return false;\n                if (item.variant_id && variant.id) return item.variant_id === variant.id;\n                return String(item.sku || '').trim().toUpperCase() === String(variant.sku || '').trim().toUpperCase();\n              })\n              .reduce((s, item) => s + Number(item.quantity || 0), 0)\n          , 0);\n\n          if (affected.length > 0) {\n            const optionLabel = variantOptions(variant).map((row) => row.value).join(' / ') || String(variant.option_value || '').trim();\n            rows.push({\n              product,\n              variant,\n              itemCode: variant.sku || product.sku,\n              itemLabel: optionLabel ? \\`\\${product.name_en} — \\${optionLabel}\\` : product.name_en,\n              currentStock,\n              pendingOrders: affected.length,\n              neededQty,\n            });\n          }\n        });\n        return;\n      }\n\n      const currentStock = Math.max(0, Number(product.stock_quantity || 0));\n      if (currentStock > 0) return;\n\n      const affected = activeUnallocatedOrders.filter((order) =>\n        (order.items || []).some((item) =>\n          item.product_id === product.id || String(item.sku || '').toUpperCase() === String(product.sku || '').toUpperCase()\n        )\n      );\n\n      const neededQty = affected.reduce((sum, order) =>\n        sum + (order.items || [])\n          .filter((item) =>\n            item.product_id === product.id || String(item.sku || '').toUpperCase() === String(product.sku || '').toUpperCase()\n          )\n          .reduce((s, item) => s + Number(item.quantity || 0), 0)\n      , 0);\n\n      if (affected.length > 0) {\n        rows.push({\n          product,\n          itemCode: product.sku,\n          itemLabel: product.name_en,\n          currentStock,\n          pendingOrders: affected.length,\n          neededQty,\n        });\n      }\n    });\n\n    return rows.sort((x,y) => y.pendingOrders - x.pendingOrders || y.neededQty - x.neededQty);`;

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

    return { code: next, map: null };
  },
});
