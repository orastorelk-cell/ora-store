export const pdfPerformancePatch = () => ({
  name: 'ora-pdf-performance-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/lib/pdfGenerator.ts')) return null;
    let text = code;

    const fnMarker = "const resolveInvoiceDistrict = async (order: Order, settings: StoreSettings) => {";
    if (!text.includes('const invoiceDistrictCache = new Map<string,string>();')) {
      if (!text.includes(fnMarker)) throw new Error('[O-RA PDF performance] district resolver marker not found');
      text = text.replace(fnMarker, "const invoiceDistrictCache = new Map<string,string>();\n\n" + fnMarker);
    }

    const existingMarker = "  const existing = String((order as any).district || '').trim();\n  if (existing) return existing;";
    const existingReplacement = "  const existing = String((order as any).district || '').trim();\n  if (existing) return existing;\n  const cacheKey = String(order.order_number || order.id || '').trim();\n  if (cacheKey && invoiceDistrictCache.has(cacheKey)) return invoiceDistrictCache.get(cacheKey) || '';";
    if (!text.includes(existingReplacement)) {
      if (!text.includes(existingMarker)) throw new Error('[O-RA PDF performance] district cache marker not found');
      text = text.replace(existingMarker, existingReplacement);
    }

    const successMarker = "    return String(result?.district || '').trim();";
    const successReplacement = "    const district = String(result?.district || '').trim();\n    if (cacheKey) invoiceDistrictCache.set(cacheKey, district);\n    return district;";
    if (!text.includes(successReplacement)) {
      if (!text.includes(successMarker)) throw new Error('[O-RA PDF performance] district result marker not found');
      text = text.replace(successMarker, successReplacement);
    }

    const a4Marker = "  const invalid=singles.filter(o=>validateInvoiceOrder(o).length>0);\n  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);";
    const a4Replacement = a4Marker + "\n\n  // Prefetch missing districts in parallel. Rendering then reuses the in-memory cache\n  // instead of waiting on one Apps Script round-trip per invoice.\n  await Promise.all(singles.map(o=>resolveInvoiceDistrict(o,settings)));";
    if (!text.includes('await Promise.all(singles.map(o=>resolveInvoiceDistrict(o,settings)))')) {
      if (!text.includes(a4Marker)) throw new Error('[O-RA PDF performance] A4 prefetch marker not found');
      text = text.replace(a4Marker, a4Replacement);
    }

    const batchMarker = "  const invalid=batch.filter(o=>validateInvoiceOrder(o).length>0);\n  if(invalid.length) throw new Error(`${invalid.length} invoice(s) failed validation.`);";
    const batchReplacement = batchMarker + "\n\n  // Parallel network prefetch removes the biggest delay for 20-50 invoice batches.\n  await Promise.all(batch.map(o=>resolveInvoiceDistrict(o,settings)));";
    if (!text.includes('await Promise.all(batch.map(o=>resolveInvoiceDistrict(o,settings)))')) {
      if (!text.includes(batchMarker)) throw new Error('[O-RA PDF performance] batch prefetch marker not found');
      text = text.replace(batchMarker, batchReplacement);
    }

    return text === code ? null : { code: text, map: null };
  },
});
