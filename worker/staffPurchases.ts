import { canonicalJson } from '../src/lib/confirmCsvSave';
import { normalizedProductType, variantOptionSummary } from '../src/lib/productVariants';
import { parseStaffPurchase, STAFF_PURCHASE_PREFIX, StaffPurchaseError, type StaffPurchase, type StaffPurchaseItem } from '../src/lib/staffPurchases';
import { returnPackingInProgress } from '../src/lib/returnSheets';
import { cancellationInProgress } from './r2OrderCancellation';
import type { ReturnStorage } from './r2ReturnSheets';

type Row = Record<string, any>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (message: string, status = 409): never => { throw new StaffPurchaseError(message, status); };
const localDay = (at: string) => new Date(Date.parse(at) + 330 * 60_000).toISOString().slice(0, 10);

export const staffPurchasesHandler = async (request: Request, storage: Pick<ReturnStorage, 'readAdmin' | 'changeAdmin'>, user: Row): Promise<Response> => {
  try {
    const permissions: string[] = user.permissions || [];
    if (user.role !== 'admin' && (!permissions.includes('stock') || request.method !== 'GET' && permissions.includes('level:stock:view')))
      return json({ error: request.method === 'GET' ? 'Inventory access is required.' : 'Inventory edit access is required.' }, 403);
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams, search = (query.get('search') || '').trim().toLowerCase();
      const from = query.get('from') || '', to = query.get('to') || '', page = Number(query.get('page') || 1);
      if (search.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000 ||
          [from, to].some(value => value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) || from && to && from > to)
        return json({ error: 'Check the search, dates and page.' }, 400);
      const purchases = (await storage.readAdmin()).filter(row => String(row.key).startsWith(STAFF_PURCHASE_PREFIX) && row.payload?.phase === 'complete')
        .map(row => row.payload as StaffPurchase).filter(purchase => {
          const day = localDay(purchase.created_at);
          return (!from || day >= from) && (!to || day <= to) && (!search || [purchase.staff_name, purchase.purchase_number, purchase.notes,
            ...purchase.items.flatMap(item => [item.sku, item.product_name, item.variant_name || ''])].join(' ').toLowerCase().includes(search));
        }).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.operation_id.localeCompare(a.operation_id));
      return json({ ok: true, purchases: purchases.slice((page - 1) * 30, page * 30), total: purchases.length, page, page_size: 30,
        total_amount: purchases.reduce((sum, purchase) => sum + Math.round(purchase.total_amount * 100), 0) / 100,
        total_quantity: purchases.reduce((sum, purchase) => sum + purchase.items.reduce((qty, item) => qty + item.quantity, 0), 0) });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const raw = await request.text();
    if (raw.length > 50_000) return json({ error: 'Staff purchase request is too large.' }, 413);
    let body: any; try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid staff purchase request.' }, 400); }
    const input = parseStaffPurchase(body), key = STAFF_PURCHASE_PREFIX + input.operation_id, identity = canonicalJson(input);
    const result = await storage.changeAdmin<{ purchase: StaffPurchase; already_saved: boolean }>(rows => {
      const previous = rows.find(row => row.key === key);
      if (previous) {
        if (previous.payload.request_identity !== identity || previous.payload.created_by_id !== String(user.id)) fail('This purchase operation already belongs to different details.');
        return { rows, result: { purchase: previous.payload as StaffPurchase, already_saved: true } };
      }
      if (returnPackingInProgress(rows) || cancellationInProgress([...rows])) fail('A stock batch is finishing. Retry this saved purchase after it finishes.');
      const catalog = rows.find(row => row.key === 'storefront-state-v1');
      if (!Array.isArray(catalog?.payload?.products)) fail('The stock catalog is unavailable.', 503);
      const products = catalog.payload.products as Row[], changed = new Map<string, Row>(), now = new Date().toISOString();
      const purchase_number = 'STAFF-' + localDay(now).replace(/-/g, '') + '-' + input.operation_id.slice(0, 12).toUpperCase();
      const actor = String(user.display_name || user.username || user.id), stock_history: StaffPurchase['stock_history'] = [];
      const items: StaffPurchaseItem[] = input.items.map((item, index) => {
        const matches = products.filter(product => product.id === item.product_id);
        if (matches.length !== 1) fail('An item is no longer available. Refresh the stock list.');
        const original = changed.get(item.product_id) || matches[0], type = normalizedProductType(original as any);
        if (type === 'bundle') fail('Choose the individual items and their exact colours for a staff purchase.');
        const variants: Row[] = Array.isArray(original.variants) ? original.variants : [];
        const variant = type === 'variant' ? variants.filter(value => value.id === item.variant_id) : [];
        if (type === 'variant' && variant.length !== 1 || type !== 'variant' && item.variant_id) fail('Select the exact colour / variant for each item.');
        const target = type === 'variant' ? variant[0] : original, before = Number(target.stock_quantity ?? 0);
        const sku = String(target.sku || original.sku || ''), variant_name = type === 'variant' ? variantOptionSummary(target as any) : '';
        if (!Number.isSafeInteger(before) || before < item.quantity || target.return_stock_debt) fail('Insufficient available stock for ' + sku + '. Refresh and check the quantity.');
        const after = before - item.quantity, updatedTarget = { ...target, stock_quantity: after, status: after > 0 ? 'Active' : 'Out of Stock' };
        if (type === 'variant') {
          const updatedVariants = variants.map(value => value === target ? updatedTarget : value), total = updatedVariants.reduce((sum, value) => sum + Number(value.stock_quantity || 0), 0);
          changed.set(original.id, { ...original, variants: updatedVariants, stock_quantity: total, status: total > 0 ? 'Active' : 'Out of Stock' });
        } else changed.set(original.id, updatedTarget);
        const product_name = String(original.name_en || original.name_si || sku);
        stock_history.push({ id: key + ':' + index + ':' + (item.variant_id || item.product_id), product_id: item.product_id, ...(item.variant_id ? { variant_id: item.variant_id } : {}),
          product_name: product_name + (variant_name ? ' - ' + variant_name : ''), change_type: 'Decrease', quantity: item.quantity, previous_stock: before, new_stock: after,
          reason: 'Staff purchase ' + purchase_number + ' • ' + input.staff_name, performed_by: actor, created_at: now });
        return { ...item, sku, product_name, ...(variant_name ? { variant_name } : {}), line_total: Math.round(item.unit_price * 100) * item.quantity / 100 };
      });
      const purchase = { ...input, phase: 'complete' as const, purchase_number, items, total_amount: items.reduce((sum, item) => sum + Math.round(item.line_total * 100), 0) / 100,
        created_at: now, created_by: actor, created_by_id: String(user.id), request_identity: identity, stock_history };
      const nextCatalog = { ...catalog, payload: { ...catalog.payload, products: products.map(product => changed.get(product.id) || product),
        version: Number(catalog.payload.version || 0) + 1, updated_at: now }, updated_at: now };
      // Receipt, exact stock and audit become visible under the same conditional
      // manifest commit. No customer order, courier number or invoice is created.
      return { rows: [...rows.map(row => row === catalog ? nextCatalog : row), { key, payload: purchase, updated_at: now }], result: { purchase, already_saved: false } };
    });
    return json({ ok: true, ...result });
  } catch (error: any) {
    return json({ error: error.message || 'Staff purchase could not be confirmed. Retry the saved purchase.' }, error instanceof StaffPurchaseError ? error.status : 503);
  }
};
