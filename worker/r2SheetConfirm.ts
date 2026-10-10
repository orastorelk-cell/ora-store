import { dataBucket, readDataTable, replaceDataTable } from './cloudflareData';
import { applyConfirmCsvDecisions, canonicalJson, validConfirmCsvEntries, type ConfirmCsvEntry } from '../src/lib/confirmCsvSave';
import { planConfirmSheetDecisions } from '../src/lib/confirmSheetPlan';
import { invoiceComplete } from '../src/lib/invoiceQueue';
import { SHEET_CONFIRM_CONTROL_KEY, SHEET_CONFIRM_API } from '../src/lib/sheetConfirmState';
import { readSheetDecisions, sheetAcknowledgmentRequests, sheetHeader, type SheetDecision } from '../src/lib/sheetConfirmRows';
import { findProductSelection, normalizedProductType, variantByOption, variantBySku } from '../src/lib/productVariants';
import { RETURN_PACKING_PREFIX, returnPackingInProgress } from '../src/lib/returnSheets';
import { r2ReturnStorage, returnActor, upsertReturnRow } from './r2ReturnSheets';
import { returnPackingHandler } from './r2ReturnPacking';
import { cancellationInProgress } from './r2OrderCancellation';
import { readGoogleSheetTabs, sheetMetadata, spreadsheetId, validateServiceAccount, googleSheetRequest, SheetApiError, type SheetConnection } from './googleSheetsApi';
import { pauseR2Conflict } from './r2Retry';

type Row=Record<string,any>;
type Phase='reading'|'saving'|'verifying'|'packing'|'colouring'|'complete'|'blocked'|'sheet_update_failed';
type Job={
  operation_id:string;batch_id:string;phase:Phase;created_at:string;updated_at:string;actor:Row;
  spreadsheet_id:string;tabs:string[];sources:SheetDecision[];entries:ConfirmCsvEntry[];order_ids:string[];
  counts:Row;errors:string[];warnings:string[];ack_cursor:number;packing_id:string;
  imported:boolean;invoices_ready:boolean;holds_released?:boolean;attempts:number;retry_at?:string;error?:string;
  lease_owner?:string;lease_until?:number;completed_at?:string;downloaded_at?:string;
};
const CONNECTION_KEY='ora-data/google-sheets-connection-v1.json';
const jobKey=(id:string)=>'ora-data/sheet-confirm-jobs-v1/'+id+'.json';
const validId=(id:string)=>/^[A-Za-z0-9_-]{16,100}$/.test(id);
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
class Blocked extends Error {constructor(public errors:string[]){super(errors[0]||'Fix the Google Sheet and retry.');}}
const controlFrom=(rows:readonly Row[])=>rows.find(row=>row.key===SHEET_CONFIRM_CONTROL_KEY)?.payload||{};
export const readSheetConnection = async(env:unknown):Promise<SheetConnection|null> => {
  const object=await dataBucket(env)?.get(CONNECTION_KEY);return object?JSON.parse(await object.text()):null;
};
const publicConnection=(connection:SheetConnection|null)=>connection?{connected:true,spreadsheet_id:connection.spreadsheet_id,tabs:connection.tabs,client_email:connection.client_email,connected_at:connection.connected_at}: {connected:false};
const readJob = async(env:unknown,id:string) => {
  const object=await dataBucket(env)?.get(jobKey(id));return object?{job:JSON.parse(await object.text()) as Job,etag:object.etag}:null;
};
const putJob = async(env:unknown,job:Job,etag?:string) => {
  const result=await dataBucket(env)!.put(jobKey(job.operation_id),JSON.stringify(job),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});
  return !!result;
};
const changeJob = async(env:unknown,id:string,change:(job:Job)=>Job) => {
  for(let attempt=0;attempt<5;attempt++){
    const current=await readJob(env,id);if(!current)throw new SheetApiError('Saved Sheet import was not found.',404);
    const next=change(current.job);if(next===current.job)return next;
    next.updated_at=new Date().toISOString();
    if(await putJob(env,next,current.etag))return next;
    await pauseR2Conflict(attempt);
  }
  throw new SheetApiError('The saved Sheet import is busy. Retry shortly.');
};
const publicJob=(job:Job)=>({operation_id:job.operation_id,batch_id:job.batch_id,phase:job.phase,created_at:job.created_at,updated_at:job.updated_at,
  counts:job.counts,errors:job.errors.slice(0,40),warnings:job.warnings.slice(0,40),error:job.error||null,
  invoices_ready:job.invoices_ready,completed_at:job.completed_at||null,downloaded_at:job.downloaded_at||null});
const setControl = (env:unknown,job:Job,hold:boolean,complete=false) => replaceDataTable(env,'admin_data_store',rows=>{
  const current=controlFrom(rows);if(current.active_id!==job.operation_id)return {rows,result:null};
  const summary=publicJob(job),history=[summary,...(current.history||[]).filter((value:any)=>value.operation_id!==job.operation_id)].slice(0,30);
  const next={...current,phase:job.phase,invoice_hold:hold,last_job_id:job.operation_id,history,...(complete?{active_id:null}:{}),updated_at:job.updated_at};
  if(canonicalJson(current)===canonicalJson(next))return {rows,result:null};
  return {rows:upsertReturnRow(rows,SHEET_CONFIRM_CONTROL_KEY,next),result:null};
});
const locked=(order:Row)=>invoiceComplete(order)||order.invoice_locked||order.waybill_protection_locked||order.fardar_csv_exported_at||order.stock_allocated||order.return_packing_lock||
  order.return_tracking_waybill||order.return_sheet_id||order.is_duplicate_order||order.is_test_order||order.dispatch_status==='Handed Over'||['Shipped','Delivered'].includes(order.order_status);

// Validation finishes for the whole snapshot before any decision is committed.
// The complete decision set is written in ONE R2 CAS transaction, so a bad order
// cannot leave half an import eligible for the old browser invoice effects.
const prepareJob = async(env:unknown,job:Job,connection:SheetConnection) => {
  const [tabs,orders,admin]=await Promise.all([readGoogleSheetTabs(connection),r2ReturnStorage(env).readOrders(),readDataTable(env,'admin_data_store')]);
  const ignored=new Set(orders.filter(locked).map(order=>String(order.order_number||'').toUpperCase()));
  const parsed=await readSheetDecisions(tabs,ignored),catalog=admin.find(row=>row.key==='storefront-state-v1')?.payload;
  if(!Array.isArray(catalog?.products))throw new SheetApiError('Shared product catalog is unavailable.');
  const errors=[...parsed.errors],entries:ConfirmCsvEntry[]=[],sources:SheetDecision[]=[],orderIds:string[]=[];
  const counts={confirmed:0,cancelled:0,pending:parsed.pendingCount,already_processed:parsed.alreadyProcessedCount,imported:0,invoices:0,stock:0,waybills:0,details:0,return_checks:0};
  const byNumber=new Map<string,Row[]>();
  for(const order of orders){const number=String(order.order_number||'').toUpperCase();byNumber.set(number,[...(byNumber.get(number)||[]),order]);}
  const selected=new Set(parsed.decisions.map(value=>value.order_number));
  for(const order of orders.filter(order=>order.sheet_confirm_hold===job.operation_id))if(!selected.has(String(order.order_number).toUpperCase()))
    errors.push(order.order_number+': The decision changed to Pending, was removed, or is invalid during this saved import. Set Confirm or Cancel and retry before invoices can start.');
  for(const decision of parsed.decisions){
    const matches=byNumber.get(decision.order_number)||[],order=matches[0];
    if(matches.length!==1){errors.push(decision.order_number+': The order was not found uniquely in the system. Import its original lead first.');continue;}
    if(locked(order)){counts.already_processed++;continue;}
    const receipt=order.sheet_confirm_import;
    if(order.order_status==='Cancelled'){
      if(decision.status==='Cancelled'&&receipt?.spreadsheet_id===job.spreadsheet_id&&receipt.fingerprint===decision.fingerprint){sources.push(decision);counts.cancelled++;continue;}
      counts.already_processed++;continue;
    }
    if(order.sheet_confirm_hold&&order.sheet_confirm_hold!==job.operation_id){errors.push(decision.order_number+': Another saved Sheet import owns this order.');continue;}
    if(receipt?.spreadsheet_id===job.spreadsheet_id&&receipt.fingerprint===decision.fingerprint&&order.call_center_status===decision.status){
      sources.push(decision);if(decision.status==='Confirmed'){orderIds.push(String(order.id));counts.confirmed++;}else counts.cancelled++;continue;
    }
    if(decision.status==='Confirmed'){
      const h=decision.headers.map(sheetHeader),variant=h.findIndex(key=>['variant_color','variant','color','colour','option'].includes(key)),code=h.findIndex(key=>['item_code','variant_code','actual_sku','sku'].includes(key)),action=h.findIndex(key=>['item_action','item_status'].includes(key));
      let invalidVariant=false;
      for(const row of decision.rows){
        if(action>=0&&['cancel','cancelled','canceled','cancel item'].includes(String(row[action]||'').toLowerCase().replace(/[_-]+/g,' ')))continue;
        const wanted=variant>=0?String(row[variant]||'').trim():'';
        if(!wanted)continue;
        const selection=findProductSelection(catalog.products,String(row[code]||''),wanted);
        if(!selection)continue; // The shared CSV planner reports unknown Item Codes.
        const type=normalizedProductType(selection.product);
        if(type==='variant'&&!variantByOption(selection.product,wanted)&&!variantBySku(selection.product,wanted)){
          errors.push(decision.order_number+': Variant / Color "'+wanted+'" does not match the selected product.');invalidVariant=true;
        }
        if(type==='bundle'){
          const children=(selection.product.bundle_components||[]).map(component=>({component,child:catalog.products.find((product:Row)=>product.id===component.product_id)})).filter(value=>value.child&&normalizedProductType(value.child)==='variant');
          if(children.length&&!children.some(({child,component})=>{const matched=variantByOption(child,wanted)||variantBySku(child,wanted);return matched&&matched.id===component.variant_id;})){
            errors.push(decision.order_number+': Bundle variant "'+wanted+'" could not be applied to its exact stock item.');invalidVariant=true;
          }
        }
      }
      if(invalidVariant)continue;
    }
    const plan=planConfirmSheetDecisions([decision.headers,...decision.rows],[order] as any,catalog.products,catalog.settings||{},job.batch_id,job.created_at);
    if(plan.errors.length||plan.notFoundCount||plan.entries.length!==1){errors.push(...(plan.errors.length?plan.errors:[decision.order_number+': A valid Confirm / Cancel decision could not be prepared.']));continue;}
    if(!validConfirmCsvEntries(plan.entries)){errors.push(decision.order_number+': Invalid item quantity, price or order total.');continue;}
    const entry=plan.entries[0];
    // The whole order may be cancelled when every item row is CANCEL ITEM.
    sources.push({...decision,status:entry.patch.call_center_status});entries.push(entry);
    if(entry.patch.call_center_status==='Confirmed'){orderIds.push(String(order.id));counts.confirmed++;}else counts.cancelled++;
  }
  if(errors.length)throw new Blocked(errors);
  return {entries,sources,order_ids:orderIds,counts};
};
const commitDecisions = async(env:unknown,job:Job) => {
  const sources=new Map(job.sources.map(source=>[source.order_number,source]));
  return replaceDataTable(env,'order_snapshots',rows=>{
    const applied=applyConfirmCsvDecisions(rows.map(row=>row.payload).filter(Boolean),job.entries);
    const failed=applied.results.filter(result=>result.status==='failed');
    if(failed.length)throw new Blocked(failed.map(result=>result.order_number+': '+result.error));
    const decisions=new Map(applied.results.map(result=>[String(result.id),result.order!]));
    const selected=new Set(job.sources.map(source=>source.order_number));
    let changed=false;
    const next=rows.map(row=>{
      const order=decisions.get(String(row.order_id))||row.payload,source=sources.get(order?.order_number);
      if(!source||!selected.has(order.order_number))return row;
      if(locked(order))throw new Blocked([order.order_number+': The order was allocated or invoiced while this import was starting. Retry the Sheet snapshot.']);
      const receipt={spreadsheet_id:job.spreadsheet_id,fingerprint:source.fingerprint,operation_id:job.operation_id,saved_at:job.created_at};
      if(order.sheet_confirm_import?.fingerprint===source.fingerprint&&order.sheet_confirm_import?.spreadsheet_id===job.spreadsheet_id&&order.sheet_confirm_hold===job.operation_id)return row;
      const saved={...order,sheet_confirm_import:receipt,sheet_confirm_hold:job.operation_id};
      if(canonicalJson(saved)===canonicalJson(row.payload))return row;
      changed=true;return {...row,payload:saved,updated_at:new Date().toISOString()};
    });
    if(job.sources.some(source=>!next.some(row=>row.payload?.order_number===source.order_number)))throw new Blocked(['An imported order disappeared. Refresh and retry before invoices start.']);
    return {rows:changed?next:rows,result:job.sources.length};
  });
};
const verifySheetSnapshot = async(connection:SheetConnection,job:Job) => {
  const parsed=await readSheetDecisions(await readGoogleSheetTabs(connection)),current=new Map(parsed.decisions.map(value=>[value.order_number,value]));
  const changed=job.sources.filter(source=>current.get(source.order_number)?.fingerprint!==source.fingerprint);
  if(changed.length)throw new Blocked(changed.map(source=>source.order_number+': The Sheet was edited during import. Retry to read the latest variants and rows before invoicing.'));
};
const packingOptions=(job:Job)=>({operationId:job.operation_id,orderIds:job.order_ids,batchId:job.batch_id});
const packingRequest=(job:Job,download=false)=>new Request('https://ora.internal/api/orders/invoices/recovery/'+(download?job.packing_id+'/downloaded':job.packing_id));
const packingFiles = async(env:unknown,job:Job) => {
  const response=await returnPackingHandler(packingRequest(job),r2ReturnStorage(env),job.actor,true,packingOptions(job));
  const data:any=await response.json();
  if(!response.ok||!data.ok||data.pending||data.batch_id!==job.batch_id||!Array.isArray(data.orders)||data.orders.length!==Number(job.counts.invoices)||
    data.orders.some((order:Row)=>!invoiceComplete(order)||order.invoice_pack_batch_id!==job.batch_id))throw new SheetApiError('Saved Sheet invoices could not be verified. Retry the saved batch.');
  return data;
};
const releaseOrderHolds = async(env:unknown,job:Job) => replaceDataTable(env,'order_snapshots',rows=>{
  let changed=false;const next=rows.map(row=>{
    if(row.payload?.sheet_confirm_hold!==job.operation_id)return row;
    const order={...row.payload};delete order.sheet_confirm_hold;changed=true;
    return {...row,payload:order,updated_at:new Date().toISOString()};
  });return {rows:changed?next:rows,result:null};
});

export const advanceSheetConfirmJob = async(env:unknown,id:string) => {
  const control=controlFrom(await readDataTable(env,'admin_data_store'));
  if(control.active_id!==id)return;
  let current=await readJob(env,id);if(!current)return;
  if(current.job.phase==='complete'){await setControl(env,current.job,false,true);return;}
  if(['blocked','sheet_update_failed'].includes(current.job.phase)||Date.parse(current.job.retry_at||'')>Date.now())return;
  const lease=crypto.randomUUID(),deadline=Date.now()+21000;
  let acquired=false;
  let job=await changeJob(env,id,previous=>{
    if(previous.lease_until&&previous.lease_until>Date.now())return previous;
    acquired=true;return {...previous,lease_owner:lease,lease_until:Date.now()+90000};
  });
  if(!acquired||job.lease_owner!==lease)return;
  const checkpoint=(patch:Partial<Job>)=>changeJob(env,id,previous=>{
    if(previous.lease_owner!==lease)throw new SheetApiError('This saved import is continuing in another server request.');
    return {...previous,...patch,error:undefined,retry_at:undefined,attempts:0,lease_until:Date.now()+90000};
  });
  try {
    const connection=await readSheetConnection(env);
    if(!connection||connection.spreadsheet_id!==job.spreadsheet_id||canonicalJson(connection.tabs)!==canonicalJson(job.tabs))throw new Blocked(['Reconnect the original Google Sheet and tabs before resuming this saved import.']);
    for(let step=0;step<3&&Date.now()<deadline;step++){
      if(job.phase==='reading'){
        const plan=await prepareJob(env,job,connection);
        job=await checkpoint({...plan,phase:'saving',errors:[]});
        await setControl(env,job,true);
      }else if(job.phase==='saving'){
        const count=await commitDecisions(env,job);
        job=await checkpoint({phase:'verifying',imported:true,counts:{...job.counts,imported:count}});
      }else if(job.phase==='verifying'){
        await verifySheetSnapshot(connection,job);
        job=await checkpoint({phase:'packing'});
        await setControl(env,job,true);
      }else if(job.phase==='packing'){
        const packing=(await readDataTable(env,'admin_data_store')).find(row=>row.key===RETURN_PACKING_PREFIX+job.packing_id)?.payload;
        if(!packing)await verifySheetSnapshot(connection,job);
        const request=new Request('https://ora.internal/api/orders/invoices/recovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation_id:job.packing_id,advance:true})});
        const response=await returnPackingHandler(request,r2ReturnStorage(env),job.actor,true,packingOptions(job));
        const data:any=await response.json();
        if(!response.ok||!data.ok)throw new SheetApiError(data.error||'The saved invoice batch could not finish.',response.status);
        if(data.pending)continue;
        if(data.batch_id!==job.batch_id||!Array.isArray(data.orders)||data.orders.some((order:Row)=>!invoiceComplete(order)))throw new SheetApiError('Not every invoice was saved. The batch is kept for retry.');
        const counts={...job.counts,...data.skipped,invoices:data.orders.length};
        job=await checkpoint({phase:'colouring',invoices_ready:true,counts});
      }else if(job.phase==='colouring'){
        if(!job.holds_released){
          await releaseOrderHolds(env,job);
          job=await checkpoint({holds_released:true});
          await setControl(env,job,false);
        }
        const parsed=await readSheetDecisions(await readGoogleSheetTabs(connection)),byNumber=new Map(parsed.decisions.map(value=>[value.order_number,value]));
        let end=Math.min(job.sources.length,job.ack_cursor+25),requests:any[]=[],warnings=[...job.warnings];
        const select=(stop:number)=>{
          const matching:SheetDecision[]=[],changed:string[]=[];
          for(const source of job.sources.slice(job.ack_cursor,stop)){
            const fresh=byNumber.get(source.order_number);
            if(fresh?.fingerprint===source.fingerprint)matching.push({...fresh,status:source.status});
            else changed.push(source.order_number+': Sheet changed after invoicing; its current rows were left unmarked. Review this order before sending.');
          }
          return {matching,changed};
        };
        let selection=select(end);requests=sheetAcknowledgmentRequests(selection.matching,job.created_at);
        while(requests.length>450&&end>job.ack_cursor+1){end--;selection=select(end);requests=sheetAcknowledgmentRequests(selection.matching,job.created_at);}
        if(requests.length)await googleSheetRequest(connection,':batchUpdate',{requests});
        warnings=[...new Set([...warnings,...selection.changed])];
        const done=end>=job.sources.length;
        job=await checkpoint({ack_cursor:end,warnings,phase:done?'complete':'colouring',...(done?{completed_at:new Date().toISOString()}:{}),entries:[]});
        await setControl(env,job,false,done);
        if(done)break;
      }else break;
    }
  }catch(error:any){
    // A lost response may follow a successful decision commit. Keep the global
    // stock/invoice hold for every phase after reading until holds are released.
    const mayHaveCommitted=job.imported||job.phase!=='reading';
    const permanent=error instanceof Blocked||[400,401,403,404,409].includes(Number(error.status));
    job=await changeJob(env,id,previous=>{
      if(previous.lease_owner!==lease||previous.phase==='complete')return previous;
      const attempts=previous.attempts+1;
      const phase=permanent?(previous.invoices_ready?'sheet_update_failed':'blocked'):previous.phase;
      return {...previous,phase,error:permanent?undefined:error.message||'Temporary sync failure; the saved job will retry.',errors:permanent?(error instanceof Blocked?error.errors:[error.message||'Check the Sheet connection and retry.']):previous.errors,
        attempts,...(!permanent?{retry_at:new Date(Date.now()+Math.min(300000,15000*2**Math.min(attempts,4))).toISOString()}:{}),lease_until:0};
    });
    await setControl(env,job,mayHaveCommitted&&!job.holds_released,job.phase==='complete');
  }finally{
    await changeJob(env,id,previous=>previous.lease_owner===lease?{...previous,lease_owner:undefined,lease_until:0}:previous).catch(()=>{});
  }
};
export const scheduleSheetConfirm = (env:unknown,ctx:any) => {
  ctx.waitUntil((async()=>{
    const control=controlFrom(await readDataTable(env,'admin_data_store'));
    if(control.active_id&&validId(control.active_id))await advanceSheetConfirmJob(env,control.active_id);
  })().catch(()=>console.warn('The saved Google Sheet import will resume on the next server retry.')));
};
const kick=(env:unknown,ctx:any,id:string)=>{if(ctx?.waitUntil)ctx.waitUntil(advanceSheetConfirmJob(env,id).catch(()=>console.warn('The saved Google Sheet import will retry.')));};

export const r2SheetConfirmHandler = async(request:Request,env:unknown,ctx:any,user:Row):Promise<Response> => {
  const url=new URL(request.url),path=url.pathname.slice(SHEET_CONFIRM_API.length),method=request.method;
  const permissions=user.permissions||[];
  if(user.role!=='admin'&&!permissions.includes('confirm_upload'))return json({error:'Confirm Upload permission required.'},403);
  if(method!=='GET'&&user.role!=='admin'&&permissions.includes('level:confirm_upload:view'))return json({error:'Confirm Upload edit permission required.'},403);
  try {
    if(path==='/connection'){
      const current=await readSheetConnection(env);
      if(method==='GET')return json({ok:true,connection:publicConnection(current)});
      if(user.role!=='admin')return json({error:'Super Admin connects the Google Sheet once.'},403);
      if(method!=='POST')return json({error:'Method not supported.'},405);
      const body:any=await request.json().catch(()=>null);
      if(!body||typeof body!=='object')return json({error:'Sheet link and service account key file are required.'},400);
      const id=spreadsheetId(body.spreadsheet_id),account=body.service_account?await validateServiceAccount(body.service_account):current;
      if(!account)throw new SheetApiError('Choose the Google service account JSON key file.',400);
      const connection:SheetConnection={spreadsheet_id:id,tabs:[],client_email:account.client_email,private_key:account.private_key,private_key_id:account.private_key_id,connected_at:new Date().toISOString(),connected_by:returnActor(user)};
      const metadata=await sheetMetadata(connection),available=metadata.sheets?.map((sheet:any)=>String(sheet.properties?.title||''))||[];
      const selected=Array.isArray(body.tabs)&&body.tabs.length?body.tabs:['CALL CENTER ORDERS','FACEBOOK ORDERS','TIKTOK ORDERS'].filter(title=>available.includes(title));
      if(!selected.length||selected.length>10||selected.some((title:any)=>typeof title!=='string'||title.length>100||!available.includes(title))||new Set(selected).size!==selected.length)
        throw new SheetApiError('Choose the exact call-center order tab names in this Sheet.',400);
      connection.tabs=selected;
      const control=controlFrom(await readDataTable(env,'admin_data_store'));
      if(control.active_id&&current&&(current.spreadsheet_id!==id||canonicalJson(current.tabs)!==canonicalJson(selected)))throw new SheetApiError('Finish the current saved import before changing its Sheet or tabs.',409);
      // Access is checked before storing the credential. Only the encrypted
      // private object contains the key; no settings/read response exposes it.
      await readGoogleSheetTabs(connection);
      const bucket=dataBucket(env)!;const previous=await bucket.get(CONNECTION_KEY);
      const saved=await bucket.put(CONNECTION_KEY,JSON.stringify(connection),{onlyIf:previous?{etagMatches:previous.etag}:{etagDoesNotMatch:'*'}});
      if(!saved)throw new SheetApiError('The connection changed while saving. Reload and try again.',409);
      return json({ok:true,connection:publicConnection(connection),sheet_title:metadata.properties?.title});
    }
    if(path==='/jobs'&&method==='GET'){
      const control=controlFrom(await readDataTable(env,'admin_data_store')),id=control.active_id||control.last_job_id;
      const saved=id?await readJob(env,id):null;
      if(saved&&control.active_id)kick(env,ctx,id);
      return json({ok:true,job:saved?publicJob(saved.job):null,history:control.history||[]});
    }
    if(path==='/jobs'&&method==='POST'){
      const body:any=await request.json().catch(()=>null),id=String(body?.operation_id||'');
      if(!validId(id))return json({error:'A valid import operation ID is required.'},400);
      const previous=await readJob(env,id);
      if(previous?.job.phase==='complete')return json({ok:true,job:publicJob(previous.job)});
      const connection=await readSheetConnection(env);if(!connection)return json({error:'Super Admin must connect the Google Sheet once before auto upload.',code:'SHEET_CONNECTION_REQUIRED'},409);
      const at=new Date().toISOString();
      let job:Job=previous?.job||{operation_id:id,batch_id:'PACK-SHEET-'+id,phase:'reading',created_at:at,updated_at:at,actor:{id:user.id,username:user.username,display_name:returnActor(user),role:user.role},spreadsheet_id:connection.spreadsheet_id,tabs:connection.tabs,
        sources:[],entries:[],order_ids:[],counts:{},errors:[],warnings:[],ack_cursor:0,packing_id:id,imported:false,invoices_ready:false,attempts:0};
      if(!previous&&!await putJob(env,job)){const saved=await readJob(env,id);if(!saved)throw new SheetApiError('The import could not be saved.');job=saved.job;}
      const active=await replaceDataTable(env,'admin_data_store',rows=>{
        const control=controlFrom(rows);if(control.active_id)return {rows,result:String(control.active_id)};
        if(returnPackingInProgress(rows)||cancellationInProgress(rows as Row[]))throw new SheetApiError('Another stock batch is finishing. Retry after it completes.',409);
        return {rows:upsertReturnRow(rows,SHEET_CONFIRM_CONTROL_KEY,{...control,active_id:id,last_job_id:id,phase:'reading',invoice_hold:true,updated_at:at}),result:id};
      });
      if(active!==id)job=(await readJob(env,active))!.job;
      kick(env,ctx,active);return json({ok:true,job:publicJob(job)});
    }
    const match=path.match(/^\/jobs\/([A-Za-z0-9_-]{16,100})(?:\/(retry|files|downloaded))?$/);
    if(!match)return json({error:'Sheet import route not found.'},404);
    const saved=await readJob(env,match[1]);if(!saved)return json({error:'Saved Sheet import not found.'},404);
    let job=saved.job;
    if(match[2]==='retry'&&method==='POST'){
      if(job.lease_until&&job.lease_until>Date.now())return json({ok:true,job:publicJob(job)});
      const control=controlFrom(await readDataTable(env,'admin_data_store'));
      if(control.active_id&&control.active_id!==job.operation_id)throw new SheetApiError('Another Sheet import is running. Finish that saved job first.',409);
      if(job.phase==='complete')return json({ok:true,job:publicJob(job)});
      const packing=(await readDataTable(env,'admin_data_store')).find(row=>row.key===RETURN_PACKING_PREFIX+job.packing_id)?.payload;
      job=await changeJob(env,job.operation_id,previous=>({...previous,phase:previous.invoices_ready?'colouring':['prepared','stock_saved','complete'].includes(packing?.phase)?'packing':previous.phase==='blocked'?'reading':previous.phase,
        ...(packing?.phase==='failed'?{packing_id:crypto.randomUUID(),phase:'reading'}:{}),errors:[],error:undefined,retry_at:undefined,attempts:0,lease_until:0}));
      await replaceDataTable(env,'admin_data_store',rows=>{
        const control=controlFrom(rows);return {rows:upsertReturnRow(rows,SHEET_CONFIRM_CONTROL_KEY,{...control,active_id:job.operation_id,last_job_id:job.operation_id,phase:job.phase,invoice_hold:!job.invoices_ready,updated_at:job.updated_at}),result:null};
      });
      kick(env,ctx,job.operation_id);return json({ok:true,job:publicJob(job)});
    }
    if(match[2]==='files'&&method==='GET'){
      if(!job.invoices_ready)return json({error:'Finish every import before preparing invoices.'},409);
      return json({...await packingFiles(env,job),ok:true,operation_id:job.operation_id});
    }
    if(match[2]==='downloaded'&&method==='POST'){
      if(!job.invoices_ready)return json({error:'Invoices are still being prepared.'},409);
      await packingFiles(env,job);
      const response=await returnPackingHandler(new Request(packingRequest(job,true),{method:'POST',body:'{}'}),r2ReturnStorage(env),user,true,packingOptions(job));
      if(!response.ok)throw new SheetApiError('The download acknowledgment was not saved. Retry the same batch.');
      job=await changeJob(env,job.operation_id,previous=>({...previous,downloaded_at:previous.downloaded_at||new Date().toISOString()}));
      return json({ok:true,job:publicJob(job)});
    }
    if(!match[2]&&method==='GET'){kick(env,ctx,job.operation_id);return json({ok:true,job:publicJob(job)});}
    return json({error:'Method not supported.'},405);
  }catch(error:any){return json({error:error.message||'The Sheet action could not finish.'},error instanceof Blocked?409:Number(error.status)||503);}
};
