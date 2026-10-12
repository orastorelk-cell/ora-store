import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { allocateFacebookAdCosts, emptyFacebookAdLedger, facebookAdCode, facebookAllocatedAdvertisingSummary,
  mergeFacebookAdLedger, parseFacebookAdCostCsv, readFacebookAdLedger, facebookReportingPeriods, FACEBOOK_AD_LEDGER_KEY } from '../src/lib/facebookProfitAds';
import { buildPaidWaybillProfitReport } from '../src/lib/paidWaybillProfit';
import { createPaidWaybillProfitPdf } from '../src/lib/paidWaybillProfitPdf';
import { profitOrderFixture, profitPurchaseFixture } from './profit-report-fixtures';
import { activeData, dataBucket, importRecovery, readDataTable, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';

const header = 'Campaign name,Ad set name,Delivery level,Result type,Results,Amount spent (LKR),Starts,Ends,Reporting starts,Reporting ends';
const csv = header + '\nORA STORE NEW R0003,NEW ORA STORE R0003,adset,Leads (form),9,3850.11,2026-08-28,2026-10-10,2026-10-01,2026-10-08\nnew commercial video,cm ad,adset,Messaging conversations started,13,1028.42,2026-09-22,2026-10-02,2026-10-01,2026-10-08';
const meta = { expectedVersion: 0, fileName: 'synthetic-costs.csv', importedAt: '2026-10-08T14:00:00Z', importedBy: 'Synthetic Admin' };
const rows = parseFacebookAdCostCsv(csv);
const ledger = mergeFacebookAdLedger(emptyFacebookAdLedger(), rows, meta).ledger;
assert.equal(rows[0].from, '2026-10-01', 'Use reporting dates, never campaign Starts/Ends.');
assert.equal(rows[1].code, null); assert.equal(rows[1].leads, 0, 'Commercial messages are not form leads.');
assert.equal(facebookAdCode('ORA STORE NEW CB-R0010-R0044', ['R0010', 'R0044']), 'CB-R0010-R0044');
assert.equal(facebookAdCode('ORA STORE NEW R0003-BLUE', ['R0003', 'R0003-BLUE']), 'R0003-BLUE');
assert.throws(() => facebookAdCode('R0003 R0053'), /More than one/);
assert.throws(() => parseFacebookAdCostCsv(csv.replace('Amount spent (LKR)', 'Amount spent (USD)')), /Amount spent/);
assert.throws(() => parseFacebookAdCostCsv(csv.replace('Leads (form)', 'Link clicks')), /form-lead/);
assert.throws(() => parseFacebookAdCostCsv(csv.replace('3850.11', '-1')), /number of 0/);
assert.throws(() => parseFacebookAdCostCsv(csv.replace('2026-10-08', '2026-02-30')), /valid dates/);
assert.throws(() => parseFacebookAdCostCsv(csv + '\n"broken'), /unfinished/);
assert.throws(() => readFacebookAdLedger({ ...ledger, rows: [{ ...ledger.rows[0], from: '', to: '' }] }), /needs review/);

const promotionCsv = header + '\nBoosted post,Post promotion,adset,Messaging conversations started,4,492.72,2026-09-11,2026-10-16,2026-08-26,2026-09-22'
  + '\nPromoting https://orastore.com.lk/?product=example,Link promotion,adset,Landing page views,27,289.63,2026-09-11,2026-10-16,2026-08-26,2026-09-22'
  + '\nORA STORE NEW R0045,NEW ORA STORE R0045,adset,,,219.15,2026-09-11,2026-10-16,2026-08-26,2026-09-22';
const promotionRows = parseFacebookAdCostCsv(promotionCsv);
assert.deepEqual(promotionRows.map(row => [row.code, row.leads]), [[null, 0], [null, 0], ['R0045', 0]], 'Code-free promotion results never become item leads; blank item results mean zero leads.');
assert.equal(promotionRows.reduce((sum, row) => Math.round((sum + row.spend) * 100) / 100, 0), 1001.5, 'Every promotion and zero-result expense is retained.');
assert.throws(() => parseFacebookAdCostCsv(promotionCsv.replace('Messaging conversations started', 'Leads (form)')), /no catalog code/, 'An unnamed form-lead ad still needs its real item / complete CB code.');
assert.throws(() => parseFacebookAdCostCsv(promotionCsv.replace('adset,,,219.15', 'adset,,1,219.15')), /form-lead/, 'Positive item results without a result type cannot be assumed to be leads.');
assert.throws(() => parseFacebookAdCostCsv(promotionCsv.replace('adset,,,219.15', 'adset,Link clicks,0,219.15')), /form-lead/, 'A non-lead item campaign cannot be treated as a form-lead campaign even with zero results.');

if (process.argv[5]) {
  const augustCsv = fs.readFileSync(process.argv[5], 'utf8');
  const augustRows = parseFacebookAdCostCsv(augustCsv);
  assert.equal(augustRows.length, 23);
  assert.equal(Math.round(augustRows.reduce((sum, row) => sum + row.spend, 0) * 100), 6068810);
  assert.equal(Math.round(augustRows.filter(row => !row.code).reduce((sum, row) => sum + row.spend, 0) * 100), 435270);
  assert(augustRows.every(row => row.from === '2026-08-26' && row.to === '2026-09-22'));
  assert.equal(augustRows.find(row => row.code === 'CB-R0010-R0044')?.leads, 22);
  assert.equal(augustRows.find(row => row.code === 'R0045')?.leads, 0);
  const augustLedger = mergeFacebookAdLedger(emptyFacebookAdLedger(), augustRows, { ...meta, fileName: 'August-September.csv' }).ledger;
  assert.equal(mergeFacebookAdLedger(augustLedger, augustRows, meta).ledger, augustLedger, 'Re-uploading the supplied August / September report is idempotent.');
}

assert.equal(mergeFacebookAdLedger(ledger, rows, meta).ledger, ledger, 'Lost-response retries with an old version are idempotent.');
assert.throws(() => mergeFacebookAdLedger(ledger, [{ ...rows[0], spend: 4000 }], meta), /another session/);
const revised = mergeFacebookAdLedger(ledger, [{ ...rows[0], spend: 4000 }], { ...meta, expectedVersion: 1 }).ledger;
assert.equal(revised.rows.length, 2); assert.equal(revised.rows.find(row => row.code)?.spend, 4000, 'Corrected same-period spend replaces rather than adds.');
assert.throws(() => mergeFacebookAdLedger(ledger, [{ ...rows[0], from: '2026-10-04', to: '2026-10-12' }], { ...meta, expectedVersion: 1 }), /Overlapping/);
assert.throws(() => mergeFacebookAdLedger(ledger, [{ ...rows[0], adSet: 'Different ad set', from: '2026-10-04' }], { ...meta, expectedVersion: 1 }), /Overlapping/);
assert.equal(mergeFacebookAdLedger(ledger, [{ ...rows[0], level: 'campaign' }], { ...meta, expectedVersion: 1 }).ledger.rows.length, 2, 'Changing the export level replaces the cost instead of stacking reporting levels.');
const nextPeriod = mergeFacebookAdLedger(ledger, [{ ...rows[0], from: '2026-10-09', to: '2026-10-15' }], { ...meta, expectedVersion: 1 }).ledger;
assert.equal(nextPeriod.rows.length, 3);
const anotherAd = mergeFacebookAdLedger(ledger, [rows[0], { ...rows[0], adSet: 'Second R0003 ad set', spend: 900, leads: 3 }], { ...meta, expectedVersion: 1 }).ledger;
assert.equal(anotherAd.rows.length, 3, 'Different ads for the same exact cohort are pooled, not lost.');
const renamed = mergeFacebookAdLedger(ledger, [{ ...rows[0], campaign: 'RENAMED R0003', adSet: 'RENAMED SET R0003' }], { ...meta, expectedVersion: 1 }).ledger;
assert.equal(renamed.rows.length, 2, 'Names-only exports replace the code/period snapshot even after an ad set is renamed.');
assert.equal(renamed.rows.filter(row => row.code === 'R0003').reduce((sum, row) => sum + row.spend, 0), 3850.11);
assert.equal(mergeFacebookAdLedger(anotherAd, [rows[0]], { ...meta, expectedVersion: 2 }).ledger.rows.length, 2, 'Removed ad rows cannot remain as duplicate historical spend.');

const orders = Array.from({ length: 9 }, (_, index) => profitOrderFixture({
  id: `fb-${index}`, order_number: `FB-${String(index + 1).padStart(6, '0')}`, waybill_number: `AD-QA-${index}`,
  platform_lead_id: `lead-${index}`, platform_lead_created_at: '2026-09-30T19:00:00Z', created_at: '2026-10-01T09:00:00Z',
  order_status: index < 3 ? 'Delivered' : 'Processing', payment_status: index < 3 ? 'Paid' : 'Pending', cod_payment_received: index < 3,
  stock_allocated: index < 3, stock_allocated_at: '2026-10-01T10:00:00Z',
  items: [{ ...profitOrderFixture().items[0], main_sku: 'R0003', sku: 'R0003-BLUE' }],
}));
const purchases = [profitPurchaseFixture({ sku: 'R0003-BLUE', variant_sku: 'R0003-BLUE', quantity_added: 30, total_cost: 13500 })];
const selection = { fromDate: '2026-10-01', toDate: '2026-10-08' };
const report = buildPaidWaybillProfitReport({ orders, purchases, selection });
const sourceBefore = JSON.stringify({ orders, purchases, ledger });
const allocated = allocateFacebookAdCosts(ledger, orders, report, selection);
assert.equal(allocated.paidCost, 1283.37);
assert.equal(allocated.pendingCost, 2566.74);
assert.equal(allocated.commercialCost, 342.81, 'Only 3 / 9 of the recorded promotion spend belongs to these paid orders.');
assert.equal(allocated.commercialSpend, 1028.42);
assert.equal(allocated.commercialRemainingCost, 685.61);
assert.equal(allocated.unmatchedCost, 0);
assert.equal(allocated.cohorts[0].matched, 9);
assert.equal(allocated.orderCosts.get('fb-0')?.cost, 427.79);
assert.equal(facebookAllocatedAdvertisingSummary(report, allocated, '').netProfit, -726.18);
const commercialFormRows = parseFacebookAdCostCsv(csv.replace('Messaging conversations started', 'Leads (form)'));
const commercialFormLedger = mergeFacebookAdLedger(emptyFacebookAdLedger(), commercialFormRows, meta).ledger;
const commercialFormAllocation = allocateFacebookAdCosts(commercialFormLedger, orders, report, selection);
assert.equal(commercialFormRows[1].leads, 13, 'A named Commercial ad with actual form-lead results contributes only its form leads.');
assert.equal(commercialFormAllocation.commercialCohorts[0].leads, 22);
assert.equal(commercialFormAllocation.commercialCost, 140.24, 'The promotion denominator includes form leads from named Commercial ads without inventing an item code.');
assert.equal(JSON.stringify({ orders, purchases, ledger }), sourceBefore, 'Read-only allocation never changes orders, invoices, stock or ledger history.');
const paidLater = orders.map((order, i) => i === 3 ? { ...order, order_status: 'Delivered' as const, payment_status: 'Paid' as const, cod_payment_received: true, stock_allocated: true } : order);
const laterReport = buildPaidWaybillProfitReport({ orders: paidLater, purchases, selection });
const later = allocateFacebookAdCosts(ledger, paidLater, laterReport, selection);
assert.equal(later.paidCost, 1711.16); assert.equal(later.pendingCost, 2138.95);
assert.equal(later.commercialCost, 457.08, 'A later payment includes that lead\'s promotion share without charging all promotion spend.');
assert.equal(later.orderCosts.get('fb-0')?.cost, allocated.orderCosts.get('fb-0')?.cost, 'A later payment keeps the original lead cost.');
assert.equal(later.orderCosts.get('fb-3')?.cost, allocated.orderCosts.get('fb-3')?.cost);
const cancelled = orders.map((order, i) => i === 8 ? { ...order, order_status: 'Cancelled' as const } : order);
const loss = allocateFacebookAdCosts(ledger, cancelled, report, selection);
assert.equal(loss.lostCost, 427.79); assert.equal(loss.pendingCost, 2138.95);
const returned = orders.map((order, i) => i === 8 ? { ...order, return_sheet_id: 'synthetic-return' } : order);
assert.equal(allocateFacebookAdCosts(ledger, returned, report, selection).lostCost, 427.79, 'Known return ad cost stays a loss.');
const quantityOrders = orders.map((order, i) => i === 8 ? { ...order, items: [{ ...order.items[0], quantity: 8, subtotal: 8000 }] } : order);
assert.equal(allocateFacebookAdCosts(ledger, quantityOrders, report, selection).orderCosts.get('fb-8')?.cost, 427.79, 'Ads allocate per lead, never per purchased unit.');
const sourceCodeKept = orders.map((order, i) => i === 8 ? { ...order, notes: 'Facebook Lead Form auto import\nForm: R0003-v2.1', items: [{ ...order.items[0], main_sku: 'R0052', sku: 'R0052-GREEN' }] } : order);
assert.equal(allocateFacebookAdCosts(ledger, sourceCodeKept, report, selection).orderCosts.get('fb-8')?.cost, 427.79);
const overCount = allocateFacebookAdCosts(ledger, [...orders, { ...orders[8], id: 'extra', platform_lead_id: 'extra-lead' }], report, selection);
assert(overCount.issues.some(issue => /10 unique leads/.test(issue))); assert.equal(facebookAllocatedAdvertisingSummary(report, overCount, '').netProfit, null);
const duplicate = allocateFacebookAdCosts(ledger, [...orders, { ...orders[8], id: 'duplicate' }], report, selection);
assert(duplicate.issues.some(issue => /share this Lead ID/.test(issue)));
const missing = allocateFacebookAdCosts(ledger, orders.slice(0, 8), report, selection);
assert.equal(missing.unmatchedCost, 427.79); assert.equal(facebookAllocatedAdvertisingSummary(report, missing, '').netProfit, null);
const partialCommercial = allocateFacebookAdCosts(ledger, orders, report, { fromDate: '2026-10-03', toDate: '2026-10-08' });
assert.equal(partialCommercial.commercialCost, 0, 'Paid leads outside the selection do not receive a promotion share.');
assert.equal(partialCommercial.commercialRemainingCost, 1028.42);
const noLeadLedger = mergeFacebookAdLedger(ledger, [{ ...rows[0], campaign: 'R0053', adSet: 'R0053', code: 'R0053', leads: 0, spend: 250 }], { ...meta, expectedVersion: 1 }).ledger;
assert.equal(allocateFacebookAdCosts(noLeadLedger, orders, report, selection).lostCost, 250);
const lateImportOrder = { ...orders[0], created_at: '2026-10-12T09:00:00Z' };
const lateImportReport = buildPaidWaybillProfitReport({ orders: [lateImportOrder, ...orders.slice(1)], purchases, selection: { fromDate: '2026-10-12', toDate: '2026-10-12' } });
assert.equal(allocateFacebookAdCosts(ledger, [lateImportOrder, ...orders.slice(1)], lateImportReport, { fromDate: '2026-10-12', toDate: '2026-10-12' }).paidCost, 427.79, 'Late system imports use the original lead cost period.');
const comboRow = { ...rows[0], code: 'CB-R0010-R0044', campaign: 'CB-R0010-R0044', adSet: 'CB-R0010-R0044', leads: 1, spend: 500 };
const comboLedger = mergeFacebookAdLedger(emptyFacebookAdLedger(), [comboRow], meta).ledger;
const comboOrder = { ...orders[0], id: 'combo', items: [{ ...orders[0].items[0], sku: 'CB-R0010-R0044', main_sku: 'CB-R0010-R0044', quantity: 3,
  product_type: 'bundle' as const, bundle_components: [{ product_id: 'a', sku: 'R0010', product_name: 'A', quantity_per_bundle: 1 }, { product_id: 'b', sku: 'R0044', product_name: 'B', quantity_per_bundle: 1 }] }] };
assert.equal(allocateFacebookAdCosts(comboLedger, [comboOrder], { ...report, rows: [{ ...report.rows[0], orderId: 'combo' }] }, selection).paidCost, 500, 'CB cost belongs to the complete CB SKU once.');
const pennyLedger = mergeFacebookAdLedger(emptyFacebookAdLedger(), [{ ...rows[0], spend: 1, leads: 9 }], meta).ledger;
const pennies = allocateFacebookAdCosts(pennyLedger, cancelled, report, selection).cohorts[0];
assert.equal(Math.round((pennies.paidCost + pennies.pendingCost + pennies.lostCost + pennies.unmatchedCost) * 100), 100, 'Every cent reconciles across all states.');

// The uploaded waybills select revenue and item-ad costs independently of CSV reporting dates.
const waybillOrders = orders.map((order, index) => index < 2 ? { ...order, stock_allocated: false, created_at: '2026-10-09T09:00:00Z', cod_payment_received_at: '2026-10-10T09:00:00Z' }
  : index === 8 ? { ...order, order_status: 'Cancelled' as const } : order);
const waybillPurchases = [...purchases, profitPurchaseFixture({ id: 'last-r0003', po_number: 'PO-LATEST-R0003', sku: 'R0003-BLUE', variant_sku: 'R0003-BLUE', unit_buying_price: 600, created_at: '2026-10-10T09:00:00Z' })];
const waybills = [waybillOrders[0].waybill_number!, waybillOrders[1].waybill_number!, waybillOrders[0].waybill_number!];
const waybillReport = buildPaidWaybillProfitReport({ orders: waybillOrders, purchases: waybillPurchases, waybills });
assert.equal(waybillReport.rows.length, 2); assert.equal(waybillReport.duplicates, 1);
assert.equal(waybillReport.totals.purchasing, 1200); assert.equal(waybillReport.totals.beforeAds, 300);
const scopedLedger = mergeFacebookAdLedger(ledger, [{ ...rows[0], from: '2026-09-20', to: '2026-09-30', spend: 100, leads: 1 },
  { ...rows[1], from: '2026-09-20', to: '2026-09-30', spend: 200 }, { ...rows[0], code: 'R0048', campaign: 'R0048', adSet: 'R0048', spend: 999, leads: 3 },
  { ...rows[0], code: 'R0017', campaign: 'R0017', adSet: 'R0017', spend: 250, leads: 0 }],
  { ...meta, expectedVersion: 1, importedAt: '2026-10-10T17:00:00Z' }).ledger;
// A legacy saved ledger can contain historical rows. The current CSV snapshot
// contains all October item/promotion rows; older reporting dates stay inactive.
scopedLedger.rows = scopedLedger.rows.map(row => ({ ...row, importedAt: row.from === '2026-10-01' ? '2026-10-10T17:00:00Z' : '2026-09-30T17:00:00Z' }));
const waybillPeriods = facebookReportingPeriods(scopedLedger, ['2026-10-01|2026-10-08']);
assert.deepEqual(waybillPeriods, [{ from: '2026-10-01', to: '2026-10-08' }]);
const scope = { orderIds: waybillReport.rows.map(row => row.orderId!), reportingPeriods: waybillPeriods };
const waybillAllocation = allocateFacebookAdCosts(scopedLedger, waybillOrders, waybillReport, {}, scope);
assert.equal(waybillAllocation.paidCost, 855.58, 'Only uploaded paid waybills contribute their item-ad costs.');
assert.equal(waybillAllocation.lossSpend, 677.79, 'Cancelled ad cost and zero-lead spend form the known period loss pool.');
assert.equal(waybillAllocation.lostCost, 123.23, '2 selected paid waybills carry 2 / 11 remaining form leads of the known loss; pending and unselected shares stay separate.');
assert.equal(waybillAllocation.lossRemainingCost, 554.56);
assert.equal(waybillAllocation.lossCohorts[0].leads, 11);
assert.equal(waybillAllocation.lossCohorts[0].lostLeads, 1);
assert.equal(waybillAllocation.commercialCost, 171.4, 'Use 2 selected paid leads / all 12 CSV form leads; other periods and unselected paid orders receive no charge.');
assert.equal(waybillAllocation.commercialSpend, 1028.42);
assert.equal(waybillAllocation.commercialRemainingCost, 857.02);
assert.equal(waybillAllocation.commercialCohorts[0].selectedPaid, 2);
assert.equal(waybillAllocation.commercialCohorts[0].leads, 12);
assert.equal(waybillAllocation.unmatchedCost, 999, 'Unmatched costs for other leads remain visible and separate.');
assert.equal(facebookAllocatedAdvertisingSummary(waybillReport, waybillAllocation, '').netProfit, -850.21);
assert.equal(Math.round([...waybillAllocation.orderCosts.values()].reduce((sum, row) => sum + row.lossCost, 0) * 100), 12323, 'Order loss deductions reconcile exactly to the summary cents.');
assert.equal(Math.round([...waybillAllocation.orderCosts.values()].reduce((sum, row) => sum + row.promotionCost, 0) * 100), 17140);
const allRemainingOrders = waybillOrders.map(order => order.order_status === 'Cancelled' ? order : { ...order, order_status: 'Delivered' as const, payment_status: 'Paid' as const, cod_payment_received: true });
const allRemainingReport = buildPaidWaybillProfitReport({ orders: allRemainingOrders, purchases: waybillPurchases, waybills: allRemainingOrders.filter(order => order.order_status !== 'Cancelled').map(order => order.waybill_number!) });
const completeLoss = allocateFacebookAdCosts(ledger, allRemainingOrders, allRemainingReport, {}, { ...scope, orderIds: allRemainingReport.rows.map(row => row.orderId!) });
assert.equal(completeLoss.lostCost, 427.79, 'Once all remaining form leads are delivered and selected, the full known cancelled-lead loss is deducted.');
assert.equal(completeLoss.lossRemainingCost, 0);
const returnedScopeOrders = waybillOrders.map(order => order.order_status === 'Cancelled' ? { ...order, order_status: 'Processing' as const, return_sheet_id: 'qa-return' } : order);
assert.equal(allocateFacebookAdCosts(scopedLedger, returnedScopeOrders, waybillReport, {}, scope).lostCost, 123.23, 'Returned orders contribute the same known loss share as cancelled orders.');
const scopedBefore = JSON.stringify({ scopedLedger, waybillOrders, waybillPurchases });
allocateFacebookAdCosts(scopedLedger, waybillOrders, waybillReport, {}, scope);
assert.equal(JSON.stringify({ scopedLedger, waybillOrders, waybillPurchases }), scopedBefore);
const missingScoped = allocateFacebookAdCosts(emptyFacebookAdLedger(), waybillOrders, waybillReport, {}, scope);
assert.equal(facebookAllocatedAdvertisingSummary(waybillReport, missingScoped, '').netProfit, null, 'Selected waybills still need their own matching ad costs.');

const noFormPromotion = mergeFacebookAdLedger(emptyFacebookAdLedger(), [rows[1]], meta).ledger;
const unavailablePromotion = allocateFacebookAdCosts(noFormPromotion, waybillOrders, waybillReport, {}, scope);
assert.equal(unavailablePromotion.commercialCost, 0, 'A missing form-lead denominator cannot default to charging full promotion spend.');
assert(unavailablePromotion.issues.some(issue => /no matching CSV form-lead count/.test(issue)));
const oneCentPromotion = mergeFacebookAdLedger(ledger, [{ ...rows[1], spend: 0.01 }], { ...meta, expectedVersion: 1 }).ledger;
const oneCentAllocation = allocateFacebookAdCosts(oneCentPromotion, orders, report, selection);
assert.equal(Math.round((oneCentAllocation.commercialCost + oneCentAllocation.commercialRemainingCost) * 100), 1, 'Included and remaining promotion shares reconcile to the recorded cents.');

if (process.argv[5]) {
  const augustRows = parseFacebookAdCostCsv(fs.readFileSync(process.argv[5], 'utf8'));
  const augustLedger = mergeFacebookAdLedger(emptyFacebookAdLedger(), augustRows, meta).ledger;
  const augustOrders = Array.from({ length: 5 }, (_, index) => ({ ...orders[0], id: `august-qa-${index}`, waybill_number: `AUGUST-QA-${index}`,
    order_number: `FB-AUGUST-QA-${index}`, platform_lead_id: `august-qa-lead-${index}`, platform_lead_created_at: '2026-09-15T09:00:00Z',
    created_at: '2026-09-15T10:00:00Z', stock_allocated: false, cod_payment_received: index < 4,
    order_status: index < 4 ? 'Delivered' as const : 'Processing' as const, notes: 'Form: R0004-v1',
    items: [{ ...orders[0].items[0], main_sku: 'R0004', sku: 'R0004-BLUE' }] }));
  const augustReport = buildPaidWaybillProfitReport({ orders: augustOrders,
    purchases: [profitPurchaseFixture({ sku: 'R0004-BLUE', variant_sku: 'R0004-BLUE' })], waybills: augustOrders.slice(0, 3).map(order => order.waybill_number!) });
  const augustAllocation = allocateFacebookAdCosts(augustLedger, augustOrders, augustReport, {}, {
    orderIds: augustReport.rows.map(row => row.orderId!), reportingPeriods: [{ from: '2026-08-26', to: '2026-09-22' }] });
  assert.equal(augustAllocation.commercialSpend, 4352.7);
  assert.equal(augustAllocation.commercialCohorts[0].leads, 324, 'Messages and video / page views from the supplied CSV do not inflate the denominator.');
  assert.equal(augustAllocation.commercialCohorts[0].selectedPaid, 3);
  assert.equal(augustAllocation.commercialCost, 40.3, '3 selected paid leads receive exactly their 3 / 324 promotion share.');
  assert.equal(augustAllocation.commercialRemainingCost, 4312.4);
  assert.equal(augustAllocation.missingOrderIds.length, 0);
  if (process.argv[6]) fs.writeFileSync(process.argv[6], Buffer.from(createPaidWaybillProfitPdf(augustReport, {
    facebook: '', tiktok: '', sourceName: 'Synthetic selected waybills using the supplied Aug / Sep Facebook CSV', paymentBasis: 'auto',
    facebookAllocation: augustAllocation, facebookReportingPeriods: [{ from: '2026-08-26', to: '2026-09-22' }] }).output('arraybuffer')));
}

if (process.argv[2]) {
  const uploaded = parseFacebookAdCostCsv(fs.readFileSync(process.argv[2], 'utf8'));
  assert.equal(uploaded.length, 13); assert.equal(uploaded[0].code, 'CB-R0010-R0044');
  assert.equal(Math.round(uploaded.reduce((sum, row) => sum + row.spend, 0) * 100), 3458075);
  assert.equal(uploaded.find(row => row.code === 'R0003')?.leads, 9);
}

class MemoryBucket {
  objects = new Map<string, { value: string; etag: string; customMetadata?: any }>();
  revision = 0; writes: string[] = []; beforePut?: (key: string) => Promise<void>;
  async get(key: string) { const value = this.objects.get(key); return value ? { text: async () => value.value, etag: value.etag, customMetadata: value.customMetadata } : null; }
  async put(key: string, value: string, options: any = {}) {
    if (this.beforePut) await this.beforePut(key);
    const old = this.objects.get(key);
    if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches || options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    const etag = String(++this.revision); this.writes.push(key); this.objects.set(key, { value, etag, customMetadata: options.customMetadata }); return { etag };
  }
}
const raw = new MemoryBucket(), secret = 'synthetic-profit-test-secret', env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: secret, ORA_R2_COMPRESSION_ENABLED: '1' };
const catalog = { key: 'storefront-state-v1', payload: { version: 1, products: [{ id: 'watch', sku: 'R0003', stock: 100 }], categories: [], settings: { website_name: 'Synthetic Store' } } };
await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders, tables: { purchase_orders: purchases }, admin_data_store: [catalog, { key: 'unrelated-finance', payload: ['preserve-me'] }],
  admin_users: [{ id: 'admin', role: 'admin', is_active: true }, { id: 'view', role: 'staff', is_active: true, permissions: ['profit_report', 'level:profit_report:view'] },
    { id: 'staff', role: 'staff', is_active: true, permissions: ['orders'] }], courier_waybills: [] });
const token = (id: string) => { const payload = Buffer.from(JSON.stringify({ sub: id, role: id === 'admin' ? 'admin' : 'staff', exp: Date.now() + 60000 })).toString('base64url'); return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url'); };
const request = (method = 'GET', body?: any, auth = token('admin'), url = '/api/admin/profit-ad-costs?reportOnly=1') => withR2DataFallback(new Request('https://synthetic.test' + url, { method,
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, {}, async () => new Response('Unexpected bridge', { status: 599 }));
assert.equal((await request('GET', undefined, 'invalid')).status, 401);
assert.equal((await request('GET', undefined, token('staff'))).status, 403);
assert.equal((await request('GET', undefined, token('view'))).status, 200);
assert.equal((await request('POST', { csv, fileName: 'QA.csv', expectedVersion: 0 }, token('view'))).status, 403);
raw.writes = [];
const purchaseHistory: any = await (await request('GET', undefined, token('view'), '/api/admin/profit-ad-costs?includePurchases=1&reportOnly=1')).json();
assert.equal(purchaseHistory.purchases.length, purchases.length);
assert.equal(purchaseHistory.purchases[0].unit_buying_price, purchases[0].unit_buying_price);
assert.equal(purchaseHistory.purchases[0].id, purchases[0].id);
assert(!('bill_image_url' in purchaseHistory.purchases[0]) && !('notes' in purchaseHistory.purchases[0]), 'Report reads expose cost provenance, not bill images or supplier notes.');
assert.equal(raw.writes.length, 0, 'Reading archived Purchasing history never allocates stock or saves orders.');
assert.equal((await request('GET', undefined, token('staff'), '/api/admin/profit-ad-costs?includePurchases=1&reportOnly=1')).status, 403);
const protectedOrders = JSON.stringify(await readDataTable(env, 'order_snapshots'));
const upload = { csv, fileName: 'QA.csv', expectedVersion: 0 };
await replaceDataTable(env, 'admin_data_store', rows => ({ rows: [...rows, { key: FACEBOOK_AD_LEDGER_KEY, payload: ledger }], result: null }));
const stored: any = await (await request()).json();
assert.equal(stored.ledger.rows.length, 0);
assert.equal((await request('GET', undefined, token('admin'), '/api/admin/profit-ad-costs')).status, 410, 'An old cached profit screen must use the new flow.');
assert.equal((await request('POST', upload)).status, 410, 'Old clients cannot save expense history again.');
assert.equal((await request('POST', { action: 'start-report' })).status, 200);
raw.writes = [];
assert.equal((await request('POST', { action: 'start-report' })).status, 200); assert.equal(raw.writes.length, 0, 'Report reset is idempotent.');
const durable = await readDataTable(env, 'admin_data_store');
assert.equal(durable.find(row => row.key === FACEBOOK_AD_LEDGER_KEY)?.payload.rows.length, 0);
assert.deepEqual(durable.find(row => row.key === catalog.key)?.payload, catalog.payload);
assert.deepEqual(durable.find(row => row.key === 'unrelated-finance')?.payload, ['preserve-me']);
assert.equal(JSON.stringify(await readDataTable(env, 'order_snapshots')), protectedOrders, 'Reset never changes an order, payment, invoice, stock or waybill.');
const publicState = await (await request('GET', undefined, '', '/api/storefront/state')).json() as any;
assert(!JSON.stringify(publicState).includes('3850.11') && !JSON.stringify(publicState).includes(FACEBOOK_AD_LEDGER_KEY), 'Ad costs never appear in public website settings.');
await replaceDataTable(env, 'admin_data_store', rows => ({ rows: rows.map(row => row.key === FACEBOOK_AD_LEDGER_KEY ? { ...row, payload: ledger } : row), result: null }));
const active = (await activeData(dataBucket(env)!))!, adminKey = active.prefix + 'admin_data_store.json';
let interleaved = false;
raw.beforePut = async key => {
  if (key !== adminKey || interleaved) return; interleaved = true;
  await replaceDataTable(env, 'admin_data_store', rows => ({ rows: rows.map(row => row.key === catalog.key ? { ...row, payload: { ...row.payload, version: 2, settings: { website_name: 'Concurrent staff update' } } } : row), result: null }));
};
assert.equal((await request('POST', { action: 'start-report' })).status, 200);
assert.equal((await readDataTable(env, 'admin_data_store')).find(row => row.key === catalog.key)?.payload.settings.website_name, 'Concurrent staff update', 'CAS reset retains unrelated concurrent edits.');
assert.equal((await request('POST', { ...upload, csv: csv.replace('3850.11', '4200') })).status, 410);
if (process.argv[5]) {
  const augustCsv = fs.readFileSync(process.argv[5], 'utf8');
  raw.writes = [];
  assert.equal((await request('POST', { csv: augustCsv, fileName: 'August-September.csv', expectedVersion: 0 })).status, 410);
  assert.equal(raw.writes.length, 0, 'Historical expenses cannot be restored by a stale upload.');
}
assert([...raw.objects.values()].every(value => /^ora-aes-gcm-v[12]$/.test(JSON.parse(value.value).format)), 'Finance history and backups remain encrypted.');

const compiled = await build({ entryPoints: ['src/components/admin/ProfitReportPanel.tsx'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external',
  define: { 'import.meta.env': '{}' }, loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' } });
const panelPath = new URL('./.facebook-profit-panel-qa.mjs', import.meta.url);
fs.writeFileSync(panelPath, compiled.outputFiles[0].text);
try {
  const { ProfitReportWorkspace } = await import(panelPath.href);
  const props = { orders, purchases, returns: [], ready: true, storageKey: 'synthetic-facebook-profit', onRefresh: async () => {},
    advertisingLedger: ledger, advertisingReady: true, canImportAds: true, knownAdCodes: ['R0003'], onImportAds: async () => ledger, onReloadAds: async () => {},
    initialDraft: { paymentFilter: 'all', fromDate: selection.fromDate, toDate: selection.toDate, paymentBasis: 'auto', facebook: '99999', tiktok: '' } };
  const html = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, props));
  assert(html.includes('Upload Facebook Cost CSV') && html.includes('FB Ad Cost') && html.includes('Profit After FB'));
  assert(html.includes('Rs. -726.18'), 'The summary uses the allocation; legacy manual Facebook amounts are ignored.');
  assert(html.includes('Commercial promotion cost allocation') && html.includes('Rs. 685.61'), 'Recorded promotion spend and the remaining share are visible separately.');
  assert(!html.includes('aria-label="Facebook Cost (Rs.)"'), 'Do not also deduct a manual Facebook total.');
  const empty = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, orders: [] }));
  assert(empty.includes('Upload Facebook Cost CSV'), 'Costs can be imported while every lead is pending.');
  const loading = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, advertisingReady: false }));
  assert(!loading.includes('Rs. -726.18'), 'Never label a profit complete before durable ad costs finish loading.');
  const viewer = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, canImportAds: false }));
  assert(!viewer.includes('Upload Facebook Cost CSV'));
  const uploadProps = { ...props, orders: waybillOrders, purchases: waybillPurchases, advertisingLedger: scopedLedger, useUploadedWaybills: true,
    initialDraft: { ...props.initialDraft, fromDate: '2026-12-31', toDate: '2026-01-01', waybills, waybillFileName: 'Fardar-waybill-selection.csv', facebookPeriods: ['2026-10-01|2026-10-08'] } };
  const selected = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, uploadProps));
  assert(selected.includes('Upload Waybill CSV') && selected.includes('Fardar-waybill-selection.csv'));
  assert(selected.includes('Facebook CSV Reporting Date Range') && selected.includes('01/10/2026 — 08/10/2026'));
  const beforeCostCsv = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...uploadProps, purchases: [], advertisingLedger: emptyFacebookAdLedger() }));
  const datesBeforeUpload = beforeCostCsv.match(/aria-label="Required Facebook CSV export dates"([\s\S]*?)<\/div>/)![1];
  assert(datesBeforeUpload.includes('01/10/2026 - 01/10/2026'), 'Required export dates are shown BEFORE any cost CSV, even when Purchasing still needs review.');
  assert(!datesBeforeUpload.includes('09/10/2026'), 'The needed CSV uses original lead dates rather than the later system arrival date.');
  assert(!selected.includes('aria-label="Profit system date from"'), 'CSV reporting dates are displayed instead of filtering the waybills by system dates.');
  assert(selected.includes('Rs. -850.21') && selected.includes('PO-LATEST-R0003'));
  assert(selected.includes('Facebook loss cost deduction') && selected.includes('FB loss deducted:') && selected.includes('After item ad + FB loss + Commercial'));
  assert(selected.includes('Rs. -123.23'), 'The profit summary visibly shows the FB loss as a deduction.');
  const selectedTable = selected.match(/aria-label="Paid waybill profit details"[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/)![1];
  assert(selectedTable.includes('AD-QA-0') && selectedTable.includes('AD-QA-1'));
  assert(!selectedTable.includes('AD-QA-2'), 'Other paid orders are excluded from the uploaded report.');
  const beforeUpload = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...uploadProps, initialDraft: { ...uploadProps.initialDraft, waybills: [], waybillFileName: '' } }));
  assert(!beforeUpload.includes('aria-label="Paid waybill profit details"'), 'Do not show all saved paid orders before the waybill upload.');
  assert(beforeUpload.includes('Upload Waybill CSV') && beforeUpload.includes('Upload Facebook Cost CSV'));
} finally { fs.unlinkSync(panelPath); }

const pdf = createPaidWaybillProfitPdf(report, { facebook: '99999', tiktok: '', sourceName: 'Synthetic Facebook allocation QA', paymentBasis: 'auto', facebookAllocation: allocated });
assert(pdf.getNumberOfPages() >= 3);
if (process.argv[3]) { fs.mkdirSync(path.dirname(process.argv[3]), { recursive: true }); fs.writeFileSync(process.argv[3], Buffer.from(pdf.output('arraybuffer'))); }
const waybillPdf = createPaidWaybillProfitPdf(waybillReport, { facebook: '99999', tiktok: '', sourceName: 'Uploaded waybills: Fardar-waybill-selection.csv', paymentBasis: 'auto', facebookAllocation: waybillAllocation, facebookReportingPeriods: waybillPeriods });
if (process.argv[4]) { fs.mkdirSync(path.dirname(process.argv[4]), { recursive: true }); fs.writeFileSync(process.argv[4], Buffer.from(waybillPdf.output('arraybuffer'))); }
console.log('PASS: Actual CSV imports including boosted posts and blank zero-result ads, proportional promotion cost by CSV form leads and selected paid waybills, exact CB codes, original lead dates, Purchasing prices, cents reconciliation, later payments, immutable records, idempotent imports, overlap rejection, protected encrypted R2 and matching report / PDF totals.');
