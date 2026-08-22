export const leadItemCodeBlankDefaultPatch = () => ({
  name: 'ora-lead-item-code-blank-default-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    const oldState = "  const [selectedLeadItemCode, setSelectedLeadItemCode] = useState(products[0]?.sku || '');";
    const newState = "  const [selectedLeadItemCode, setSelectedLeadItemCode] = useState('');";
    if (!code.includes(oldState)) throw new Error('[O-RA lead item code] default item-code marker not found');

    const text = code.replace(oldState, newState);
    return { code: text, map: null };
  },
});
