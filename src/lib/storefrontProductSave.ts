export type Storefront = { products: any[]; categories: any[]; settings: Record<string, any> };

export const sameStorefrontValue = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if(Array.isArray(a)&&a.length!==b.length)return false;
  const keys = Object.keys(a).filter(key=>a[key]!==undefined);
  return keys.length === Object.keys(b).filter(key=>b[key]!==undefined).length && keys.every(key => Object.hasOwn(b, key) && sameStorefrontValue(a[key], b[key]));
};
const same = sameStorefrontValue;
const field = (value: Record<string, any>, key: string) => Object.hasOwn(value, key) ? { present: true, value: value[key] } : { present: false };

// A stock allocation changes a few products, not the invoice logos, settings,
// categories or every other product. Full saves remain available for structural
// catalog/settings edits and older clients.
export const storefrontSaveBody = (base: Storefront | null, next: Storefront, version: number) => {
  if (base && base.products.length === next.products.length &&
      next.products.every((product, index) => product?.id && product.id === base.products[index]?.id) &&
      new Set(next.products.map(product => String(product.id))).size === next.products.length) {
    const changed = next.products.map((product, index) => ({ product, before: base.products[index] }))
      .filter(({ product, before }) => !same(product, before));
    const products = {
      format: 'ora-storefront-products-v1',
      expected_version: version,
      product_updates: changed.map(({ product }) => product),
      product_expected: changed.map(({ before }) => before),
    };
    if (same(base.categories, next.categories) && same(base.settings, next.settings)) return products;
    // A text/colour/category edit must not resend unchanged embedded invoice
    // artwork. Keep field baselines so unrelated newer server edits can coexist.
    return { ...products, format: 'ora-storefront-patch-v1',
      ...(same(base.categories, next.categories) ? {} : { category_change: { before: base.categories, after: next.categories } }),
      setting_changes: [...new Set([...Object.keys(base.settings), ...Object.keys(next.settings)])]
        .filter(key => !same(field(base.settings, key), field(next.settings, key)))
        .map(key => ({ key, before: field(base.settings, key), after: field(next.settings, key) })),
    };
  }
  return { ...next, expected_version: version };
};

export const validProductSave = (body: any): boolean =>
  body?.format === 'ora-storefront-products-v1' &&
  Number.isSafeInteger(body.expected_version) && body.expected_version >= 0 &&
  Array.isArray(body.product_updates) && body.product_updates.length <= 5000 &&
  body.product_updates.every((product: any) => product && typeof product === 'object' &&
    !Array.isArray(product) && typeof product.id === 'string' && product.id.length > 0) &&
  new Set(body.product_updates.map((product: any) => product.id)).size === body.product_updates.length &&
  (body.product_expected === undefined || (Array.isArray(body.product_expected) &&
    body.product_expected.length === body.product_updates.length &&
    body.product_expected.every((product: any, index: number) => product && typeof product === 'object' &&
      !Array.isArray(product) && product.id === body.product_updates[index].id)));

export const validStorefrontPatch = (body: any): boolean => {
  const validField = (value: any) => value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.present === 'boolean' && (value.present ? Object.hasOwn(value, 'value') : !Object.hasOwn(value, 'value'));
  return body?.format === 'ora-storefront-patch-v1' && validProductSave({ ...body, format: 'ora-storefront-products-v1' }) &&
    Array.isArray(body.product_expected) && Array.isArray(body.setting_changes) && body.setting_changes.length <= 1000 &&
    body.setting_changes.every((change: any) => change && typeof change.key === 'string' && change.key.length > 0 &&
      change.key.length <= 500 && validField(change.before) && validField(change.after)) &&
    new Set(body.setting_changes.map((change: any) => change.key)).size === body.setting_changes.length &&
    (body.category_change === undefined || Array.isArray(body.category_change?.before) &&
      Array.isArray(body.category_change?.after) && body.category_change.after.length <= 1000);
};

// Used both by the Worker and by reload recovery. Every changed field must still
// match its baseline (or already equal the desired result after a lost response).
export const rebaseStorefrontEdit = (base: Storefront, next: Storefront, current: Storefront): Storefront | null => {
  const body = storefrontSaveBody(base, next, 0);
  if (!('format' in body)) return same(current, base) || same(current, next) ? next : null;
  const updates = new Map<string, { before: any; after: any }>(body.product_updates.map((product: any, index: number) => [product.id, { before: body.product_expected[index], after: product }]));
  if ([...updates.keys()].some(id => !current.products.some(product => product.id === id))) return null;
  if (current.products.some(product => { const change = updates.get(product.id); return change && !same(product, change.before) && !same(product, change.after); })) return null;
  const patch = body as any;
  if (patch.category_change && !same(current.categories, patch.category_change.before) && !same(current.categories, patch.category_change.after)) return null;
  const settings = { ...current.settings };
  for (const change of patch.setting_changes || []) {
    if (!same(field(settings, change.key), change.before) && !same(field(settings, change.key), change.after)) return null;
    if (change.after.present) Object.defineProperty(settings, change.key, { value: change.after.value, enumerable: true, configurable: true, writable: true });
    else delete settings[change.key];
  }
  return { products: current.products.map(product => updates.get(product.id)?.after || product),
    categories: patch.category_change?.after || current.categories, settings };
};
