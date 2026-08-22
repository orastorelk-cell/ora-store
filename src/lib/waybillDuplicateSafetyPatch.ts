export const waybillDuplicateSafetyPatch = () => ({
  name: 'ora-waybill-duplicate-safety-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const oldType = "  importWaybillCsv: (csvText: string, courierName?: string) => { importedCount: number; duplicateCount: number };";
      const newType = "  importWaybillCsv: (csvText: string, courierName?: string) => { importedCount: number; duplicateCount: number; alreadyUsedCount: number; duplicateInFileCount: number; alreadyUsedWaybills: string[] };";
      if (!text.includes(oldType)) throw new Error('[O-RA waybill safety] importWaybillCsv type marker not found');
      text = text.replace(oldType, newType);

      const startMarker = "  const importWaybillCsv = (csvText: string, courierName = settings.courier_provider || 'Fardar') => {";
      const endMarker = "  const assignNextWaybill = (orderId: string, courierName = settings.courier_provider || 'Fardar'): string | null => {";
      const start = text.indexOf(startMarker);
      const end = text.indexOf(endMarker, start);
      if (start < 0 || end < 0) throw new Error('[O-RA waybill safety] importWaybillCsv function markers not found');

      const replacement = String.raw`  const importWaybillCsv = (csvText: string, courierName = settings.courier_provider || 'Fardar') => {
    const tokens = csvText
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map((v) => v.trim().replace(/^\"|\"$/g, ''))
      .filter(Boolean);

    const headerWords = new Set(['waybill', 'waybill_number', 'waybill no', 'tracking', 'tracking_number', 'awb', 'awb_number']);
    const incoming = tokens.filter((t) => !headerWords.has(t.toLowerCase()));

    // De-duplicate repeated rows inside the same CSV first, while preserving
    // the first occurrence for import.
    const seenInUpload = new Set<string>();
    const uniqueIncoming: string[] = [];
    let duplicateInFileCount = 0;
    incoming.forEach((waybill) => {
      const key = waybill.toLowerCase();
      if (seenInUpload.has(key)) {
        duplicateInFileCount += 1;
        return;
      }
      seenInUpload.add(key);
      uniqueIncoming.push(waybill);
    });

    // A number is protected if it is already in the current waybill pool OR is
    // already attached to a current order. This catches Available, Assigned and
    // already-used numbers without keeping a permanent blacklist.
    const poolNumbers = new Set(waybillRecords.map((w) => String(w.waybill_number || '').trim().toLowerCase()).filter(Boolean));
    const orderNumbers = new Set(orders.map((o) => String(o.waybill_number || '').trim().toLowerCase()).filter(Boolean));
    const alreadyUsedWaybills = uniqueIncoming.filter((waybill) => {
      const key = waybill.toLowerCase();
      return poolNumbers.has(key) || orderNumbers.has(key);
    });
    const alreadyUsedKeys = new Set(alreadyUsedWaybills.map((waybill) => waybill.toLowerCase()));
    const fresh = uniqueIncoming.filter((waybill) => !alreadyUsedKeys.has(waybill.toLowerCase()));

    const now = new Date().toISOString();
    const additions: WaybillRecord[] = fresh.map((waybill, idx) => ({
      id: `wb-${Date.now()}-${idx}`,
      waybill_number: waybill,
      courier_name: courierName,
      status: 'Available',
      imported_at: now,
    }));

    if (additions.length) setWaybillRecords((prev) => [...prev, ...additions]);
    const duplicateCount = alreadyUsedWaybills.length + duplicateInFileCount;
    logActivity({
      action: 'Waybill CSV Imported',
      module: 'Delivery',
      target_label: courierName,
      details: `Imported ${additions.length}; already uploaded/used ${alreadyUsedWaybills.length}; duplicate rows in file ${duplicateInFileCount}`,
    });
    return {
      importedCount: additions.length,
      duplicateCount,
      alreadyUsedCount: alreadyUsedWaybills.length,
      duplicateInFileCount,
      alreadyUsedWaybills,
    };
  };

`;

      text = text.slice(0, start) + replacement + text.slice(end);
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const oldMessage = "      setWaybillImportMessage(`${result.importedCount} new waybills imported. ${result.duplicateCount} duplicates skipped.`);";
      const newMessage = String.raw`      const alreadyUsed = Number(result.alreadyUsedCount || 0);
      const duplicatesInFile = Number(result.duplicateInFileCount || 0);
      const usedPreview = result.alreadyUsedWaybills?.length
        ? ` | Already uploaded / used: ${result.alreadyUsedWaybills.slice(0, 6).join(', ')}${result.alreadyUsedWaybills.length > 6 ? '…' : ''}`
        : '';
      setWaybillImportMessage(`NEW ${result.importedCount} | ALREADY UPLOADED / USED ${alreadyUsed} | DUPLICATE IN CSV ${duplicatesInFile}${usedPreview}`);`;
      if (!text.includes(oldMessage)) throw new Error('[O-RA waybill safety] Admin import result marker not found');
      text = text.replace(oldMessage, newMessage);
    }

    return text === code ? null : { code: text, map: null };
  },
});
