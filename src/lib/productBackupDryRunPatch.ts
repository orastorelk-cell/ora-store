const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA product backup dry run] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Adds a read-only "Test Import" action beside Product Import.
 * It parses and validates the selected JSON locally and never calls restore/reset/write.
 */
export const productBackupDryRunPatch = () => ({
  name: 'ora-product-backup-dry-run-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    text = replaceRequired(
      text,
      `  const productBackupInputRef = useRef<HTMLInputElement>(null);\n  const [productBackupBusy, setProductBackupBusy] = useState(false);`,
      `  const productBackupInputRef = useRef<HTMLInputElement>(null);\n  const productBackupTestInputRef = useRef<HTMLInputElement>(null);\n  const [productBackupBusy, setProductBackupBusy] = useState(false);`,
      'test input ref',
    );

    const importOpenMarker = `  const openProductBackupImport = () => {`;
    const dryRunFunctions = `  const openProductBackupTest = () => {\n    productBackupTestInputRef.current?.click();\n  };\n\n  const testProductBackup = async (file?: File) => {\n    if (!file) return;\n    setProductBackupBusy(true);\n    try {\n      if (file.size > PRODUCT_BACKUP_MAX_BYTES) throw new Error('Product backup is too large (maximum 15 MB).');\n      const parsed: unknown = JSON.parse(await file.text());\n      const backup = validateProductBackup(parsed);\n      const variantCount = backup.products.reduce((sum, product) => sum + (product.variants || []).length, 0);\n      const imageCount = backup.products.reduce((sum, product) =>\n        sum + (product.images || []).length + (product.variants || []).filter((variant) => Boolean(variant.image)).length, 0);\n      const offerProducts = backup.products.filter((product:any) => product.auto_round_special_offer_enabled === true).length;\n      const decimalOffers = backup.products.reduce((sum, product:any) => {\n        const main = Number(product.auto_round_special_offer_percent);\n        const mainDecimal = Number.isFinite(main) && Math.abs(main - Math.round(main)) > 0.0001 ? 1 : 0;\n        const variantDecimals = (product.variants || []).filter((variant:any) => {\n          const value = Number(variant.auto_round_special_offer_percent);\n          return Number.isFinite(value) && Math.abs(value - Math.round(value)) > 0.0001;\n        }).length;\n        return sum + mainDecimal + variantDecimals;\n      }, 0);\n\n      alert(\`BACKUP TEST PASSED ✅\\n\\nProducts: \${backup.products.length}\\nCategories: \${backup.categories.length}\\nVariants: \${variantCount}\\nImage references: \${imageCount}\\nSpecial Offer ON products: \${offerProducts}\\nDecimal offer settings: \${decimalOffers}\\n\\nNo live product, category, stock or setting was changed.\`);\n    } catch (error:any) {\n      alert(\`BACKUP TEST FAILED ❌\\n\\n\${error?.message || 'This backup could not be validated.'}\\n\\nNo live data was changed.\`);\n    } finally {\n      setProductBackupBusy(false);\n      if (productBackupTestInputRef.current) productBackupTestInputRef.current.value = '';\n    }\n  };\n\n` + importOpenMarker;
    text = replaceRequired(text, importOpenMarker, dryRunFunctions, 'dry-run functions');

    const adminBackupMarker = `              {adminUser?.role === 'admin' && <>\n                <input\n                  ref={productBackupInputRef}`;
    const adminBackupWithTest = `              {adminUser?.role === 'admin' && <>\n                <input\n                  ref={productBackupTestInputRef}\n                  type="file"\n                  accept=".json,application/json"\n                  className="hidden"\n                  onChange={(event) => void testProductBackup(event.target.files?.[0])}\n                />\n                <button\n                  type="button"\n                  onClick={openProductBackupTest}\n                  disabled={productBackupBusy}\n                  className="px-3 py-2 rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-300 font-bold text-[10px] flex items-center gap-1.5 shrink-0 disabled:opacity-40"\n                  title="Safely validate an O-RA backup without resetting or changing live products"\n                >\n                  <ShieldCheck className="w-3.5 h-3.5" />\n                  <span>{productBackupBusy ? 'Checking...' : 'Test Import'}</span>\n                </button>\n                <input\n                  ref={productBackupInputRef}`;
    text = replaceRequired(text, adminBackupMarker, adminBackupWithTest, 'Test Import button');

    return { code: text, map: null };
  },
});
