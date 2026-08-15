export interface CategorySuggestion {
  name_en: string;
  name_si: string;
  slug: string;
  icon: string;
}

const rows: CategorySuggestion[] = [
  { name_en: 'Kids Items', name_si: 'ළමා භාණ්ඩ', slug: 'kids-items', icon: '🧒 🎒 🧃' },
  { name_en: 'Kids Toys', name_si: 'ළමා සෙල්ලම් බඩු', slug: 'kids-toys', icon: '🧸 🪀 🚗' },
  { name_en: 'Beauty & Cosmetics', name_si: 'රූපලාවන්‍ය හා කොස්මෙටික්', slug: 'beauty-cosmetics', icon: '💄 🧴 💅' },
  { name_en: 'Garage Tools', name_si: 'ගරාජ් මෙවලම්', slug: 'garage-tools', icon: '🔧 🛠️ 🔨' },
  { name_en: 'Kitchen Items', name_si: 'මුළුතැන්ගෙයි භාණ්ඩ', slug: 'kitchen-items', icon: '🍳 🍽️ 🔪' },
  { name_en: 'Watches & Jewelry', name_si: 'අත්ඔරලෝසු හා ආභරණ', slug: 'watches-jewelry', icon: '⌚ 💎' },
  { name_en: 'Electronics & Gadgets', name_si: 'ඉලෙක්ට්‍රොනික හා ගැජට්', slug: 'electronics-gadgets', icon: '📱 🎧 🔌' },
  { name_en: 'Audio & Mobile Accessories', name_si: 'ශ්‍රව්‍ය හා ජංගම උපාංග', slug: 'audio-mobile-accessories', icon: '🎧 🔊 📱' },
  { name_en: 'Home & Living', name_si: 'නිවස හා දෛනික භාවිත භාණ්ඩ', slug: 'home-living', icon: '🏠 🛋️ 💡' },
  { name_en: 'Fashion & Apparel', name_si: 'විලාසිතා හා ඇඳුම්', slug: 'fashion-apparel', icon: '👕 👗 👜' },
  { name_en: 'Bags & Travel', name_si: 'බෑග් හා සංචාරක භාණ්ඩ', slug: 'bags-travel', icon: '🎒 👜 🧳' },
  { name_en: 'Baby Items', name_si: 'බිළිඳු භාණ්ඩ', slug: 'baby-items', icon: '🍼 👶 🧸' },
  { name_en: 'School & Stationery', name_si: 'පාසල් හා ලිපි ද්‍රව්‍ය', slug: 'school-stationery', icon: '🎒 ✏️ 📚' },
  { name_en: 'Sports & Fitness', name_si: 'ක්‍රීඩා හා ව්‍යායාම භාණ්ඩ', slug: 'sports-fitness', icon: '⚽ 🏏 🏋️' },
  { name_en: 'Car Accessories', name_si: 'වාහන උපාංග', slug: 'car-accessories', icon: '🚗 🔧 💡' },
  { name_en: 'Pet Supplies', name_si: 'සුරතල් සතුන් සඳහා භාණ්ඩ', slug: 'pet-supplies', icon: '🐶 🐱' },
  { name_en: 'Outdoor & Camping', name_si: 'එළිමහන් හා කඳවුරු භාණ්ඩ', slug: 'outdoor-camping', icon: '⛺ 🏕️' },
  { name_en: 'Office Items', name_si: 'කාර්යාල භාණ්ඩ', slug: 'office-items', icon: '🗂️ 🖇️' },
  { name_en: 'Cleaning Items', name_si: 'පිරිසිදු කිරීමේ භාණ්ඩ', slug: 'cleaning-items', icon: '🧹 🧽' },
  { name_en: 'Garden Items', name_si: 'උද්‍යාන භාණ්ඩ', slug: 'garden-items', icon: '🌱 🪴' },
  { name_en: 'Bathroom Items', name_si: 'නානකාමර භාණ්ඩ', slug: 'bathroom-items', icon: '🛁 🚿' },
  { name_en: 'Computer Accessories', name_si: 'පරිගණක උපාංග', slug: 'computer-accessories', icon: '💻 ⌨️' },
];

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
export const slugifyCategory = (value: string) => value.toLowerCase().trim().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function suggestCategoryFields(value: string, source: 'en' | 'si'): Partial<CategorySuggestion> {
  const clean = value.trim();
  if (!clean) return source === 'en' ? { name_en: '', slug: '', icon: '📦 🛍️ ✨' } : { name_si: '' };
  const target = norm(clean);
  const exact = rows.find((r) => norm(source === 'en' ? r.name_en : r.name_si) === target);
  const partial = rows.find((r) => {
    const candidate = norm(source === 'en' ? r.name_en : r.name_si);
    return candidate.includes(target) || target.includes(candidate);
  });
  const match = exact || partial;
  if (match) return { ...match, [source === 'en' ? 'name_en' : 'name_si']: clean };
  if (source === 'en') return { name_en: clean, slug: slugifyCategory(clean), icon: '📦 🛍️ ✨' };
  return { name_si: clean, icon: '📦 🛍️ ✨' };
}

export interface ProductCategorySuggestion {
  name_en: string;
  name_si: string;
  slug: string;
  icon: string;
}

interface ProductAutoRule {
  keywords: string[];
  category: ProductCategorySuggestion;
  categoryAliases: string[];
  tags: string[];
}

const CAT = {
  kids: { name_en: 'Kids Items', name_si: 'ළමා භාණ්ඩ', slug: 'kids-items', icon: '🧒' },
  toys: { name_en: 'Kids Toys', name_si: 'ළමා සෙල්ලම් බඩු', slug: 'kids-toys', icon: '🧸' },
  beauty: { name_en: 'Beauty & Cosmetics', name_si: 'රූපලාවන්‍ය හා කොස්මෙටික්', slug: 'beauty-cosmetics', icon: '✨' },
  tools: { name_en: 'Garage Tools', name_si: 'ගරාජ් මෙවලම්', slug: 'garage-tools', icon: '🛠️' },
  kitchen: { name_en: 'Kitchen Items', name_si: 'මුළුතැන්ගෙයි භාණ්ඩ', slug: 'kitchen-items', icon: '🍳' },
  watches: { name_en: 'Watches & Jewelry', name_si: 'අත්ඔරලෝසු හා ආභරණ', slug: 'watches-jewelry', icon: '⌚' },
  electronics: { name_en: 'Electronics & Gadgets', name_si: 'ඉලෙක්ට්‍රොනික හා ගැජට්', slug: 'electronics-gadgets', icon: '📱' },
  audio: { name_en: 'Audio & Mobile Accessories', name_si: 'ශ්‍රව්‍ය හා ජංගම උපාංග', slug: 'audio-mobile-accessories', icon: '🎧' },
  home: { name_en: 'Home & Living', name_si: 'නිවස හා දෛනික භාවිත භාණ්ඩ', slug: 'home-living', icon: '🏠' },
  fashion: { name_en: 'Fashion & Apparel', name_si: 'විලාසිතා හා ඇඳුම්', slug: 'fashion-apparel', icon: '👕' },
  bags: { name_en: 'Bags & Travel', name_si: 'බෑග් හා සංචාරක භාණ්ඩ', slug: 'bags-travel', icon: '🧳' },
  baby: { name_en: 'Baby Items', name_si: 'බිළිඳු භාණ්ඩ', slug: 'baby-items', icon: '🍼' },
  school: { name_en: 'School & Stationery', name_si: 'පාසල් හා ලිපි ද්‍රව්‍ය', slug: 'school-stationery', icon: '📚' },
  sports: { name_en: 'Sports & Fitness', name_si: 'ක්‍රීඩා හා ව්‍යායාම භාණ්ඩ', slug: 'sports-fitness', icon: '🏃' },
  car: { name_en: 'Car Accessories', name_si: 'වාහන උපාංග', slug: 'car-accessories', icon: '🚗' },
  pets: { name_en: 'Pet Supplies', name_si: 'සුරතල් සතුන් සඳහා භාණ්ඩ', slug: 'pet-supplies', icon: '🐾' },
  outdoor: { name_en: 'Outdoor & Camping', name_si: 'එළිමහන් හා කඳවුරු භාණ්ඩ', slug: 'outdoor-camping', icon: '⛺' },
  office: { name_en: 'Office Items', name_si: 'කාර්යාල භාණ්ඩ', slug: 'office-items', icon: '🗂️' },
  cleaning: { name_en: 'Cleaning Items', name_si: 'පිරිසිදු කිරීමේ භාණ්ඩ', slug: 'cleaning-items', icon: '🧹' },
  garden: { name_en: 'Garden Items', name_si: 'උද්‍යාන භාණ්ඩ', slug: 'garden-items', icon: '🌱' },
  bathroom: { name_en: 'Bathroom Items', name_si: 'නානකාමර භාණ්ඩ', slug: 'bathroom-items', icon: '🚿' },
  computer: { name_en: 'Computer Accessories', name_si: 'පරිගණක උපාංග', slug: 'computer-accessories', icon: '💻' },
  health: { name_en: 'Health & Personal Care', name_si: 'සෞඛ්‍ය හා පුද්ගලික භාවිත භාණ්ඩ', slug: 'health-personal-care', icon: '🧴' },
} satisfies Record<string, ProductCategorySuggestion>;

const productAutoRules: ProductAutoRule[] = [
  { keywords: ['toy','toys','doll','teddy','puzzle','building block','blocks','remote control car','remote car','rc car','kids car','baby toy','learning toy','educational toy','slime','play set'], category: CAT.toys, categoryAliases: ['kids toy','toy','children toy'], tags: ['kids toy','children toy','educational toy','සෙල්ලම් බඩු','ළමා භාණ්ඩ'] },
  { keywords: ['kids water bottle','kids bottle','kids bag','kids backpack','kids watch','kids lunch box','kids lunch bag','kids umbrella','kids school item','kids','kid','children','child','toddler','boys','girls'], category: CAT.kids, categoryAliases: ['kids','children','child','kids items'], tags: ['kids items','children items','ළමා භාණ්ඩ'] },
  { keywords: ['makeup','cosmetic','lipstick','lip gloss','mascara','eyeliner','foundation','face powder','serum','lotion','cream','skincare','skin care','hair oil','shampoo','perfume','fragrance','body spray','nail polish','beauty'], category: CAT.beauty, categoryAliases: ['beauty','cosmetic','fragrance','girls cosmetic'], tags: ['beauty','cosmetics','skincare','personal care','රූපලාවන්‍ය','කොස්මෙටික්'] },
  { keywords: ['spanner','ring spanner','open spanner','wrench','adjustable wrench','socket wrench','screwdriver','screw driver','screw-driver','phillips screwdriver','flat screwdriver','hammer','drill','plier','pliers','socket set','tool set','tool kit','garage tool','ratchet','allen key','hex key','utility knife','box cutter','cutter knife','cutter','measuring tape','tape measure','multimeter','work light'], category: CAT.tools, categoryAliases: ['garage tool','tools','tool','hardware'], tags: ['tools','garage tools','hardware','tool set','මෙවලම්','ගරාජ් මෙවලම්'] },
  { keywords: ['kitchen knife','chef knife','paring knife','bread knife','knife','kitchen','frying pan','pan','pot','cookware','rice cooker','lunch box','food container','storage container','water bottle','bottle','flask','tumbler','chopper','blender','grinder','peeler','spoon','plate','cup','mug','kettle','rack'], category: CAT.kitchen, categoryAliases: ['kitchen','cookware','drinkware'], tags: ['kitchen','cookware','drinkware','household','මුළුතැන්ගෙයි','ගෘහ භාණ්ඩ'] },
  { keywords: ['smartwatch','smart watch','watch','wristwatch','wrist watch','chronograph','bracelet','necklace','jewelry','jewellery','ring','earring'], category: CAT.watches, categoryAliases: ['watch','watches','jewelry','jewellery'], tags: ['watch','wrist watch','smart watch','jewelry','අත් ඔරලෝසුව','ආභරණ'] },
  { keywords: ['headphone','headphones','earphone','earphones','earbud','earbuds','speaker','soundbar','microphone','headset','bluetooth speaker','tws'], category: CAT.audio, categoryAliases: ['audio','mobile accessories','accessories','electronics'], tags: ['audio','bluetooth','wireless','headphones','earphones','speaker','හෙඩ්ෆෝන්','ස්පීකර්'] },
  { keywords: ['laptop stand','mouse','keyboard','mouse pad','mousepad','webcam','usb hub','ssd enclosure','laptop cooler','computer cable','pc accessory'], category: CAT.computer, categoryAliases: ['computer','pc','laptop'], tags: ['computer accessories','laptop accessories','pc accessories'] },
  { keywords: ['phone','smartphone','charger','power bank','powerbank','usb cable','type c','type-c','camera','gadget','adapter','extension cord','led light','smart bulb','projector','tripod','ring light','fan','mini fan'], category: CAT.electronics, categoryAliases: ['electronics','gadget','mobile'], tags: ['electronics','gadget','mobile accessory','ඉලෙක්ට්‍රොනික','මොබයිල් උපාංග'] },
  { keywords: ['shirt','t-shirt','tshirt','dress','jeans','trouser','pants','jacket','blouse','skirt','cap','hat','shoe','shoes','slipper','sandals','fashion','belt','umbrella'], category: CAT.fashion, categoryAliases: ['fashion','apparel','clothing'], tags: ['fashion','apparel','clothing','ඇඳුම්','විලාසිතා'] },
  { keywords: ['bag','backpack','travel bag','duffle','duffel','handbag','wallet','purse','luggage','suitcase'], category: CAT.bags, categoryAliases: ['bag','travel','fashion'], tags: ['bag','travel bag','backpack','handbag','බෑග්','සංචාරක භාණ්ඩ'] },
  { keywords: ['baby','infant','feeding bottle','diaper','pacifier','baby carrier','baby towel'], category: CAT.baby, categoryAliases: ['baby','infant'], tags: ['baby','infant','baby items','බිළිඳු','ළදරු භාණ්ඩ'] },
  { keywords: ['school','pencil','pen set','pen','school bag','stationery','notebook','exercise book','marker','eraser','pencil case','lunch bag'], category: CAT.school, categoryAliases: ['school','stationery'], tags: ['school','stationery','school items','පාසල් භාණ්ඩ','ලිපි ද්‍රව්‍ය'] },
  { keywords: ['football','cricket','fitness','gym','yoga','sports','dumbbell','resistance band','exercise','skipping rope'], category: CAT.sports, categoryAliases: ['sport','fitness','gym'], tags: ['sports','fitness','gym','ක්‍රීඩා','ව්‍යායාම'] },
  { keywords: ['car accessory','car accessories','vehicle accessory','car light','car charger','car holder','phone holder','car vacuum','seat cover','steering cover','vehicle'], category: CAT.car, categoryAliases: ['car','vehicle','automotive'], tags: ['car accessories','vehicle accessories','automotive','වාහන උපාංග'] },
  { keywords: ['dog','cat','pet','puppy','kitten','pet collar','dog collar','pet bowl','pet bed','pet toy','leash'], category: CAT.pets, categoryAliases: ['pet','dog','cat'], tags: ['pet supplies','dog items','cat items'] },
  { keywords: ['camping','tent','camp chair','camping chair','outdoor','hiking','torch','flashlight','sleeping bag','picnic'], category: CAT.outdoor, categoryAliases: ['outdoor','camping','hiking'], tags: ['outdoor','camping','hiking'] },
  { keywords: ['office','file folder','document tray','stapler','paper clip','desk organizer','calculator'], category: CAT.office, categoryAliases: ['office','desk'], tags: ['office items','desk accessories'] },
  { keywords: ['mop','broom','brush','cleaning brush','cleaner','cleaning','sponge','dustpan','vacuum'], category: CAT.cleaning, categoryAliases: ['cleaning','clean'], tags: ['cleaning items','household cleaning'] },
  { keywords: ['garden','plant pot','flower pot','watering can','garden hose','pruning','gardening'], category: CAT.garden, categoryAliases: ['garden','gardening'], tags: ['garden items','gardening'] },
  { keywords: ['bathroom','soap holder','toothbrush holder','shower','bath mat','towel rack'], category: CAT.bathroom, categoryAliases: ['bathroom','bath'], tags: ['bathroom items'] },
  { keywords: ['toothbrush','trimmer','shaver','hair dryer','hair straightener','personal care','sanitary','massage'], category: CAT.health, categoryAliases: ['health','personal care'], tags: ['health','personal care'] },
  { keywords: ['home','room','storage box','organizer','organiser','lamp','wall clock','curtain','mat','hanger','basket','shelf','rack','decor','decoration','pillow','cushion'], category: CAT.home, categoryAliases: ['home','living','household'], tags: ['home','living','household','storage','නිවස','ගෘහ භාණ්ඩ'] },
];

const productNorm = (value: string) => value
  .toLowerCase()
  .replace(/[–—_]/g, ' ')
  .replace(/[^a-z0-9\u0D80-\u0DFF+&.-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const uniq = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const clean = value.trim();
    const key = productNorm(clean);
    if (!clean || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const GENERIC_CATEGORY_WORDS = new Set(['item','items','product','products','accessory','accessories','and','the','for','general']);
const PRODUCT_STOP_WORDS = new Set(['the','and','with','for','ora','o-ra','pcs','piece','pieces','new','premium','smart','portable','mini','large','small','set','pack','color','colour']);

const categoryMatchScore = (
  category: { slug: string; name_en: string; name_si?: string },
  suggestion: ProductCategorySuggestion,
  aliases: string[],
) => {
  const haystack = productNorm(`${category.slug} ${category.name_en} ${category.name_si || ''}`);
  let score = 0;
  const candidates = [suggestion.slug, suggestion.name_en, ...aliases];
  for (const alias of candidates) {
    const a = productNorm(alias);
    if (!a) continue;
    if (haystack === a) score += 20;
    else if (haystack.includes(a) || a.includes(haystack)) score += Math.max(3, a.split(' ').length * 3);
    else {
      const aliasTokens = a.split(' ').filter((x) => x.length >= 3 && !GENERIC_CATEGORY_WORDS.has(x));
      score += aliasTokens.filter((token) => haystack.includes(token)).length;
    }
  }
  return score;
};

const productToExistingCategoryScore = (target: string, category: { slug: string; name_en: string; name_si?: string }) => {
  const cat = productNorm(`${category.name_en} ${category.slug}`);
  const catTokens = uniq(cat.split(' ')).filter((t) => t.length >= 3 && !GENERIC_CATEGORY_WORDS.has(t));
  if (!catTokens.length) return 0;
  let score = 0;
  const productTokens = new Set(target.split(' ').filter(Boolean));
  for (const token of catTokens) {
    if (productTokens.has(token)) score += 5;
    else if (target.includes(token)) score += 2;
  }
  const compactCat = catTokens.join(' ');
  if (compactCat && target.includes(compactCat)) score += 8;
  return score;
};

const titleCase = (value: string) => value.replace(/\b\w/g, (m) => m.toUpperCase());
const dynamicFallbackCategory = (target: string): ProductCategorySuggestion => {
  const tokens = target.split(' ').filter((t) => t.length >= 2 && !PRODUCT_STOP_WORDS.has(t) && !/^\d+$/.test(t));
  const picked = tokens.slice(Math.max(0, tokens.length - 2));
  const base = picked.length ? titleCase(picked.join(' ')) : 'General';
  const name = `${base} Items`;
  return { name_en: name, name_si: `${base} භාණ්ඩ`, slug: slugifyCategory(name), icon: '📦' };
};

/**
 * Unlimited-category auto detection.
 * - No fixed default category list is required.
 * - Strong keyword matches win first (Kids Water Bottle -> Kids Items; Knife -> Kitchen Items).
 * - Existing user-created categories are also matched by words in the product name.
 * - If nothing matches, a new product-family category is suggested instead of forcing Other Products.
 */
export function suggestProductMetadata(
  productName: string,
  categories: Array<{ slug: string; name_en: string; name_si?: string }>,
): {
  category_slug?: string;
  suggested_category?: ProductCategorySuggestion;
  search_keywords: string;
  confidence: 'strong' | 'fallback';
} {
  const cleanName = productName.trim();
  const target = productNorm(cleanName);
  if (!target) return { search_keywords: '', confidence: 'fallback' };

  let bestRule: ProductAutoRule | undefined;
  let bestRuleScore = 0;
  for (const rule of productAutoRules) {
    let score = 0;
    for (const keyword of rule.keywords) {
      const k = productNorm(keyword);
      if (!k) continue;
      if (target === k) score += 30;
      else if (target.includes(k)) score += Math.max(5, k.split(' ').length * 6);
    }
    if (score > bestRuleScore) {
      bestRuleScore = score;
      bestRule = rule;
    }
  }

  let bestExisting: { slug: string; name_en: string; name_si?: string } | undefined;
  let bestExistingScore = 0;
  for (const category of categories) {
    const score = productToExistingCategoryScore(target, category);
    if (score > bestExistingScore) {
      bestExistingScore = score;
      bestExisting = category;
    }
  }

  let selectedCategory: ProductCategorySuggestion;
  let category_slug: string | undefined;
  let suggested_category: ProductCategorySuggestion | undefined;

  if (bestRule) {
    selectedCategory = bestRule.category;
    let mappedSlug: string | undefined;
    let mappedScore = 0;
    for (const category of categories) {
      const score = categoryMatchScore(category, bestRule.category, bestRule.categoryAliases);
      if (score > mappedScore) {
        mappedScore = score;
        mappedSlug = category.slug;
      }
    }
    if (mappedScore >= 3 && mappedSlug) category_slug = mappedSlug;
    else {
      suggested_category = bestRule.category;
      category_slug = bestRule.category.slug;
    }
  } else if (bestExisting && bestExistingScore >= 5) {
    selectedCategory = {
      name_en: bestExisting.name_en,
      name_si: bestExisting.name_si || bestExisting.name_en,
      slug: bestExisting.slug,
      icon: '📦',
    };
    category_slug = bestExisting.slug;
  } else {
    selectedCategory = dynamicFallbackCategory(target);
    suggested_category = selectedCategory;
    category_slug = selectedCategory.slug;
  }

  const nameTokens = target
    .split(' ')
    .filter((token) => token.length >= 2 && !PRODUCT_STOP_WORDS.has(token));
  const generatedTags = uniq([
    cleanName,
    ...nameTokens,
    selectedCategory.name_en,
    ...(bestRule?.tags || []),
  ]).slice(0, 24);

  return {
    category_slug,
    suggested_category,
    search_keywords: generatedTags.join(', '),
    confidence: bestRule || (bestExisting && bestExistingScore >= 5) ? 'strong' : 'fallback',
  };
}
