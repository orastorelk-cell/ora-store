import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { loadConfigFromFile } from 'vite';
import { editedOrderValues } from '../src/lib/orderItemEdit';

// Exercise the production Vite PDF transforms, rather than an unpatched copy.
const config = (await loadConfigFromFile({command: 'build', mode: 'production'}))!.config as any;
let source = fs.readFileSync('src/lib/pdfGenerator.ts', 'utf8');
for (const plugin of config.plugins.flat(Infinity)) {
  if (plugin?.enforce === 'pre' && typeof plugin.transform === 'function') {
    const result = await plugin.transform(source, process.cwd() + '/src/lib/pdfGenerator.ts');
    if (result) source = typeof result === 'string' ? result : result.code;
  }
}
const docs: any[] = [], downloaded: string[] = [];
class PDF {
  options: any; pages: any[] = [[]];
  constructor(options: any) {this.options = options; docs.push(this);}
  addPage(size: string, direction: string) {this.pages.push([]); return this;}
  addImage(svg: string, _type: string, x: number, y: number, w: number, h: number) {this.pages.at(-1)!.push({svg: JSON.parse(svg), x, y, w, h}); return this;}
  setDrawColor() {} setLineWidth() {} line() {}
  output() {return {syntheticPdf: this};}
}
const modules = {jspdf: {jsPDF: PDF}, './exactInvoiceTemplate': {
  buildExactInvoiceSvg: (order: any, settings: any, _preview: boolean, items: any[], page: number, pages: number) => JSON.stringify({skus: items.map(item => item.sku), page, pages,
    waybill: order.waybill_number, invoice: order.invoice_number, total: order.total_amount}), svgToBrowserPngBytes: async (svg: string) => svg,
}};
const module = {exports: {}};
vm.runInNewContext(transformSync(source, {loader: 'ts', format: 'cjs', target: 'es2022'}).code, {module, exports: module.exports,
  require: (id: string) => {assert(id in modules, id); return (modules as any)[id];}, console,
  window: {setTimeout: () => {}}, URL: {createObjectURL: () => 'blob:synthetic-pdf', revokeObjectURL: () => {}},
  document: {body: {appendChild: () => {}, removeChild: () => {}}, createElement: () => ({style: {}, click() {downloaded.push((this as any).download);}})},
});
const pdf: any = module.exports;
const products: any = [{id: 'normal', sku: 'NORMAL', name_en: 'Synthetic item', selling_price: 900, buying_price: 500, stock_quantity: 30}];
const initial: any = {id: 'order', order_number: 'FB-1', items: [], district: 'Colombo', city: 'Colombo', invoice_locked: true, stock_allocated: true,
  stock_status: 'Allocated', invoice_number: 'INV-1', waybill_number: 'WB-1', order_status: 'Processing'};
const values = editedOrderValues(initial, products, {} as any, {items: Array.from({length: 9}, (_, index) => ({product_id: 'normal', quantity: index + 1, unit_price: 800.25})), discount: 500.25, delivery_fee: 250, wrapping_fee: 100});
const order = {...initial, ...values};
// Use unique codes to catch omissions, duplicates and wrong page order.
order.items = order.items.map((item: any, index: number) => ({...item, sku: 'ITEM-' + index}));
order.invoice_confirm_snapshot.items = order.invoice_confirm_snapshot.items.map((item: any, index: number) => ({...item, item_code: 'ITEM-' + index}));
for (const [fn, format, pages] of [
  ['generateOrderInvoicePDF', 'a6', 3], ['generateA5SingleInvoicesPDF', 'a5', 3], ['generateA4InvoicePagesPDF', 'a4', 1], ['generateA4TwoUpA5InvoicesPDF', 'a4', 2],
] as const) {
  if (fn === 'generateOrderInvoicePDF') await pdf[fn](order, {}); else await pdf[fn]([order], {}, fn + '.pdf');
  const doc = docs.at(-1)!; assert.equal(doc.options.format, format); assert.equal(doc.pages.length, pages, fn);
  const images = doc.pages.flat(); assert.equal(images.length, 3, fn + ': all invoice item pages');
  assert.deepEqual(images.flatMap((image: any) => image.svg.skus), Array.from({length: 9}, (_, index) => 'ITEM-' + index));
  assert(images.every((image: any) => image.svg.waybill === 'WB-1' && image.svg.invoice === 'INV-1' && image.svg.total === order.total_amount));
  if (fn === 'generateA4InvoicePagesPDF') assert.deepEqual(images.map((image: any) => [image.x, image.y, image.w, image.h]), [[0.25,0,148,105],[148.75,0,148,105],[0.25,105,148,105]]);
}
assert.equal(downloaded.length, 4);
await assert.rejects(pdf.generateA5SingleInvoicesPDF([{...order, items: [{...order.items[0], quantity: 99}, ...order.items.slice(1)]}], {}), /safety check/);
console.log('PASS: production-transformed A6, A5, A4 4×A6, A4 2×A5; every page of a nine-item correction; original waybill/invoice and exact total; A4 physical slots; PDF download; mismatched-snapshot guard.');
