import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { allocateFacebookAdCosts, emptyFacebookAdLedger, facebookAllocatedAdvertisingSummary, facebookOrderAdvertisingCost, facebookReportingPeriods, latestFacebookAdLedger, mergeFacebookAdLedger, parseFacebookAdCostCsv, FACEBOOK_AD_LEDGER_KEY } from '../src/lib/facebookProfitAds';
import { profitAdCostHandler } from '../src/lib/profitAdCostHandler';
import { buildPaidWaybillProfitReport, parseProfitWaybillUpload } from '../src/lib/paidWaybillProfit';
import { createPaidWaybillProfitPdf } from '../src/lib/paidWaybillProfitPdf';
import { profitOrderFixture, profitPurchaseFixture } from './profit-report-fixtures';

const syntheticCsv = 'Campaign name,Ad set name,Result type,Results,Amount spent (LKR),Reporting starts,Reporting ends\nR0052,R0052,Leads (form),3,300,2026-09-26,2026-10-08\nCommercial,Promotion,ThruPlay,100,50,2026-09-26,2026-10-08';
const csv = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : syntheticCsv;
const rows = parseFacebookAdCostCsv(csv), periods = [...new Map(rows.map(row => [row.from + '|' + row.to, { from: row.from, to: row.to }])).values()];
assert.equal(periods.length, 1);
const meta = { expectedVersion: 0, fileName: 'current.csv', importedAt: '2026-10-12T05:00:00Z', importedBy: 'Synthetic test' };
const current = mergeFacebookAdLedger(emptyFacebookAdLedger(), rows, meta).ledger;
const oldRows = [
  { ...rows.find(row => row.code === 'R0052')!, from: '2026-08-26', to: '2026-09-22', spend: 1_000_000, leads: 2 },
  { ...rows.find(row => !row.code)!, from: '2026-08-26', to: '2026-09-22', spend: 999_999 },
];
const old = mergeFacebookAdLedger(emptyFacebookAdLedger(), oldRows, { ...meta, fileName: 'history.csv', importedAt: '2026-09-23T05:00:00Z' }).ledger;
const history = mergeFacebookAdLedger(old, rows, { ...meta, expectedVersion: old.version }).ledger;
const orders = rows.filter(row => row.code && row.leads).flatMap(row => Array.from({ length: row.leads + (row.code === 'R0052' ? 1 : 0) }, (_, index) => {
  const id = `${row.code}-${index}`, returned = index === 2;
  return profitOrderFixture({ id, order_number: 'FB-' + id, waybill_number: 'QA-' + id, notes: 'Form: ' + row.code,
    created_at: periods[0].from + 'T06:00:00Z', platform_lead_created_at: periods[0].from + 'T05:00:00Z', platform_lead_id: 'lead-' + id,
    cod_payment_received: index < 2, cod_payment_amount: 4000, total_amount: 4000,
    order_status: index === 3 ? 'Cancelled' : index < 2 ? 'Delivered' : 'Processing',
    fardar_return_fee: returned ? 450 : undefined, fardar_invoice_status: returned ? 'Return Complete' : undefined,
    fardar_invoice_waybill: returned ? 'QA-' + id : undefined,
    items: [{ ...profitOrderFixture().items[0], main_sku: row.code!, sku: row.code! + '-BLACK', variant_id: row.code!, unit_price: 3750, subtotal: 3750 }],
  });
}));
const legacySale = { ...orders[0], id: 'legacy-sale', order_number: 'FB-LEGACY-SALE', waybill_number: 'QA-LEGACY-SALE', platform_lead_id: 'legacy-sale-lead',
  notes: 'Form: R0052', created_at: '2026-09-01T06:00:00Z', platform_lead_created_at: '2026-09-01T05:00:00Z' };
const legacyReturn = { ...orders.find(order => order.fardar_return_fee)!, id: 'legacy-return', order_number: 'FB-LEGACY-RETURN', waybill_number: 'QA-LEGACY-RETURN',
  fardar_invoice_waybill: 'QA-LEGACY-RETURN', platform_lead_id: 'legacy-return-lead', notes: 'Form: R0052', created_at: '2026-09-01T06:00:00Z', platform_lead_created_at: '2026-09-01T05:00:00Z' };
const allOrders = [...orders, legacySale, legacyReturn];
const purchases = rows.filter(row => row.code).map(row => profitPurchaseFixture({ id: row.code!, sku: row.code! + '-BLACK', variant_sku: row.code! + '-BLACK', variant_id: row.code!, quantity_added: 1000, unit_buying_price: 450, total_cost: 450000 }));
const waybills = [legacySale, legacyReturn, ...orders].filter(order => order.cod_payment_received || order.fardar_return_fee !== undefined).map(order => order.waybill_number!);
const before = JSON.stringify({ history, allOrders, purchases });
const report = buildPaidWaybillProfitReport({ orders: allOrders, purchases, waybills });
assert.equal(report.totals.review, 0);
assert.equal(report.rows.length, waybills.length, 'Every selected payment and return stays in the financial report.');
const scope = { orderIds: report.rows.map(row => row.orderId!), reportingPeriods: periods };
const allocation = allocateFacebookAdCosts(history, allOrders, report, {}, scope);
assert.deepEqual(allocation, allocateFacebookAdCosts(current, allOrders, report, {}, scope), 'Historical spend cannot affect current CSV profit, including selected historical waybills.');
assert.equal(allocation.totalSpend, Math.round(rows.reduce((sum, row) => sum + row.spend, 0) * 100) / 100);
assert(allocation.cohorts.every(row => row.from === periods[0].from && row.to === periods[0].to));
assert.equal(allocation.outsidePeriodOrderIds.size, 2);
assert.equal(facebookOrderAdvertisingCost(allocation, legacySale.id), 0);
assert.equal(facebookOrderAdvertisingCost(allocation, legacyReturn.id), 0);
assert.equal(report.rows.find(row => row.orderId === legacyReturn.id)!.profit, -450, 'Outside-period returns retain their real return fee.');
const mismatch = allocation.cohorts.find(row => row.code === 'R0052')!;
assert.equal(mismatch.allocationLeads, mismatch.leads + 1);
assert.equal(mismatch.issues.length, 0);
assert(mismatch.warnings.some(warning => warning.includes('without exceeding')));
for (const row of allocation.cohorts) assert.equal(Math.round((row.paidCost + row.pendingCost + row.lostCost + row.unmatchedCost) * 100), Math.round(row.spend * 100));
assert.equal(Math.round((allocation.commercialCost + allocation.commercialRemainingCost) * 100), Math.round(allocation.commercialSpend * 100));
const summary = facebookAllocatedAdvertisingSummary(report, allocation, '0');
assert(summary.netProfit !== null, 'A Results/unique-lead attribution difference must not hide valid profit.');
assert.equal(summary.netProfit, Math.round((report.totals.beforeAds - summary.total) * 100) / 100);
assert(summary.total <= allocation.totalSpend, 'All selected sales, returns, losses and promotion shares stay within the current CSV budget.');
for (const row of report.rows.filter(row => row.outcome === 'returned')) {
  assert.equal(row.purchasing, 0); assert.equal(row.packing, 0); assert.equal(allocation.orderCosts.get(row.orderId!)!.lossCost, 0);
}
assert.equal(JSON.stringify({ history, allOrders, purchases }), before, 'A profit calculation never rewrites payments, returns, stock, prices or saved ad history.');
assert.deepEqual(facebookReportingPeriods(history, ['2026-08-26|2026-09-22']), periods, 'A stale browser period cannot reactivate an old uploaded CSV.');
const replaced = mergeFacebookAdLedger(history, rows, { ...meta, expectedVersion: history.version, replaceExisting: true });
assert.equal(replaced.unchanged, false, 'The persisted historical rows are removed even if this current report was previously present.');
assert.equal(replaced.ledger.rows.length, rows.length);
assert.equal(mergeFacebookAdLedger(replaced.ledger, rows, { ...meta, replaceExisting: true }).unchanged, true, 'Lost-response retries do not duplicate or replace current expenses again.');
const renamed = mergeFacebookAdLedger(replaced.ledger, rows, { ...meta, expectedVersion: replaced.ledger.version, fileName: 'latest-file.csv', replaceExisting: true });
assert.equal(renamed.unchanged, false, 'A new file with identical costs must still become the displayed current CSV.');
assert(renamed.ledger.rows.every(row => row.fileName === 'latest-file.csv'));
assert.equal(renamed.ledger.rows.reduce((sum, row) => sum + row.spend, 0), replaced.ledger.rows.reduce((sum, row) => sum + row.spend, 0));
const overlappingRows = parseFacebookAdCostCsv(syntheticCsv.replace(/2026-09-26/g, '2026-10-01'));
assert.equal(mergeFacebookAdLedger(replaced.ledger, overlappingRows, { ...meta, expectedVersion: replaced.ledger.version, replaceExisting: true }).ledger.rows.length, overlappingRows.length, 'New CSV periods can overlap the file they replace.');
let adminRows: any[] = [{ key: FACEBOOK_AD_LEDGER_KEY, payload: history }, { key: 'unrelated-state', payload: { value: 'preserved' } }];
const storage = { readAdmin: async () => adminRows, changeAdmin: async (change: any) => { const changed = change(adminRows); adminRows = changed.rows; return changed.result; } };
const get = await profitAdCostHandler(new Request('https://synthetic.test/api/ads?reportOnly=1'), storage, { role: 'admin' });
assert.equal((await get.json() as any).ledger.rows.length, 0, 'New reports never load saved Facebook costs.');
const post = (body: unknown) => profitAdCostHandler(new Request('https://synthetic.test/api/ads', { method: 'POST', body: JSON.stringify(body) }), storage, { role: 'admin' });
assert.equal((await post({ csv, expectedVersion: history.version, fileName: 'new.csv' })).status, 410, 'Stale clients cannot save advertising history back.');
assert.equal((await post({ action: 'start-report' })).status, 200);
assert.equal(adminRows[0].payload.rows.length, 0, 'Starting the new flow removes every historical expense row.');
assert.equal(adminRows[0].payload.reportOnly, true);
assert.equal(adminRows[1].payload.value, 'preserved');
const selected = orders[0];
const duplicate = allocateFacebookAdCosts(history, [...allOrders, { ...selected, id: 'duplicate-lead' }], report, {}, scope);
assert(duplicate.issues.some(issue => /share this Lead ID/.test(issue)));
const partial = facebookAllocatedAdvertisingSummary(report, duplicate, '0');
assert.equal(partial.netProfit, null, 'Duplicate source identities still require review.');
assert(partial.recordedCostProfit !== null, 'Known-cost subtotal remains visible without claiming a final profit.');
assert.equal(facebookAllocatedAdvertisingSummary(report, duplicate, '-1').recordedCostProfit, null);
if (process.argv[3]) {
  const supplied = parseProfitWaybillUpload(fs.readFileSync(process.argv[3], 'utf8'));
  assert.equal(supplied.length, 263); assert.equal(new Set(supplied).size, 263);
}
const output = new URL('./.current-period-profit-ui.mjs', import.meta.url);
try {
  await build({ entryPoints: ['src/components/admin/ProfitReportPanel.tsx'], outfile: output.pathname, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    tsconfigRaw: { compilerOptions: { jsx: 'react' } }, jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
    define: { 'import.meta.env': '{}' }, plugins: [{ name: 'fixture-store', setup(builder) {
      builder.onResolve({ filter: /context\/StoreContext$/ }, () => ({ path: 'store', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useStore=()=>({});', loader: 'js' }));
    } }] });
  const { ProfitReportWorkspace } = await import(output.href);
  const props = { orders: allOrders, purchases, returns: [], ready: true, storageKey: 'synthetic-current-period', onRefresh: async () => {},
    advertisingLedger: history, useUploadedWaybills: true, onImportAds: async () => current, onReloadAds: async () => {},
    initialDraft: { paymentFilter: 'all', fromDate: '', toDate: '', paymentBasis: 'auto', facebook: '', tiktok: '0', waybills, facebookPeriods: periods.map(period => period.from + '|' + period.to) } };
  const html = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, props));
  assert(html.includes('Selected Facebook CSV spend') && html.includes('Outside selected FB CSV dates'));
  assert(html.includes(summary.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
  const notLoaded = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, advertisingReady: false }));
  assert(!notLoaded.includes('Provisional profit from recorded costs'), 'A failed or unfinished load cannot show a subtotal as a profit.');
} finally { if (fs.existsSync(output)) fs.unlinkSync(output); }
if (process.argv[4]) fs.writeFileSync(process.argv[4], Buffer.from(createPaidWaybillProfitPdf(report, { facebook: '', tiktok: '0', sourceName: 'Synthetic selected-period regression', paymentBasis: 'auto', facebookAllocation: allocation, facebookReportingPeriods: periods }).output('arraybuffer')));
console.log('PASS: previous saved costs never loaded, stale history saves blocked, report reset clears old expenses, legacy allocation compatibility, current CSV only, every selected waybill retained, exact budget reconciliation, Results count variance, outside-period zeros, return fee once, immutable records and protected pending states.');
