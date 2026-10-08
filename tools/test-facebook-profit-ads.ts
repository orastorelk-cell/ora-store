import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { allocateFacebookAdCosts, emptyFacebookAdLedger, facebookAdCode, facebookAllocatedAdvertisingSummary,
  mergeFacebookAdLedger, parseFacebookAdCostCsv, readFacebookAdLedger, FACEBOOK_AD_LEDGER_KEY } from '../src/lib/facebookProfitAds';
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
assert.equal(allocated.commercialCost, 1028.42);
assert.equal(allocated.unmatchedCost, 0);
assert.equal(allocated.cohorts[0].matched, 9);
assert.equal(allocated.orderCosts.get('fb-0')?.cost, 427.79);
assert.equal(facebookAllocatedAdvertisingSummary(report, allocated, '').netProfit, -1411.79);
assert.equal(JSON.stringify({ orders, purchases, ledger }), sourceBefore, 'Read-only allocation never changes orders, invoices, stock or ledger history.');
const paidLater = orders.map((order, i) => i === 3 ? { ...order, order_status: 'Delivered' as const, payment_status: 'Paid' as const, cod_payment_received: true, stock_allocated: true } : order);
const laterReport = buildPaidWaybillProfitReport({ orders: paidLater, purchases, selection });
const later = allocateFacebookAdCosts(ledger, paidLater, laterReport, selection);
assert.equal(later.paidCost, 1711.16); assert.equal(later.pendingCost, 2138.95);
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
assert(partialCommercial.issues.some(issue => /Commercial cost covers/.test(issue))); assert.equal(partialCommercial.commercialCost, 0);
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
await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders, admin_data_store: [catalog, { key: 'unrelated-finance', payload: ['preserve-me'] }],
  admin_users: [{ id: 'admin', role: 'admin', is_active: true }, { id: 'view', role: 'staff', is_active: true, permissions: ['profit_report', 'level:profit_report:view'] },
    { id: 'staff', role: 'staff', is_active: true, permissions: ['orders'] }], courier_waybills: [] });
const token = (id: string) => { const payload = Buffer.from(JSON.stringify({ sub: id, role: id === 'admin' ? 'admin' : 'staff', exp: Date.now() + 60000 })).toString('base64url'); return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url'); };
const request = (method = 'GET', body?: any, auth = token('admin'), url = '/api/admin/profit-ad-costs') => withR2DataFallback(new Request('https://synthetic.test' + url, { method,
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, {}, async () => new Response('Unexpected bridge', { status: 599 }));
assert.equal((await request('GET', undefined, 'invalid')).status, 401);
assert.equal((await request('GET', undefined, token('staff'))).status, 403);
assert.equal((await request('GET', undefined, token('view'))).status, 200);
assert.equal((await request('POST', { csv, fileName: 'QA.csv', expectedVersion: 0 }, token('view'))).status, 403);
const protectedOrders = JSON.stringify(await readDataTable(env, 'order_snapshots'));
const upload = { csv, fileName: 'QA.csv', expectedVersion: 0 };
assert.equal((await request('POST', upload)).status, 200);
const stored: any = await (await request()).json();
assert.equal(stored.ledger.version, 1); assert.equal(stored.ledger.rows.length, 2);
raw.writes = [];
assert.equal((await request('POST', upload)).status, 200); assert.equal(raw.writes.length, 0, 'Repeated imports do not write or double-charge.');
const durable = await readDataTable(env, 'admin_data_store');
assert.deepEqual(durable.find(row => row.key === catalog.key)?.payload, catalog.payload);
assert.deepEqual(durable.find(row => row.key === 'unrelated-finance')?.payload, ['preserve-me']);
assert.equal(JSON.stringify(await readDataTable(env, 'order_snapshots')), protectedOrders, 'No order, payment, invoice, stock or waybill is changed by ad-cost saves.');
const publicState = await (await request('GET', undefined, '', '/api/storefront/state')).json() as any;
assert(!JSON.stringify(publicState).includes('3850.11') && !JSON.stringify(publicState).includes(FACEBOOK_AD_LEDGER_KEY), 'Ad costs never appear in public website settings.');
const active = (await activeData(dataBucket(env)!))!, adminKey = active.prefix + 'admin_data_store.json';
let interleaved = false;
raw.beforePut = async key => {
  if (key !== adminKey || interleaved) return; interleaved = true;
  await replaceDataTable(env, 'admin_data_store', rows => ({ rows: rows.map(row => row.key === catalog.key ? { ...row, payload: { ...row.payload, version: 2, settings: { website_name: 'Concurrent staff update' } } } : row), result: null }));
};
assert.equal((await request('POST', { ...upload, csv: csv.replace('3850.11', '4000'), expectedVersion: 1 })).status, 200);
assert.equal((await readDataTable(env, 'admin_data_store')).find(row => row.key === catalog.key)?.payload.settings.website_name, 'Concurrent staff update', 'CAS retry retains unrelated concurrent edits.');
assert.equal((await request('POST', { ...upload, csv: csv.replace('3850.11', '4200'), expectedVersion: 1 })).status, 409);
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
  assert(html.includes('Rs. -1,411.79'), 'The summary uses the allocation; legacy manual Facebook amounts are ignored.');
  assert(!html.includes('aria-label="Facebook Cost (Rs.)"'), 'Do not also deduct a manual Facebook total.');
  const empty = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, orders: [] }));
  assert(empty.includes('Upload Facebook Cost CSV'), 'Costs can be imported while every lead is pending.');
  const loading = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, advertisingReady: false }));
  assert(!loading.includes('Rs. -1,411.79'), 'Never label a profit complete before durable ad costs finish loading.');
  const viewer = renderToStaticMarkup(React.createElement(ProfitReportWorkspace, { ...props, canImportAds: false }));
  assert(!viewer.includes('Upload Facebook Cost CSV'));
} finally { fs.unlinkSync(panelPath); }

const pdf = createPaidWaybillProfitPdf(report, { facebook: '99999', tiktok: '', sourceName: 'Synthetic Facebook allocation QA', paymentBasis: 'auto', facebookAllocation: allocated });
assert(pdf.getNumberOfPages() >= 3);
if (process.argv[3]) { fs.mkdirSync(path.dirname(process.argv[3]), { recursive: true }); fs.writeFileSync(process.argv[3], Buffer.from(pdf.output('arraybuffer'))); }
console.log('PASS: Actual CSV parsing, exact CB codes, original lead dates, unique leads, paid/pending/lost/unmatched allocation, cents reconciliation, later payments, immutable orders, replacement imports, overlap rejection, stale versions, native encrypted R2 persistence, private API permissions, concurrent catalog edits, existing report UI and matching PDF totals.');
