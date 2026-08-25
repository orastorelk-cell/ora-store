export const mainCategoryHierarchyPatch = () => ({
  name: 'ora-main-category-hierarchy-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    if (id.endsWith('/src/App.tsx')) {
      let text = code;

      const importMarker = "import { activeVariants, displayUnitPrice, normalizedProductType } from './lib/productVariants';\n";
      if (!text.includes("from './lib/mainCategory'")) {
        if (!text.includes(importMarker)) throw new Error('[O-RA main category patch] App import marker not found');
        text = text.replace(
          importMarker,
          importMarker + "import { MAIN_CATEGORY_DEFINITIONS, mainCategoryBySlug, mainCategorySlugForCategory, mainCategorySlugForProduct, productMatchesCatalogCategory } from './lib/mainCategory';\n",
        );
      }

      const oldFilter = "      .filter((p) => selectedCategorySlug === 'combo-pack' ? normalizedProductType(p) === 'bundle' : (selectedCategorySlug ? (normalizedProductType(p) !== 'bundle' && p.category_slug === selectedCategorySlug) : true))";
      const newFilter = "      .filter((p) => productMatchesCatalogCategory(p, selectedCategorySlug, categories))";
      if (text.includes(oldFilter)) text = text.replace(oldFilter, newFilter);
      else if (!text.includes(newFilter)) throw new Error('[O-RA main category patch] catalog filter marker not found');

      const categoryStartMarker = '  const categoryFilterOptions = React.useMemo(() => {';
      const categoryEndMarker = '  const selectedCategoryLabel = categoryFilterOptions.find((option) => option.slug === selectedCategorySlug)?.label;';
      const categoryStart = text.indexOf(categoryStartMarker);
      const categoryEnd = text.indexOf(categoryEndMarker, categoryStart);
      if (categoryStart < 0 || categoryEnd < 0) throw new Error('[O-RA main category patch] category option block markers not found');

      const hierarchyBlock = String.raw`  const categoryFilterOptions = React.useMemo(() => {
    const comboCount = products.filter((product) => normalizedProductType(product) === 'bundle').length;
    const selectedSubCategory = selectedCategorySlug && !selectedCategorySlug.startsWith('main:')
      ? categories.find((category) => category.slug === selectedCategorySlug)
      : undefined;
    const activeMainSlug = selectedCategorySlug?.startsWith('main:')
      ? selectedCategorySlug.slice(5)
      : selectedSubCategory
        ? mainCategorySlugForCategory(selectedSubCategory)
        : null;

    const countMain = (mainSlug: string) => products.filter((product) =>
      normalizedProductType(product) !== 'bundle' && mainCategorySlugForProduct(product, categories) === mainSlug
    ).length;

    if (activeMainSlug) {
      const main = mainCategoryBySlug(activeMainSlug);
      const subRows = categories
        .filter((category) => category.slug !== 'combo-pack' && mainCategorySlugForCategory(category) === activeMainSlug)
        .map((category) => ({
          slug: category.slug,
          label: language === 'si' ? category.name_si : category.name_en,
          icon: category.icon,
          count: products.filter((product) => normalizedProductType(product) !== 'bundle' && product.category_slug === category.slug).length,
        }))
        .filter((category) => category.count > 0)
        .sort((a, b) => a.label.localeCompare(b.label));

      return [
        { slug: null, label: language === 'si' ? '← ප්‍රධාන වර්ග' : '← Main Categories', icon: '←', count: products.length },
        {
          slug: 'main:' + main.slug,
          label: language === 'si' ? 'සියලු ' + main.name_si : 'All ' + main.name_en,
          icon: main.icon,
          count: countMain(main.slug),
        },
        ...subRows,
      ];
    }

    const mainRows = MAIN_CATEGORY_DEFINITIONS
      .map((main) => ({
        slug: 'main:' + main.slug,
        label: language === 'si' ? main.name_si : main.name_en,
        icon: main.icon,
        count: countMain(main.slug),
      }))
      .filter((main) => main.count > 0);

    return [
      { slug: null, label: getTranslation(language, 'allCategories'), icon: '✦', count: products.length },
      ...mainRows,
      ...(comboCount > 0 ? [{ slug: 'combo-pack', label: 'Combo Packs', icon: '🎁', count: comboCount }] : []),
    ];
  }, [categories, language, products, selectedCategorySlug]);

`;
      text = text.slice(0, categoryStart) + hierarchyBlock + text.slice(categoryEnd);
      return { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      let text = code;
      const importMarker = "import { slugifyCategory, suggestCategoryFields } from '../../lib/categoryAuto';\n";
      if (!text.includes("from '../../lib/mainCategory'")) {
        if (!text.includes(importMarker)) throw new Error('[O-RA main category patch] Admin import marker not found');
        text = text.replace(
          importMarker,
          importMarker + "import { mainCategoryForCategory } from '../../lib/mainCategory';\n",
        );
      }

      const cardMarker = `<p className="font-bold text-white truncate">{cat.name_en}</p>\n                    <p className="text-[11px] text-neutral-500 truncate">{cat.name_si || '—'}</p>`;
      const cardReplacement = `<p className="font-bold text-white truncate">{cat.name_en}</p>\n                    <p className="text-[11px] text-neutral-500 truncate">{cat.name_si || '—'}</p>\n                    <p className="mt-1 text-[9px] font-black text-orange-300">MAIN • {mainCategoryForCategory(cat).icon} {mainCategoryForCategory(cat).name_en}</p>`;
      if (text.includes(cardMarker)) text = text.replace(cardMarker, cardReplacement);
      else if (!text.includes('MAIN • {mainCategoryForCategory(cat).icon}')) throw new Error('[O-RA main category patch] Admin category card marker not found');

      return { code: text, map: null };
    }

    return null;
  },
});
