import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {configureCloudflareData, dataBucket, importRecovery, readDataTable, replaceDataTable} from '../worker/cloudflareData';
import {facebookMissingOrdersHandler} from '../worker/facebookMissingOrders';
import {facebookLeadAuditHandler} from '../worker/facebookLeadAudit';
import {compareFacebookLeads, facebookSheetGroups, FACEBOOK_MISSING_API} from '../src/lib/facebookMissingOrders';
import {scanMissingFacebookLeads} from '../src/lib/facebookMissingClient';
import {buildOrderSheetRow} from '../src/lib/googleSheets';
import {prepareOrderSnapshotUpdate} from '../src/lib/orderSnapshotUpdate';
import {acquireFacebookSheetWriteLock, isFacebookSheetWrite} from '../worker/facebookSheetWriteLock';

class Bucket {
  objects = new Map<string, {value: string; etag: string}>(); revision = 0;
  async get(key: string) {const value = this.objects.get(key); await Promise.resolve(); return value ? {...value, text: async () => value.value} : null;}
  async put(key: string, value: string, options: any = {}) {
    const old = this.objects.get(key);
    if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches || options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    const next = {value, etag: String(++this.revision)}; this.objects.set(key, next); return {etag: next.etag};
  }
}
const time = new Date(Date.now() - 3600000).toISOString();
const lead = (id: string) => ({lead_id: id, form_id: 'form', created_at: time});
const product = {id: 'product', sku: 'MAT', name_en: 'Fixture mat', selling_price: 1200, buying_price: 400, stock_quantity: 50, status: 'Active'};
const item = {product_id: 'product', sku: 'MAT', main_sku: 'MAT', product_name: 'Fixture mat', product_type: 'normal', quantity: 2, unit_price: 900, regular_unit_price: 900, subtotal: 1800};
const initial = (id: string, number: string, extra: any = {}) => ({id: 'fb-lead-' + id, platform_lead_id: id, order_number: number, order_source: 'Facebook Ads',
  customer_name: '=SUM(1,2)', phone: '0771234567', whatsapp: '0771234567', address: 'Fixture address', city: 'Colombo', district: 'Colombo',
  created_at: time, items: [structuredClone(item)], subtotal: 1800, delivery_fee: 250, total_amount: 2050, special_offer_discount: 0,
  payment_method: 'COD', payment_status: 'Pending', order_status: 'New Orders', call_center_status: 'Pending', stock_allocated: false, stock_status: 'Waiting for Stock', ...extra});
const headers = Object.keys(buildOrderSheetRow(initial('x', 'FB-000001'), item, true, {})).filter(key => !['regular_unit_price', 'supplier_offer_discount_per_unit'].includes(key));
const line = (id: string, number: string, extra: any = {}) => {
  const row = {...buildOrderSheetRow(initial(id, number), item, true, {}), ...extra}; return headers.map(key => String(row[key] ?? ''));
};
const fixture = async (options: any = {}) => {
  const raw = new Bucket(), env: any = {ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: 'fixture-missing-secret', META_PAGE_ACCESS_TOKEN: 'private-meta-token'};
  configureCloudflareData(env);
  const settings = {delivery_fee: 250}, rows = options.rows || [headers], savedOrders = options.orders || [];
  const catalog = {version: 1, products: [structuredClone(product)], settings};
  await importRecovery(dataBucket(env)!, {format: 'ora-r2-recovery-v1', orders: savedOrders.length ? savedOrders : [initial('fixture-seed', 'FB-000001')],
    admin_users: [{id: 'admin', role: 'admin', is_active: true}, {id: 'staff', role: 'staff', is_active: true}, {id: 'disabled', role: 'admin', is_active: false}],
    admin_data_store: [{key: 'storefront-state-v1', payload: catalog}, ...(options.admin || [])], courier_waybills: options.waybills || [{waybill_number: 'AVAILABLE', status: 'Available'}]});
  if (!savedOrders.length) await replaceDataTable(env, 'order_snapshots', () => ({rows: [], result: true}));
  const suffix = crypto.randomUUID(), rsa = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
  const connection = {spreadsheet_id: 'fixtureSpreadsheetId_' + suffix, tabs: ['CALL CENTER ORDERS'], client_email: 'ora@fixture.iam.gserviceaccount.com',
    private_key: rsa.privateKey.export({type: 'pkcs8', format: 'pem'}).toString(), private_key_id: suffix, connected_at: time};
  if (!options.disconnected) await dataBucket(env)!.put('ora-data/google-sheets-connection-v1.json', JSON.stringify(connection));
  let writes = 0, sheetReads = 0, lost = false, failRead = false, failMeta = false, metaPages = 0;
  let beforeAppend: (() => Promise<void>) | undefined, beforeRead: (() => Promise<void>) | undefined;
  const network: typeof fetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'graph.facebook.com') {
      assert.equal(init.headers.authorization, 'Bearer private-meta-token');
      if (failMeta) return Response.json({error: {code: 4}}, {status: 429});
      const id = url.pathname.split('/').pop();
      if (id === 'me') return Response.json({id: 'page'});
      if (id === 'leadgen_forms') {metaPages++; return Response.json(url.searchParams.get('after') ? {data: [{id: 'form-2', name: 'MAT second form'}]} : {data: [{id: 'form', name: 'MAT fixture'}], paging: {next: 'present', cursors: {after: 'next-form'}}});}
      if (id === 'form' || id === 'form-2') return Response.json({id, name: 'MAT fixture', page_id: options.foreign ? 'another-page' : 'page'});
      if (id === 'leads') {const formId = url.pathname.split('/').at(-2); return Response.json({data: formId === 'form-2' ? [] : [{id: 'scanned', created_time: time}, {id: 'old', created_time: new Date(Date.now() - 40 * 86400000).toISOString()}]});}
      return Response.json({id, form_id: options.wrongForm ? 'another-form' : 'form', created_time: time, field_data: [
        {name: 'full_name', values: ['Fixture customer']}, {name: 'phone_number', values: ['0771234567']}, {name: 'address', values: ['Fixture address']},
        {name: 'city', values: ['Colombo']}, {name: 'district', values: ['Colombo']}, {name: 'quantity', values: ['2']},
      ]});
    }
    if (url.hostname === 'oauth2.googleapis.com') {
      const token = new URLSearchParams(String(init.body)).get('assertion')!, parts = token.split('.');
      assert(crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), rsa.publicKey, Buffer.from(parts[2], 'base64url')));
      return Response.json({access_token: 'fixture-access', expires_in: 3600});
    }
    assert.equal(url.hostname, 'sheets.googleapis.com', 'Synthetic tests never contact live services');
    assert.equal(init.headers.authorization, 'Bearer fixture-access');
    if (url.pathname.endsWith('/values:batchGet')) {
      sheetReads++; if (beforeRead) {const callback = beforeRead; beforeRead = undefined; await callback();}
      if (failRead) return Response.json({error: {}}, {status: 503});
      return Response.json({valueRanges: [{values: structuredClone(rows)}]});
    }
    if (url.pathname.endsWith(':batchUpdate')) {
      writes++; if (beforeAppend) await beforeAppend();
      const body = JSON.parse(init.body);
      for (const request of body.requests) {
        assert.deepEqual(Object.keys(request), ['appendCells'], 'Existing Sheet rows must never be rewritten');
        assert.equal(request.appendCells.fields, 'userEnteredValue');
        for (const row of request.appendCells.rows) rows.push(row.values.map((cell: any) => {
          assert(!('formulaValue' in cell.userEnteredValue)); const value = cell.userEnteredValue; return String(value.stringValue ?? value.numberValue ?? value.boolValue);
        }));
      }
      if (lost) {lost = false; return Response.json({error: {}}, {status: 503});}
      return Response.json({replies: [{}]});
    }
    return Response.json({spreadsheetId: connection.spreadsheet_id, sheets: [{properties: {sheetId: 1, title: 'CALL CENTER ORDERS', gridProperties: {columnCount: headers.length, rowCount: 1000}}}]});
  };
  const token = (user: string) => {const payload = Buffer.from(JSON.stringify({sub: user, exp: Date.now() + 600000})).toString('base64url'); return payload + '.' + crypto.createHmac('sha256', env.STAFF_SESSION_SECRET).update(payload).digest('base64url');};
  const call = async (body: any, user = 'admin', audit = false) => {
    const request = new Request('https://fixture' + (audit ? '/api/admin/facebook-leads/audit' : FACEBOOK_MISSING_API), {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token(user)}, body: JSON.stringify(body)});
    const response = await (audit ? facebookLeadAuditHandler(request, env, network) : facebookMissingOrdersHandler(request, env, network));
    return {status: response!.status, data: await response!.json() as any};
  };
  return {env, raw, catalog, rows, network, call, orders: async () => (await readDataTable(env, 'order_snapshots')).map(row => row.payload),
    writes: () => writes, reads: () => sheetReads, metaPages: () => metaPages, lose: () => {lost = true;}, failSheet: () => {failRead = true;}, failMeta: () => {failMeta = true;},
    beforeRead: (callback: () => Promise<void>) => {beforeRead = callback;}, beforeAppend: (callback: () => Promise<void>) => {beforeAppend = callback;}};
};
const input = (...ids: string[]) => ({action: 'import', page_id: 'page', leads: ids.map(lead)});
const f = await fixture({orders: [initial('existing', 'FB-000050', {stock_allocated: true, invoice_locked: true, invoice_number: 'INV-KEEP', waybill_number: 'WB-KEEP', call_center_status: 'Confirmed', order_status: 'Processing'})],
  rows: [headers, line('original', 'FB-000348', {'Customer Name': 'Edited Sheet name', Qty: 2, 'Unit Price (Rs)': 900, 'Line Total (Rs)': 1800})]});
for (const [user, status] of [['unknown', 401], ['disabled', 401], ['staff', 403]] as const) assert.equal((await f.call({action: 'snapshot'}, user)).status, status);
const beforeCatalog = await readDataTable(f.env, 'admin_data_store'), beforeWaybills = await readDataTable(f.env, 'courier_waybills'), existing = structuredClone((await f.orders())[0]);
const readOnly = await f.call({action: 'snapshot'}); assert.equal(readOnly.status, 200); assert.equal(f.writes(), 0); assert.deepEqual(await f.orders(), [existing]);
assert(!JSON.stringify(readOnly).includes('PRIVATE KEY')); assert(!JSON.stringify(readOnly).includes('private-meta-token'));
const checks = compareFacebookLeads(['original', 'existing', 'both'].map(lead), readOnly.data.snapshot);
assert.deepEqual(checks.map(row => [row.system_found, row.sheet_found, row.can_import]), [[false, true, true], [true, false, true], [false, false, true]]);
const originalSheet = structuredClone(f.rows);
const imported = await f.call(input('original', 'existing', 'both')); assert.equal(imported.status, 200, JSON.stringify(imported));
assert(imported.data.results.every((row: any) => row.ok), JSON.stringify(imported));
assert.deepEqual(f.rows.slice(0, 2), originalSheet, 'Human-edited Sheet rows are preserved');
const orders = await f.orders(), restored = orders.find(order => order.platform_lead_id === 'original')!, pending = orders.find(order => order.platform_lead_id === 'both')!;
assert.equal(restored.order_number, 'FB-000348'); assert.equal(restored.customer_name, 'Edited Sheet name'); assert.equal(restored.items[0].unit_price, 900); assert.equal(restored.items[0].quantity, 2);
assert.deepEqual(prepareOrderSnapshotUpdate(restored, initial('original', 'FB-000999'), []).order, restored, 'An in-flight auto webhook cannot replace recovered original Order IDs / Sheet edits');
for (const order of [restored, pending]) {assert.equal(order.stock_allocated, false); assert.equal(order.call_center_status, 'Pending'); assert(!order.waybill_number); assert(!order.invoice_locked); assert.equal(order.facebook_missing_recovery.phase, 'complete');}
for (const key of Object.keys(existing)) if (!['is_synced_google_sheets', 'synced_at'].includes(key)) assert.deepEqual(orders.find(order => order.id === existing.id)![key], existing[key]);
assert.deepEqual(await readDataTable(f.env, 'admin_data_store'), beforeCatalog); assert.deepEqual(await readDataTable(f.env, 'courier_waybills'), beforeWaybills);
const count = f.rows.length, writes = f.writes();
assert((await f.call(input('original', 'existing', 'both'))).data.results.every((row: any) => row.ok)); assert.equal(f.rows.length, count); assert.equal(f.writes(), writes);

// Lost acknowledgment after Google accepted the write: repeat reads physical
// rows and stable Lead ID, without duplicating either destination.
const lost = await fixture(); lost.lose();
const uncertain = await lost.call(input('lost')); assert.equal(uncertain.data.results[0].ok, false); assert.equal((await lost.orders()).length, 1); assert.equal(lost.rows.length, 2);
const retry = await lost.call(input('lost')); assert.equal(retry.data.results[0].ok, true); assert.equal(lost.writes(), 1); assert.equal((await lost.orders()).length, 1);

const cancelled = await fixture({rows: [headers, line('cancelled', 'FB-000125', {'Order Action': 'CANCEL ENTIRE ORDER'})]});
assert.equal((await cancelled.call(input('cancelled'))).data.results[0].ok, true);
assert.equal((await cancelled.orders())[0].order_status, 'Cancelled'); assert.equal((await cancelled.orders())[0].call_center_status, 'Cancelled'); assert.equal(cancelled.writes(), 0);
const savedCancellation = await fixture({rows: [headers, line('saved-cancelled', 'FB-000128', {'Imported Status': 'Cancelled', 'Cancel Reason': 'Original cancellation'})]});
assert.equal((await savedCancellation.call(input('saved-cancelled'))).data.results[0].ok, true);
assert.equal((await savedCancellation.orders())[0].order_status, 'Cancelled'); assert.equal((await savedCancellation.orders())[0].cancel_reason, 'Original cancellation');
const parcel = await fixture({rows: [headers, line('parcel', 'FB-000126')], waybills: [{waybill_number: 'OLD-WB', status: 'Assigned', assigned_order_number: 'FB-000126'}]});
assert.equal((await parcel.call(input('parcel'))).data.results[0].ok, false); assert.equal((await parcel.orders()).length, 0); assert.equal(parcel.writes(), 0);
const orphan = await fixture({rows: [headers, line('', 'FB-000127')]});
assert.equal((await orphan.call(input('new'))).data.results[0].ok, false); assert.equal((await orphan.orders()).length, 0);
const conflict = await fixture({orders: [initial('same', 'FB-000001'), initial('same', 'FB-000002', {id: 'duplicate'})]});
assert.equal((await conflict.call(input('same'))).data.results[0].ok, false); assert.equal(conflict.writes(), 0);
const partial = await fixture({orders: [initial('partial', 'FB-000001', {items: [item, item]})], rows: [headers, line('partial', 'FB-000001')]});
assert.equal((await partial.call(input('partial'))).data.results[0].ok, false); assert.equal(partial.writes(), 0);
const mismatchedNumber = await fixture({orders: [initial('number', 'FB-000001')], rows: [headers, line('number', 'FB-000002')]});
assert.equal((await mismatchedNumber.call(input('number'))).data.results[0].ok, false); assert.equal(mismatchedNumber.writes(), 0);
const foreign = await fixture({foreign: true}); assert.equal((await foreign.call(input('foreign'))).data.results[0].ok, false); assert.equal((await foreign.orders()).length, 0);
const wrongForm = await fixture({wrongForm: true}); assert.equal((await wrongForm.call(input('wrong'))).data.results[0].ok, false); assert.equal((await wrongForm.orders()).length, 0);

// Parallel clicks are serialized before any source writes. A response can be
// retried after completion using current physical records.
const concurrent = await fixture(); let enter!: () => void, resume!: () => void;
const entered = new Promise<void>(resolve => {enter = resolve;}), paused = new Promise<void>(resolve => {resume = resolve;});
concurrent.beforeAppend(async () => {enter(); await paused;});
const first = concurrent.call(input('parallel')); await entered;
await assert.rejects(acquireFacebookSheetWriteLock(concurrent.env), /sync is running/, 'Automatic mirrors share the manual import lease');
assert.equal((await concurrent.call(input('parallel'))).status, 409); resume(); assert.equal((await first).data.results[0].ok, true); assert.equal(concurrent.writes(), 1);
const releaseMirror = await acquireFacebookSheetWriteLock(concurrent.env);
assert.equal((await concurrent.call(input('parallel'))).status, 409, 'A pre-existing automatic mirror must finish before native append checks the Sheet'); await releaseMirror();
assert(isFacebookSheetWrite({action: 'sync_orders', groups: {'Facebook Ads': []}})); assert(isFacebookSheetWrite({action: 'sync_orders', order: {order_source: 'Facebook Ads'}}));
assert(!isFacebookSheetWrite({action: 'read_order', orderId: 'FB-000001'})); assert(!isFacebookSheetWrite({action: 'sync_orders', groups: {Website: []}}));

// A stale browser cannot overwrite a staff correction made during Sheet IO.
const changing = await fixture({orders: [initial('changing', 'FB-000001')]});
changing.beforeAppend(async () => {await replaceDataTable(changing.env, 'order_snapshots', rows => ({rows: rows.map(row => ({...row, payload: {...row.payload, customer_name: 'Concurrent edit'}})), result: true}));});
assert.equal((await changing.call(input('changing'))).data.results[0].ok, false); assert.equal((await changing.orders())[0].customer_name, 'Concurrent edit'); assert.equal((await changing.orders())[0].is_synced_google_sheets, undefined);

const disconnected = await fixture({disconnected: true}); assert.equal((await disconnected.call({action: 'snapshot'})).status, 409);
const down = await fixture(); down.failSheet(); assert.equal((await down.call({action: 'snapshot'})).status, 503); assert.equal((await down.call(input('down'))).status, 503); assert.equal((await down.orders()).length, 0);
const metaDown = await fixture(); metaDown.failMeta(); assert.equal((await metaDown.call(input('down'))).status, 503); assert.equal((await metaDown.orders()).length, 0);

// Real audit handlers + client pagination traverse all forms, filter the chosen
// 3-week window, then verify BOTH destination sources. Any failure rejects.
const scan = await fixture();
const request = async (body: any, audit = false) => {const response = await scan.call(body, 'admin', audit); if (response.status !== 200) throw new Error(response.data.error); return response.data;};
const since = new Date(Date.now() - 21 * 86400000).toISOString(), until = new Date().toISOString();
const scanned = await scanMissingFacebookLeads(since, until, () => {}, request);
assert.deepEqual(scanned.leads.map(row => row.lead_id), ['scanned']); assert.equal(scan.metaPages(), 2); assert.equal(scan.writes(), 0);
scan.failSheet(); await assert.rejects(scanMissingFacebookLeads(since, until, () => {}, request));
await assert.rejects(scanMissingFacebookLeads(since, until, () => {}, async () => ({ok: true, page_id: 'page', forms: [], next_cursor: 'repeated', done: false})));
assert.throws(() => facebookSheetGroups([{sheetId: 1, title: 'Facebook', columnCount: 1, values: [['Wrong header']]}]));
assert.throws(() => facebookSheetGroups([{sheetId: 1, title: 'TikTok Ads', columnCount: headers.length, values: [headers]}]), /ambiguous/, 'A TikTok-only connection is never chosen as the Facebook destination');
const numericRow: any[] = line('numeric', 'FB-000129'); numericRow[headers.indexOf('Lead ID')] = 12345678901234567;
const numericIds = await fixture({rows: [headers, numericRow]}); assert.equal((await numericIds.call({action: 'snapshot'})).status, 409); assert.equal((await numericIds.call(input('numeric'))).status, 409); assert.equal(numericIds.writes(), 0);
console.log('Facebook missing-order checks passed: pagination, identities, recovery, Sheet edits, cancellations, history, retries, concurrency, stock/invoice preservation, source failures.');
