import { replaceDataTable } from './cloudflareData';

// One ETag write for a verified import batch. Only Sheet metadata is merged into
// CURRENT orders, so a slow Sheet response cannot overwrite an invoice, stock
// allocation or staff correction made while the sync was in flight.
export const markR2SheetSynced=async(orders:any[],env?:unknown,verified=false)=>{
  const wanted=new Map(orders.map(order=>[String(order.id),order]));
  const now=new Date().toISOString();
  return replaceDataTable(env,'order_snapshots',rows=>{
    const saved=new Map<string,any>();let changed=false;
    const next=rows.map(row=>{
      const input=wanted.get(String(row.order_id)),current=row.payload;
      if(!input)return row;
      if(!current||String(current.id)!==String(input.id)||String(current.order_number)!==String(input.order_number))throw new Error('Imported order identity changed before Sheet acknowledgment.');
      if(current.is_synced_google_sheets===true&&(!verified||current.sheet_sync_verified_at)){saved.set(String(input.id),current);return row;}
      const order={...current,is_synced_google_sheets:true,synced_at:current.synced_at||now,...(verified?{sheet_sync_verified_at:now}:{})};
      changed=true;saved.set(String(input.id),order);return {...row,payload:order,updated_at:now};
    });
    if(saved.size!==wanted.size)throw new Error('Some imported orders are missing from durable storage.');
    return {rows:changed?next:rows,result:orders.map(order=>saved.get(String(order.id)))};
  });
};
