import { readPackingInProgress, replaceDataTable, readDataTable } from './cloudflareData';
import { authorizedDispatchTarget, AUTHORIZED_DISPATCH_WAYBILLS, historicalDispatchBlockers, reconcileAuthorizedDispatch } from '../src/lib/authorizedDispatchReconciliation';

export const r2DispatchScanHandler = async (request: Request, env: unknown, user: Record<string, any>, id: string) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,
    headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ora-storage':'cloudflare-r2'}});
  if (user.role !== 'admin' && (!(user.permissions || []).includes('dispatch') || (user.permissions || []).includes('level:dispatch:view')))
    return json({error:'Dispatch edit permission required.'},403);
  const body = await request.json().catch(() => null), barcode = body?.barcode;
  if (typeof barcode !== 'string' || !barcode.trim() || barcode.length > 100) return json({error:'Scan a valid waybill barcode first.'},400);
  if (await readPackingInProgress(env)) return json({error:'A packing batch is finishing. Retry its saved operation first.'},409);
  const scannedBarcode=barcode.trim();
  const historicalBarcode=AUTHORIZED_DISPATCH_WAYBILLS.some(target=>[target.order_number,target.waybill].includes(scannedBarcode));
  // Historical repair requires the journal of each saved stock/item correction;
  // a stale lock is cleared ONLY when its matching journal is fully complete.
  const adminRows=historicalBarcode ? await readDataTable(env,'admin_data_store') : [];
  const now = new Date().toISOString();
  const saved = await replaceDataTable(env,'order_snapshots',rows => {
    const matches = rows.filter(row => String(row.order_id) === id);
    if (matches.length !== 1) return {rows,result:{status:404,body:{error:'Order not found in the durable order store.'}}};
    const row = matches[0], order = row.payload;
    const reject = (error: string, blockers?:string[]) => ({rows,result:{status:409,body:{error,...(blockers?{blockers}:{})}}});
    if (![String(order.waybill_number || '').trim(),String(order.order_number || '').trim()].includes(scannedBarcode))
      return reject('The scanned barcode no longer matches this order.');
    // Five user-authorized historical parcels were already delivered. Do not
    // invent a contemporary scan timestamp or roll Delivered back to Shipped.
    if(historicalBarcode && authorizedDispatchTarget(order.order_number,order.waybill_number)){
      const result=reconcileAuthorizedDispatch(rows,now,adminRows,String(row.order_id));
      const confirmed=result.reconciled.includes(String(order.order_number));
      if(confirmed){
        const updated=result.rows.find(candidate=>String(candidate.order_id)===id)!.payload;
        return {rows:result.rows,result:{status:200,body:{ok:true,order:updated,
          message:order.order_number+' historical delivered handover reconciled from saved courier evidence.'}}};
      }
      const completed=result.already_saved.includes(String(order.order_number));
      if(completed)return {rows,result:{status:200,body:{ok:false,duplicate:true,order,
        message:order.order_number+' has already been reconciled and delivered.'}}};
      const reason=result.skipped.find(entry=>entry.order_number===order.order_number)?.reason||'Historical waybill reconciliation requires review.';
      return reject('Historical delivery reconciliation blocked: '+reason,[reason]);
    }
    if (order.dispatch_status === 'Handed Over') return {rows,result:{status:200,body:{ok:false,duplicate:true,order,message:order.order_number+' was already scanned for courier handover.'}}};
    if (!order.invoice_locked || !order.stock_allocated || !order.waybill_number) return reject('Invoice, allocated stock and a waybill are required before handover.');
    const blockers=historicalDispatchBlockers(order);
    if(blockers.length)return reject('Scan was not saved: '+blockers.join('; '),blockers);
    const updated = {...order,dispatch_status:'Handed Over',dispatch_scanned_at:now,
      dispatch_scanned_by:String(user.display_name || user.username || 'Staff'),
      ...(order.order_status === 'Delivered' ? {} : {order_status:'Shipped',delivery_status:'Handed Over to Courier',tracking_status:'Awaiting Fardar Scan'})};
    return {rows:rows.map(candidate => candidate === row ? {...row,payload:updated,updated_at:now} : candidate),
      result:{status:200,body:{ok:true,order:updated,message:order.order_number+' marked Handed Over to Courier.'}}};
  });
  return json(saved.body,saved.status);
};
