import type { Order } from '../src/types';
import { facebookAdCode, type FacebookAdCost } from '../src/lib/facebookProfitAds';
import { cloudflareDataFetch } from './cloudflareData';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const metaId = (value: unknown) => typeof value === 'string' && /^\d{1,64}$/.test(value);
const leadActions = (actions: unknown) => Array.isArray(actions) ? actions.reduce((sum, action: any) => {
  const type = String(action?.action_type || '').toLowerCase();
  return /^(?:lead|leads|onsite_conversion\.lead_grouped|onsite_conversion\.lead|offsite_conversion\.fb_pixel_lead)$/.test(type)
    ? sum + (Number.isFinite(Number(action?.value)) ? Number(action.value) : 0) : sum;
}, 0) : 0;
const accountDay = (timestamp: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(value => value.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/** Pulls live ad-level/day spend from Meta and matches selected saved lead orders to their original Ad IDs. */
export async function profitFacebookAdInsights(request: Request, env: Record<string, any>, user: { role: string; permissions?: string[] },
  readOrders: () => Promise<Order[]>, fetcher: typeof fetch = cloudflareDataFetch) {
  if (user.role !== 'admin' && !user.permissions?.includes('profit_report')) return json({ error: 'Profit Report access required.' }, 403);
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const body = await request.json().catch(() => null) as any;
  if (!Array.isArray(body?.order_ids) || !body.order_ids.length || body.order_ids.length > 500
    || !body.order_ids.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 200)
    || new Set(body.order_ids).size !== body.order_ids.length
    || !Array.isArray(body?.known_codes) || body.known_codes.length > 2000
    || !body.known_codes.every((code: unknown) => typeof code === 'string' && code.length <= 120))
    return json({ error: 'Choose 1 to 500 unique Facebook order IDs and a valid catalog-code list.' }, 400);
  const adsToken = String(env.META_ADS_ACCESS_TOKEN || env.META_PAGE_ACCESS_TOKEN || '');
  const version = String(env.META_GRAPH_API_VERSION || '');
  const rawAccountId = String(env.META_AD_ACCOUNT_ID || '').replace(/^act_/i, '');
  if (!adsToken || !/^v\d+\.\d+$/.test(version) || !metaId(rawAccountId))
    return json({ error: 'Facebook Ads auto-fetch needs META_AD_ACCOUNT_ID and a Meta Ads token with ads_read permission.' }, 503);

  const orders = await readOrders();
  const selected = body.order_ids.map((id: string) => orders.find(order => order.id === id));
  if (selected.some((order: Order | undefined) => !order || order.order_source !== 'Facebook Ads' || !metaId(String(order.platform_lead_id || ''))))
    return json({ error: 'Each selected order must be a saved Facebook order with its original numeric Lead ID.' }, 400);

  const graph = async (path: string, params: Record<string, string>, accessToken = adsToken) => {
    const url = new URL(`https://graph.facebook.com/${version}${path ? `/${path}` : ''}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(9000) });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      const code = Number.isInteger(data?.error?.code) ? ` (#${data.error.code})` : '';
      throw new Error(`Meta Ads API could not read this account${code}. Check ad account access and ads_read permission.`);
    }
    return data;
  };

  try {
    const account = await graph(`act_${rawAccountId}`, { fields: 'account_id,currency,timezone_name' }, adsToken);
    if (String(account.account_id || '') !== rawAccountId || !account.timezone_name || account.currency !== 'LKR')
      return json({ error: `Connected Meta ad account must be the intended LKR account. Meta returned currency ${String(account.currency || 'unknown')}.` }, 409);

    // New Facebook orders already save their original Ad ID with the lead.
    // Use that first: ads_read can read spend, while querying lead records also
    // needs Page lead access and caused #100 for otherwise valid ad accounts.
    const verifiedByOrder = new Map<string, { order: Order; adId: string; adsetId: string; campaignId: string; createdAt: string; day: string }>();
    const unresolved: Order[] = [];
    for (const order of selected as Order[]) {
      const savedAdId = String(order.platform_ad_id || '').trim();
      const createdAt = String(order.platform_lead_created_at || order.created_at || '');
      if (metaId(savedAdId) && Number.isFinite(Date.parse(createdAt))) {
        verifiedByOrder.set(order.id, {
          order, adId: savedAdId,
          adsetId: metaId(String(order.platform_adset_id || '')) ? String(order.platform_adset_id) : '',
          campaignId: metaId(String(order.platform_campaign_id || '')) ? String(order.platform_campaign_id) : '',
          createdAt, day: accountDay(createdAt, account.timezone_name),
        });
      } else unresolved.push(order);
    }
    if (unresolved.length && !String(env.META_PAGE_ACCESS_TOKEN || ''))
      return json({ error: `${unresolved.length} selected Facebook order(s) have no saved Ad ID. Connect a Page token with lead access, or restore those orders' original Ad IDs.` }, 503);
    const pageToken = String(env.META_PAGE_ACCESS_TOKEN || '');
    for (let start = 0; start < unresolved.length; start += 20) {
      const batch = unresolved.slice(start, start + 20);
      const data = await graph('', { ids: batch.map(order => order.platform_lead_id!).join(','), fields: 'id,created_time,ad_id,adset_id,campaign_id,is_organic' }, pageToken);
      const results = batch.map(order => {
        const lead = data?.[String(order.platform_lead_id)];
        if (lead?.error || lead?.id !== order.platform_lead_id || !Number.isFinite(Date.parse(lead?.created_time)) || !metaId(lead?.ad_id)
          || !metaId(lead?.adset_id) || !metaId(lead?.campaign_id))
          throw new Error(lead?.is_organic ? `${order.order_number}: lead is organic and has no paid Ad ID.` : `${order.order_number}: Meta did not return a complete Lead ID → Ad ID match.`);
        return { order, adId: lead.ad_id, adsetId: lead.adset_id, campaignId: lead.campaign_id, createdAt: lead.created_time,
          day: accountDay(lead.created_time, account.timezone_name) };
      });
      for (const result of results) verifiedByOrder.set(result.order.id, result);
    }
    const verified = (selected as Order[]).map(order => verifiedByOrder.get(order.id)!);
    const days = verified.map(row => row.day).sort();
    const leadSince = days[0], until = days[days.length - 1];
    // Include the previous seven delivery days so an ad impression/click that
    // produced a later Lead ID is included in the same per-ad acquisition pool.
    const since = new Date(Date.parse(`${leadSince}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    const span = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86400000 + 1;
    if (span > 90) return json({ error: 'Selected Facebook leads span more than 90 days. Run Profit Report on smaller date batches.' }, 413);

    const params = new URLSearchParams({
      fields: 'account_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,actions,date_start,date_stop',
      level: 'ad', time_increment: '1', action_report_time: 'conversion', limit: '500', time_range: JSON.stringify({ since, until }),
    });
    const dailyRows: Array<{ adId: string; name: string; adSet: string; campaign: string; spendCents: number; leads: number; code: string | null }> = [];
    let next: string | null = `https://graph.facebook.com/${version}/act_${rawAccountId}/insights?${params.toString()}`;
    let pages = 0;
    while (next) {
      if (++pages > 100) throw new Error('Meta returned too many ad rows for this date range. Narrow the waybill batch and retry.');
      const url = new URL(next);
      if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com') throw new Error('Meta returned an invalid Insights pagination link.');
      url.searchParams.delete('access_token');
      const response = await fetcher(url, { headers: { authorization: `Bearer ${adsToken}` }, signal: AbortSignal.timeout(12000) });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) {
        const code = Number.isInteger(data?.error?.code) ? ` (#${data.error.code})` : '';
        throw new Error(`Meta could not return ad spend${code}. Check ads_read permission and Ad Account ID.`);
      }
      if (!Array.isArray(data.data)) throw new Error('Meta returned an incomplete Ads Insights report.');
      for (const row of data.data) {
        if (!metaId(row.ad_id) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date_start) || row.date_start !== row.date_stop)
          throw new Error('Meta returned an invalid ad/day identity; no profit was calculated.');
        const spend = Number(row.spend || 0), leads = leadActions(row.actions);
        if (!Number.isFinite(spend) || spend < 0 || !Number.isSafeInteger(leads) || leads < 0)
          throw new Error('Meta returned invalid ad spend / lead results; no profit was calculated.');
        let code: string | null;
        try { code = facebookAdCode(`${row.ad_name || ''} ${row.adset_name || ''} ${row.campaign_name || ''}`, body.known_codes); }
        catch (error: any) { throw new Error(`Meta ad ${row.ad_id}: ${error.message || 'item code is ambiguous.'}`); }
        dailyRows.push({ adId: row.ad_id, name: String(row.ad_name || row.campaign_name || ''), adSet: String(row.adset_name || ''),
          campaign: String(row.campaign_name || ''), spendCents: Math.round(spend * 100), leads: code || leads > 0 ? leads : 0, code });
        if (dailyRows.length > 20000) throw new Error('Meta returned too many ad rows. Narrow the waybill batch and retry.');
      }
      next = typeof data.paging?.next === 'string' ? data.paging.next : null;
    }

    const totalsByAd = new Map<string, (typeof dailyRows)[number]>();
    for (const daily of dailyRows) {
      const existing = totalsByAd.get(daily.adId);
      if (existing) { existing.spendCents += daily.spendCents; existing.leads += daily.leads; }
      else totalsByAd.set(daily.adId, { ...daily });
    }
    const rows: FacebookAdCost[] = [...totalsByAd.values()].map(row => ({ campaign: row.name || row.campaign, adSet: row.adSet,
      entityId: row.adId, level: 'ad', code: row.code, from: since, to: until, spend: row.spendCents / 100, leads: row.leads }));
    const matchedRows = new Set(rows.map(row => row.entityId));
    const missing = verified.filter(row => !matchedRows.has(row.adId));
    if (missing.length) return json({ error: `Meta spend report did not include ${missing.length} selected Lead ID → Ad ID/date match(es). No report was calculated; refresh Insights and retry.` }, 409);
    const totalSpend = Math.round(rows.reduce((sum, row) => sum + Math.round(row.spend * 100), 0)) / 100;
    const itemSpend = Math.round(rows.filter(row => row.code).reduce((sum, row) => sum + Math.round(row.spend * 100), 0)) / 100;
    const commercialSpend = Math.round((totalSpend - itemSpend) * 100) / 100;
    return json({ ok: true, account_id: rawAccountId, currency: account.currency, timezone: account.timezone_name, since, until,
      verified_leads: verified.length, verified: verified.map(row => ({ order_id: row.order.id, lead_id: row.order.platform_lead_id,
        created_at: row.createdAt, ad_id: row.adId, adset_id: row.adsetId, campaign_id: row.campaignId, ad_day: row.day })),
      fileName: `Facebook API · ${rawAccountId} · ${since} to ${until}`,
      rows, periods: [...new Map(rows.map(row => [`${row.from}|${row.to}`, { from: row.from, to: row.to }])).values()],
      itemSpend, commercialSpend, totalSpend });
  } catch (error: any) {
    return json({ error: error?.name === 'TimeoutError' ? 'Meta Ads API timed out. Retry this report.' : error?.message || 'Meta Ads API could not calculate this report.' }, 503);
  }
}
