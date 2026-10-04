import type { Order, PurchaseOrder } from '../src/types';

export const profitPurchaseFixture = (changes: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'purchase-1', po_number: 'PO-2026-0001', supplier_name: 'Synthetic Supplier', product_id: 'watch', product_name: 'Sport Watch', sku: 'R0053-BLACK',
  variant_id: 'black', variant_name: 'Black', variant_sku: 'R0053-BLACK', quantity_added: 2, unit_buying_price: 450, total_cost: 900,
  performed_by: 'Test', created_at: '2026-08-31T09:00:00Z', ...changes,
});

export const profitOrderFixture = (changes: Partial<Order> = {}): Order => ({
  id: 'order-1', order_number: 'FB-000001', customer_name: 'Synthetic Customer', phone: '0770000000', whatsapp: '', address: 'Test address', city: 'Colombo',
  payment_method: 'COD', payment_status: 'Paid', payment_paid_type: 'COD', cod_payment_received: true, cod_payment_amount: 1250, fardar_delivery_fee: 400,
  cod_payment_received_at: '2026-09-20T09:00:00Z', order_status: 'Delivered',
  items: [{ product_id: 'watch', product_name: 'Sport Watch', sku: 'R0053-BLACK', variant_id: 'black', variant_name: 'Black', product_type: 'variant',
    buying_price: 1800, effective_buying_price: 1500, unit_price: 1000, quantity: 1, subtotal: 1000 }],
  subtotal: 1000, delivery_fee: 250, internal_delivery_fee: 900, total_amount: 1250, is_advance_required: false, advance_amount: 0, advance_confirmed: false,
  order_source: 'Facebook Ads', is_synced_google_sheets: true, waybill_number: '18160001', stock_allocated: true, stock_status: 'Allocated',
  stock_allocated_at: '2026-09-01T10:00:00Z', created_at: '2026-09-01T09:00:00Z', platform_lead_created_at: '2026-08-10T09:00:00Z',
  invoice_number: 'INV-LOCKED-1', invoice_locked: true, ...changes,
});

/** No production/customer data: stable fixtures for browser, calculation and PDF checks. */
export const profitBatchFixture = (count = 25) => {
  const purchases = [profitPurchaseFixture({ quantity_added: count + 80, total_cost: (count + 80) * 450 })];
  const orders = Array.from({ length: count }, (_, index) => profitOrderFixture({
    id: `batch-${index}`, order_number: `${index % 2 ? 'TK' : 'FB'}-${String(index + 1).padStart(6, '0')}`, waybill_number: `1816${String(index + 1).padStart(4, '0')}`,
    order_source: index % 2 ? 'TikTok Ads' : 'Facebook Ads',
    created_at: `2026-09-${String(1 + index % 12).padStart(2, '0')}T09:00:00Z`,
    stock_allocated_at: `2026-09-${String(1 + index % 12).padStart(2, '0')}T10:00:00Z`,
  }));
  return { orders, purchases, waybills: orders.map(order => order.waybill_number!) };
};
