import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transformSync} from 'esbuild';
import {loadConfigFromFile} from 'vite';
import {inventoryDemand,applyAtomicFifoInventory} from '../worker/r2AtomicFifo';

const bag:any={id:'bag',sku:'R0008',product_type:'variant',stock_quantity:10,
  variants:[{id:'black',sku:'R0008-BLACK',option_value:'Black',stock_quantity:5,status:'Active'},
    {id:'grey',sku:'R0008-GREY',option_value:'Grey',stock_quantity:5,status:'Active'}]};
const original=JSON.stringify(bag);
const order:any={id:'ord-794',order_number:'FB-000794',order_status:'Processing',call_center_status:'Confirmed',
  stock_allocated:false,items:[{product_id:'bag',sku:'R0008-GREY',variant_name:'Grey',quantity:1,
  product_name:'Hot And Cold Portable Lunch Bag',unit_price:1350,subtotal:1350}]};
const req=inventoryDemand(order,[bag]);
assert.deepEqual(req,[{productId:'bag',variantId:'grey',quantity:1}]);
const allocated=applyAtomicFifoInventory([bag],req,order,'2026-10-29T14:54:00.000Z');
assert.equal(JSON.stringify(bag),original,'CAS stock plan must never mutate source snapshot');
assert.equal(allocated.products[0].variants[0].stock_quantity,5);
assert.equal(allocated.products[0].variants[1].stock_quantity,4);
assert.equal(allocated.products[0].stock_quantity,9);
assert.equal(allocated.logs.length,1);
assert.equal(allocated.logs[0].quantity,1);
assert.equal(allocated.logs[0].reason,'FIFO stock allocated to FB-000794');
assert.throws(()=>inventoryDemand({...order,items:[{...order.items[0],variant_id:'black'}]},[bag]),/Variant Item Code disagrees/);
assert.throws(()=>applyAtomicFifoInventory([{...bag,variants:bag.variants.map((v:any)=>v.id==='grey'?{...v,stock_quantity:0}:v)}],req,order,'2026-10-29T14:54:00Z'),/Waiting for Stock/);

const worker=fs.readFileSync('worker/r2AtomicFifo.ts','utf8');
const inventory=fs.readFileSync('worker/inventoryHistory.ts','utf8');
const routes=fs.readFileSync('worker/r2RecoveryFallback.ts','utf8');
const diagnosis=fs.readFileSync('src/components/admin/GreyPackingDiagnosis.tsx','utf8');
const context=fs.readFileSync('src/context/StoreContext.tsx','utf8');
const vite=await loadConfigFromFile({command:'build',mode:'production'});
assert(vite);
let transformed=context;
for(const plugin of (vite.config.plugins||[]).flat(Infinity) as any[]){
  if(typeof plugin?.transform!=='function')continue;
  const result=await plugin.transform(transformed,'/project/src/context/StoreContext.tsx');
  if(result)transformed=typeof result==='string'?result:result.code;
}
assert(transformed.includes('SERVER ATOMIC FIFO ALLOCATOR'));
assert(transformed.includes("'/api/orders/stock/allocate'"));
assert(!transformed.includes('FIFO stock allocated to ${order.order_number}'),
  'the old double-debiting client code must NOT exist after Vite transforms');
assert(!transformed.includes('if(allocatedIds.size){ setProducts(Array.from(productMap.values()));'),
  'client must never decrement physical stock before a server acknowledgment');
assert(transformed.includes('await assignNextWaybill(order.id'));
assert(transformed.includes('// AUTO INVOICE QUEUE:'));
assert(transformed.includes("!o.invoice_generated_at"));
assert(transformed.includes("const commitInventoryPurchaseBatch=async("));
assert(worker.includes("const receipt={phase:'reserved'"));
assert(worker.includes("const existing=rows.find(row=>row.key===receiptKey(id))?.payload"));
assert(worker.includes('already_saved:true'));
assert(worker.includes('stock_changed_once:true'));
assert(worker.includes("replaceDataTable(env,'order_snapshots'"));
assert(worker.includes("readDataTable(env,'stock_history')"),'pre-migration Stock Audit must block repeat deduction');
assert(worker.includes("selected.stock_allocated_at||selected.stock_status==='Allocated'"));
assert(worker.includes("This order already has a historic FIFO Stock Audit deduction"));
assert(inventory.includes("startsWith('fifo-stock-allocation-v1:')"));
assert(routes.includes("pathname==='/api/orders/stock/allocate'"));
assert(diagnosis.includes('Duplicate FIFO stock deductions detected'));
assert(diagnosis.includes('logs.length>1'));
for(const [source,loader] of [[worker,'ts'],[transformed,'tsx'],[diagnosis,'tsx']] as const){
  transformSync(source,{loader,target:'es2022',format:'esm'});
}
console.log('PASS: FIFO deducted exactly once per server order ID, wrong GREY/BLACK held; no local debit; durable audit and invoice queue preserved.');
