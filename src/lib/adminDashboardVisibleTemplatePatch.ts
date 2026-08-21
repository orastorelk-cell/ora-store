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
      throw new Error('[O-RA visible template patch] unified template header block not found');
    }

    const visibleHeaders = `    const headers = [
      'Order ID','Customer Name','Phone Number','WhatsApp Number','Address','City','District',
      'Item Name','Item Code','Variant / Color','Qty','Unit Price (Rs)','Line Total (Rs)','Offer','Final Total (Rs)',
      'Item Action','Order Action','Cancel Reason','Change Item To','Change Preview','Order Time'
    ];`;

    text = text.slice(0, headersStart) + visibleHeaders + text.slice(headersEnd + headersEndMarker.length);

    text = text.replace(
      'Template headers are exactly the same as the order Sheets',
      'Template matches the visible Sheet columns exactly'
    );
    text = text.replace(
      'You can export a completed CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS tab as CSV and upload it directly. Or copy the complete Sheet rows into the common template. Full Sheet columns are accepted; O-RA reads only the fields needed for Confirm / Cancel / item changes.',
      'Hidden technical/audit columns are intentionally left out of this template. Copy the visible cells from CALL CENTER ORDERS / FACEBOOK ORDERS / TIKTOK ORDERS and paste them starting at A2; the column order matches exactly. A full Sheet CSV export with hidden columns is still accepted because O-RA reads fields by header name.'
    );
    text = text.replace(
      'Download Sheet-Matching Common Template',
      'Download Visible-Columns Template'
    );

    return text === code ? null : { code: text, map: null };
  },
});
