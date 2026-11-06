import assert from 'node:assert/strict';
import { prepareOrderSnapshotUpdate } from '../src/lib/orderSnapshotUpdate';

const previous = {
  id:'dispatch-order-1', order_number:'ORA-TEST-1', waybill_number:'18160742',
  invoice_locked:true, stock_allocated:true, stock_status:'Allocated',
  order_status:'Shipped', delivery_status:'Handed Over to Courier',
  tracking_status:'Awaiting Fardar Scan', dispatch_status:'Handed Over',
  dispatch_scanned_at:'2026-10-23T10:00:00.000Z', dispatch_scanned_by:'Packing',
};
const stale = {
  ...previous, order_status:'Processing', delivery_status:'Ready to Ship',
  tracking_status:'Waybill Assigned', dispatch_status:'Not Scanned',
  dispatch_scanned_at:undefined, dispatch_scanned_by:undefined,
};
const result=prepareOrderSnapshotUpdate(previous,stale,[]);
assert.equal(result.order.dispatch_status,'Handed Over');
assert.equal(result.order.dispatch_scanned_at,previous.dispatch_scanned_at);
assert.equal(result.order.dispatch_scanned_by,previous.dispatch_scanned_by);
assert.equal(result.order.order_status,'Shipped');
assert.equal(result.order.waybill_number,previous.waybill_number);

const delivered={...previous,order_status:'Delivered',delivery_status:'Delivered',tracking_status:'Delivered'};
const kept=prepareOrderSnapshotUpdate(delivered,stale,[]).order;
assert.equal(kept.order_status,'Delivered');
assert.equal(kept.delivery_status,'Delivered');
assert.equal(kept.tracking_status,'Delivered');
assert.equal(kept.dispatch_status,'Handed Over');

const unscanned={...previous,dispatch_status:'Not Scanned',dispatch_scanned_at:undefined,dispatch_scanned_by:undefined,order_status:'Processing'};
assert.equal(prepareOrderSnapshotUpdate(unscanned,stale,[]).order.dispatch_status,'Not Scanned');
console.log('Dispatch scan persistence regressions passed.');
