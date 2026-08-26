const replaceIfPresent = (text: string, from: string, to: string) =>
  text.includes(from) ? text.replace(from, to) : text;

/**
 * Product-content language policy:
 * - Storefront product names/descriptions/item-detail values always use English.
 * - General storefront Sinhala UI (buttons, headings, categories, notices, etc.) stays untouched.
 * - Add/Edit Product hides product-specific Sinhala inputs.
 * - New/edited products save blank Sinhala product fields, while the legacy schema remains
 *   intact for backup/import compatibility.
 */
export const productEnglishOnlyPatch = () => ({
  name: 'ora-product-english-only-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/components/ProductCard.tsx')) {
      text = replaceIfPresent(
        text,
        "  const { language, addToCart, setSelectedProduct, startBuyNow, settings } = useStore();",
        "  const { addToCart, setSelectedProduct, startBuyNow, settings } = useStore();",
      );
      text = replaceIfPresent(
        text,
        "          {language === 'si' && product.name_si ? product.name_si : product.name_en}",
        "          {product.name_en}",
      );
      return text === code ? null : { code: text, map: null };
    }

    if (id.endsWith('/src/components/ProductDetailModal.tsx')) {
      text = replaceIfPresent(
        text,
        "        label: language === 'si' && String(detail.label_si || '').trim() ? String(detail.label_si).trim() : String(detail.label_en).trim(),\n        value: language === 'si' && String(detail.value_si || '').trim() ? String(detail.value_si).trim() : String(detail.value_en).trim(),",
        "        label: String(detail.label_en).trim(),\n        value: String(detail.value_en).trim(),",
      );
      text = replaceIfPresent(
        text,
        "  const description = language === 'si' && selectedProduct.description_si ? selectedProduct.description_si : selectedProduct.description_en;",
        "  const description = selectedProduct.description_en;",
      );
      return text === code ? null : { code: text, map: null };
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      // English product name stays; stop triggering automatic Sinhala generation.
      text = replaceIfPresent(
        text,
        "                    onBlur={(e) => { applyProductNameAuto(e.target.value); void autoFillProductSinhala('name', e.target.value); }}",
        "                    onBlur={(e) => applyProductNameAuto(e.target.value)}",
      );

      // Remove the product Sinhala Name field only. Category Sinhala remains untouched.
      text = text.replace(
        /\n\s{16}<div>\n\s{18}<div className=\"mb-1 flex items-center justify-between gap-2\"><label className=\"block text-neutral-300\">Name \(Sinhala සිංහල\)<\/label>[\s\S]*?\n\s{16}<\/div>(?=\n\n\s{16}<div className=\"sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2\">)/,
        '',
      );

      // Description becomes one English-only field.
      text = replaceIfPresent(
        text,
        '                <div className="sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2">',
        '                <div className="sm:col-span-2">',
      );
      text = replaceIfPresent(
        text,
        "                      onBlur={(e)=>void autoFillProductSinhala('description',e.target.value)}\n",
        '',
      );
      text = text.replace(
        /\n\s{18}<label className=\"block text-neutral-300\">\n\s{20}<span className=\"flex items-center justify-between gap-2\"><span>Description \(Sinhala\)<\/span>[\s\S]*?\n\s{18}<\/label>/,
        '',
      );

      // Existing Products admin list should not show a Sinhala subtitle.
      text = replaceIfPresent(
        text,
        '                          <p className="text-[10px] text-neutral-500">{p.name_si}</p>\n',
        '',
      );

      // Item Details editor: English label/value + delete button only.
      text = replaceIfPresent(
        text,
        'lg:grid-cols-[1fr_1.25fr_1fr_1.25fr_auto]',
        'lg:grid-cols-[1fr_1.25fr_auto]',
      );
      text = text.replace(/ onBlur=\{\(\)=>void autoTranslateItemDetail\(detail\.id\)\}/g, '');
      text = text.replace(
        /\n\s{24}<label className=\"text-\[10px\] text-neutral-400\">Detail \(Sinhala\)[\s\S]*?<\/label>/,
        '',
      );
      text = text.replace(
        /\n\s{24}<label className=\"text-\[10px\] text-neutral-400\">Value \(Sinhala\)[\s\S]*?<\/label>/,
        '',
      );
      text = text.replace(
        /<div className=\"flex gap-1 lg:pb-0\.5\"><button type=\"button\" disabled=\{busy[\s\S]*?title=\"Regenerate Sinhala\"><Sparkles className=\"h-3\.5 w-3\.5\"\/><\/button><button type=\"button\"/,
        '<div className="flex gap-1 lg:pb-0.5"><button type="button"',
      );
      text = text.replace(/\n\s{22}\{busy && <p className=\"mt-1 text-\[9px\] font-bold text-cyan-300\">Generating Sinhala…<\/p>\}/, '');
      text = replaceIfPresent(
        text,
        'onClick={()=>addItemDetail(preset.label_en,preset.label_si)}',
        'onClick={()=>addItemDetail(preset.label_en)}',
      );

      // Keep legacy schema fields but never save product-specific Sinhala content again.
      text = replaceIfPresent(
        text,
        '    const finalProductForm = {\n      ...savedProductFields,',
        "    const finalProductForm = {\n      ...savedProductFields,\n      name_si: '',\n      description_si: '',",
      );
      text = replaceIfPresent(
        text,
        "      item_details: (productForm.item_details || []).filter(detail=>String(detail.label_en||'').trim() && String(detail.value_en||'').trim()).map(detail=>({ ...detail, label_en:String(detail.label_en).trim(), label_si:String(detail.label_si||'').trim()||undefined, value_en:String(detail.value_en).trim(), value_si:String(detail.value_si||'').trim()||undefined })),",
        "      item_details: (productForm.item_details || []).filter(detail=>String(detail.label_en||'').trim() && String(detail.value_en||'').trim()).map(detail=>({ id:detail.id, label_en:String(detail.label_en).trim(), value_en:String(detail.value_en).trim() })),",
      );

      return text === code ? null : { code: text, map: null };
    }

    return null;
  },
});
