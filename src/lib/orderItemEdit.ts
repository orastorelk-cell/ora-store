import type { Order, Product, StoreSettings } from '../types';
import { buildOrderItemSnapshot, normalizedProductType } from './productVariants';
import { canonicalJson } from './confirmCsvSave';

export const ORDER_ITEM_EDIT_API = '/api/orders/edit-items';
export const ORDER_ITEM_EDIT_PREFIX = 'order-item-edit-v1:';
export class OrderItemEditError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const itemEditFail = (message: string, status = 409): never => { throw new OrderItemEditError(message, status); };
export const editMoney = (value: number) => Math.round(value * 100) / 100;
export type EditableItem = {
  product_id: string; variant_id?: string; quantity: number; unit_price: number;
  source_index?: number; bundle_variants?: Record<string, string>;
};
export type ItemEditDraft = { items: EditableItem[]; discount: number; delivery_fee: number; wrapping_fee: number };
export type ItemEditInput = ItemEditDraft & { order_id: string; operation_id: string; expected_identity: string; reason: string };
type Row = Record<string, any>;

// Include lifecycle and payment fields as well as items: a preview must become
// stale if a parcel is handed over or a payment arrives while the editor is open.
export const itemEditIdentity = (order: Row) => canonicalJson(Object.fromEntries([
  'items','subtotal','total_amount','special_offer_discount','delivery_rebalance_qty_offer_amount','delivery_rebalance_offset',
  'delivery_fee','gift_wrap_selected','gift_wrap_fee','invoice_confirm_snapshot','invoice_number','invoice_locked','invoice_generated_at',
  'invoice_pack_batch_id','waybill_number','stock_allocated','stock_status','stock_quantity_correction','order_status','dispatch_status',
  'call_center_status','sheet_confirm_hold','is_duplicate_order','payment_status','payment_received_amount','payment_paid_type',
  'advance_confirmed','cod_payment_received','return_status','return_sheet_id','return_tracking_waybill','cancel_stock_restore',
  'fardar_csv_exported_at','fardar_csv_exported_waybill','item_edit',
].map(key => [key, order[key] ?? null])));

export const savedItemEditMoney = (order: Row) => {
  const snapshot = order.invoice_confirm_snapshot;
  const delivery = Number(snapshot?.delivery_fee ?? order.delivery_fee ?? 0);
  const wrapOn = snapshot?.gift_wrap ? ['yes','true','1','on','add wrap','gift wrap'].includes(String(snapshot.gift_wrap).toLowerCase()) : order.gift_wrap_selected;
  const wrapping = wrapOn ? Number(snapshot?.wrapping_cost ?? order.gift_wrap_fee ?? 0) : 0;
  const subtotal = editMoney((order.items || []).reduce((sum: number, item: Row) => sum + Number(item.unit_price) * Number(item.quantity), 0));
  const final = snapshot && Number(snapshot.normal_total) > 0
    ? editMoney(Number(snapshot.normal_total) - Number(snapshot.discount || 0) + delivery + wrapping)
    : Number(snapshot?.final_total ?? order.total_amount ?? 0);
  return { delivery_fee: delivery, wrapping_fee: wrapping, discount: editMoney(Math.max(0, subtotal + delivery + wrapping - final)) };
};

export const itemEditDraft = (order: Row): ItemEditDraft => ({ ...savedItemEditMoney(order), items: order.items.map((item: Row, source_index: number) => ({
  product_id: item.product_id, ...(item.variant_id ? { variant_id: item.variant_id } : {}), quantity: item.quantity,
  unit_price: item.unit_price, source_index,
  ...(item.product_type === 'bundle' ? {bundle_variants: Object.fromEntries((item.bundle_components || []).map((component: Row, index: number) => [String(index), component.variant_id || '']))} : {}),
})) });

export const parseItemEditInput = (input: any): ItemEditInput => {
  const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 150;
  const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
  if (!input || !id(input.order_id) || !/^[A-Za-z0-9_-]{16,100}$/.test(input.operation_id || '') ||
      typeof input.expected_identity !== 'string' || !input.expected_identity || input.expected_identity.length > 250_000 ||
      typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000 ||
      ![input.discount, input.delivery_fee, input.wrapping_fee].every(money) || !Array.isArray(input.items) || !input.items.length || input.items.length > 100)
    itemEditFail('Enter the current order, valid amounts, 1–100 items and a reason.', 400);
  const items = input.items.map((item: any): EditableItem => {
    if (!item || !id(item.product_id) || item.variant_id !== undefined && !id(item.variant_id) ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1_000_000 || !money(item.unit_price) ||
        item.source_index !== undefined && (!Number.isSafeInteger(item.source_index) || item.source_index < 0 || item.source_index > 99) ||
        item.bundle_variants !== undefined && (!item.bundle_variants || Array.isArray(item.bundle_variants) || typeof item.bundle_variants !== 'object' ||
          Object.entries(item.bundle_variants).some(([key, value]) => !/^\d{1,3}$/.test(key) || value !== '' && !id(value))))
      itemEditFail('Check each item, exact colour, whole quantity and unit price.', 400);
    return { product_id: item.product_id, ...(item.variant_id ? { variant_id: item.variant_id } : {}), quantity: item.quantity, unit_price: item.unit_price,
      ...(item.source_index !== undefined ? {source_index: item.source_index} : {}), ...(item.bundle_variants ? {bundle_variants: item.bundle_variants} : {}) };
  });
  return { order_id: input.order_id, operation_id: input.operation_id, expected_identity: input.expected_identity, reason: input.reason.trim(),
    discount: input.discount, delivery_fee: input.delivery_fee, wrapping_fee: input.wrapping_fee, items };
};

export const editedOrderValues = (order: Row, products: Product[], settings: StoreSettings, draft: ItemEditDraft, at = new Date().toISOString()) => {
  const items = draft.items.map(item => {
    const matches = products.filter(product => product.id === item.product_id);
    if (matches.length !== 1) itemEditFail('An item is missing from the current catalog. Refresh and select its replacement.');
    let product = matches[0];
    const type = normalizedProductType(product), variant = product.variants?.find(value => value.id === item.variant_id);
    if (type === 'variant' ? !variant : !!item.variant_id) itemEditFail('Select the exact colour for ' + product.sku + '.');
    if (type === 'bundle') {
      if (!product.bundle_components?.length) itemEditFail('The combo has no physical components.');
      product = {...product, bundle_components: product.bundle_components!.map((component, index) => {
        const child = products.find(value => value.id === component.product_id), selected = item.bundle_variants?.[String(index)] || component.variant_id;
        if (!child || normalizedProductType(child) === 'bundle' || !Number.isSafeInteger(component.quantity) || component.quantity < 1 ||
          (normalizedProductType(child) === 'variant' ? !child.variants?.some(value => value.id === selected) : !!selected))
          itemEditFail('Choose every exact combo component / colour for ' + product.sku + '.');
        return {...component, ...(selected ? {variant_id: selected} : {})};
      })};
    }
    const source = item.source_index === undefined ? undefined : order.items[item.source_index];
    const same = source?.product_id === item.product_id && String(source?.variant_id || '') === String(item.variant_id || '') &&
      (type !== 'bundle' || canonicalJson(source.bundle_components) === canonicalJson(buildOrderItemSnapshot(product, 1, settings, variant, products).bundle_components));
    const snapshot = same ? {...source} : buildOrderItemSnapshot(product, item.quantity, settings, variant, products);
    // Explicit manual prices are part of the preview. Retain historical buying
    // costs for unchanged selections, and obtain changed items' costs on server.
    const regular = Math.max(item.unit_price, Number(snapshot.regular_unit_price || snapshot.unit_price || 0));
    return {...snapshot, quantity: item.quantity, unit_price: item.unit_price, subtotal: editMoney(item.quantity * item.unit_price),
      regular_unit_price: regular, supplier_offer_discount_per_unit: editMoney(regular - item.unit_price)} as Order['items'][number];
  });
  const subtotal = editMoney(items.reduce((sum, item) => sum + item.subtotal, 0));
  if (!Number.isFinite(subtotal) || subtotal > 100_000_000 || draft.discount > subtotal) itemEditFail('The order discount must be within the items subtotal.', 400);
  const total_amount = editMoney(subtotal - draft.discount + draft.delivery_fee + draft.wrapping_fee);
  if (total_amount > 100_000_000) itemEditFail('The order total is too large.', 400);
  const referenceSubtotal = editMoney(items.reduce((sum, item) => sum + Number(item.regular_unit_price) * item.quantity, 0));
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0), percentage = Math.max(1, Math.min(100, Number(order.invoice_advance_percentage_snapshot ?? settings.advance_percentage ?? 50)));
  const advanceRequired = quantity > Math.max(0, Number(settings.advance_qty_threshold ?? 4));
  return { items, subtotal, delivery_fee: draft.delivery_fee, gift_wrap_selected: draft.wrapping_fee > 0, gift_wrap_fee: draft.wrapping_fee,
    is_advance_required: advanceRequired, advance_amount: advanceRequired ? editMoney(total_amount * percentage / 100) : 0,
    special_offer_discount: draft.discount, delivery_rebalance_qty_offer: false, delivery_rebalance_qty_offer_amount: 0, delivery_rebalance_offset: 0,
    total_amount, invoice_confirm_snapshot: { captured_at: at, city: order.city, district: order.district, normal_total: referenceSubtotal,
      discount: editMoney(referenceSubtotal - subtotal + draft.discount), delivery_fee: draft.delivery_fee, gift_wrap: draft.wrapping_fee > 0 ? 'Yes' : 'No',
      wrapping_cost: draft.wrapping_fee, final_total: total_amount,
      items: items.map(item => ({item_code: item.sku, item_name: item.product_name, variant: item.variant_name || '', qty: item.quantity,
        unit_price: Number(item.regular_unit_price), line_total: editMoney(Number(item.regular_unit_price) * item.quantity), item_action: 'Keep'})) } };
};
