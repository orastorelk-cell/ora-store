import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { pendingStaffPurchases } from '../src/lib/staffPurchases';

class MemoryStorage implements Storage {
  values = new Map<string, string>(); get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] || null; }
  getItem(key: string) { return this.values.get(key) || null; } setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); } clear() { this.values.clear(); }
}
const target = process.cwd() + '/tools/.staff-purchases-ui-test.mjs', storage = new MemoryStorage(), requests: any[] = [], saved: any[] = [];
let fail = true, refreshCount = 0, ui: any;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, localStorage: storage,
  window: { setTimeout, clearTimeout, addEventListener: () => {}, removeEventListener: () => {} },
  __staffPurchaseStore: { adminUser: { id: 'editor', role: 'staff', permissions: ['stock'] },
    products: [{ id: 'normal', sku: 'N001', name_en: 'Normal item', stock_quantity: 10, selling_price: 1500 },
      { id: 'colors', sku: 'V001', name_en: 'Colour item', product_type: 'variant', stock_quantity: 4, variants: [{ id: 'blue', sku: 'V001-B', option_value: 'Blue', stock_quantity: 4, selling_price: 2000 }] },
      { id: 'combo', sku: 'CB001', name_en: 'Combo', product_type: 'bundle', stock_quantity: 9 }],
    refreshReturnInventory: async () => { refreshCount++; } },
  __staffPurchaseRequest: async (_query: string, input?: any) => {
    if (!input) return { ok: true, purchases: saved, total: saved.length, total_quantity: saved.length * 2, total_amount: saved.length * 1250.5 };
    requests.push(structuredClone(input));
    if (fail) { const error: any = new Error('Synthetic lost response'); error.status = 503; throw error; }
    const purchase = { ...input, purchase_number: 'STAFF-SYNTHETIC', phase: 'complete', total_amount: 1250.5, created_at: new Date().toISOString(), created_by: 'Editor', created_by_id: 'editor',
      items: input.items.map((item: any) => ({ ...item, product_name: 'Normal item', sku: 'N001', line_total: item.quantity * item.unit_price })),
      stock_history: [{ id: 'synthetic-audit', product_name: 'Normal item', previous_stock: 10, new_stock: 8 }] };
    saved.push(purchase); return { ok: true, purchase };
  } });
const flushHistory = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
try {
  await build({ entryPoints: ['src/components/admin/StaffPurchasesPanel.tsx'], outfile: target, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'staff-fixtures', setup(builder) {
    builder.onResolve({ filter: /context\/StoreContext$/ }, () => ({ path: 'store', namespace: 'staff-fixture' }));
    builder.onResolve({ filter: /lib\/staffPurchaseClient$/ }, () => ({ path: 'request', namespace: 'staff-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'staff-fixture' }, args => ({ contents: args.path === 'store' ? 'export const useStore=()=>globalThis.__staffPurchaseStore;' : 'export const staffPurchaseRequest=(...args)=>globalThis.__staffPurchaseRequest(...args);', loader: 'js' }));
  } }] });
  const { StaffPurchasesPanel } = await import(target);
  const mount = async (canEdit = true) => { await act(async () => { ui = create(React.createElement(StaffPurchasesPanel, { canEdit })); }); await flushHistory(); };
  const control = (label: string) => ui.root.findAll(node => node.props['aria-label'] === label)[0];
  const button = (label: string) => ui.root.findAllByType('button').find(node => node.children.includes(label));
  const fill = async (label: string, value: string) => { await act(async () => control(label).props.onChange({ target: { value } })); };
  await mount();
  assert.equal(control('Staff unit price 1').props.value, '', 'No selling price is prefilled');
  assert(!JSON.stringify(ui.toJSON()).includes('[CB001]'), 'Staff selects physical items and exact variants');
  await fill('Staff member name', 'Staff member'); await fill('Staff item 1', JSON.stringify(['normal', '']));
  await fill('Staff quantity 1', '2'); await fill('Staff unit price 1', '625.25');
  assert(JSON.stringify(ui.toJSON()).includes('1,250.50'), 'The form displays quantity × entered staff price');
  await fill('Staff item 1', JSON.stringify(['colors', 'blue']));
  assert.equal(control('Staff unit price 1').props.value, '', 'Changing item requires a fresh manual price');
  await fill('Staff item 1', JSON.stringify(['normal', ''])); await fill('Staff unit price 1', '625.25');
  await act(async () => { await ui.root.findByType('form').props.onSubmit({ preventDefault: () => {} }); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(requests.length, 1); assert.equal(requests[0].items[0].unit_price, 625.25);
  assert.equal(pendingStaffPurchases(storage, 'editor').length, 1, 'Uncertain saves remain durable');
  assert(button('Retry Saved Purchase')); assert.equal(control('Staff member name').props.disabled, true);
  const original = structuredClone(requests[0]); await act(async () => ui.unmount());
  fail = false; await mount();
  assert(button('Retry Saved Purchase'), 'Reload shows the exact saved operation');
  await act(async () => { await button('Retry Saved Purchase').props.onClick(); });
  await flushHistory();
  assert.deepEqual(requests[1], original, 'A retry preserves the operation, staff price and quantity');
  assert.equal(storage.length, 0); assert.equal(control('Staff unit price 1').props.value, '');
  assert(JSON.stringify(ui.toJSON()).includes('Staff purchase saved'));
  assert(JSON.stringify(ui.toJSON()).includes('STAFF-SYNTHETIC')); assert(refreshCount >= 2);
  await act(async () => ui.unmount()); await mount(false);
  assert.equal(ui.root.findAllByType('form').length, 0, 'View-only staff cannot submit a purchase');
  assert(control('Search staff purchases')); assert(JSON.stringify(ui.toJSON()).includes('STAFF-SYNTHETIC'));
  console.log('PASS: blank manual prices; exact variant choices; live totals; changed-item price reset; durable lost-response/reload retry; identical operation replay; saved history; stock refresh; view-only controls.');
} finally { if (ui) await act(async () => ui.unmount()); if (fs.existsSync(target)) fs.unlinkSync(target); }
