export interface ProductCategorySuggestion {
  name_en: string;
  name_si: string;
  slug: string;
  icon: string;
}

type CategoryLike = { slug: string; name_en: string; name_si?: string };

type Rule = {
  category: ProductCategorySuggestion;
  keywords: string[];
  tags: string[];
};

const CAT = {
  kids: { name_en:'Kids Items', name_si:'ළමා භාණ්ඩ', slug:'kids-items', icon:'🧒' },
  toys: { name_en:'Kids Toys', name_si:'ළමා සෙල්ලම් බඩු', slug:'kids-toys', icon:'🧸' },
  beauty: { name_en:'Beauty & Cosmetics', name_si:'රූපලාවන්‍ය හා කොස්මෙටික්', slug:'beauty-cosmetics', icon:'✨' },
  tools: { name_en:'Garage Tools', name_si:'ගරාජ් මෙවලම්', slug:'garage-tools', icon:'🛠️' },
  kitchen: { name_en:'Kitchen Items', name_si:'මුළුතැන්ගෙයි භාණ්ඩ', slug:'kitchen-items', icon:'🍳' },
  watches: { name_en:'Watches & Jewelry', name_si:'අත්ඔරලෝසු හා ආභරණ', slug:'watches-jewelry', icon:'⌚' },
  electronics: { name_en:'Electronics & Gadgets', name_si:'ඉලෙක්ට්‍රොනික හා ගැජට්', slug:'electronics-gadgets', icon:'📱' },
  audio: { name_en:'Audio & Mobile Accessories', name_si:'ශ්‍රව්‍ය හා ජංගම උපාංග', slug:'audio-mobile-accessories', icon:'🎧' },
  home: { name_en:'Home & Living', name_si:'නිවස හා දෛනික භාවිත භාණ්ඩ', slug:'home-living', icon:'🏠' },
  fashion: { name_en:'Fashion & Apparel', name_si:'විලාසිතා හා ඇඳුම්', slug:'fashion-apparel', icon:'👕' },
  bags: { name_en:'Bags & Travel', name_si:'බෑග් හා සංචාරක භාණ්ඩ', slug:'bags-travel', icon:'🧳' },
  baby: { name_en:'Baby Items', name_si:'බිළිඳු භාණ්ඩ', slug:'baby-items', icon:'🍼' },
  school: { name_en:'School & Stationery', name_si:'පාසල් හා ලිපි ද්‍රව්‍ය', slug:'school-stationery', icon:'📚' },
  sports: { name_en:'Sports & Fitness', name_si:'ක්‍රීඩා හා ව්‍යායාම භාණ්ඩ', slug:'sports-fitness', icon:'🏃' },
  car: { name_en:'Car Accessories', name_si:'වාහන උපාංග', slug:'car-accessories', icon:'🚗' },
  pets: { name_en:'Pet Supplies', name_si:'සුරතල් සතුන් සඳහා භාණ්ඩ', slug:'pet-supplies', icon:'🐾' },
  outdoor: { name_en:'Outdoor & Camping', name_si:'එළිමහන් හා කඳවුරු භාණ්ඩ', slug:'outdoor-camping', icon:'⛺' },
  office: { name_en:'Office Items', name_si:'කාර්යාල භාණ්ඩ', slug:'office-items', icon:'🗂️' },
  cleaning: { name_en:'Cleaning Items', name_si:'පිරිසිදු කිරීමේ භාණ්ඩ', slug:'cleaning-items', icon:'🧹' },
  garden: { name_en:'Garden Items', name_si:'උද්‍යාන භාණ්ඩ', slug:'garden-items', icon:'🌱' },
  bathroom: { name_en:'Bathroom Items', name_si:'නානකාමර භාණ්ඩ', slug:'bathroom-items', icon:'🚿' },
  computer: { name_en:'Computer Accessories', name_si:'පරිගණක උපාංග', slug:'computer-accessories', icon:'💻' },
  health: { name_en:'Health & Personal Care', name_si:'සෞඛ්‍ය හා පුද්ගලික භාවිත භාණ්ඩ', slug:'health-personal-care', icon:'🧴' },
} satisfies Record<string, ProductCategorySuggestion>;

const norm = (value:string) => String(value || '')
  .toLowerCase()
  .replace(/[–—_]/g,' ')
  .replace(/[^a-z0-9\u0D80-\u0DFF+&.-]+/g,' ')
  .replace(/\s+/g,' ')
  .trim();

const rules: Rule[] = [
  { category:CAT.cleaning, keywords:[
    'harpic','domex','vim cleaner','cif cleaner','lysol','lizol','clorox','bleach','toilet cleaner','toilet cleaning','floor cleaner','surface cleaner','bathroom cleaner','disinfectant cleaner','dishwash liquid','dishwashing liquid','washing powder','laundry detergent','detergent','fabric softener','mop','broom','cleaning brush','cleaner','cleaning','sponge','dustpan','vacuum'
  ], tags:['cleaning','household cleaning','toilet cleaner','floor cleaner','පිරිසිදු කිරීමේ භාණ්ඩ'] },
  { category:CAT.bathroom, keywords:['bathroom rack','soap holder','toothbrush holder','shower','bath mat','towel rack','toilet brush','bathroom accessory'], tags:['bathroom','bathroom accessories'] },
  { category:CAT.toys, keywords:['toy','toys','doll','teddy','puzzle','building block','blocks','remote control car','rc car','learning toy','educational toy','slime','play set'], tags:['kids toy','children toy','educational toy'] },
  { category:CAT.kids, keywords:['kids water bottle','kids bottle','kids bag','kids backpack','kids watch','kids lunch box','kids umbrella','children item','toddler','kids','child'], tags:['kids items','children items'] },
  { category:CAT.beauty, keywords:['makeup','cosmetic','lipstick','lip gloss','mascara','eyeliner','foundation','face powder','serum','skincare','skin care','perfume','fragrance','body spray','nail polish','beauty'], tags:['beauty','cosmetics','skincare'] },
  { category:CAT.health, keywords:['toothbrush','trimmer','shaver','hair dryer','hair straightener','personal care','sanitary','massage','body lotion','hand wash','dettol','first aid'], tags:['health','personal care'] },
  { category:CAT.tools, keywords:['spanner','wrench','screwdriver','hammer','drill','plier','pliers','socket set','tool set','tool kit','ratchet','allen key','hex key','utility knife','box cutter','cutter knife','measuring tape','tape measure','multimeter','work light'], tags:['tools','garage tools','hardware'] },
  { category:CAT.kitchen, keywords:['kitchen knife','chef knife','paring knife','bread knife','knife','kitchen','frying pan','cookware','rice cooker','lunch box','food container','storage container','water bottle','bottle','flask','tumbler','chopper','blender','grinder','peeler','spoon','plate','cup','mug','kettle'], tags:['kitchen','cookware','drinkware'] },
  { category:CAT.watches, keywords:['smartwatch','smart watch','watch','wristwatch','chronograph','bracelet','necklace','jewelry','jewellery','earring'], tags:['watch','jewelry'] },
  { category:CAT.audio, keywords:['headphone','headphones','earphone','earphones','earbud','earbuds','speaker','soundbar','microphone','headset','bluetooth speaker','tws'], tags:['audio','bluetooth','wireless'] },
  { category:CAT.computer, keywords:['laptop stand','mouse','keyboard','mouse pad','mousepad','webcam','usb hub','ssd enclosure','laptop cooler','computer cable','pc accessory'], tags:['computer accessories','laptop accessories'] },
  { category:CAT.electronics, keywords:['phone','smartphone','charger','power bank','powerbank','usb cable','type c','type-c','camera','gadget','adapter','extension cord','led light','smart bulb','projector','tripod','ring light','mini fan'], tags:['electronics','gadgets','mobile accessories'] },
  { category:CAT.fashion, keywords:['shirt','t-shirt','tshirt','dress','jeans','trouser','pants','jacket','blouse','skirt','cap','hat','shoe','shoes','slipper','sandals','fashion','belt','umbrella'], tags:['fashion','apparel','clothing'] },
  { category:CAT.bags, keywords:['bag','backpack','travel bag','duffle','duffel','handbag','wallet','purse','luggage','suitcase'], tags:['bag','travel','backpack'] },
  { category:CAT.baby, keywords:['baby','infant','feeding bottle','diaper','pacifier','baby carrier','baby towel'], tags:['baby','infant'] },
  { category:CAT.school, keywords:['school','pencil','pen set','stationery','notebook','exercise book','marker','eraser','pencil case'], tags:['school','stationery'] },
  { category:CAT.sports, keywords:['football','cricket','fitness','gym','yoga','sports','dumbbell','resistance band','exercise','skipping rope'], tags:['sports','fitness','gym'] },
  { category:CAT.car, keywords:['car accessory','vehicle accessory','car light','car charger','car holder','phone holder','car vacuum','seat cover','steering cover','vehicle'], tags:['car accessories','vehicle accessories'] },
  { category:CAT.pets, keywords:['dog','cat','pet','puppy','kitten','pet collar','dog collar','pet bowl','pet bed','pet toy','leash'], tags:['pet supplies','dog items','cat items'] },
  { category:CAT.outdoor, keywords:['camping','tent','camp chair','camping chair','outdoor','hiking','torch','flashlight','sleeping bag','picnic'], tags:['outdoor','camping','hiking'] },
  { category:CAT.office, keywords:['office','file folder','document tray','stapler','paper clip','desk organizer','calculator'], tags:['office items','desk accessories'] },
  { category:CAT.garden, keywords:['garden','plant pot','flower pot','watering can','garden hose','pruning','gardening'], tags:['garden','gardening'] },
  { category:CAT.home, keywords:['home','room','storage box','organizer','organiser','lamp','wall clock','curtain','mat','hanger','basket','shelf','rack','decor','decoration','pillow','cushion'], tags:['home','living','household'] },
];

const categoryTokens = (c:CategoryLike) => norm(`${c.slug} ${c.name_en} ${c.name_si || ''}`).split(' ').filter(Boolean);

const mapCuratedToExisting = (wanted:ProductCategorySuggestion, categories:CategoryLike[]) => {
  const wantedTokens = new Set(norm(`${wanted.slug} ${wanted.name_en}`).split(' ').filter(t => t.length >= 3 && !['and','items','item'].includes(t)));
  let best:CategoryLike|undefined;
  let bestScore = 0;
  for (const c of categories) {
    const tokens = categoryTokens(c);
    let score = 0;
    for (const t of wantedTokens) if (tokens.includes(t)) score += 4;
    if (norm(c.slug) === norm(wanted.slug)) score += 20;
    if (norm(c.name_en) === norm(wanted.name_en)) score += 20;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 4 ? best : undefined;
};

const scoreRule = (text:string, rule:Rule) => {
  let score = 0;
  for (const raw of rule.keywords) {
    const k = norm(raw);
    if (!k) continue;
    if (text === k) score += 60;
    else if (text.includes(k)) score += k.includes(' ') ? 22 + k.split(' ').length * 3 : 12;
  }
  return score;
};

const uniq = (values:string[]) => {
  const seen = new Set<string>();
  return values.filter(v => {
    const clean = String(v || '').trim();
    const key = norm(clean);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
};

/**
 * Curated product classification.
 * Never creates a category from the product/brand name itself (so Harpic cannot
 * become "Harpic Items"). A strong product/brand rule wins; otherwise an
 * existing matching popular category is reused, then Home & Living is the safe
 * broad fallback.
 */
export function suggestProductMetadata(
  productName:string,
  categories:CategoryLike[],
  description = '',
): {
  category_slug?: string;
  suggested_category?: ProductCategorySuggestion;
  search_keywords: string;
  confidence: 'strong'|'fallback';
} {
  const cleanName = String(productName || '').trim();
  if (!cleanName) return { search_keywords:'', confidence:'fallback' };
  const text = norm(`${cleanName} ${description || ''}`);

  let bestRule:Rule|undefined;
  let bestScore = 0;
  for (const rule of rules) {
    const score = scoreRule(text, rule);
    if (score > bestScore) { bestScore = score; bestRule = rule; }
  }

  let chosen = bestRule?.category;
  if (!chosen) {
    // Match words against the existing curated-style categories, but never use
    // the product name itself as a newly generated category.
    let bestExisting:CategoryLike|undefined;
    let bestExistingScore = 0;
    const nameTokens = new Set(norm(cleanName).split(' ').filter(t => t.length >= 3));
    for (const c of categories) {
      let score = 0;
      for (const token of categoryTokens(c)) if (nameTokens.has(token) && token.length >= 3) score += 4;
      if (score > bestExistingScore) { bestExistingScore = score; bestExisting = c; }
    }
    if (bestExisting && bestExistingScore >= 4) {
      const tags = uniq([cleanName, bestExisting.name_en]);
      return { category_slug:bestExisting.slug, search_keywords:tags.join(', '), confidence:'strong' };
    }
    chosen = CAT.home;
  }

  const existing = mapCuratedToExisting(chosen, categories);
  const category_slug = existing?.slug || chosen.slug;
  const suggested_category = existing ? undefined : chosen;
  const nameTokens = norm(cleanName).split(' ').filter(t => t.length >= 2 && !['the','and','with','for','new','premium','smart','portable','mini','large','small','set','pack','color','colour'].includes(t));
  const tags = uniq([cleanName, ...nameTokens, chosen.name_en, ...(bestRule?.tags || [])]).slice(0,24);

  return {
    category_slug,
    suggested_category,
    search_keywords:tags.join(', '),
    confidence:bestRule ? 'strong' : 'fallback',
  };
}
