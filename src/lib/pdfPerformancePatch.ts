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

    const fetchMarker = "    const response = await fetch('/api/google-sheets/proxy', {\n      method:'POST',\n      headers:{'Content-Type':'application/json'},\n      body:JSON.stringify({\n        webhookUrl,\n        payload:{ action:'order_details', orderId },\n      }),\n    });";
    const fetchReplacement = "    const controller = new AbortController();\n    const timeout = window.setTimeout(() => controller.abort(), 700);\n    const response = await fetch('/api/google-sheets/proxy', {\n      method:'POST',\n      headers:{'Content-Type':'application/json'},\n      body:JSON.stringify({\n        webhookUrl,\n        payload:{ action:'order_details', orderId },\n      }),\n      signal: controller.signal,\n    }).finally(() => window.clearTimeout(timeout));";
    if (!text.includes(fetchReplacement)) {
      if (!text.includes(fetchMarker)) throw new Error('[O-RA PDF performance] district fetch marker not found');
      text = text.replace(fetchMarker, fetchReplacement);
    }

    const successMarker = "    return String(result?.district || '').trim();";
    const successReplacement = "    const district = String(result?.district || '').trim();\n    if (cacheKey) invoiceDistrictCache.set(cacheKey, district);\n    return district;";
    if (!text.includes(successReplacement)) {
      if (!text.includes(successMarker)) throw new Error('[O-RA PDF performance] district result marker not found');
      text = text.replace(successMarker, successReplacement);
    }

    // Do not make PDF generation wait for a full batch of optional district lookups.
    // Each invoice still attempts the lookup when needed, but it is capped at 700ms
    // and falls back to a blank District on timeout/failure.

    return text === code ? null : { code: text, map: null };
  },
});
