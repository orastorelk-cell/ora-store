import type { Category, Product } from '../types';
import { normalizeProductForStorage, normalizedProductType } from './productVariants';

export const PRODUCT_BACKUP_TYPE = 'ora-store-product-backup' as const;
export const PRODUCT_BACKUP_VERSION = 1 as const;
export const PRODUCT_BACKUP_MAX_BYTES = 15_000_000;

export interface ProductBackupV1 {
  type: typeof PRODUCT_BACKUP_TYPE;
  version: typeof PRODUCT_BACKUP_VERSION;
  exported_at: string;
  products: Product[];
  categories: Category[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requiredText = (value: unknown, label: string, maxLength = 300) => {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is missing.`);
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  return text;
};

const optionalText = (value: unknown, maxLength: number) => {
  const text = String(value || '').trim();
  if (text.length > maxLength) throw new Error('Backup contains text that is too long.');
  return text;
};

const safeImageUrl = (value: unknown) => {
  const url = requiredText(value, 'Product image URL', 2_500);
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  throw new Error('Backup contains an unsupported product image URL.');
};

/**
 * Creates a portable catalog snapshot. Product images remain durable public URLs;
 * binary image data is deliberately excluded so backups stay small and reliable.
 */
export const createProductBackup = (products: Product[], categories: Category[]): ProductBackupV1 => ({
  type: PRODUCT_BACKUP_TYPE,
  version: PRODUCT_BACKUP_VERSION,
  exported_at: new Date().toISOString(),
  products,
  categories,
});

/**
 * Strictly validates an O-RA generated catalog backup before any state is changed.
 * The normalized return value is safe to persist as one atomic catalog snapshot.
 */
export const validateProductBackup = (input: unknown): ProductBackupV1 => {
  if (!isRecord(input) || input.type !== PRODUCT_BACKUP_TYPE || input.version !== PRODUCT_BACKUP_VERSION) {
    throw new Error('Select a valid O-RA Products Backup JSON file.');
  }
  if (!Array.isArray(input.products) || !Array.isArray(input.categories)) {
    throw new Error('Products or categories are missing from this backup.');
  }
  if (!input.products.length) throw new Error('This backup does not contain any products.');
  if (input.products.length > 5_000 || input.categories.length > 1_000) {
    throw new Error('This product backup is larger than the supported catalog limit.');
  }

  const categoryIds = new Set<string>();
  const categorySlugs = new Set<string>();
  const categories = input.categories.map((raw, index): Category => {
    if (!isRecord(raw)) throw new Error(`Category ${index + 1} is invalid.`);
    const id = requiredText(raw.id, `Category ${index + 1} ID`, 160);
    const slug = requiredText(raw.slug, `Category ${index + 1} slug`, 180).toLowerCase();
    if (categoryIds.has(id)) throw new Error(`Duplicate category ID: ${id}`);
    if (categorySlugs.has(slug)) throw new Error(`Duplicate category: ${slug}`);
    categoryIds.add(id);
    categorySlugs.add(slug);
    return {
      id,
      slug,
      name_en: requiredText(raw.name_en, `Category ${index + 1} name`, 200),
      name_si: optionalText(raw.name_si, 300),
      icon: optionalText(raw.icon, 100),
      code_prefix: optionalText(raw.code_prefix, 30) || undefined,
    };
  });

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  const itemCodes = new Set<string>();

  const products = input.products.map((raw, index): Product => {
    if (!isRecord(raw)) throw new Error(`Product ${index + 1} is invalid.`);
    const id = requiredText(raw.id, `Product ${index + 1} ID`, 180);
    const sku = requiredText(raw.sku, `Product ${index + 1} Item Code`, 100).toUpperCase();
    const name = requiredText(raw.name_en, `Product ${sku} name`, 300);
    const categoryId = requiredText(raw.category_id, `Product ${sku} category`, 180);
    const categorySlug = requiredText(raw.category_slug, `Product ${sku} category slug`, 180).toLowerCase();
    const category = categoryById.get(categoryId);
    // Combo Pack is an intentional virtual category created by the bundle
    // workspace, so it does not have a row in the editable Categories list.
    const isVirtualBundleCategory = categoryId === 'combo-pack'
      && categorySlug === 'combo-pack'
      && normalizedProductType(raw as unknown as Product) === 'bundle';
    if ((!category || category.slug !== categorySlug) && !isVirtualBundleCategory) {
      throw new Error(`Product ${sku} has a missing or mismatched category.`);
    }
    if (productIds.has(id)) throw new Error(`Duplicate product ID: ${id}`);
    if (itemCodes.has(sku)) throw new Error(`Duplicate Item Code: ${sku}`);
    productIds.add(id);
    itemCodes.add(sku);

    if (!Array.isArray(raw.images)) throw new Error(`Product ${sku} images are invalid.`);
    const images = raw.images.map(safeImageUrl);
    if (!Array.isArray(raw.variants || [])) throw new Error(`Product ${sku} variants are invalid.`);
    if (!Array.isArray(raw.bundle_components || [])) throw new Error(`Product ${sku} bundle components are invalid.`);
    if (!Array.isArray(raw.specifications || [])) throw new Error(`Product ${sku} specifications are invalid.`);
    if (!Array.isArray(raw.item_details || [])) throw new Error(`Product ${sku} item details are invalid.`);
    if ((raw.variants as unknown[]).some((value) => !isRecord(value))) throw new Error(`Product ${sku} contains an invalid variant.`);
    if ((raw.bundle_components as unknown[]).some((value) => !isRecord(value))) throw new Error(`Product ${sku} contains an invalid bundle component.`);
    if ((raw.specifications as unknown[]).some((value) => !isRecord(value))) throw new Error(`Product ${sku} contains an invalid specification.`);
    if ((raw.item_details as unknown[]).some((value) => !isRecord(value))) throw new Error(`Product ${sku} contains an invalid item detail.`);
    if ((raw.variants as unknown[] | undefined)?.length && (raw.variants as unknown[]).length > 500) {
      throw new Error(`Product ${sku} contains too many variants.`);
    }

    const normalized = normalizeProductForStorage({
      ...(raw as unknown as Product),
      id,
      sku,
      name_en: name,
      name_si: optionalText(raw.name_si, 500),
      description_en: optionalText(raw.description_en, 25_000),
      description_si: optionalText(raw.description_si, 25_000),
      category_id: categoryId,
      category_slug: categorySlug,
      images,
    });

    for (const variant of normalized.variants || []) {
      const variantId = requiredText(variant.id, `Variant ID in ${sku}`, 180);
      const variantSku = requiredText(variant.sku, `Variant Item Code in ${sku}`, 100).toUpperCase();
      if (variantIds.has(variantId)) throw new Error(`Duplicate variant ID: ${variantId}`);
      if (itemCodes.has(variantSku)) throw new Error(`Duplicate Item Code: ${variantSku}`);
      variantIds.add(variantId);
      itemCodes.add(variantSku);
      variant.id = variantId;
      variant.sku = variantSku;
      if (variant.image) variant.image = safeImageUrl(variant.image);
    }

    return normalized;
  });

  const productById = new Map(products.map((product) => [product.id, product]));
  for (const product of products) {
    if (normalizedProductType(product) !== 'bundle') continue;
    if (!(product.bundle_components || []).length) {
      throw new Error(`Bundle ${product.sku} does not contain any component products.`);
    }
    for (const component of product.bundle_components || []) {
      const child = productById.get(String(component.product_id || ''));
      if (!child || child.id === product.id) {
        throw new Error(`Bundle ${product.sku} has a missing component product.`);
      }
      if (component.variant_id && !(child.variants || []).some((variant) => variant.id === component.variant_id)) {
        throw new Error(`Bundle ${product.sku} has a missing component variant.`);
      }
      if (!Number.isFinite(Number(component.quantity)) || Number(component.quantity) < 1) {
        throw new Error(`Bundle ${product.sku} has an invalid component quantity.`);
      }
    }
  }

  return {
    type: PRODUCT_BACKUP_TYPE,
    version: PRODUCT_BACKUP_VERSION,
    exported_at: optionalText(input.exported_at, 100) || new Date().toISOString(),
    products,
    categories,
  };
};
