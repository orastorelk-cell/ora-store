import type { Order } from '../src/types';
import { cloudflareDataFetch } from './cloudflareData';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const metaId = (value: unknown) => typeof value === 'string' && /^\d{1,64}$/.test(value);
/** Read only. Uses the existing Page connection; never saves ad spend or tokens. */
export async function profitFacebookLeadMatch(request: Request, env: Record<string, any>, user: { role: string; permissions?: string[] },
  readOrders: () => Promise<Order[]>, fetcher: typeof fetch = cloudflareDataFetch) {
  if (user.role !== 'admin' && !user.permissions?.includes('profit_report')) return json({ error: 'Profit Report access required.' }, 403);
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const body = await request.json().catch(() => null) as any;
  if (!Array.isArray(body?.order_ids) || !body.order_ids.length || body.order_ids.length > 5
    || !body.order_ids.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 200)
    || new Set(body.order_ids).size !== body.order_ids.length) return json({ error: 'Check one to five unique saved order IDs per request.' }, 400);
  if (!env.META_PAGE_ACCESS_TOKEN || !/^v\d+\.\d+$/.test(String(env.META_GRAPH_API_VERSION || ''))) return json({ error: 'The existing Facebook Page connection is not configured for lead verification.' }, 503);
  const orders = await readOrders();
  const selected = body.order_ids.map((id: string) => orders.find(order => order.id === id));
  if (selected.some((order: Order | undefined) => !order || order.order_source !== 'Facebook Ads' || !metaId(order.platform_lead_id))) return json({ error: 'Each order must be a saved Facebook order with its original numeric Lead ID.' }, 400);
  const results = await Promise.all(selected.map(async (order: Order) => {
    try {
      const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${order.platform_lead_id}`);
      url.searchParams.set('fields', 'id,created_time,ad_id,adset_id,campaign_id,is_organic');
      const response = await fetcher(url, { headers: { authorization: `Bearer ${env.META_PAGE_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(7000) });
      const data: any = await response.json();
      if (!response.ok || data?.error) throw new Error(`Facebook could not verify this lead${Number.isInteger(data?.error?.code) ? ` (#${data.error.code})` : ''}. Check Page / ads permissions.`);
      if (data.id !== order.platform_lead_id || !Number.isFinite(Date.parse(data.created_time))
        || !metaId(data.ad_id) || !metaId(data.adset_id) || !metaId(data.campaign_id)) {
        throw new Error(data?.is_organic === true ? 'Organic lead: no paid ad attribution. Review this order separately.' : 'Facebook did not return complete ad IDs. The current CSV code-based estimate remains in use.');
      }
      return { order_id: order.id, lead_id: data.id, created_at: data.created_time, ad_id: data.ad_id, adset_id: data.adset_id, campaign_id: data.campaign_id };
    } catch (error: any) {
      return { order_id: order.id, lead_id: order.platform_lead_id, error: error?.name === 'TimeoutError' ? 'Facebook verification timed out. Retry this check.' : error.message || 'Facebook verification failed.' };
    }
  }));
  return json({ ok: true, results });
}
