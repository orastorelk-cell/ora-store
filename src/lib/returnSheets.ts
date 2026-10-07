import type { ReturnRecord, StockHistory } from '../types';

export const RETURN_SHEET_PREFIX = 'return-sheet-v1:';
export type ReturnItem = {
  id: string; product_id: string; variant_id?: string; sku: string; name: string;
  bundle_name?: string; expected_qty: number; good_qty: number; damaged_qty: number;
  not_received: boolean;
};
export type ReturnParcel = {
  waybill: string; csv_order_id: string; order_id?: string; order_number?: string;
  returned_date: string; reason: string; items: ReturnItem[]; review_reason?: string;
  scanned_at?: string; scanned_by?: string; revision: number; notes?: string;
  checked_at?: string; checked_by?: string;
};
export type ReturnReceipt = {
  operation_id: string; fingerprint: string; waybill: string; actor: string; at: string;
  stock_history: StockHistory[]; good_qty: number; damaged_qty: number;
};
export type ReturnSheet = {
  id: string; filename: string; source: { waybill: string; order_id: string; returned_date: string; reason: string }[];
  uploaded_at: string; uploaded_by: string; parcels: ReturnParcel[]; receipts: ReturnReceipt[];
};
export type ReturnSheetSummary = ReturnType<typeof summarizeReturnSheet>;
export class ReturnSheetError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const returnFail = (message: string, status = 409): never => { throw new ReturnSheetError(message, status); };
const integer = (value: unknown, label: string, min = 0) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > 1_000_000) returnFail('Invalid ' + label + '.', 400);
  return value as number;
};

// Quoted commas, escaped quotes, CRLF and multiline fields are valid Fardar CSV.
export const parseReturnCsv = (filename: string, text: string) => {
  const name = String(filename || '').split(/[\\/]/).pop() || '';
  const match = name.match(/^(\d+)(?:\s*\(\d+\))?\.csv$/i);
  if (!match) returnFail('Use the original Fardar CSV filename, for example 368000.csv. Its number is the Sheet ID.', 400);
  if (typeof text !== 'string' || text.length > 2_000_000 || !text.trim()) returnFail('The CSV is empty or too large.', 400);
  const cells: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else returnFail('Invalid CSV quotation.', 400);
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(cell); cell = '';
      if (char !== ',') { if (row.some(value => value.trim())) cells.push(row); row = []; if (char === '\r' && input[i + 1] === '\n') i++; }
    } else cell += char;
  }
  if (quoted) returnFail('The CSV has an unfinished quoted field.', 400);
  row.push(cell); if (row.some(value => value.trim())) cells.push(row);
  const header = cells.shift()?.map(value => value.trim().toLowerCase()) || [];
  const at = (name: string) => header.indexOf(name);
  if (at('waybill id') < 0 || at('order id') < 0) returnFail('Fardar headers Waybill ID and Order ID are required.', 400);
  if (!cells.length || cells.length > 2000) returnFail('Upload between 1 and 2,000 parcels per sheet.', 400);
  const seen = new Set<string>();
  const source = cells.map((values, index) => {
    if (values.length !== header.length) returnFail('CSV row ' + (index + 2) + ' has the wrong number of columns.', 400);
    const value = (name: string) => String(values[at(name)] || '').trim();
    const waybill = value('waybill id');
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(waybill)) returnFail('Invalid Waybill ID on row ' + (index + 2) + '.', 400);
    if (seen.has(waybill)) returnFail('Duplicate waybill ' + waybill + ' in this CSV.', 400);
    seen.add(waybill);
    return { waybill, order_id: value('order id'), returned_date: value('returned date').slice(0,100), reason: value('reason').slice(0,1000) };
  });
  return { id: match[1], filename: name, source };
};

export const physicalReturnItems = (order: any): ReturnItem[] => {
  if (!Array.isArray(order.items) || !order.items.length) returnFail('Order items are missing.');
  const grouped = new Map<string, ReturnItem>();
  const add = (item: any, quantity: number, bundle?: string) => {
    const product = String(item.product_id || ''), variant = String(item.variant_id || '');
    if (!product) returnFail('An exact product is missing from the order.');
    integer(quantity, 'expected quantity', 1);
    const id = product + '::' + variant;
    const old = grouped.get(id);
    if (old) { old.expected_qty += quantity; integer(old.expected_qty, 'expected quantity', 1); return; }
    grouped.set(id, { id, product_id: product, ...(variant ? { variant_id: variant } : {}),
      sku: String(item.sku || ''), name: String(item.product_name || item.sku || product) + (item.variant_name ? ' - ' + item.variant_name : ''),
      ...(bundle ? { bundle_name: bundle } : {}), expected_qty: quantity, good_qty: 0, damaged_qty: 0, not_received: false });
  };
  for (const item of order.items) {
    const qty = integer(item.quantity, 'order quantity', 1);
    if (item.product_type === 'bundle') {
      if (!Array.isArray(item.bundle_components) || !item.bundle_components.length) returnFail('Bundle component details are missing.');
      for (const component of item.bundle_components) add(component, qty * integer(component.quantity_per_bundle, 'bundle quantity', 1), String(item.product_name || item.sku));
    } else add(item, qty);
  }
  return [...grouped.values()];
};
export const inventoryReturnTarget = (products: any[], item: ReturnItem) => {
  const matches = products.filter(product => String(product.id) === item.product_id);
  if (matches.length !== 1) returnFail('Exact product unavailable: ' + item.name);
  const product = matches[0]; let target = product;
  if (item.variant_id) {
    const variants = (product.variants || []).filter((variant: any) => String(variant.id) === item.variant_id);
    if (variants.length !== 1) returnFail('Exact variant unavailable: ' + item.name);
    target = variants[0];
  } else if (product.product_type === 'variant' || product.variants?.length) returnFail('Exact variant required: ' + item.name);
  if (product.product_type === 'bundle') returnFail('Receive each bundle component separately.');
  return { product, target };
};
const eligible = (order: any, waybill: string, sheetId?: string) => {
  if (String(order.waybill_number || '').trim() !== waybill) returnFail('This is an old waybill; the order has another waybill.');
  if (order.stock_allocated !== true) returnFail('This order never deducted stock. Stock cannot be added for its return.');
  if (order.order_status === 'Cancelled' || order.cancel_stock_restore || order.is_duplicate_order || order.is_test_order) returnFail('This order cannot receive return stock.');
  if (!order.return_sheet_id && (order.return_received_at || ['Verified', 'Issue Found'].includes(order.return_status))) returnFail('This return was already processed in the old return flow. Check its stock history before receiving again.');
  if (order.return_sheet_id && order.return_sheet_id !== sheetId) returnFail('This order already belongs to Return Sheet ' + order.return_sheet_id + '.');
};
export const buildReturnSheet = (parsed: ReturnType<typeof parseReturnCsv>, orders: any[], products: any[], actor: string): ReturnSheet => {
  const parcels = parsed.source.map(source => {
    const matches = orders.filter(order => String(order.waybill_number || '').trim() === source.waybill ||
      (order.waybill_history || []).some((entry: any) => String(entry.old_waybill || '').trim() === source.waybill));
    const parcel: ReturnParcel = { waybill: source.waybill, csv_order_id: source.order_id, returned_date: source.returned_date, reason: source.reason, revision: 0, items: [] };
    if (matches.length !== 1) { parcel.review_reason = matches.length ? 'Waybill matches multiple orders.' : 'Waybill not found in system orders.'; return parcel; }
    const order = matches[0]; parcel.order_id = String(order.id); parcel.order_number = String(order.order_number);
    try {
      parcel.items = physicalReturnItems(order);
      eligible(order, source.waybill, parsed.id);
      if (source.order_id && source.order_id !== source.waybill && ![String(order.id), String(order.order_number)].includes(source.order_id)) returnFail('CSV Order ID does not match the waybill order.');
      parcel.items.forEach(item => inventoryReturnTarget(products, item));
    } catch (error) { parcel.review_reason = (error as Error).message; }
    return parcel;
  });
  return { ...parsed, uploaded_at: new Date().toISOString(), uploaded_by: actor, parcels, receipts: [] };
};
export const pendingReturnQty = (item: ReturnItem) => Math.max(0, item.expected_qty - item.good_qty - item.damaged_qty);
export const parcelReturnStatus = (parcel: ReturnParcel) => {
  if (parcel.review_reason) return 'Needs review';
  if (parcel.items.length && parcel.items.every(item => !pendingReturnQty(item))) return parcel.items.some(item => item.damaged_qty) ? 'Received with damage' : 'Received';
  if (parcel.items.some(item => item.good_qty + item.damaged_qty > 0)) return 'Part received';
  if (parcel.items.some(item => item.not_received)) return 'Not received';
  return parcel.scanned_at ? 'Scanned / unchecked' : 'Awaiting parcel';
};
export const summarizeReturnSheet = (sheet: ReturnSheet) => {
  const items = sheet.parcels.flatMap(parcel => parcel.items);
  return { id: sheet.id, filename: sheet.filename, uploaded_at: sheet.uploaded_at, uploaded_by: sheet.uploaded_by,
    parcels: sheet.parcels.length, scanned_parcels: sheet.parcels.filter(parcel => parcel.scanned_at).length,
    completed_parcels: sheet.parcels.filter(parcel => parcel.items.length && parcel.items.every(item => !pendingReturnQty(item)) && !parcel.review_reason).length,
    review_parcels: sheet.parcels.filter(parcel => parcel.review_reason).length,
    expected_qty: items.reduce((sum, item) => sum + item.expected_qty, 0),
    good_qty: items.reduce((sum, item) => sum + item.good_qty, 0), damaged_qty: items.reduce((sum, item) => sum + item.damaged_qty, 0),
    pending_qty: items.reduce((sum, item) => sum + pendingReturnQty(item), 0),
    confirmed_items: items.filter(item => item.good_qty + item.damaged_qty > 0).length,
    fully_received_items: items.filter(item => !pendingReturnQty(item)).length, item_lines: items.length };
};
export const sheetsFromRows = (rows: readonly any[]): ReturnSheet[] => rows.filter(row => String(row.key).startsWith(RETURN_SHEET_PREFIX)).map(row => row.payload);
export const sharedReturnInventory = (rows: readonly any[]) => {
  const sheets = sheetsFromRows(rows);
  const stockHistory = sheets.flatMap(sheet => sheet.receipts.flatMap(receipt => receipt.stock_history));
  const returnRecords: ReturnRecord[] = sheets.flatMap(sheet => sheet.parcels.filter(parcel => parcel.checked_at && parcel.order_id).map(parcel => ({
    id: RETURN_SHEET_PREFIX + sheet.id + ':' + parcel.waybill, order_id: parcel.order_id!, order_number: parcel.order_number!, waybill_number: parcel.waybill,
    checked_at: parcel.checked_at!, checked_by: parcel.checked_by || '', status: parcel.items.every(item => !pendingReturnQty(item) && !item.damaged_qty) ? 'Verified' : 'Issue Found',
    items: parcel.items.map(item => ({ product_id: item.product_id, variant_id: item.variant_id, sku: item.sku, product_name: item.name,
      expected_qty: item.expected_qty, good_qty: item.good_qty, damaged_qty: item.damaged_qty, missing_qty: pendingReturnQty(item) })), notes: parcel.notes,
  })));
  return { stockHistory, returnRecords };
};

export const receiveReturnParcel = (sheet: ReturnSheet, parcel: ReturnParcel, input: any, products: any[], order: any, actor: string) => {
  const operationId = String(input.operation_id || '');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(operationId)) returnFail('A receipt operation ID is required.', 400);
  if (!Array.isArray(input.items) || input.items.length !== parcel.items.length) returnFail('Check every expected item in this parcel.', 400);
  const seen = new Set<string>();
  const entries = input.items.map((entry: any) => {
    const id = String(entry.id || '');
    if (seen.has(id) || !parcel.items.some(item => item.id === id)) returnFail('Invalid or duplicate parcel item.', 400);
    seen.add(id);
    if (typeof entry.not_received !== 'boolean') returnFail('Choose received or not received for every item.', 400);
    return { id, good_qty: integer(entry.good_qty, 'good quantity'), damaged_qty: integer(entry.damaged_qty, 'damaged quantity'), not_received: entry.not_received };
  }).sort((a: any, b: any) => a.id.localeCompare(b.id));
  const notes = String(input.notes || '').trim().slice(0,2000);
  const fingerprint = JSON.stringify({ waybill: parcel.waybill, expected_revision: input.expected_revision, items: entries, notes });
  const previous = sheet.receipts.find(receipt => receipt.operation_id === operationId);
  if (previous) {
    if (previous.fingerprint !== fingerprint) returnFail('A saved receipt ID cannot be used for different quantities.');
    return { sheet, products, unchanged: true, receipt: previous };
  }
  if (parcel.review_reason) returnFail(parcel.review_reason);
  if (!parcel.scanned_at) returnFail('Scan the parcel before checking its items.');
  if (input.expected_revision !== parcel.revision) returnFail('Another staff member checked this parcel. Reload it before saving quantities.');
  if (!order || String(order.id) !== parcel.order_id) returnFail('The matched order is unavailable.');
  eligible(order, parcel.waybill, sheet.id);
  const expected = physicalReturnItems(order);
  if (JSON.stringify(expected.map(item => [item.id,item.expected_qty]).sort()) !== JSON.stringify(parcel.items.map(item => [item.id,item.expected_qty]).sort())) returnFail('Order items changed after upload. Review the order before receiving.');
  const now = new Date().toISOString(); const history: StockHistory[] = [];
  const replacements = new Map<string, any>();
  const items = parcel.items.map(item => {
    const entry = entries.find((value: any) => value.id === item.id)!;
    const good = item.good_qty + entry.good_qty, damaged = item.damaged_qty + entry.damaged_qty;
    if (good + damaged > item.expected_qty) returnFail('Received quantity exceeds the remaining quantity for ' + item.name + '.');
    if (entry.not_received && (entry.good_qty || entry.damaged_qty)) returnFail('An item cannot be both received now and not received now.', 400);
    if (pendingReturnQty(item) && !entry.not_received && !entry.good_qty && !entry.damaged_qty) returnFail('Enter the received quantity or mark not received for ' + item.name + '.',400);
    if (entry.good_qty) {
      const original = replacements.get(item.product_id) || products.find(product => String(product.id) === item.product_id);
      const { product, target } = inventoryReturnTarget(original ? [original] : [], item);
      const before = Number(target.stock_quantity || 0), after = before + entry.good_qty;
      if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(after)) returnFail('Current item stock is invalid.');
      const updated = { ...target, stock_quantity: after, status: 'Active' };
      if (item.variant_id) {
        const variants = product.variants.map((variant: any) => String(variant.id) === item.variant_id ? updated : variant);
        replacements.set(item.product_id, { ...product, variants, stock_quantity: variants.reduce((sum: number, variant: any) => sum + Number(variant.stock_quantity || 0), 0), status: 'Active' });
      } else replacements.set(item.product_id, updated);
      history.push({ id: 'return-stock:' + sheet.id + ':' + operationId + ':' + item.id, product_id: item.product_id, variant_id: item.variant_id,
        product_name: item.name, change_type: 'Increase', quantity: entry.good_qty, previous_stock: before, new_stock: after,
        reason: 'Return Sheet ' + sheet.id + ' / ' + parcel.waybill + ' / ' + parcel.order_number, performed_by: actor, created_at: now });
    }
    return { ...item, good_qty: good, damaged_qty: damaged, not_received: entry.not_received && good + damaged < item.expected_qty };
  });
  const receipt: ReturnReceipt = { operation_id: operationId, fingerprint, waybill: parcel.waybill, actor, at: now, stock_history: history,
    good_qty: entries.reduce((sum: number, entry: any) => sum + entry.good_qty, 0), damaged_qty: entries.reduce((sum: number, entry: any) => sum + entry.damaged_qty, 0) };
  return { sheet: { ...sheet, parcels: sheet.parcels.map(value => value === parcel ? { ...parcel, items, revision: parcel.revision + 1, checked_at: now, checked_by: actor, notes } : value), receipts: [...sheet.receipts, receipt] },
    products: replacements.size ? products.map(product => replacements.get(String(product.id)) || product) : products, unchanged: false, receipt };
};
