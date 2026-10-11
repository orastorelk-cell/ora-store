import { googleSheetRequest, sheetMetadata, type SheetConnection } from './googleSheetsApi';
import { readSheetConnection } from './r2SheetConfirm';

type Rule = {condition:{type:string;values?:{userEnteredValue:string}[]};strict?:boolean;showCustomUi?:boolean;inputMessage?:string};
type Tab = {sheetId:number;title:string;values:string[][]};
const quote = (title:string) => "'"+title.replace(/'/g,"''")+"'";
const list = (values:string[],inputMessage?:string):Rule => ({condition:{type:'ONE_OF_LIST',values:values.map(userEnteredValue=>({userEnteredValue}))},strict:true,showCustomUi:true,...(inputMessage?{inputMessage}:{})});
const rangeRule = (value:string):Rule => ({condition:{type:'ONE_OF_RANGE',values:[{userEnteredValue:value}]},showCustomUi:true});
const key = (value:unknown) => String(value||'').trim().toLowerCase();
const CITY_OPTIONS_TAB='CITY DROPDOWN OPTIONS';
// Help text does not affect validity. Ignore order of list choices because Apps
// Script deliberately puts the order's current color first.
const sameRule = (a:Rule|undefined,b:Rule) => !!a && a.condition?.type===b.condition.type && !!a.strict===!!b.strict && !!a.showCustomUi===!!b.showCustomUi && JSON.stringify((a.condition.values||[]).map(v=>v.userEnteredValue).sort())===JSON.stringify((b.condition.values||[]).map(v=>v.userEnteredValue).sort());

export function planDropdownRepairs(tabs:Tab[],catalog:string[][],grid:any,cityRows:number,catalogRows:number) {
  const variants=new Map<string,string[]>();
  for(const row of catalog.slice(1)) {
    const main=key(row[1]),color=String(row[4]||'').trim();
    if(!main||!color)continue;
    const labels=variants.get(main)||[];
    if(!labels.some(label=>key(label)===key(color)))labels.push(color);
    variants.set(main,labels);
  }
  const existing=new Map<string,Rule>();
  for(const sheet of grid.sheets||[])for(const data of sheet.data||[])for(const [r,row] of (data.rowData||[]).entries())for(const [c,cell] of (row?.values||[]).entries()) {
    if(cell?.dataValidation)existing.set(`${sheet.properties.sheetId}:${(data.startRow||0)+r}:${(data.startColumn||0)+c}`,cell.dataValidation);
  }
  const requests:any[]=[];
  for(const tab of tabs) {
    const headers=tab.values[0]||[],col=(name:string)=>headers.indexOf(name);
    if(['Order ID','Main Code','Variant / Color','City','Item Action','Order Action'].some(name=>col(name)<0))continue;
    const fixed:[string,Rule][]=[
      // Apps Script replaces a selected City | District label with the plain
      // city name. Both forms must remain valid without losing district choices.
      ['City',rangeRule(`='${CITY_OPTIONS_TAB}'!$A$2:$A$${cityRows*2-1}`)],
      ['Gift Wrap',list(['NO','YES'])],
      ['Item Action',list(['KEEP ITEM','CANCEL ITEM'],'KEEP ITEM = keep this item. CANCEL ITEM = cancel only this item.')],
      ['Order Action',list(['PENDING','CONFIRM ORDER','CANCEL ENTIRE ORDER'],'PENDING / CONFIRM ORDER / CANCEL ENTIRE ORDER')],
      ['Change Item To',rangeRule(`='PRODUCT CATALOG'!$K$2:$K$${catalogRows}`)],
      ['Apply Item Change',{condition:{type:'BOOLEAN'}}],
    ];
    // Only populated order rows: no decisions, formulas, notes, or colors are
    // written. Newest rows take priority if a large backlog needs several runs.
    for(let r=tab.values.length-1;r>=1;r--) {
      const row=tab.values[r];if(!row[col('Order ID')])continue;
      const rules=[...fixed],current=String(row[col('Variant / Color')]||'').trim();
      const labels=[...(variants.get(key(row[col('Main Code')]))||[])];
      if(current&&!labels.some(label=>key(label)===key(current)))labels.unshift(current);
      if(labels.length)rules.push(['Variant / Color',list(labels,'Current order color stays unchanged. Select a different color only when the customer requests it.')]);
      for(const [name,rule] of rules) {
        const c=col(name);if(c<0||sameRule(existing.get(`${tab.sheetId}:${r}:${c}`),rule))continue;
        requests.push({setDataValidation:{range:{sheetId:tab.sheetId,startRowIndex:r,endRowIndex:r+1,startColumnIndex:c,endColumnIndex:c+1},rule}});
      }
    }
  }
  return requests;
}

export async function repairSheetDropdowns(connection:SheetConnection,request=googleSheetRequest) {
  const metadata=await (request===googleSheetRequest?sheetMetadata(connection):request(connection,'?fields=sheets.properties'));
  const properties=(metadata.sheets||[]).map((sheet:any)=>sheet.properties);
  const catalog=properties.find((p:any)=>p.title==='PRODUCT CATALOG'),city=properties.find((p:any)=>p.title==='CITY LIST');
  if(!catalog||!city||catalog.gridProperties.rowCount<2||city.gridProperties.rowCount<2)return 0;
  const optionsRows=city.gridProperties.rowCount*2-1;
  let options=properties.find((p:any)=>p.title===CITY_OPTIONS_TAB);
  let initializeOptions=false;
  if(!options) {
    const created=await request(connection,':batchUpdate',{requests:[{addSheet:{properties:{title:CITY_OPTIONS_TAB,hidden:true,gridProperties:{rowCount:optionsRows,columnCount:1}}}}]});
    options=created.replies?.[0]?.addSheet?.properties;
    if(!options)throw new Error('City dropdown helper was not acknowledged');
    initializeOptions=true;
  } else if(options.gridProperties.rowCount!==optionsRows) {
    await request(connection,':batchUpdate',{requests:[{updateSheetProperties:{properties:{sheetId:options.sheetId,gridProperties:{rowCount:optionsRows}},fields:'gridProperties.rowCount'}}]});
    initializeOptions=true;
  }
  if(initializeOptions)await request(connection,':batchUpdate',{requests:[{updateCells:{range:{sheetId:options.sheetId,startRowIndex:0,endRowIndex:2,startColumnIndex:0,endColumnIndex:1},rows:[{values:[{userEnteredValue:{stringValue:'City | District and saved City names'}}]},{values:[{userEnteredValue:{formulaValue:`={'CITY LIST'!C2:C${city.gridProperties.rowCount};'CITY LIST'!A2:A${city.gridProperties.rowCount}}`}}]}],fields:'userEnteredValue'}}]});
  const selected=properties.filter((p:any)=>connection.tabs.includes(p.title)&&/^(CALL CENTER|FACEBOOK|TIKTOK) ORDERS$/.test(p.title));
  if(!selected.length||selected.some((p:any)=>p.gridProperties.rowCount>20000||p.gridProperties.columnCount>100||p.gridProperties.columnCount<38))return 0;
  const query=new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'});
  for(const p of selected)query.append('ranges',`${quote(p.title)}!A1:AL${p.gridProperties.rowCount}`);
  query.append('ranges',`${quote(catalog.title)}!A1:E${Math.min(catalog.gridProperties.rowCount,20000)}`);
  const values=await request(connection,'/values:batchGet?'+query);
  if(values.valueRanges?.length!==selected.length+1)throw new Error('Incomplete dropdown repair read');
  const tabs:Tab[]=selected.map((p:any,i:number)=>({sheetId:p.sheetId,title:p.title,values:values.valueRanges[i].values||[]}));
  const ranges=new URLSearchParams({fields:'sheets(properties(sheetId),data(startRow,startColumn,rowData(values(dataValidation))))'});
  for(const tab of tabs)if(tab.values.length>1)ranges.append('ranges',`${quote(tab.title)}!A2:AL${tab.values.length}`);
  if(!ranges.has('ranges'))return 0;
  const grid=await request(connection,'?'+ranges);
  const requests=planDropdownRepairs(tabs,values.valueRanges[selected.length].values||[],grid,city.gridProperties.rowCount,catalog.gridProperties.rowCount).slice(0,1000);
  // Idempotent batches: a lost response is harmless; the next minute reads the
  // live rules again. A transient Google error leaves later batches for retry.
  for(let i=0;i<requests.length;i+=200)await request(connection,':batchUpdate',{requests:requests.slice(i,i+200)});
  return requests.length;
}

let running=false;
export function scheduleSheetDropdownRepair(env:unknown,ctx:any) {
  if(running)return;
  running=true;
  ctx.waitUntil((async()=>{
    const connection=await readSheetConnection(env);
    if(connection)await repairSheetDropdowns(connection);
  })().catch(()=>console.warn('Google Sheet dropdown repair will retry on the next cron run.')).finally(()=>{running=false;}));
}
