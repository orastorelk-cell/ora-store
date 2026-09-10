const replaceRange = (text: string, startMarker: string, endMarker: string, replacement: string, label: string) => {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start >= 0 ? start : 0);
  if (start < 0 || end < 0) throw new Error(`[O-RA Meta lead CSV] ${label} markers not found`);
  return text.slice(0, start) + replacement + text.slice(end);
};

/**
 * Meta lead compatibility for both direct CSV import and the live Facebook webhook.
 *
 * - Keeps manually typed O-RA Item Code as the only product authority for direct CSV uploads.
 * - Resolves live Facebook form names against the full O-RA catalog SKU before any R-code fallback.
 * - Accepts Meta UTF-16 tab-separated exports as well as normal UTF-8 comma CSV.
 * - Accepts the current Sinhala-only Color / Quantity questions and future
 *   bilingual headers containing Color / Quantity.
 * - Cleans Meta's p:+94... phone prefix and falls WhatsApp back to Phone.
 * - Does not touch order pricing, stock, invoices, Sheet calculations or confirmations.
 */
export const leadMetaCsvCompatibilityPatch = () => ({
  name: 'ora-lead-meta-csv-compatibility-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');

    // LIVE FACEBOOK AUTO LEAD SKU RESOLVER
    // Old logic extracted the first R#### token from the form name. Therefore a
    // combo form such as CB-R0010-R0044 was incorrectly imported as R0010.
    // Resolve the longest exact catalog SKU first, including bundle / combo SKUs.
    if (id.endsWith('/worker/facebookLeadAuto.ts')) {
      let text = code;
      const oldDetector = String.raw`const detectItemCode = (formName: unknown) => {
  const match = String(formName || '').toUpperCase().match(/(?:^|[^A-Z0-9])(R\d{4,})(?=$|[^A-Z0-9])/);
  return match?.[1] || '';
};`;
      const newDetector = String.raw`const detectItemCode = (formName: unknown, products: Product[] = []) => {
  const name = String(formName || '').trim().toUpperCase();
  if (!name) return '';

  // Prefer the actual catalog SKU. Longest-first is important because combo SKUs
  // contain component R-codes (for example CB-R0010-R0044 contains R0010/R0044).
  const catalogCodes = Array.from(new Set(
    products.flatMap((product) => [
      String(product?.sku || '').trim().toUpperCase(),
      ...(product?.variants || []).map((variant) => String(variant?.sku || '').trim().toUpperCase()),
    ]).filter(Boolean)
  )).sort((a, b) => b.length - a.length);

  for (const catalogCode of catalogCodes) {
    if (name === catalogCode) return catalogCode;
    const escaped = catalogCode.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
    if (new RegExp('(?:^|[^A-Z0-9])' + escaped + '(?=$|[^A-Z0-9])').test(name)) return catalogCode;
  }

  // Keep combo-form logging accurate even when the caller does not already have
  // the catalog loaded.
  const combo = name.match(/(?:^|[^A-Z0-9])(CB(?:-R\d{4,}){2,})(?=$|[^A-Z0-9])/);
  if (combo?.[1]) return combo[1];

  // Backward compatibility for the normal single-item Facebook forms.
  const match = name.match(/(?:^|[^A-Z0-9])(R\d{4,})(?=$|[^A-Z0-9])/);
  return match?.[1] || '';
};`;

      if (!text.includes(oldDetector)) {
        if (!text.includes('LIVE FACEBOOK AUTO LEAD SKU RESOLVER')) {
          throw new Error('[O-RA Meta lead] Facebook item-code detector marker not found');
        }
        return null;
      }
      text = text.replace(oldDetector, newDetector);

      const buildMarker = '  const code = detectItemCode(form?.name);';
      if (!text.includes(buildMarker)) throw new Error('[O-RA Meta lead] Facebook build-order code marker not found');
      // Only the first occurrence is inside buildFacebookOrder, where products are loaded.
      text = text.replace(buildMarker, '  const code = detectItemCode(form?.name, products);');

      const oldError = 'does not start with a valid R item code.';
      if (text.includes(oldError)) text = text.replace(oldError, 'does not contain a valid O-RA catalog item code.');

      return { code: text, map: null };
    }

    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;
    const parserStart = "  const parseSourceCsvForDirectImport = (text:string,source:'Facebook Ads'|'TikTok Ads',selectedItemCode:string) => {";
    const handlerStart = "  const handleDirectSourceUpload = (file: File, source: 'Facebook Ads' | 'TikTok Ads') => {";

    const newParser = String.raw`  const parseSourceCsvForDirectImport = (text:string,source:'Facebook Ads'|'TikTok Ads',selectedItemCode:string) => {
    const rawInput = String(text || '');
    // Extra safety: if a browser decoded a UTF-16 Meta export as UTF-8, the text
    // contains NUL bytes between ASCII characters. Strip those NULs so the English
    // header suffixes remain readable instead of making the whole lead row fail.
    const rawText = rawInput.replace(/\u0000/g, '').replace(/\r/g, '').replace(/^\uFFFD+/, '').replace(/^\uFEFF/, '');
    const lines = rawText.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];

    // Meta commonly exports UTF-16 TSV even when the file extension is .csv.
    // The file reader handles encoding below; here we detect tab vs comma safely.
    const firstLine = lines[0] || '';
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const delimiter = tabCount > commaCount ? '\t' : ',';

    const parseLine = (line:string) => {
      const out:string[] = [];
      let cur = '', quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
          else quoted = !quoted;
        } else if (ch === delimiter && !quoted) {
          out.push(cur.trim());
          cur = '';
        } else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };

    const rawHeaders = parseLine(firstLine).map(h => String(h || '').replace(/^\uFEFF/, '').trim());
    const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    const findExact = (names:string[]) => {
      for (const name of names) {
        const index = headers.indexOf(name);
        if (index >= 0) return index;
      }
      return -1;
    };
    const findLoose = (names:string[]) => {
      const exact = findExact(names);
      if (exact >= 0) return exact;
      return headers.findIndex(h => names.some(name => h.includes(name)));
    };
    const findRawLoose = (names:string[]) => rawHeaders.findIndex(header => {
      const value = String(header || '').toLowerCase();
      return names.some(name => value.includes(String(name || '').toLowerCase()));
    });

    const iLead = findExact(['lead_id','leadid','id','instant_form_lead_id','lead_gen_id','leadgen_id']);
    const iCreated = findLoose(['created_time','created_at','lead_created_time','creation_time','submitted_at','date']);
    const iName = findLoose(['full_name','customer_name','name']);
    const iPhone = findLoose(['phone_number','phone','mobile_number','mobile']);
    const iWa = findLoose(['whatsapp_number','whatsapp_phone','whatsapp','wa_number']);
    const iAddr = findLoose(['full_address','customer_address','street_address','address']);
    const iCity = findLoose(['city','town']);
    let iVariant = findLoose(['color','colour','variant','option','selected_color']);
    let iQty = findLoose(['quantity','qty']);
    const iNotes = findLoose(['notes','note','message','comment']);

    // Backward compatibility for the exact Sinhala-only questions already used in
    // the supplied R0003 Meta lead export.
    if (iVariant < 0) iVariant = findRawLoose(['ඔබට_අවශ්‍ය_වර්ණය', 'ඔබට අවශ්‍ය වර්ණය', 'වර්ණය']);
    if (iQty < 0) iQty = findRawLoose(['ඔබට_අවශ්‍ය_ප්‍රමාණය', 'ඔබට අවශ්‍ය ප්‍රමාණය', 'ප්‍රමාණය']);

    const cleanPhone = (value:unknown) => String(value ?? '').trim().replace(/^p:/i, '');
    const cleanChoice = (value:unknown) => String(value ?? '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
    const parseQty = (value:unknown) => {
      const match = String(value ?? '').match(/\d+/);
      // Meta forms that do not ask Quantity should still create one pending order item.
      // A missing / blank / zero quantity therefore defaults safely to 1.
      return match ? Math.max(1, Number(match[0]) || 1) : 1;
    };

    return lines.slice(1).map(line => {
      const c = parseLine(line);
      const phone = iPhone >= 0 ? cleanPhone(c[iPhone]) : '';
      const whatsapp = iWa >= 0 ? cleanPhone(c[iWa]) : phone;
      return {
        platform_lead_id: iLead >= 0 ? String(c[iLead] || '').trim() : undefined,
        lead_created_at: iCreated >= 0 ? String(c[iCreated] || '').trim() : undefined,

        // Never derive the product from Meta form_name / ad_name / CSV code.
        // The manually typed O-RA Lead Item Code remains authoritative.
        item_code: String(selectedItemCode || '').trim(),

        variant_value: iVariant >= 0 ? cleanChoice(c[iVariant]) : undefined,
        quantity: iQty >= 0 ? parseQty(c[iQty]) : 1,
        customer_name: iName >= 0 ? String(c[iName] || '').trim() : '',
        phone,
        whatsapp,
        address: iAddr >= 0 ? String(c[iAddr] || '').trim() : '',
        city: iCity >= 0 ? String(c[iCity] || '').trim() : '',
        order_source: source,
        payment_method: 'COD' as const,
        notes: iNotes >= 0 ? String(c[iNotes] || '').trim() : source + ' raw lead',
        is_confirmed: false,
      };
    }).filter(row => row.platform_lead_id || row.item_code || row.phone || row.customer_name);
  };

`;

    text = replaceRange(text, parserStart, handlerStart, newParser, 'parser');

    // adminDashboardLeadPreviewPatch owns this handler and server-preview makes onload async.
    // Change only the final file read so UTF-16 Meta exports and normal UTF-8 files both work.
    const directStart = text.indexOf(handlerStart);
    const directEnd = text.indexOf('  const csvEscape = (value: unknown) => {', directStart);
    if (directStart < 0 || directEnd < 0) throw new Error('[O-RA Meta lead CSV] direct upload handler markers not found');
    let directChunk = text.slice(directStart, directEnd);

    const oldRead = '    reader.readAsText(file);';
    const newRead = String.raw`    void file.slice(0, 2).arrayBuffer().then((head) => {
      const bytes = new Uint8Array(head);
      const encoding =
        bytes[0] === 0xFF && bytes[1] === 0xFE ? 'utf-16le' :
        bytes[0] === 0xFE && bytes[1] === 0xFF ? 'utf-16be' :
        'utf-8';
      reader.readAsText(file, encoding);
    }).catch(() => reader.readAsText(file));`;
    if (directChunk.includes(oldRead)) directChunk = directChunk.replace(oldRead, newRead);
    else if (!directChunk.includes("bytes[0] === 0xFF")) throw new Error('[O-RA Meta lead CSV] lead file reader marker not found');

    text = text.slice(0, directStart) + directChunk + text.slice(directEnd);
    return { code: text, map: null };
  },
});
