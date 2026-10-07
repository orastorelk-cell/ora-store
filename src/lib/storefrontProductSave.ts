type Storefront = { products: any[]; categories: any[]; settings: Record<string, any> };

const same = (a: any, b: any) => a === b || JSON.stringify(a) === JSON.stringify(b);

// A stock allocation changes a few products, not the invoice logos, settings,
// categories or every other product. Full saves remain available for structural
// catalog/settings edits and older clients.
export const storefrontSaveBody = (base: Storefront | null, next: Storefront, version: number) => {
  if (base && same(base.categories, next.categories) && same(base.settings, next.settings) &&
      base.products.length === next.products.length &&
      next.products.every((product, index) => product?.id && product.id === base.products[index]?.id) &&
      new Set(next.products.map(product => String(product.id))).size === next.products.length) {
    const changed = next.products.map((product, index) => ({ product, before: base.products[index] }))
      .filter(({ product, before }) => !same(product, before));
    return {
      format: 'ora-storefront-products-v1',
      expected_version: version,
      product_updates: changed.map(({ product }) => product),
      product_expected: changed.map(({ before }) => before),
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
