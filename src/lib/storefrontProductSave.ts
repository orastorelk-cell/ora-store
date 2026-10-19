export type Storefront = { products: any[]; categories: any[]; settings: Record<string, any> };

export const sameStorefrontValue = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if(Array.isArray(a)&&a.length!==b.length)return false;
  const keys = Object.keys(a).filter(key=>a[key]!==undefined);
  return keys.length === Object.keys(b).filter(key=>b[key]!==undefined).length && keys.every(key => Object.hasOwn(b, key) && sameStorefrontValue(a[key], b[key]));
};
const same = sameStorefrontValue;
const field = (value: Record<string, any>, key: string) => Object.hasOwn(value, key) && value[key] !== undefined ? { present: true, value: value[key] } : { present: false };
const settingChanges = (base: Storefront, next: Storefront) => [...new Set([...Object.keys(base.settings), ...Object.keys(next.settings)])]
  .filter(key => !same(field(base.settings, key), field(next.settings, key)))
  .map(key => ({ key, before: field(base.settings, key), after: field(next.settings, key) }));
const categoryChange = (base: Storefront, next: Storefront) => same(base.categories, next.categories) ? {} : { category_change: { before: base.categories, after: next.categories } };
const validField = (value: any) => value && typeof value === 'object' && !Array.isArray(value) &&
  typeof value.present === 'boolean' && (value.present ? Object.hasOwn(value, 'value') : !Object.hasOwn(value, 'value'));

// A stock allocation changes a few products, not the invoice logos, settings,
// categories or every other product. Product creation also sends only changed
// records and ID order; older clients can still send a full catalog.
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
      ...categoryChange(base, next), setting_changes: settingChanges(base, next),
    };
  }
  if (base) {
    const before = new Map(base.products.map(product => [product.id, product])), after = new Map(next.products.map(product => [product.id, product]));
    return { format: 'ora-storefront-catalog-v1', expected_version: version,
      product_changes: [...new Set([...before.keys(), ...after.keys()])].filter(id => !same(before.get(id), after.get(id))).map(id => ({id,
        before: before.has(id) ? {present:true,value:before.get(id)} : {present:false},
        after: after.has(id) ? {present:true,value:after.get(id)} : {present:false}})),
      product_order: {before: base.products.map(product => product.id), after: next.products.map(product => product.id)},
      ...categoryChange(base, next), setting_changes: settingChanges(base, next),
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
  return body?.format === 'ora-storefront-patch-v1' && validProductSave({ ...body, format: 'ora-storefront-products-v1' }) &&
    Array.isArray(body.product_expected) && Array.isArray(body.setting_changes) && body.setting_changes.length <= 1000 &&
    body.setting_changes.every((change: any) => change && typeof change.key === 'string' && change.key.length > 0 &&
      change.key.length <= 500 && validField(change.before) && validField(change.after)) &&
    new Set(body.setting_changes.map((change: any) => change.key)).size === body.setting_changes.length &&
    (body.category_change === undefined || Array.isArray(body.category_change?.before) &&
      Array.isArray(body.category_change?.after) && body.category_change.after.length <= 1000);
};

export const validCatalogSave = (body: any): boolean => {
  const validOrder = (ids: any) => Array.isArray(ids) && ids.length <= 5000 &&
    ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200) && new Set(ids).size === ids.length;
  if (body?.format !== 'ora-storefront-catalog-v1' ||
      !validStorefrontPatch({...body,format:'ora-storefront-patch-v1',product_updates:[],product_expected:[]}) ||
      !validOrder(body.product_order?.before) || !validOrder(body.product_order?.after) ||
      !Array.isArray(body.product_changes) || body.product_changes.length > 5000) return false;
  const before = new Set(body.product_order.before), after = new Set(body.product_order.after);
  const changes = new Map<string, any>();
  for (const change of body.product_changes) {
    if (!change || typeof change.id !== 'string' || changes.has(change.id) ||
        !validField(change.before) || !validField(change.after) || !change.before.present && !change.after.present ||
        change.before.present !== before.has(change.id) || change.after.present !== after.has(change.id)) return false;
    for (const value of [change.before, change.after]) if (value.present &&
      (!value.value || typeof value.value !== 'object' || Array.isArray(value.value) || value.value.id !== change.id ||
        value.value.variants !== undefined && (!Array.isArray(value.value.variants) || value.value.variants.some((variant:any)=>!variant||typeof variant!=='object')) ||
        value.value.bundle_components !== undefined && (!Array.isArray(value.value.bundle_components) || value.value.bundle_components.some((component:any)=>!component||typeof component!=='object')))) return false;
    changes.set(change.id, change);
  }
  return [...before].every(id => after.has(id) || changes.has(String(id))) &&
    [...after].every(id => before.has(id) || changes.has(String(id)));
};

// Check only changed records. Unrelated stock changes and another staff user's
// new product survive an add, delete or reorder and every lost-response replay.
export const rebaseCatalogProducts = (current: any[], body: any): any[] | null => {
  const existing = new Map<string, any>(current.map(product => [product.id, product]));
  if (existing.size !== current.length) return null;
  for (const change of body.product_changes) {
    const value = existing.has(change.id) ? {present:true,value:existing.get(change.id)} : {present:false};
    if (!same(value, change.before) && !same(value, change.after)) return null;
  }
  const {before, after} = body.product_order, known = new Set([...before, ...after]);
  const projection = current.map(product => product.id).filter(id => known.has(id));
  if (!same(projection, before) && !same(projection, after)) return null;
  for (const change of body.product_changes) {
    if (change.after.present) existing.set(change.id, change.after.value);
    else existing.delete(change.id);
  }
  if (existing.size > 5000) return null;
  const codes = (product: any): string[] => [product.sku, ...(Array.isArray(product.variants) ? product.variants : []).map((variant: any) => variant?.sku)]
    .map(code => String(code || '').trim().toUpperCase()).filter(Boolean);
  const owners = new Map<string, Set<string>>();
  for (const [id, product] of existing) for (const code of codes(product)) {
    const ids = owners.get(code) || new Set<string>(); ids.add(id); owners.set(code, ids);
  }
  for (const change of body.product_changes) if (change.after.present &&
      (!change.before.present || !same(codes(change.before.value), codes(change.after.value)))) {
    const ownCodes = codes(change.after.value);
    if (new Set(ownCodes).size !== ownCodes.length || ownCodes.some(code => owners.get(code)!.size > 1)) return null;
  }
  const deleted = new Set(body.product_changes.filter((change: any) => !change.after.present).map((change: any) => change.id));
  if ([...existing.values()].some(product => (Array.isArray(product.bundle_components) ? product.bundle_components : []).some((component: any) => deleted.has(component?.product_id)))) return null;
  // Keep concurrent new products next to their original following product.
  const afterSet = new Set(after), extras = new Map<string, string[]>();
  let pending: string[] = [];
  for (const product of current) {
    if (afterSet.has(product.id)) { extras.set(product.id, pending); pending = []; }
    else if (!known.has(product.id)) pending.push(product.id);
  }
  const ids = after.flatMap((id: string) => [...(extras.get(id) || []), id]).concat(pending);
  if (ids.length !== existing.size || ids.some((id: string) => !existing.has(id))) return null;
  return ids.map((id: string) => existing.get(id));
};

// Used both by the Worker and by reload recovery. Every changed field must still
// match its baseline (or already equal the desired result after a lost response).
export const rebaseStorefrontEdit = (base: Storefront, next: Storefront, current: Storefront): Storefront | null => {
  const body: any = storefrontSaveBody(base, next, 0);
  if (!('format' in body)) return same(current, base) || same(current, next) ? next : null;
  let products: any[];
  if (body.format === 'ora-storefront-catalog-v1') {
    if (!validCatalogSave(body)) return null;
    const merged = rebaseCatalogProducts(current.products, body); if (!merged) return null; products = merged;
  } else {
    const updates = new Map<string, { before: any; after: any }>(body.product_updates.map((product: any, index: number) => [product.id, { before: body.product_expected[index], after: product }]));
    if ([...updates.keys()].some(id => !current.products.some(product => product.id === id))) return null;
    if (current.products.some(product => { const change = updates.get(product.id); return change && !same(product, change.before) && !same(product, change.after); })) return null;
    products = current.products.map(product => updates.get(product.id)?.after || product);
  }
  const patch = body as any;
  if (patch.category_change && !same(current.categories, patch.category_change.before) && !same(current.categories, patch.category_change.after)) return null;
  const settings = { ...current.settings };
  for (const change of patch.setting_changes || []) {
    if (!same(field(settings, change.key), change.before) && !same(field(settings, change.key), change.after)) return null;
    if (change.after.present) Object.defineProperty(settings, change.key, { value: change.after.value, enumerable: true, configurable: true, writable: true });
    else delete settings[change.key];
  }
  return { products,
    categories: patch.category_change?.after || current.categories, settings };
};
