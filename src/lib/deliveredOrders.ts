export type DeliveredEntry={waybill:string;order_number?:string;delivered_at?:string;delivery_fee?:number};
const key=(value:unknown)=>String(value??'').trim().replace(/^'+|'+$/g,'').toLowerCase();
export const applyDeliveredReport=(orders:any[],entries:DeliveredEntry[],now=new Date().toISOString())=>{
  const result={updated:0,alreadyDelivered:0,notFound:0,notShipped:0,mismatch:0,ambiguous:0,details:[] as string[],updatedOrders:[] as any[]};
  const byWaybill=new Map<string,any[]>();
  for(const order of orders){const wb=key(order.waybill_number);if(wb)byWaybill.set(wb,[...(byWaybill.get(wb)||[]),order]);}
  const seen=new Set<string>();
  const detail=(text:string)=>{if(result.details.length<20)result.details.push(text);};
  for(const entry of entries){
    const wb=key(entry.waybill);if(!wb||seen.has(wb))continue;seen.add(wb);
    const matches=byWaybill.get(wb)||[];
    if(!matches.length){result.notFound++;detail('NOT FOUND: '+entry.waybill);continue;}
    if(matches.length!==1){result.ambiguous++;detail('BLOCKED DUPLICATE WAYBILL: '+entry.waybill);continue;}
    const order=matches[0],number=String(entry.order_number||'').trim();
    if(/^(FB|TK|WEB|MAN)-/i.test(number)&&key(number)!==key(order.order_number)){
      result.mismatch++;detail('ORDER ID MISMATCH: '+entry.waybill);continue;
    }
    const status=key(order.order_status);
    if(status==='delivered'){result.alreadyDelivered++;continue;}
    if(status!=='shipped'){result.notShipped++;detail('SKIPPED NOT SHIPPED: '+order.order_number);continue;}
    const date=new Date(String(entry.delivered_at||now));
    const at=Number.isFinite(date.getTime())?date.toISOString():now;
    const fee=entry.delivery_fee;
    result.updatedOrders.push({...order,order_status:'Delivered',delivery_status:'Delivered',tracking_status:'Delivered',
      fardar_tracking_updated_at:at,
      ...(typeof fee==='number'&&Number.isFinite(fee)&&fee>=0?{internal_delivery_fee:fee}:{}),
      fardar_tracking_history:[...(Array.isArray(order.fardar_tracking_history)?order.fardar_tracking_history:[]),{status:'Delivered',at,note:'Fardar Delivered CSV Upload'}],
    });
    result.updated++;
  }
  return result;
};
