import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from 'esbuild';
import { buildPaidWaybillProfitReport } from '../src/lib/paidWaybillProfit';
import { profitOrderFixture, profitPurchaseFixture } from './profit-report-fixtures';

// A fresh Profit Report opens with no uploaded waybills. It MUST NOT traverse
// historical order/stock/purchase/return rows until a report was requested.
const deniedHistory = new Proxy([],{get(target,key,receiver){
  if(key==='length'||key===Symbol.iterator)throw new Error('Full history was accessed before selecting waybills');
  return Reflect.get(target,key,receiver);
}});
const empty=buildPaidWaybillProfitReport({
  orders:deniedHistory as any,purchases:deniedHistory as any,
  returns:deniedHistory as any,products:deniedHistory as any,waybills:[],
});
assert.deepEqual(empty.rows,[]);
assert.equal(empty.totals.beforeAds,0);
assert.equal(empty.totals.ready,0);
assert.equal(empty.totals.review,0);
assert.equal(empty.ranges.Facebook,null);
assert.equal(empty.ranges.TikTok,null);
assert.equal(empty.duplicates,0);

const order=profitOrderFixture(),purchase=profitPurchaseFixture();
const report=buildPaidWaybillProfitReport({
  orders:[order],purchases:[purchase],returns:[],waybills:[order.waybill_number!],
});
assert.equal(report.rows.length,1,'a selected invoice must still compute');
assert.equal(report.rows[0].orderNumber,order.order_number);
assert.equal(report.rows[0].purchasing,450,'FIFO purchasing remains unchanged when a selection exists');
assert.equal(report.rows[0].received,1250);
assert.equal(report.rows[0].profit,300,'1250 - 450 purchasing - 400 Fardar - 100 packing = 300');

const dashboard=fs.readFileSync('src/components/admin/AdminDashboard.tsx','utf8');
assert(dashboard.includes("<ProfitReportErrorBoundary><ProfitReportPanel /></ProfitReportErrorBoundary>"),
  'Profit Report errors cannot crash the entire Admin Dashboard');
const panel=fs.readFileSync('src/components/admin/ProfitReportPanel.tsx','utf8');
assert(!panel.includes("if (adminUser && sharedStoreReady) void resetPrevious()"),
  'visiting Profit Report does not automatically mutate/delete saved Facebook cost history');
const currentCsv=fs.readFileSync('src/components/admin/CurrentCsvProfitReport.tsx','utf8');
assert(currentCsv.includes("if (!Object.keys(verifiedLeads).length) return orders"),
  'do not clone thousands of order records before verifying any Facebook metadata');
transformSync(dashboard,{loader:'tsx',target:'es2022',format:'esm'});
transformSync(panel,{loader:'tsx',target:'es2022',format:'esm'});
transformSync(currentCsv,{loader:'tsx',target:'es2022',format:'esm'});
transformSync(fs.readFileSync('src/components/admin/ProfitReportErrorBoundary.tsx','utf8'),{loader:'tsx',target:'es2022',format:'esm'});
console.log('PASS: immediate empty Profit Report without any history reads; unchanged FIFO profit after CSV selection; safe error boundary; no server reset on navigation; valid TSX.');
