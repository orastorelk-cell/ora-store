import { FACEBOOK_AD_LEDGER_KEY, FacebookAdError, emptyFacebookAdLedger } from './facebookProfitAds';

type Row = Record<string, any>;
export interface ProfitAdsStorage {
  readAdmin: () => Promise<readonly Row[]>;
  changeAdmin: <T>(change: (rows: readonly Row[]) => { rows: readonly Row[]; result: T }) => Promise<T>;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** Report inputs only. Facebook expenses are never loaded or stored as history. */
export async function profitAdCostHandler(request: Request, storage: ProfitAdsStorage, user: Row,
  readPurchases?: () => Promise<readonly Row[]>): Promise<Response> {
  try {
    if (user.role !== 'admin' && !(user.permissions || []).includes('profit_report')) return json({ error: 'Profit Report permission required.' }, 403);
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      if (query.get('reportOnly') !== '1') return json({ error: 'Profit Report now uses a new CSV flow. Reload this page, upload all payment-batch waybills and select the new Facebook CSV.' }, 410);
      const ledger = emptyFacebookAdLedger();
      const purchases = query.get('includePurchases') === '1' ? await readPurchases?.() || [] : undefined;
      return json({ ledger, reportOnly: true,
        ...(purchases ? { purchases: purchases.map(({ id, po_number, product_id, product_name, sku, variant_id, variant_name, variant_sku,
          quantity_added, unit_buying_price, total_cost, created_at }) => ({ id, po_number, product_id, product_name, sku, variant_id,
          variant_name, variant_sku, quantity_added, unit_buying_price, total_cost, created_at, supplier_name: '', performed_by: '' })) } : {}) });
    }
    if (request.method !== 'POST') return json({ error: 'Use GET to read report inputs or POST to reset previous Facebook costs.' }, 405);
    if (user.role !== 'admin' && (user.permissions || []).includes('level:profit_report:view')) return json({ error: 'Profit Report edit permission required.' }, 403);
    const raw = await request.text();
    if (raw.length > 2_500_000) return json({ error: 'Choose a Facebook CSV report smaller than 2 MB.' }, 413);
    let body: any; try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid ad-cost import.' }, 400); }
    if (body?.action !== 'start-report') return json({ error: 'Facebook costs now belong only to the current report. Refresh Profit Report and select the new Facebook CSV; previous expenses cannot be saved again.' }, 410);
    const at = new Date().toISOString();
    const saved = await storage.changeAdmin(rows => {
      const old = rows.find(row => row.key === FACEBOOK_AD_LEDGER_KEY);
      if (old?.payload?.reportOnly === true && Array.isArray(old.payload.rows) && old.payload.rows.length === 0) return { rows, result: { cleared: true, unchanged: true } };
      const version = Number.isSafeInteger(old?.payload?.version) && old.payload.version >= 0 && old.payload.version < Number.MAX_SAFE_INTEGER ? old.payload.version : 0;
      const replacement = { ...old, key: FACEBOOK_AD_LEDGER_KEY, payload: { ...emptyFacebookAdLedger(), version: version + 1, reportOnly: true }, updated_at: at };
      return { rows: old ? rows.map(row => row === old ? replacement : row) : [...rows, replacement], result: { cleared: true, unchanged: false } };
    });
    return json({ ok: true, reportOnly: true, ...saved });
  } catch (error: any) {
    return json({ error: error.message || 'Previous Facebook costs could not be reset. Retry the reset.' }, error instanceof FacebookAdError ? error.status : 503);
  }
}
