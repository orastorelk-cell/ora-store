import { readDataTable, mutateDataTable } from './cloudflareData';
import { canonicalJson } from '../src/lib/confirmCsvSave';
import { returnPackingInProgress, VARIANT_CORRECTION_PREFIX } from '../src/lib/returnSheets';
import { cancellationInProgress } from './r2OrderCancellation';

type Row = Record<string, any>;
const KEY = 'storefront-state-v1';
const fail = (message: string, status = 409): never => { const error: any = new Error(message); error.status = status; throw error; };
const identity = (order: Row) => canonicalJson(Object.fromEntries([
  'items','invoice_confirm_snapshot','total_amount','subtotal','waybill_number','invoice_number',
  'invoice_generated_at','invoice_pack_batch_id','stock_allocated','order_status','dispatch_status','fardar_csv_exported_at',
].map(key => [key, order[key] ?? null])));
export const variantCorrectionIdentity = identity;
const orderAt = (rows: readonly Row[], id: string) => {
  const matches = rows.filter(row => String(row.order_id) === id);
  if (matches.length !== 1) fail('Order not uniquely found.', 404);
  return matches[0];
};
const eligible = (order: Row) => {
  if (!order.invoice_locked || !order.stock_allocated || !order.waybill_number || !order.invoice_number) fail('An existing invoice and allocated stock are required.');
  if (!['Processing','Packed','Confirmed'].includes(order.order_status) || order.dispatch_status === 'Handed Over' || order.cod_payment_received ||
    order.return_status || order.return_sheet_id || order.return_tracking_waybill || order.cancel_stock_restore || order.return_packing_lock ||
    order.fardar_csv_exported_at || order.fardar_csv_exported_waybill) fail('This parcel has courier/export, payment, cancellation or return history. Its colors cannot be changed here.');
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 30 ||
    order.items.some((item: Row) => item.product_type === 'bundle' || !item.variant_id || !Number.isSafeInteger(item.quantity) || item.quantity < 1))
    fail('This correction supports exact variant items with unchanged quantities.');
};
const owner = (orders: readonly Row[], locks: readonly Row[], order: Row) => {
  const wb = String(order.waybill_number);
  if (orders.some(row => String(row.order_id) !== String(order.id) && String(row.payload?.waybill_number || '') === wb)) fail('The waybill belongs to more than one order.');
  const matches = locks.filter(row => String(row.waybill_number) === wb);
  if (matches.length !== 1 || matches[0].status !== 'Assigned' || matches[0].permanently_retired ||
    matches[0].assigned_order_number !== order.order_number || (matches[0].assigned_order_id && matches[0].assigned_order_id !== order.id))
    fail('The waybill must still be assigned exclusively to this order.');
};
const exactVariant = (products: Row[], item: Row, variantId: string) => {
  const matches = products.filter(product => product.id === item.product_id);
  if (matches.length !== 1 || matches[0].product_type === 'bundle') fail('The exact variant product is unavailable.');
  const variants = (matches[0].variants || []).filter((variant: Row) => variant.id === variantId);
  if (variants.length !== 1 || !variants[0].sku) fail('The exact color is unavailable.');
  return { product: matches[0], variant: variants[0] };
};
const plan = (order: Row, products: Row[], variantIds: string[]) => {
  if (variantIds.length !== order.items.length) fail('Select one color for every existing item row.', 400);
  const deltas = new Map<string, Row>();
  const add = (item: Row, delta: number) => {
    const key = item.product_id + '::' + item.variant_id, old = deltas.get(key);
    if (old) old.delta += delta; else deltas.set(key, { product_id: item.product_id, variant_id: item.variant_id, delta });
  };
  const items = order.items.map((item: Row, index: number) => {
    const previous = exactVariant(products, item, item.variant_id), next = exactVariant(products, item, variantIds[index]);
    // Keep historical money; differently priced colors need a priced-order correction.
    if (item.variant_id !== variantIds[index] && ['selling_price','buying_price'].some(key =>
      Number(previous.variant[key] ?? previous.product[key] ?? 0) !== Number(next.variant[key] ?? next.product[key] ?? 0)))
      fail('Selected colors have different prices or buying costs. Nothing was changed.');
    const updated = { ...item, variant_id: next.variant.id, variant_name: next.variant.option_value, sku: next.variant.sku };
    add(item, item.quantity); add(updated, -item.quantity); return updated;
  });
  const changes = [...deltas.values()].filter(change => change.delta);
  for (const change of changes) {
    const { variant } = exactVariant(products, change, change.variant_id), before = Number(variant.stock_quantity ?? 0), after = before + change.delta;
    if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(after) || after < 0) fail('Insufficient exact-color stock: ' + variant.sku + '. Nothing was changed.');
  }
  if (!changes.length) fail('The selected colors do not change the allocated quantities.');
  let snapshot = order.invoice_confirm_snapshot;
  if (snapshot) {
    const active = (snapshot.items || []).filter((row: Row) => !['cancel','cancelled','canceled','cancel item'].includes(String(row.item_action || '').trim().toLowerCase()));
    if (active.length !== items.length) fail('The saved invoice item rows require review before correction.');
    snapshot = { ...snapshot, items: active.map((row: Row, index: number) => ({ ...row, item_code: items[index].sku, variant: items[index].variant_name })) };
  }
  return { items, changes, snapshot };
};

export const correctInvoicedVariants = async (env: unknown, input: Row, actor: string) => {
  const { order_id: id, operation_id: operationId } = input, key = VARIANT_CORRECTION_PREFIX + operationId;
  const before = await readDataTable(env, 'order_snapshots'), initial = orderAt(before, id).payload;
  const locks = await readDataTable(env, 'courier_waybills'), requestIdentity = canonicalJson(input);
  let journal = await mutateDataTable(env, 'admin_data_store', rows => {
    const saved = rows.find(row => row.key === key);
    if (saved) { if (saved.payload.request_identity !== requestIdentity) fail('The saved correction request changed.'); if (saved.payload.phase === 'failed') fail('This correction was not applied. Reload the order before making a new correction.'); return saved.payload; }
    if (returnPackingInProgress(rows) || cancellationInProgress(rows)) fail('A stock transaction is finishing. Retry its saved operation first.');
    eligible(initial); owner(before, locks, initial);
    if (identity(initial) !== input.expected_identity || initial.waybill_number !== input.waybill_number) fail('The order changed. Reload its current colors first.');
    const products = rows.find(row => row.key === KEY)?.payload?.products;
    if (!Array.isArray(products)) fail('The stock catalog is unavailable.');
    const prepared = plan(initial, products, input.variant_ids), at = new Date().toISOString();
    const payload = { phase: 'pending', operation_id: operationId, order_id: id, order_number: initial.order_number, waybill_number: initial.waybill_number,
      batch_id: 'PACK-CORRECTION-' + operationId, previous_batch_id: initial.invoice_pack_batch_id,
      request_identity: requestIdentity, expected_identity: input.expected_identity, variant_ids: input.variant_ids, actor, reason: input.reason, created_at: at,
      items: prepared.items, snapshot: prepared.snapshot, changes: prepared.changes };
    rows.push({ key, payload, updated_at: at }); return payload;
  });
  if (journal.phase === 'complete') return { order: orderAt(await readDataTable(env, 'order_snapshots'), id).payload, stock_history: journal.stock_history, already_saved: true };
  try {
    await mutateDataTable(env, 'order_snapshots', rows => {
      const row = orderAt(rows, id), order = row.payload;
      if (order.variant_correction?.operation_id === operationId || order.variant_correction_lock === operationId) return;
      eligible(order); owner(rows, locks, order);
      if (identity(order) !== journal.expected_identity) fail('The order changed before the correction started.');
      row.payload = { ...order, variant_correction_lock: operationId }; row.updated_at = new Date().toISOString();
    });
    journal = await mutateDataTable(env, 'admin_data_store', rows => {
      const entry = rows.find(row => row.key === key)!;
      if (entry.payload.stock_applied) return entry.payload;
      const catalog = rows.find(row => row.key === KEY), products = catalog?.payload?.products;
      if (!Array.isArray(products)) fail('The stock catalog is unavailable.');
      // Recheck the current catalog after claiming the order, before any mutation.
      const checked = plan(initial, products, journal.variant_ids);
      if (canonicalJson(checked.items) !== canonicalJson(journal.items)) fail('The color catalog changed. Reload before correcting.');
      const targets = journal.changes.map((change: Row) => ({ ...change, ...exactVariant(products, change, change.variant_id) })), at = new Date().toISOString();
      const stock_history = targets.map((target: Row, index: number) => {
        const before = Number(target.variant.stock_quantity), after = before + target.delta;
        target.variant.stock_quantity = after; target.variant.status = after > 0 ? 'Active' : 'Out of Stock';
        target.product.stock_quantity = target.product.variants.reduce((sum: number, variant: Row) => sum + Number(variant.stock_quantity || 0), 0);
        target.product.status = target.product.stock_quantity > 0 ? 'Active' : 'Out of Stock';
        return { id: key + ':' + index, product_id: target.product_id, variant_id: target.variant_id, sku: target.variant.sku,
          product_name: target.product.name_en + ' - ' + target.variant.option_value, change_type: 'Adjustment', quantity: Math.abs(target.delta),
          previous_stock: before, new_stock: after, reason: 'Invoice color correction: ' + journal.order_number + ' / ' + journal.waybill_number + ' • ' + journal.reason,
          performed_by: journal.actor, created_at: at };
      });
      catalog!.payload.version = Number(catalog!.payload.version || 1) + 1; catalog!.payload.updated_at = at; catalog!.updated_at = at;
      entry.payload = { ...entry.payload, phase: 'stock_saved', stock_applied: true, stock_history }; entry.updated_at = at; return entry.payload;
    });
    const order = await mutateDataTable(env, 'order_snapshots', rows => {
      const row = orderAt(rows, id), existing = row.payload;
      if (existing.variant_correction?.operation_id === operationId) return existing;
      if (existing.variant_correction_lock !== operationId || identity(existing) !== journal.expected_identity) fail('The correction lock changed. Retry this saved correction.');
      const shape = (items: Row[]) => items.map(item => ({ sku: item.sku, quantity: item.quantity }));
      const updated: Row = { ...existing, items: journal.items, ...(journal.snapshot ? { invoice_confirm_snapshot: journal.snapshot } : {}),
        invoice_pack_batch_id: journal.batch_id, invoice_generated_at: journal.created_at, invoice_generated_by: journal.actor,
        product_change_history: [...(existing.product_change_history || []), { changed_at: journal.created_at, changed_by: journal.actor,
          old_items: shape(existing.items), new_items: shape(journal.items), reason: journal.reason }],
        variant_correction: { operation_id: operationId, corrected_at: new Date().toISOString(), actor: journal.actor, reason: journal.reason, stock_history: journal.stock_history,
          previous_batch_id: journal.previous_batch_id, previous_invoice_generated_at: existing.invoice_generated_at, batch_id: journal.batch_id },
        notes: [existing.notes, 'Invoice colors corrected: ' + journal.reason].filter(Boolean).join(' | ') };
      // The corrected parcel gets its own batch and keeps the same invoice number/waybill.
      for (const field of ['variant_correction_lock','invoice_pack_downloaded_at','invoice_pack_downloaded_by','invoice_pack_download_set_date','invoice_pack_download_set_number']) delete updated[field];
      row.payload = updated; row.updated_at = new Date().toISOString(); return updated;
    });
    await mutateDataTable(env, 'admin_data_store', rows => { const entry = rows.find(row => row.key === key)!; if (entry.payload.phase !== 'complete') { entry.payload.phase = 'complete'; entry.updated_at = new Date().toISOString(); } });
    return { order, stock_history: journal.stock_history, already_saved: false };
  } catch (error: any) {
    // Validation before stock is saved releases the unused lock. Network failures retain it for replay.
    if (error.status === 409 && !(await readDataTable(env, 'admin_data_store')).find(row => row.key === key)?.payload?.stock_applied) {
      await mutateDataTable(env, 'order_snapshots', rows => { const row = orderAt(rows, id); if (row.payload.variant_correction_lock === operationId) { delete row.payload.variant_correction_lock; row.updated_at = new Date().toISOString(); } });
      await mutateDataTable(env, 'admin_data_store', rows => { const entry = rows.find(row => row.key === key); if (entry) { entry.payload.phase = 'failed'; entry.updated_at = new Date().toISOString(); } });
    }
    throw error;
  }
};

export const r2VariantCorrectionHandler = async (request: Request, env: unknown, user: Row) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if (user.role !== 'admin') return json({ error: 'Super Admin access is required.' }, 403);
  try {
    if (request.method === 'GET') {
      const id = new URL(request.url).searchParams.get('order_id') || '', order = orderAt(await readDataTable(env, 'order_snapshots'), id).payload;
      eligible(order);
      const products = (await readDataTable(env, 'admin_data_store')).find(row => row.key === KEY)?.payload?.products || [];
      return json({ ok: true, order, expected_identity: identity(order), options: order.items.map((item: Row) => {
        const { product } = exactVariant(products, item, item.variant_id);
        return product.variants.map((variant: Row) => ({ id: variant.id, name: variant.option_value, sku: variant.sku, stock: variant.stock_quantity }));
      }) });
    }
    const input: any = await request.json().catch(() => null);
    if (!input || typeof input.order_id !== 'string' || input.order_id.length > 150 || !/^[A-Za-z0-9_-]{16,100}$/.test(input.operation_id || '') ||
      typeof input.expected_identity !== 'string' || input.expected_identity.length > 200000 || typeof input.waybill_number !== 'string' || input.waybill_number.length > 100 ||
      !Array.isArray(input.variant_ids) || input.variant_ids.length > 30 || input.variant_ids.some((id: any) => typeof id !== 'string' || !id || id.length > 150) ||
      typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) return json({ error: 'The current order, exact colors and correction reason are required.' }, 400);
    return json({ ok: true, ...await correctInvoicedVariants(env, input, String(user.display_name || user.username || 'Super Admin')) });
  } catch (error: any) { return json({ error: error.message || 'Correction did not finish. Retry the saved correction.', retry_safe: true }, Number(error.status || 503)); }
};
