import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {stockReportingExportsPatch} from '../src/lib/stockReportingExportsPatch';
import {purchaseHistoryStockDurabilityPatch} from '../src/lib/purchaseHistoryStockDurabilityPatch';

const context=readFileSync('src/context/StoreContext.tsx','utf8');
const panel=readFileSync('src/components/admin/AdminDashboard.tsx','utf8');
// Local browser's 4 purchases must never overwrite shared product stock.
// The normal allocator remains responsible for future confirmed orders.
assert.equal(purchaseHistoryStockDurabilityPatch().transform(context,'/repo/src/context/StoreContext.tsx'),null);
assert(context.includes('FIFO stock + waybill allocator'));
const result=stockReportingExportsPatch().transform(panel,'/repo/src/components/admin/AdminDashboard.tsx');
assert(result&&typeof result!=='string');
const output=result.code;
assert(output.includes('const reportAvailable=row.available;'));
assert(!output.includes('const reportAvailable=purchases.length ? totalPurchased+adjustmentNet-movement.totalPacked'));
assert(output.includes('historyIncomplete:movement.totalPacked>totalPurchased'));
assert(output.includes('INCOMPLETE PURCHASE HISTORY • RECONCILE BEFORE DISPATCH'));
transformSync(output,{loader:'tsx',target:'es2022',format:'esm'});
const todayPurchase=5,lifetimePacked=37,sharedSavedAvailable=6;
assert(todayPurchase-lifetimePacked<0,'demonstrate missing old history causing a fake negative');
assert.equal(sharedSavedAvailable,6,'reported stock uses the saved live catalog, not fake -32');
console.log('PASS: incomplete browser purchasing history cannot override live stock; no invented shortage; report warns that history needs reconciliation.');
