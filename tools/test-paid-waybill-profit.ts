import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { buildPaidWaybillProfitReport as buildReport, parseProfitWaybillFile, profitAdvertisingSummary, profitSystemDay, PROFIT_PACKING_COST } from '../src/lib/paidWaybillProfit';
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
assert.equal(batchReport.totals.ready, 25);
assert.equal(batchReport.rows.at(-1)?.waybill, batch.waybills.at(-1));
assert.equal(batchReport.totals.beforeAds, 7500);
assert.equal(profitAdvertisingSummary(batchReport, '500', '250').netProfit, 6750);
const doc = createPaidWaybillProfitPdf(batchReport, { facebook: '500', tiktok: '250', sourceName: 'Synthetic-paid-waybills.csv', paymentBasis: 'auto', generatedAt: new Date('2026-10-04T17:00:00Z') });
assert(doc.getNumberOfPages() >= 3);
const output = process.argv[2];
if (output) fs.writeFileSync(output, Buffer.from(doc.output('arraybuffer')));

// Render the real workspace component, checking page size, full-upload totals,
// review states and the guard against calculating from an unfinished server load.
const compiled = await build({ entryPoints: ['src/components/admin/ProfitReportPanel.tsx'], bundle: true, write: false,
  platform: 'node', format: 'esm', packages: 'external', define: { 'import.meta.env': '{}' }, loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' } });
const panelPath = new URL('./.profit-panel-qa.mjs', import.meta.url);
fs.writeFileSync(panelPath, compiled.outputFiles[0].text);
try {
  const { ProfitReportWorkspace } = await import(panelPath.href);
  const initialDraft = { waybills: batch.waybills, sourceName: 'Synthetic.csv', facebook: '500', tiktok: '250', paymentBasis: 'auto' };
  const props = { orders: batch.orders, purchases: batch.purchases, returns: [], ready: true, storageKey: 'synthetic-test', onRefresh: async () => {}, initialDraft };
  const html = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, props));
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)![1];
  assert.equal((tbody.match(/<tr\b/g) || []).length, 10, 'The real order table displays exactly 10 orders per page.');
  assert(html.includes('Page 1 / 3'));
  assert(html.includes('Rs. 6,750.00'), 'Summary must include all 25 orders, not only the current page.');
  assert(!tbody.includes(batch.waybills[10]));
  assert(html.includes('Download Summary PDF'));
  const loading = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, ready: false }));
  assert(!loading.includes('<tbody'), 'Do not show stale report totals before saved system data is loaded.');
  const review = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, initialDraft: { ...initialDraft, waybills: ['NOT-FOUND'] } }));
  assert(review.includes('Waybill was not found in the system.'));
  assert(review.includes('Needs Review'));
} finally { fs.unlinkSync(panelPath); }
console.log('PASS: FIFO Purchasing prices, all-order allocation, variants/bundles, good returns/cancellations, gross/net remittance, bank advances, actual courier cost, Rs100/order packing, Sri Lanka system arrival dates, duplicates/missing data, full-batch advertising totals and multipage PDF. Inputs remain unchanged.');
