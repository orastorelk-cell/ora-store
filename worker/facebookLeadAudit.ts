import { readDataTable } from './cloudflareData';
import { verifyActiveStaff } from './r2RecoveryFallback';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const leadKey=(id:unknown)=>String(id||'').trim().replace(/^l:/i,'');

// Read-only audit. Page credentials never leave the Worker, and only a current
// Super Admin session can see lead IDs or the comparison with private orders.
const runFacebookLeadAudit=async(request:Request,env:any,fetcher:typeof fetch):Promise<Response|null>=>{
  if(new URL(request.url).pathname!=='/api/admin/facebook-leads/audit')return null;
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const user=await verifyActiveStaff(request,env);
  if(!user)return json({error:'Login required.'},401);
  if(user.role!=='admin')return json({error:'Super Admin access required.'},403);
  const body:any=await request.json().catch(()=>null);
  const since=Date.parse(body?.since||''),until=Date.parse(body?.until||'');
  if(!Number.isFinite(since)||!Number.isFinite(until)||since>until||since<Date.now()-3*86400000||until>Date.now()+60000)return json({error:'Choose a valid audit window within the last three days.'},400);
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
    const data:any=await r.json();if(!r.ok||data?.error)throw new Error('Facebook read failed'+(data?.error?.code?' (#'+data.error.code+')':'.'));
    return data;
  };
  const page=await graph('me',{fields:'id'});
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
  catch{return json({error:'Audit source read failed. Retry the audit.'},503);}
};
