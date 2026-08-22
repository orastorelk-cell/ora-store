export const waybillDuplicateSafetyPatch = () => ({
  name: 'ora-waybill-duplicate-safety-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const oldType = "  importWaybillCsv: (csvText: string, courierName?: string) => { importedCount: number; duplicateCount: number };";
      const newType = "  importWaybillCsv: (csvText: string, courierName?: string) => { importedCount: number; duplicateCount: number; alreadyUsedCount: number; duplicateInFileCount: number; invalidCount: number; alreadyUsedWaybills: string[]; invalidWaybills: string[]; error?: string };";
      if (!text.includes(oldType)) throw new Error('[O-RA waybill safety] importWaybillCsv type marker not found');
      text = text.replace(oldType, newType);

      const startMarker = "  const importWaybillCsv = (csvText: string, courierName = settings.courier_provider || 'Fardar') => {";
      const endMarker = "  const assignNextWaybill = (orderId: string, courierName = settings.courier_provider || 'Fardar'): string | null => {";
      const start = text.indexOf(startMarker);
      const end = text.indexOf(endMarker, start);
      if (start < 0 || end < 0) throw new Error('[O-RA waybill safety] importWaybillCsv function markers not found');

      const replacement = String.raw`  const importWaybillCsv = (csvText: string, courierName = settings.courier_provider || 'Fardar') => {
    const emptyResult = (error?: string) => ({
      importedCount: 0,
      duplicateCount: 0,
      alreadyUsedCount: 0,
      duplicateInFileCount: 0,
      invalidCount: 0,
      alreadyUsedWaybills: [] as string[],
      invalidWaybills: [] as string[],
      ...(error ? { error } : {}),
    });

    const parseCsvLine = (line: string) => {
      const out: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
          else quoted = !quoted;
        } else if (ch === ',' && !quoted) {
          out.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      out.push(cur.trim());
      return out.map((value) => String(value || '').replace(/^\uFEFF/, '').trim());
    };

    const lines = String(csvText || '').split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return emptyResult('CSV is empty. Upload a CSV with a Waybill column.');

    const rows = lines.map(parseCsvLine);
    const normalizeHeader = (value: string) => String(value || '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');

    const waybillHeaders = new Set([
      'waybill', 'waybill no', 'waybill number',
      'tracking', 'tracking no', 'tracking number',
      'awb', 'awb no', 'awb number',
      'airway bill', 'consignment no', 'consignment number'
    ]);
    const header = rows[0].map(normalizeHeader);
    const waybillColumns = header
      .map((name, index) => waybillHeaders.has(name) ? index : -1)
      .filter((index) => index >= 0);

    if (waybillColumns.length === 0) {
      return emptyResult('Waybill column not found. Use one column named Waybill, Waybill Number, AWB, or Tracking Number. Nothing was imported.');
    }
    if (waybillColumns.length > 1) {
      return emptyResult('More than one Waybill/AWB/Tracking column was found. Keep only one waybill column and upload again. Nothing was imported.');
    }

    const waybillIndex = waybillColumns[0];
    const rawIncoming = rows.slice(1)
      .map((row) => String(row[waybillIndex] || '').replace(/^\uFEFF/, '').trim())
      .filter(Boolean);

    if (!rawIncoming.length) {
      return emptyResult('Waybill column is present but it has no waybill numbers underneath it. Nothing was imported.');
    }

    // Courier waybills are identifiers, not ordinary header/text labels. Requiring
    // at least one digit prevents accidental words such as Customer Name / City /
    // Order Time from ever entering the waybill pool.
    const invalidWaybills = rawIncoming.filter((value) => !/[0-9]/.test(value) || value.length > 100);
    const invalidKeys = new Set(invalidWaybills.map((value) => value.toLowerCase()));
    const incoming = rawIncoming.filter((value) => !invalidKeys.has(value.toLowerCase()));

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
      id: 'wb-' + Date.now() + '-' + idx,
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
      details: 'Imported ' + additions.length + '; already uploaded/used ' + alreadyUsedWaybills.length + '; duplicate rows in file ' + duplicateInFileCount + '; invalid rows ' + invalidWaybills.length,
    });
    return {
      importedCount: additions.length,
      duplicateCount,
      alreadyUsedCount: alreadyUsedWaybills.length,
      duplicateInFileCount,
      invalidCount: invalidWaybills.length,
      alreadyUsedWaybills,
      invalidWaybills,
    };
  };

`;

      text = text.slice(0, start) + replacement + text.slice(end);
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const oldMessage = "      setWaybillImportMessage(`${result.importedCount} new waybills imported. ${result.duplicateCount} duplicates skipped.`);";
      const newMessage = String.raw`      if (result.error) {
        setWaybillImportMessage('WAYBILL CSV NOT IMPORTED: ' + result.error);
        return;
      }
      const alreadyUsed = Number(result.alreadyUsedCount || 0);
      const duplicatesInFile = Number(result.duplicateInFileCount || 0);
      const invalid = Number(result.invalidCount || 0);
      const usedPreview = result.alreadyUsedWaybills?.length
        ? ' | Already uploaded / used: ' + result.alreadyUsedWaybills.slice(0, 6).join(', ') + (result.alreadyUsedWaybills.length > 6 ? '…' : '')
        : '';
      const invalidPreview = result.invalidWaybills?.length
        ? ' | Invalid skipped: ' + result.invalidWaybills.slice(0, 6).join(', ') + (result.invalidWaybills.length > 6 ? '…' : '')
        : '';
      setWaybillImportMessage('NEW ' + result.importedCount + ' | ALREADY UPLOADED / USED ' + alreadyUsed + ' | DUPLICATE IN CSV ' + duplicatesInFile + ' | INVALID ' + invalid + usedPreview + invalidPreview);`;
      if (!text.includes(oldMessage)) throw new Error('[O-RA waybill safety] Admin import result marker not found');
      text = text.replace(oldMessage, newMessage);
    }

    return text === code ? null : { code: text, map: null };
  },
});
