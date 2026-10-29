import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from 'esbuild';
import { loadConfigFromFile } from 'vite';
import { safeVariantForStock,normalizeOrderMissingStockVariants,hasConflictingVariantOrderItems } from '../src/lib/exactVariantStockResolution';
import { planVerifiedGreyStockGap } from '../src/lib/oct29GreyStockGap';
import { applyOct29StockRecoveryLines } from '../src/lib/oct29StockRecovery';
import { invoiceReady } from '../src/lib/invoiceQueue';

const bag:any={id:'bag',sku:'R0008',product_type:'variant',stock_quantity:5,variants:[
  {id:'black',sku:'R0008-BLACK',stock_quantity:5,option_value:'Black'},
  {id:'grey',sku:'R0008-GREY',stock_quantity:0,option_value:'Grey'},
  {id:'blue',sku:'R0008-BLUE',stock_quantity:0,option_value:'Blue'},
]};
const original={phase:'complete',at:'2026-10-29T14:54:00.000Z',
  lines:[{sku:'R0008-GREY',product_id:'bag',variant_id:'grey',purchase:5,current:0,expected:5,credit:5,already_allocated:0}],
  source_receipts:[{sku:'R0008-GREY',po_number:'PO-2026-0002',log_id:'grey-proof',created_at:'2026-10-29T13:12:16Z'}],
};
const old:any={id:'old',stock_allocated:true,order_status:'Processing',stock_allocated_at:'2026-10-20T00:00:00Z',items:[
 {product_id:'bag',variant_id:'grey',sku:'R0008-GREY',quantity:100}
]};
const after:any={id:'after',order_number:'FB-TEST-1',stock_allocated:true,order_status:'Processing',stock_allocated_at:'2026-10-29T15:05:00Z',items:[
 {product_id:'bag',sku:'R0008-GREY',variant_name:'Grey',quantity:3}
]};
const originalJson=JSON.stringify(bag);
const absent=planVerifiedGreyStockGap(original,[bag],[old]);
assert.equal(absent.missing,5,'all five original recovered GREY items vanished without an allocation');
assert.equal(absent.line.expected,5);
assert.equal(JSON.stringify(bag),originalJson,'preview is read only');
const partiallyAssigned=planVerifiedGreyStockGap(original,[bag],[old,after]);
assert.equal(partiallyAssigned.missing,2,'only two genuinely missing; three already assigned to orders');
assert.deepEqual(partiallyAssigned.allocatedOrders,['FB-TEST-1']);
const fixed=applyOct29StockRecoveryLines([bag],[partiallyAssigned.line]);
assert.equal(fixed[0].variants[1].stock_quantity,2);
assert.equal(fixed[0].variants[0].stock_quantity,5,'BLACK must never change');
assert.equal(fixed[0].stock_quantity,7);
const spent=planVerifiedGreyStockGap(original,[bag],[old,{...after,items:[{...after.items[0],quantity:5}]}]);
assert.equal(spent.missing,0,'GREY fully allocated: no further stock credit, fix invoices instead');
assert.throws(()=>planVerifiedGreyStockGap(original,[{...bag,variants:bag.variants.map((v:any)=>v.id==='grey'?{...v,stock_quantity:6}:v)}],[old]),/greater/);
assert.throws(()=>planVerifiedGreyStockGap(original,[bag],[old],[{product_id:'bag',variant_id:'grey',created_at:'2026-10-29T15:06:00Z'}]),/returns\/adjustments/);
assert.equal(safeVariantForStock(bag,undefined,'R0008-GREY',undefined)?.id,'grey');
assert.equal(safeVariantForStock(bag,undefined,'R0008','Grey')?.id,'grey');
assert.equal(safeVariantForStock(bag,'black','R0008-GREY','Grey'),undefined,'wrong explicit BLACK ID cannot count as GREY');
const waiting:any={id:'w',items:[{product_id:'bag',sku:'R0008-GREY',main_sku:'R0008',
  variant_name:'Grey',quantity:1,unit_price:1950,subtotal:1950,buying_price:280}]};
const clean=normalizeOrderMissingStockVariants(waiting,[bag]);
assert.equal(clean.items[0].variant_id,'grey');
assert.equal(clean.items[0].unit_price,1950,'historical invoice price must stay locked');
assert.equal(clean.items[0].subtotal,1950);
assert.equal(clean.items[0].buying_price,280);
assert.equal(waiting.items[0].variant_id,undefined,'no mutation of original order');
assert(hasConflictingVariantOrderItems({items:[{product_id:'bag',variant_id:'black',sku:'R0008-GREY'}]},[bag]));
assert(!hasConflictingVariantOrderItems(clean,[bag]));
const eligible={...clean,order_status:'Processing',call_center_status:'Confirmed',stock_allocated:true,stock_status:'Allocated',
waybill_number:'18160899',is_duplicate_order:false,is_test_order:false};
assert(invoiceReady(eligible),'valid GREY Confirmed order with allocated stock + waybill is eligible for invoice');

const worker=fs.readFileSync('worker/r2Oct29StockRecovery.ts','utf8');
const component=fs.readFileSync('src/components/admin/GreyPackingDiagnosis.tsx','utf8');
assert(worker.includes("action==='preview-grey-gap'"));
assert(worker.includes("action==='commit-grey-gap'"));
assert(worker.includes('OCT29_GREY_GAP_KEY')&&worker.includes('replaceDataTable('));
assert(component.includes('Check & Restore Missing R0008-GREY Stock'));
const vite=await loadConfigFromFile({command:'build',mode:'production'});
assert(vite,'load full Vite production config');
let ctx=fs.readFileSync('src/context/StoreContext.tsx','utf8');
let dashboard=fs.readFileSync('src/components/admin/AdminDashboard.tsx','utf8');
for(const plugin of (vite!.config.plugins||[]).flat(Infinity) as any[]){
  if(typeof plugin?.transform!=='function')continue;
  const a=await plugin.transform(ctx,'/project/src/context/StoreContext.tsx');
  if(a)ctx=typeof a==='string'?a:a.code;
  const b=await plugin.transform(dashboard,'/project/src/components/admin/AdminDashboard.tsx');
  if(b)dashboard=typeof b==='string'?b:b.code;
}
assert(ctx.includes('normalizeOrderMissingStockVariants(order,products)'));
assert(ctx.includes('hasConflictingVariantOrderItems(order,products)'));
assert(ctx.includes('items:normalizeOrderMissingStockVariants(o,products).items'));
assert(ctx.includes('PACK-RESTOCK-'));
assert(dashboard.includes('<GreyPackingDiagnosis orders={orders} products={products} />'));
transformSync(ctx,{loader:'tsx',format:'esm',target:'es2022'});
transformSync(dashboard,{loader:'tsx',format:'esm',target:'es2022'});
transformSync(component,{loader:'tsx',format:'esm',target:'es2022'});
transformSync(worker,{loader:'ts',format:'esm',target:'es2022'});
console.log('PASS: GREY missing stock repaired only once; historical orders not rededucted; exact variant matched; invoice prices retained; live Packing diagnosis and full production Vite chain.');
