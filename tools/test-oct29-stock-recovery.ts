import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from 'esbuild';
import { OCT29_STOCK_RECEIPTS,planOct29StockRecovery,applyOct29StockRecoveryLines } from '../src/lib/oct29StockRecovery';

const at='2026-10-29T13:12:16.000Z';
const products:any[]=[
 {id:'bag',sku:'R0008',product_type:'variant',stock_quantity:4,status:'Active',variants:[
    {id:'black',sku:'R0008-BLACK',stock_quantity:0,status:'Out of Stock'},
    {id:'grey',sku:'R0008-GREY',stock_quantity:4,status:'Active'},
    {id:'blue',sku:'R0008-BLUE',stock_quantity:0,status:'Out of Stock'},
 ]},
 {id:'holder',sku:'R0041',stock_quantity:0,status:'Out of Stock'},
 {id:'coat',sku:'R0052',stock_quantity:0,status:'Out of Stock'},
 {id:'other',sku:'X0001',stock_quantity:9,status:'Active'},
];
const ids=['bag','bag','holder','coat'],variants=['black','grey',undefined,undefined];
const proofs=OCT29_STOCK_RECEIPTS.map((r,i)=>({
 po_number:r.po,sku:r.sku,quantity:r.qty,unit_buying_price:r.unit,product_id:ids[i],
 ...(variants[i]?{variant_id:variants[i]}:{}),
 created_at:at,log_id:'stk-'+i,log_created_at:at,
 log_reason:r.po+' • supplier',log_previous_stock:0,
 log_new_stock:r.qty,log_quantity:r.qty,
}));
const old={id:'old',created_at:'2026-10-01T00:00:00Z',stock_allocated:true,
 stock_allocated_at:'2026-10-14T13:00:00Z',items:[{
 product_id:'bag',variant_id:'black',quantity:37,sku:'R0008-BLACK'
 }]};
const newlyAllocated={id:'new',created_at:at,stock_allocated:true,
 stock_allocated_at:'2026-10-29T13:30:00Z',order_status:'Processing',items:[
 {product_id:'bag',variant_id:'black',quantity:2,sku:'R0008-BLACK'},
 {product_id:'bag',variant_id:'grey',quantity:1,sku:'R0008-GREY'},
 ]};
const original=JSON.stringify(products);
const plan=planOct29StockRecovery(proofs,products,[old,newlyAllocated]);
assert.deepEqual(plan.map(p=>[p.sku,p.purchase,p.already_allocated,p.current,p.expected,p.credit]),[
 ['R0008-BLACK',5,2,0,3,3],['R0008-GREY',5,1,4,4,0],
 ['R0041',10,0,0,10,10],['R0052',10,0,0,10,10]
]);
assert.equal(JSON.stringify(products),original,'preview never mutates live stock');
const next=applyOct29StockRecoveryLines(products,plan);
assert.deepEqual(next[0].variants.map((v:any)=>v.stock_quantity),[3,4,0],
 'both variants under same parent and untouched BLUE must be retained');
assert.equal(next[0].stock_quantity,7,'parent quantity equals exact variants');
assert.equal(next[1].stock_quantity,10);
assert.equal(next[2].stock_quantity,10);
assert.equal(next[3],products[3],'unrelated stock not touched');
const retry=planOct29StockRecovery(proofs,next,[old,newlyAllocated]);
assert.deepEqual(retry.map(line=>line.credit),[0,0,0,0],'repeating same receipts never increases stock');
assert.throws(()=>planOct29StockRecovery([...proofs.slice(0,3),proofs[0]],products,[old]),/missing or duplicated/);
assert.throws(()=>planOct29StockRecovery(proofs.map((p,i)=>i===0?{...p,log_previous_stock:1}:p),products,[old]),/cannot verify/);
assert.throws(()=>planOct29StockRecovery(proofs,next,[old],[
 {product_id:'bag',variant_id:'black',change_type:'Increase',created_at:'2026-10-29T13:30:00Z'}
]),/return\/adjustment/);
assert.throws(()=>planOct29StockRecovery(proofs,products,[{...newlyAllocated,items:[{product_id:'bag',variant_id:'black',sku:'R0008-BLACK',quantity:6}]}]),/exceed this receipt/);

const context=fs.readFileSync('src/context/StoreContext.tsx','utf8');
const ui=fs.readFileSync('src/components/admin/AdminDashboard.tsx','utf8');
const worker=fs.readFileSync('worker/r2Oct29StockRecovery.ts','utf8');
assert(context.includes('!sharedOrdersReady || returnStockTransactionPending'));
assert(ui.includes('Restore Oct 29 Stock (4 original receipts)'));
assert(ui.includes("action:'preview'")&&ui.includes("action:'commit'"));
assert(worker.includes('OCT29_RECOVERY_KEY')&&worker.includes('replaceDataTable('));
assert(worker.includes('applyOct29StockRecoveryLines('));
assert(worker.includes('Nothing was changed.')&&worker.includes('already_saved'));
transformSync(ui,{loader:'tsx',format:'esm',target:'es2022'});
transformSync(context,{loader:'tsx',format:'esm',target:'es2022'});
transformSync(worker,{loader:'ts',format:'esm',target:'es2022'});
console.log('PASS: verified 4 old receipts; original zero, only post-purchase allocations; same parent variants; no double credit; stale or returns blocked; Packing UI and worker parse.');
