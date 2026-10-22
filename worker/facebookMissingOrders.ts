import { readDataTable, replaceDataTable, reserveCloudflareOrderNumber } from './cloudflareData';
import {acquireFacebookSheetWriteLock, FacebookSheetBusyError} from './facebookSheetWriteLock';
import { verifyActiveStaff } from './r2RecoveryFallback';
import { readSheetConnection } from './r2SheetConfirm';
import { googleSheetRequest, readGoogleSheetTabs, SheetApiError, type SheetConnection } from './googleSheetsApi';
import { buildFacebookOrder } from './facebookLeadAuto';
import { recoverSheetLead, recoveredLeadIdentityConflict, sheetParcelHistory } from './sheetLeadRecovery';
import { buildOrderSheetRow } from '../src/lib/googleSheets';
import { canonicalJson } from '../src/lib/confirmCsvSave';
import { sheetHeader, type SheetTab } from '../src/lib/sheetConfirmRows';
import {
  FACEBOOK_MISSING_API, facebookLeadKey, facebookSheetGroups, compareFacebookLeads, FacebookSheetCoverageError,
  type FacebookAuditLead, type FacebookMissingSnapshot, type FacebookSheetGroup,
} from '../src/lib/facebookMissingOrders';

const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'cache-control': 'no-store'}});
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
type Env = Record<string, any>;
type Row = Record<string, any>;
const message = (error: unknown) => error instanceof SheetApiError || error instanceof FacebookSheetCoverageError || error instanceof FacebookSheetBusyError ? error.message : 'The sources or saved import could not be verified. Check again and retry the missing order.';

const makeSnapshot = (orders: Row[], tabs: SheetTab[]): FacebookMissingSnapshot => {
  const {groups, target} = facebookSheetGroups(tabs);
  const numbers = new Set(orders.map(order => order.order_number));
  return {
    checked_at: new Date().toISOString(), target_tab: target.tab.title,
    orders: orders.filter(order => order.order_source === 'Facebook Ads' && facebookLeadKey(order.platform_lead_id)).map(order => ({
      lead_id: facebookLeadKey(order.platform_lead_id), order_number: String(order.order_number), expected_rows: Math.max(1, order.items?.length || 0),
    })),
    sheet_orders: [...groups.values()].map(({order_number, lead_ids, rows, sheet_ids}) => ({order_number, lead_ids, rows, sheet_ids})),
    unlinked_sheet_orders: [...groups.values()].filter(group => !group.lead_ids.length && !numbers.has(group.order_number)).map(group => group.order_number),
  };
};
const allOrders = async (env: Env) => (await readDataTable(env, 'order_snapshots')).map(row => row.payload).filter(Boolean);
const requiredConnection = async (env: Env) => {
  const connection = await readSheetConnection(env);
  if (!connection) throw new SheetApiError('Connect the Google Sheet in Confirm / Cancel Upload first. The check needs direct Sheet access.', 409);
  return connection;
};
const orderFingerprint = (order: Row) => canonicalJson(Object.fromEntries([
  'id', 'order_number', 'platform_lead_id', 'items', 'customer_name', 'phone', 'whatsapp', 'address', 'city', 'district',
  'subtotal', 'delivery_fee', 'special_offer_discount', 'gift_wrap_selected', 'gift_wrap_fee', 'total_amount', 'order_status', 'call_center_status',
].filter(key => order[key] !== undefined).map(key => [key, order[key]])));

const graphReader = (env: Env, network: typeof fetch) => async (id: string, fields: string) => {
  if (!env.META_PAGE_ACCESS_TOKEN) throw new SheetApiError('Facebook Page access is not configured.');
  const url = new URL('https://graph.facebook.com/' + String(env.META_GRAPH_API_VERSION || 'v26.0') + '/' + id);
  url.searchParams.set('fields', fields);
  const response = await network(url, {headers: {authorization: 'Bearer ' + env.META_PAGE_ACCESS_TOKEN}, signal: AbortSignal.timeout(6500)});
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) throw new SheetApiError('Facebook could not verify this lead. No new order was imported from it.');
  return data;
};

const recoverOriginal = (group: FacebookSheetGroup, lead: FacebookAuditLead, products: any[], settings: any, at: string, operation: string) => {
  const keys = group.headers.map(sheetHeader), action = keys.indexOf('order_action');
  const actions = group.values.map(row => String(row[action] || '').trim().toLowerCase().replace(/[_-]+/g, ' ')).filter(Boolean);
  const savedStatuses = keys.flatMap((key, i) => ['imported_status', 'order_status', 'call_center_status'].includes(key) ? group.values.map(row => String(row[i] || '').trim().toLowerCase()) : []);
  const cancelled = [...actions, ...savedStatuses].some(value => ['cancel', 'cancelled', 'canceled', 'cancel entire order'].includes(value));
  if (savedStatuses.some(value => ['shipped', 'delivered', 'packed', 'processing'].includes(value)) || keys.some((key, i) => ['waybill', 'waybill_number', 'tracking_number', 'invoice_number'].includes(key) && group.values.some(row => String(row[i] || '').trim())))
    throw new SheetApiError(group.order_number + ' has parcel / invoice details in the Sheet. Review its original parcel before restoring it.', 409);
  if (cancelled && actions.some(value => ['confirm', 'confirmed', 'confirm order'].includes(value))) throw new SheetApiError('Confirm and Cancel conflict in ' + group.order_number + '. Review its Sheet rows.', 409);
  if (actions.some(value => !['pending', 'no answer', 'reschedule', 'rescheduled', 'confirm', 'confirmed', 'confirm order', 'cancel', 'cancelled', 'canceled', 'cancel entire order'].includes(value)))
    throw new SheetApiError('Review the Order Action for ' + group.order_number + ' before recovery.', 409);
  let order: Row;
  try {
    // The original rows supply historical items, quantities, amounts and customer
    // corrections. Today's catalog must not replace those values.
    order = recoverSheetLead({order_number: group.order_number, status: cancelled ? 'Cancelled' : 'Confirmed', sheetId: group.sheet_ids[0], title: group.title,
      headers: group.headers, rows: group.values, row_indices: group.row_indices, fingerprint: ''}, products, settings, at, operation);
  } catch (error: any) {throw new SheetApiError(String(error.message || 'The original Sheet rows need review.'), 409);}
  return {...order, platform_lead_id: lead.lead_id, platform_lead_created_at: lead.created_at,
    ...(cancelled ? {order_status: 'Cancelled', call_center_status: 'Cancelled', cancel_reason: group.values.map(row => row[keys.indexOf('cancel_reason')]).find(Boolean) || 'Cancelled in original Google Sheet'} : {}),
    // Confirmed Sheet decisions stay in the existing finalize workflow; recovery
    // itself never deducts stock, assigns a waybill or generates an invoice.
    facebook_missing_recovery: {operation_id: operation, recovered_at: at, phase: 'complete', sheet_action: cancelled ? 'Cancelled' : actions.join(', ') || 'Pending'},
    facebook_offer_snapshot_version: 2};
};

const insertOrder = async (env: Env, seed: Row) => replaceDataTable(env, 'order_snapshots', rows => {
  const conflicts = rows.map(row => row.payload).filter(order => order && recoveredLeadIdentityConflict(seed, order));
  if (conflicts.length) {
    if (conflicts.length !== 1 || facebookLeadKey(conflicts[0].platform_lead_id) !== seed.platform_lead_id)
      throw new SheetApiError('This Lead ID or original Order ID now belongs to another order. Check again.', 409);
    return {rows, result: conflicts[0]};
  }
  const at = new Date().toISOString();
  return {rows: [...rows, {order_id: seed.id, order_number: seed.order_number, payload: seed, created_at: seed.created_at, updated_at: at}], result: seed};
});

const holdSheetRetry = async (env: Env, order: Row, operation: string) => replaceDataTable(env, 'order_snapshots', rows => {
  let saved: Row | undefined;
  const next = rows.map(row => {
    if (row.order_id !== order.id) return row;
    if (orderFingerprint(row.payload) !== orderFingerprint(order)) throw new SheetApiError(order.order_number + ' changed. Check again before importing.', 409);
    saved = {...row.payload, facebook_offer_snapshot_version: 2, facebook_missing_recovery: {
      ...row.payload.facebook_missing_recovery, operation_id: operation, recovered_at: new Date().toISOString(), phase: 'sheet_pending',
    }};
    return {...row, payload: saved, updated_at: new Date().toISOString()};
  });
  if (!saved) throw new SheetApiError('The order is no longer in the system. Check again.', 409);
  return {rows: next, result: saved};
});
const finishSheetRetry = async (env: Env, order: Row) => replaceDataTable(env, 'order_snapshots', rows => {
  let found = false;
  const next = rows.map(row => {
    if (row.order_id !== order.id) return row;
    if (orderFingerprint(row.payload) !== orderFingerprint(order)) throw new SheetApiError(order.order_number + ' changed during import. Review its current Sheet rows.', 409);
    found = true;
    const at = new Date().toISOString(), payload = {...row.payload, is_synced_google_sheets: true, synced_at: at, sheet_sync_verified_at: at,
      facebook_missing_recovery: {...row.payload.facebook_missing_recovery, phase: 'complete', verified_at: at}};
    return {...row, payload, updated_at: at};
  });
  if (!found) throw new SheetApiError('The saved order could not be verified. Check again.', 409);
  return {rows: next, result: true};
});

const appendMissing = async (connection: SheetConnection, tabs: SheetTab[], orders: Row[], settings: any, network: typeof fetch) => {
  const {groups, target} = facebookSheetGroups(tabs);
  const pending = orders.filter(order => !groups.has(order.order_number));
  if (!pending.length) return;
  const keys = target.headers.map(sheetHeader);
  const required = ['order_id', 'customer_name', 'phone_number', 'address', 'city', 'district', 'item_code', 'qty', 'unit_price_rs', 'line_total_rs', 'delivery_fee_rs', 'final_total_rs', 'lead_id', 'order_action'];
  if (required.some(key => !keys.includes(key))) throw new SheetApiError('The Facebook tab is missing required order columns. Repair the Sheet headers before importing.', 409);
  const rows = pending.flatMap(order => {
    if (!Array.isArray(order.items) || !order.items.length) throw new SheetApiError(order.order_number + ' has no item rows. Review it before Sheet recovery.', 409);
    return order.items.map((item: any, i: number) => {
      const raw = buildOrderSheetRow(order, item, i === 0, settings);
      raw['Order Action'] = i === 0 ? (order.order_status === 'Cancelled' ? 'CANCEL ENTIRE ORDER' : order.call_center_status === 'Confirmed' ? 'CONFIRM ORDER' : 'PENDING') : '';
      const values = new Map(Object.entries(raw).map(([key, value]) => [sheetHeader(key), value]));
      return {values: keys.map(key => {
        const value = values.get(key) ?? '';
        return {userEnteredValue: typeof value === 'number' ? {numberValue: value} : typeof value === 'boolean' ? {boolValue: value} : {stringValue: String(value)}};
      })};
    });
  });
  // appendCells is atomic and never clears or overwrites a customer-edited row.
  // Strings use stringValue, so customer input cannot become a Sheet formula.
  await googleSheetRequest(connection, ':batchUpdate', {requests: [{appendCells: {sheetId: target.tab.sheetId, rows, fields: 'userEnteredValue'}}]}, network);
};

export const facebookMissingOrdersHandler = async (request: Request, envValue: unknown, network: typeof fetch = fetch): Promise<Response | null> => {
  if (new URL(request.url).pathname !== FACEBOOK_MISSING_API) return null;
  if (request.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
  const env = (envValue || {}) as Env;
  let release: (() => Promise<void>) | undefined;
  try {
    const user = await verifyActiveStaff(request, env);
    if (!user) return json({error: 'Login required.'}, 401);
    if (user.role !== 'admin') return json({error: 'Super Admin access required.'}, 403);
    const raw = await request.text();
    if (raw.length > 16000) return json({error: 'The import request is too large.'}, 400);
    const body: any = JSON.parse(raw);
    if (!['snapshot', 'import'].includes(body?.action)) return json({error: 'Unknown missing-order action.'}, 400);
    const connection = await requiredConnection(env);
    if (body.action === 'snapshot') {
      const [orders, tabs] = await Promise.all([allOrders(env), readGoogleSheetTabs(connection, network)]);
      return json({ok: true, snapshot: makeSnapshot(orders, tabs)});
    }
    if (!Array.isArray(body.leads) || !body.leads.length || body.leads.length > 3 || !body.leads.every((lead: any) => validId(lead?.lead_id) && validId(lead?.form_id) && Number.isFinite(Date.parse(lead?.created_at))) || new Set(body.leads.map((lead: any) => lead.lead_id)).size !== body.leads.length)
      return json({error: 'Import one to three unique, checked Facebook leads at a time.'}, 400);
    if (!validId(body.page_id)) return json({error: 'Check the connected Facebook Page before importing.'}, 400);
    if (body.leads.some((lead: FacebookAuditLead) => Date.parse(lead.created_at) < Date.now() - 91 * 86400000 || Date.parse(lead.created_at) > Date.now() + 60000))
      return json({error: 'Only checked leads from the last 90 days can be imported here.'}, 400);
    release = await acquireFacebookSheetWriteLock(env);
    const graph = graphReader(env, network), page = await graph('me', 'id');
    if (String(page.id) !== body.page_id) throw new SheetApiError('The Facebook Page changed. Run Check Missing Orders again.', 409);
    let [orders, tabs] = await Promise.all([allOrders(env), readGoogleSheetTabs(connection, network)]);
    const admin = await readDataTable(env, 'admin_data_store'), state = admin.find(row => row.key === 'storefront-state-v1')?.payload;
    if (!Array.isArray(state?.products) || !state.settings) throw new SheetApiError('The current product catalog could not be verified.');
    const parcelHistory = sheetParcelHistory(await readDataTable(env, 'courier_waybills'), admin);
    const operation = crypto.randomUUID(), results: any[] = [], toMirror: Row[] = [], forms = new Map<string, any>();
    for (const input of body.leads as FacebookAuditLead[]) {
      try {
        const form = forms.get(input.form_id) || await graph(input.form_id, 'id,name,page_id'); forms.set(input.form_id, form);
        if (String(form.page_id) !== body.page_id) throw new SheetApiError('The form does not belong to the connected Facebook Page.', 403);
        const source = await graph(input.lead_id, 'id,created_time,form_id,field_data,ad_id');
        if (String(source.id) !== input.lead_id || String(source.form_id) !== input.form_id || !Number.isFinite(Date.parse(source.created_time)) || Date.parse(source.created_time) !== Date.parse(input.created_at))
          throw new SheetApiError('Facebook lead identity changed. Check again.', 409);
        const lead = {...input, created_at: source.created_time, form_name: String(form.name || input.form_id)};
        const compared = compareFacebookLeads([lead], makeSnapshot(orders, tabs))[0];
        if (compared.issue) throw new SheetApiError(compared.issue, 409);
        let order = orders.find(order => order.order_source === 'Facebook Ads' && facebookLeadKey(order.platform_lead_id) === lead.lead_id);
        if (!order) {
          let seed: Row;
          if (compared.sheet_found) {
            const group = facebookSheetGroups(tabs).groups.get(compared.order_number)!;
            if (parcelHistory.has(group.order_number)) throw new SheetApiError(group.order_number + ' has courier / packing history. Review its original parcel before restoring it.', 409);
            seed = recoverOriginal(group, lead, state.products, state.settings, new Date().toISOString(), operation);
          } else {
            seed = await buildFacebookOrder(null, source, form, {leadgen_id: lead.lead_id, form_id: lead.form_id, ad_id: source.ad_id}, {products: state.products, settings: state.settings});
            for (let attempt = 0; attempt < 100; attempt++) {
              seed.order_number = await reserveCloudflareOrderNumber(env, 'FB');
              if (!facebookSheetGroups(tabs).groups.has(seed.order_number) && !parcelHistory.has(seed.order_number)) break;
              if (attempt === 99) throw new SheetApiError('Order number history needs review before assigning a new Order ID.', 409);
            }
            seed.facebook_missing_recovery = {operation_id: operation, recovered_at: new Date().toISOString(), phase: 'sheet_pending'};
            seed.facebook_offer_snapshot_version = 2;
          }
          order = await insertOrder(env, seed);
          orders = await allOrders(env);
        }
        if (!compared.sheet_found) order = await holdSheetRetry(env, order, operation);
        toMirror.push(order);
        results.push({lead_id: lead.lead_id, order_number: order.order_number, ok: false});
      } catch (error) {results.push({lead_id: input.lead_id, ok: false, error: message(error)});}
    }
    if (toMirror.length) {
      try {
        // Recheck after the durable save, so a webhook or staff member that
        // filled the Sheet during Meta reads is respected.
        tabs = await readGoogleSheetTabs(connection, network);
        const current = makeSnapshot(await allOrders(env), tabs);
        for (const order of toMirror) {
          const check = compareFacebookLeads([{lead_id: order.platform_lead_id, form_id: '', created_at: order.created_at}], current)[0];
          if (check.issue) throw new SheetApiError(check.issue, 409);
        }
        await appendMissing(connection, tabs, toMirror, state.settings, network);
        tabs = await readGoogleSheetTabs(connection, network);
        const verified = makeSnapshot(await allOrders(env), tabs);
        for (const order of toMirror) {
          const result = results.find(value => value.lead_id === order.platform_lead_id);
          try {
            const check = compareFacebookLeads([{lead_id: order.platform_lead_id, form_id: '', created_at: order.created_at}], verified)[0];
            if (!check.system_found || !check.sheet_found || check.issue) throw new SheetApiError(check.issue || 'The saved order is not yet visible in both destinations. Retry this order.');
            await finishSheetRetry(env, order); result.ok = true;
          } catch (error) {result.error = message(error);}
        }
      } catch (error) {for (const result of results.filter(value => !value.ok && !value.error)) result.error = message(error);}
    }
    orders = await allOrders(env);
    return json({ok: true, results, snapshot: makeSnapshot(orders, tabs)});
  } catch (error) {return json({error: message(error)}, error instanceof SheetApiError || error instanceof FacebookSheetBusyError ? error.status : 503);}
  finally {if (release) await release().catch(() => {});}
};
