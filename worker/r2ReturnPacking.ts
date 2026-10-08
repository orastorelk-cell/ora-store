import type { ReturnStorage } from './r2ReturnSheets';
import { returnActor, returnCatalog, returnJson, saveReturnCatalog, setReturnPackingPending, upsertReturnRow } from './r2ReturnSheets';
import { RETURN_PACKING_PREFIX, RETURN_CONTROL_KEY, returnContainersFromRows, returnFail, returnPackingInProgress, inventoryReturnTarget, physicalReturnItems } from '../src/lib/returnSheets';
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
const recoveryReady=(order:Row)=>order.call_center_status==='Confirmed'&&!invoiceComplete(order)&&
  !['Cancelled','Shipped','Delivered'].includes(order.order_status)&&!order.is_duplicate_order&&!order.is_test_order&&
  !order.return_tracking_waybill&&!order.return_sheet_id&&order.dispatch_status!=='Handed Over'&&
  !order.invoice_pack_downloaded_at&&!order.fardar_csv_exported_at;
const recoverySignature=(order:Row)=>{const {return_packing_lock,...current}=order;return JSON.stringify(current);};

// The catalog and stock deduction share one ETag transaction with this journal.
// Courier reservation and order writes resume from its recorded plan after any
// lost acknowledgement; no retry deducts stock or creates another invoice.
export const returnPackingHandler = async (request: Request, storage: ReturnStorage, user: Row, recovery=false) => {
  const basePath=recovery?'/api/orders/invoices/recovery':'/api/returns/packing';
  const checkJournal=(journal:Row|undefined)=>{if(journal&&!!(journal.kind==='confirm_recovery')!==recovery)returnFail('This batch belongs to a different packing workflow.');return journal;};
  const beforeSignature=recovery?recoverySignature:signature;
  const reason=recovery?'Confirm Upload Double Check':'Return packing batch';
  const failPrepared=(rows:readonly Row[],current:Row,error:string)=>{
    const failed:Row={...current,phase:'failed',error};if(recovery)delete failed.products_after;
    const saved=setJournal(rows,failed);
    return recovery?setReturnPackingPending(saved,!!current.previous_packing_pending):saved;
  };
  const path = new URL(request.url).pathname;
  if(recovery&&request.method==='GET'&&path===basePath){
    const batches=(await storage.readAdmin()).filter(row=>String(row.key).startsWith(RETURN_PACKING_PREFIX)&&row.payload?.kind==='confirm_recovery'&&row.payload.phase==='complete'&&row.payload.order_ids.length)
      .map(row=>({operation_id:row.payload.operation_id,batch_id:row.payload.batch_id,created_at:row.payload.created_at,count:row.payload.order_ids.length}))
      .sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,30);
    return returnJson({ok:true,batches});
  }
  const download = path.endsWith('/downloaded');
  const input:any=request.method==='POST'?await request.json().catch(()=>({})):{};
  const id = download ? path.split('/').at(-2)! : request.method === 'GET' ? path.split('/').at(-1)! : String(input.operation_id || '');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(id)) return returnJson({ error: 'A packing operation ID is required.' },400);
  if (download && request.method === 'POST') {
    const journal=checkJournal(currentJournal(await storage.readAdmin(),id));
    if(!journal||journal.phase!=='complete')returnFail('Finish the saved packing batch before downloading.');
    const now=journal.downloaded_at||new Date().toISOString(), actor=journal.downloaded_by||returnActor(user);
    await storage.updateOrders(new Map(journal.plans.map((plan:Row)=>[plan.id,(order:Row)=>{
      if(order.return_packing_operation!==id||order.invoice_pack_batch_id!==journal.batch_id||String(order.waybill_number)!==plan.waybill)returnFail('Saved packing order changed before export.');
      if(order.invoice_pack_downloaded_at&&order.fardar_csv_exported_waybill===plan.waybill&&order.fardar_csv_export_batch_id===journal.batch_id)return order;
      return {...order,invoice_pack_downloaded_at:order.invoice_pack_downloaded_at||now,invoice_pack_downloaded_by:order.invoice_pack_downloaded_by||actor,
        fardar_csv_exported_at:order.fardar_csv_exported_at||now,fardar_csv_exported_by:order.fardar_csv_exported_by||actor,fardar_csv_export_batch_id:journal.batch_id,
        fardar_csv_exported_waybill:plan.waybill,waybill_protection_locked:true,waybill_protection_reason:reason+' PDF and Fardar CSV exported together.'};
    }])));
    await storage.changeAdmin(rows=>({rows:setJournal(rows,{...currentJournal(rows,id),downloaded_at:now,downloaded_by:actor}),result:null}));
    return returnJson({ok:true,batch_id:journal.batch_id});
  }
  if (request.method === 'GET') {
    const journal = checkJournal(currentJournal(await storage.readAdmin(),id)); if (!journal) return returnJson({ error: 'Packing batch not found.' },404);
    if (journal.phase !== 'complete') return returnJson(recovery?{ok:true,pending:true,phase:journal.phase,operation_id:id}:{ error: 'Retry this packing operation to finish the saved batch.',operation_id: id },recovery?200:409);
    const orders = await storage.readOrders();
    const packed=journal.order_ids.map((value:string)=>orders.find(order=>String(order.id)===value)).filter(Boolean);
    if(recovery&&(packed.length!==journal.plans.length||packed.some((order:Row)=>!invoiceComplete(order)||order.return_packing_operation!==id||order.invoice_pack_batch_id!==journal.batch_id||!journal.plans.some((plan:Row)=>plan.id===String(order.id)&&plan.waybill===String(order.waybill_number)))))returnFail('Saved recovery invoices changed. Review the batch before export.');
    return returnJson({ ok: true,batch_id: journal.batch_id,operation_id: id,orders:packed,settings: journal.settings,skipped: journal.skipped,created_at: journal.created_at });
  }
  if (request.method !== 'POST') return returnJson({ error: 'Method not supported.' },405);
  if (!storage.readWaybills || !storage.changeWaybills) returnFail('Shared waybill pool unavailable.',503);
  const existing=recovery?checkJournal(currentJournal(await storage.readAdmin(),id)):undefined;
  if(existing?.phase==='failed')returnFail('Start a new packing operation. '+(existing.error||''));
  const [orders,pool] = existing?[[],[]]:await Promise.all([storage.readOrders(),storage.readWaybills()]);
  let journal = existing || await storage.changeAdmin(rows => {
    const previous = checkJournal(currentJournal(rows,id));
    if (previous) { if (previous.phase === 'failed') returnFail('Start a new packing operation. ' + (previous.error || ''));  return { rows,result: previous }; }
    if (returnPackingInProgress(rows) || cancellationInProgress(rows as Row[])) returnFail('Another stock batch is finishing. Retry after it completes.');
    const unchecked = returnContainersFromRows(rows).flatMap(sheet => sheet.parcels).filter(parcel => parcel.scanned_at && !parcel.checked_at && !parcel.review_reason);
    if (unchecked.length&&!recovery) returnFail('Check ' + unchecked.length + ' opened return parcel(s) before creating this packing batch.');
    const catalog = returnCatalog(rows), products = structuredClone(catalog.payload.products);
    const owners = new Map(orders.filter(order => order.waybill_number).map(order => [String(order.waybill_number).trim(),String(order.id)]));
    const available = pool.filter(row => row.status === 'Available' && !row.permanently_retired && /fardar/i.test(String(row.courier_name || 'Fardar')) && !owners.has(String(row.waybill_number))).sort((a,b) => String(a.imported_at || '').localeCompare(String(b.imported_at || '')));
    const plans: Row[] = [], logs: Row[] = [], skipped = { stock: 0,waybills: 0,details: 0,limit: 0,return_checks:0 }; const now = new Date().toISOString();
    for (const order of orders.filter(recovery?recoveryReady:ready).sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)))) {
      if (plans.length >= (recovery?50:200)) { skipped.limit++; continue; }
      if(recovery&&unchecked.length&&order.stock_allocated!==true){skipped.return_checks++;continue;}
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
          change_type: 'Order Deduction',quantity: item.expected_qty,previous_stock: before,new_stock: after,reason: reason+' / ' + order.order_number,performed_by: returnActor(user),created_at: now });
      }
      plans.push({ id: String(order.id),order_number: order.order_number,before: beforeSignature(order),waybill: wb,courier_name: reservation?.courier_name || order.courier_name || 'Fardar',reserve: !!reservation,new_allocation: order.stock_allocated !== true });
      logs.push(...history);
      const at = available.findIndex(row => String(row.waybill_number) === wb); if (at >= 0) available.splice(at,1);
    }
    const prepared = { operation_id: id,batch_id: (recovery?'PACK-RECOVERY-':'PACK-RETURN-') + id,phase: recovery&&!plans.length?'complete':'prepared',created_at: now,actor: returnActor(user),plans,order_ids: plans.map(plan => plan.id),products_after: products,stock_history: logs,settings: catalog.payload.settings || {},skipped,
      ...(recovery?{kind:'confirm_recovery',previous_packing_pending:!!rows.find(row=>row.key===RETURN_CONTROL_KEY)?.payload?.packing_pending}:{}) };
    if(recovery&&!plans.length){delete (prepared as Row).products_after;return {rows:setJournal(rows,prepared),result:prepared};}
    return { rows: saveReturnCatalog(setReturnPackingPending(setJournal(rows,prepared),true),catalog.payload.products),result: prepared };
  });
  if (journal.phase === 'complete') return returnPackingHandler(new Request(new URL(basePath+'/' + id,request.url)),storage,user,recovery);
  // Recovery requests advance one durable phase at a time to keep each request
  // bounded. Repeating the same ID resumes the saved plan after a timeout.
  if(recovery&&input.advance!==true)return returnJson({ok:true,pending:true,phase:journal.phase,operation_id:id});
  const startedPhase=journal.phase;
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
        await storage.changeAdmin(rows => {const current=currentJournal(rows,id);return {rows:current.phase==='prepared'?failPrepared(rows,current,error.message):rows,result:null};});
        returnFail('Start a new packing operation. '+error.message);
      }
      throw error;
    }
    try { await storage.updateOrders(new Map(journal.plans.map((plan: Row) => [plan.id,(order: Row) => { if(order.return_packing_operation===id&&invoiceComplete(order))return order; if(order.return_packing_lock?.operation_id&&order.return_packing_lock.operation_id!==id)returnFail('Another packing operation owns this order.'); if (beforeSignature(order) !== plan.before) returnFail('Order ' + plan.order_number + ' changed before stock deduction.'); return order.return_packing_lock?.operation_id===id?order:{...order,return_packing_lock:{operation_id:id}}; }]))); }
    catch(error:any){
      if(error.status===409){
        const failed=await storage.changeAdmin(rows=>{const current=currentJournal(rows,id);if(current.phase!=='prepared')return {rows,result:false};return {rows:failPrepared(rows,current,error.message),result:true};});
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
  if(recovery&&journal.phase==='complete')return returnPackingHandler(new Request(new URL(basePath+'/'+id,request.url)),storage,user,recovery);
  if(recovery&&startedPhase==='prepared')return returnJson({ok:true,pending:true,phase:journal.phase,operation_id:id});
  if (journal.phase === 'stock_saved') {
    await storage.updateOrders(new Map(journal.plans.map((plan: Row) => [plan.id,(order: Row) => {
      if (order.return_packing_operation === id && invoiceComplete(order)) return order;
      if (beforeSignature(order) !== plan.before) returnFail('Order ' + plan.order_number + ' changed. Retry the saved packing operation after review.');
      const updated: Row = { ...order,return_packing_lock:undefined,stock_allocated: true,stock_status: 'Allocated',
        ...(plan.new_allocation ? { stock_allocated_at: journal.created_at,stock_allocated_by: journal.actor } : {}),
        waybill_number: plan.waybill,courier_name: plan.courier_name,shipment_mode: 'manual',fardar_city: order.fardar_city || order.city,city_verified: true,
        delivery_status: 'Ready to Ship',tracking_status: 'Ready for Packing',invoice_pack_batch_id: journal.batch_id,return_packing_operation: id,
        fardar_csv_exported_at:journal.created_at,fardar_csv_exported_by:journal.actor,fardar_csv_export_batch_id:journal.batch_id,fardar_csv_exported_waybill:plan.waybill,
        waybill_protection_locked:true,waybill_protection_reason:reason+': invoices and Fardar CSV created together.' };
      const result = applyInvoiceQueue([updated],[String(updated.id)],journal.batch_id,journal.settings,journal.actor);
      const saved=result.updatedOrders[0]||(result.results[0]?.status==='already_saved'?result.results[0].order:undefined);
      if (!saved) returnFail('Invoice validation failed for ' + plan.order_number + '.'); return saved;
    }])));
    journal = await storage.changeAdmin(rows => {
      const current = currentJournal(rows,id); if (current.phase === 'complete') return { rows,result: current };
      const next = { ...current,phase: 'complete',completed_at: new Date().toISOString() }; delete next.products_after;
      let saved = setReturnPackingPending(setJournal(rows,next),recovery?!!current.previous_packing_pending:!!(current.skipped.waybills||current.skipped.details||current.skipped.limit)); saved = saveReturnCatalog(saved,returnCatalog(saved).payload.products);
      return { rows: saved,result: next };
    });
  }
  return returnPackingHandler(new Request(new URL(basePath+'/' + id,request.url)),storage,user,recovery);
};
