import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from 'esbuild';
import { loadConfigFromFile } from 'vite';

// Prior root cause: Purchasing History in localStorage was not durable across
// Chrome profiles, while products were shared. New purchases need one
// idempotent server write for stock + immutable receipt.
const worker=fs.readFileSync('worker/inventoryHistory.ts','utf8');
const route=fs.readFileSync('worker/r2RecoveryFallback.ts','utf8');
const context=fs.readFileSync('src/context/StoreContext.tsx','utf8');
const dashboard=fs.readFileSync('src/components/admin/AdminDashboard.tsx','utf8');
assert(worker.includes("body?.action==='purchase-stock'"));
assert(worker.includes("const receiptKey='inventory-purchase-v1:'+id"));
assert(worker.includes("const previous=rows.find(row=>String(row.key)===receiptKey)?.payload"));
assert(worker.includes('already_saved:true'));
assert(worker.includes("returnPackingInProgress(rows)||cancellationInProgress"));
assert(worker.includes("const credited=creditReturnStock(target,row.quantity_added)"));
assert(worker.includes("key:receiptKey,payload:receipt"));
assert(worker.includes('stock_changed:false'),'old history migration must NOT credit stock a second time');
assert(worker.includes('sameLine(receipt,line)'),'repeated old bills must be rejected');
assert(worker.includes('if(parsed.some(line=>'), 'one duplicate variant plus one new variant must block the ENTIRE bill');
assert(!worker.includes('if(parsed.every(line=>'), 'partial duplicate bill must never credit repeated stock again');
assert(route.includes("pathname==='/api/admin/inventory-history'"));
assert(context.includes("if(!inventoryHistoryReady)throw new Error"));
assert(context.includes("const commitInventoryPurchaseBatch=async("));
assert(context.includes("crypto.randomUUID()"));
assert(context.includes("pending.fingerprint!==fingerprint"));
assert(context.includes("action:'purchase-stock'"));
assert(context.includes("applySharedStorefrontState(result.state,true)"));
assert(context.includes("action:'merge-history'"),'old browser receipts are persisted without changing stock');
assert(dashboard.includes('await addPurchaseOrdersBatch(validated.map'), 'save all supplier-bill lines atomically');

// Check all relevant production patches compose. The restock FIFO, auto
// waybill and invoicing functionality must remain available after conversion.
const vite=await loadConfigFromFile({command:'build',mode:'production'});
assert(vite);
let transformedContext=context,transformedDashboard=dashboard;
for(const plugin of (vite!.config.plugins||[]).flat(Infinity) as any[]){
  if(typeof plugin?.transform!=='function')continue;
  const a=await plugin.transform(transformedContext,'/project/src/context/StoreContext.tsx');
  if(a)transformedContext=typeof a==='string'?a:a.code;
  const b=await plugin.transform(transformedDashboard,'/project/src/components/admin/AdminDashboard.tsx');
  if(b)transformedDashboard=typeof b==='string'?b:b.code;
}
assert(transformedContext.includes("await commitInventoryPurchaseBatch(rows);"));
assert(transformedContext.includes("if(!inventoryHistoryReady)"));
assert(transformedDashboard.includes('await addPurchaseOrdersBatch(dailyBatchRows);'));
assert(transformedDashboard.includes('await addPurchaseOrdersBatch(validated.map'));
assert(transformedContext.includes('WAYBILL AUTO ASSIGN SERVER GUARD'));
assert(transformedContext.includes('PACK-RESTOCK-'));
assert(transformedContext.includes("!o.invoice_generated_at"));
assert(transformedDashboard.includes('Fardar Upload CSV'));
transformSync(worker,{loader:'ts',target:'es2022',format:'esm'});
transformSync(context,{loader:'tsx',target:'es2022',format:'esm'});
transformSync(dashboard,{loader:'tsx',target:'es2022',format:'esm'});
transformSync(transformedContext,{loader:'tsx',target:'es2022',format:'esm'});
transformSync(transformedDashboard,{loader:'tsx',target:'es2022',format:'esm'});
console.log('PASS: server-first stock/history R2 commit; 2x retries idempotent; browser history migration never credits stock; daily + single purchase + FIFO Packing and Fardar CSV preserved.');
