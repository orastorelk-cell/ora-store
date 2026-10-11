import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { applyCodPaymentEntries, parseFardarInvoicePayments, prepareCodPaymentUpdate, validCodPaymentEntries } from '../src/lib/codPaymentImport';
import { allocateFacebookAdCosts, emptyFacebookAdLedger, facebookAllocatedAdvertisingSummary, facebookOrderAdvertisingCost, mergeFacebookAdLedger, parseFacebookAdCostCsv } from '../src/lib/facebookProfitAds';
import { buildPaidWaybillProfitReport, selectSavedPaidProfitOrders } from '../src/lib/paidWaybillProfit';
import { createPaidWaybillProfitPdf } from '../src/lib/paidWaybillProfitPdf';
import { prepareOrderSnapshotUpdate } from '../src/lib/orderSnapshotUpdate';
import { profitOrderFixture, profitPurchaseFixture } from './profit-report-fixtures';
import { dataBucket, importRecovery, readDataTable, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';

const filename = process.argv[2];
assert(filename, 'Pass the supplied mixed Fardar payment invoice CSV.');
const csv = fs.readFileSync(filename, 'utf8'), entries = parseFardarInvoicePayments(csv);
assert.equal(entries.length, 143); assert.equal(entries.filter(entry => entry.status === 'delivered').length, 70);
assert.equal(entries.filter(entry => entry.status === 'returned').length, 73);
const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
assert.equal(sum(entries.filter(entry => entry.status === 'delivered').map(entry => entry.amount!)), 153320);
assert.equal(sum(entries.filter(entry => entry.status === 'delivered').map(entry => entry.delivery_fee!)), 30850);
assert.equal(sum(entries.filter(entry => entry.status === 'returned').map(entry => entry.return_fee!)), 32150);
assert(entries.every(entry => entry.amount_basis === 'gross'));
assert.equal(validCodPaymentEntries(entries), false, 'Each native update is bounded to 20 entries.');
assert.throws(() => parseFardarInvoicePayments(csv.replace('450.00', 'bad-fee')), /Invalid/);
const inputs = entries.map((entry, index) => profitOrderFixture({ id: `invoice-${index}`, waybill_number: entry.waybill,
  order_number: `FB-${String(index + 1).padStart(6, '0')}`, total_amount: entry.amount || 1250,
  payment_status: 'Pending', cod_payment_received: false, cod_payment_amount: undefined, order_status: 'Shipped',
  cod_payment_received_at: undefined, fardar_delivery_fee: undefined,
  platform_lead_id: `invoice-lead-${index}`, platform_lead_created_at: '2026-09-01T09:00:00Z' }));
const before = JSON.stringify(inputs), applied = applyCodPaymentEntries(inputs, entries);
assert.equal(applied.updatedCount, 143); assert.equal(applied.notFound.length, 0);
assert.equal(JSON.stringify(inputs), before, 'Invoices never mutate their input orders.');
assert.equal(applied.orders.filter(order => order.cod_payment_received).length, 70, 'Returned rows cannot become COD Received.');
for (const order of applied.orders) {
  const original = inputs.find(input => input.id === order.id)!;
  for (const field of ['items', 'total_amount', 'stock_allocated', 'invoice_locked', 'invoice_number', 'order_status', 'waybill_number', 'return_sheet_id', 'return_received_at'] as const)
    assert.deepEqual(order[field], original[field], `${field} must not change during finance imports.`);
}
assert.equal(applyCodPaymentEntries(applied.orders, entries).updatedCount, 0);
const returnedOrders = applied.orders.filter(order => order.fardar_invoice_status === 'Return Complete');
assert.equal(selectSavedPaidProfitOrders(returnedOrders).length, 0);
const returnReport = buildPaidWaybillProfitReport({ orders: returnedOrders, purchases: [], waybills: [...returnedOrders.map(order => order.waybill_number!), returnedOrders[0].waybill_number!] });
assert.equal(returnReport.totals.ready, 73); assert.equal(returnReport.duplicates, 1);
assert.equal(returnReport.totals.beforeAds, -32150); assert.equal(returnReport.totals.returnFees, 32150);
assert.equal(returnReport.totals.purchasing, 0); assert.equal(returnReport.totals.packing, 0); assert.equal(returnReport.totals.courier, 0);
assert(returnReport.rows.every(row => row.outcome === 'returned' && row.received === 0 && row.purchasing === 0 && row.packing === 0 && row.profit === -row.returnFee!));
const missingFee = { ...returnedOrders[0], fardar_return_fee: undefined };
assert.match(buildPaidWaybillProfitReport({ orders: [missingFee], purchases: [], waybills: [missingFee.waybill_number!] }).rows[0].issues.join(' '), /Return Fee/);
const oldInvoice = prepareOrderSnapshotUpdate(returnedOrders[0], inputs.find(order => order.id === returnedOrders[0].id)!, []).order;
assert.equal(oldInvoice.fardar_return_fee, returnedOrders[0].fardar_return_fee, 'Stale order mirrors preserve confirmed return fees.');
assert.equal(oldInvoice.fardar_invoice_status, 'Return Complete');
const paidOriginal = inputs[0], paidSaved = applied.orders[0];
assert.equal(prepareOrderSnapshotUpdate(paidSaved, paidOriginal, []).order.cod_payment_received, true, 'A stale order mirror cannot undo the new receipt.');
assert.throws(() => prepareCodPaymentUpdate(returnedOrders[0], { ...entries[0], waybill: returnedOrders[0].waybill_number! }), /completed return/);

// A selected returned lead pays its own advertising once, and is removed from
// the sales' shared loss pool. Unselected cancelled leads still share normally.
const sale = applied.orders[0], returned = returnedOrders[0];
const cancelled = profitOrderFixture({ id: 'other-lost', order_number: 'FB-999999', waybill_number: 'OTHER-LOST',
  platform_lead_id: 'other-lost-lead', platform_lead_created_at: '2026-09-01T09:00:00Z', order_status: 'Cancelled', cod_payment_received: false });
const adCsv = 'Campaign name,Ad set name,Result type,Results,Amount spent (LKR),Reporting starts,Reporting ends\nORA R0053,SET R0053,Leads (form),4,400,2026-08-26,2026-09-22\nCommercial,Promotion,Messaging conversations started,10,80,2026-08-26,2026-09-22';
const ledger = mergeFacebookAdLedger(emptyFacebookAdLedger(), parseFacebookAdCostCsv(adCsv), { expectedVersion: 0, fileName: 'synthetic-ads.csv', importedAt: '2026-10-11T12:00:00Z', importedBy: 'Test' }).ledger;
const mixedOrders = [sale, returned, cancelled];
const mixed = buildPaidWaybillProfitReport({ orders: mixedOrders, purchases: [profitPurchaseFixture()], waybills: [sale.waybill_number!, returned.waybill_number!] });
const scope = { orderIds: mixed.rows.map(row => row.orderId!), reportingPeriods: [{ from: '2026-08-26', to: '2026-09-22' }] };
const ads = allocateFacebookAdCosts(ledger, mixedOrders, mixed, {}, scope);
assert.equal(ads.returnedCost, 100); assert.equal(ads.paidCost, 100);
assert.equal(ads.lossSpend, 100, 'The selected return ad is removed from the shared loss expense.');
assert.equal(ads.lostCost, 50); assert.equal(ads.commercialCost, 40);
assert.equal(ads.commercialCohorts[0].selectedReturned, 1);
assert.equal(facebookOrderAdvertisingCost(ads, returned.id), 120);
assert.equal(ads.orderCosts.get(returned.id)!.lossCost, 0, 'A return does not pay other failed leads or its own ad a second time.');
assert.equal(facebookOrderAdvertisingCost(ads, sale.id), 170);
const summary = facebookAllocatedAdvertisingSummary(mixed, ads, '0');
assert.equal(summary.netProfit, mixed.totals.beforeAds - 290);
assert.equal(sum(mixed.rows.map(row => row.profit! - facebookOrderAdvertisingCost(ads, row.orderId)!)), summary.netProfit);
const onlyReturn = buildPaidWaybillProfitReport({ orders: mixedOrders, purchases: [], waybills: [returned.waybill_number!] });
const returnAds = allocateFacebookAdCosts(ledger, mixedOrders, onlyReturn, {}, { ...scope, orderIds: [returned.id] });
assert.equal(facebookAllocatedAdvertisingSummary(onlyReturn, returnAds, '0').netProfit, -returned.fardar_return_fee! - 120);
assert.equal(returnAds.lostCost, 0);
if (process.argv[3]) fs.writeFileSync(process.argv[3], Buffer.from(createPaidWaybillProfitPdf(mixed, { facebook: '', tiktok: '0', sourceName: 'Synthetic sale and actual invoice return fee', paymentBasis: 'auto', facebookAllocation: ads, facebookReportingPeriods: scope.reportingPeriods }).output('arraybuffer')));

class MemoryBucket {
  objects = new Map<string, { value: string; etag: string; customMetadata?: any }>();
  revision = 0; writes: string[] = [];
  async get(key: string) { const value = this.objects.get(key); return value ? { text: async () => value.value, etag: value.etag, customMetadata: value.customMetadata } : null; }
  async put(key: string, value: string, options: any = {}) {
    const old = this.objects.get(key);
    if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches || options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    const etag = String(++this.revision); this.writes.push(key); this.objects.set(key, { value, etag, customMetadata: options.customMetadata }); return { etag };
  }
}
const raw = new MemoryBucket(), secret = 'synthetic-courier-payment-test-only', env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: secret, ORA_R2_COMPRESSION_ENABLED: '1' };
const catalog = { key: 'storefront-state-v1', payload: { version: 1, products: [{ id: 'watch', stock_quantity: 55 }], settings: {}, categories: [] } };
await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders: inputs, tables: {}, admin_data_store: [catalog], courier_waybills: [],
  admin_users: [{ id: 'admin', role: 'admin', is_active: true }, { id: 'payments', role: 'staff', is_active: true, permissions: ['cod_payments'] },
    { id: 'viewer', role: 'staff', is_active: true, permissions: ['cod_payments', 'level:cod_payments:view'] }, { id: 'other', role: 'staff', is_active: true, permissions: ['orders'] }, { id: 'disabled', role: 'admin', is_active: false }] });
const token = (id: string) => { const payload = Buffer.from(JSON.stringify({ sub: id, role: id === 'admin' ? 'admin' : 'staff', exp: Date.now() + 60000 })).toString('base64url'); return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url'); };
const request = async (batch: unknown, id = 'admin', auth = token(id)) => {
  const response = await withR2DataFallback(new Request('https://synthetic.test/api/orders/courier-payments', { method: 'POST', headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' }, body: JSON.stringify({ entries: batch }) }), env, {}, async () => new Response('Unexpected bridge', { status: 599 }));
  return { status: response.status, body: await response.json() as any };
};
assert.equal((await request(entries.slice(0, 20), 'admin', 'invalid')).status, 401);
assert.equal((await request(entries.slice(0, 20), 'disabled')).status, 401);
assert.equal((await request(entries.slice(0, 20), 'other')).status, 403);
assert.equal((await request(entries.slice(0, 20), 'viewer')).status, 403);
assert.equal((await request(entries)).status, 400);
assert.equal((await request([{ ...entries[0], amount: -1 }])).status, 400);
const stockBefore = JSON.stringify(await readDataTable(env, 'admin_data_store'));
let count = 0;
for (let offset = 0; offset < entries.length; offset += 20) {
  const result = await request(entries.slice(offset, offset + 20), 'payments');
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.notFound.length, 0);
  count += result.body.updatedCount;
}
assert.equal(count, 143);
assert.equal(JSON.stringify(await readDataTable(env, 'admin_data_store')), stockBefore);
const persisted = (await readDataTable(env, 'order_snapshots')).map(row => row.payload);
assert.deepEqual(persisted.map(order => [order.cod_payment_amount, order.fardar_delivery_fee, order.fardar_return_fee, order.fardar_invoice_status]), applied.orders.map(order => [order.cod_payment_amount, order.fardar_delivery_fee, order.fardar_return_fee, order.fardar_invoice_status]));
const writesBefore = raw.writes.length;
for (let offset = 0; offset < entries.length; offset += 20) assert.equal((await request(entries.slice(offset, offset + 20))).body.updatedCount, 0);
assert.equal(raw.writes.length, writesBefore, 'Re-uploading all 143 rows performs no new writes or deductions.');
const parallel = await Promise.all([request([{ ...entries[0], delivery_fee: 401 }]), request([{ ...entries[1], delivery_fee: 402 }])]);
assert(parallel.every(result => result.status === 200), JSON.stringify(parallel));
const concurrent = (await readDataTable(env, 'order_snapshots')).map(row => row.payload);
assert.equal(concurrent[0].fardar_delivery_fee, 401); assert.equal(concurrent[1].fardar_delivery_fee, 402);
await replaceDataTable(env, 'order_snapshots', rows => ({ rows: rows.map(row => row.order_id === sale.id ? { ...row, payload: { ...row.payload, notes: 'New staff note' } } : row), result: null }));
assert.equal((await request([entries[0]])).body.orders[0].notes, 'New staff note', 'Imports read the server order rather than a stale browser snapshot.');
assert.deepEqual((await request([{ ...entries[0], waybill: 'NOT-IN-SYSTEM' }])).body.notFound, ['NOT-IN-SYSTEM']);
assert.equal((await request([entries[0], { ...entries[0], amount: 999 }])).status, 503, 'Conflicting duplicate rows cannot silently choose a payment.');

// Exercise the actual file-selection callbacks through the rendered components.
// A Fardar upload must save without a second Import click or paid-waybill list.
const mutableReact = React as any, originalCreateElement = mutableReact.createElement;
const captured = new Map<string, any>();
mutableReact.createElement = (type: any, props: any, ...children: any[]) => {
  if (type === 'input' && props?.['aria-label']) captured.set(props['aria-label'], props);
  return originalCreateElement(type, props, ...children);
};
const globalFixture = globalThis as any;
let selectedRows: any[] = [];
globalFixture.__courierPaymentStore = { orders: [], adminUser: { role: 'admin', name: 'Test' }, recordCodPayments: async (rows: any[]) => {
  selectedRows = rows;
  return { updatedCount: rows.length, unchangedCount: 0, payments: 70, returns: 73, notFound: [] };
} };
const tempBundles: string[] = [];
try {
  const compile = async (entry: string) => {
    const output = path.resolve('tools/.courier-ui-' + tempBundles.length + '.mjs'); tempBundles.push(output);
    await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external',
      tsconfigRaw: { compilerOptions: { jsx: 'react' } }, jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
      plugins: [{ name: 'fixture-store', setup(builder) {
        builder.onResolve({ filter: /context\/StoreContext$/ }, () => ({ path: 'fixture-store', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useStore = () => globalThis.__courierPaymentStore;', loader: 'js' }));
      } }] });
    return import(output);
  };
  const panel = await compile('src/components/admin/CodPaymentsPanel.tsx');
  renderToStaticMarkup(React.createElement(panel.CodPaymentsPanel));
  const input = captured.get('Fardar COD payment CSV'); assert(input && !input.disabled);
  const upload = { value: filename, files: [{ name: '280258_20732_client_invoice.csv', size: Buffer.byteLength(csv), text: async () => csv }] };
  input.onChange({ target: upload });
  for (let attempt = 0; attempt < 10 && !selectedRows.length; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(selectedRows, entries, 'Choosing the supplied CSV automatically submits all 143 rows.');
  assert.equal(upload.value, '', 'The same file can be selected again safely.');
  const profit = await compile('src/components/admin/ProfitReportPanel.tsx');
  selectedRows = [];
  const html = renderToStaticMarkup(React.createElement(profit.ProfitReportWorkspace, { orders: mixedOrders, purchases: [profitPurchaseFixture()], returns: [], ready: true,
    storageKey: 'fixture-courier-ui', onRefresh: async () => {}, canImportAds: true, useUploadedWaybills: true, advertisingLedger: ledger,
    initialDraft: { paymentFilter: 'all', fromDate: '', toDate: '', facebook: '', tiktok: '0', paymentBasis: 'auto', waybills: [sale.waybill_number, returned.waybill_number], facebookPeriods: ['2026-08-26|2026-09-22'] },
    onImportFardar: globalFixture.__courierPaymentStore.recordCodPayments }));
  assert(html.includes('Return fee · once') && html.includes('Return fee + FB cost only'));
  assert(html.includes('Rs. -570.00') && html.includes('Returned — no Purchasing deduction'));
  const profitInput = captured.get('Fardar invoice CSV file');
  profitInput.onChange({ target: { ...upload, value: filename } });
  for (let attempt = 0; attempt < 10 && !selectedRows.length; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(selectedRows.length, 143, 'Invoice imports are not restricted to already-paid or selected waybills.');
} finally {
  mutableReact.createElement = originalCreateElement; delete globalFixture.__courierPaymentStore;
  for (const file of tempBundles) fs.unlinkSync(file);
}
console.log('PASS: actual 70 delivered / 73 returned rows, payments Rs153320, delivery Rs30850, return fees Rs32150, authenticated native batches, zero stock / invoice changes, idempotent retries, concurrent updates, return-only loss, and no double-counted Facebook cost.');
