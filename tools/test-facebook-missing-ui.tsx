import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import React from 'react';
import {act, create} from 'react-test-renderer';

class Storage {
  values = new Map<string, string>();
  getItem(key: string) {return this.values.get(key) || null;}
  setItem(key: string, value: string) {this.values.set(key, value);}
  removeItem(key: string) {this.values.delete(key);}
}
const target = process.cwd() + '/tools/.facebook-missing-ui.mjs', storage = new Storage(), requests: any[] = [];
const now = new Date().toISOString(), leads = ['sheet-only', 'system-only', 'both', 'present'].map(lead_id => ({lead_id, form_id: 'form', form_name: 'Fixture form', created_at: now}));
let scanCount = 0, refreshes = 0, failScan = true, failImport = true, ui: any, scanOverride: any;
const snapshot = () => ({checked_at: now, target_tab: 'Facebook Ads', unlinked_sheet_orders: [],
  orders: [{lead_id: 'system-only', order_number: 'FB-000002', expected_rows: 1}, {lead_id: 'present', order_number: 'FB-000004', expected_rows: 1}],
  sheet_orders: [{order_number: 'FB-000001', lead_ids: ['sheet-only'], rows: 1, sheet_ids: [1]}, {order_number: 'FB-000004', lead_ids: ['present'], rows: 1, sheet_ids: [1]}]});
const store: any = {adminUser: {id: 'admin', role: 'admin'}, refreshReturnInventory: async () => {refreshes++;}};
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true, localStorage: storage, __fbMissingStore: store,
  __fbMissingScan: async (since: string, until: string) => {
    scanCount++; assert(Date.parse(until) - Date.parse(since) <= 21 * 86400000); assert(Date.parse(until) - Date.parse(since) >= 20 * 86400000);
    if (failScan) throw new Error('Google Sheet is unavailable'); return {leads, page_id: 'page', snapshot: scanOverride || snapshot()};
  },
  __fbMissingRequest: async (body: any) => {
    requests.push(structuredClone(body)); if (failImport) throw new Error('Synthetic lost response');
    return {ok: true, results: body.leads.map((lead: any) => ({lead_id: lead.lead_id, ok: true})), snapshot: {...snapshot(),
      orders: leads.map((lead, i) => ({lead_id: lead.lead_id, order_number: 'FB-00000' + (i + 1), expected_rows: 1})),
      sheet_orders: leads.map((lead, i) => ({lead_ids: [lead.lead_id], order_number: 'FB-00000' + (i + 1), rows: 1, sheet_ids: [1]}))}};
  }});
try {
  await build({entryPoints: ['src/components/admin/FacebookMissingOrdersPanel.tsx'], outfile: target, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{name: 'facebook-missing-fixtures', setup(builder) {
    builder.onResolve({filter: /context\/StoreContext$/}, () => ({path: 'store', namespace: 'fb-fixture'}));
    builder.onResolve({filter: /lib\/facebookMissingClient$/}, () => ({path: 'client', namespace: 'fb-fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fb-fixture'}, args => ({loader: 'js', contents: args.path === 'store' ? 'export const useStore=()=>globalThis.__fbMissingStore;' : 'export const scanMissingFacebookLeads=(...args)=>globalThis.__fbMissingScan(...args); export const facebookMissingRequest=(...args)=>globalThis.__fbMissingRequest(...args);'}));
  }}]});
  const {FacebookMissingOrdersPanel} = await import(target);
  const mount = async () => {await act(async () => {ui = create(React.createElement(FacebookMissingOrdersPanel));});};
  const text = () => JSON.stringify(ui.toJSON());
  const button = (label: string) => ui.root.findAllByType('button').find((node: any) => node.children.join('') === label);
  const click = async (label: string) => {assert(button(label)); await act(async () => {await button(label).props.onClick();});};
  await mount(); assert.equal(scanCount, 0, 'Opening the system must not run Facebook scans');
  assert(button('Import Selected Missing Orders (0)').props.disabled);
  await click('Check Missing Orders'); assert(text().includes('Google Sheet is unavailable')); assert(!text().includes('No missing orders found'));
  failScan = false; await click('Check Missing Orders'); assert.equal(scanCount, 2); assert(button('Import Selected Missing Orders (3)'));
  assert(text().includes('Import to system + Sheet')); assert(text().includes('Import to system')); assert(text().includes('Import to Sheet'));
  await click('Import Selected Missing Orders (3)'); assert.equal(requests.length, 1); assert.equal(requests[0].leads.length, 3); assert.equal(storage.values.size, 1);
  assert(button('Retry Saved Missing Orders')); assert(button('Import Selected Missing Orders (3)').props.disabled);
  await act(async () => ui.unmount()); await mount(); assert(button('Retry Saved Missing Orders'), 'Reload retains the exact unfinished lead identities');
  failImport = false; await click('Retry Saved Missing Orders'); assert.deepEqual(requests[1], requests[0]); assert.equal(storage.values.size, 0); assert.equal(refreshes, 1);
  assert(text().includes('3 orders verified in both')); assert(text().includes('No missing orders found'));
  scanOverride = {...snapshot(), orders: leads.map((lead, i) => ({lead_id: lead.lead_id, order_number: 'FB-00000' + (i + 1), expected_rows: 1})),
    sheet_orders: leads.map((lead, i) => ({lead_ids: [lead.lead_id], order_number: 'FB-00000' + (i + 1), rows: 1, sheet_ids: [1]})),
    sheet_review_orders: [{order_number: 'FB-000099', issue: 'FB-000099: Sheet Lead ID needs verification.'}], unlinked_sheet_orders: ['FB-000099']};
  await click('Check Missing Orders'); assert(text().includes('Sheet Lead IDs to review')); assert(text().includes('FB-000099')); assert(!text().includes('No missing orders found'), 'Unresolved Sheet IDs cannot produce a false all-clear report');
  assert(button('Import Selected Missing Orders (0)').props.disabled);
  failScan = true; await click('Check Missing Orders'); assert(!text().includes('No missing orders found'), 'A failed new scan removes the old all-clear report');
  await act(async () => ui.unmount()); store.adminUser = {id: 'staff', role: 'staff'}; await mount(); assert.equal(ui.toJSON(), null);
  console.log('Facebook missing-order UI passed: explicit buttons, 3-week default, destination selection, incomplete source state, exact reload retry and verified receipts.');
} finally {if (ui) await act(async () => ui.unmount()); if (fs.existsSync(target)) fs.unlinkSync(target);}
