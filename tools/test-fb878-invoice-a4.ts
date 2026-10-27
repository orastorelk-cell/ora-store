import assert from 'node:assert/strict';
import { fb878SnapshotFromCsv, correctedFB878PrintOrder } from '../src/lib/fb878InvoiceA4';
import { confirmedFB878CsvTotal } from '../src/lib/fb878InvoiceRepair';
import type { Order } from '../src/types';

const correctCsv = [
  'Order ID,Item Code,Item Name,Qty,Unit Price Rs,Line Total Rs,Normal Total Rs,Discount Rs,Delivery Fee Rs,Final Total Rs',
  'FB-000878,SKU-TEST,Test Product,1,1000,1000,1000,0,250,1250',
].join('\n');
const original = {
  id:'fb878',order_number:'FB-000878',waybill_number:'18199999',
  invoice_locked:true,invoice_number:'INV-FB-000878',
  invoice_pack_batch_id:'PACK-20261027',invoice_generated_at:'2026-10-27T10:00:00Z',
  created_at:'2026-10-27T10:00:00Z',order_status:'Processing',
  total_amount:1000,subtotal:1000,delivery_fee:0,stock_allocated:true,
  customer_name:'Test Only',phone:'0771234567',address:'Test Only',city:'Colombo',
  items:[{sku:'SKU-TEST',product_name:'Test Product',quantity:1,unit_price:1000,subtotal:1000,buying_price:400,product_id:'TEST'}],
} as unknown as Order;
const prior=JSON.stringify(original),snapshot=fb878SnapshotFromCsv(correctCsv);
assert.equal(confirmedFB878CsvTotal('FB-000878',snapshot),1250);
assert.equal(snapshot.final_total,'1250');
const fixed=correctedFB878PrintOrder(original,snapshot);
assert.equal(fixed.total_amount,1250,'PDF total must equal Confirm CSV, not stale order value');
assert.equal(fixed.subtotal,1000);
assert.equal(fixed.delivery_fee,250);
assert.equal(fixed.items[0].subtotal,1000);
assert.equal(fixed.items[0].sku,'SKU-TEST');
assert.equal(fixed.waybill_number,original.waybill_number);
assert.equal(fixed.invoice_number,original.invoice_number);
assert.equal(JSON.stringify(original),prior,'Do not mutate live orders, money, stock, or waybill');

assert.throws(()=>fb878SnapshotFromCsv(correctCsv.replace('1250','1000')),/must be Rs. 1,250/);
assert.throws(()=>fb878SnapshotFromCsv(correctCsv.replace(/FB-000878/g,'FB-000999')),/no FB-000878 rows/);
assert.throws(()=>fb878SnapshotFromCsv('Order ID,Final Total\nFB-000878,1250'),/item lines are missing/);
assert.throws(()=>confirmedFB878CsvTotal('FB-000879',snapshot),/authorized/);
assert.throws(()=>correctedFB878PrintOrder({...original,order_status:'Cancelled'},snapshot),/non-cancelled/);
assert.throws(()=>correctedFB878PrintOrder({...original,waybill_number:undefined},snapshot),/original waybill/);
assert.throws(()=>correctedFB878PrintOrder(original,fb878SnapshotFromCsv(correctCsv.replace('250,1250','0,1250'))),/breakdown differs/);
console.log('PASS: FB-000878 CSV verified at Rs1250; invoice items and delivery reconcile; A4 print is PDF-only; incorrect CSV, wrong order, cancelled parcel and bad breakdown rejected.');
