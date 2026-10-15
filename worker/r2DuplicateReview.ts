import { readDataTable, replaceDataTable } from './cloudflareData';
type Verify=(request:Request,env:unknown)=>Promise<Record<string,any>|null>;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-ora-storage':'cloudflare-r2'}});
export const r2DuplicateReviewHandler=async(request:Request,env:unknown,verify:Verify):Promise<Response|null>=>{
  const url=new URL(request.url);
  if(url.pathname!=='/api/orders/duplicate-review')return null;
  const user=await verify(request,env);if(!user)return json({error:'Login session required.'},401);
  if(user.role!=='admin'&&!(user.permissions||[]).includes('orders'))return json({error:'Orders permission required.'},403);
  if(request.method==='GET'){
    const rows=await readDataTable(env,'order_snapshots'),all=rows.map(row=>row.payload).filter(Boolean);
    const pending=all.filter(order=>order.is_duplicate_order&&order.order_status!=='Cancelled');
    const approved=all.filter(order=>order.duplicate_review_status==='Approved');
    const search=(url.searchParams.get('search')||'').trim().toLowerCase(),page=Math.max(1,Math.floor(Number(url.searchParams.get('page'))||1));
    const selected=(url.searchParams.get('status')==='approved'?approved:pending).filter(order=>!search||[order.order_number,order.customer_name,order.phone,order.city].join(' ').toLowerCase().includes(search))
      .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    return json({pending:pending.length,approved:approved.length,total:selected.length,page,pairs:selected.slice((page-1)*10,page*10).map(order=>({order,original:all.find(original=>String(original.id)===String(order.duplicate_of_order_id))||null}))});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  if(user.role!=='admin'&&(user.permissions||[]).includes('level:orders:view'))return json({error:'Orders edit permission required.'},403);
  const body:any=await request.json().catch(()=>null);
  if(body?.action!=='approve_separate'||typeof body?.order_id!=='string'||body.order_id.length>150)return json({error:'Choose the order to approve.'},400);
  const result=await replaceDataTable(env,'order_snapshots',rows=>{
    const row=rows.find(row=>String(row.order_id)===body.order_id);
    if(!row?.payload)throw Object.assign(new Error('Order not found.'),{status:404});
    const order=row.payload;
    if(order.duplicate_review_status==='Approved'&&!order.is_duplicate_order)return {rows,result:{order,already_approved:true}};
    if(!order.is_duplicate_order||order.order_status==='Cancelled')throw Object.assign(new Error('This order is not awaiting duplicate review.'),{status:409});
    const now=new Date().toISOString();
    const updated={...order,is_duplicate_order:false,duplicate_review_status:'Approved',duplicate_reviewed_at:now,duplicate_reviewed_by:String(user.id),duplicate_reviewed_by_name:String(user.display_name||user.username||'Admin')};
    return {rows:rows.map(current=>current===row?{...row,payload:updated,updated_at:now}:current),result:{order:updated,already_approved:false}};
  });
  return json({ok:true,...result});
};
