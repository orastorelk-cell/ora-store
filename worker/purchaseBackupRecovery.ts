import { dataBucket,readDataTable,replaceDataTable } from './cloudflareData';
type Row=Record<string,any>;
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const safeId=(value:unknown)=>String(value||'').trim();
const validPurchase=(row:any)=>Boolean(row&&typeof row==='object'&&!Array.isArray(row)&&
  typeof row.id==='string'&&row.id.length>0&&row.id.length<=180&&
  typeof row.product_id==='string'&&row.product_id.length>0&&
  Number.isFinite(Date.parse(String(row.created_at||'')))&&
  Number.isSafeInteger(Number(row.quantity_added))&&Number(row.quantity_added)>0&&
  Number.isFinite(Number(row.unit_buying_price))&&Number(row.unit_buying_price)>=0);
const stable=(row:Row)=>JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])));
const minDate=(rows:Row[])=>rows.map(row=>String(row.created_at||'')).filter(Boolean).sort()[0]||null;
const maxDate=(rows:Row[])=>rows.map(row=>String(row.created_at||'')).filter(Boolean).sort().at(-1)||null;
const checkedSlot=(value:unknown)=>{
  const slot=Number(value);
  if(!Number.isInteger(slot)||slot<0||slot>167)throw Object.assign(new Error('Invalid historical backup slot.'),{status:400});
  return slot;
};
// Hourly backups already exist in Cloudflare R2. Read ONLY the existing data.
// They were created before a server table changed. A legacy browser-only
// purchase may not exist in R2, which we must report rather than fabricate.
export const purchaseBackupRows=async(env:unknown,slot:number):Promise<Row[]|null>=>{
  const bucket=dataBucket(env);
  if(!bucket)throw new Error('Cloudflare encrypted backup storage unavailable.');
  const key='ora-data/backups-v2/purchase_orders/'+checkedSlot(slot)+'.json';
  const object=await bucket.get(key);
  if(!object)return null;
  const rows=JSON.parse(await object.text());
  if(!Array.isArray(rows)||rows.length>25000||rows.some(row=>!row||typeof row!=='object'))
    throw Object.assign(new Error('Backup table is invalid. Nothing was changed.'),{status:409});
  return rows as Row[];
};
const dateStamp=(str:unknown)=>String(str||'').slice(0,10);
const candidates=(backup:Row[],live:Row[])=>{
  const byId=new Map(live.map(row=>[safeId(row.id),row]));
  const byBill=new Map(live.filter(row=>row.po_number).map(row=>[String(row.po_number)+'|'+String(row.product_id)+'|'+String(row.variant_id||'')+'|'+dateStamp(row.created_at),row]));
  const additions:Row[]=[],duplicates:string[]=[],conflicts:string[]=[];
  const seen=new Set<string>();
  for(const row of backup){
    if(!validPurchase(row))continue;
    const id=safeId(row.id);
    if(seen.has(id)){conflicts.push(id+': repeated ID within backup');continue;}
    seen.add(id);
    const previous=byId.get(id);
    if(previous){if(stable(previous)!==stable(row))conflicts.push(id+': existing receipt differs');else duplicates.push(id);continue;}
    const billKey=String(row.po_number||'')+'|'+String(row.product_id)+'|'+String(row.variant_id||'')+'|'+dateStamp(row.created_at);
    if(row.po_number&&byBill.has(billKey)){conflicts.push(id+': bill already recorded under different ID');continue;}
    additions.push(row);
  }
  return {additions,duplicates,conflicts};
};
export const purchaseBackupRecoveryHandler=async(request:Request,env:unknown,user:Row)=>{
  if(user.role!=='admin')return reply({error:'Super Admin access required for Purchasing backup recovery.'},403);
  try{
    const input=new URL(request.url);
    if(request.method!=='GET'&&request.method!=='POST')return reply({error:'Method not allowed.'},405);
    const raw=request.method==='POST'?await request.text():'';
    if(raw.length>12000)return reply({error:'Recovery preview request too large.'},413);
    let body:any={};
    if(raw){try{body=JSON.parse(raw);}catch{return reply({error:'Invalid JSON.'},400)}}
    const action=request.method==='GET'?'scan':body?.action;
    if(action==='scan'){
      const start=Math.min(168,Math.max(0,Number(input.searchParams.get('cursor')||0)));
      if(!Number.isInteger(start))return reply({error:'Invalid backup cursor.'},400);
      const slots=Array.from({length:Math.max(0,Math.min(12,168-start))},(_,i)=>start+i);
      const found=await Promise.all(slots.map(async slot=>{
        try{
          const rows=await purchaseBackupRows(env,slot);
          if(!rows)return null;
          const valid=rows.filter(validPurchase);
          return {slot,count:valid.length,oldest:minDate(valid),newest:maxDate(valid)};
        }catch(error:any){return {slot,error:String(error?.message||error)};}
      }));
      return reply({ok:true,slots:found.filter(Boolean),cursor:start,next_cursor:start+slots.length<168?start+slots.length:null});
    }
    if(action!=='preview'&&action!=='restore')return reply({error:'Only read-only preview or ledger-only restore is supported.'},400);
    const slot=checkedSlot(body?.slot);
    const backup=await purchaseBackupRows(env,slot);
    if(!backup)return reply({error:'No stored R2 Purchasing History backup exists in this slot. Nothing was changed.'},404);
    const live=await readDataTable(env,'purchase_orders');
    const plan=candidates(backup,live);
    const snapshot=()=>({
      slot,backup_count:backup.filter(validPurchase).length,live_count:live.length,
      missing_count:plan.additions.length,duplicate_count:plan.duplicates.length,
      conflict_count:plan.conflicts.length,conflicts:plan.conflicts.slice(0,12),
      oldest:minDate(plan.additions),newest:maxDate(plan.additions)
    });
    if(action==='preview')return reply({ok:true,preview:snapshot(),stock_changed:false});
    if(plan.conflicts.length)return reply({error:'Historical purchase conflicts exist. No records restored. Review receipt IDs before continuing.',preview:snapshot()},409);
    if(plan.additions.length>10000)return reply({error:'Too many records for one transaction. No records restored.'},413);
    if(body?.expected_missing!==plan.additions.length||
       body?.expected_backup_count!==backup.filter(validPurchase).length)
      return reply({error:'Backup or purchase history changed after preview. Preview again.'},409);
    const saved=await replaceDataTable(env,'purchase_orders',existing=>{
      const latest=candidates(backup,existing as Row[]);
      if(latest.conflicts.length)throw Object.assign(new Error('Purchasing conflicts detected while restoring. No records were saved.'),{status:409});
      // This is a receipt audit migration only. Never credit stock, allocate
      // waybills, change an order or generate an invoice from a backup.
      return {rows:latest.additions.length?[...existing,...latest.additions]:existing,
        result:{added:latest.additions.length,already_present:latest.duplicates.length}};
    });
    return reply({ok:true,...saved,source_slot:slot,stock_changed:false,invoices_changed:false,
      message:'Historical Purchasing History receipts restored by ID only. Physical stock was not changed.'});
  }catch(error:any){return reply({error:String(error?.message||error)},Number(error?.status||503));}
};
