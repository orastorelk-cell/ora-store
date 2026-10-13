import assert from 'node:assert/strict';
import { currentFacebookCsv, allocateCurrentCsvCosts, currentCsvProfitSummary } from '../src/lib/currentCsvProfit';
import { buildPaidWaybillProfitReport } from '../src/lib/paidWaybillProfit';
import { profitFacebookLeadMatch } from '../worker/profitFacebookLeadMatch';
import { profitOrderFixture, profitPurchaseFixture } from './profit-report-fixtures';

const csv = currentFacebookCsv('Campaign name,Ad set name,Delivery level,Ad ID,Result type,Results,Amount spent (LKR),Reporting starts,Reporting ends\nR0053,One,ad,111,Leads (form),2,100,2026-10-01,2026-10-08\nR0053,Two,ad,222,Leads (form),2,300,2026-10-01,2026-10-08\nCommercial,Promo,ad,333,ThruPlay,500,80,2026-10-01,2026-10-08', 'current-only.csv');
const make = (id: string, ad: string, state: 'paid' | 'pending' | 'returned') => profitOrderFixture({
  id, order_number: 'FB-' + id, platform_lead_id: id, platform_ad_id: ad, platform_lead_created_at: '2026-10-02T09:00:00Z',
  notes: 'Facebook Auto Lead | Form: R0053 | Ad ID: ' + ad,
  waybill_number: '1816' + id, cod_payment_received: state === 'paid', order_status: state === 'paid' ? 'Delivered' : state === 'returned' ? 'Cancelled' : 'New Orders',
  payment_status: state === 'paid' ? 'Paid' : 'Pending',
  ...(state === 'returned' ? { fardar_return_fee: 450, fardar_invoice_status: 'Return Complete', fardar_invoice_waybill: '1816' + id } : {}),
});
const orders = [make('0001', '111', 'paid'), make('0002', '111', 'pending'), make('0003', '222', 'returned'), make('0004', '222', 'pending')];
const purchases = [profitPurchaseFixture({ quantity_added: 100, total_cost: 45000 })];
const build = (source = orders, waybills = ['18160001', '18160003']) => buildPaidWaybillProfitReport({ orders: source, purchases, waybills });
const before = JSON.stringify(orders), report = build(), allocated = allocateCurrentCsvCosts(csv, orders, report);
assert.equal(report.totals.review, 0);
assert.equal(allocated.orderCosts.get('0001')?.total, 70, 'Ad 111: 100 / 2 + 80 / 4, not cost from another ad with the same product code.');
assert.equal(allocated.orderCosts.get('0003')?.total, 170, 'Returned ad 222: 300 / 2 + 80 / 4, exactly once.');
assert.equal(allocated.assignedSpend, 240); assert.equal(allocated.pendingSpend, 240); assert.equal(allocated.unmatchedSpend, 0);
assert.equal(currentCsvProfitSummary(report, csv, '0', allocated).netProfit, report.totals.beforeAds - 240);
assert.equal(report.rows.find(row => row.orderId === '0003')?.packing, 0); assert.equal(report.rows.find(row => row.orderId === '0003')?.purchasing, 0);

const confirmed = orders.map(order => order.id === '0002' ? { ...order, order_status: 'Processing' as const } : order);
assert.equal(allocateCurrentCsvCosts(csv, confirmed, build(confirmed)).pendingSpend, 240, 'Confirmation alone does not deduct pending acquisition cost.');
const paidLater = orders.map(order => order.id === '0002' ? { ...order, order_status: 'Delivered' as const, cod_payment_received: true, payment_status: 'Paid' as const, cod_payment_received_at: '2026-10-15T09:00:00Z' } : order);
const later = allocateCurrentCsvCosts(csv, paidLater, build(paidLater, ['18160001', '18160002', '18160003']));
assert.equal(later.assignedSpend, 310); assert.equal(later.pendingSpend, 170, 'The original lead-date cost moves from pending to paid when payment arrives a week later.');
assert.equal(later.orderCosts.get('0001')?.total, 70, 'Other paid lead cost does not change when a pending order is paid.');
const onlyOne = allocateCurrentCsvCosts(csv, orders, build(orders, ['18160001']));
assert.equal(onlyOne.assignedSpend, 70); assert.equal(onlyOne.pendingSpend, 240); assert.equal(onlyOne.otherSpend, 170);
const unmatchedInput = { ...csv, rows: csv.rows.map(row => row.entityId === '111' ? { ...row, leads: 4 } : row) };
const unmatched = allocateCurrentCsvCosts(unmatchedInput, orders, report);
assert.equal(unmatched.orderCosts.get('0001')?.item, 25); assert(unmatched.unmatchedSpend > 0, 'Missing system leads do not shift their cost onto paid orders.');
const duplicates = [...orders, { ...orders[0], id: 'duplicate', order_number: 'FB-DUPLICATE', waybill_number: '18169999' }];
const duplicateAllocation = allocateCurrentCsvCosts(csv, duplicates, build(duplicates));
assert(duplicateAllocation.issues.some(issue => issue.includes('same Facebook Lead ID')));
assert.equal(currentCsvProfitSummary(report, csv, '0', duplicateAllocation).netProfit, null);
const outside = orders.map(order => order.id === '0001' ? { ...order, platform_lead_created_at: '2026-09-23T09:00:00Z' } : order);
const uncovered = allocateCurrentCsvCosts(csv, outside, build(outside));
assert.deepEqual(uncovered.missingOrderIds, ['0001']); assert.equal(currentCsvProfitSummary(build(outside), csv, '0', uncovered).netProfit, null);
assert(!uncovered.orderCosts.has('0001'), 'Uncovered historical orders must not receive a zero-cost match.');
const ambiguous = orders.map(order => order.id === '0001' ? { ...order, platform_ad_id: undefined, notes: 'Facebook Auto Lead | Form: R0053' } : order);
assert(allocateCurrentCsvCosts(csv, ambiguous, build(ambiguous)).missingOrderIds.includes('0001'), 'Two ads for one code require the ad identity.');
const validRepeatCustomer = orders.map(order => order.id === '0002' ? { ...order, is_duplicate_order: true, duplicate_of_order_id: 'older-customer-order' } : order);
assert.equal(allocateCurrentCsvCosts(csv, validRepeatCustomer, build(validRepeatCustomer)).pendingSpend, 240, 'A pending repeat customer with a distinct real Lead ID still reserves acquisition cost.');
assert.equal(JSON.stringify(orders), before, 'No payments, stock or order data are changed by allocation.');

const env = { META_PAGE_ACCESS_TOKEN: 'synthetic-server-only-token', META_GRAPH_API_VERSION: 'v26.0' };
const api = (body: unknown, method = 'POST') => new Request('https://test.invalid/api/admin/profit-facebook-leads', { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
let reads = 0, calls = 0;
const readOrders = async () => { reads++; return orders; };
const fetcher: typeof fetch = async (input, init) => {
  calls++; const url = new URL(String(input));
  assert.equal(url.origin, 'https://graph.facebook.com'); assert.equal(url.searchParams.has('access_token'), false);
  assert.equal((init?.headers as any).authorization, 'Bearer synthetic-server-only-token');
  assert.equal(url.searchParams.get('fields'), 'id,created_time,ad_id,adset_id,campaign_id,is_organic');
  const id = url.pathname.split('/').at(-1)!;
  if (id === '0002') return new Response(JSON.stringify({ error: { code: 200, message: 'Private upstream error must not leak' } }), { status: 403 });
  return new Response(JSON.stringify({ id, created_time: '2026-10-02T09:00:00Z', ad_id: '111', adset_id: '444', campaign_id: '555', access_token: 'must-not-leak', field_data: [{ name: 'phone', values: ['private'] }] }));
};
assert.equal((await profitFacebookLeadMatch(api({ order_ids: ['0001'] }), env, { role: 'staff' }, readOrders, fetcher)).status, 403); assert.equal(reads, 0);
assert.equal((await profitFacebookLeadMatch(api({ order_ids: ['0001', '0001'] }), env, { role: 'admin' }, readOrders, fetcher)).status, 400);
assert.equal((await profitFacebookLeadMatch(api({ order_ids: ['unknown'] }), env, { role: 'admin' }, readOrders, fetcher)).status, 400); assert.equal(calls, 0);
const response = await profitFacebookLeadMatch(api({ order_ids: ['0001', '0002'] }), env, { role: 'staff', permissions: ['profit_report', 'level:profit_report:view'] }, readOrders, fetcher);
const result = await response.json() as any;
assert.equal(result.results[0].ad_id, '111'); assert.match(result.results[1].error, /#200/);
assert(!JSON.stringify(result).includes('token') && !JSON.stringify(result).includes('private') && !JSON.stringify(result).includes('Private upstream'), 'Only verified attribution IDs are returned, without customer fields or credentials.');
assert.equal(JSON.stringify(orders), before, 'Facebook verification is read-only.');
assert.equal((await profitFacebookLeadMatch(api({ order_ids: ['0001'] }), {}, { role: 'admin' }, readOrders, fetcher)).status, 503);
const missingIds = await profitFacebookLeadMatch(api({ order_ids: ['0001'] }), env, { role: 'admin' }, readOrders, async () => new Response(JSON.stringify({ id: '0001', created_time: '2026-10-02T09:00:00Z' })));
assert((await missingIds.json() as any).results[0].error, 'Missing ads permissions never produce a fake verified attribution.');
console.log('PASS: exact ad ID grouping, average costs, pending reserve, payment a week later, returns once, other paid batches, missing leads/dates/IDs, duplicate lead prevention, full cent reconciliation, protected read-only Meta verification and no private/token leaks.');
