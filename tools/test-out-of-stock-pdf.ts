import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { loadConfigFromFile } from 'vite';
import { normalizedProductType, variantById, variantOptions } from '../src/lib/productVariants';
import { snapshotOutOfStockNeeds } from '../src/lib/outOfStockReport';
import { buildOutOfStockPdf, loadOutOfStockPhoto, prepareOutOfStockPhotos } from '../src/lib/outOfStockPdf';

const products: any[] = [
  { id: 'cap', sku: 'R001', name_en: 'Cotton cap', images: ['/cap.jpg'], buying_price: 900, source_shop_name: 'Pettah Shop A', source_shop_price: 275, stock_quantity: 0 },
  { id: 'mat', sku: 'R002', name_en: 'Floor mat', product_type: 'variant', images: ['/mat.jpg'], stock_quantity: 0,
    variants: [{ id: 'red', sku: 'R002-RED', option_value: 'Red', image: '/red.jpg', stock_quantity: 0 }, { id: 'blue', sku: 'R002-BLUE', option_value: 'Blue', stock_quantity: 5 }] },
  { id: 'pack', sku: 'CB-001', name_en: 'Combo', product_type: 'bundle', bundle_components: [{ product_id: 'cap', quantity: 2 }, { product_id: 'mat', variant_id: 'red', quantity: 1 }] },
  { id: 'enough', sku: 'R003', name_en: 'Enough stock', stock_quantity: 4, images: [] },
];
const order = (id: string, items: any[], extra = {}) => ({ id, order_number: 'FB-' + id, call_center_status: 'Confirmed', order_status: 'Processing', stock_allocated: false, items, ...extra });
const orders = [
  order('001', [{ product_id: 'cap', quantity: 2 }, { product_id: 'cap', quantity: 1 }]),
  order('002', [{ product_id: 'pack', product_type: 'bundle', quantity: 2 }]),
  order('003', [{ product_id: 'mat', sku: 'R002-RED', quantity: 3 }, { product_id: 'mat', variant_id: 'blue', quantity: 1 }]),
  order('004', [{ product_id: 'pack', quantity: 1, bundle_components: [{ product_id: 'mat', sku: 'R002', quantity_per_bundle: 3 }] }]),
  order('005', [{ product_id: 'enough', quantity: 2 }]),
  ...[{ order_status: 'Cancelled' }, { call_center_status: 'Pending' }, { is_duplicate_order: true }, { stock_allocated: true }]
    .map((extra, index) => order('excluded-' + index, [{ product_id: 'cap', quantity: 100 }], extra)),
];
const before = JSON.stringify({ products, orders });
const config: any = (await loadConfigFromFile({ command: 'build', mode: 'production' }))!.config;
let source = fs.readFileSync('src/components/admin/AdminDashboard.tsx', 'utf8');
for (const plugin of config.plugins.flat(Infinity)) {
  if (!plugin?.name?.startsWith('ora-') || typeof plugin.transform !== 'function') continue;
  const result = await plugin.transform(source, process.cwd() + '/src/components/admin/AdminDashboard.tsx');
  if (result) source = typeof result === 'string' ? result : result.code;
}
assert.ok(source.includes('<OutOfStockPdfDownload rows={outOfStockNeeds} />'), 'The production transform retains the PDF button');
const start = source.indexOf('  const outOfStockNeeds = (() => {');
const end = source.indexOf('\n  })();', start) + '\n  })();'.length;
const scope: any = { products, orders, normalizedProductType, variantById, variantOptions };
vm.runInNewContext(transformSync(source.slice(start, end) + '\nglobalThis.result=outOfStockNeeds;', { loader: 'ts' }).code, scope);
const rows = JSON.parse(JSON.stringify(scope.result));
assert.deepEqual(rows.map((row: any) => [row.itemCode, row.pendingOrders, row.neededQty, row.orderIds]), [
  ['R001', 2, 7, ['FB-001', 'FB-002']],
  ['R002-RED', 2, 5, ['FB-002', 'FB-003']],
  ['R002', 1, 3, ['FB-004']],
]);
assert.equal(JSON.stringify({ products, orders }), before, 'Export selection never mutates operational data');
const snapshot = snapshotOutOfStockNeeds(rows);
assert.equal(snapshot[0].seenPrice, 275, 'Use saved seen price, not buying price');
assert.deepEqual(snapshot[1].imageSources, ['/red.jpg', '/mat.jpg']);
assert.equal(snapshot[1].seenPrice, null, 'Unknown reference prices remain unknown');
rows[0].product.source_shop_price = 12345; rows[0].orderIds.push('LATER');
assert.equal(snapshot[0].seenPrice, 275); assert.equal(snapshot[0].orderIds.length, 2, 'Async work uses a copied snapshot');

let active = 0, peak = 0;
const calls: string[] = [];
const jpeg = fs.readFileSync('public/product-media/product-1786553886993-114b58e77e.jpg');
const photo = { dataUrl: 'data:image/jpeg;base64,' + jpeg.toString('base64'), width: 300, height: 300 };
const photoRows = Array.from({ length: 24 }, (_, index) => ({ ...snapshot[0], imageSources: ['/bad', '/photo-' + (index % 8)] }));
const loaded = await prepareOutOfStockPhotos(photoRows, undefined, async image => {
  calls.push(image); peak = Math.max(peak, ++active);
  await new Promise(resolve => setTimeout(resolve, 1)); active--;
  if (image === '/bad') throw new Error('Image unavailable');
  return photo;
});
assert.ok(peak <= 4); assert.equal(calls.length, 9, 'Deduplicate shared photos and failed references');
assert.equal(loaded.missingImages, 0, 'Try the product photo when a variant reference fails');
assert.equal((await prepareOutOfStockPhotos([{ ...snapshot[0], imageSources: [] }])).missingImages, 1);
const previousImage = (globalThis as any).Image;
let stopped = false;
(globalThis as any).Image = class { removeAttribute() { stopped = true; } };
assert.equal(await loadOutOfStockPhoto('/never-finishes', 5), null, 'A stalled photo cannot hang the export');
assert.ok(stopped);
if (previousImage) (globalThis as any).Image = previousImage; else delete (globalThis as any).Image;

const items = Array.from({ length: 22 }, (_, index) => ({ ...snapshot[index % snapshot.length],
  itemCode: 'QA-' + String(index + 1).padStart(3, '0'),
  itemLabel: index % 3 === 0 ? 'Extra long item name with an exact colour and size selection to check readable wrapping on the printed report' : 'Fixture product ' + (index + 1),
  shopName: index % 4 === 0 ? 'Reference shop with a longer name and several words for line wrapping' : 'Pettah Shop A',
  orderIds: index === 0 ? Array.from({ length: 1000 }, (_, id) => 'TK-QA-' + String(id).padStart(5, '0')) : ['FB-QA-' + index, 'TK-SHARED'],
  pendingOrders: index === 0 ? 1000 : 2, neededQty: index === 0 ? 1300 : index + 2,
}));
const pdf = await buildOutOfStockPdf(items, items.map((_, index) => index % 5 ? photo : null), { generatedAt: new Date('2026-10-08T14:30:00Z') });
assert.ok(pdf.getNumberOfPages() >= 6, 'Long order lists continue across pages');
const output = process.env.OUT_OF_STOCK_PDF_OUTPUT || '/tmp/ora-out-of-stock-qa/out-of-stock.pdf';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.from(pdf.output('arraybuffer')));
console.log(`PASS: production selection, immutable references, variant/combo quantities, bounded photo loading and ${pdf.getNumberOfPages()} PDF pages (${output}).`);
