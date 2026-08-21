export const adminDashboardLeadServerPreviewPatch = () => ({
  name: 'ora-admin-lead-server-preview-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (!code.includes("const [leadCsvPreview, setLeadCsvPreview]")) return null;

    let text = code;
    const oldReader = `    reader.onload = () => {\n      const parsed = parseSourceCsvForDirectImport(String(reader.result || ''), source, selectedCode);`;
    const newReader = `    reader.onload = async () => {\n      const parsed = parseSourceCsvForDirectImport(String(reader.result || ''), source, selectedCode);`;
    if (text.includes(oldReader)) text = text.replace(oldReader, newReader);

    const oldBlock = `      const existingLeadIds = new Set(\n        orders\n          .filter(o => o.order_source === source && String(o.platform_lead_id || '').trim())\n          .map(o => String(o.platform_lead_id || '').trim().toLowerCase())\n      );`;
    const newBlock = `      // Always check the durable server store, not only this browser's possibly stale\n      // in-memory order list. This makes uploading the same today+yesterday CSV a\n      // second time show the correct ALREADY IN count before anything is sent.\n      let authoritativeOrders: any[] = orders;\n      try {\n        const token = localStorage.getItem('ora_staff_session_token') || '';\n        const response = await fetch('/api/orders', {\n          headers: token ? { Authorization: 'Bearer ' + token } : {},\n          cache: 'no-store',\n        });\n        const data = await response.json().catch(() => ({}));\n        if (response.ok && Array.isArray(data?.orders)) authoritativeOrders = data.orders;\n      } catch {}\n      const existingLeadIds = new Set(\n        authoritativeOrders\n          .filter((o:any) => o.order_source === source && String(o.platform_lead_id || '').trim())\n          .map((o:any) => String(o.platform_lead_id || '').trim().toLowerCase())\n      );`;
    if (!text.includes(oldBlock)) throw new Error('[O-RA lead server preview patch] existing Lead ID block not found');
    text = text.replace(oldBlock, newBlock);

    return { code: text, map: null };
  },
});
