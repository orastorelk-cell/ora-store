export const waybillExistingGarbageCleanupPatch = () => ({
  name: 'ora-waybill-existing-garbage-cleanup-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;

    const oldState = `  const [waybillRecords, setWaybillRecords] = useState<WaybillRecord[]>(() => {
    const saved = localStorage.getItem('ora_waybill_records');
    return saved ? JSON.parse(saved) : [];
  });`;

    const newState = `  const [waybillRecords, setWaybillRecords] = useState<WaybillRecord[]>(() => {
    const saved = localStorage.getItem('ora_waybill_records');
    const parsed = saved ? JSON.parse(saved) : [];
    // Clean up legacy bad imports created by the old all-cells CSV parser.
    // Real courier waybills are numeric/alphanumeric identifiers; plain header
    // words such as Customer Name / City / Order Time are never valid waybills.
    return Array.isArray(parsed)
      ? parsed.filter((row: any) => /[0-9]/.test(String(row?.waybill_number || '').trim()))
      : [];
  });`;

    if (!code.includes(oldState)) throw new Error('[O-RA waybill cleanup] waybill state initializer marker not found');
    const text = code.replace(oldState, newState);
    return { code: text, map: null };
  },
});
