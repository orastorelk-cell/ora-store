import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transformSync} from 'esbuild';
import {purchaseBackupCandidates} from '../worker/purchaseBackupRecovery';
import {mergeProfitPurchaseHistory,buildPaidWaybillProfitReport} from '../src/lib/paidWaybillProfit';

const receipt=(id:string,po:string,day='2026-10-26T12:00:00.000Z',product='bag')=>({
  id,po_number:po,product_id:product,created_at:day,supplier_name:'lunch bag',
  sku:'R0008-GREY',variant_id:'grey',variant_sku:'R0008-GREY',
  quantity_added:5,unit_buying_price:280,total_cost:1400
});
const old=receipt('old-20261025','PO-2026-0099');
const today=receipt('new-20261029','PO-2026-0002','2026-10-29T13:12:16Z');
const prev=[old,today],current=[today];
const missing=purchaseBackupCandidates(prev,current);
assert.equal(missing.additions.length,1);
assert.equal(missing.additions[0].id,old.id);
assert.equal(missing.duplicates.length,1);
assert.equal(missing.conflicts.length,0);
const rerun=purchaseBackupCandidates(prev,[...current,...missing.additions]);
assert.equal(rerun.additions.length,0,'restoring twice must not create duplicate records');
const mismatched=purchaseBackupCandidates([{...old,unit_buying_price:999}], [...current,old]);
assert.equal(mismatched.conflicts.length,1,'do not silently alter existing historic price');
const repeatedBill=purchaseBackupCandidates([{...old,id:'another-id'}],[...current,old]);
assert.equal(repeatedBill.conflicts.length,1,'same supplier bill should not import under another ID');
assert.equal(mergeProfitPurchaseHistory([{...old,unit_buying_price:990}], [old])[0].unit_buying_price,280,
  'Profit Report uses the server recovered historical price rather than stale browser value');

const oldAllocated:any={id:'order-old',order_number:'FB-OLDER',created_at:'2026-10-25T12:00:00Z',order_status:'Delivered',
  call_center_status:'Confirmed',stock_allocated:true,stock_allocated_at:'2026-10-26T14:00:00Z',
  cod_payment_received:true,cod_payment_amount:1600,total_amount:1600,
  fardar_delivery_fee:250,items:[{product_id:'bag',variant_id:'grey',sku:'R0008-GREY',
  product_name:'Bag Grey',quantity:1,unit_price:1350,subtotal:1350}]};
const waybill='18160001';
oldAllocated.waybill_number=waybill;
const data=buildPaidWaybillProfitReport({orders:[oldAllocated],purchases:[today],products:[],returns:[],waybills:[waybill]});
assert(data.rows.length===1);
assert.equal(data.rows[0].profit,null,'new buying price may not silently verify old FIFO profit');
assert(data.rows[0].issues.some((line:string)=>line.includes('historical Purchasing cost is missing')));
const restored=buildPaidWaybillProfitReport({orders:[oldAllocated],purchases:[old,today],products:[],returns:[],waybills:[waybill]});
assert.equal(restored.rows[0].items[0].purchasing,280);
assert(!restored.rows[0].issues.some((line:string)=>line.includes('historical Purchasing cost is missing')));

const worker=fs.readFileSync('worker/purchaseBackupRecovery.ts','utf8');
const shell=fs.readFileSync('src/components/admin/PurchaseHistoryRecoveryPanel.tsx','utf8');
const routes=fs.readFileSync('worker/r2RecoveryFallback.ts','utf8');
const report=fs.readFileSync('src/components/admin/CurrentCsvProfitReport.tsx','utf8');
assert(worker.includes("'ora-data/backups-v2/purchase_orders/'"));
assert(worker.includes("stock_changed:false"));
assert(worker.includes("action==='scan'")||worker.includes("action==='preview'"));
assert(shell.includes('Search All 168 Backup Slots')&&shell.includes('Restore '));
assert(routes.includes("pathname==='/api/admin/purchasing-backup-recovery'"));
assert(routes.includes("readDurablePurchasingHistory(env)).purchases"));
assert(report.includes('report.totals.review===0'));
for(const [name,source,loader] of [
  ['worker/purchaseBackupRecovery.ts',worker,'ts'],
  ['src/components/admin/PurchaseHistoryRecoveryPanel.tsx',shell,'tsx'],
  ['src/components/admin/CurrentCsvProfitReport.tsx',report,'tsx']
] as const){try{transformSync(source,{loader,target:'es2022',format:'esm'});}catch(error){throw new Error(name+': '+String(error))}}
console.log('PASS: recover old R2 receipt IDs without stock changes, reject conflicts and repeat; profit cannot verify old orders from new buying price; Worker/UI parser OK.');
