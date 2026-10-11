import type { Order } from '../types';
import { autoMapHeader, parseCsv, parseFlexibleDate } from './csv';

export interface CodPaymentEntry {
  waybill: string;
  amount?: number;
  amount_basis?: 'gross' | 'net';
  delivery_fee?: number;
  return_fee?: number;
  status?: 'delivered' | 'returned';
  received_at?: string;
  reference?: string;
  source?: 'Fardar CSV' | 'Manual' | 'System';
}
export interface CodPaymentMapping { waybill: string; status: string; amount: string; deliveryFee: string; returnFee: string; date: string; reference: string; }
const normalizedHeader = (value: string) => value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
export const isFardarInvoiceHeaders = (headers: string[]) => ['waybill id', 'delivery status', 'delivery fee', 'cod commission']
  .every(name => headers.some(value => normalizedHeader(value) === name));
const validAmount = (value: unknown): number | undefined => {
  if (value == null || String(value).trim() === '') return undefined;
  const raw = String(value).trim().replace(/^(?:Rs\.?|LKR)\s*/i, '').replace(/,/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error(`Invalid payment or courier amount: ${String(value).slice(0, 40)}`);
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0) throw new Error('Payment and courier amounts must be 0 or more.');
  return number;
};
export function mapCodPaymentHeaders(headers: string[]): CodPaymentMapping {
  return {
    waybill: autoMapHeader(headers, ['waybill id', 'waybill', 'way bill', 'tracking', 'awb', 'barcode', 'consignment']),
    status: autoMapHeader(headers, ['payment status', 'cod status', 'delivery status', 'status']),
    amount: autoMapHeader(headers, ['cod amount', 'amount', 'collected amount', 'payment amount', 'net amount', 'net remittance']),
    deliveryFee: autoMapHeader(headers, ['delivery fee', 'courier fee', 'shipping fee']),
    returnFee: autoMapHeader(headers, ['return fee', 'return cost', 'return charge']),
    date: autoMapHeader(headers, ['payment date', 'received date', 'settlement date', 'last scan date', 'date']),
    reference: autoMapHeader(headers, ['reference', 'ref', 'transaction', 'settlement id']),
  };
}
export function codPaymentEntries(rows: Record<string, string>[], mapping: CodPaymentMapping, headers: string[]): CodPaymentEntry[] {
  const header = normalizedHeader(mapping.amount);
  const fardarInvoice = isFardarInvoiceHeaders(headers);
  const basis = /\bnet\b|remittance/.test(header) ? 'net' as const
    : /\bgross\b|collected|collection/.test(header) || fardarInvoice && header === 'amount' ? 'gross' as const : undefined;
  return rows.filter(row => String(row[mapping.waybill] || '').trim()).filter(row => {
    if (!mapping.status) return true;
    const status = String(row[mapping.status] || '').trim();
    return Boolean(mapping.returnFee || fardarInvoice) && /^(?:return complete|return completed|returned)$/i.test(status) || !/unpaid|pending|not\s+(?:paid|received|delivered)|undelivered|failed|cancel|return|refund/i.test(status)
      && /\b(?:paid|received|collected|settled|success|successful|remitted|complete|completed|delivered)\b/i.test(status);
  }).map(row => {
    const returned = /^(?:return complete|return completed|returned)$/i.test(String(row[mapping.status] || '').trim());
    const returnFee = mapping.returnFee ? validAmount(row[mapping.returnFee]) : undefined;
    if (returned && returnFee === undefined) throw new Error(`Waybill ${row[mapping.waybill]}: the Return Fee is missing.`);
    return {
    waybill: String(row[mapping.waybill]).trim(),
    status: returned ? 'returned' as const : 'delivered' as const,
    amount: mapping.amount ? validAmount(row[mapping.amount]) : undefined,
    amount_basis: basis,
    delivery_fee: mapping.deliveryFee ? validAmount(row[mapping.deliveryFee]) : undefined,
    ...(returned ? { return_fee: returnFee } : {}),
    received_at: mapping.date ? parseFlexibleDate(row[mapping.date]) || undefined : undefined,
    reference: mapping.reference ? String(row[mapping.reference] || '').trim() || undefined : undefined,
    source: 'Fardar CSV',
  } as CodPaymentEntry; });
}
export function parseFardarInvoicePayments(csv: string): CodPaymentEntry[] {
  const parsed = parseCsv(csv), mapping = mapCodPaymentHeaders(parsed.headers);
  if (!mapping.waybill || !mapping.amount || !mapping.deliveryFee || !mapping.status)
    throw new Error('Choose a Fardar invoice CSV with Waybill, Amount, Delivery Fee and Delivery Status columns.');
  const entries = codPaymentEntries(parsed.rows, mapping, parsed.headers);
  if (!entries.length) throw new Error('This invoice has no delivered payment or completed-return rows.');
  if (entries.some(entry => entry.status === 'returned' ? entry.return_fee === undefined : entry.amount === undefined || entry.delivery_fee === undefined || !entry.amount_basis))
    throw new Error('The invoice needs valid amounts, courier fees and a Gross collection or Net remittance column.');
  return entries;
}

/** Courier invoices never replace an existing bank payment with a zero COD amount. */
export function prepareCodPaymentUpdate(order: Order, entry: CodPaymentEntry, now = new Date().toISOString()): Order {
  if (entry.status === 'returned') {
    const fee = validAmount(entry.return_fee);
    if (fee === undefined) throw new Error(`${order.order_number}: the Return Fee is missing.`);
    return { ...order, fardar_return_fee: fee, fardar_invoice_status: 'Return Complete', fardar_invoice_waybill: entry.waybill,
      fardar_return_fee_recorded_at: entry.received_at || order.fardar_return_fee_recorded_at || now };
  }
  const fee = validAmount(entry.delivery_fee), amount = validAmount(entry.amount);
  if (isReturnedCourierInvoice(order)) throw new Error(`${order.order_number}: a completed return is already recorded. Its earlier delivery payment cannot replace the return.`);
  const updated = { ...order, ...(fee !== undefined ? { fardar_delivery_fee: fee } : {}) };
  if (entry.source === 'Fardar CSV') { updated.fardar_invoice_status = 'Delivered'; updated.fardar_invoice_waybill = entry.waybill; }
  if (order.payment_method !== 'COD') {
    if (fee === undefined) throw new Error(`${order.order_number} is an online-paid order. Import its actual courier fee.`);
    return updated;
  }
  if (order.order_status === 'Cancelled' || order.payment_status === 'Refunded' || order.return_sheet_id || /return/i.test(order.delivery_status || '')) return updated;
  if (entry.source === 'Fardar CSV' && amount === undefined) throw new Error(`${order.order_number}: the CSV payment amount is missing.`);
  const receivedAt = entry.received_at && !Number.isNaN(new Date(entry.received_at).getTime()) ? new Date(entry.received_at).toISOString() : order.cod_payment_received_at || now;
  return { ...updated, payment_status: 'Paid', payment_paid_type: order.payment_paid_type === 'Advance' ? 'Advance' : 'COD',
    cod_payment_received: true, cod_payment_amount: amount ?? Number(order.total_amount || 0),
    cod_payment_amount_basis: entry.amount_basis,
    cod_payment_received_at: receivedAt, cod_payment_source: entry.source || 'Manual',
    cod_payment_reference: String(entry.reference || '').trim() || undefined };
}

export const isReturnedCourierInvoice = (order: Order) => order.fardar_invoice_status === 'Return Complete'
  && String(order.fardar_invoice_waybill || '').trim().toUpperCase() === String(order.waybill_number || '').trim().toUpperCase();

export const canRecordCourierPayments = (user: { role?: string; permissions?: string[] }) => user.role === 'admin'
  || ['cod_payments', 'profit_report'].some(permission => user.permissions?.includes(permission) && !user.permissions?.includes(`level:${permission}:view`));

export function validCodPaymentEntries(value: unknown): value is CodPaymentEntry[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.waybill !== 'string' || !entry.waybill.trim() || entry.waybill.length > 100) return false;
    if (entry.status !== undefined && !['delivered', 'returned'].includes(entry.status)) return false;
    if (entry.amount_basis !== undefined && !['gross', 'net'].includes(entry.amount_basis)) return false;
    if (entry.source !== undefined && !['Fardar CSV', 'Manual', 'System'].includes(entry.source)) return false;
    if (['amount', 'delivery_fee', 'return_fee'].some(field => entry[field] !== undefined && (typeof entry[field] !== 'number' || !Number.isFinite(entry[field]) || entry[field] < 0))) return false;
    if (entry.status === 'returned' && entry.return_fee === undefined) return false;
    if (entry.source === 'Fardar CSV' && entry.status !== 'returned' && (entry.amount === undefined || entry.delivery_fee === undefined || !entry.amount_basis)) return false;
    return (entry.received_at === undefined || typeof entry.received_at === 'string' && Number.isFinite(Date.parse(entry.received_at)))
      && (entry.reference === undefined || typeof entry.reference === 'string' && entry.reference.length <= 500);
  });
}

/** Patch only financial fields on the current server records; repeated invoices replace values. */
export function applyCodPaymentEntries(orders: Order[], entries: CodPaymentEntry[], now = new Date().toISOString()) {
  const normalize = (value: unknown) => String(value || '').trim().replace(/\s+/g, '').toUpperCase();
  const unique = new Map<string, CodPaymentEntry>();
  for (const entry of entries) {
    const key = normalize(entry.waybill), previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error(`Waybill ${entry.waybill} has conflicting invoice rows.`);
    unique.set(key, entry);
  }
  const updatedOrders: Order[] = [], savedOrders: Order[] = [], notFound: string[] = [];
  let unchangedCount = 0, payments = 0, returns = 0;
  for (const [key, entry] of unique) {
    const matches = orders.filter(order => normalize(order.waybill_number) === key);
    if (matches.length > 1) throw new Error(`Waybill ${entry.waybill} belongs to multiple orders.`);
    const order = matches[0];
    if (!order) { notFound.push(entry.waybill); continue; }
    const saved = prepareCodPaymentUpdate(order, entry, now);
    savedOrders.push(saved);
    if (JSON.stringify(saved) === JSON.stringify(order)) unchangedCount++;
    else updatedOrders.push(saved);
    if (entry.status === 'returned') returns++; else payments++;
  }
  return { updatedOrders, orders: savedOrders, updatedCount: updatedOrders.length, unchangedCount, payments, returns, notFound };
}
