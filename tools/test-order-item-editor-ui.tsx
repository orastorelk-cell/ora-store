import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { editedOrderValues, itemEditDraft } from '../src/lib/orderItemEdit';

class Storage {
  values = new Map<string,string>();
  getItem(key: string) {return this.values.get(key) || null;}
  setItem(key: string, value: string) {this.values.set(key, value);}
  removeItem(key: string) {this.values.delete(key);}
}
const target = process.cwd() + '/tools/.order-item-editor-ui-test.mjs', storage = new Storage(), requests: any[] = [], pdfs: any[] = [], receipts: any[] = [];
let fail = true, refreshes = 0, ui: any;
const products: any[] = [{id: 'colours', name_en: 'Lunch bag', sku: 'BAG', product_type: 'variant', variants: [
  {id: 'blue', option_value: 'Blue', sku: 'BAG-B', selling_price: 1100, buying_price: 500, stock_quantity: 5},
  {id: 'red', option_value: 'Red', sku: 'BAG-R', selling_price: 1100, buying_price: 550, stock_quantity: 3}]},
  {id: 'normal', name_en: 'Normal item', sku: 'NORMAL', selling_price: 700, buying_price: 200, stock_quantity: 9}];
let order: any = {id: 'order', order_number: 'FB-1', customer_name: 'Synthetic customer', payment_method: 'COD', stock_allocated: true, stock_status: 'Allocated',
  invoice_locked: true, invoice_number: 'INV-1', invoice_pack_batch_id: 'BATCH-1', waybill_number: 'WB-1', subtotal: 1800, total_amount: 1950,
  delivery_fee: 250, special_offer_discount: 100, order_status: 'Processing', items: [{product_id: 'colours', product_name: 'Lunch bag', sku: 'BAG-B',
    product_type: 'variant', variant_id: 'blue', variant_name: 'Blue', quantity: 2, unit_price: 900, regular_unit_price: 900, subtotal: 1800}]};
const preview = () => ({ok: true, order, can_edit: true, draft: itemEditDraft(order), expected_identity: 'synthetic-current-identity', products, settings: {}, stock_history: []});
const store: any = {adminUser: {id: 'admin', role: 'admin'}, refreshReturnInventory: async () => {refreshes++;},
  markInvoiceBatchDownloaded: async (...args: any[]) => {receipts.push(args);}, markFardarCsvExported: async () => {}};
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true, localStorage: storage, __itemEditStore: store,
  __itemEditRequest: async (_query: string, input?: any) => {
    if (!input) return preview(); requests.push(JSON.parse(JSON.stringify(input)));
    if (fail) {const error: any = new Error('Synthetic lost response'); error.status = 503; throw error;}
    order = {...order, ...editedOrderValues(order, products, {} as any, input), item_edit: {operation_id: input.operation_id}, invoice_pack_batch_id: 'BATCH-EDIT'};
    return {ok: true, operation_id: input.operation_id, order, stock_history: []};
  }, __itemEditPdf: async (...args: any[]) => {pdfs.push(args);}});
try {
  await build({entryPoints: ['src/components/admin/OrderItemEditorPanel.tsx'], outfile: target, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{name: 'editor-fixtures', setup(builder) {
    builder.onResolve({filter: /context\/StoreContext$/}, () => ({path: 'store', namespace: 'edit-fixture'}));
    builder.onResolve({filter: /lib\/orderItemEditClient$/}, () => ({path: 'request', namespace: 'edit-fixture'}));
    builder.onResolve({filter: /lib\/correctedInvoiceDownload$/}, () => ({path: 'pdf', namespace: 'edit-fixture'}));
    builder.onResolve({filter: /lib\/returnExports$/}, () => ({path: 'csv', namespace: 'edit-fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'edit-fixture'}, args => ({loader: 'js', contents: {
      store: 'export const useStore=()=>globalThis.__itemEditStore;', request: 'export const orderItemEditRequest=(...args)=>globalThis.__itemEditRequest(...args);',
      pdf: 'export const correctedInvoiceFormats=[{id:"a6",label:"A6 PDF"},{id:"a5",label:"A5 PDF"},{id:"a4-four",label:"A4 · 4 × A6"},{id:"a4-two",label:"A4 · 2 × A5"}]; export const downloadCorrectedInvoice=(...args)=>globalThis.__itemEditPdf(...args);',
      csv: 'export const downloadReturnBlob=()=>{}; export const returnPackingCsv=()=>"synthetic";',
    }[args.path]}));
  }}]});
  const {OrderItemEditorPanel} = await import(target);
  const mount = async () => {await act(async () => {ui = create(React.createElement(OrderItemEditorPanel, {initialOrderId: 'order'}));});};
  const control = (label: string) => ui.root.findAll((node: any) => node.props['aria-label'] === label)[0];
  const button = (label: string) => ui.root.findAllByType('button').find((node: any) => node.children.includes(label));
  const click = async (label: string) => {await act(async () => {await button(label).props.onClick();});};
  const fill = async (label: string, value: string) => {await act(async () => {control(label).props.onChange({target: {value}});});};
  await mount(); assert.equal(control('Quantity 1').props.value, '2'); assert.equal(button('Save Items, Amounts & Stock').props.disabled, true);
  await click('Split colour / item row'); assert.equal(control('Quantity 1').props.value, '1'); assert.equal(control('Quantity 2').props.value, '1');
  await fill('Variant 2', 'red'); assert.equal(control('Unit price 2').props.value, '900', 'Equal-price colour changes preserve historical charged prices');
  await click('+ Add Item / Variant'); await fill('Product 3', 'normal'); await fill('Quantity 3', '2');
  assert.equal(control('Unit price 3').props.value, '700'); assert(JSON.stringify(ui.toJSON()).includes('3,350.00'));
  await click('Save Items, Amounts & Stock'); assert.equal(requests.length, 1); assert.equal(requests[0].items[1].variant_id, 'red');
  assert(button('Retry Saved Item Edit')); assert.equal(storage.values.size, 1);
  const original = structuredClone(requests[0]); await act(async () => ui.unmount());
  fail = false; await mount(); assert(button('Retry Saved Item Edit'), 'Reload retains the exact operation');
  await click('Retry Saved Item Edit'); assert.deepEqual(requests[1], original); assert.equal(storage.values.size, 0); assert.equal(refreshes, 1);
  assert.equal(button('Save Items, Amounts & Stock').props.disabled, true); assert(JSON.stringify(ui.toJSON()).includes('Items, amounts and stock saved.'));
  for (const label of ['A6 PDF','A5 PDF','A4 · 4 × A6','A4 · 2 × A5']) await click(label);
  assert.deepEqual(pdfs.map(call => call[2]), ['a6','a5','a4-four','a4-two']); assert.equal(receipts.length, 4);
  assert(pdfs.every(call => call[0].invoice_pack_batch_id === 'BATCH-EDIT' && call[0].items.length === 3));
  assert(receipts.every(args => args[3][0].invoice_pack_batch_id === 'BATCH-EDIT'));
  order = {...order, invoice_pack_batch_id: 'NEWER-BATCH'}; await click('A6 PDF');
  assert.equal(pdfs.length, 4, 'A changed invoice cannot silently download an obsolete batch');
  assert(JSON.stringify(ui.toJSON()).includes('The invoice changed.'));
  await act(async () => ui.unmount()); store.adminUser = {id: 'staff', role: 'staff'}; await mount(); assert.equal(ui.toJSON(), null);
  console.log('PASS: direct order editor; unchanged-save disabled; split row; historical prices; add different product; live totals; lost response and remount recovery; exact replay; four fresh PDF actions; matching invoice receipts; changed-batch guard; admin access.');
} finally {if (ui) await act(async () => ui.unmount()); fs.rmSync(target, {force: true});}
