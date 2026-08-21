export const adminDashboardProductAutoPopularPatch = () => ({
  name: 'ora-admin-product-auto-popular-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    let text = code;

    const oldImport = "import { suggestCategoryFields, suggestProductMetadata } from '../../lib/categoryAuto';";
    if (text.includes(oldImport)) {
      text = text.replace(
        oldImport,
        "import { suggestCategoryFields } from '../../lib/categoryAuto';\nimport { suggestProductMetadata } from '../../lib/productAutoPopular';"
      );
    }

    // Use the English description as additional context when a product name is
    // only a brand/model (while the name still has first priority).
    text = text.replaceAll(
      'suggestProductMetadata(productForm.name_en, categories)',
      'suggestProductMetadata(productForm.name_en, categories, productForm.description_en)'
    );
    text = text.replaceAll(
      'suggestProductMetadata(name, categories)',
      'suggestProductMetadata(name, categories, productForm.description_en)'
    );

    const marker = '  const liveProductAuto = suggestProductMetadata(productForm.name_en, categories, productForm.description_en);';
    if (text.includes(marker) && !text.includes('O-RA reliable automatic Sinhala fill')) {
      const effects = String.raw`
  // O-RA reliable automatic Sinhala fill. New products translate shortly after
  // English typing stops; manual Sinhala is never overwritten. The existing
  // Auto Sinhala buttons remain available for an explicit regenerate.
  useEffect(() => {
    if (!isAddProductOpen || editingProduct) return;
    const source = String(productForm.name_en || '').trim();
    if (!source || String(productForm.name_si || '').trim()) return;
    const timer = window.setTimeout(() => { void autoFillProductSinhala('name', source); }, 650);
    return () => window.clearTimeout(timer);
  }, [productForm.name_en, productForm.name_si, isAddProductOpen, editingProduct]);

  useEffect(() => {
    if (!isAddProductOpen || editingProduct) return;
    const source = String(productForm.description_en || '').trim();
    if (source.length < 4 || String(productForm.description_si || '').trim()) return;
    const timer = window.setTimeout(() => { void autoFillProductSinhala('description', source); }, 800);
    return () => window.clearTimeout(timer);
  }, [productForm.description_en, productForm.description_si, isAddProductOpen, editingProduct]);

`;
      text = text.replace(marker, marker + effects);
    }

    return text === code ? null : { code: text, map: null };
  },
});
