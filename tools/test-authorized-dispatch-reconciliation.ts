import assert from 'node:assert/strict';
import { AUTHORIZED_DISPATCH_WAYBILLS, reconcileAuthorizedDispatch, historicalDispatchBlockers } from '../src/lib/authorizedDispatchReconciliation';

const now='2026-10-26T09:30:00.000Z';
const rows=AUTHORIZED_DISPATCH_WAYBILLS.map((target,i)=>({
  order_id:'id-'+i,updated_at:'old',payload:{
    id:'id-'+i,order_number:target.order_number,waybill_number:target.waybill,
    order_status:'Processing',dispatch_status:'Not Scanned',delivery_status:'Pending',
    tracking_status:'Pending',invoice_locked:true,stock_allocated:true,
    payment_method:'COD',cod_payment_received:true,payment_status:'Paid',
    cod_payment_source:'Fardar CSV',cod_payment_amount:2450,
    fardar_invoice_status:'Delivered',fardar_invoice_waybill:target.waybill,
    invoice_number:'INV-'+target.order_number,
  },
}));
const original=structuredClone(rows), extra={order_id:'extra',payload:{order_number:'FB-008888',waybill_number:'OTHER'}};
const fixed=reconcileAuthorizedDispatch([...rows,extra],now);
assert.equal(fixed.reconciled.length,5);
assert.deepEqual(fixed.skipped,[]);
assert.equal(fixed.rows[5],extra,'other orders remain byte-for-byte untouched');
fixed.rows.slice(0,5).forEach((row,i)=>{
  const record=row.payload!;
  assert.equal(record.order_status,'Delivered');
  assert.equal(record.dispatch_status,'Handed Over');
  assert.equal(record.delivery_status,'Delivered');
  assert.equal(record.tracking_status,'Delivered');
  assert.equal(record.dispatch_reconciled_at,now);
  assert.equal(record.dispatch_scanned_at,undefined,'do not invent scan time');
  assert.equal(record.cod_payment_amount,2450);
  assert.equal(record.invoice_number,original[i].payload.invoice_number);
});
const again=reconcileAuthorizedDispatch(fixed.rows,now);
assert.equal(again.reconciled.length,0,'repeating the cron never rewrites a receipt');
assert.equal(again.rows,fixed.rows,'no mutation when already saved');

for(const [name,alter] of [
  ['no payment',(order:any)=>{order.cod_payment_received=false;}],
  ['wrong Fardar waybill',(order:any)=>{order.fardar_invoice_waybill='SOMEONE-ELSE';}],
  ['cancelled',(order:any)=>{order.order_status='Cancelled';}],
  ['return sheet',(order:any)=>{order.return_sheet_id='RET-1';}],
  ['return completed',(order:any)=>{order.fardar_invoice_status='Return Complete';}],
  ['item edit lock',(order:any)=>{order.item_edit_lock='EDIT-1';}],
  ['variant correction lock',(order:any)=>{order.variant_correction_lock='VAR-1';}],
  ['packing lock',(order:any)=>{order.return_packing_lock={operation_id:'PACK-1'};}],
  ['stock not allocated',(order:any)=>{order.stock_allocated=false;}],
  ['changed waybill',(order:any)=>{order.waybill_number='WRONG';}],
] as const){
  const blocked=structuredClone(rows);alter(blocked[0].payload);
  const result=reconcileAuthorizedDispatch(blocked,now);
  assert.equal(result.reconciled.length,4,name+' skips only the conflicting order');
  assert.equal(result.skipped.length,1,name+' reports the blocker');
  assert.equal(result.rows[0],blocked[0],name+' preserves the original row');
}
const collision=structuredClone([...rows,{order_id:'duplicate',payload:{order_number:'FB-999999',waybill_number:'18160742'}}]);
const duplicates=reconcileAuthorizedDispatch(collision,now);
assert.equal(duplicates.reconciled.length,4);
assert.match(duplicates.skipped[0].reason,/more than one order/);
const prior=structuredClone(rows);
prior[0].payload.order_status='Delivered';
prior[0].payload.fardar_invoice_status='Pending';
prior[0].payload.cod_payment_received=false;
const delivered=reconcileAuthorizedDispatch(prior,now);
assert.equal(delivered.reconciled.length,5,'previous saved Delivered state proves handover even when financial fields differ');

const completed=structuredClone(rows);
completed[0].payload.item_edit_lock='EDIT-FINISHED';
completed[1].payload.variant_correction_lock='VAR-FINISHED';
completed[2].payload.stock_quantity_correction_lock='STOCK-FINISHED';
completed[3].payload.return_packing_lock={operation_id:'PACK-FINISHED'};
completed[3].payload.return_packing_operation='PACK-FINISHED';
const journal=[
  {key:'order-item-edit-v1:EDIT-FINISHED',payload:{phase:'complete',order_id:'id-0',waybill_number:'18160742'}},
  {key:'order-variant-correction-v1:VAR-FINISHED',payload:{phase:'complete',order_id:'id-1',waybill_number:'18160740'}},
  {key:'order-stock-quantity-v1:STOCK-FINISHED',payload:{phase:'complete',order_id:'id-2',waybill_number:'18160739'}},
  {key:'return-packing-v1:PACK-FINISHED',payload:{phase:'complete',order_ids:['id-3']}},
];
const completedResult=reconcileAuthorizedDispatch(completed,now,journal);
assert.equal(completedResult.reconciled.length,5,'all five historical orders reconcile after completed correction receipts');
assert.deepEqual(completedResult.skipped,[]);
for(let i=0;i<4;i++)assert.equal(
  historicalDispatchBlockers(completedResult.rows[i].payload!,journal).length,0,
  'verified completed locks were removed without touching stock or financial fields');
assert.equal(completedResult.rows[2].payload!.cod_payment_amount,2450);
const active=structuredClone(completed);
assert.equal(reconcileAuthorizedDispatch(active,now,[]).reconciled.length,1,
  'active correction locks must never be bypassed without completed journals');
const oneOnly=reconcileAuthorizedDispatch(rows,now,[],'id-2');
assert.deepEqual(oneOnly.reconciled,['FB-000657'],'individual scan must not change other historical orders');
assert.equal(oneOnly.rows[0],rows[0]);
const paymentManuallyRecorded=structuredClone(rows);
paymentManuallyRecorded[0].payload.cod_payment_source='Manual';
assert.equal(reconcileAuthorizedDispatch(paymentManuallyRecorded,now).reconciled.length,5,
  'confirmed Fardar Delivered invoice plus manually reconciled COD payment is valid');

console.log('Authorized 5-waybill dispatch reconciliation: 5 repaired, idempotency, payment, status, return, lock and duplicate protections passed.');
