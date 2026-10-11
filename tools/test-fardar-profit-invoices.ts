import assert from 'node:assert/strict';
import fs from 'node:fs';
import { codPaymentEntries, mapCodPaymentHeaders, parseFardarInvoicePayments, prepareCodPaymentUpdate } from '../src/lib/codPaymentImport';
import { parseCsv } from '../src/lib/csv';
import { buildPaidWaybillProfitReport } from '../src/lib/paidWaybillProfit';
import { prepareOrderSnapshotUpdate } from '../src/lib/orderSnapshotUpdate';
import { profitOrderFixture, profitPurchaseFixture } from './profit-report-fixtures';

const header = 'Waybill ID,Order ID,Weight (kg),Client,Order Date,Last Scan Date,Parcel Descp,Delivered By,Delivery Status,Amount,Delivery Fee,COD Commission,Return Fee';
// Financial values verified in the supplied invoices. Order metadata below is a test fixture.
const invoice1 = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : `${header}\n18160373,FB-000082,1,Test,2026-09-07 10:30:03,2026-09-10 08:18:56,Test,Test,Delivered,0,400.00,-0,0.00`;
const invoice2 = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8') : `${header}\n18160489,FB-000235,1,Test,2026-09-12 18:51:12,2026-09-16 09:14:49,Test,Test,Delivered,1800,450.00,0,0.00`;
const parsed1 = parseFardarInvoicePayments(invoice1), parsed2 = parseFardarInvoicePayments(invoice2);
if (process.argv[2] && process.argv[3]) assert.equal(parsed1.length + parsed2.length, 120, 'Every Delivered row in the supplied Fardar invoices is accepted.');
const onlineEntry = parsed1.find(entry => entry.waybill === '18160373')!;
const codEntry = parsed2.find(entry => entry.waybill === '18160489')!;
assert.equal(onlineEntry.amount, 0); assert.equal(onlineEntry.delivery_fee, 400); assert.equal(onlineEntry.amount_basis, 'gross');
assert.equal(codEntry.amount, 1800); assert.equal(codEntry.delivery_fee, 450); assert.equal(codEntry.amount_basis, 'gross');
assert(onlineEntry.received_at?.startsWith('2026-09-10'), 'Use Last Scan Date, not Order Date.');
const baseItem = profitOrderFixture().items[0];
const item = (variant: string) => ({ ...baseItem, product_id: 'qa-lunch-bag', main_sku: 'R0008', sku: `R0008-${variant}`, variant_id: variant, variant_name: variant, unit_price: 900, subtotal: 900 });
const online = profitOrderFixture({ id: 'qa-online', order_number: 'FB-000082', waybill_number: '18160373', stock_allocated: false,
  payment_method: 'Bank Payment', payment_paid_type: 'Full', cod_payment_received: false, cod_payment_amount: undefined,
  payment_received_amount: 1150, total_amount: 1150, fardar_delivery_fee: undefined,
  items: [{ ...item('MAROON'), unit_price: 650, subtotal: 650 }] });
const cod = profitOrderFixture({ id: 'qa-cod', order_number: 'FB-000235', waybill_number: '18160489', stock_allocated: false,
  // Deliberately mismatched saved total proves the invoice's explicit gross basis resolves Auto.
  total_amount: 2300, cod_payment_amount: 1800, fardar_delivery_fee: 450, items: [item('GREY'), item('BLACK')] });
const purchases = ['MAROON', 'GREY', 'BLACK'].map(variant => profitPurchaseFixture({ id: `qa-${variant}`, product_id: 'qa-lunch-bag',
  sku: `R0008-${variant}`, variant_sku: `R0008-${variant}`, variant_id: variant, unit_buying_price: 250 }));
const original = JSON.stringify({ online, cod, purchases, onlineEntry, codEntry });
assert.equal(buildPaidWaybillProfitReport({ orders: [online, cod], purchases }).totals.review, 2);
const savedOnline = prepareCodPaymentUpdate(online, onlineEntry), savedCod = prepareCodPaymentUpdate(cod, codEntry);
assert.equal(savedOnline.payment_received_amount, 1150); assert.equal(savedOnline.payment_method, 'Bank Payment');
assert.equal(savedOnline.payment_paid_type, 'Full'); assert.equal(savedOnline.cod_payment_received, false);
assert.equal(savedOnline.fardar_delivery_fee, 400); assert.equal(savedCod.cod_payment_amount, 1800);
assert.equal(savedCod.cod_payment_amount_basis, 'gross'); assert.equal(savedCod.fardar_delivery_fee, 450);
const report = buildPaidWaybillProfitReport({ orders: [savedOnline, savedCod], purchases });
assert.equal(report.totals.review, 0); assert.equal(report.rows[0].profit, 400); assert.equal(report.rows[1].profit, 750);
assert.equal(report.totals.beforeAds, 1150, 'Gross collection subtracts actual courier cost exactly once.');
for (const [before, after] of [[online, savedOnline], [cod, savedCod]]) {
  for (const field of ['items', 'total_amount', 'stock_allocated', 'invoice_locked', 'invoice_number', 'order_status', 'waybill_number'] as const)
    assert.deepEqual(after[field], before[field], `${field} remains unchanged.`);
  assert.deepEqual(prepareOrderSnapshotUpdate(before, after, []).order, after, 'The real server snapshot guards retain imported financial fields.');
}
assert.equal(JSON.stringify({ online, cod, purchases, onlineEntry, codEntry }), original, 'Source invoices and order fixtures are not mutated.');
assert.deepEqual(prepareCodPaymentUpdate(savedOnline, onlineEntry), savedOnline, 'Online fee imports are idempotent.');
assert.deepEqual(prepareCodPaymentUpdate(savedCod, codEntry), savedCod, 'COD invoice imports are idempotent.');
assert.equal(prepareCodPaymentUpdate(cod, { ...codEntry, amount: 0 }).cod_payment_amount, 0, 'Explicit zero is never replaced with the order total.');
const netCsv = 'Waybill,Payment Status,Net Amount,Delivery Fee\nNET-QA,Paid,1350,450';
const net = parseCsv(netCsv), netEntry = codPaymentEntries(net.rows, mapCodPaymentHeaders(net.headers), net.headers)[0];
assert.equal(netEntry.amount_basis, 'net');
assert.equal(buildPaidWaybillProfitReport({ orders: [prepareCodPaymentUpdate(cod, netEntry)], purchases }).rows[0].profit, 750);
const statuses = parseCsv('Waybill,Payment Status,Amount,Delivery Fee\n1,Unpaid,10,4\n2,Pending,10,4\n3,Not Delivered,10,4\n4,Returned,10,4\n5,Delivered,10,4\n6,Received,10,4');
assert.deepEqual(codPaymentEntries(statuses.rows, mapCodPaymentHeaders(statuses.headers), statuses.headers).map(entry => entry.waybill), ['5', '6']);
assert.throws(() => parseFardarInvoicePayments(invoice1.replace(',400.00,', ',missing,')), /Invalid/);
assert.throws(() => prepareCodPaymentUpdate(cod, { ...codEntry, amount: -1 }), /0 or more/);
const cancelled = { ...cod, order_status: 'Cancelled' as const, payment_status: 'Pending' as const, cod_payment_received: false };
assert.equal(prepareCodPaymentUpdate(cancelled, codEntry).payment_status, 'Pending');
console.log('PASS: Supplied Fardar invoices, Delivered rows, explicit gross/net basis, Rs400 bank-paid profit, Rs750 COD profit, zero COD preservation, invoice/stock guards and idempotent fee imports.');
