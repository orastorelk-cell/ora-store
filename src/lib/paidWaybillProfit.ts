import type { Order, Product, ProductVariant, PurchaseOrder, ReturnRecord } from '../types';
import { isReturnedCourierInvoice } from './codPaymentImport';

export const PROFIT_PACKING_COST = 100;
export const PROFIT_PAGE_SIZE = 10;
export type PaymentAmountBasis = 'auto' | 'gross' | 'net';
export type ProfitSource = 'Facebook' | 'TikTok' | 'Other';
export type ProfitPaymentFilter = 'all' | 'cod' | 'online';
export interface PaidProfitSelection { paymentFilter?: ProfitPaymentFilter; fromDate?: string; toDate?: string; }
/** Catalog metadata identifies items and saved combo components; prices come only from Purchasing. */
export type ProfitCatalogProduct = Pick<Product, 'id' | 'sku' | 'name_en' | 'product_type' | 'bundle_components'> & {
  variants?: Array<Pick<ProductVariant, 'id' | 'sku'>>;
};
export interface PurchaseAllocation {
  purchaseId: string;
  reference: string;
  sku: string;
  quantity: number;
  unitCost: number | null;
  costBasis?: 'latest-purchase';
}
export interface ProfitItem {
  name: string;
  sku: string;
  quantity: number;
  unitSale: number | null;
  sales: number | null;
  purchasing: number | null;
  allocations: PurchaseAllocation[];
}
export interface ProfitRow {
  waybill: string;
  outcome?: 'sale' | 'returned';
  orderId?: string;
  paymentKind?: 'cod' | 'online';
  orderNumber?: string;
  systemDate?: string;
  source?: ProfitSource;
  items: ProfitItem[];
  sales: number | null;
  received: number | null;
  purchasing: number | null;
  courier: number | null;
  returnFee?: number | null;
  packing: number | null;
  profit: number | null;
  paymentNote?: string;
  issues: string[];
  eligible: boolean;
}
export interface ProfitDateRange { from: string; to: string; count: number; }
export interface PaidWaybillProfitReport {
  rows: ProfitRow[];
  duplicates: number;
  ranges: Record<'Facebook' | 'TikTok', ProfitDateRange | null>;
  totals: { ready: number; review: number; sales: number; received: number; purchasing: number; courier: number; returnFees: number; packing: number; beforeAds: number };
}

const amount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
export const profitMoney = (value: number) => `Rs. ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const timestamp = (value: unknown) => Date.parse(String(value || ''));
const skuKey = (value: unknown) => String(value || '').trim().toUpperCase();
export const normalizeProfitWaybill = (value: unknown) => String(value ?? '').trim()
  .replace(/^="(.*)"$/, '$1').replace(/^'/, '').replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();

/** The system's creation timestamp, rendered in Sri Lanka; never a lead/payment/dispatch date. */
export const profitSystemDay = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : '';
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
};

/** Accept quoted CSV, TSV, semicolon CSV and a headerless one-waybill-per-line list. */
export function parseProfitWaybillFile(text: string, knownWaybills: string[] = []) {
  const raw = text.replace(/^\uFEFF/, '');
  const first = raw.split(/\r?\n/)[0] || '';
  const delimiter = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const matrix: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const pushRow = () => { row.push(field.trim()); if (row.some(Boolean)) matrix.push(row); row = []; field = ''; };
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') {
      if (quoted && raw[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(field.trim()); field = ''; }
    else if (char === '\n' && !quoted) pushRow();
    else if (char !== '\r') field += char;
  }
  if (quoted) throw new Error('The file has an unfinished quoted field. Export it as CSV again.');
  if (row.length || field) pushRow();
  if (!matrix.length) throw new Error('This file has no waybill numbers.');
  const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = new Set(['waybill', 'waybillno', 'waybillnumber', 'waybillid', 'waybillnum', 'tracking', 'trackingno', 'trackingnumber', 'awb', 'awbno', 'awbnumber', 'airwaybill', 'consignmentno', 'consignmentnumber', 'barcode']);
  let column = matrix[0].findIndex(value => aliases.has(headerKey(value)));
  let hasHeader = column >= 0;
  if (column < 0) {
    const known = new Set(knownWaybills.map(normalizeProfitWaybill));
    let score = 0;
    for (let index = 0; index < Math.max(...matrix.map(cells => cells.length)); index++) {
      const hits = matrix.reduce((sum, cells) => sum + (known.has(normalizeProfitWaybill(cells[index])) ? 1 : 0), 0);
      if (hits > score) { column = index; score = hits; }
    }
    if (column >= 0) hasHeader = !known.has(normalizeProfitWaybill(matrix[0][column]));
    else if (matrix.every(cells => cells.length === 1)) column = 0;
    else hasHeader = true;
  }
  return {
    headers: hasHeader ? matrix[0].map((value, index) => value || `Column ${index + 1}`) : matrix[0].map((_, index) => index === column ? 'Waybill' : `Column ${index + 1}`),
    rows: hasHeader ? matrix.slice(1) : matrix,
    column,
  };
}

/** Import a report selection only; this never creates orders, payments or invoices. */
export function parseProfitWaybillUpload(text: string, knownWaybills: string[] = []) {
  if (text.length > 2_000_000) throw new Error('Choose a waybill CSV / text file smaller than 2 MB.');
  const parsed = parseProfitWaybillFile(text, knownWaybills);
  if (parsed.column < 0) throw new Error('A Waybill / Tracking Number column is required.');
  const waybills = parsed.rows.map(row => normalizeProfitWaybill(row[parsed.column])).filter(Boolean);
  if (!waybills.length || waybills.length > 10000) throw new Error('The file must contain 1 to 10,000 waybills.');
  return waybills;
}

const inventoryKey = (selection: { sku?: string; product_id: string; variant_id?: string }) =>
  skuKey(selection.sku) || `${selection.product_id}::${selection.variant_id || 'base'}`;
const validQuantity = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0;
const excluded = (order: Order) => Boolean(order.is_test_order || order.is_duplicate_order);
const sourceFor = (order: Order): ProfitSource => order.order_source === 'Facebook Ads' ? 'Facebook'
  : order.order_source === 'TikTok Ads' ? 'TikTok' : /^FB-/i.test(order.order_number) ? 'Facebook' : /^TK-/i.test(order.order_number) ? 'TikTok' : 'Other';

export const isReturnedProfitOrder = (order: Order & { return_tracking_waybill?: string }) => isReturnedCourierInvoice(order)
  || Boolean(order.return_sheet_id || order.return_tracking_waybill) || /return/i.test(order.delivery_status || '');

/** Use the same saved payment records as COD Received and paid online orders.
 * A receipt awaiting approval or an advance alone is not a completed sale.
 */
export function savedProfitPaymentKind(order: Order): 'cod' | 'online' | null {
  if (excluded(order) || isReturnedProfitOrder(order) || order.order_status === 'Cancelled' || order.payment_status === 'Refunded') return null;
  if (order.cod_payment_received === true) return 'cod';
  if (order.payment_method === 'Bank Payment' && order.payment_status === 'Paid'
    && order.payment_paid_type !== 'Advance' && order.payment_verification_status !== 'Rejected') return 'online';
  return null;
}

export function selectSavedPaidProfitOrders(orders: Order[], selection: PaidProfitSelection = {}): Order[] {
  const from = selection.fromDate || '', to = selection.toDate || '';
  return orders.filter(order => {
    const kind = savedProfitPaymentKind(order);
    if (!kind || (selection.paymentFilter && selection.paymentFilter !== 'all' && kind !== selection.paymentFilter)) return false;
    if (!from && !to) return true;
    const day = profitSystemDay(order.created_at);
    return Boolean(day && (!from || day >= from) && (!to || day <= to));
  }).sort((a, b) => (profitSystemDay(b.created_at) || '').localeCompare(profitSystemDay(a.created_at) || '')
    || a.order_number.localeCompare(b.order_number, 'en', { numeric: true }) || a.id.localeCompare(b.id));
}

/** Reconstruct FIFO cost from purchased quantities across ALL allocated orders, not just this upload.
 * This ledger is private, read-only report state. It never changes inventory, orders or purchases.
 * Missing units are resolved separately with the latest matching Purchasing price for the report.
 * Catalog buying_price/effective_buying_price are never used.
 */
function purchaseCosts(orders: Order[], purchases: PurchaseOrder[], returns: ReturnRecord[]) {
  type Lot = PurchaseAllocation & { remaining: number };
  type Event = { at: number; rank: number; id: string; run: () => void };
  const lots = new Map<string, Lot[]>();
  const costByOrder = new Map<string, PurchaseAllocation[][]>();
  const events: Event[] = [];
  const addLot = (key: string, allocation: PurchaseAllocation) => {
    const list = lots.get(key) || [];
    list.push({ ...allocation, remaining: allocation.quantity }); lots.set(key, list);
  };
  const consume = (key: string, qty: number): PurchaseAllocation[] => {
    let remaining = qty;
    const allocations: PurchaseAllocation[] = [];
    for (const lot of lots.get(key) || []) {
      if (lot.remaining <= 0 || remaining <= 0) continue;
      const taken = Math.min(lot.remaining, remaining);
      lot.remaining -= taken; remaining -= taken;
      allocations.push({ purchaseId: lot.purchaseId, reference: lot.reference, sku: lot.sku, quantity: taken, unitCost: lot.unitCost });
    }
    if (remaining > 0) allocations.push({ purchaseId: '', reference: 'Missing purchase history', sku: key, quantity: remaining, unitCost: null });
    return allocations;
  };
  for (const purchase of purchases) {
    const at = timestamp(purchase.created_at);
    if (!validQuantity(purchase.quantity_added) || !Number.isFinite(at)) continue;
    const key = inventoryKey({ ...purchase, sku: purchase.variant_sku || purchase.sku });
    events.push({ at, rank: 0, id: purchase.id, run: () => addLot(key, {
      purchaseId: purchase.id, reference: purchase.po_number || purchase.id, sku: key,
      quantity: Number(purchase.quantity_added), unitCost: amount(purchase.unit_buying_price),
    }) });
  }
  const itemsFor = (order: Order) => order.items || [];
  for (const order of orders) {
    if (excluded(order)) continue;
    const journal = (order as Order & { cancel_stock_restore?: { allocated_before?: boolean } }).cancel_stock_restore;
    const cancelled = order.order_status === 'Cancelled';
    const allocated = order.stock_allocated === true || Boolean(journal?.allocated_before)
      || (order.stock_allocated === undefined && ['Packed', 'Shipped', 'Delivered'].includes(order.order_status));
    if (!allocated || (cancelled && !journal?.allocated_before)) continue;
    const at = timestamp(order.stock_allocated_at || order.invoice_generated_at || order.dispatch_scanned_at || order.created_at);
    if (!Number.isFinite(at)) continue;
    events.push({ at, rank: 1, id: `${order.created_at}|${order.order_number}|${order.id}`, run: () => {
      costByOrder.set(order.id, itemsFor(order).map(item => {
        if (!validQuantity(item.quantity)) return [];
        if (item.product_type === 'bundle') {
          if (!item.bundle_components?.length) return [{ purchaseId: '', reference: 'Missing bundle components', sku: item.sku, quantity: Number(item.quantity), unitCost: null }];
          return item.bundle_components.flatMap(component => consume(inventoryKey(component), Number(item.quantity) * Math.max(1, Number(component.quantity_per_bundle || 1))));
        }
        return consume(inventoryKey(item), Number(item.quantity));
      }));
    } });
    if (cancelled && journal?.allocated_before && Number.isFinite(timestamp(order.cancelled_at))) {
      events.push({ at: timestamp(order.cancelled_at), rank: 2, id: order.id, run: () => {
        for (const allocations of costByOrder.get(order.id) || []) for (const allocation of allocations) addLot(allocation.sku, allocation);
      } });
    }
  }
  const orderById = new Map(orders.map(order => [order.id, order]));
  for (const returned of returns) {
    const at = timestamp(returned.checked_at), order = orderById.get(returned.order_id);
    if (!order || excluded(order) || !Number.isFinite(at)) continue;
    events.push({ at, rank: 2, id: returned.id, run: () => {
      const costs = costByOrder.get(order.id);
      if (!costs) return;
      returned.items.forEach(returnItem => {
        let good = Math.max(0, Number(returnItem.good_qty || 0));
        itemsFor(order).forEach((item, index) => {
          if (good <= 0 || inventoryKey(returnItem) !== inventoryKey(item)) return;
          const restored = Math.min(good, item.quantity); good -= restored;
          const original = costs[index] || [];
          const requirements = item.product_type === 'bundle' ? item.bundle_components || [] : [{ ...item, quantity_per_bundle: 1 }];
          for (const selection of requirements) {
            const key = inventoryKey(selection);
            let quantity = restored * Math.max(1, Number(selection.quantity_per_bundle || 1));
            for (const allocation of original.filter(allocation => allocation.sku === key)) {
              const taken = Math.min(quantity, allocation.quantity);
              if (taken > 0) addLot(key, { ...allocation, quantity: taken });
              quantity -= taken;
            }
          }
        });
      });
    } });
  }
  events.sort((a, b) => a.at - b.at || a.rank - b.rank || a.id.localeCompare(b.id, 'en', { numeric: true }));
  events.forEach(event => event.run());
  return costByOrder;
}

/** Price fallback only: it neither consumes stock nor rewrites historical FIFO lots. */
type PurchaseSelection = { sku?: string; main_sku?: string; product_id: string; variant_id?: string };
function profitCatalogLookup(products: readonly ProfitCatalogProduct[]) {
  const byId = new Map(products.map(product => [String(product.id), product]));
  const bySku = new Map<string, ProfitCatalogProduct | null>();
  for (const product of products) for (const raw of [product.sku, ...(product.variants || []).map(variant => variant.sku)]) {
    const code = skuKey(raw);
    if (!code) continue;
    if (!bySku.has(code)) bySku.set(code, product);
    else if (bySku.get(code)?.id !== product.id) bySku.set(code, null);
  }
  return (selection: PurchaseSelection) => bySku.get(skuKey(selection.sku))
    || bySku.get(skuKey(selection.main_sku)) || byId.get(String(selection.product_id));
}
export function mergeProfitPurchaseHistory(local: PurchaseOrder[], saved: PurchaseOrder[]): PurchaseOrder[] {
  // Browser corrections take precedence over older restored records with the same ID.
  const byId = new Map(saved.map(purchase => [String(purchase.id), purchase]));
  for (const purchase of local) byId.set(String(purchase.id), purchase);
  return [...byId.values()];
}

function latestPurchasePrices(purchases: PurchaseOrder[], productFor: ReturnType<typeof profitCatalogLookup>) {
  const latest = new Map<string, PurchaseAllocation>();
  const identities = new Map<string, PurchaseAllocation>();
  const products = new Map<string, PurchaseAllocation>();
  const sorted = [...purchases].filter(purchase => validQuantity(purchase.quantity_added)
    && Number.isFinite(timestamp(purchase.created_at)) && amount(purchase.unit_buying_price) !== null)
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at) || b.id.localeCompare(a.id, 'en', { numeric: true }));
  for (const purchase of sorted) {
    const sku = inventoryKey({ ...purchase, sku: purchase.variant_sku || purchase.sku });
    const productId = productFor({ ...purchase, sku: purchase.variant_sku || purchase.sku })?.id || purchase.product_id;
    const price: PurchaseAllocation = { purchaseId: purchase.id, reference: purchase.po_number || purchase.id, sku,
      quantity: 0, unitCost: amount(purchase.unit_buying_price), costBasis: 'latest-purchase' };
    if (!latest.has(sku)) latest.set(sku, price);
    // Keep exact item/variant matches first, including older saved SKU snapshots.
    if (purchase.product_id && purchase.variant_id) {
      const identity = JSON.stringify([String(purchase.product_id), String(purchase.variant_id)]);
      if (!identities.has(identity)) identities.set(identity, price);
    }
    if (productId && purchase.variant_id) {
      const identity = JSON.stringify([String(productId), String(purchase.variant_id)]);
      if (!identities.has(identity)) identities.set(identity, price);
    }
    // Missing variant history uses the newest Purchasing price for that item type.
    // This is a report price, independent of available stock and order dates.
    if (productId && !products.has(String(productId))) products.set(String(productId), price);
  }
  return (selection: PurchaseSelection) => {
    const productId = productFor(selection)?.id || selection.product_id;
    return latest.get(inventoryKey(selection))
      || (selection.variant_id ? identities.get(JSON.stringify([String(productId), String(selection.variant_id)])) : undefined)
      || (selection.product_id && selection.variant_id ? identities.get(JSON.stringify([String(selection.product_id), String(selection.variant_id)])) : undefined)
      || products.get(String(productId)) || products.get(String(selection.product_id))
      || (selection.main_sku ? latest.get(skuKey(selection.main_sku)) : undefined);
  };
}

function receivedPayment(order: Order, courier: number | null, basis: PaymentAmountBasis) {
  if (basis === 'auto' && order.cod_payment_amount_basis) basis = order.cod_payment_amount_basis;
  if (order.cod_payment_received) {
    const cod = amount(order.cod_payment_amount);
    const advance = order.payment_paid_type === 'Advance' || order.advance_confirmed
      ? amount(order.payment_received_amount) ?? amount(order.advance_amount) ?? 0 : 0;
    if (cod === null) return { received: null, issue: 'Recorded COD amount is missing.' };
    const expected = amount(order.total_amount);
    if (basis === 'net') return courier === null ? { received: null, issue: 'Fardar cost is needed for net remittance.' }
      : { received: round(cod + advance + courier), note: 'Net remittance + Fardar cost + any bank advance' };
    if (basis === 'gross') return { received: round(cod + advance), note: 'Recorded COD collection + any bank advance' };
    if (expected !== null && Math.abs(cod + advance - expected) <= 0.02) return { received: round(cod + advance), note: 'Recorded gross COD collection' };
    if (expected !== null && courier !== null && Math.abs(cod + advance + courier - expected) <= 0.02)
      return { received: round(cod + advance + courier), note: 'Net remittance reconciled with Fardar cost' };
    return { received: null, issue: 'Check COD amount basis: select Gross collection or Net remittance above.' };
  }
  const paid = order.payment_status === 'Paid' && order.payment_paid_type !== 'Advance';
  if (!paid) return { received: null, issue: 'Full payment has not been recorded.' };
  const bank = amount(order.payment_received_amount) ?? amount(order.payment_detected_amount);
  return bank === null ? { received: null, issue: 'Recorded payment amount is missing.' }
    : { received: bank, note: 'Recorded bank payment' };
}

export function buildPaidWaybillProfitReport(input: {
  waybills?: string[]; orders: Order[]; purchases: PurchaseOrder[]; returns?: ReturnRecord[]; paymentBasis?: PaymentAmountBasis;
  selection?: PaidProfitSelection; products?: readonly ProfitCatalogProduct[];
}): PaidWaybillProfitReport {
  const normalized = (input.waybills || []).map(normalizeProfitWaybill).filter(Boolean);
  const waybills = [...new Set(normalized)];
  // In the new Profit Report flow the tab opens BEFORE a waybill CSV is
  // selected. No report rows exist yet, so do NOT replay the entire store's
  // FIFO Purchasing/stock/return journal (a potentially large synchronous
  // operation that previously blocked the browser navigation/render).
  // When the user selects waybills, the original complete FIFO history is
  // still replayed for accurate historical purchasing costs.
  if (input.waybills !== undefined && waybills.length === 0) {
    return {
      rows: [], duplicates: normalized.length,
      ranges: { Facebook: null, TikTok: null },
      totals: { ready: 0, review: 0, sales: 0, received: 0,
        purchasing: 0, courier: 0, returnFees: 0, packing: 0, beforeAds: 0 },
    };
  }
  const costs = purchaseCosts(input.orders, input.purchases, input.returns || []);
  const productFor = profitCatalogLookup(input.products || []);
  const latestPrices = latestPurchasePrices(input.purchases, productFor);
  const byWaybill = new Map<string, Order[]>();
  input.orders.forEach(order => {
    const key = normalizeProfitWaybill(order.waybill_number);
    if (key) byWaybill.set(key, [...(byWaybill.get(key) || []), order]);
  });
  const entries: Array<{ waybill: string; savedOrder?: Order }> = input.waybills !== undefined
    ? waybills.map(waybill => ({ waybill }))
    : selectSavedPaidProfitOrders(input.orders, input.selection).map(savedOrder => ({ waybill: normalizeProfitWaybill(savedOrder.waybill_number), savedOrder }));
  const rows: ProfitRow[] = entries.map(({ waybill, savedOrder }) => {
    const matches = savedOrder ? [savedOrder] : byWaybill.get(waybill) || [];
    const row: ProfitRow = { waybill, outcome: 'sale', items: [], sales: null, received: null, purchasing: null, courier: null, returnFee: 0, packing: null, profit: null, issues: [], eligible: false };
    if (matches.length !== 1) { row.issues.push(matches.length ? 'Waybill belongs to multiple orders. Resolve the duplicate.' : 'Waybill was not found in the system.'); return row; }
    const order = matches[0];
    row.orderId = order.id; row.paymentKind = savedProfitPaymentKind(order) || undefined;
    row.orderNumber = order.order_number; row.source = sourceFor(order); row.systemDate = profitSystemDay(order.created_at);
    if (!waybill) row.issues.push('Waybill has not been assigned to this paid order.');
    else if (savedOrder && (byWaybill.get(waybill)?.length || 0) > 1) row.issues.push('Waybill belongs to multiple orders. Resolve the duplicate.');
    if (!row.systemDate) row.issues.push('System arrival date is missing.');
    if (isReturnedProfitOrder(order) && !excluded(order)) {
      row.outcome = 'returned'; row.eligible = true;
      row.returnFee = amount(order.fardar_return_fee);
      if (row.returnFee === null) row.issues.push('Actual Fardar Return Fee is missing. Upload the payment invoice CSV in COD Payments.');
      row.received = 0; row.sales = 0; row.purchasing = 0; row.courier = 0; row.packing = 0;
      row.paymentNote = 'Returned parcel: no sale revenue, Purchasing or packing deduction. Return Fee is deducted once.';
      row.items = (order.items || []).map(item => ({ name: `${item.product_name}${item.variant_name ? ` - ${item.variant_name}` : ''}`,
        sku: item.sku, quantity: Number(item.quantity), unitSale: amount(item.unit_price), sales: 0, purchasing: 0, allocations: [] }));
      if (!row.issues.length && row.returnFee !== null) row.profit = round(-row.returnFee);
      return row;
    }
    if (order.order_status === 'Cancelled' || order.payment_status === 'Refunded' || excluded(order)) row.issues.push('Cancelled, refunded, duplicate or test order: excluded.');
    else {
      row.eligible = Boolean(savedProfitPaymentKind(order));
      if (!row.eligible) row.issues.push('This waybill has no saved COD Received or full online payment.');
    }
    row.courier = amount(order.fardar_delivery_fee);
    if (row.courier === null) row.issues.push('Actual Fardar delivery cost is missing.');
    const payment = receivedPayment(order, row.courier, input.paymentBasis || 'auto');
    row.received = payment.received; row.paymentNote = payment.note;
    if (payment.issue) row.issues.push(payment.issue);
    row.packing = PROFIT_PACKING_COST;
    row.items = (order.items || []).map((item, index) => {
      const qty = Number(item.quantity), unit = amount(item.unit_price);
      const valid = validQuantity(qty);
      const product = productFor(item);
      // Older snapshots can omit combo metadata. Use the saved system definition,
      // matched by its full item code; never infer components by splitting a CB code.
      const components = item.bundle_components?.length ? item.bundle_components
        : product?.product_type === 'bundle' ? (product.bundle_components || []).map(component => {
          const child = productFor({ product_id: component.product_id });
          const variant = child?.variants?.find(variant => variant.id === component.variant_id);
          return { product_id: component.product_id, variant_id: component.variant_id, sku: variant?.sku || child?.sku || '',
            main_sku: child?.sku, quantity_per_bundle: component.quantity };
        }) : [];
      const required = components.length
        ? components.map(component => ({ ...component, sku: inventoryKey(component), quantity: qty * Math.max(1, Number(component.quantity_per_bundle || 1)) }))
        : [{ ...item, sku: inventoryKey(item), quantity: qty }];
      const original = costs.get(order.id)?.[index];
      const uncovered: PurchaseAllocation[] = valid ? required.map(selection => ({ purchaseId: '', reference: 'Missing purchase history',
        sku: selection.sku, quantity: selection.quantity, unitCost: null })) : [];
      const completeHistory = original?.length && original.every(allocation => allocation.unitCost !== null);
      const allocations = (completeHistory ? original : uncovered).map(allocation => {
        const selection = required.find(selection => selection.sku === allocation.sku);
        const latest = allocation.unitCost === null && selection ? latestPrices(selection) : undefined;
        return latest ? { ...latest, quantity: allocation.quantity } : allocation;
      });
      const purchasing = valid && allocations.length && allocations.every(allocation => allocation.unitCost !== null && validQuantity(allocation.quantity))
        ? amount(round(allocations.reduce((sum, allocation) => sum + allocation.quantity * allocation.unitCost!, 0))) : null;
      const sales = valid ? amount(item.subtotal) ?? (unit === null ? null : round(unit * qty)) : null;
      if (!valid || sales === null || unit === null) row.issues.push(`${item.sku || item.product_name}: sale price / quantity needs review.`);
      if (purchasing === null) row.issues.push(`${item.sku || item.product_name}: no usable Purchasing price was found for this item type.`);
      // A latest-price fallback is an ESTIMATE, not the FIFO cost of an old
      // delivered order. Incomplete historical receipts must not produce
      // a deceptively exact net profit or downloadable "verified" totals.
      if (allocations.some(allocation => allocation.costBasis === 'latest-purchase'))
        row.issues.push(`${item.sku || item.product_name}: historical Purchasing cost is missing; latest buying price is only an estimate. Recover receipts before reporting final profit.`);
      return { name: `${item.product_name}${item.variant_name ? ` - ${item.variant_name}` : ''}`, sku: item.sku, quantity: qty, unitSale: unit, sales, purchasing, allocations };
    });
    if (!row.items.length) row.issues.push('This order has no items.');
    row.sales = row.items.length && row.items.every(item => item.sales !== null) ? round(row.items.reduce((sum, item) => sum + item.sales!, 0)) : null;
    row.purchasing = row.items.length && row.items.every(item => item.purchasing !== null) ? round(row.items.reduce((sum, item) => sum + item.purchasing!, 0)) : null;
    if (!row.issues.length && row.received !== null && row.purchasing !== null && row.courier !== null)
      row.profit = round(row.received - row.purchasing - row.courier - PROFIT_PACKING_COST);
    return row;
  });
  const ranges = { Facebook: null, TikTok: null } as PaidWaybillProfitReport['ranges'];
  for (const source of ['Facebook', 'TikTok'] as const) {
    const dates = rows.filter(row => row.eligible && row.source === source && row.systemDate).map(row => row.systemDate!).sort();
    if (dates.length) ranges[source] = {
      from: input.selection?.fromDate && input.selection?.toDate ? input.selection.fromDate : dates[0],
      to: input.selection?.fromDate && input.selection?.toDate ? input.selection.toDate : dates[dates.length - 1], count: dates.length,
    };
  }
  const ready = rows.filter(row => row.profit !== null);
  const totals = { ready: ready.length, review: rows.length - ready.length,
    sales: round(ready.reduce((sum, row) => sum + row.sales!, 0)), received: round(ready.reduce((sum, row) => sum + row.received!, 0)),
    purchasing: round(ready.reduce((sum, row) => sum + row.purchasing!, 0)), courier: round(ready.reduce((sum, row) => sum + row.courier!, 0)),
    returnFees: round(ready.reduce((sum, row) => sum + (row.returnFee || 0), 0)),
    packing: round(ready.reduce((sum, row) => sum + row.packing!, 0)), beforeAds: round(ready.reduce((sum, row) => sum + row.profit!, 0)) };
  return { rows, duplicates: normalized.length - waybills.length, ranges, totals };
}

/** A fixed order-date period keeps the same advertising budget when late payments arrive.
 * Counts and individual paid orders must not turn the same period into a new expense.
 */
export function profitAdvertisingPeriodKey(report: PaidWaybillProfitReport, selection: PaidProfitSelection = {}) {
  return JSON.stringify({ paymentFilter: selection.paymentFilter || 'all', from: selection.fromDate || '', to: selection.toDate || '',
    ranges: selection.fromDate && selection.toDate ? undefined : ['Facebook', 'TikTok'].map(source => {
      const range = report.ranges[source as 'Facebook' | 'TikTok'];
      return range ? [source, range.from, range.to] : [source];
    }) });
}

export function profitAdvertisingSummary(report: PaidWaybillProfitReport, facebook: string, tiktok: string) {
  const facebookCost = amount(facebook), tiktokCost = amount(tiktok);
  const missing = (['Facebook', 'TikTok'] as const).filter(source => report.ranges[source] && (source === 'Facebook' ? facebookCost : tiktokCost) === null);
  const invalid = (facebook.trim() !== '' && facebookCost === null) || (tiktok.trim() !== '' && tiktokCost === null);
  const total = round((facebookCost ?? 0) + (tiktokCost ?? 0));
  const recordedCostProfit = report.rows.length > 0 && report.totals.review === 0 && !missing.length && !invalid ? round(report.totals.beforeAds - total) : null;
  return { facebook: facebookCost, tiktok: tiktokCost, total, missing, invalid,
    recordedCostProfit, netProfit: recordedCostProfit };
}
