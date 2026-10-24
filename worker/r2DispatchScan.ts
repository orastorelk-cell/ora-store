import { readPackingInProgress, replaceDataTable } from './cloudflareData';

export const r2DispatchScanHandler = async (request: Request, env: unknown, user: Record<string, any>, id: string) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,
    headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ora-storage':'cloudflare-r2'}});
  if (user.role !== 'admin' && (!(user.permissions || []).includes('dispatch') || (user.permissions || []).includes('level:dispatch:view')))
    return json({error:'Dispatch edit permission required.'},403);
  const body = await request.json().catch(() => null), barcode = body?.barcode;
  if (typeof barcode !== 'string' || !barcode.trim() || barcode.length > 100) return json({error:'Scan a valid waybill barcode first.'},400);
  if (await readPackingInProgress(env)) return json({error:'A packing batch is finishing. Retry its saved operation first.'},409);
  const now = new Date().toISOString();
  const saved = await replaceDataTable(env,'order_snapshots',rows => {
    const matches = rows.filter(row => String(row.order_id) === id);
    if (matches.length !== 1) return {rows,result:{status:404,body:{error:'Order not found in the durable order store.'}}};
    const row = matches[0], order = row.payload;
    const reject = (error: string) => ({rows,result:{status:409,body:{error}}});
    if (![String(order.waybill_number || '').trim(),String(order.order_number || '').trim()].includes(barcode.trim()))
      return reject('The scanned barcode no longer matches this order.');
    if (order.dispatch_status === 'Handed Over') return {rows,result:{status:200,body:{ok:false,duplicate:true,order,message:order.order_number+' was already scanned for courier handover.'}}};
    if (!order.invoice_locked || !order.stock_allocated || !order.waybill_number) return reject('Invoice, allocated stock and a waybill are required before handover.');
    if (order.order_status === 'Cancelled' || order.return_sheet_id || order.return_tracking_waybill || order.item_edit_lock || order.variant_correction_lock || order.stock_quantity_correction_lock || order.return_packing_lock)
      return reject('This parcel is cancelled, in returns, or being corrected. Complete that workflow before handover.');
    const updated = {...order,dispatch_status:'Handed Over',dispatch_scanned_at:now,
      dispatch_scanned_by:String(user.display_name || user.username || 'Staff'),
      ...(order.order_status === 'Delivered' ? {} : {order_status:'Shipped',delivery_status:'Handed Over to Courier',tracking_status:'Awaiting Fardar Scan'})};
    return {rows:rows.map(candidate => candidate === row ? {...row,payload:updated,updated_at:now} : candidate),
      result:{status:200,body:{ok:true,order:updated,message:order.order_number+' marked Handed Over to Courier.'}}};
  });
  return json(saved.body,saved.status);
};
