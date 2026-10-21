import type { ReturnStorage } from './r2ReturnSheets';
import { canonicalJson } from '../src/lib/confirmCsvSave';
import { normalizedProductType } from '../src/lib/productVariants';
import { activeOrderPackingLock } from '../src/lib/orderStockQuantities';
import { physicalReturnItems, returnPackingInProgress } from '../src/lib/returnSheets';
import { cancellationInProgress } from './r2OrderCancellation';
import { ORDER_ITEM_EDIT_PREFIX, OrderItemEditError, itemEditFail as fail, editedOrderValues, itemEditDraft, itemEditIdentity, parseItemEditInput } from '../src/lib/orderItemEdit';

type Row = Record<string, any>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const catalogAt = (rows: readonly Row[]) => {
  const catalog = rows.find(row => row.key === 'storefront-state-v1');
  if (!Array.isArray(catalog?.payload?.products)) fail('The current stock catalog is unavailable.', 503);
  return catalog!;
};
const orderAt = (orders: readonly Row[], id: string) => {
  const matches = orders.filter(order => String(order.id) === id);
  if (matches.length !== 1) fail('Order not uniquely found.', 404);
  return matches[0];
};
const eligible = (order: Row, admin: readonly Row[], operation?: string) => {
  if (order.item_edit_lock && order.item_edit_lock !== operation || order.variant_correction_lock || order.stock_quantity_correction_lock ||
      activeOrderPackingLock(order, admin) || order.sheet_confirm_hold) fail('Finish the saved stock / upload operation before changing items.');
  if (['Cancelled','Shipped','Delivered'].includes(order.order_status) || order.dispatch_status === 'Handed Over' || order.cod_payment_received ||
      order.cancel_stock_restore || order.return_received_at || order.return_sheet_id || order.return_tracking_waybill || order.return_status && order.return_status !== 'None')
    fail('This parcel has dispatch, cancellation, payment settlement or return history. Use the return workflow for its items.');
  if (order.is_duplicate_order) fail('Approve this duplicate order before changing its items.');
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 100) fail('The original items require review.');
  if ((order.invoice_locked || order.invoice_number) && (!order.stock_allocated || !order.waybill_number)) fail('The existing invoice stock / waybill needs review first.');
};
const owner = (orders: readonly Row[], locks: readonly Row[], order: Row) => {
  const wb = String(order.waybill_number || '').trim();
  if (!wb) return;
  if (orders.some(other => String(other.id) !== String(order.id) && String(other.waybill_number || '').trim() === wb)) fail('This waybill belongs to multiple orders.');
  const matches = locks.filter(lock => String(lock.waybill_number) === wb);
  if (matches.length !== 1 || matches[0].status !== 'Assigned' || matches[0].permanently_retired ||
      matches[0].assigned_order_number !== order.order_number || matches[0].assigned_order_id && matches[0].assigned_order_id !== order.id)
    fail('The waybill must still be assigned to this order before its items can change.');
};
const planStock = (order: Row, items: Row[], products: Row[]): Row[] => {
  if (order.stock_allocated !== true) return [];
  const changes = new Map<string, Row>();
  const add = (item: Row, sign: number) => {
    const key = item.product_id + '::' + (item.variant_id || ''), current = changes.get(key);
    if (current) current.delta += sign * item.expected_qty;
    else changes.set(key, {product_id: item.product_id, variant_id: item.variant_id, delta: sign * item.expected_qty});
  };
  physicalReturnItems(order).forEach(item => add(item, 1));
  // New invoice items describe the complete desired parcel, independently of
  // an older correction of the quantity actually consumed.
  physicalReturnItems({items}).forEach(item => add(item, -1));
  return [...changes.values()].filter(change => change.delta).map((change): Row => {
    const matches = products.filter(product => product.id === change.product_id);
    if (matches.length !== 1 || normalizedProductType(matches[0] as any) === 'bundle') fail('An exact physical stock item is missing.');
    const product = matches[0], type = normalizedProductType(product as any);
    const targets = type === 'variant' ? (product.variants || []).filter((variant: Row) => variant.id === change.variant_id) : [product];
    if (targets.length !== 1 || type !== 'variant' && change.variant_id) fail('An exact colour is missing from stock.');
    const target = targets[0], before = Number(target.stock_quantity ?? 0), after = before + change.delta;
    if (target.return_stock_debt || !Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(after) || after < 0 || after > 1_000_000)
      fail('Insufficient available stock for ' + String(target.sku || product.sku) + '. Check the colour / quantity.');
    return {...change, before, after, sku: String(target.sku || product.sku), label: String(product.name_en) + (change.variant_id ? ' - ' + String(target.option_value) : '')};
  });
};

export const orderItemEditHandler = async (request: Request, storage: ReturnStorage, user: Row): Promise<Response> => {
  if (user.role !== 'admin') return json({error: 'Super Admin access is required.'}, 403);
  let key = '', input: ReturnType<typeof parseItemEditInput> | undefined;
  try {
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams, search = String(query.get('search') || '').trim(), id = String(query.get('order_id') || '');
      if ((!search && !id) || Math.max(search.length, id.length) > 150) return json({error: 'Enter an Order ID or waybill.'}, 400);
      const [orders, admin, locks] = await Promise.all([storage.readOrders(), storage.readAdmin(), storage.readWaybills?.() || Promise.resolve([])]);
      const matches = orders.filter(order => id ? String(order.id) === id : [order.id, order.order_number, order.waybill_number].some(value => String(value || '').toUpperCase() === search.toUpperCase()));
      if (matches.length !== 1) fail(matches.length ? 'Multiple orders match. Search the exact Order ID.' : 'Order not found.', matches.length ? 409 : 404);
      const order = matches[0], catalog = catalogAt(admin);
      let edit_error = '';
      try { eligible(order, admin); owner(orders, locks, order); if (returnPackingInProgress(admin) || cancellationInProgress([...admin])) fail('A stock batch is finishing. Retry after it finishes.'); }
      catch (error: any) { edit_error = error.message; }
      return json({ok: true, order, expected_identity: itemEditIdentity(order), draft: itemEditDraft(order), can_edit: !edit_error, edit_error,
        products: catalog.payload.products, settings: catalog.payload.settings || {}, stock_history: order.item_edit?.stock_history || []});
    }
    if (request.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
    const raw = await request.text();
    if (raw.length > 400_000) return json({error: 'The item edit is too large.'}, 413);
    let parsed: any; try {parsed = JSON.parse(raw);} catch {return json({error: 'Invalid item edit request.'}, 400);}
    input = parseItemEditInput(parsed); key = ORDER_ITEM_EDIT_PREFIX + input.operation_id;
    const operation = input.operation_id, request_identity = canonicalJson(input), actor = String(user.display_name || user.name || user.username || user.id);
    const [orders, adminBefore, locks] = await Promise.all([storage.readOrders(), storage.readAdmin(), storage.readWaybills?.() || Promise.resolve([])]);
    const initial = orderAt(orders, input.order_id);
    let journal: Row = await storage.changeAdmin(rows => {
      const saved = rows.find(row => row.key === key);
      if (saved) {
        if (saved.payload.request_identity !== request_identity || saved.payload.actor_id !== String(user.id)) fail('This saved operation belongs to different item details.');
        if (saved.payload.phase === 'failed') fail('This edit was not applied. Search the order again before a new edit.');
        return {rows, result: saved.payload};
      }
      if (returnPackingInProgress(rows) || cancellationInProgress([...rows])) fail('A stock transaction is finishing. Retry this saved edit shortly.');
      eligible(initial, rows); owner(orders, locks, initial);
      if (itemEditIdentity(initial) !== input!.expected_identity) fail('This order changed. Search it again before editing.');
      const catalog = catalogAt(rows), at = new Date().toISOString();
      const values = editedOrderValues(initial, catalog.payload.products, catalog.payload.settings || {}, input!, at);
      planStock(initial, values.items, catalog.payload.products);
      const payload = {phase: 'pending', operation_id: operation, order_id: initial.id, request_identity, expected_identity: input!.expected_identity,
        actor, actor_id: String(user.id), reason: input!.reason, created_at: at, initial, values,
        batch_id: initial.invoice_locked || initial.invoice_number ? 'PACK-EDIT-' + operation : undefined};
      return {rows: [...rows, {key, payload, updated_at: at}], result: payload};
    });
    if (journal.phase === 'complete') return json({ok: true, operation_id: operation, order: initial, stock_history: journal.stock_history, already_saved: true});

    await storage.updateOrders(new Map([[input.order_id, order => {
      if (order.item_edit?.operation_id === operation || order.item_edit_lock === operation) return order;
      eligible(order, adminBefore); owner(orders, locks, order);
      if (itemEditIdentity(order) !== journal.expected_identity) fail('The order changed before the item edit started. Search it again.');
      return {...order, item_edit_lock: operation};
    }]]));
    journal = await storage.changeAdmin(rows => {
      const entry = rows.find(row => row.key === key)!;
      if (entry.payload.stock_applied) return {rows, result: entry.payload};
      const catalog = catalogAt(rows), checked = editedOrderValues(journal.initial, catalog.payload.products, catalog.payload.settings || {}, input!, journal.created_at);
      if (canonicalJson(checked) !== canonicalJson(journal.values)) fail('The selected product prices / costs changed. Search the order again.');
      const changes = planStock(journal.initial, journal.values.items, catalog.payload.products), changed = new Map<string, Row>();
      const history = changes.map((change, index) => {
        const product = changed.get(change.product_id) || catalog.payload.products.find((value: Row) => value.id === change.product_id);
        const update = {stock_quantity: change.after, status: change.after > 0 ? 'Active' : 'Out of Stock'};
        if (change.variant_id) {
          const variants = product.variants.map((variant: Row) => variant.id === change.variant_id ? {...variant, ...update} : variant);
          const total = variants.reduce((sum: number, variant: Row) => sum + Number(variant.stock_quantity || 0), 0);
          changed.set(product.id, {...product, variants, stock_quantity: total, status: total > 0 ? 'Active' : 'Out of Stock'});
        } else changed.set(product.id, {...product, ...update});
        // Allocation is now represented by the corrected order itself. An
        // Adjustment audit must not also count as independent inflow/outflow.
        return {id: key + ':' + index, product_id: change.product_id, ...(change.variant_id ? {variant_id: change.variant_id} : {}), sku: change.sku,
          product_name: change.label, change_type: 'Adjustment', quantity: Math.abs(change.delta), previous_stock: change.before, new_stock: change.after,
          reason: 'Order item edit ' + journal.initial.order_number + ' • ' + journal.reason, performed_by: journal.actor, created_at: journal.created_at};
      });
      const payload = {...entry.payload, phase: 'stock_saved', stock_applied: true, stock_history: history};
      const nextCatalog = changed.size ? {...catalog, payload: {...catalog.payload, products: catalog.payload.products.map((product: Row) => changed.get(product.id) || product),
        version: Number(catalog.payload.version || 0) + 1, updated_at: journal.created_at}, updated_at: journal.created_at} : catalog;
      return {rows: rows.map(row => row === entry ? {...row, payload, updated_at: journal.created_at} : row === catalog ? nextCatalog : row), result: payload};
    });
    let saved: Row | undefined;
    await storage.updateOrders(new Map([[input.order_id, order => {
      if (order.item_edit?.operation_id === operation) {saved = order; return order;}
      if (order.item_edit_lock !== operation || itemEditIdentity(order) !== journal.expected_identity) fail('The item edit needs recovery. Retry this same saved edit.');
      const next: Row = {...order, ...journal.values, item_edit: {operation_id: operation, corrected_at: journal.created_at, corrected_by: journal.actor,
        reason: journal.reason, stock_history: journal.stock_history, previous_batch_id: order.invoice_pack_batch_id, previous_total: order.total_amount},
        product_change_history: [...(order.product_change_history || []), {changed_at: journal.created_at, changed_by: journal.actor, reason: journal.reason,
          old_items: order.items, new_items: journal.values.items}], updated_at: journal.created_at};
      for (const field of ['item_edit_lock','stock_quantity_correction','return_packing_lock']) delete next[field];
      if (journal.batch_id) {
        Object.assign(next, {invoice_pack_batch_id: journal.batch_id, invoice_generated_at: journal.created_at, invoice_generated_by: journal.actor});
        for (const field of ['invoice_pack_downloaded_at','invoice_pack_downloaded_by','invoice_pack_download_set_date','invoice_pack_download_set_number',
          'fardar_csv_exported_at','fardar_csv_exported_by','fardar_csv_export_batch_id','fardar_csv_exported_waybill']) delete next[field];
      }
      if (order.payment_method === 'Bank Payment') {
        const received = Number(order.payment_received_amount || order.payment_detected_amount || (order.payment_status === 'Paid' ? order.total_amount : order.advance_confirmed ? order.advance_amount : 0));
        if (received > 0) {
          next.payment_received_amount = received; next.payment_status = received >= next.total_amount ? 'Paid' : 'Pending';
          next.payment_paid_type = received >= next.total_amount ? 'Full' : 'Advance';
          if (journal.batch_id) next.invoice_payment_label_snapshot = received >= next.total_amount ? 'FULLY PAID' : 'ADVANCE PAID';
        }
      }
      saved = next; return next;
    }]]));
    await storage.changeAdmin(rows => {
      const entry = rows.find(row => row.key === key)!;
      return entry.payload.phase === 'complete' ? {rows, result: null} : {rows: rows.map(row => row === entry ? {...row, payload: {...row.payload, phase: 'complete'}, updated_at: new Date().toISOString()} : row), result: null};
    });
    return json({ok: true, operation_id: operation, order: saved, stock_history: journal.stock_history, already_saved: false});
  } catch (error: any) {
    // Release only a proven validation failure before stock changed. Unknown
    // network outcomes retain the same durable operation and its allocation hold.
    let retry_required = true;
    if (error instanceof OrderItemEditError && key && input) {
      const entry = (await storage.readAdmin()).find(row => row.key === key);
      if (entry && (entry.payload.request_identity !== canonicalJson(input) || entry.payload.actor_id !== String(user.id))) {
        retry_required = false;
      } else if (!entry || !entry.payload.stock_applied) {
        if (entry?.payload.phase !== 'complete') {
          await storage.updateOrders(new Map([[input.order_id, order => {
            if (order.item_edit_lock !== input!.operation_id) return order;
            const next = {...order}; delete next.item_edit_lock; return next;
          }]]));
          await storage.changeAdmin(rows => ({rows: rows.map(row => row.key === key && !row.payload.stock_applied ? {...row, payload: {...row.payload, phase: 'failed'}} : row), result: null}));
        }
        retry_required = false;
      }
    } else if (error instanceof OrderItemEditError) retry_required = false;
    return json({error: error.message || 'The edit was not confirmed. Retry the saved edit.', retry_required}, error instanceof OrderItemEditError ? error.status : 503);
  }
};
