import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { buildPaidWaybillProfitReport as buildReport, selectSavedPaidProfitOrders, profitAdvertisingPeriodKey, parseProfitWaybillFile, profitAdvertisingSummary, profitSystemDay, PROFIT_PACKING_COST } from '../src/lib/paidWaybillProfit';
import { createPaidWaybillProfitPdf } from '../src/lib/paidWaybillProfitPdf';
import { profitBatchFixture, profitOrderFixture as order, profitPurchaseFixture as purchase } from './profit-report-fixtures';
import type { Order, ReturnRecord } from '../src/types';

const immutable = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(immutable); }
  return value;
};
const earlier = order();
const later = order({ id: 'order-2', order_number: 'TK-000002', waybill_number: '18160002', order_source: 'TikTok Ads',
  created_at: '2026-09-01T20:00:00Z', stock_allocated_at: '2026-09-02T10:00:00Z',
  items: [{ ...earlier.items[0], quantity: 2, subtotal: 2000 }], subtotal: 2000, total_amount: 2250, cod_payment_amount: 2250 });
const purchases = [purchase(), purchase({ id: 'purchase-2', po_number: 'PO-2026-0002', quantity_added: 5, unit_buying_price: 600, total_cost: 3000, created_at: '2026-09-02T09:00:00Z' })];
const source = immutable({ orders: [earlier, later], purchases });
const before = JSON.stringify(source);
const report = buildReport({ ...source, waybills: [' 18160002 ', '18160002.0'] });
assert.equal(report.duplicates, 1);
assert.equal(report.rows.length, 1);
assert.equal(report.rows[0].purchasing, 1050, 'Non-uploaded orders consume purchase units before the selected order. Catalog buying price must be ignored.');
assert.deepEqual(report.rows[0].items[0].allocations.map(allocation => [allocation.reference, allocation.quantity, allocation.unitCost]), [['PO-2026-0001', 1, 450], ['PO-2026-0002', 1, 600]]);
assert.equal(report.rows[0].packing, PROFIT_PACKING_COST, 'Packing is per order, not per item quantity.');
assert.equal(report.rows[0].profit, 700);
assert.deepEqual(report.ranges.TikTok, { from: '2026-09-02', to: '2026-09-02', count: 1 });
assert.equal(report.ranges.Facebook, null);
assert.equal(profitAdvertisingSummary(report, '', '').netProfit, null);
assert.equal(profitAdvertisingSummary(report, '0', '60').netProfit, 640);
assert.equal(profitAdvertisingSummary(report, '', '0').netProfit, 700);
assert.equal(profitAdvertisingSummary(report, '-1', '0').netProfit, null);
assert.equal(JSON.stringify(source), before, 'Report creation must not mutate orders, purchases, payments, invoice locks or stock fields.');

const netOrder = { ...later, cod_payment_amount: 1850 };
assert.equal(buildReport({ orders: [earlier, netOrder], purchases, waybills: ['18160002'] }).rows[0].profit, 700, 'Net remittance must not have Fardar cost deducted twice.');
const advanced = { ...netOrder, payment_paid_type: 'Advance' as const, advance_confirmed: true, advance_amount: 500, payment_received_amount: 500, cod_payment_amount: 1350 };
assert.equal(buildReport({ orders: [earlier, advanced], purchases, waybills: ['18160002'] }).rows[0].received, 2250);
assert.equal(buildReport({ orders: [earlier, advanced], purchases, waybills: ['18160002'] }).rows[0].profit, 700);
const unresolved = { ...later, cod_payment_amount: 1800 };
assert.equal(buildReport({ orders: [earlier, unresolved], purchases, waybills: ['18160002'] }).rows[0].profit, null);
assert.equal(buildReport({ orders: [earlier, unresolved], purchases, waybills: ['18160002'], paymentBasis: 'gross' }).rows[0].profit, 250);
assert.equal(buildReport({ orders: [earlier, unresolved], purchases, waybills: ['18160002'], paymentBasis: 'net' }).rows[0].profit, 650);

const freeCourier = order({ fardar_delivery_fee: 0 });
assert.equal(buildReport({ orders: [freeCourier], purchases, waybills: ['18160001'] }).rows[0].profit, 700);
const noCourier = order({ fardar_delivery_fee: undefined });
const noCourierReport = buildReport({ orders: [noCourier], purchases, waybills: ['18160001'] });
assert.equal(noCourierReport.rows[0].courier, null, 'Do not substitute the customer delivery fee or internal estimate for the actual Fardar charge.');
assert.equal(noCourierReport.rows[0].profit, null);
assert.equal(buildReport({ orders: [earlier], purchases: [], waybills: ['18160001'] }).rows[0].purchasing, null);
assert.equal(buildReport({ orders: [earlier], purchases: [purchase({ created_at: '2026-10-01T09:00:00Z' })], waybills: ['18160001'] }).rows[0].profit, null, 'Later purchases must not rewrite the cost of older allocations.');
assert.equal(buildReport({ orders: [earlier], purchases: [purchase({ sku: 'R0053-GREEN', variant_sku: 'R0053-GREEN', variant_id: 'green' })], waybills: ['18160001'] }).rows[0].purchasing, null, 'Variants must match exactly.');

const bank = order({ payment_method: 'Bank Payment', payment_paid_type: 'Full', cod_payment_received: false, payment_received_amount: 1250 });
assert.equal(buildReport({ orders: [bank], purchases, waybills: ['18160001'] }).rows[0].profit, 300);
const unpaid = order({ payment_status: 'Pending', cod_payment_received: false, payment_paid_type: 'Advance', payment_received_amount: 500 });
const excludedRows = buildReport({ orders: [unpaid, { ...later, order_status: 'Cancelled' }], purchases, waybills: ['18160001', '18160002', 'NOT-FOUND'] });
assert.equal(excludedRows.rows.length, 3, 'Every uploaded unique waybill is visible, including unmatched and unpaid orders.');
assert.equal(excludedRows.totals.ready, 0);
assert.equal(profitAdvertisingSummary(excludedRows, '0', '0').netProfit, null);
assert.equal(buildReport({ orders: [earlier, { ...earlier, id: 'duplicate' }], purchases, waybills: ['18160001'] }).rows[0].profit, null);

// The normal report derives its rows from saved payment records, without a second upload.
const paymentCases = immutable([
  earlier,
  order({ id: 'online-full', order_number: 'WEB-000002', waybill_number: 'ONLINE-FULL', payment_method: 'Bank Payment', payment_paid_type: 'Full', cod_payment_received: false, payment_received_amount: 1250 }),
  order({ id: 'online-legacy', waybill_number: 'ONLINE-LEGACY', payment_method: 'Bank Payment', payment_paid_type: undefined, cod_payment_received: false, payment_received_amount: 1250 }),
  order({ id: 'cod-not-received', waybill_number: 'UNRECEIVED', cod_payment_received: false }),
  order({ id: 'receipt-only', payment_method: 'Bank Payment', cod_payment_received: false, payment_status: 'Pending', payment_verification_status: 'Auto Check Passed', payment_detected_amount: 1250 }),
  order({ id: 'advance-only', payment_method: 'Bank Payment', cod_payment_received: false, payment_paid_type: 'Advance', payment_received_amount: 500 }),
  order({ id: 'online-rejected', payment_method: 'Bank Payment', cod_payment_received: false, payment_paid_type: 'Full', payment_verification_status: 'Rejected' }),
  order({ id: 'cancelled-paid', order_status: 'Cancelled' }),
  order({ id: 'refunded-paid', payment_status: 'Refunded' }),
  order({ id: 'test-paid', is_test_order: true }),
  order({ id: 'duplicate-paid', is_duplicate_order: true }),
]);
const paymentCasesBefore = JSON.stringify(paymentCases);
assert.deepEqual(new Set(selectSavedPaidProfitOrders(paymentCases).map(row => row.id)), new Set(['order-1', 'online-full', 'online-legacy']));
assert.deepEqual(selectSavedPaidProfitOrders(paymentCases, { paymentFilter: 'cod' }).map(row => row.id), ['order-1']);
assert.equal(selectSavedPaidProfitOrders(paymentCases, { paymentFilter: 'online' }).length, 2);
assert.equal(JSON.stringify(paymentCases), paymentCasesBefore, 'Saved payment selection must not update or sort the system order array.');
const automatic = buildReport({ orders: [earlier, later], purchases });
assert.equal(automatic.rows.length, 2, 'Opening the report includes saved paid orders with no waybill input.');
assert.equal(automatic.totals.beforeAds, 1000);
const scoped = buildReport({ orders: [earlier, later], purchases, selection: { fromDate: '2026-09-02', toDate: '2026-09-02', paymentFilter: 'cod' } });
assert.equal(scoped.rows.length, 1);
assert.equal(scoped.rows[0].orderId, later.id, 'The date filter uses the system arrival day in Sri Lanka, not the payment or lead date.');
assert.equal(scoped.rows[0].purchasing, 1050, 'Other allocated orders still consume purchase lots outside the chosen report date range.');
assert.equal(buildReport({ orders: [earlier, later], purchases, selection: { fromDate: '2026-09-20' } }).rows.length, 0);
const onlineWithoutWaybill = { ...bank, id: 'online-no-waybill', waybill_number: undefined };
const pendingWaybill = buildReport({ orders: [onlineWithoutWaybill], purchases });
assert.equal(pendingWaybill.rows.length, 1, 'A saved paid online order without a waybill remains visible for review.');
assert.equal(pendingWaybill.rows[0].orderId, 'online-no-waybill');
assert(pendingWaybill.rows[0].issues.some(issue => /not been assigned/.test(issue)));
assert.equal(pendingWaybill.rows[0].profit, null);
const automaticDuplicate = buildReport({ orders: [earlier, { ...earlier, id: 'second-paid-order' }], purchases });
assert.equal(automaticDuplicate.rows.length, 2, 'Distinct paid orders sharing a waybill must not be silently merged.');
assert(automaticDuplicate.rows.every(row => row.issues.some(issue => /multiple orders/.test(issue))));
const missingPaymentAmount = { ...later, cod_payment_amount: undefined };
const missingAmountReport = buildReport({ orders: [earlier, missingPaymentAmount], purchases });
assert.equal(missingAmountReport.ranges.TikTok?.from, '2026-09-02', 'Saved paid orders remain in the advertising date range even while missing an amount.');
assert.equal(missingAmountReport.rows.find(row => row.orderId === later.id)?.profit, null);
const newlyPaid = { ...later, cod_payment_received: false };
assert.equal(buildReport({ orders: [earlier, newlyPaid], purchases }).rows.length, 1);
assert.equal(buildReport({ orders: [earlier, { ...newlyPaid, cod_payment_received: true }], purchases }).rows.length, 2, 'A saved COD Received update enters the report automatically.');

const fixedPeriod = { fromDate: '2026-09-01', toDate: '2026-09-12', paymentFilter: 'all' as const };
const beforeLatePayment = buildReport({ orders: [earlier, newlyPaid], purchases, selection: fixedPeriod });
const afterLatePayment = buildReport({ orders: [earlier, { ...newlyPaid, cod_payment_received: true }], purchases, selection: fixedPeriod });
assert.equal(profitAdvertisingPeriodKey(beforeLatePayment, fixedPeriod), profitAdvertisingPeriodKey(afterLatePayment, fixedPeriod), 'Late payments must not create a new advertising expense period.');
assert.equal(afterLatePayment.ranges.TikTok?.from, fixedPeriod.fromDate);
assert.equal(afterLatePayment.ranges.TikTok?.to, fixedPeriod.toDate);
const netBefore = profitAdvertisingSummary(beforeLatePayment, '100', '50').netProfit!;
const netAfter = profitAdvertisingSummary(afterLatePayment, '100', '50').netProfit!;
assert.equal(netAfter - netBefore, 700, 'The updated report adds only the later order profit and uses the same Rs150 advertising total once.');
assert.equal(netAfter, 850);

const bundle = order({ id: 'bundle', waybill_number: 'BUNDLE', items: [{ ...earlier.items[0], sku: 'CB-TEST', product_type: 'bundle', quantity: 2, subtotal: 2000,
  bundle_components: [{ product_id: 'watch', sku: 'R0053-BLACK', variant_id: 'black', product_name: 'Sport Watch', quantity_per_bundle: 2 }] }],
  stock_allocated_at: '2026-09-02T12:00:00Z', total_amount: 2250, cod_payment_amount: 2250 });
const bundleReport = buildReport({ orders: [bundle], purchases, waybills: ['BUNDLE'] });
assert.equal(bundleReport.rows[0].purchasing, 2100, 'Bundle cost uses actual physical components and quantities.');
assert.equal(bundleReport.rows[0].packing, 100);

const returned: ReturnRecord = { id: 'returned', order_id: earlier.id, order_number: earlier.order_number, waybill_number: '18160001', checked_by: 'Test', checked_at: '2026-09-02T09:00:00Z', status: 'Verified',
  items: [{ product_id: 'watch', sku: 'R0053-BLACK', variant_id: 'black', product_name: 'Sport Watch', expected_qty: 1, good_qty: 1, missing_qty: 0, damaged_qty: 0 }] };
const reused = order({ id: 'reused', waybill_number: 'REUSED', stock_allocated_at: '2026-09-03T10:00:00Z' });
assert.equal(buildReport({ orders: [earlier, reused], purchases: [purchase({ quantity_added: 1 })], returns: [returned], waybills: ['REUSED'] }).rows[0].purchasing, 450);
const cancelled = { ...earlier, order_status: 'Cancelled', stock_allocated: false, cancelled_at: '2026-09-02T09:00:00Z', cancel_stock_restore: { allocated_before: true } } as unknown as Order;
assert.equal(buildReport({ orders: [cancelled, reused], purchases: [purchase({ quantity_added: 1 })], waybills: ['REUSED'] }).rows[0].purchasing, 450);

assert.equal(profitSystemDay('2026-09-01T20:00:00Z'), '2026-09-02');
assert.equal(profitSystemDay('2026-02-30'), '');
const singleColumn = parseProfitWaybillFile('18160001\n18160002\n18160003');
assert.equal(singleColumn.rows.length, 3, 'Headerless lists must keep the first waybill.');
const csv = parseProfitWaybillFile('\uFEFFWaybill ID,Description\r\n"18160001","Quoted, item\nwith a second line"\r\n18160002,Other');
assert.equal(csv.column, 0); assert.equal(csv.rows.length, 2); assert(csv.rows[0][1].includes('\n'));
assert.equal(parseProfitWaybillFile('Order;Waybill Number\nFB-1;18160001').column, 1);
assert.equal(parseProfitWaybillFile('Order\tWaybill\nFB-1\t18160001').column, 1);
assert.equal(parseProfitWaybillFile('Customer,Parcel\nSample,18160001', ['18160001']).column, 1);
assert.throws(() => parseProfitWaybillFile('Waybill,Name\n"18160001,broken'), /unfinished/);

const batch = profitBatchFixture();
const batchReport = buildReport(batch);
const savedBatchReport = buildReport({ orders: batch.orders, purchases: batch.purchases });
assert.equal(batchReport.totals.ready, 25);
assert.equal(batchReport.rows.at(-1)?.waybill, batch.waybills.at(-1));
assert.equal(batchReport.totals.beforeAds, 7500);
assert.equal(profitAdvertisingSummary(batchReport, '500', '250').netProfit, 6750);
assert.equal(savedBatchReport.totals.beforeAds, batchReport.totals.beforeAds);
const doc = createPaidWaybillProfitPdf(savedBatchReport, { facebook: '500', tiktok: '250', sourceName: 'Saved COD Received and paid online orders | Synthetic QA', paymentBasis: 'auto', generatedAt: new Date('2026-10-04T17:00:00Z') });
assert(doc.getNumberOfPages() >= 3);
const output = process.argv[2];
if (output) fs.writeFileSync(output, Buffer.from(doc.output('arraybuffer')));

// Render the real workspace component, checking automatic saved-payment rows, page size, full-report totals,
// review states and the guard against calculating from an unfinished server load.
const compiled = await build({ entryPoints: ['src/components/admin/ProfitReportPanel.tsx'], bundle: true, write: false,
  platform: 'node', format: 'esm', packages: 'external', define: { 'import.meta.env': '{}' }, loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' } });
const panelPath = new URL('./.profit-panel-qa.mjs', import.meta.url);
fs.writeFileSync(panelPath, compiled.outputFiles[0].text);
try {
  const { ProfitReportWorkspace } = await import(panelPath.href);
  const initialDraft = { paymentFilter: 'all', fromDate: '', toDate: '', facebook: '500', tiktok: '250', paymentBasis: 'auto' };
  const props = { orders: batch.orders, purchases: batch.purchases, returns: [], ready: true, storageKey: 'synthetic-test', onRefresh: async () => {}, initialDraft };
  const html = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, props));
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)![1];
  assert.equal((tbody.match(/<tr\b/g) || []).length, 10, 'The real order table displays exactly 10 orders per page.');
  assert(html.includes('Page 1 / 3'));
  assert(html.includes('Rs. 6,750.00'), 'Summary must include all 25 orders, not only the current page.');
  assert(!tbody.includes(savedBatchReport.rows[10].waybill));
  assert(html.includes('Download Summary PDF'));
  assert(html.includes('Saved Paid Orders'));
  assert(html.includes('COD Received + Online Paid'));
  assert(!html.includes('Paste waybill numbers') && !html.includes('Upload Paid Waybills'), 'No duplicate waybill entry is needed after payment has been saved.');
  const defaultHtml = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, initialDraft: undefined }));
  assert(defaultHtml.includes('<tbody'), 'The default report shows saved paid orders before any input.');
  const loading = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, ready: false }));
  assert(!loading.includes('<tbody'), 'Do not show stale report totals before saved system data is loaded.');
  const review = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, orders: [onlineWithoutWaybill], purchases }));
  assert(review.includes('Not assigned'));
  assert(review.includes('Waybill has not been assigned to this paid order.'));
  assert(review.includes('Needs Review'));
  const onlineOnly = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, orders: [earlier, { ...bank, id: 'bank-ui', waybill_number: 'BANK-UI' }], initialDraft: { ...initialDraft, paymentFilter: 'online' } }));
  assert(onlineOnly.includes('BANK-UI'));
  assert(!onlineOnly.includes('18160001'));
  const empty = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, orders: [] }));
  assert(empty.includes('No saved paid orders match these filters.'));
  const invalidDates = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, initialDraft: { ...initialDraft, fromDate: '2026-09-12', toDate: '2026-09-01' } }));
  assert(invalidDates.includes('start date must be on or before'));
  assert(!invalidDates.includes('<tbody'));
} finally { fs.unlinkSync(panelPath); }
console.log('PASS: Automatic saved COD Received + paid online selection, no duplicate upload/paste, source and system-date filters, new paid records, missing/duplicate waybills, FIFO Purchasing prices, all-order allocation, variants/bundles, returns/cancellations, gross/net remittance, bank advances, actual courier cost, Rs100/order packing, 10-row pages, full-report advertising totals and multipage PDF. Inputs remain unchanged.');
