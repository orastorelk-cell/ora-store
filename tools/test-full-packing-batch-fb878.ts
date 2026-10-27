import assert from 'node:assert/strict';
import type { Order,StoreSettings } from '../src/types';
import { preparePackingInvoicesForPrint,pendingPackingInvoiceMessage } from '../src/lib/packingInvoicePrintRecovery';
import { fb878SnapshotFromCsv } from '../src/lib/fb878InvoiceA4';

const actualCsv=[
  'Order ID,Item Code,Item Name,Qty,Unit Price Rs,Line Total Rs,Normal Total Rs,Discount Rs,Delivery Fee Rs,Final Total Rs',
  'FB-000878,R001,Confirmed product,1,1250,1250,1250,0,0,1250',
].join('\n');
const generated=(number:string,amount=1250)=>({
  id:'id-'+number,order_number:number,
  invoice_locked:true,invoice_number:'INV-'+number,invoice_pack_batch_id:'PACK-SAME-BATCH',
  invoice_generated_at:'2026-10-27T08:00:00Z',waybill_number:'WB-'+number,
  order_status:'Processing',stock_allocated:true,stock_status:'Allocated',
  total_amount:amount,subtotal:amount,delivery_fee:0,
  items:[{product_id:'prod',sku:'R001',product_name:'Confirmed product',quantity:1,unit_price:amount,subtotal:amount,buying_price:600}],
} as unknown as Order);
const other=[generated('FB-000877'),generated('FB-000879'),generated('FB-000880')];
const broken=generated('FB-000878',1000);
const batch=[other[0],broken,other[1],other[2]];
const original=JSON.stringify(batch);
const snapshot=fb878SnapshotFromCsv(actualCsv);
const stale={...broken,invoice_confirm_snapshot:snapshot} as Order;

const planned=await preparePackingInvoicesForPrint([other[0],stale,other[1],other[2]],{} as StoreSettings);
assert.equal(planned.held.length,0,'saved Confirm CSV with Rs 1250 allows whole batch');
assert.equal(planned.printable.length,4,'all 4 invoices are included in order');
assert.deepEqual(planned.repaired,['FB-000878']);
assert.equal(planned.printable[1].total_amount,1250,'FB878 PDF only uses confirmed CSV amount');
assert.equal(planned.printable[1].items[0].unit_price,1250,'FB878 item 1 old price repaired');
assert.equal(planned.printable[1].items[0].subtotal,1250,'FB878 item 1 old total repaired');
assert.equal((planned.printable[1] as any).invoice_confirm_snapshot.normal_total,1250,'PDF re-computation cannot revert to Rs 1000');
assert.equal(planned.printable[0],other[0],'other invoices remain exact references');
assert.equal(planned.printable[2],other[1],'every unaffected invoice is preserved');
assert.equal(broken.total_amount,1000,'live 878 amount must remain untouched');
assert.equal(JSON.stringify(batch),original,'no mutation of any source order');

const uploaded=await preparePackingInvoicesForPrint(batch,{} as StoreSettings,actualCsv);
assert.equal(uploaded.held.length,0);
assert.equal(uploaded.printable.length,batch.length,'full batch CSV option includes every order');
assert.equal(uploaded.printable[1].total_amount,1250);

const unverified=await preparePackingInvoicesForPrint(batch,{} as StoreSettings);
assert.equal(unverified.printable.length,3,'other 3 good invoices are not blocked by one unverified invoice');
assert.equal(unverified.held.length,1,'FB878 is not silently printed at Rs 1000');
assert.match(pendingPackingInvoiceMessage(unverified),/NOT included or marked Downloaded/);
assert.match(pendingPackingInvoiceMessage(unverified),/FB-000878/);
const badCsv=actualCsv.replace(/,1250$/,',1000');
const rejected=await preparePackingInvoicesForPrint(batch,{} as StoreSettings,badCsv);
assert.equal(rejected.held.length,1,'wrong CSV total rejected; other invoices may print');
assert.equal(rejected.printable.length,3);
assert.deepEqual(rejected.printable,[...other]);

const withWrongLock={...broken,order_status:'Cancelled'} as Order;
const cancelled=await preparePackingInvoicesForPrint([withWrongLock,...other],{} as StoreSettings,actualCsv);
assert.equal(cancelled.held.length,1,'cancelled invoice cannot be made printable by CSV');
assert.equal(cancelled.printable.length,3);

console.log('PASS: whole four-invoice batch with corrected FB878 item price/total Rs1250, print-only source integrity, CSV fallback, partial safe batch, no wrong invoice/stock changes.');
