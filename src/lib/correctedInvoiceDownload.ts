import type { Order, StoreSettings } from '../types';
export type CorrectedInvoiceFormat = 'a6' | 'a5' | 'a4-four' | 'a4-two';
export const correctedInvoiceFormats: {id: CorrectedInvoiceFormat; label: string}[] = [
  {id: 'a6', label: 'A6 PDF'}, {id: 'a5', label: 'A5 PDF'}, {id: 'a4-four', label: 'A4 · 4 × A6'}, {id: 'a4-two', label: 'A4 · 2 × A5'},
];
export const downloadCorrectedInvoice = async (order: Order, settings: StoreSettings, format: CorrectedInvoiceFormat) => {
  if (order.item_edit) {
    const snapshot = order.invoice_confirm_snapshot, close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.011;
    const subtotal = order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    if (!snapshot || snapshot.items.length !== order.items.length || snapshot.items.some((item, index) => item.item_code !== order.items[index].sku || item.qty !== order.items[index].quantity) ||
        !close(subtotal, order.subtotal) || !close(subtotal - Number(order.special_offer_discount || 0) + order.delivery_fee + (order.gift_wrap_selected ? Number(order.gift_wrap_fee) : 0), order.total_amount) ||
        !close(Number(snapshot.normal_total) - Number(snapshot.discount) + Number(snapshot.delivery_fee) + Number(snapshot.wrapping_cost), order.total_amount))
      throw new Error('The saved invoice items and amounts do not match. Search the order again before printing.');
  }
  const pdf = await import('./pdfGenerator') as typeof import('./pdfGenerator') & {
    generateA5SingleInvoicesPDF: (orders: Order[], settings: StoreSettings, name?: string) => Promise<void>;
    generateA4TwoUpA5InvoicesPDF: (orders: Order[], settings: StoreSettings, name?: string) => Promise<void>;
  };
  const name = 'O-RA_Corrected_' + String(order.invoice_number || order.order_number).replace(/[^A-Za-z0-9_-]/g, '_');
  if (format === 'a6') return pdf.generateOrderInvoicePDF(order, settings);
  if (format === 'a5') return pdf.generateA5SingleInvoicesPDF([order], settings, name + '_A5.pdf');
  if (format === 'a4-two') return pdf.generateA4TwoUpA5InvoicesPDF([order], settings, name + '_A4-2xA5.pdf');
  return pdf.generateA4InvoicePagesPDF([order], settings, name + '_A4-4xA6.pdf');
};
