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

    text = replaceRequired(
      text,
      `    const districtI=idx(['district']);`,
      `    const districtI=idx(['district']);\n    const customerNameI=idx(['customer_name','customer','name']);`,
      'Customer Name CSV column',
    );

    text = replaceRequired(
      text,
      `      const sheetDistrict=csvText(districtI) || String(order.district||'');`,
      `      const sheetDistrict=csvText(districtI) || String(order.district||'');\n      const sheetCustomerName=csvText(customerNameI) || String(order.customer_name||'');`,
      'confirmed customer name value',
    );

    text = replaceRequired(
      text,
      `city:sheetCity,district:sheetDistrict,confirm_upload_batch_id:uploadPackingBatchId`,
      `customer_name:sheetCustomerName,city:sheetCity,district:sheetDistrict,confirm_upload_batch_id:uploadPackingBatchId`,
      'confirmed order customer name update',
    );

    return { code: text, map: null };
  },
});
