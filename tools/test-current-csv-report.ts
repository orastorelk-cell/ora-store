import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import React from 'react';
import { build } from 'esbuild';
import { currentFacebookCsv, allocateCurrentCsvCosts, currentCsvProfitSummary } from '../src/lib/currentCsvProfit';
import { buildPaidWaybillProfitReport, parseProfitWaybillUpload, profitMoney } from '../src/lib/paidWaybillProfit';
import { parseFardarInvoicePayments } from '../src/lib/codPaymentImport';
import { FACEBOOK_AD_LEDGER_KEY } from '../src/lib/facebookProfitAds';
import { createPaidWaybillProfitPdf } from '../src/lib/paidWaybillProfitPdf';
import { dataBucket, importRecovery, readDataTable, replaceDataTable, activeData } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { profitOrderFixture, profitPurchaseFixture } from './profit-report-fixtures';

const csv = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : 'Campaign name,Ad set name,Result type,Results,Amount spent (LKR),Reporting starts,Reporting ends\nR0053,R0053,Leads (form),3,100.01,2026-09-26,2026-10-08\nCommercial,Commercial,ThruPlay,10,33.33,2026-09-26,2026-10-08';
const fb = currentFacebookCsv(csv, 'new-all-three-batches.csv');
const codes = [...new Set(fb.rows.flatMap(row => row.code ? [row.code] : []))];
let waybills: string[], orders: ReturnType<typeof profitOrderFixture>[];
if (process.argv[3]) {
  waybills = parseProfitWaybillUpload(fs.readFileSync(process.argv[3], 'utf8'));
  assert.equal(waybills.length, 263); assert.equal(new Set(waybills).size, 263);
  const payments = process.argv.slice(4, 7).map(file => parseFardarInvoicePayments(fs.readFileSync(file, 'utf8')));
  assert(payments.every(batch => batch.some(entry => waybills.includes(entry.waybill))), 'All three payment batches have selected waybills.');
  const entries = new Map(payments.flat().map(entry => [entry.waybill, entry]));
  assert(waybills.every(waybill => entries.has(waybill)), 'Every selected waybill exists in the three invoices.');
  orders = waybills.map((waybill, index) => {
    const entry = entries.get(waybill)!, returned = entry.status === 'returned', code = codes[index % codes.length];
    const bank = waybill === '18160373', amount = bank ? 1150 : entry.amount || 0;
    return profitOrderFixture({ id: 'synthetic-' + index, order_number: 'FB-QA-' + index, waybill_number: waybill, notes: 'Form: ' + code,
      platform_lead_id: String(100000 + index), platform_lead_created_at: fb.periods[0].from + 'T09:00:00Z', cod_payment_received: !returned && !bank, cod_payment_amount: !returned && !bank ? amount : undefined,
      payment_method: bank ? 'Bank Payment' : 'COD', payment_paid_type: bank ? 'Full' : 'COD', payment_status: returned ? 'Pending' : 'Paid',
      order_status: returned ? 'Cancelled' : 'Delivered', payment_received_amount: bank ? 1150 : undefined,
      total_amount: amount, subtotal: amount, delivery_fee: 0, fardar_delivery_fee: entry.delivery_fee,
      fardar_return_fee: returned ? entry.return_fee : undefined, fardar_invoice_status: returned ? 'Return Complete' : 'Delivered', fardar_invoice_waybill: waybill,
      items: [{ ...profitOrderFixture().items[0], main_sku: code, sku: code + '-TEST', variant_id: code, unit_price: amount, subtotal: amount }],
    } as any);
  });
  assert.equal(fb.totalSpend, 55048.68); assert.equal(fb.rows.length, 14);
} else {
  orders = Array.from({ length: 12 }, (_, index) => profitOrderFixture({ id: 'synthetic-' + index, order_number: 'FB-QA-' + index,
    waybill_number: '1816' + String(index + 1).padStart(4, '0'), notes: 'Form: R0053', platform_lead_id: String(100000 + index), platform_lead_created_at: fb.periods[0].from + 'T09:00:00Z',
    ...(index % 4 === 3 ? { cod_payment_received: false, order_status: 'Cancelled' as const, fardar_return_fee: 450, fardar_invoice_status: 'Return Complete', fardar_invoice_waybill: '1816' + String(index + 1).padStart(4, '0') } : {}),
  }));
  waybills = orders.map(order => order.waybill_number!);
}
const purchases = codes.map(code => profitPurchaseFixture({ id: code, sku: code + '-TEST', variant_sku: code + '-TEST', variant_id: code, quantity_added: 1000, unit_buying_price: 450, total_cost: 450000 }));
if (!process.argv[3]) purchases[0] = profitPurchaseFixture({ quantity_added: 1000, total_cost: 450000 });
const pendingOrders = codes.flatMap((code, index) => Array.from({ length: 10 }, (_, n) => profitOrderFixture({
  id: `pending-${index}-${n}`, order_number: `FB-PENDING-${index}-${n}`, platform_lead_id: String(200000 + index * 10 + n),
  platform_lead_created_at: fb.periods[0].from + 'T10:00:00Z', notes: 'Facebook Auto Lead | Form: ' + code + ' | Ad ID: 123',
  waybill_number: undefined, cod_payment_received: false, cod_payment_amount: undefined, payment_status: 'Pending', order_status: 'New Orders',
  fardar_invoice_status: undefined, fardar_invoice_waybill: undefined,
  items: [{ ...profitOrderFixture().items[0], main_sku: code, sku: code + '-TEST' }],
})));
orders = [...orders, ...pendingOrders];
const inputBefore = JSON.stringify({ orders, purchases });
const report = buildPaidWaybillProfitReport({ orders, purchases, waybills: [...waybills, waybills[0]] });
assert.equal(report.rows.length, waybills.length); assert.equal(report.totals.review, 0, JSON.stringify(report.rows.filter(row => row.profit === null).map(row => ({ waybill: row.waybill, issues: row.issues }))));
if (process.argv[3]) {
  assert.equal(report.rows.filter(row => row.outcome !== 'returned').length, 190);
  assert.equal(report.rows.filter(row => row.outcome === 'returned').length, 73);
  assert.equal(report.totals.courier, 83500); assert.equal(report.totals.returnFees, 32150); assert.equal(report.totals.packing, 19000);
  assert.equal(report.totals.received, 419290, 'All three invoice batches retain COD plus the bank payment.');
}
assert(report.rows.filter(row => row.outcome === 'returned').every(row => row.purchasing === 0 && row.packing === 0));
const allocation = allocateCurrentCsvCosts(fb, orders, report);
assert.equal(Math.round((allocation.assignedSpend + allocation.unassignedSpend) * 100), Math.round(fb.totalSpend * 100));
const summary = currentCsvProfitSummary(report, fb, '0', allocation);
assert.equal(summary.netProfit, Math.round((report.totals.beforeAds - allocation.assignedSpend) * 100) / 100, 'Only paid / returned shares are deducted. Pending cost is excluded.');
const changedDates = orders.map(order => ({ ...order, platform_lead_created_at: '2026-01-01T00:00:00Z' }));
assert.equal(allocateCurrentCsvCosts(fb, changedDates, report).missingOrderIds.length, waybills.length, 'Outside-period orders need matching current CSV dates; their costs are never silently zero.');
assert(allocation.pendingSpend > 0 && allocation.assignedSpend < fb.totalSpend);
assert.equal(Math.round((allocation.assignedSpend + allocation.pendingSpend + allocation.otherSpend + allocation.unmatchedSpend) * 100), Math.round(fb.totalSpend * 100));
const nextCsv = csv.replace(/2026-09-26/g, '2026-10-01').replace(/2026-10-08/g, '2026-10-12');
const next = currentFacebookCsv(nextCsv, 'next-only.csv');
assert(next.rows.every(row => row.from === '2026-10-01'));
assert.equal(currentCsvProfitSummary(report, next, '0', allocateCurrentCsvCosts(next, orders, report)).facebook, 0, 'There is no history argument to add previous Facebook costs.');
assert.equal(currentCsvProfitSummary(report, null, '0').netProfit, null);
assert.equal(currentCsvProfitSummary(report, fb, '-1', allocation).recordedCostProfit, null);
const withTikTok = { ...report, ranges: { ...report.ranges, TikTok: { from: '2026-09-01', to: '2026-10-12', count: 1 } } };
assert.equal(currentCsvProfitSummary(withTikTok, fb, '', allocation).recordedCostProfit, summary.netProfit, 'Profit after FB remains visible while this report\'s TikTok amount is missing.');
assert.equal(currentCsvProfitSummary(withTikTok, fb, '', allocation).netProfit, null, 'Missing TikTok expense is not claimed as final net profit.');
assert.equal(JSON.stringify({ orders, purchases }), inputBefore, 'Calculating never saves or changes payments, stock, purchases or returns.');

class MemoryBucket {
  objects = new Map<string, { value: string; etag: string; customMetadata?: any }>(); revision = 0; writes: string[] = []; beforePut?: (key: string) => Promise<void>;
  async get(key: string) { const value = this.objects.get(key); return value ? { text: async () => value.value, etag: value.etag, customMetadata: value.customMetadata } : null; }
  async put(key: string, value: string, options: any = {}) {
    await this.beforePut?.(key);
    const old = this.objects.get(key);
    if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches || options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    const etag = String(++this.revision); this.writes.push(key); this.objects.set(key, { value, etag, customMetadata: options.customMetadata }); return { etag };
  }
}
const raw = new MemoryBucket(), secret = 'synthetic-current-report-secret', env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: secret, ORA_R2_COMPRESSION_ENABLED: '1' };
const obsolete = { key: FACEBOOK_AD_LEDGER_KEY, payload: { format: 'ora-facebook-ad-costs-v1', version: 12, rows: [{ spend: 987654.32, fileName: 'obsolete-two-payment-batches.csv' }] } };
await importRecovery(dataBucket(env)!, { format: 'ora-r2-recovery-v1', orders, tables: { purchase_orders: purchases }, admin_data_store: [obsolete, { key: 'storefront-state-v1', payload: { version: 1, products: [], categories: [], settings: {} } }, { key: 'unrelated', payload: { value: 'preserved' } }],
  admin_users: [{ id: 'admin', role: 'admin', is_active: true }, { id: 'viewer', role: 'staff', is_active: true, permissions: ['profit_report', 'level:profit_report:view'] }], courier_waybills: [] });
const token = (id: string) => { const value = Buffer.from(JSON.stringify({ sub: id, role: id === 'admin' ? 'admin' : 'staff', exp: Date.now() + 60000 })).toString('base64url'); return value + '.' + crypto.createHmac('sha256', secret).update(value).digest('base64url'); };
const request = (method = 'GET', body?: unknown, auth = token('admin')) => withR2DataFallback(new Request('https://synthetic.test/api/admin/profit-ad-costs?includePurchases=1&reportOnly=1', { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, {}, async () => new Response('Unexpected bridge', { status: 599 }));
assert.equal((await request('GET', undefined, 'invalid')).status, 401);
const metaUnauth = await withR2DataFallback(new Request('https://synthetic.test/api/admin/profit-facebook-leads', { method: 'POST', body: JSON.stringify({ order_ids: [orders[0].id] }) }), env, {}, async () => new Response('Unexpected bridge', { status: 599 }));
assert.equal(metaUnauth.status, 401, 'The native Meta attribution route requires the current staff session.');
const metaUnconfigured = await withR2DataFallback(new Request('https://synthetic.test/api/admin/profit-facebook-leads', { method: 'POST', headers: { authorization: 'Bearer ' + token('admin') }, body: JSON.stringify({ order_ids: [orders[0].id] }) }), env, {}, async () => new Response('Unexpected bridge', { status: 599 }));
assert.equal(metaUnconfigured.status, 503, 'An unconfigured Meta connection is explicit; the route does not fall through to legacy persistence.');
const loaded = await (await request()).json() as any;
assert.deepEqual(loaded.ledger.rows, []); assert.equal(loaded.purchases.length, purchases.length);
const staleGet = await withR2DataFallback(new Request('https://synthetic.test/api/admin/profit-ad-costs?includePurchases=1', { headers: { authorization: 'Bearer ' + token('admin') } }), env, {}, async () => new Response('Unexpected bridge', { status: 599 }));
assert.equal(staleGet.status, 410, 'An old cached screen cannot calculate a misleading zero-FB profit; it must load the new flow.');
assert(!JSON.stringify(loaded).includes('obsolete-two-payment-batches') && !JSON.stringify(loaded).includes('987654.32'), 'Even a malformed historical ledger can never enter the new report.');
const protectedRecords = JSON.stringify({ orders: await readDataTable(env, 'order_snapshots'), purchases: await readDataTable(env, 'purchase_orders') });
assert.equal((await request('POST', { action: 'start-report' }, token('viewer'))).status, 403);
const active = (await activeData(dataBucket(env)!))!, adminKey = active.prefix + 'admin_data_store.json';
let interleaved = false;
raw.beforePut = async key => {
  if (key !== adminKey || interleaved) return; interleaved = true;
  await replaceDataTable(env, 'admin_data_store', rows => ({ rows: rows.map(row => row.key === 'unrelated' ? { ...row, payload: { value: 'concurrent-edit-preserved' } } : row), result: null }));
};
assert.equal((await request('POST', { action: 'start-report' })).status, 200);
const cleared = await readDataTable(env, 'admin_data_store');
assert.equal(cleared.find(row => row.key === FACEBOOK_AD_LEDGER_KEY)!.payload.rows.length, 0);
assert.equal(cleared.find(row => row.key === 'unrelated')!.payload.value, 'concurrent-edit-preserved');
raw.writes = [];
assert.equal((await request('POST', { action: 'start-report' })).status, 200); assert.equal(raw.writes.length, 0, 'Repeating the reset is idempotent.');
assert.equal((await request('POST', { csv, fileName: 'old-client.csv', expectedVersion: 13 })).status, 410, 'A stale browser can never save previous costs back.');
assert.equal(raw.writes.length, 0);
assert.equal(JSON.stringify({ orders: await readDataTable(env, 'order_snapshots'), purchases: await readDataTable(env, 'purchase_orders') }), protectedRecords);

// Stateful React test: file events, calculation, replacement, failure, refresh
// and remount. Use an optional external renderer in an isolated QA environment.
const renderer = await import(process.env.ORA_REACT_TEST_RENDERER || 'react-test-renderer');
const { act, create } = renderer;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const bundle = new URL('./.current-csv-report-ui.mjs', import.meta.url);
const originalFetch = globalThis.fetch, originalStorage = (globalThis as any).localStorage;
let metaFails = true;
let requests: any[] = [], accessedStorage: string[] = [], removedStorage: string[] = [];
(globalThis as any).localStorage = { getItem: (key: string) => { accessedStorage.push(key); return key === 'ora_staff_session_token' ? 'synthetic-ui-token' : JSON.stringify({ facebook: '987654.32', waybills, fileName: 'obsolete-two-payment-batches.csv' }); }, removeItem: (key: string) => { removedStorage.push(key); } };
(globalThis as any).__currentReportStore = { orders, products: [], purchaseOrders: purchases, returnRecords: [], sharedStoreReady: true, sharedOrdersReady: true, orderLoadError: '', adminUser: { id: 'synthetic-ui-admin', role: 'admin' }, refreshOrdersFromServer: async () => {} };
globalThis.fetch = async (url: any, options: any = {}) => {
  requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
  if (String(url).includes('/profit-facebook-leads')) {
    if (metaFails) return new Response(JSON.stringify({ error: 'Facebook ads permissions are missing.' }), { status: 403 });
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, results: body.order_ids.map((id: string) => {
      const order = orders.find(order => order.id === id)!;
      return { order_id: id, lead_id: order.platform_lead_id, created_at: order.platform_lead_created_at, ad_id: '111', adset_id: '222', campaign_id: '333' };
    }) }));
  }
  if (options.method === 'POST') { assert.equal(JSON.parse(options.body).action, 'start-report'); return new Response(JSON.stringify({ ok: true, cleared: true })); }
  return new Response(JSON.stringify({ ledger: obsolete.payload, purchases }));
};
let ui: any;
const words = (node: any): string => node.children.map((child: any) => typeof child === 'string' ? child : words(child)).join('');
const button = (label: string) => ui.root.findAllByType('button').find((node: any) => words(node) === label)!;
const content = () => JSON.stringify(ui.toJSON());
const changeFile = async (label: string, name: string, text: string | Promise<string>) => {
  const target = { value: name, files: [{ name, size: typeof text === 'string' ? Buffer.byteLength(text) : 1000, text: () => Promise.resolve(text) }] };
  await act(async () => { ui.root.findByProps({ 'aria-label': label }).props.onChange({ target }); await new Promise(resolve => setImmediate(resolve)); });
  assert.equal(target.value, '');
};
try {
  await build({ entryPoints: ['src/components/admin/ProfitReportPanel.tsx'], outfile: bundle.pathname, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    tsconfigRaw: { compilerOptions: { jsx: 'react' } }, jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'fixture-store', setup(builder) {
      builder.onResolve({ filter: /context\/StoreContext$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useStore = () => globalThis.__currentReportStore;', loader: 'js' }));
    } }] });
  const { ProfitReportPanel } = await import(bundle.href);
  await act(async () => { ui = create(React.createElement(ProfitReportPanel)); });
  assert(content().includes('Profit Report — New CSV Flow'));
  assert(!content().includes('987654.32') && !content().includes('obsolete-two-payment-batches'), 'Neither server history nor the old browser draft is displayed.');
  assert.equal(button('Calculate Profit').props.disabled, true);
  await changeFile('Current report waybill CSV', 'all-three-batches.csv', waybills.join('\n'));
  assert.equal(button('Calculate Profit').props.disabled, true, 'A fresh FB CSV is required for the new selection.');
  await changeFile('Current report Facebook CSV', fb.fileName, csv);
  assert(content().includes(profitMoney(fb.totalSpend))); assert.equal(button('Calculate Profit').props.disabled, false);
  assert(!content().includes('Allocated Net Profit — Selected Payment Batches'));
  await act(async () => { button('Calculate Profit').props.onClick(); });
  assert(content().includes('Profit for All ') && content().includes(String(waybills.length)));
  assert(content().includes(profitMoney(summary.netProfit!)), 'The actual component deducts selected shares and shows pending spend separately.');
  assert(content().includes('Pending leads — NOT deducted') && content().includes(profitMoney(allocation.pendingSpend)));
  assert.equal(ui.root.findByProps({ 'aria-label': 'Current CSV waybill profit' }).findAllByType('tbody')[0].findAllByType('tr').length, 10);
  await act(async () => { button('Verify Facebook Lead / Ad IDs').props.onClick(); await new Promise(resolve => setImmediate(resolve)); });
  assert(content().includes('ads permissions are missing') && content().includes(fb.fileName), 'Denied Meta reads preserve the current CSV and expose the actual failure.');
  assert.equal(button('Calculate Profit').props.disabled, false);
  metaFails = false;
  await act(async () => { button('Verify Facebook Lead / Ad IDs').props.onClick(); await new Promise(resolve => setImmediate(resolve)); });
  assert(content().includes(`Facebook verified ${orders.length} lead / ad identities.`));
  await act(async () => { button('Calculate Profit').props.onClick(); });
  assert(content().includes(profitMoney(summary.netProfit!)), 'Meta identity checks never add a previous CSV or change the available spend.');
  await act(async () => { button('Refresh System Records').props.onClick(); await new Promise(resolve => setImmediate(resolve)); });
  assert(content().includes(fb.fileName) && !content().includes('obsolete-two-payment-batches'), 'Refreshing financial data never brings an old FB report back.');
  await changeFile('Current report Facebook CSV', 'bad.csv', 'invalid csv');
  assert(!content().includes(fb.fileName) && !content().includes('Allocated Net Profit — Selected Payment Batches'));
  assert.equal(button('Calculate Profit').props.disabled, true, 'Invalid replacement clears prior cost and calculation instead of falling back.');
  let finishSlow!: (value: string) => void;
  const slow = new Promise<string>(resolve => { finishSlow = resolve; });
  await changeFile('Current report Facebook CSV', 'slow-previous.csv', slow);
  await changeFile('Current report Facebook CSV', 'newest-only.csv', nextCsv);
  await act(async () => { finishSlow(csv); await new Promise(resolve => setImmediate(resolve)); });
  assert(content().includes('newest-only.csv') && !content().includes('slow-previous.csv'), 'A late file-read completion cannot overwrite the newest selected CSV.');
  await changeFile('Current report waybill CSV', 'changed-payment-set.csv', waybills.slice(0, 4).join('\n'));
  assert(!content().includes('newest-only.csv')); assert.equal(button('Calculate Profit').props.disabled, true, 'Changing payment batches requires a new matching FB CSV.');
  await act(async () => { ui.unmount(); ui = create(React.createElement(ProfitReportPanel)); });
  assert(!content().includes('Full CSV spend:') && button('Calculate Profit').props.disabled, 'Reopening the report starts without any previous Facebook cost.');
  assert(accessedStorage.every(key => key === 'ora_staff_session_token'), 'No previous report inputs are read from or written to browser storage.');
  assert(removedStorage.includes('ora_paid_waybill_profit_v2:synthetic-ui-admin'), 'The legacy browser draft is removed.');
  assert(requests.filter(request => request.method === 'POST').every(request => request.body.action === 'start-report' || request.url.includes('/profit-facebook-leads') && Array.isArray(request.body.order_ids) && !request.body.csv), 'No Facebook CSV or expense is submitted for persistence.');
} finally {
  if (ui) await act(async () => { ui.unmount(); });
  globalThis.fetch = originalFetch; (globalThis as any).localStorage = originalStorage; delete (globalThis as any).__currentReportStore;
  if (fs.existsSync(bundle)) fs.unlinkSync(bundle);
}
if (process.argv[7]) fs.writeFileSync(process.argv[7], Buffer.from(createPaidWaybillProfitPdf(report, { facebook: String(fb.totalSpend), tiktok: '0', sourceName: 'Synthetic financial QA | All three invoice batches | Current CSV only', paymentBasis: 'auto', facebookReportingPeriods: fb.periods, currentFacebookCsv: fb, currentCsvAllocation: allocation }).output('arraybuffer')));
console.log('PASS: all three payment batches, current CSV paid / returned shares only; pending cost reserved, all selected waybills retained, return fee once/no return packing, actual React calculation, replacement/failure/race/reset/remount, no old browser or server costs, encrypted R2 cleanup, blocked stale expense saves, exact cents and unchanged financial records.');
