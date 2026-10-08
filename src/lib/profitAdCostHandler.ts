import { FACEBOOK_AD_LEDGER_KEY, FacebookAdError, mergeFacebookAdLedger, parseFacebookAdCostCsv, readFacebookAdLedger } from './facebookProfitAds';

type Row = Record<string, any>;
export interface ProfitAdsStorage {
  readAdmin: () => Promise<readonly Row[]>;
  changeAdmin: <T>(change: (rows: readonly Row[]) => { rows: readonly Row[]; result: T }) => Promise<T>;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** Private finance history, stored separately from public settings and order snapshots. */
export async function profitAdCostHandler(request: Request, storage: ProfitAdsStorage, user: Row): Promise<Response> {
  try {
    if (user.role !== 'admin' && !(user.permissions || []).includes('profit_report')) return json({ error: 'Profit Report permission required.' }, 403);
    if (request.method === 'GET') {
      const rows = await storage.readAdmin();
      return json({ ledger: readFacebookAdLedger(rows.find(row => row.key === FACEBOOK_AD_LEDGER_KEY)?.payload) });
    }
    if (request.method !== 'POST') return json({ error: 'Use GET to read history or POST to import a CSV.' }, 405);
    if (user.role !== 'admin' && (user.permissions || []).includes('level:profit_report:view')) return json({ error: 'Profit Report edit permission required.' }, 403);
    const raw = await request.text();
    if (raw.length > 2_500_000) return json({ error: 'Choose a Facebook CSV report smaller than 2 MB.' }, 413);
    let body: any; try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid ad-cost import.' }, 400); }
    if (typeof body?.csv !== 'string' || typeof body?.fileName !== 'string' || !body.fileName.trim()
      || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) return json({ error: 'CSV text, file name and current advertising version are required.' }, 400);
    const at = new Date().toISOString();
    const catalog = (await storage.readAdmin()).find(row => row.key === 'storefront-state-v1')?.payload?.products || [];
    const codes = catalog.flatMap((product: any) => [product.sku, ...(product.variants || []).map((variant: any) => variant.sku)]).filter((code: unknown) => typeof code === 'string');
    const incoming = parseFacebookAdCostCsv(body.csv, codes);
    const saved = await storage.changeAdmin(rows => {
      const old = rows.find(row => row.key === FACEBOOK_AD_LEDGER_KEY);
      const result = mergeFacebookAdLedger(readFacebookAdLedger(old?.payload), incoming, { expectedVersion: body.expectedVersion,
        fileName: body.fileName, importedAt: at, importedBy: String(user.id || user.username || 'Admin') });
      if (result.unchanged) return { rows, result };
      const replacement = { ...old, key: FACEBOOK_AD_LEDGER_KEY, payload: result.ledger, updated_at: at };
      return { rows: old ? rows.map(row => row === old ? replacement : row) : [...rows, replacement], result };
    });
    return json({ ok: true, ...saved });
  } catch (error: any) {
    return json({ error: error.message || 'Advertising history could not be saved. Retry the same CSV.' }, error instanceof FacebookAdError ? error.status : 503);
  }
}
