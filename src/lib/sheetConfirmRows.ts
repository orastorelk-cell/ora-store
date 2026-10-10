import { canonicalJson } from './confirmCsvSave';

export type SheetTab = { sheetId:number; title:string; values:string[][]; columnCount:number };
export type SheetDecision = {
  order_number:string; status:'Confirmed'|'Cancelled'; sheetId:number; title:string;
  headers:string[]; rows:string[][]; row_indices:number[]; fingerprint:string;
};
export const sheetHeader = (value:unknown) => String(value ?? '').replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const normalized = (value:unknown) => String(value ?? '').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const confirmed = new Set(['confirm','confirmed','confirm order']);
const cancelled = new Set(['cancel','cancelled','canceled','cancel entire order']);
const pending = new Set(['','pending','blank','no answer','noanswer','reschedule','rescheduled']);
const nonBusiness = new Set(['imported_status','last_sync','last_sync_at','original_qty','order_time','lead_id','source','product_image','image','image_url','preview','change_preview']);
export const sheetDecisionFingerprint = async(headers:string[],rows:string[][]) => {
  const keys=headers.map(sheetHeader);
  const values=rows.map(row=>Object.fromEntries(keys.flatMap((key,i)=>key && !nonBusiness.has(key) ? [[key,String(row[i] ?? '').trim()]] : [])));
  const source=canonicalJson(values.map(value=>canonicalJson(value)).sort());
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)));
  return Array.from(hash,value=>value.toString(16).padStart(2,'0')).join('');
};

// Group every current item row before making any order decision. Sheet status
// cells are never used as evidence that an import reached the durable system.
export const readSheetDecisions = async(tabs:SheetTab[],ignoreOrders:ReadonlySet<string>=new Set()) => {
  const decisions:SheetDecision[]=[],errors:string[]=[]; let pendingCount=0,alreadyProcessedCount=0;
  const seen=new Set<string>(),conflicts=new Set<string>(),tabOccurrences=new Map<string,Set<number>>();
  for(const tab of tabs){
    const headerAt=tab.values.slice(0,10).findIndex(row=>row.some(value=>['order_id','order_number','order'].includes(sheetHeader(value))));
    if(headerAt<0){if(tab.values.length)errors.push(tab.title+': Order ID header was not found.');continue;}
    const headers=tab.values[headerAt].map(value=>String(value ?? '').trim()),h=headers.map(sheetHeader);
    const index=(names:string[])=>h.findIndex(key=>names.includes(key));
    const id=index(['order_id','order_number','order']),action=index(['order_action','decision','call_decision','final_decision','call_result','call_status','result']);
    const code=index(['item_code','variant_code','actual_sku','sku']),qty=index(['qty','quantity']);
    const itemAction=index(['item_action','item_status']);
    if(action<0 || code<0 || qty<0){errors.push(tab.title+': Order Action, Item Code and Qty headers are required.');continue;}
    if(new Set(h.filter(Boolean)).size!==h.filter(Boolean).length){errors.push(tab.title+': Duplicate column headers must be corrected.');continue;}
    const groups=new Map<string,{rows:string[][];indices:number[]}>();
    for(let i=headerAt+1;i<tab.values.length;i++){
      const row=tab.values[i].map(value=>String(value ?? '').trim()),number=String(row[id]||'').toUpperCase();
      if(!number || number.startsWith('DATE:'))continue;
      if(!/^(WEB|FB|TK)-\d{6}$/.test(number)){
        if(!pending.has(normalized(row[action])))errors.push(tab.title+' row '+(i+1)+': Invalid Order ID '+number+'.');
        continue;
      }
      const group=groups.get(number)||{rows:[],indices:[]};group.rows.push(row);group.indices.push(i);groups.set(number,group);
    }
    for(const [number,group] of groups){
      if(ignoreOrders.has(number)){alreadyProcessedCount++;continue;}
      const actions=group.rows.map(row=>normalized(row[action])).filter(value=>!pending.has(value));
      const occurrences=tabOccurrences.get(number)||new Set<number>();occurrences.add(tab.sheetId);tabOccurrences.set(number,occurrences);
      if(occurrences.size>1&&(actions.length||seen.has(number))){conflicts.add(number);errors.push(number+': The same Order ID appears in more than one connected tab.');continue;}
      if(!actions.length){pendingCount++;continue;}
      if(actions.some(value=>!confirmed.has(value)&&!cancelled.has(value))){errors.push(number+': Use CONFIRM ORDER or CANCEL ENTIRE ORDER.');continue;}
      const isConfirm=actions.some(value=>confirmed.has(value)),isCancel=actions.some(value=>cancelled.has(value));
      if(isConfirm&&isCancel){errors.push(number+': Confirm and Cancel conflict across item rows.');continue;}
      if(seen.has(number)){errors.push(number+': The same Order ID appears in more than one connected tab.');continue;}
      seen.add(number);
      if(group.rows.length>100){errors.push(number+': At most 100 item rows are supported for one order.');continue;}
      if(isConfirm){
        let invalid=false;
        for(let i=0;i<group.rows.length;i++){
          const row=group.rows[i],a=itemAction<0?'':normalized(row[itemAction]);
          if(['cancel','cancelled','canceled','cancel item'].includes(a))continue;
          const amount=Number(row[qty]);
          if(!row[code]||!Number.isSafeInteger(amount)||amount<1||amount>99){errors.push(number+' row '+(group.indices[i]+1)+': A valid Item Code and whole Qty from 1 to 99 are required.');invalid=true;}
        }
        if(invalid)continue;
      }
      decisions.push({order_number:number,status:isConfirm?'Confirmed':'Cancelled',sheetId:tab.sheetId,title:tab.title,headers,rows:group.rows,row_indices:group.indices,
        fingerprint:await sheetDecisionFingerprint(headers,group.rows)});
    }
  }
  if(decisions.length>1000)errors.push('More than 1,000 Confirm / Cancel orders need processing. Contact Super Admin before continuing.');
  return {decisions:decisions.filter(value=>!conflicts.has(value.order_number)),errors,pendingCount,alreadyProcessedCount};
};

// Re-resolve row positions immediately before the acknowledgment. A row added,
// removed, edited or moved since import is never marked processed by old indices.
export const sheetAcknowledgmentRequests = (decisions:SheetDecision[],at:string) => {
  const requests:any[]=[];
  for(const decision of decisions){
    const h=decision.headers.map(sheetHeader),status=h.indexOf('imported_status'),sync=h.indexOf('last_sync'),item=h.findIndex(key=>['item_action','item_status'].includes(key));
    for(let i=0;i<decision.row_indices.length;i++){
      const row=decision.row_indices[i],isCancel=decision.status==='Cancelled'||(item>=0&&['cancel','cancelled','canceled','cancel item'].includes(normalized(decision.rows[i][item])));
      const range={sheetId:decision.sheetId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:0,endColumnIndex:decision.headers.length};
      requests.push({repeatCell:{range,cell:{userEnteredFormat:{backgroundColor:isCancel?{red:252/255,green:232/255,blue:230/255}:{red:230/255,green:244/255,blue:234/255}}},fields:'userEnteredFormat.backgroundColor'}});
      for(const [column,value] of [[status,decision.status],[sync,at]] as const)if(column>=0)requests.push({repeatCell:{range:{...range,startColumnIndex:column,endColumnIndex:column+1},cell:{userEnteredValue:{stringValue:value}},fields:'userEnteredValue'}});
    }
  }
  return requests;
};
