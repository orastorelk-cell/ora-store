import type { StockHistory } from '../types';

export const STAFF_PURCHASE_PREFIX = 'staff-purchase-v1:';
export const STAFF_PURCHASE_API = '/api/admin/staff-purchases';
export type StaffPurchaseItemInput = { product_id: string; variant_id?: string; quantity: number; unit_price: number };
export type StaffPurchaseInput = { operation_id: string; staff_name: string; notes: string; items: StaffPurchaseItemInput[] };
export type StaffPurchaseItem = StaffPurchaseItemInput & { sku: string; product_name: string; variant_name?: string; line_total: number };
export type StaffPurchase = Omit<StaffPurchaseInput, 'items'> & { purchase_number: string; created_at: string; created_by: string; created_by_id: string;
  total_amount: number; items: StaffPurchaseItem[]; stock_history: StockHistory[]; phase: 'complete' };
export class StaffPurchaseError extends Error { constructor(message: string, public status = 400) { super(message); } }
const fail = (message: string): never => { throw new StaffPurchaseError(message); };
const text = (value: unknown, maximum: number, label: string, optional = false): string => {
  if (typeof value !== 'string' || value.trim().length > maximum || !optional && !value.trim()) fail('Enter ' + label + '.');
  return (value as string).trim();
};
export const parseStaffPurchase = (value: any): StaffPurchaseInput => {
  if (!value || typeof value !== 'object' || typeof value.operation_id !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value.operation_id)) fail('Invalid staff purchase operation.');
  const staff_name = text(value.staff_name, 120, 'the staff member name'), notes = text(value.notes ?? '', 2000, 'notes up to 2,000 characters', true);
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > 50) fail('Select 1 to 50 items.');
  const seen = new Set<string>();
  const items: StaffPurchaseItemInput[] = value.items.map((item: any) => {
    const product_id = text(item?.product_id, 150, 'an item'), variant_id = item?.variant_id === undefined ? undefined : text(item.variant_id, 150, 'an exact colour / variant');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1_000_000) fail('Enter a positive whole quantity for each item.');
    if (typeof item.unit_price !== 'number' || !Number.isFinite(item.unit_price) || item.unit_price <= 0 || item.unit_price > 1_000_000_000 ||
        Math.abs(item.unit_price * 100 - Math.round(item.unit_price * 100)) > 0.00001) fail('Enter the staff price per item with up to two decimal places.');
    const key = JSON.stringify([product_id, variant_id || '']);
    if (seen.has(key)) fail('An item / colour appears twice. Combine its quantity on one line.');
    seen.add(key);
    return { product_id, ...(variant_id ? { variant_id } : {}), quantity: item.quantity, unit_price: Math.round(item.unit_price * 100) / 100 };
  });
  if (!Number.isSafeInteger(items.reduce((sum, item) => sum + Math.round(item.unit_price * 100) * item.quantity, 0))) fail('The staff purchase total is too large.');
  return { operation_id: value.operation_id, staff_name, notes, items };
};

// Each operation has its own durable browser record, including across tabs.
const pendingPrefix = (user: string) => 'ora_staff_purchase_pending_v1:' + encodeURIComponent(user) + ':';
export const rememberStaffPurchase = (storage: Storage, user: string, input: StaffPurchaseInput) => {
  const key = pendingPrefix(user) + input.operation_id, serialized = JSON.stringify(input);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error('The purchase could not be retained in this browser. Nothing was submitted.');
};
export const pendingStaffPurchases = (storage: Storage, user: string): StaffPurchaseInput[] => {
  const result: StaffPurchaseInput[] = [], prefix = pendingPrefix(user);
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) result.push(parseStaffPurchase(JSON.parse(storage.getItem(key) || 'null')));
  }
  return result;
};
export const acknowledgeStaffPurchase = (storage: Storage, user: string, input: StaffPurchaseInput) => storage.removeItem(pendingPrefix(user) + input.operation_id);
