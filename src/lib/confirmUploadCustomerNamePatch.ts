const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA confirm customer name] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Confirm CSV customer-name sync.
 *
 * Call Center may correct Customer Name in Google Sheets before exporting the
 * Confirm/Cancel CSV. On Confirm upload, copy that non-empty CSV name back to the
 * stored order so normal and repaired invoices use the corrected customer name.
 * Blank CSV names never erase the existing order name.
 */
export const confirmUploadCustomerNamePatch = () => ({
  name: 'ora-confirm-upload-customer-name-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/context/StoreContext.tsx')) return null;
    let text = code;

    if (!text.includes("const customerNameI=idx(['customer_name','customer','name']);")) {
      const districtIndexMatch = text.match(/^(\s*)const districtI=idx\([^\n]+\);$/m);
      if (!districtIndexMatch) throw new Error('[O-RA confirm customer name] Customer Name CSV column marker not found');
      text = text.replace(
        districtIndexMatch[0],
        districtIndexMatch[0] + "\n" + districtIndexMatch[1] + "const customerNameI=idx(['customer_name','customer','name']);",
      );
    }

    text = replaceRequired(
      text,
      `      const sheetDistrict=csvText(districtI) || String(order.district||'');`,
      `      const sheetDistrict=csvText(districtI) || String(order.district||'');\n      const sheetCustomerName=csvText(customerNameI) || String(order.customer_name||'');`,
      'confirmed customer name value',
    );

    if (!text.includes('customer_name:sheetCustomerName,city:sheetCity,district:sheetDistrict,')) {
      const orderUpdateMarker='city:sheetCity,district:sheetDistrict,';
      if (!text.includes(orderUpdateMarker)) throw new Error('[O-RA confirm customer name] confirmed order customer name update marker not found');
      text = text.replace(
        orderUpdateMarker,
        'customer_name:sheetCustomerName,city:sheetCity,district:sheetDistrict,',
      );
    }

    return { code: text, map: null };
  },
});
