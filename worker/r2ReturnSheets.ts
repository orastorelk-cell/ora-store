import { readDataTable, replaceDataTable } from './cloudflareData';
import { cancellationInProgress } from './r2OrderCancellation';
import { buildReturnSheet, parseReturnCsv, RETURN_SHEET_PREFIX, ReturnSheetError, returnFail, receiveReturnParcel,
  sheetsFromRows, summarizeReturnSheet, sharedReturnInventory, pendingReturnQty, type ReturnSheet } from '../src/lib/returnSheets';

type Row = Record<string, any>;
export type ReturnStorage = {
  readAdmin: () => Promise<readonly Row[]>;
  changeAdmin: <T>(change: (rows: readonly Row[]) => { rows: readonly Row[]; result: T }) => Promise<T>;
  readOrders: () => Promise<any[]>;
  updateOrders: (updates: Map<string, (order: any) => any>) => Promise<void>;
};
export const r2ReturnStorage = (env?: unknown): ReturnStorage => ({
  readAdmin: () => readDataTable(env, 'admin_data_store'),
  changeAdmin: change => replaceDataTable(env, 'admin_data_store', change),
  readOrders: async () => (await readDataTable(env, 'order_snapshots')).map(row => row.payload).filter(Boolean),
  updateOrders: async updates => { await replaceDataTable(env, 'order_snapshots', rows => {
    let changed = false;
    const next = rows.map(row => {
      const update = updates.get(String(row.order_id)); if (!update) return row;
      const order = update(row.payload); if (order === row.payload) return row;
      changed = true; return { ...row, payload: order, updated_at: new Date().toISOString() };
    });
    return { rows: changed ? next : rows, result: null };
  }); },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const actorName = (user: Row) => String(user.display_name || user.name || user.username || user.id);
const sameSource = (a: ReturnSheet, b: ReturnSheet) => JSON.stringify([...a.source].sort((x,y) => x.waybill.localeCompare(y.waybill))) === JSON.stringify([...b.source].sort((x,y) => x.waybill.localeCompare(y.waybill)));
const catalogFrom = (rows: readonly Row[]) => {
  const row = rows.find(row => row.key === 'storefront-state-v1');
  if (!row?.payload || !Array.isArray(row.payload.products)) returnFail('Shared stock catalog is unavailable.');
  return row;
};
const saveSheetRow = (rows: readonly Row[], sheet: ReturnSheet) => {
  const key = RETURN_SHEET_PREFIX + sheet.id, previous = rows.find(row => row.key === key);
  const next = { ...previous, key, payload: sheet, updated_at: new Date().toISOString() };
  return previous ? rows.map(row => row === previous ? next : row) : [...rows, next];
};
const sheetAt = (rows: readonly Row[], id: string) => {
  const sheet = rows.find(row => row.key === RETURN_SHEET_PREFIX + id)?.payload as ReturnSheet | undefined;
  if (!sheet) returnFail('Return Sheet ' + id + ' was not found.', 404);
  return sheet;
};
// Order annotations are resumable after the atomic receipt/stock transaction.
// They never move stock and cannot turn an old browser snapshot into a new receipt.
const annotateSheetOrders = async (storage: ReturnStorage, sheet: ReturnSheet) => {
  const updates = new Map<string, (order: any) => any>();
  for (const parcel of sheet.parcels) {
    if (!parcel.order_id || parcel.review_reason) continue;
    updates.set(parcel.order_id, order => {
      if (String(order?.waybill_number || '').trim() !== parcel.waybill) return order;
      const complete = parcel.items.every(item => !pendingReturnQty(item));
      const issue = parcel.items.some(item => item.damaged_qty || pendingReturnQty(item));
      const fields = { return_sheet_id: sheet.id, return_sheet_waybill: parcel.waybill, return_sheet_revision: parcel.revision,
        return_status: !parcel.checked_at ? 'Pending Verification' : complete && !issue ? 'Verified' : 'Issue Found',
        ...(parcel.checked_at ? { return_received_at: parcel.checked_at, return_checked_by: parcel.checked_by,
          delivery_status: complete && !issue ? 'Return Received - Verified' : 'Return Received - Partial / Issue' } : {}) };
      if (Number(order.return_sheet_revision || 0) > parcel.revision && order.return_sheet_id === sheet.id) return order;
      if (Object.entries(fields).every(([key,value]) => order[key] === value)) return order;
      return { ...order, ...fields };
    });
  }
  if (updates.size) await storage.updateOrders(updates);
};

export const returnSheetsHandler = async (request: Request, storage: ReturnStorage, user: Row): Promise<Response> => {
  try {
    if (user.role !== 'admin' && !(user.permissions || []).includes('returns')) return json({ error: 'Returns permission required.' },403);
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const detail = path.match(/^\/api\/returns\/sheets\/(\d+)(?:\/(receive|rematch))?$/);
    if (method !== 'GET' && user.role !== 'admin' && (user.permissions || []).includes('level:returns:view') && !(user.permissions || []).includes('action:return_process'))
      return json({ error: 'Returns edit access or Scan / Process Returns access is required.' },403);
    if (method === 'GET') {
      const rows = await storage.readAdmin();
      if (path === '/api/returns/sheets') {
        const search = (url.searchParams.get('search') || '').trim().toLowerCase().slice(0,100);
        const sheets = sheetsFromRows(rows).filter(sheet => !search || sheet.id.includes(search)).sort((a,b) => b.uploaded_at.localeCompare(a.uploaded_at));
        const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get('offset')) || 0));
        return json({ ok: true, total: sheets.length, sheets: sheets.slice(offset, offset+100).map(summarizeReturnSheet), can_import: user.role === 'admin' });
      }
      if (detail && !detail[2]) { const sheet = sheetAt(rows, detail[1]); return json({ ok: true, sheet, summary: summarizeReturnSheet(sheet) }); }
      return json({ error: 'Return route not found.' },404);
    }
    if (method !== 'POST') return json({ error: 'Method not supported.' },405);
    const input: any = await request.json().catch(() => null);
    if (!input || typeof input !== 'object') return json({ error: 'Invalid request.' },400);
    if (['/api/returns/sheets','/api/returns/preview'].includes(path)) {
      if (user.role !== 'admin') return json({ error: 'Super Admin uploads return sheets. Receiving staff can scan and check items.' },403);
      const parsed = parseReturnCsv(input.filename, input.csv);
      const orders = await storage.readOrders();
      const result = await (path.endsWith('/preview') ? (async (change: any) => change(await storage.readAdmin()).result) : storage.changeAdmin)(rows => {
        const previous = rows.find(row => row.key === RETURN_SHEET_PREFIX + parsed.id)?.payload;
        const prepared = buildReturnSheet(parsed, orders, catalogFrom(rows).payload.products, actorName(user));
        if (previous) {
          if (!sameSource(previous,prepared)) returnFail('Sheet ' + parsed.id + ' already exists with different parcels. Its received quantities cannot be replaced.');
          return { rows, result: { sheet: previous, unchanged: true } };
        }
        const others = sheetsFromRows(rows);
        for (const parcel of prepared.parcels) {
          const owner = others.find(sheet => sheet.parcels.some(value => value.waybill === parcel.waybill || (!parcel.review_reason && parcel.order_id && !value.review_reason && value.order_id === parcel.order_id)));
          if (owner) returnFail('Waybill ' + parcel.waybill + ' already belongs to Sheet ' + owner.id + '. Upload was not added.');
        }
        return { rows: saveSheetRow(rows,prepared), result: { sheet: prepared, unchanged: false } };
      });
      if (!path.endsWith('/preview')) await annotateSheetOrders(storage,result.sheet);
      return json({ ok: true, ...result, preview: path.endsWith('/preview'), summary: summarizeReturnSheet(result.sheet) });
    }
    if (path === '/api/returns/scan') {
      const waybill = String(input.waybill || '').trim();
      const result = await storage.changeAdmin(rows => {
        const matches = sheetsFromRows(rows).filter(sheet => sheet.parcels.some(parcel => parcel.waybill === waybill));
        if (matches.length !== 1) returnFail(matches.length ? 'This waybill belongs to multiple return sheets. Ask the uploader to check it.' : 'Waybill not found in uploaded return sheets. Upload its Fardar CSV first.',404);
        const sheet = matches[0], parcel = sheet.parcels.find(parcel => parcel.waybill === waybill)!;
        if (parcel.scanned_at) return { rows, result: { sheet, waybill } };
        const next = { ...sheet, parcels: sheet.parcels.map(value => value === parcel ? { ...parcel, scanned_at: new Date().toISOString(), scanned_by: actorName(user) } : value) };
        return { rows: saveSheetRow(rows,next), result: { sheet: next, waybill } };
      });
      return json({ ok: true, ...result, summary: summarizeReturnSheet(result.sheet), message: 'Parcel opened. Check each item; scanning did not add stock.' });
    }
    if (detail?.[2] === 'rematch') {
      const orders = await storage.readOrders();
      const sheet = await storage.changeAdmin(rows => {
        const old = sheetAt(rows,detail[1]);
        const refreshed = buildReturnSheet({ id: old.id, filename: old.filename, source: old.source },orders,catalogFrom(rows).payload.products,actorName(user));
        const next = { ...old, parcels: old.parcels.map(parcel => {
          if (!parcel.review_reason || parcel.checked_at) return parcel;
          const match = refreshed.parcels.find(value => value.waybill === parcel.waybill)!;
          return { ...parcel, ...match, scanned_at: parcel.scanned_at, scanned_by: parcel.scanned_by, revision: parcel.revision + 1 };
        }) };
        return { rows: saveSheetRow(rows,next), result: next };
      });
      await annotateSheetOrders(storage,sheet);
      return json({ ok: true, sheet, summary: summarizeReturnSheet(sheet) });
    }
    if (detail?.[2] === 'receive') {
      const orders = await storage.readOrders();
      const result = await storage.changeAdmin(rows => {
        if (cancellationInProgress(rows as any[])) returnFail('An order cancellation is restoring stock. Retry after it completes.');
        const sheet = sheetAt(rows,detail[1]), parcel = sheet.parcels.find(parcel => parcel.waybill === String(input.waybill || '').trim());
        if (!parcel) returnFail('This waybill is not in the selected sheet.',404);
        const catalog = catalogFrom(rows), result = receiveReturnParcel(sheet,parcel,input,catalog.payload.products,orders.find(order => String(order.id) === parcel.order_id),actorName(user));
        if (result.unchanged) return { rows, result };
        let next = saveSheetRow(rows,result.sheet);
        if (result.products !== catalog.payload.products) {
          const at = new Date().toISOString();
          next = next.map(row => row === catalog ? { ...row, payload: { ...catalog.payload, products: result.products, version: Number(catalog.payload.version || 0)+1, updated_at: at }, updated_at: at } : row);
        }
        return { rows: next, result };
      });
      await annotateSheetOrders(storage,result.sheet);
      return json({ ok: true, sheet: result.sheet, summary: summarizeReturnSheet(result.sheet), unchanged: result.unchanged,
        receipt: { operation_id: result.receipt.operation_id, good_qty: result.receipt.good_qty, damaged_qty: result.receipt.damaged_qty, actor: result.receipt.actor, at: result.receipt.at } });
    }
    return json({ error: 'Return route not found.' },404);
  } catch (error) {
    if (error instanceof ReturnSheetError) return json({ error: error.message },error.status);
    throw error;
  }
};

export const returnSheetForWaybill = (rows: readonly Row[], waybill: string) => sheetsFromRows(rows).find(sheet => sheet.parcels.some(parcel => parcel.waybill === waybill));
export { sharedReturnInventory };
