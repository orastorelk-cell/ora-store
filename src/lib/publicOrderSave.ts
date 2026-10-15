import type { Order } from '../types';
const KEY='ora_pending_website_order_v1';
let pending:any=null;
const signature=(order:Order)=>JSON.stringify([order.phone,order.whatsapp,order.customer_name,order.address,order.city,order.district,order.payment_method,order.total_amount,order.gift_wrap_selected,order.notes,
  order.items.map(item=>[item.product_id,item.variant_id,item.quantity,item.unit_price])]);

export const savePublicOrder = async (order:Order,customerAccessToken?:string,deferSheetSync=false,waitForSheetSync=false,network:typeof fetch=fetch):Promise<Order>=>{
  const website=order.order_source==='Website'&&!order.is_test_order;
  let saved=order;
  if(website){
    try{pending=JSON.parse(sessionStorage.getItem(KEY)||'null')||pending;}catch{}
    if(pending&&pending.signature===signature(order))saved=pending.order;
    pending={signature:signature(saved),order:saved};
    try{sessionStorage.setItem(KEY,JSON.stringify(pending));}catch{}
  }
  for(let attempt=0;;attempt++){
    try{
      const response=await network('/api/orders',{method:'POST',headers:{'content-type':'application/json',...(customerAccessToken?{authorization:'Bearer '+customerAccessToken}:{})},
        body:JSON.stringify({order:saved,defer_sheet_sync:deferSheetSync,wait_sheet_sync:waitForSheetSync}),signal:AbortSignal.timeout(20000)});
      const data:any=await response.json().catch(()=>({}));
      if(!response.ok||data.ok!==true||!data.order?.id||!data.order?.order_number){const error:any=new Error(data.error||`Order server save failed (${response.status})`);error.status=response.ok?503:response.status;throw error;}
      if(website){pending=null;try{sessionStorage.removeItem(KEY);}catch{}}
      return data.order;
    }catch(error:any){
      if(attempt>=2||error.status&&![408,429,500,502,503,504].includes(error.status))throw error;
      await new Promise(resolve=>setTimeout(resolve,1100*(attempt+1)));
    }
  }
};
