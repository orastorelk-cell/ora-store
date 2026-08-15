import { BundleComponent, Order, Product, ProductVariant, StoreSettings } from '../types';


export const oraProfitForBuyingPrice = (value: number) => {
  const cost = Math.max(0, Number(value || 0));
  // O-RA approved INITIAL pricing table. The two low-cost bands below were
  // added in Update 103; all Rs.500+ rules remain exactly as before.
  if (cost <= 0) return 0;
  if (cost < 250) return 200;
  if (cost < 500) return 350;
  if (cost === 500) return 500;
  if (cost < 1000) return 700;
  if (cost < 2000) return 900;
  if (cost < 3000) return 1100;
  if (cost < 5000) return 1500;
  if (cost < 7500) return 1800;
  if (cost < 10000) return 2200;
  if (cost < 15000) return 3000;
  if (cost < 20000) return 4000;
  return Math.round(cost * 0.25);
};

export const oraSuggestedBaseSellingPrice = (buyingPrice: number) =>
  Math.max(0, Number(buyingPrice || 0)) + oraProfitForBuyingPrice(buyingPrice);

export type SupplierPriceChangeKind = 'offer' | 'increase' | 'same';

/**
 * Supplier-price changes are deliberately separate from the initial profit table.
 * The initial product keeps its original buying cost + original selling price.
 * - Cheaper source: the exact saving per unit becomes the customer Special Offer.
 * - Dearer source: the exact extra cost is added to the normal selling price so
 *   the original target profit is preserved.
 */
export const supplierPricePreview = (
  current: { buying_price: number; selling_price: number },
  newSupplierCost: number,
) => {
  const normalCost = Math.max(0, Number(current.buying_price || 0));
  const normalSelling = Math.max(0, Number(current.selling_price || 0));
  const newCost = Math.max(0, Number(newSupplierCost || 0));
  const delta = Math.round((newCost - normalCost) * 100) / 100;
  if (delta < 0) {
    const savingPerUnit = Math.abs(delta);
    return {
      kind: 'offer' as SupplierPriceChangeKind,
      normalCost,
      newCost,
      savingPerUnit,
      increasePerUnit: 0,
      normalSelling,
      nextSelling: normalSelling,
      offerSelling: Math.max(0, normalSelling - savingPerUnit),
    };
  }
  if (delta > 0) {
    return {
      kind: 'increase' as SupplierPriceChangeKind,
      normalCost,
      newCost,
      savingPerUnit: 0,
      increasePerUnit: delta,
      normalSelling,
      nextSelling: normalSelling + delta,
      offerSelling: normalSelling + delta,
    };
  }
  return {
    kind: 'same' as SupplierPriceChangeKind,
    normalCost,
    newCost,
    savingPerUnit: 0,
    increasePerUnit: 0,
    normalSelling,
    nextSelling: normalSelling,
    offerSelling: normalSelling,
  };
};

/** Backward-compatible helper. New supplier pricing is now saved explicitly from
 * the Supplier Price / Offer workspace instead of changing automatically on a PO. */
export const repriceAfterBuyingCostChange = (
  current: {
    buying_price: number;
    selling_price: number;
    discount_price?: number;
    discount_enabled?: boolean;
    auto_price_enabled?: boolean;
    auto_discount_on_cost_drop?: boolean;
  },
  newBuyingPrice: number,
) => {
  const preview = supplierPricePreview(current, newBuyingPrice);
  if (preview.kind === 'offer') {
    return {
      buying_price: preview.normalCost,
      selling_price: preview.normalSelling,
      discount_price: preview.offerSelling,
      discount_enabled: true,
      changed: true,
    };
  }
  if (preview.kind === 'increase') {
    return {
      buying_price: preview.newCost,
      selling_price: preview.nextSelling,
      discount_price: preview.nextSelling,
      discount_enabled: false,
      changed: true,
    };
  }
  return {
    buying_price: preview.normalCost,
    selling_price: preview.normalSelling,
    discount_price: Number(current.discount_price || preview.normalSelling),
    discount_enabled: Boolean(current.discount_enabled),
    changed: false,
  };
};

export const normalizedProductType = (product?: Product | null) => product?.product_type || ((product?.variants?.length || 0) > 0 ? 'variant' : (product?.bundle_components?.length || 0) > 0 ? 'bundle' : 'normal');

export const normalizeSku = (value: unknown) => String(value || '').trim().toUpperCase();

export const slugCode = (value: unknown) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 12) || 'OPT';

export const buildVariantSku = (mainSku: string, optionValue: string, usedSkus: string[] = []) => {
  const baseMain = normalizeSku(mainSku) || 'ITEM';
  const suffixBase = slugCode(optionValue);
  const used = new Set(usedSkus.map(normalizeSku));
  let candidate = `${baseMain}-${suffixBase}`;
  let i = 2;
  while (used.has(candidate)) candidate = `${baseMain}-${suffixBase}-${i++}`;
  return candidate;
};

export const variantOptions = (variant?: ProductVariant | null) => {
  if (!variant) return [] as { name: string; value: string }[];
  const multi = (variant.options || [])
    .map((option) => ({ name: String(option?.name || '').trim(), value: String(option?.value || '').trim() }))
    .filter((option) => option.name && option.value);
  if (multi.length) return multi;
  const legacyName = String(variant.option_name || 'Option').trim() || 'Option';
  const legacyValue = String(variant.option_value || '').trim();
  return legacyValue ? [{ name: legacyName, value: legacyValue }] : [];
};

export const variantOptionValueLabel = (variant?: ProductVariant | null) =>
  variantOptions(variant).map((option) => option.value).join(' / ') || String(variant?.option_value || '').trim();

export const variantOptionSummary = (variant?: ProductVariant | null) =>
  variantOptions(variant).map((option) => `${option.name}: ${option.value}`).join(' • ') || String(variant?.option_value || '').trim();

export const variantMatchesOptions = (variant: ProductVariant, selections: Record<string, string>) => {
  const map = new Map(variantOptions(variant).map((option) => [option.name.toLowerCase(), option.value.toLowerCase()]));
  return Object.entries(selections).every(([name, value]) => !value || map.get(name.toLowerCase()) === String(value).toLowerCase());
};

export const activeVariants = (product: Product): ProductVariant[] =>
  (product.variants || []).filter(v => v.status !== 'Draft');

export const effectiveVariantPrice = (variant: ProductVariant) =>
  variant.discount_enabled !== false && Number(variant.discount_price || 0) > 0 && Number(variant.discount_price) < Number(variant.selling_price || 0)
    ? Number(variant.discount_price)
    : Number(variant.selling_price || 0);

export const effectiveProductBasePrice = (product: Product) =>
  product.discount_enabled !== false && Number(product.discount_price || 0) > 0 && Number(product.discount_price) < Number(product.selling_price || 0)
    ? Number(product.discount_price)
    : Number(product.selling_price || 0);

export const displayUnitPrice = (product: Product, settings?: StoreSettings, variant?: ProductVariant) => {
  const base = variant ? effectiveVariantPrice(variant) : effectiveProductBasePrice(product);
  const includedDelivery = settings?.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0;
  return base + includedDelivery;
};

export const regularDisplayUnitPrice = (product: Product, settings?: StoreSettings, variant?: ProductVariant) => {
  const base = variant ? Math.max(0, Number(variant.selling_price || 0)) : Math.max(0, Number(product.selling_price || 0));
  const includedDelivery = settings?.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0;
  return base + includedDelivery;
};

export const effectiveBuyingPrice = (product: Product, variant?: ProductVariant) => {
  const target = variant || product;
  const normalCost = Math.max(0, Number(target.buying_price || 0));
  const offerCost = Math.max(0, Number(target.offer_buying_price || 0));
  const offerActive = target.supplier_offer_enabled === true
    && target.discount_enabled !== false
    && offerCost > 0
    && offerCost < normalCost;
  return offerActive ? offerCost : normalCost;
};

export const selectionDiscountPercent = (product: Product, variant?: ProductVariant, settings?: StoreSettings) => {
  const delivery = settings?.free_delivery_enabled ? Math.max(0, Number(settings.delivery_fee || 0)) : 0;
  const regularBase = variant ? Math.max(0, Number(variant.selling_price || 0)) : Math.max(0, Number(product.selling_price || 0));
  const discountedBase = variant
    ? (variant.discount_enabled !== false ? Math.max(0, Number(variant.discount_price || 0)) : 0)
    : (product.discount_enabled !== false ? Math.max(0, Number(product.discount_price || 0)) : 0);
  const regular = regularBase + delivery;
  const discounted = discountedBase + delivery;
  return regular > 0 && discountedBase > 0 && discountedBase < regularBase
    ? Math.max(1, Math.round(((regular - discounted) / regular) * 100))
    : 0;
};

export const productPriceRange = (product: Product, settings?: StoreSettings) => {
  const type = normalizedProductType(product);
  if (type !== 'variant' || !(product.variants || []).length) {
    const p = displayUnitPrice(product, settings);
    return { min: p, max: p };
  }
  const prices = activeVariants(product).map(v => displayUnitPrice(product, settings, v));
  if (!prices.length) {
    const p = displayUnitPrice(product, settings);
    return { min: p, max: p };
  }
  return { min: Math.min(...prices), max: Math.max(...prices) };
};

export const variantById = (product: Product, variantId?: string) =>
  (product.variants || []).find(v => v.id === variantId);

export const variantBySku = (product: Product, sku?: string) => {
  const target = normalizeSku(sku);
  return (product.variants || []).find(v => normalizeSku(v.sku) === target);
};

export const variantByOption = (product: Product, option?: string) => {
  const target = String(option || '').trim().toLowerCase();
  if (!target) return undefined;
  return (product.variants || []).find((v) => {
    const legacy = String(v.option_value || '').trim().toLowerCase();
    const values = variantOptions(v).map((row) => row.value.toLowerCase());
    const summary = variantOptionSummary(v).toLowerCase();
    return legacy === target || summary === target || values.includes(target);
  }) || (product.variants || []).find((v) => {
    const legacy = String(v.option_value || '').trim().toLowerCase();
    const summary = variantOptionSummary(v).toLowerCase();
    return Boolean(legacy && (legacy.includes(target) || target.includes(legacy))) || Boolean(summary && (summary.includes(target) || target.includes(summary)));
  });
};

export const findProductSelection = (
  products: Product[],
  code: string,
  variantValue?: string,
): { product: Product; variant?: ProductVariant } | null => {
  const clean = normalizeSku(code);
  if (!clean) return null;

  for (const product of products) {
    const variant = variantBySku(product, clean);
    if (variant) return { product, variant };
  }

  const product = products.find(p => normalizeSku(p.sku) === clean);
  if (!product) return null;
  if (normalizedProductType(product) === 'variant') {
    const variant = variantByOption(product, variantValue) || variantBySku(product, variantValue);
    return { product, variant };
  }
  return { product };
};

export const productDisplayStock = (product: Product, allProducts: Product[] = []) => {
  const type = normalizedProductType(product);
  if (type === 'variant') {
    return (product.variants || []).reduce((sum, v) => sum + Math.max(0, Number(v.stock_quantity || 0)), 0);
  }
  if (type === 'bundle') {
    const components = product.bundle_components || [];
    if (!components.length) return 0;
    const possible = components.map(comp => {
      const child = allProducts.find(p => p.id === comp.product_id);
      if (!child) return 0;
      const qtyPer = Math.max(1, Number(comp.quantity || 1));
      if (comp.variant_id) {
        const variant = variantById(child, comp.variant_id);
        return Math.floor(Math.max(0, Number(variant?.stock_quantity || 0)) / qtyPer);
      }
      if (normalizedProductType(child) === 'variant') return 0;
      return Math.floor(Math.max(0, Number(child.stock_quantity || 0)) / qtyPer);
    });
    return possible.length ? Math.min(...possible) : 0;
  }
  return Math.max(0, Number(product.stock_quantity || 0));
};

export const normalizeProductForStorage = (product: Product): Product => {
  const type = normalizedProductType(product);
  const variants = (product.variants || []).map((v, idx) => {
    const cleanedOptions = (v.options || [])
      .map((option) => ({ name: String(option?.name || '').trim(), value: String(option?.value || '').trim() }))
      .filter((option) => option.name && option.value);
    const legacyValue = cleanedOptions.length
      ? cleanedOptions.map((option) => option.value).join(' / ')
      : String(v.option_value || `Option ${idx + 1}`).trim();
    return {
      ...v,
      id: v.id || `${product.id || 'prod'}-var-${idx + 1}`,
      sku: normalizeSku(v.sku),
      option_name: cleanedOptions[0]?.name || String(v.option_name || 'Option').trim() || 'Option',
      option_value: legacyValue,
      options: cleanedOptions.length ? cleanedOptions : undefined,
      buying_price: Math.max(0, Number(v.buying_price || 0)),
      selling_price: Math.max(0, Number(v.selling_price || 0)),
      stock_quantity: Math.max(0, Number(v.stock_quantity || 0)),
      status: v.status || (Number(v.stock_quantity || 0) > 0 ? 'Active' : 'Out of Stock'),
    };
  });
  const stock = type === 'variant'
    ? variants.reduce((sum, v) => sum + v.stock_quantity, 0)
    : Math.max(0, Number(product.stock_quantity || 0));
  const specifications = (product.specifications || [])
    .map((spec, idx) => ({
      id: spec.id || `${product.id || 'prod'}-spec-${idx + 1}`,
      label: String(spec.label || '').trim(),
      value: String(spec.value || '').trim(),
      unit: String(spec.unit || '').trim() || undefined,
    }))
    .filter((spec) => spec.label && spec.value);
  const item_details = (product.item_details || [])
    .map((detail, idx) => ({
      id: detail.id || `${product.id || 'prod'}-item-detail-${idx + 1}`,
      label_en: String(detail.label_en || '').trim(),
      label_si: String(detail.label_si || '').trim() || undefined,
      value_en: String(detail.value_en || '').trim(),
      value_si: String(detail.value_si || '').trim() || undefined,
    }))
    .filter((detail) => detail.label_en && detail.value_en);
  return {
    ...product,
    sku: normalizeSku(product.sku),
    product_type: type,
    variants,
    bundle_components: product.bundle_components || [],
    specifications,
    item_details,
    stock_quantity: stock,
    status: type === 'bundle' ? product.status : (stock <= 0 && product.status === 'Active' ? 'Out of Stock' : product.status),
  };
};

export const buildOrderItemSnapshot = (
  product: Product,
  quantity: number,
  settings: StoreSettings,
  variant?: ProductVariant,
  allProducts: Product[] = [],
): Order['items'][number] => {
  const type = normalizedProductType(product);
  const qty = Math.max(1, Number(quantity || 1));
  if (type === 'variant' && !variant) throw new Error(`Please select a color / option for ${product.name_en}.`);
  const unitPrice = displayUnitPrice(product, settings, variant);
  const regularUnitPrice = regularDisplayUnitPrice(product, settings, variant);
  const actualBuyingPrice = effectiveBuyingPrice(product, variant);
  const supplierOfferDiscountPerUnit = Math.max(0, regularUnitPrice - unitPrice);
  const image = variant?.image || product.images?.[0];
  const specificationSummary = (product.specifications || [])
    .filter((spec) => String(spec.label || '').trim() && String(spec.value || '').trim())
    .slice(0, 6)
    .map((spec) => `${String(spec.label).trim()}: ${String(spec.value).trim()}${spec.unit ? ` ${String(spec.unit).trim()}` : ''}`)
    .join(' • ');
  const bundleComponents = type === 'bundle'
    ? (product.bundle_components || []).map(comp => {
        const child = allProducts.find(p => p.id === comp.product_id);
        const childVariant = child ? variantById(child, comp.variant_id) : undefined;
        return {
          product_id: comp.product_id,
          variant_id: comp.variant_id,
          sku: childVariant?.sku || child?.sku || '',
          product_name: child?.name_en || 'Missing component',
          variant_name: childVariant?.option_value,
          quantity_per_bundle: Math.max(1, Number(comp.quantity || 1)),
        };
      })
    : undefined;
  return {
    product_id: product.id,
    product_name: product.name_en,
    sku: variant?.sku || product.sku,
    main_sku: product.sku,
    variant_id: variant?.id,
    variant_name: variant?.option_value,
    product_type: type,
    bundle_components: bundleComponents,
    buying_price: actualBuyingPrice,
    effective_buying_price: actualBuyingPrice,
    regular_unit_price: regularUnitPrice,
    supplier_offer_discount_per_unit: supplierOfferDiscountPerUnit,
    unit_price: unitPrice,
    quantity: qty,
    subtotal: unitPrice * qty,
    image,
    specification_summary: specificationSummary || undefined,
  };
};

export const buildCatalogRows = (products: Product[], settings?: StoreSettings) => {
  const rows: Array<{
    main_sku: string;
    variant_sku: string;
    name: string;
    variant_name: string;
    type: string;
    unit_price: number;
    stock_quantity: number;
    image: string;
    active: boolean;
  }> = [];
  for (const product of products) {
    const type = normalizedProductType(product);
    if (type === 'variant' && (product.variants || []).length) {
      for (const variant of product.variants || []) {
        rows.push({
          main_sku: normalizeSku(product.sku),
          variant_sku: normalizeSku(variant.sku),
          name: product.name_en,
          variant_name: variant.option_value,
          type: 'Variant',
          unit_price: displayUnitPrice(product, settings, variant),
          stock_quantity: Math.max(0, Number(variant.stock_quantity || 0)),
          image: variant.image || product.images?.[0] || '',
          active: product.status !== 'Draft' && variant.status !== 'Draft',
        });
      }
      continue;
    }
    rows.push({
      main_sku: normalizeSku(product.sku),
      variant_sku: normalizeSku(product.sku),
      name: product.name_en,
      variant_name: '',
      type: type === 'bundle' ? 'Combo Pack' : 'Normal',
      unit_price: displayUnitPrice(product, settings),
      stock_quantity: productDisplayStock(product, products),
      image: product.images?.[0] || '',
      active: product.status !== 'Draft',
    });
  }
  return rows;
};

export const bundleComponentLabel = (component: BundleComponent, products: Product[]) => {
  const product = products.find(p => p.id === component.product_id);
  if (!product) return 'Missing product';
  const variant = variantById(product, component.variant_id);
  return `${product.name_en}${variant ? ` - ${variant.option_value}` : ''} × ${Math.max(1, Number(component.quantity || 1))}`;
};
