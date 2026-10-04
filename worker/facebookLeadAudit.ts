import { readDataTable } from './cloudflareData';
import { verifyActiveStaff } from './r2RecoveryFallback';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const leadKey=(id:unknown)=>String(id||'').trim().replace(/^l:/i,'');
class AuditSourceError extends Error {}
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const pageCursor=(data:any,current:string)=>{
  if(!Array.isArray(data?.data))throw new AuditSourceError('Facebook returned an incomplete source page.');
  if(!data.paging?.next)return '';
  const next=data.paging?.cursors?.after;
  if(typeof next!=='string'||!next||next.length>4096||next===current)throw new AuditSourceError('Facebook pagination could not be verified.');
  return next;
};

// Read-only audit. Page credentials never leave the Worker, and only a current
// Super Admin session can see lead IDs or the comparison with private orders.
const runFacebookLeadAudit=async(request:Request,env:any,fetcher:typeof fetch):Promise<Response|null>=>{
  if(new URL(request.url).pathname!=='/api/admin/facebook-leads/audit')return null;
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const user=await verifyActiveStaff(request,env);
  if(!user)return json({error:'Login required.'},401);
  if(user.role!=='admin')return json({error:'Super Admin access required.'},403);
  const body:any=await request.json().catch(()=>null);
  const allAvailable=body?.scope==='all_available';
  const since=allAvailable?0:Date.parse(body?.since||''),until=Date.parse(body?.until||'');
  if(!Number.isFinite(since)||!Number.isFinite(until)||since>until||(!allAvailable&&since<Date.now()-3*86400000)||until>Date.now()+60000)return json({error:allAvailable?'Choose a valid audit cutoff.':'Choose a valid audit window within the last three days.'},400);
  if(allAvailable&&body.action==='compare'){
    if(!Array.isArray(body.lead_ids)||!body.lead_ids.length||body.lead_ids.length>200||!body.lead_ids.every(validId)||new Set(body.lead_ids).size!==body.lead_ids.length)return json({error:'Compare one to 200 unique lead IDs per request.'},400);
    const orders=(await readDataTable(env,'order_snapshots')).map(row=>row.payload).filter(Boolean);
    const byLead=new Map(orders.map(order=>[leadKey(order.platform_lead_id),order]));
    return json({ok:true,checked_at:new Date().toISOString(),results:body.lead_ids.map((id:string)=>({lead_id:id,order_number:byLead.get(leadKey(id))?.order_number||null}))});
  }
  if(body?.action==='sheet'){
    const orders=(await readDataTable(env,'order_snapshots')).map(row=>row.payload).filter(Boolean);
    if(!Array.isArray(body.order_numbers)||body.order_numbers.length>5)return json({error:'Check at most five orders per request.'},400);
    const state=(await readDataTable(env,'admin_data_store')).find(row=>row.key==='storefront-state-v1')?.payload;
    const webhook=String(state?.settings?.google_sheet_webhook_url||'');
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(webhook))return json({error:'Google Sheet integration is not configured.'},503);
    const selected=[...new Set(body.order_numbers)].map(number=>orders.find(order=>String(order.order_number)===String(number)&&order.order_source==='Facebook Ads'));
    if(selected.some(order=>!order))return json({error:'Unknown Facebook order.'},400);
    const results=await Promise.all(selected.map(async(order)=>{
      const number=order.order_number;
      try{
        const r=await fetcher(webhook,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'read_order',orderId:number}),redirect:'follow',signal:AbortSignal.timeout(12000)});
        const data:any=await r.json();
        if(!r.ok||data?.ok===false||data?.status!=='order_checked')throw new Error('Sheet read-back failed.');
        return {order_number:number,found:data.found===true,rows:Number(data.rows||0),expected_rows:Math.max(1,order.items?.length||0)};
      }catch{return {order_number:number,error:'Google Sheet could not be verified. Retry the audit.'};}
    }));
    return json({ok:true,results});
  }
  if(!env.META_PAGE_ACCESS_TOKEN)return json({error:'Facebook Page access token is missing.'},503);
  const graph=async(path:string,params:Record<string,string>)=>{
    const url=new URL('https://graph.facebook.com/'+String(env.META_GRAPH_API_VERSION||'v26.0')+'/'+path);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    const r=await fetcher(url,{headers:{authorization:'Bearer '+env.META_PAGE_ACCESS_TOKEN},signal:AbortSignal.timeout(6500)});
    const data:any=await r.json();if(!r.ok||data?.error)throw new AuditSourceError('Facebook read failed'+(Number.isInteger(data?.error?.code)?' (#'+data.error.code+').':'.'));
    return data;
  };
  const page=await graph('me',{fields:'id'});
  if(allAvailable){
    if(!validId(String(page.id||'')))throw new AuditSourceError('The connected Facebook Page could not be verified.');
    if(body.page_id&&body.page_id!==String(page.id))return json({error:'The connected Facebook Page changed; restart the audit.'},409);
    const cursor=body.cursor??'';
    if(typeof cursor!=='string'||cursor.length>4096)return json({error:'Invalid audit cursor.'},400);
    if(body.action==='forms'){
      const data=await graph(String(page.id)+'/leadgen_forms',{fields:'id,name,status,expired_leads_count',limit:'100',...(cursor?{after:cursor}:{})});
      const next=pageCursor(data,cursor);
      if(data.data.some((form:any)=>!validId(String(form?.id||''))))throw new AuditSourceError('Facebook returned an invalid form.');
      return json({ok:true,scope:'all_available',page_id:String(page.id),forms:data.data.map((form:any)=>({id:String(form.id),name:String(form.name||form.id),status:String(form.status||''),expired_leads_count:Number.isInteger(form.expired_leads_count)&&form.expired_leads_count>=0?form.expired_leads_count:null})),next_cursor:next,done:!next});
    }
    if(body.action==='lead_page'){
      if(!validId(body.form_id))return json({error:'Invalid Facebook form.'},400);
      // The form must belong to the Page authenticated by the existing Page
      // token. Credentials and Meta paging URLs never go to the browser.
      const form=await graph(body.form_id,{fields:'id,name,page_id'});
      if(String(form.page_id||'')!==String(page.id))return json({error:'The Facebook form does not belong to the connected Page.'},403);
      const data=await graph(body.form_id+'/leads',{fields:'id,created_time',limit:'100',...(cursor?{after:cursor}:{})});
      const next=pageCursor(data,cursor);
      if(data.data.some((lead:any)=>!validId(String(lead?.id||''))||!Number.isFinite(Date.parse(lead.created_time))))throw new AuditSourceError('Facebook returned an invalid lead; source coverage is incomplete.');
      const leads=data.data.filter((lead:any)=>Date.parse(lead.created_time)<=until).map((lead:any)=>({lead_id:String(lead.id),created_at:lead.created_time,form_id:body.form_id,form_name:String(form.name||body.form_id)}));
      return json({ok:true,scope:'all_available',page_id:String(page.id),form_id:body.form_id,leads,next_cursor:next,done:!next});
    }
    return json({error:'Unknown audit action.'},400);
  }
  let forms:any[]=[],after='';
  for(let pageIndex=0;pageIndex<3;pageIndex++){
    const data=await graph(String(page.id)+'/leadgen_forms',{fields:'id,name',limit:'100',...(after?{after}:{})});
    forms.push(...(data.data||[]));after=data.paging?.next?String(data.paging?.cursors?.after||''):'';
    if(!after)break;
  }
  if(after)return json({error:'Facebook form list is incomplete. No all-clear result was produced.'},503);
  forms=forms.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const ids=forms.map(form=>String(form.id)).join(',');
  if(body.form_list&&body.form_list!==ids)return json({error:'Facebook form list changed; restart the audit.'},409);
  const offset=Number(body.offset||0);
  if(!Number.isInteger(offset)||offset<0||offset>forms.length)return json({error:'Invalid audit offset.'},400);
  // Keep each browser request bounded even when Meta is slow. Independent form
  // reads run together; each form's pagination remains sequential.
  const selected=forms.slice(offset,offset+2);
  const batches=await Promise.all(selected.map(async(form)=>{
    const leads:any[]=[],errors:string[]=[];
    let cursor='';
    try{
      for(let pageIndex=0;pageIndex<3;pageIndex++){
        const data=await graph(String(form.id)+'/leads',{fields:'id,created_time',since:String(Math.floor(since/1000)),limit:'100',...(cursor?{after:cursor}:{})});
        for(const lead of data.data||[]){
          const created=Date.parse(lead.created_time);
          if(!Number.isFinite(created)||created<since||created>until)continue;
          leads.push({lead_id:String(lead.id),created_at:lead.created_time,form_name:String(form.name||form.id)});
        }
        cursor=data.paging?.next?String(data.paging?.cursors?.after||''):'';
        if(!cursor)break;
      }
      if(cursor)errors.push(String(form.name||form.id)+': Lead list incomplete.');
    }catch(error:any){errors.push(String(form.name||form.id)+': '+String(error.message||'Facebook read failed.'));}
    return {leads,errors};
  }));
  const leads=batches.flatMap(batch=>batch.leads),errors=batches.flatMap(batch=>batch.errors);
  // Leads can finish importing while Meta is responding. Compare against the
  // latest ETag-validated R2 snapshot after the scan, rather than an earlier read.
  const orders=(await readDataTable(env,'order_snapshots')).map(row=>row.payload).filter(Boolean);
  const byLead=new Map(orders.map(order=>[leadKey(order.platform_lead_id),order]));
  const compared=leads.map(lead=>({...lead,order_number:byLead.get(leadKey(lead.lead_id))?.order_number||null}));
  return json({ok:true,form_list:ids,total_forms:forms.length,forms_checked:selected.length,next_offset:offset+selected.length,done:offset+selected.length>=forms.length,leads:compared,errors});
};

export const facebookLeadAuditHandler=async(request:Request,env:any,fetcher:typeof fetch=fetch):Promise<Response|null>=>{
  try{return await runFacebookLeadAudit(request,env,fetcher);}
  catch(error){return json({error:error instanceof AuditSourceError?error.message:'Audit source read failed. Retry the audit.'},503);}
};
