import type { Order, PurchaseOrder, ReturnRecord } from '../types';

export const PROFIT_PACKING_COST = 100;
export const PROFIT_PAGE_SIZE = 10;
export type PaymentAmountBasis = 'auto' | 'gross' | 'net';
export type ProfitSource = 'Facebook' | 'TikTok' | 'Other';
export interface PurchaseAllocation {
  purchaseId: string;
  reference: string;
  sku: string;
  quantity: number;
  unitCost: number | null;
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
  orderNumber?: string;
  systemDate?: string;
  source?: ProfitSource;
  items: ProfitItem[];
  sales: number | null;
  received: number | null;
  purchasing: number | null;
  courier: number | null;
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
  totals: { ready: number; review: number; sales: number; received: number; purchasing: number; courier: number; packing: number; beforeAds: number };
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

const inventoryKey = (selection: { sku?: string; product_id: string; variant_id?: string }) =>
  skuKey(selection.sku) || `${selection.product_id}::${selection.variant_id || 'base'}`;
const validQuantity = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0;
const excluded = (order: Order) => Boolean(order.is_test_order || order.is_duplicate_order);
const sourceFor = (order: Order): ProfitSource => order.order_source === 'Facebook Ads' ? 'Facebook'
  : order.order_source === 'TikTok Ads' ? 'TikTok' : /^FB-/i.test(order.order_number) ? 'Facebook' : /^TK-/i.test(order.order_number) ? 'TikTok' : 'Other';

/** Reconstruct FIFO cost from purchased quantities across ALL allocated orders, not just this upload.
 * This ledger is private, read-only report state. It never changes inventory, orders or purchases.
 * Missing purchase units remain unknown; catalog buying_price/effective_buying_price are never used.
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

function receivedPayment(order: Order, courier: number | null, basis: PaymentAmountBasis) {
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
  waybills: string[]; orders: Order[]; purchases: PurchaseOrder[]; returns?: ReturnRecord[]; paymentBasis?: PaymentAmountBasis;
}): PaidWaybillProfitReport {
  const normalized = input.waybills.map(normalizeProfitWaybill).filter(Boolean);
  const waybills = [...new Set(normalized)];
  const costs = purchaseCosts(input.orders, input.purchases, input.returns || []);
  const byWaybill = new Map<string, Order[]>();
  input.orders.forEach(order => {
    const key = normalizeProfitWaybill(order.waybill_number);
    if (key) byWaybill.set(key, [...(byWaybill.get(key) || []), order]);
  });
  const rows: ProfitRow[] = waybills.map(waybill => {
    const matches = byWaybill.get(waybill) || [];
    const row: ProfitRow = { waybill, items: [], sales: null, received: null, purchasing: null, courier: null, packing: null, profit: null, issues: [], eligible: false };
    if (matches.length !== 1) { row.issues.push(matches.length ? 'Waybill belongs to multiple orders. Resolve the duplicate.' : 'Waybill was not found in the system.'); return row; }
    const order = matches[0];
    row.orderNumber = order.order_number; row.source = sourceFor(order); row.systemDate = profitSystemDay(order.created_at);
    if (!row.systemDate) row.issues.push('System arrival date is missing.');
    if (order.order_status === 'Cancelled' || order.payment_status === 'Refunded' || excluded(order)) row.issues.push('Cancelled, refunded, duplicate or test order: excluded.');
    else row.eligible = true;
    row.courier = amount(order.fardar_delivery_fee);
    if (row.courier === null) row.issues.push('Actual Fardar delivery cost is missing.');
    const payment = receivedPayment(order, row.courier, input.paymentBasis || 'auto');
    row.received = payment.received; row.paymentNote = payment.note;
    if (payment.issue) { row.issues.push(payment.issue); row.eligible = false; }
    row.packing = PROFIT_PACKING_COST;
    row.items = (order.items || []).map((item, index) => {
      const qty = Number(item.quantity), unit = amount(item.unit_price);
      const allocations = costs.get(order.id)?.[index] || [];
      const valid = validQuantity(qty);
      const purchasing = valid && allocations.length && allocations.every(allocation => allocation.unitCost !== null)
        ? round(allocations.reduce((sum, allocation) => sum + allocation.quantity * allocation.unitCost!, 0)) : null;
      const sales = valid ? amount(item.subtotal) ?? (unit === null ? null : round(unit * qty)) : null;
      if (!valid || sales === null || unit === null) row.issues.push(`${item.sku || item.product_name}: sale price / quantity needs review.`);
      if (purchasing === null) row.issues.push(`${item.sku || item.product_name}: purchasing history does not cover the allocated quantity.`);
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
    if (dates.length) ranges[source] = { from: dates[0], to: dates[dates.length - 1], count: dates.length };
  }
  const ready = rows.filter(row => row.profit !== null);
  const totals = { ready: ready.length, review: rows.length - ready.length,
    sales: round(ready.reduce((sum, row) => sum + row.sales!, 0)), received: round(ready.reduce((sum, row) => sum + row.received!, 0)),
    purchasing: round(ready.reduce((sum, row) => sum + row.purchasing!, 0)), courier: round(ready.reduce((sum, row) => sum + row.courier!, 0)),
    packing: ready.length * PROFIT_PACKING_COST, beforeAds: round(ready.reduce((sum, row) => sum + row.profit!, 0)) };
  return { rows, duplicates: normalized.length - waybills.length, ranges, totals };
}

export function profitAdvertisingSummary(report: PaidWaybillProfitReport, facebook: string, tiktok: string) {
  const facebookCost = amount(facebook), tiktokCost = amount(tiktok);
  const missing = (['Facebook', 'TikTok'] as const).filter(source => report.ranges[source] && (source === 'Facebook' ? facebookCost : tiktokCost) === null);
  const invalid = (facebook.trim() !== '' && facebookCost === null) || (tiktok.trim() !== '' && tiktokCost === null);
  const total = round((facebookCost ?? 0) + (tiktokCost ?? 0));
  return { facebook: facebookCost, tiktok: tiktokCost, total, missing, invalid,
    netProfit: report.rows.length > 0 && report.totals.review === 0 && !missing.length && !invalid ? round(report.totals.beforeAds - total) : null };
}
