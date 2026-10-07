import type { ReturnStorage } from './r2ReturnSheets';
import { returnActor, returnCatalog, returnJson, saveReturnCatalog, setReturnPackingPending, upsertReturnRow } from './r2ReturnSheets';
import { RETURN_PACKING_PREFIX, returnContainersFromRows, returnFail, returnPackingInProgress, inventoryReturnTarget, physicalReturnItems } from '../src/lib/returnSheets';
import { applyInvoiceQueue, invoiceComplete } from '../src/lib/invoiceQueue';
import { cancellationInProgress } from './r2OrderCancellation';

type Row = Record<string,any>;
const signature = (order: Row) => JSON.stringify([order.id,order.order_number,order.items,order.call_center_status,order.order_status,
  order.stock_allocated,order.stock_status,order.waybill_number,order.invoice_locked,order.invoice_number,order.return_tracking_waybill,order.return_sheet_id]);
const ready = (order: Row) => order.call_center_status === 'Confirmed' && !['Cancelled','Shipped','Delivered'].includes(order.order_status) &&
  !order.is_duplicate_order && !order.is_test_order && !order.return_tracking_waybill && !order.return_sheet_id && !invoiceComplete(order) &&
  !order.invoice_locked && !order.invoice_number && !order.invoice_generated_at && order.dispatch_status !== 'Handed Over' &&
  !order.fardar_csv_exported_at;
const setJournal = (rows: readonly Row[], journal: Row) => upsertReturnRow(rows,RETURN_PACKING_PREFIX + journal.operation_id,journal);
const currentJournal = (rows: readonly Row[], id: string) => rows.find(row => row.key === RETURN_PACKING_PREFIX + id)?.payload;

// The catalog and stock deduction share one ETag transaction with this journal.
// Courier reservation and order writes resume from its recorded plan after any
// lost acknowledgement; no retry deducts stock or creates another invoice.
export const returnPackingHandler = async (request: Request, storage: ReturnStorage, user: Row) => {
  const path = new URL(request.url).pathname;
  const download = path.endsWith('/downloaded');
  const input:any=request.method==='POST'?await request.json().catch(()=>({})):{};
  const id = download ? path.split('/').at(-2)! : request.method === 'GET' ? path.split('/').at(-1)! : String(input.operation_id || '');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(id)) return returnJson({ error: 'A packing operation ID is required.' },400);
  if (download && request.method === 'POST') {
    const journal=currentJournal(await storage.readAdmin(),id);
    if(!journal||journal.phase!=='complete')returnFail('Finish the saved packing batch before downloading.');
    const now=journal.downloaded_at||new Date().toISOString(), actor=journal.downloaded_by||returnActor(user);
    await storage.updateOrders(new Map(journal.plans.map((plan:Row)=>[plan.id,(order:Row)=>{
      if(order.return_packing_operation!==id||order.invoice_pack_batch_id!==journal.batch_id||String(order.waybill_number)!==plan.waybill)returnFail('Saved packing order changed before export.');
      if(order.invoice_pack_downloaded_at&&order.fardar_csv_exported_waybill===plan.waybill&&order.fardar_csv_export_batch_id===journal.batch_id)return order;
      return {...order,invoice_pack_downloaded_at:order.invoice_pack_downloaded_at||now,invoice_pack_downloaded_by:order.invoice_pack_downloaded_by||actor,
        fardar_csv_exported_at:order.fardar_csv_exported_at||now,fardar_csv_exported_by:order.fardar_csv_exported_by||actor,fardar_csv_export_batch_id:journal.batch_id,
        fardar_csv_exported_waybill:plan.waybill,waybill_protection_locked:true,waybill_protection_reason:'Return packing batch PDF and Fardar CSV exported together.'};
    }])));
    await storage.changeAdmin(rows=>({rows:setJournal(rows,{...currentJournal(rows,id),downloaded_at:now,downloaded_by:actor}),result:null}));
    return returnJson({ok:true,batch_id:journal.batch_id});
  }
  if (request.method === 'GET') {
    const journal = currentJournal(await storage.readAdmin(),id); if (!journal) return returnJson({ error: 'Packing batch not found.' },404);
    if (journal.phase !== 'complete') return returnJson({ error: 'Retry this packing operation to finish the saved batch.',operation_id: id },409);
    const orders = await storage.readOrders();
    return returnJson({ ok: true,batch_id: journal.batch_id,operation_id: id,orders: journal.order_ids.map((value: string) => orders.find(order => String(order.id) === value)).filter(Boolean),settings: journal.settings,skipped: journal.skipped,created_at: journal.created_at });
  }
  if (request.method !== 'POST') return returnJson({ error: 'Method not supported.' },405);
  if (!storage.readWaybills || !storage.changeWaybills) returnFail('Shared waybill pool unavailable.',503);
  const [orders,pool] = await Promise.all([storage.readOrders(),storage.readWaybills()]);
  let journal = await storage.changeAdmin(rows => {
    const previous = currentJournal(rows,id);
    if (previous) { if (previous.phase === 'failed') returnFail('Start a new packing operation. ' + (previous.error || ''));  return { rows,result: previous }; }
    if (returnPackingInProgress(rows) || cancellationInProgress(rows as Row[])) returnFail('Another stock batch is finishing. Retry after it completes.');
    const unchecked = returnContainersFromRows(rows).flatMap(sheet => sheet.parcels).filter(parcel => parcel.scanned_at && !parcel.checked_at && !parcel.review_reason);
    if (unchecked.length) returnFail('Check ' + unchecked.length + ' opened return parcel(s) before creating this packing batch.');
    const catalog = returnCatalog(rows), products = structuredClone(catalog.payload.products);
    const owners = new Map(orders.filter(order => order.waybill_number).map(order => [String(order.waybill_number).trim(),String(order.id)]));
    const available = pool.filter(row => row.status === 'Available' && !row.permanently_retired && /fardar/i.test(String(row.courier_name || 'Fardar')) && !owners.has(String(row.waybill_number))).sort((a,b) => String(a.imported_at || '').localeCompare(String(b.imported_at || '')));
    const plans: Row[] = [], logs: Row[] = [], skipped = { stock: 0,waybills: 0,details: 0,limit: 0 }; const now = new Date().toISOString();
    for (const order of orders.filter(ready).sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)))) {
      if (plans.length >= 200) { skipped.limit++; continue; }
      if (order.stock_allocated===true&&order.stock_status!=='Allocated'){skipped.details++;continue;}
      if (!order.customer_name || !order.phone || !order.address || !(order.fardar_city || order.city) || !Number.isFinite(Number(order.total_amount))) { skipped.details++; continue; }
      let items; try { items = physicalReturnItems(order); } catch { skipped.details++; continue; }
      if (order.stock_allocated !== true && !items.every(item => { try { const { target } = inventoryReturnTarget(products,item); return Number.isSafeInteger(Number(target.stock_quantity||0))&&Number(target.stock_quantity || 0) >= item.expected_qty && !Number(target.return_stock_debt||0) && !target.force_out_of_stock; } catch { return false; } })) { skipped.stock++; continue; }
      let wb = String(order.waybill_number || '').trim(), reservation: Row | undefined;
      if (wb) {
        const other = orders.some(value => value.id !== order.id && String(value.waybill_number || '').trim() === wb);
        const lock = pool.find(row => String(row.waybill_number) === wb);
        if (other || (lock && (lock.permanently_retired || lock.status === 'Cancelled' || (['Assigned','Used'].includes(lock.status) && String(lock.assigned_order_number || '') !== String(order.order_number))))) { skipped.waybills++; continue; }
        if (lock?.status === 'Available') reservation = lock;
        if (lock?.courier_name && !/fardar/i.test(String(lock.courier_name))) { skipped.waybills++; continue; }
      } else { reservation = available.shift(); if (!reservation) { skipped.waybills++; continue; } wb = String(reservation.waybill_number); }
      const history: Row[] = [];
      if (order.stock_allocated !== true) for (const item of items) {
        const { product,target } = inventoryReturnTarget(products,item), before = Number(target.stock_quantity || 0), after = before - item.expected_qty;
        target.stock_quantity = after; target.status = after > 0 ? 'Active' : 'Out of Stock';
        if (item.variant_id) { product.stock_quantity = product.variants.reduce((n: number,v: Row) => n + Number(v.stock_quantity || 0),0); product.status = product.stock_quantity > 0 ? 'Active' : 'Out of Stock'; }
        history.push({ id: 'return-stock:packing:' + id + ':' + order.id + ':' + item.id,product_id: item.product_id,variant_id: item.variant_id,product_name: item.name,
          change_type: 'Order Deduction',quantity: item.expected_qty,previous_stock: before,new_stock: after,reason: 'Return packing batch / ' + order.order_number,performed_by: returnActor(user),created_at: now });
      }
      plans.push({ id: String(order.id),order_number: order.order_number,before: signature(order),waybill: wb,courier_name: reservation?.courier_name || order.courier_name || 'Fardar',reserve: !!reservation,new_allocation: order.stock_allocated !== true });
      logs.push(...history);
      const at = available.findIndex(row => String(row.waybill_number) === wb); if (at >= 0) available.splice(at,1);
    }
    const prepared = { operation_id: id,batch_id: 'PACK-RETURN-' + id,phase: 'prepared',created_at: now,actor: returnActor(user),plans,order_ids: plans.map(plan => plan.id),products_after: products,stock_history: logs,settings: catalog.payload.settings || {},skipped };
    return { rows: saveReturnCatalog(setReturnPackingPending(setJournal(rows,prepared),true),catalog.payload.products),result: prepared };
  });
  if (journal.phase === 'complete') return returnPackingHandler(new Request(new URL('/api/returns/packing/' + id,request.url)),storage,user);
  if (journal.phase === 'prepared') {
    try {
      await storage.changeWaybills(rows => {
        for (const plan of journal.plans.filter((plan: Row) => plan.reserve)) {
          const row = rows.find(row => String(row.waybill_number) === plan.waybill);
          if (!row || row.permanently_retired || (row.status !== 'Available' && !(row.status === 'Assigned' && String(row.assigned_order_id) === plan.id && row.return_packing_operation === id))) returnFail('Waybill pool changed. Start this packing batch again.');
        }
        let changed = false;
        const next = rows.map(row => { const plan = journal.plans.find((plan: Row) => plan.reserve && String(row.waybill_number) === plan.waybill); if (!plan || row.return_packing_operation === id) return row;
          changed = true; return { ...row,status: 'Assigned',assigned_order_id: plan.id,assigned_order_number: plan.order_number,assigned_at: journal.created_at,return_packing_operation: id }; });
        return { rows: changed ? next : rows,result: null };
      });
    } catch (error: any) {
      // A known reservation conflict commits no pool rows. A transient/lost-ack
      // error leaves the journal resumable with the same protected reservations.
      if (error.status === 409) {
        await storage.changeAdmin(rows => {const current=currentJournal(rows,id);return {rows:current.phase==='prepared'?setJournal(rows,{...current,phase:'failed',error:error.message}):rows,result:null};});
        returnFail('Start a new packing operation. '+error.message);
      }
      throw error;
    }
    try { await storage.updateOrders(new Map(journal.plans.map((plan: Row) => [plan.id,(order: Row) => { if(order.return_packing_operation===id&&invoiceComplete(order))return order; if(order.return_packing_lock?.operation_id&&order.return_packing_lock.operation_id!==id)returnFail('Another packing operation owns this order.'); if (signature(order) !== plan.before) returnFail('Order ' + plan.order_number + ' changed before stock deduction.'); return order.return_packing_lock?.operation_id===id?order:{...order,return_packing_lock:{operation_id:id}}; }]))); }
    catch(error:any){
      if(error.status===409){
        const failed=await storage.changeAdmin(rows=>{const current=currentJournal(rows,id);if(current.phase!=='prepared')return {rows,result:false};return {rows:setJournal(rows,{...current,phase:'failed',error:error.message}),result:true};});
        if(failed)await storage.updateOrders(new Map(journal.plans.map((plan:Row)=>[plan.id,(order:Row)=>{if(order.return_packing_lock?.operation_id!==id)return order;const next={...order};delete next.return_packing_lock;return next; }])));
        if(failed)await storage.changeWaybills(rows=>({rows:rows.map(row=>{if(row.return_packing_operation!==id)return row;const next={...row,status:'Available'};for(const field of ['assigned_order_id','assigned_order_number','assigned_at','return_packing_operation'])delete next[field];return next;}),result:null}));
        if(failed)returnFail('Start a new packing operation. '+error.message);
      }else throw error;
    }
    journal = await storage.changeAdmin(rows => {
      const current = currentJournal(rows,id); if (current.phase !== 'prepared') return { rows,result: current };
      const next = { ...current,phase: 'stock_saved' };
      return { rows: setJournal(saveReturnCatalog(rows,current.products_after),next),result: next };
    });
  }
  if (journal.phase === 'stock_saved') {
    await storage.updateOrders(new Map(journal.plans.map((plan: Row) => [plan.id,(order: Row) => {
      if (order.return_packing_operation === id && invoiceComplete(order)) return order;
      if (signature(order) !== plan.before) returnFail('Order ' + plan.order_number + ' changed. Retry the saved packing operation after review.');
      const updated: Row = { ...order,return_packing_lock:undefined,stock_allocated: true,stock_status: 'Allocated',
        ...(plan.new_allocation ? { stock_allocated_at: journal.created_at,stock_allocated_by: journal.actor } : {}),
        waybill_number: plan.waybill,courier_name: plan.courier_name,shipment_mode: 'manual',fardar_city: order.fardar_city || order.city,city_verified: true,
        delivery_status: 'Ready to Ship',tracking_status: 'Ready for Packing',invoice_pack_batch_id: journal.batch_id,return_packing_operation: id,
        fardar_csv_exported_at:journal.created_at,fardar_csv_exported_by:journal.actor,fardar_csv_export_batch_id:journal.batch_id,fardar_csv_exported_waybill:plan.waybill,
        waybill_protection_locked:true,waybill_protection_reason:'Return packing batch: invoices and Fardar CSV created together.' };
      const result = applyInvoiceQueue([updated],[String(updated.id)],journal.batch_id,journal.settings,journal.actor);
      if (!result.updatedOrders.length) returnFail('Invoice validation failed for ' + plan.order_number + '.'); return result.updatedOrders[0];
    }])));
    journal = await storage.changeAdmin(rows => {
      const current = currentJournal(rows,id); if (current.phase === 'complete') return { rows,result: current };
      const next = { ...current,phase: 'complete',completed_at: new Date().toISOString() }; delete next.products_after;
      let saved = setReturnPackingPending(setJournal(rows,next),!!(current.skipped.waybills||current.skipped.details||current.skipped.limit)); saved = saveReturnCatalog(saved,returnCatalog(saved).payload.products);
      return { rows: saved,result: next };
    });
  }
  return returnPackingHandler(new Request(new URL('/api/returns/packing/' + id,request.url)),storage,user);
};
