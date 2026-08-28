import { Category, Product } from '../types';

const normalize = (value: string = '') =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const editDistance = (a: string, b: string) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
};

const fuzzyTokenMatch = (queryToken: string, candidateToken: string) => {
  if (!queryToken || !candidateToken) return false;
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true;
  if (queryToken.length < 4 || candidateToken.length < 4) return false;
  const maxDistance = Math.max(queryToken.length, candidateToken.length) >= 7 ? 2 : 1;
  return editDistance(queryToken, candidateToken) <= maxDistance;
};

const categoryForProduct = (product: Product, categories: Category[] = []) =>
  categories.find((c) => c.id === product.category_id || c.slug === product.category_slug);

export const productSearchText = (product: Product, categories: Category[] = []) => {
  const category = categoryForProduct(product, categories);
  return normalize([
    product.name_en,
    product.name_si,
    product.description_en,
    product.description_si,
    product.sku,
    product.category_slug,
    category?.name_en || '',
    category?.name_si || '',
    product.brand || '',
    product.search_keywords || '',
  ].join(' '));
};

export const productSearchScore = (product: Product, query: string, categories: Category[] = []) => {
  const rawQuery = String(query || '').trim();
  if (!rawQuery) return 1;

  const category = categoryForProduct(product, categories);
  // Emoji/category icon search is intentionally checked before text normalization,
  // because normalizing removes emoji characters.
  if (category?.icon && category.icon.includes(rawQuery)) return 115;

  const q = normalize(rawQuery);
  if (!q) return 0;

  const text = productSearchText(product, categories);
  const name = normalize(`${product.name_en} ${product.name_si}`);
  const sku = normalize(product.sku);
  const keywords = normalize(product.search_keywords || '');
  const categoryText = normalize(`${category?.name_en || ''} ${category?.name_si || ''} ${product.category_slug}`);

  if (sku === q) return 120;
  if (name === q) return 110;
  if (categoryText === q) return 105;
  if (name.startsWith(q)) return 100;
  if (categoryText.includes(q)) return 95;
  if (name.includes(q)) return 90;
  if (keywords.includes(q)) return 85;
  if (text.includes(q)) return 75;

  const qTokens = q.split(/\s+/).filter(Boolean);
  const candidateTokens = text.split(/\s+/).filter(Boolean);
  if (!qTokens.length) return 0;

  let matched = 0;
  for (const qt of qTokens) {
    if (candidateTokens.some((ct) => fuzzyTokenMatch(qt, ct))) matched += 1;
  }

  if (matched === qTokens.length) return 55 + matched;
  if (matched / qTokens.length >= 0.67) return 35 + matched;
  return 0;
};

export const matchesProductSearch = (product: Product, query: string, categories: Category[] = []) =>
  productSearchScore(product, query, categories) > 0;


const conservativeCustomerTokenMatch = (queryToken: string, candidateToken: string) => {
  if (!queryToken || !candidateToken) return false;
  if (queryToken === candidateToken) return true;
  // Prefix matching is useful for natural typing ("speak" -> "speaker") but avoid
  // very short substring matches that make unrelated products appear.
  if (queryToken.length >= 3 && candidateToken.startsWith(queryToken)) return true;
  if (queryToken.length < 5 || candidateToken.length < 5) return false;
  const maxLen = Math.max(queryToken.length, candidateToken.length);
  const maxDistance = maxLen >= 9 ? 2 : 1;
  return editDistance(queryToken, candidateToken) <= maxDistance;
};

/**
 * Strict customer-store search.
 *
 * Product descriptions are intentionally excluded from matching because common
 * words inside long descriptions caused unrelated cards to appear. The customer
 * bar now searches only product names, exact item codes, category names and
 * admin search keywords, with conservative typo tolerance.
 */
export const customerProductSearchScore = (product: Product, query: string, categories: Category[] = []) => {
  const rawQuery = String(query || '').trim();
  if (!rawQuery) return 1;

  const category = categoryForProduct(product, categories);
  if (category?.icon && category.icon.includes(rawQuery)) return 115;

  const q = normalize(rawQuery);
  if (!q) return 0;

  const name = normalize(`${product.name_en} ${product.name_si}`);
  const sku = normalize(product.sku);
  const keywords = normalize(product.search_keywords || '');
  const categoryText = normalize(`${category?.name_en || ''} ${category?.name_si || ''} ${product.category_slug}`);

  if (sku === q) return 140;
  if (name === q) return 130;
  if (name.startsWith(q)) return 120;
  if (name.includes(q)) return 112;
  if (categoryText === q) return 108;
  if (categoryText.includes(q)) return 102;
  if (keywords.includes(q)) return 96;

  const qTokens = q.split(/\s+/).filter(Boolean);
  if (!qTokens.length) return 0;

  const nameTokens = name.split(/\s+/).filter(Boolean);
  const categoryTokens = categoryText.split(/\s+/).filter(Boolean);
  const keywordTokens = keywords.split(/\s+/).filter(Boolean);
  const candidateTokens = [...nameTokens, ...categoryTokens, ...keywordTokens, sku].filter(Boolean);

  // Every word typed by the customer must have a real match. This is the key
  // difference from the broad AI/product-discovery search above.
  const allMatched = qTokens.every((qt) =>
    candidateTokens.some((ct) => conservativeCustomerTokenMatch(qt, ct))
  );
  if (!allMatched) return 0;

  const exactNameTokenMatches = qTokens.filter((qt) => nameTokens.includes(qt)).length;
  const prefixNameMatches = qTokens.filter((qt) => nameTokens.some((ct) => ct.startsWith(qt))).length;
  return 70 + exactNameTokenMatches * 8 + prefixNameMatches * 3;
};
