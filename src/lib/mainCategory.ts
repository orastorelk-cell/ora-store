export interface MainCategoryDefinition {
  slug: string;
  name_en: string;
  name_si: string;
  icon: string;
}

export const MAIN_CATEGORY_DEFINITIONS: MainCategoryDefinition[] = [
  { slug: 'home-bathroom', name_en: 'Home & Bathroom', name_si: 'නිවස & නාන කාමරය', icon: '🏠' },
  { slug: 'kitchen-dining', name_en: 'Kitchen & Dining', name_si: 'මුළුතැන්ගෙය & ආහාර', icon: '🍽️' },
  { slug: 'baby-kids', name_en: 'Baby & Kids', name_si: 'බබා & ළමා', icon: '🧸' },
  { slug: 'electronics-security', name_en: 'Electronics & Security', name_si: 'ඉලෙක්ට්‍රොනික & ආරක්ෂක', icon: '📱' },
  { slug: 'fashion-accessories', name_en: 'Fashion & Accessories', name_si: 'ඇඳුම් & උපාංග', icon: '👕' },
  { slug: 'beauty-personal-care', name_en: 'Beauty & Personal Care', name_si: 'රූපලාවණ්‍ය & පුද්ගලික සත්කාර', icon: '✨' },
  { slug: 'automotive', name_en: 'Automotive', name_si: 'වාහන උපාංග', icon: '🚗' },
  { slug: 'sports-outdoors', name_en: 'Sports & Outdoors', name_si: 'ක්‍රීඩා & එළිමහන්', icon: '⚽' },
  { slug: 'office-stationery', name_en: 'Office & Stationery', name_si: 'කාර්යාල & ලිපි ද්‍රව්‍ය', icon: '📚' },
  { slug: 'pet-supplies', name_en: 'Pet Supplies', name_si: 'සුරතල් සතුන්', icon: '🐾' },
  { slug: 'health-wellness', name_en: 'Health & Wellness', name_si: 'සෞඛ්‍ය & සුවතාව', icon: '🩺' },
  { slug: 'other', name_en: 'Other', name_si: 'වෙනත්', icon: '📦' },
];

type CategoryLike = {
  slug?: string;
  name_en?: string;
  name_si?: string;
  main_category_slug?: string;
};

type ProductLike = {
  category_slug?: string;
  product_type?: string;
  bundle_components?: unknown[];
};

const normalize = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const EXACT_CATEGORY_MAP: Record<string, string> = {
  'baby and kids': 'baby-kids',
  'baby items': 'baby-kids',
  'kids items': 'baby-kids',
  'kids toys': 'baby-kids',
  'bath and body accessories': 'home-bathroom',
  'bathroom items': 'home-bathroom',
  'cleaning gloves': 'home-bathroom',
  'cleaning items': 'home-bathroom',
  'home and living': 'home-bathroom',
  'washing machine accessories': 'home-bathroom',
  'kitchen and dining': 'kitchen-dining',
  'kitchen items': 'kitchen-dining',
  'bluetooth earbuds': 'electronics-security',
  'electronics and gadgets': 'electronics-security',
  'audio and mobile accessories': 'electronics-security',
  'computer accessories': 'electronics-security',
  'security cameras and cctv': 'electronics-security',
  'fashion and apparel': 'fashion-accessories',
  'umbrellas and rainwear': 'fashion-accessories',
  'watches and jewelry': 'fashion-accessories',
  'bags and travel': 'fashion-accessories',
  'beauty and cosmetics': 'beauty-personal-care',
  'health and personal care': 'health-wellness',
  'garage tools': 'automotive',
  'car accessories': 'automotive',
  'sports and fitness': 'sports-outdoors',
  'outdoor and camping': 'sports-outdoors',
  'school and stationery': 'office-stationery',
  'office items': 'office-stationery',
  'pet supplies': 'pet-supplies',
  'garden items': 'home-bathroom',
};

const KEYWORD_RULES: Array<{ slug: string; keywords: string[] }> = [
  { slug: 'baby-kids', keywords: ['baby', 'babies', 'kid', 'kids', 'child', 'children', 'toddler', 'infant', 'feeding', 'toy', 'toys', 'maternity'] },
  { slug: 'beauty-personal-care', keywords: ['beauty', 'cosmetic', 'cosmetics', 'makeup', 'skin care', 'skincare', 'hair care', 'haircare', 'perfume', 'fragrance', 'grooming'] },
  { slug: 'automotive', keywords: ['automotive', 'car ', 'vehicle', 'motorbike', 'motorcycle', 'garage', 'car accessory', 'car care'] },
  { slug: 'electronics-security', keywords: ['electronic', 'electronics', 'mobile', 'phone', 'charger', 'cable', 'bluetooth', 'earbud', 'earbuds', 'audio', 'speaker', 'camera', 'cctv', 'security', 'wifi', 'smart device', 'computer', 'laptop', 'gadget'] },
  { slug: 'sports-outdoors', keywords: ['sport', 'sports', 'fitness', 'gym', 'outdoor', 'camping', 'hiking', 'cycling', 'exercise'] },
  { slug: 'office-stationery', keywords: ['office', 'stationery', 'school', 'book', 'notebook', 'pen ', 'pencil', 'document', 'file holder'] },
  { slug: 'pet-supplies', keywords: ['pet ', 'pets', 'dog', 'cat ', 'cat accessory', 'aquarium', 'bird accessory'] },
  { slug: 'health-wellness', keywords: ['health', 'wellness', 'medical', 'first aid', 'support brace', 'massager', 'therapy'] },
  { slug: 'kitchen-dining', keywords: ['kitchen', 'dining', 'cookware', 'cooking', 'utensil', 'cutlery', 'plate', 'bowl', 'cup', 'food storage', 'lunch box', 'lunch bag', 'baking'] },
  { slug: 'fashion-accessories', keywords: ['fashion', 'apparel', 'clothing', 'garment', 'wear', 'umbrella', 'rainwear', 'jewelry', 'jewellery', 'watch', 'wallet', 'handbag', 'backpack', 'shoe', 'shoes', 'slipper', 'cap ', 'hat '] },
  { slug: 'home-bathroom', keywords: ['home', 'bath', 'bathroom', 'cleaning', 'cleaner', 'laundry', 'washing machine', 'floor', 'mat', 'carpet', 'scrubber', 'mop', 'brush', 'storage', 'organizer', 'garden', 'household'] },
];

export const mainCategoryBySlug = (slug: string | null | undefined) =>
  MAIN_CATEGORY_DEFINITIONS.find((row) => row.slug === slug) || MAIN_CATEGORY_DEFINITIONS[MAIN_CATEGORY_DEFINITIONS.length - 1];

export const mainCategorySlugForCategory = (category: CategoryLike | null | undefined): string => {
  const saved = String(category?.main_category_slug || '').trim();
  if (saved && MAIN_CATEGORY_DEFINITIONS.some((row) => row.slug === saved)) return saved;

  const nameText = normalize(category?.name_en || category?.slug || '');
  const slugText = normalize(category?.slug || '');
  const combined = `${nameText} ${slugText}`.trim();
  if (!combined) return 'other';

  const exact = EXACT_CATEGORY_MAP[nameText] || EXACT_CATEGORY_MAP[slugText];
  if (exact) return exact;

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => combined.includes(normalize(keyword)))) return rule.slug;
  }
  return 'other';
};

export const mainCategoryForCategory = (category: CategoryLike | null | undefined) =>
  mainCategoryBySlug(mainCategorySlugForCategory(category));

export const mainCategoryLabelForCategory = (category: CategoryLike | null | undefined, language: 'en' | 'si' = 'en') => {
  const row = mainCategoryForCategory(category);
  return language === 'si' ? row.name_si : row.name_en;
};

export const mainCategorySlugForProduct = (product: ProductLike, categories: CategoryLike[]) => {
  const category = categories.find((row) => String(row.slug || '') === String(product.category_slug || ''));
  return mainCategorySlugForCategory(category || { slug: product.category_slug, name_en: product.category_slug });
};

export const productMatchesCatalogCategory = (
  product: ProductLike,
  selectedCategorySlug: string | null,
  categories: CategoryLike[],
) => {
  if (!selectedCategorySlug) return true;
  const isBundle = product.product_type === 'bundle' || Array.isArray(product.bundle_components) && product.bundle_components.length > 0;
  if (selectedCategorySlug === 'combo-pack') return isBundle;
  if (isBundle) return false;
  if (selectedCategorySlug.startsWith('main:')) {
    return mainCategorySlugForProduct(product, categories) === selectedCategorySlug.slice(5);
  }
  return String(product.category_slug || '') === selectedCategorySlug;
};
