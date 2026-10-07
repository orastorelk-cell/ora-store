import { Buffer } from 'node:buffer';
import { dataBucket, readDataTable, replaceDataTable } from './cloudflareData';
import { cancellationInProgress } from './r2OrderCancellation';
import { returnPackingHandler } from './r2ReturnPacking';
import { buildReturnSheet, parseReturnCsv, RETURN_SHEET_PREFIX, RETURN_UNLISTED_PREFIX, RETURN_CONTROL_KEY,
  ReturnSheetError, returnFail, receiveReturnParcel, correctReturnParcel, returnContainersFromRows,
  sheetsFromRows, summarizeReturnSheet, sharedReturnInventory, pendingReturnQty, parcelFullyReceived,
  returnPackingInProgress, type ReturnSheet } from '../src/lib/returnSheets';

type Row = Record<string, any>;
export type ReturnStorage = {
  readAdmin: () => Promise<readonly Row[]>;
  changeAdmin: <T>(change: (rows: readonly Row[]) => { rows: readonly Row[]; result: T }) => Promise<T>;
  readOrders: () => Promise<any[]>;
  updateOrders: (updates: Map<string, (order: any) => any>) => Promise<void>;
  readWaybills?: () => Promise<readonly Row[]>;
  changeWaybills?: <T>(change: (rows: readonly Row[]) => { rows: readonly Row[]; result: T }) => Promise<T>;
  writePhoto?: (id: string, data: string) => Promise<void>;
  readPhoto?: (id: string) => Promise<string | null>;
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
  readWaybills: () => readDataTable(env,'courier_waybills'),
  changeWaybills: change => replaceDataTable(env,'courier_waybills',change),
  writePhoto: async (id,data) => { const bucket = dataBucket(env); if (!bucket) throw new Error('Private photo storage unavailable.'); await bucket.put('ora-data/return-photos-v1/' + id + '.json',JSON.stringify({ data })); },
  readPhoto: async id => { const object = await dataBucket(env)?.get('ora-data/return-photos-v1/' + id + '.json'); return object ? JSON.parse(await object.text()).data : null; },
});
export const returnJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const returnActor = (user: Row) => String(user.display_name || user.name || user.username || user.id);
const sameSource = (a: ReturnSheet, b: ReturnSheet) => JSON.stringify([...a.source].sort((x,y) => x.waybill.localeCompare(y.waybill))) === JSON.stringify([...b.source].sort((x,y) => x.waybill.localeCompare(y.waybill)));
export const returnCatalog = (rows: readonly Row[]) => {
  const row = rows.find(row => row.key === 'storefront-state-v1');
  if (!row?.payload || !Array.isArray(row.payload.products)) returnFail('Shared stock catalog is unavailable.');
  return row;
};
export const upsertReturnRow = (rows: readonly Row[], key: string, payload: any): readonly Row[] => {
  const previous = rows.find(row => row.key === key), next = { ...previous,key,payload,updated_at: new Date().toISOString() };
  return previous ? rows.map(row => row === previous ? next : row) : [...rows,next];
};
const containerKey = (sheet: ReturnSheet) => sheet.id ? RETURN_SHEET_PREFIX + sheet.id : RETURN_UNLISTED_PREFIX + sheet.parcels[0].waybill;
const saveSheetRow = (rows: readonly Row[], sheet: ReturnSheet) => upsertReturnRow(rows,containerKey(sheet),sheet);
export const saveReturnCatalog = (rows: readonly Row[], products: any[]) => {
  const catalog = returnCatalog(rows), at = new Date().toISOString();
  return rows.map(row => row === catalog ? { ...row,payload: { ...row.payload,products,version: Number(row.payload.version || 0) + 1,updated_at: at },updated_at: at } : row);
};
export const setReturnPackingPending = (rows: readonly Row[], pending: boolean) => upsertReturnRow(rows,RETURN_CONTROL_KEY,{ ...rows.find(row => row.key === RETURN_CONTROL_KEY)?.payload,packing_pending: pending,updated_at: new Date().toISOString() });
const sheetAt = (rows: readonly Row[], id: string): ReturnSheet => {
  const sheet = rows.find(row => row.key === RETURN_SHEET_PREFIX + id)?.payload;
  if (!sheet) returnFail('Return Sheet ' + id + ' was not found.',404); return sheet;
};
export const returnSheetForWaybill = (rows: readonly Row[], waybill: string) => {
  const matches = returnContainersFromRows(rows).filter(sheet => sheet.parcels.some(parcel => parcel.waybill === waybill));
  if (matches.length > 1) returnFail('Waybill is linked to multiple return records.'); return matches[0];
};
const atWaybill = (rows: readonly Row[], waybill: string) => { const sheet = returnSheetForWaybill(rows,waybill); if (!sheet) returnFail('Scan this waybill before checking it.',404); return sheet; };
const responseSheet = (sheet: ReturnSheet) => ({ sheet,summary: summarizeReturnSheet(sheet),unlisted: !sheet.id });
export const annotateSheetOrders = async (storage: ReturnStorage, sheet: ReturnSheet) => {
  const updates = new Map<string, (order: any) => any>();
  for (const parcel of sheet.parcels) {
    if (!parcel.order_id || parcel.review_reason) continue;
    updates.set(parcel.order_id,order => {
      if (String(order?.waybill_number || '').trim() !== parcel.waybill) return order;
      const complete = parcelFullyReceived(parcel), issue = parcel.items.some(item => item.damaged_qty || pendingReturnQty(item));
      const received = parcel.items.some(item => item.good_qty + item.damaged_qty > 0);
      const fields = { ...(sheet.id ? { return_sheet_id: sheet.id,return_sheet_waybill: parcel.waybill } : {}),
        return_tracking_waybill: parcel.waybill,return_sheet_revision: parcel.revision,return_state: complete ? 'Received' : 'Pending',
        return_pending_qty: parcel.items.reduce((n,item) => n + pendingReturnQty(item),0),return_damaged_qty: parcel.items.reduce((n,item) => n + item.damaged_qty,0),
        return_status: !parcel.checked_at ? 'Pending Verification' : complete && !issue ? 'Verified' : 'Issue Found',
        ...(parcel.checked_at ? { return_checked_at: parcel.checked_at,return_checked_by: parcel.checked_by } : {}),
        ...(received ? { return_received_at: parcel.checked_at,delivery_status: complete && !issue ? 'Return Received - Verified' : 'Return Received - Partial / Issue' } : {}) };
      if (Number(order.return_sheet_revision || 0) > parcel.revision && order.return_tracking_waybill === parcel.waybill) return order;
      if (Object.entries(fields).every(([key,value]) => order[key] === value)) return order;
      return { ...order,...fields };
    });
  }
  if (updates.size) await storage.updateOrders(updates);
};
const validatePhotos = (rows: readonly Row[], waybill: string, items: any[]) => {
  for (const item of items) for (const id of item.photo_ids || []) {
    const photo = rows.find(row => row.key === 'return-photo-v1:' + id)?.payload;
    if (!photo || photo.waybill !== waybill || photo.item_id !== item.id) returnFail('Damage photo does not belong to this parcel item.',400);
  }
};

export const returnSheetsHandler = async (request: Request, storage: ReturnStorage, user: Row): Promise<Response> => {
  try {
    if (user.role !== 'admin' && !(user.permissions || []).includes('returns')) return returnJson({ error: 'Returns permission required.' },403);
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const detail = path.match(/^\/api\/returns\/sheets\/(\d+)(?:\/(receive|rematch|correct))?$/);
    const parcelRoute = path.match(/^\/api\/returns\/parcels\/([A-Za-z0-9_-]{3,80})(?:\/(receive|correct|rematch))?$/);
    const photoRoute = path.match(/^\/api\/returns\/photos\/([A-Za-z0-9_-]{16,100})$/);
    if (method !== 'GET' && user.role !== 'admin' && (user.permissions || []).includes('level:returns:view') && !(user.permissions || []).includes('action:return_process'))
      return returnJson({ error: 'Returns edit access or Scan / Process Returns access is required.' },403);
    if (path === '/api/returns/packing' || /^\/api\/returns\/packing\/[A-Za-z0-9_-]{16,100}(?:\/downloaded)?$/.test(path)) return returnPackingHandler(request,storage,user);
    if (method === 'GET') {
      const rows = await storage.readAdmin();
      if (photoRoute) {
        if (!rows.some(row => row.key === 'return-photo-v1:' + photoRoute[1])) return returnJson({ error: 'Photo not found.' },404);
        const data = await storage.readPhoto?.(photoRoute[1]), match = data?.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
        if (!match) return returnJson({ error: 'Photo not found.' },404);
        return new Response(Buffer.from(match[2],'base64'),{ headers: { 'content-type': 'image/' + match[1],'cache-control': 'private, no-store','x-content-type-options': 'nosniff' } });
      }
      if (path === '/api/returns/unlisted') return returnJson({ ok: true,parcels: returnContainersFromRows(rows).filter(sheet => !sheet.id).flatMap(sheet => sheet.parcels).sort((a,b) => String(b.scanned_at).localeCompare(String(a.scanned_at))) });
      if (path === '/api/returns/sheets') {
        const search = (url.searchParams.get('search') || '').trim().toLowerCase().slice(0,100), state = url.searchParams.get('status');
        const all = sheetsFromRows(rows).filter(sheet => !search || sheet.id.includes(search)).sort((a,b) => b.uploaded_at.localeCompare(a.uploaded_at));
        const sheets = all.filter(sheet => !state || state === 'all' || (state === 'complete' ? sheet.parcels.every(parcelFullyReceived) : !sheet.parcels.every(parcelFullyReceived)));
        const offset = Math.max(0,Math.min(100000,Number(url.searchParams.get('offset')) || 0));
        return returnJson({ ok: true,total: sheets.length,pending: all.filter(sheet => !sheet.parcels.every(parcelFullyReceived)).length,complete: all.filter(sheet => sheet.parcels.every(parcelFullyReceived)).length,sheets: sheets.slice(offset,offset + 100).map(summarizeReturnSheet),can_import: user.role === 'admin' });
      }
      const sheet = detail && !detail[2] ? sheetAt(rows,detail[1]) : parcelRoute && !parcelRoute[2] ? atWaybill(rows,parcelRoute[1]) : null;
      if (sheet) { await annotateSheetOrders(storage,sheet); return returnJson({ ok: true,...responseSheet(sheet) }); }
      return returnJson({ error: 'Return route not found.' },404);
    }
    if (method !== 'POST') return returnJson({ error: 'Method not supported.' },405);
    const input: any = await request.json().catch(() => null);
    if (!input || typeof input !== 'object') return returnJson({ error: 'Invalid request.' },400);
    if (['/api/returns/sheets','/api/returns/preview'].includes(path)) {
      if (user.role !== 'admin') return returnJson({ error: 'Super Admin uploads return sheets. Receiving staff can scan and check items.' },403);
      const parsed = parseReturnCsv(input.filename,input.csv), orders = await storage.readOrders();
      const preview = path.endsWith('/preview');
      const change = (rows: readonly Row[]) => {
        const previous = rows.find(row => row.key === RETURN_SHEET_PREFIX + parsed.id)?.payload;
        const prepared = buildReturnSheet(parsed,orders,returnCatalog(rows).payload.products,returnActor(user));
        if (previous) { if (!sameSource(previous,prepared)) returnFail('Sheet ' + parsed.id + ' already exists with different parcels.'); return { rows,result: { sheet: previous,unchanged: true } }; }
        const others = sheetsFromRows(rows); let next: readonly Row[] = rows;
        for (let i = 0; i < prepared.parcels.length; i++) {
          const parcel = prepared.parcels[i];
          const owner = others.find(sheet => sheet.parcels.some(value => value.waybill === parcel.waybill || (!parcel.review_reason && parcel.order_id && !value.review_reason && value.order_id === parcel.order_id)));
          if (owner) returnFail('Waybill ' + parcel.waybill + ' already belongs to Sheet ' + owner.id + '.');
          const unlisted = rows.find(row => row.key === RETURN_UNLISTED_PREFIX + parcel.waybill)?.payload as ReturnSheet | undefined;
          if (unlisted) {
            const prior = unlisted.parcels[0];
            if (prior.checked_at && parcel.review_reason) returnFail('Cannot link received parcel ' + parcel.waybill + ': ' + parcel.review_reason);
            prepared.parcels[i] = { ...parcel,...prior,csv_order_id: parcel.csv_order_id,returned_date: parcel.returned_date,reason: parcel.reason || prior.reason };
            prepared.receipts.push(...unlisted.receipts);
            next = next.filter(row => row.key !== RETURN_UNLISTED_PREFIX + parcel.waybill);
          }
        }
        return { rows: saveSheetRow(next,prepared),result: { sheet: prepared,unchanged: false } };
      };
      const result = preview ? change(await storage.readAdmin()).result : await storage.changeAdmin(change);
      if (!preview) await annotateSheetOrders(storage,result.sheet);
      return returnJson({ ok: true,...responseSheet(result.sheet),unchanged: result.unchanged,preview });
    }
    if (path === '/api/returns/scan') {
      const waybill = String(input.waybill || '').trim(); if (!/^[A-Za-z0-9_-]{3,80}$/.test(waybill)) returnFail('Scan or enter a valid waybill.',400);
      const orders = await storage.readOrders();
      const result = await storage.changeAdmin(rows => {
        let sheet = returnSheetForWaybill(rows,waybill);
        if (!sheet) sheet = buildReturnSheet({ id: '',filename: '',source: [{ waybill,order_id: '',returned_date: '',reason: '' }] },orders,returnCatalog(rows).payload.products,returnActor(user));
        const parcel = sheet.parcels.find(parcel => parcel.waybill === waybill)!;
        if (parcel.scanned_at) return { rows,result: sheet };
        if(returnPackingInProgress(rows))returnFail('A packing batch is finishing. Retry the scan shortly.');
        const now = new Date().toISOString(), next = { ...sheet,updated_at: now,parcels: sheet.parcels.map(value => value === parcel ? { ...parcel,scanned_at: now,scanned_by: returnActor(user) } : value) };
        let saved = saveSheetRow(rows,next);
        if (!parcel.review_reason) { saved = setReturnPackingPending(saved,true); saved = saveReturnCatalog(saved,returnCatalog(saved).payload.products); }
        return { rows: saved,result: next };
      });
      await annotateSheetOrders(storage,result);
      return returnJson({ ok: true,...responseSheet(result),waybill,message: result.id ? 'Check the parcel items in the popup.' : 'Parcel saved without a Sheet ID. A later matching CSV will link these receipts automatically.' });
    }
    if (path === '/api/returns/photos') {
      const id = String(input.upload_id || ''), waybill = String(input.waybill || ''), itemId = String(input.item_id || ''), data = String(input.data_url || '');
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(id)) returnFail('A photo upload ID is required.',400);
      const match = data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || !Buffer.from(match[2],'base64').length || Buffer.from(match[2],'base64').length > 500000) returnFail('Upload a compressed JPG, PNG or WebP photo below 500 KB.',400);
      const rows = await storage.readAdmin(), sheet = atWaybill(rows,waybill);
      if (!sheet.parcels.find(parcel => parcel.waybill === waybill)?.items.some(item => item.id === itemId)) returnFail('Photo item not found.',404);
      const digest = Buffer.from(await crypto.subtle.digest('SHA-256',Buffer.from(match[2],'base64'))).toString('hex');
      const check = (previous: any) => { if (previous && (previous.waybill !== waybill || previous.item_id !== itemId || previous.digest !== digest)) returnFail('This photo upload ID was already used.'); };
      check(rows.find(row => row.key === 'return-photo-v1:' + id)?.payload);
      if (!storage.writePhoto) returnFail('Private photo storage unavailable.',503);
      await storage.changeAdmin(current => { const previous = current.find(row => row.key === 'return-photo-v1:' + id)?.payload; check(previous); return { rows: previous ? current : upsertReturnRow(current,'return-photo-v1:' + id,{ id,waybill,item_id: itemId,digest,actor: returnActor(user),at: new Date().toISOString() }),result: null }; });
      await storage.writePhoto(id,data);
      return returnJson({ ok: true,photo_id: id });
    }
    const action = detail?.[2] || parcelRoute?.[2];
    if (action === 'rematch') {
      const orders = await storage.readOrders();
      const sheet = await storage.changeAdmin(rows => {
        const old = detail ? sheetAt(rows,detail[1]) : atWaybill(rows,parcelRoute![1]);
        const refreshed = buildReturnSheet({ id: old.id,filename: old.filename,source: old.source },orders,returnCatalog(rows).payload.products,returnActor(user));
        const next = { ...old,updated_at: new Date().toISOString(),parcels: old.parcels.map(parcel => {
          if (!parcel.review_reason || parcel.checked_at) return parcel;
          const match = refreshed.parcels.find(value => value.waybill === parcel.waybill)!;
          return { ...parcel,...match,scanned_at: parcel.scanned_at,scanned_by: parcel.scanned_by,revision: parcel.revision + 1 };
        }) };
        return { rows: saveSheetRow(rows,next),result: next };
      });
      await annotateSheetOrders(storage,sheet); return returnJson({ ok: true,...responseSheet(sheet) });
    }
    if (action === 'receive' || action === 'correct') {
      const orders = await storage.readOrders();
      const result = await storage.changeAdmin(rows => {
        const sheet = detail ? sheetAt(rows,detail[1]) : atWaybill(rows,parcelRoute![1]);
        if ((cancellationInProgress(rows as any[]) || returnPackingInProgress(rows))&&!sheet.receipts.some(receipt=>receipt.operation_id===input.operation_id)) returnFail('A stock transaction is finishing. Retry this saved request shortly.');
        const waybill = parcelRoute?.[1] || String(input.waybill || '').trim(), parcel = sheet.parcels.find(parcel => parcel.waybill === waybill);
        if (!parcel) returnFail('This waybill is not in the selected sheet.',404);
        validatePhotos(rows,waybill,Array.isArray(input.items) ? input.items : []);
        const catalog = returnCatalog(rows), result = action === 'correct' ? correctReturnParcel(sheet,parcel,input,catalog.payload.products,returnActor(user)) : receiveReturnParcel(sheet,parcel,input,catalog.payload.products,orders.find(order => String(order.id) === parcel.order_id),returnActor(user));
        if (result.unchanged) return { rows,result };
        let next = saveSheetRow(rows,result.sheet); next = setReturnPackingPending(next,true); next = saveReturnCatalog(next,result.products);
        return { rows: next,result };
      });
      await annotateSheetOrders(storage,result.sheet);
      return returnJson({ ok: true,...responseSheet(result.sheet),unchanged: result.unchanged,receipt: result.receipt });
    }
    return returnJson({ error: 'Return route not found.' },404);
  } catch (error) { if (error instanceof ReturnSheetError) return returnJson({ error: error.message },error.status); throw error; }
};
export { sharedReturnInventory };
