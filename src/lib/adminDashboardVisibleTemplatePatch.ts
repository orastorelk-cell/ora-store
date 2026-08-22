export const adminDashboardVisibleTemplatePatch = () => ({
  name: 'ora-admin-visible-template-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (!code.includes('const downloadUnifiedDecisionTemplate = () => {')) return null;

    let text = code;
    const fnStart = text.indexOf('  const downloadUnifiedDecisionTemplate = () => {');
    const headersStart = text.indexOf('    const headers = [', fnStart);
    const headersEndMarker = '    ];';
    const headersEnd = text.indexOf(headersEndMarker, headersStart);
    if (fnStart < 0 || headersStart < 0 || headersEnd < 0) {
      throw new Error('[O-RA full Sheet template patch] unified template header block not found');
    }

    // Exact A:AI header order used by CALL CENTER ORDERS / FACEBOOK ORDERS /
    // TIKTOK ORDERS. Keep this aligned 1:1 with the live Google Sheet so users
    // can copy rows (including hidden columns) and paste them straight into A2.
    const fullSheetHeaders = `    const headers = [
      'Order ID','Customer Name','Phone Number','WhatsApp Number','Address','City','District',
      'Item Name','Main Code','Item Code','Variant / Color','Qty','Unit Price (Rs)','Line Total (Rs)','Offer',
      'Discount (Rs)','Normal Total (Rs)','Delivery Fee (Rs)','Final Total (Rs)','Item Action','Order Action',
      'Cancel Reason','Change Item To','Change Preview','Apply Item Change','Source','Order Time','Lead ID',
      'Imported Status','Last Sync','Original Main Code','Original Variant / Color','Original Item Code',
      'Original Item Name','Original Qty'
    ];`;

    text = text.slice(0, headersStart) + fullSheetHeaders + text.slice(headersEnd + headersEndMarker.length);

    text = text.replace(
      'Template headers are exactly the same as the order Sheets',
      'Template headers match the Google Sheet exactly'
    );
    text = text.replace(
      'Template contains every Google Sheet order header',
      'Template headers match the Google Sheet exactly'
    );
    text = text.replace(
      'Template matches the visible Sheet columns exactly',
      'Template headers match the Google Sheet exactly'
    );
    text = text.replace(
      'You can export a completed CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS tab as CSV and upload it directly. Or copy the complete Sheet rows into the common template. Full Sheet columns are accepted; O-RA reads only the fields needed for Confirm / Cancel / item changes.',
      'The template uses the exact A-to-AI header order from CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS, including hidden columns. Copy selected Sheet rows and paste them starting at A2, save as CSV, then upload.'
    );
    text = text.replace(
      'The template uses the exact full header order from CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS, including hidden technical columns. Copy the selected Sheet rows and paste them starting at A2, then save as CSV and upload. O-RA reads decision fields by header name.',
      'The template uses the exact A-to-AI header order from CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS, including hidden columns. Copy selected Sheet rows and paste them starting at A2, save as CSV, then upload.'
    );
    text = text.replace(
      'Hidden technical/audit columns are intentionally left out of this template. Copy the visible cells from CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS and paste them starting at A2; the column order matches exactly. A full Sheet CSV export with hidden columns is still accepted because O-RA reads fields by header name.',
      'The template uses the exact A-to-AI header order from CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS, including hidden columns. Copy selected Sheet rows and paste them starting at A2, save as CSV, then upload.'
    );
    text = text.replace('Download Visible-Columns Template', 'Download Exact Sheet Template');
    text = text.replace('Download Sheet-Matching Common Template', 'Download Exact Sheet Template');
    text = text.replace('Download Full Sheet-Headers Template', 'Download Exact Sheet Template');

    return text === code ? null : { code: text, map: null };
  },
});
