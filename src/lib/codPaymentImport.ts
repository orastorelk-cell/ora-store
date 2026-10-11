import type { Order } from '../types';
import { autoMapHeader, parseCsv, parseFlexibleDate } from './csv';

export interface CodPaymentEntry {
  waybill: string;
  amount?: number;
  amount_basis?: 'gross' | 'net';
  delivery_fee?: number;
  received_at?: string;
  reference?: string;
  source?: 'Fardar CSV' | 'Manual' | 'System';
}
export interface CodPaymentMapping { waybill: string; status: string; amount: string; deliveryFee: string; date: string; reference: string; }
const normalizedHeader = (value: string) => value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
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
    date: autoMapHeader(headers, ['payment date', 'received date', 'settlement date', 'last scan date', 'date']),
    reference: autoMapHeader(headers, ['reference', 'ref', 'transaction', 'settlement id']),
  };
}
export function codPaymentEntries(rows: Record<string, string>[], mapping: CodPaymentMapping, headers: string[]): CodPaymentEntry[] {
  const header = normalizedHeader(mapping.amount);
  const fardarInvoice = ['waybill id', 'delivery status', 'delivery fee', 'cod commission'].every(name => headers.some(value => normalizedHeader(value) === name));
  const basis = /\bnet\b|remittance/.test(header) ? 'net' as const
    : /\bgross\b|collected|collection/.test(header) || fardarInvoice && header === 'amount' ? 'gross' as const : undefined;
  return rows.filter(row => String(row[mapping.waybill] || '').trim()).filter(row => {
    if (!mapping.status) return true;
    const status = String(row[mapping.status] || '').trim();
    return !/unpaid|pending|not\s+(?:paid|received|delivered)|undelivered|failed|cancel|return|refund/i.test(status)
      && /\b(?:paid|received|collected|settled|success|successful|remitted|complete|completed|delivered)\b/i.test(status);
  }).map(row => ({
    waybill: String(row[mapping.waybill]).trim(),
    amount: mapping.amount ? validAmount(row[mapping.amount]) : undefined,
    amount_basis: basis,
    delivery_fee: mapping.deliveryFee ? validAmount(row[mapping.deliveryFee]) : undefined,
    received_at: mapping.date ? parseFlexibleDate(row[mapping.date]) || undefined : undefined,
    reference: mapping.reference ? String(row[mapping.reference] || '').trim() || undefined : undefined,
    source: 'Fardar CSV',
  }));
}
export function parseFardarInvoicePayments(csv: string): CodPaymentEntry[] {
  const parsed = parseCsv(csv), mapping = mapCodPaymentHeaders(parsed.headers);
  if (!mapping.waybill || !mapping.amount || !mapping.deliveryFee || !mapping.status)
    throw new Error('Choose a Fardar invoice CSV with Waybill, Amount, Delivery Fee and Delivery Status columns.');
  const entries = codPaymentEntries(parsed.rows, mapping, parsed.headers);
  if (!entries.length) throw new Error('This invoice has no delivered or paid waybill rows.');
  if (entries.some(entry => entry.amount === undefined || entry.delivery_fee === undefined || !entry.amount_basis))
    throw new Error('The invoice needs valid amounts, courier fees and a Gross collection or Net remittance column.');
  return entries;
}

/** Courier invoices never replace an existing bank payment with a zero COD amount. */
export function prepareCodPaymentUpdate(order: Order, entry: CodPaymentEntry, now = new Date().toISOString()): Order {
  const fee = validAmount(entry.delivery_fee), amount = validAmount(entry.amount);
  const updated = { ...order, ...(fee !== undefined ? { fardar_delivery_fee: fee } : {}) };
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
