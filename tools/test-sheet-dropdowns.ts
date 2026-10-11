import assert from 'node:assert/strict';
import { planDropdownRepairs, repairSheetDropdowns } from '../worker/sheetDropdownRepair';
import type { SheetConnection } from '../worker/googleSheetsApi';

const headers=Array.from({length:38},(_,i)=>`Column ${i}`);
for(const [i,name] of [[0,'Order ID'],[5,'City'],[8,'Main Code'],[10,'Variant / Color'],[18,'Gift Wrap'],[21,'Item Action'],[22,'Order Action'],[24,'Change Item To'],[26,'Apply Item Change']] as const)headers[i]=name;
const order=(id:string,main:string,color='')=>{const row=Array(38).fill('');row[0]=id;row[8]=main;row[10]=color;row[21]='CANCEL ITEM';row[22]='CONFIRM ORDER';return row;};
const tab={sheetId:100001,title:'FACEBOOK ORDERS',values:[headers,order('FB-000587','cover','Front Load'),order('FB-000588','bag','Maroon'),order('FB-000589','simple'),order('FB-000590','cover','Retired Color')]};
const catalog=[['Image','Main','Code','Name','Color'],['','cover','','','Front Load'],['','cover','','','Twin Tub'],['','bag','','','Maroon'],['','bag','','','Blue']];
const grid:any={sheets:[{properties:{sheetId:100001},data:[{startRow:1,startColumn:0,rowData:[]}]}]};
const snapshot=JSON.stringify(tab);
let requests=planDropdownRepairs([tab],catalog,grid,8550,1000);
assert.equal(requests.length,27);
const variant=(row:number)=>requests.find(r=>r.setDataValidation.range.startRowIndex===row&&r.setDataValidation.range.startColumnIndex===10)?.setDataValidation.rule.condition.values.map((v:any)=>v.userEnteredValue);
assert.deepEqual(variant(1),['Front Load','Twin Tub']);
assert.deepEqual(variant(2),['Maroon','Blue']);
assert.equal(variant(3),undefined,'Simple products must not get another product’s color choices');
assert.deepEqual(variant(4),['Retired Color','Front Load','Twin Tub']);
assert.equal(JSON.stringify(tab),snapshot,'Order decisions and all cell values stay untouched');
function apply(batch:any[]) {
  for(const {setDataValidation:{range,rule}} of batch) {
    const data=grid.sheets[0].data[0];
    const row=data.rowData[range.startRowIndex-1] ||= {values:[]};
    row.values[range.startColumnIndex]={dataValidation:rule};
  }
}
apply(requests);
assert.equal(planDropdownRepairs([tab],catalog,grid,8550,1000).length,0,'Repair is idempotent');
// Simulate an append succeeding before Apps Script loses its validation writes.
tab.values.push(order('FB-000591','bag','Blue'));
requests=planDropdownRepairs([tab],catalog,grid,8550,1000);
assert.equal(requests.length,7);
assert(requests.every(r=>r.setDataValidation.range.startRowIndex===5));
const connection={tabs:['FACEBOOK ORDERS'],spreadsheet_id:'unused'} as SheetConnection;
let fail=true,writes=0;
const request=async(_connection:SheetConnection,path:string,body?:any)=>{
  if(path.includes('fields=sheets.properties'))return {sheets:[{properties:{sheetId:100001,title:'FACEBOOK ORDERS',gridProperties:{rowCount:945,columnCount:41}}},{properties:{title:'PRODUCT CATALOG',gridProperties:{rowCount:1000}}},{properties:{title:'CITY LIST',gridProperties:{rowCount:8550}}}]};
  if(path.startsWith('/values:batchGet'))return {valueRanges:[{values:tab.values},{values:catalog}]};
  if(path.startsWith('?'))return grid;
  assert.equal(path,':batchUpdate');
  assert(body.requests.every((r:any)=>Object.keys(r).join()==='setDataValidation'),'Only validation rules are writable');
  writes++;
  if(fail){fail=false;throw new Error('Google temporary 503');}
  apply(body.requests);return {};
};
await assert.rejects(repairSheetDropdowns(connection,request),/temporary 503/);
assert.equal(await repairSheetDropdowns(connection,request),7,'Next cron safely resumes a failed repair');
assert.equal(await repairSheetDropdowns(connection,request),0);
assert.equal(writes,2);
assert.deepEqual(tab.values.slice(0,5),JSON.parse(snapshot).values);
console.log('Sheet dropdown repairs passed: correct product variants, simple items, preserved values, new rows, retry and idempotency.');
