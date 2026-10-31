import type { Order } from '../types';
import { facebookAdCode, parseFacebookAdCostCsv, type FacebookAdCost } from './facebookProfitAds';
import { isFinalProfitOrder, isReturnedProfitOrder, profitSystemDay, savedProfitPaymentKind, type PaidWaybillProfitReport } from './paidWaybillProfit';

const cents = (amount: number) => Math.round(amount * 100);
export interface CurrentFacebookCsv {
  fileName: string; rows: FacebookAdCost[]; periods: Array<{ from: string; to: string }>;
  itemSpend: number; commercialSpend: number; totalSpend: number;
}
/** Current input only: historical expense ledgers are never accepted. */
export function currentFacebookCsv(csv: string, fileName: string, knownCodes: string[] = []): CurrentFacebookCsv {
  const rows = parseFacebookAdCostCsv(csv, knownCodes);
  const periods = [...new Map(rows.map(row => [`${row.from}|${row.to}`, { from: row.from, to: row.to }])).values()]
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const item = rows.filter(row => row.code).reduce((sum, row) => sum + cents(row.spend), 0);
  const commercial = rows.filter(row => !row.code).reduce((sum, row) => sum + cents(row.spend), 0);
  return { fileName: fileName.slice(0, 200), rows, periods, itemSpend: item / 100, commercialSpend: commercial / 100, totalSpend: (item + commercial) / 100 };
}
/** Validate the normalized ad/day rows returned by the server-only Meta Insights connection. */
export function currentFacebookInsights(value: any): CurrentFacebookCsv {
  if (!value || value.currency !== 'LKR' || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 20000
    || typeof value.fileName !== 'string' || !value.fileName.startsWith('Facebook API · ')) throw new Error('Meta returned an incomplete ad-cost report. No profit was calculated.');
  const rows: FacebookAdCost[] = value.rows.map((row: any, index: number) => {
    if (!row || row.level !== 'ad' || !/^\d{1,64}$/.test(String(row.entityId || ''))
      || typeof row.campaign !== 'string' || typeof row.adSet !== 'string'
      || row.code !== null && (typeof row.code !== 'string' || !/^[A-Z0-9][A-Z0-9._-]{0,119}$/.test(row.code))
      || typeof row.from !== 'string' || typeof row.to !== 'string' || profitSystemDay(row.from) !== row.from
      || profitSystemDay(row.to) !== row.to || row.from > row.to
      || !Number.isFinite(row.spend) || row.spend < 0 || !Number.isSafeInteger(row.leads) || row.leads < 0)
      throw new Error(`Meta ad/day row ${index + 1} is invalid. No profit was calculated.`);
    return { campaign: row.campaign, adSet: row.adSet, entityId: row.entityId, level: 'ad', code: row.code,
      from: row.from, to: row.to, spend: Math.round(row.spend * 100) / 100, leads: row.leads };
  });
  const periods = [...new Map(rows.map(row => [`${row.from}|${row.to}`, { from: row.from, to: row.to }])).values()]
    .sort((a, b) => a.from.localeCompare(b.from));
  const cents = (items: FacebookAdCost[]) => items.reduce((sum, row) => sum + Math.round(row.spend * 100), 0);
  const itemSpend = cents(rows.filter(row => row.code)), totalSpend = cents(rows);
  return { fileName: value.fileName.slice(0, 200), rows, periods, itemSpend: itemSpend / 100,
    commercialSpend: (totalSpend - itemSpend) / 100, totalSpend: totalSpend / 100 };
}
export interface CurrentCsvOrderCost { item: number; commercial: number; total: number; match: string; leadId: string; }
export interface CurrentCsvAllocation {
  orderCosts: Map<string, CurrentCsvOrderCost>; assignedSpend: number; unassignedSpend: number; totalSpend: number;
  pendingSpend: number; otherSpend: number; unmatchedSpend: number;
  missingOrderIds: string[]; issues: string[]; warnings: string[];
  cohorts: Array<{ code: string; from: string; to: string; spend: number; csvLeads: number; leadsUsed: number; matched: number; selected: number; pending: number }>;
}
const note = (order: Order, label: string) => order.notes?.match(new RegExp('(?:^|[|\\n])\\s*' + label + ':\\s*([^|\\n]+)', 'i'))?.[1]?.trim() || '';
const entity = (order: Order, level: string) => level === 'ad' ? order.platform_ad_id || note(order, 'Ad ID')
  : level === 'adset' ? order.platform_adset_id || note(order, 'Ad Set ID') : order.platform_campaign_id || note(order, 'Campaign ID');
const isFacebook = (order: Order) => order.order_source === 'Facebook Ads' || /^FB-/i.test(order.order_number);
const pending = (order: Order) => !isFinalProfitOrder(order);

/** Allocate an average acquisition cost to unique leads, including pending ones.
 * Only selected paid/returned waybills are deducted. Every other cent stays in
 * an explicit reserve. Lead arrival dates, never payment dates, select a cohort. */
export function allocateCurrentCsvCosts(input: CurrentFacebookCsv, orders: Order[], report: PaidWaybillProfitReport): CurrentCsvAllocation {
  const selected = new Set(report.rows.filter(row => row.source === 'Facebook' && row.eligible && row.profit !== null && row.orderId).map(row => row.orderId!));
  const issues: string[] = [], warnings: string[] = [], orderCosts: CurrentCsvAllocation['orderCosts'] = new Map();
  const groups = new Map<string, { row: FacebookAdCost; spend: number; leads: number; orders: Order[]; denominator: number }>();
  // Ad-level rows can be matched directly by Ad ID even when the ad name has no
  // catalog code. Broader campaign/ad-set rows still need a product code.
  for (const row of input.rows.filter(row => row.code || row.level === 'ad' && row.entityId)) {
    const key = `${row.level}|${row.entityId || row.code}|${row.from}|${row.to}`;
    const group = groups.get(key);
    if (group) { group.spend += cents(row.spend); group.leads += row.leads; }
    else groups.set(key, { row, spend: cents(row.spend), leads: row.leads, orders: [], denominator: 0 });
  }
  const cohorts = [...groups.values()], known = [...new Set(cohorts.map(group => group.row.code).filter((code): code is string => Boolean(code)))];
  // When several ads use the same product code in the same account-date period,
  // orders without a saved Ad ID share that code/date pool. Exact Ad ID matches
  // stay with their own ad; only the remaining spend is shared by the fallback orders.
  const groupsByCodePeriod = new Map<string, typeof cohorts>();
  for (const group of cohorts) if (group.row.code) {
    const key = `${group.row.code}|${group.row.from}|${group.row.to}`;
    groupsByCodePeriod.set(key, [...(groupsByCodePeriod.get(key) || []), group]);
  }
  const codePools = new Map<string, { code: string; from: string; to: string; groups: typeof cohorts; orders: Order[] }>();
  for (const [key, groups] of groupsByCodePeriod) if (groups.length > 1) {
    const row = groups[0].row;
    codePools.set(key, { code: row.code!, from: row.from, to: row.to, groups, orders: [] });
  }
  const unique = new Map<string, Order[]>();
  for (const order of orders) {
    if (!isFacebook(order) || order.is_test_order || order.is_replacement_order) continue;
    const id = order.platform_lead_id?.trim().replace(/^l:/i, '');
    const key = id ? `lead:${id}` : `order:${order.id}`;
    unique.set(key, [...(unique.get(key) || []), order]);
  }
  let pendingCents = 0, otherCents = 0;
  const allCosts = new Map<string, CurrentCsvOrderCost>();
  for (const records of unique.values()) {
    if (records.length !== 1) {
      if (records.some(order => selected.has(order.id))) issues.push(`${records.map(order => order.order_number).join(' / ')}: the same Facebook Lead ID belongs to multiple orders.`);
      continue;
    }
    const order = records[0], day = order.platform_ad_account_day || profitSystemDay(order.platform_lead_created_at || order.created_at);
    let code: string | null = null;
    try {
      const original = note(order, 'Form');
      if (original) code = facebookAdCode(original, known);
      else {
        const codes = new Set((order.items || []).map(item => facebookAdCode(item.sku || item.main_sku || '', known)).filter(Boolean));
        if (codes.size === 1) code = [...codes][0]!;
      }
    } catch { /* Ambiguous identity remains unresolved; it is never charged at zero. */ }
    const inPeriod = cohorts.filter(group => day && day >= group.row.from && day <= group.row.to);
    const exact = inPeriod.filter(group => group.row.entityId && entity(order, group.row.level) === group.row.entityId);
    const matches = exact.length ? exact : inPeriod.filter(group => group.row.code && group.row.code === code
      && !(group.row.entityId && entity(order, group.row.level) && entity(order, group.row.level) !== group.row.entityId));
    if (matches.length === 1) {
      const group = matches[0]; group.orders.push(order);
      allCosts.set(order.id, { item: 0, commercial: 0, total: 0, match: exact.length ? `${group.row.level} ID` : 'product code / ad-account date', leadId: order.platform_lead_id || '' });
    } else if (matches.length > 1 && code) {
      const pool = codePools.get(`${code}|${matches[0].row.from}|${matches[0].row.to}`);
      if (pool && matches.length === pool.groups.length && matches.every(group => pool.groups.includes(group))) {
        pool.orders.push(order);
        allCosts.set(order.id, { item: 0, commercial: 0, total: 0, match: 'product code / ad-account date pool', leadId: order.platform_lead_id || '' });
      }
    }
  }
  // Meta Results can differ from saved unique leads because of attribution.
  // Never divide by selected paid orders alone, or allocate more than the spend.
  const split = (budget: number, denominator: number, list: Order[], field: 'item' | 'commercial') => {
    if (!denominator) return;
    const sorted = list.slice().sort((a, b) => (a.platform_lead_id || a.id).localeCompare(b.platform_lead_id || b.id));
    const base = Math.floor(budget / denominator), remainder = budget % denominator;
    sorted.forEach((order, index) => { allCosts.get(order.id)![field] += base + (index < remainder ? 1 : 0); });
  };
  for (const group of cohorts) {
    group.denominator = Math.max(group.leads, group.orders.length);
    if (group.orders.length > group.leads) warnings.push(`${group.row.code || `Ad ${group.row.entityId}`} (${group.row.from} to ${group.row.to}): ${group.leads} Meta results, ${group.orders.length} unique system leads; spend is shared across ${group.denominator} leads.`);
    split(group.spend, group.denominator, group.orders, group.row.code ? 'item' : 'commercial');
  }
  for (const pool of codePools.values()) {
    if (!pool.orders.length) continue;
    const spend = pool.groups.reduce((sum, group) => sum + group.spend, 0);
    const leads = pool.groups.reduce((sum, group) => sum + group.leads, 0);
    const alreadyAllocated = pool.groups.flatMap(group => group.orders)
      .reduce((sum, order) => sum + (allCosts.get(order.id)?.item || 0), 0);
    const alreadyMatched = pool.groups.reduce((sum, group) => sum + group.orders.length, 0);
    const remainingSpend = Math.max(0, spend - alreadyAllocated);
    const denominator = Math.max(Math.max(0, leads - alreadyMatched), pool.orders.length);
    split(remainingSpend, denominator, pool.orders, 'item');
    warnings.push(`${pool.code} (${pool.from} to ${pool.to}): ${pool.groups.length} ads combined for orders without a saved Ad ID; exact Ad ID costs stay assigned to their matching ads.`);
  }
  const promotions = new Map<string, { spend: number; from: string; to: string }>();
  for (const row of input.rows.filter(row => !row.code && !(row.level === 'ad' && row.entityId))) {
    const key = `${row.from}|${row.to}`, period = promotions.get(key) || { spend: 0, from: row.from, to: row.to };
    period.spend += cents(row.spend); promotions.set(key, period);
  }
  for (const period of promotions.values()) {
    const matching = cohorts.filter(group => group.row.from === period.from && group.row.to === period.to);
    const list = matching.flatMap(group => group.orders);
    split(period.spend, matching.reduce((sum, group) => sum + group.denominator, 0), list, 'commercial');
  }
  let assigned = 0;
  const byId = new Map(orders.map(order => [order.id, order]));
  for (const [id, cost] of allCosts) {
    const total = cost.item + cost.commercial;
    if (selected.has(id)) { assigned += total; orderCosts.set(id, { ...cost, item: cost.item / 100, commercial: cost.commercial / 100, total: total / 100 }); }
    else if (pending(byId.get(id)!)) pendingCents += total;
    else otherCents += total;
  }
  const missingOrderIds = [...selected].filter(id => !orderCosts.has(id));
  for (const id of missingOrderIds) {
    const order = byId.get(id), day = order && profitSystemDay(order.platform_lead_created_at || order.created_at);
    const covered = day && input.periods.some(period => day >= period.from && day <= period.to);
    issues.push(`${order?.order_number || id}: ${covered ? 'Facebook ad / form identity has no unique cost match' : `lead date ${day || 'unknown'} is outside this CSV`}. Export the NEW CSV for the matching lead-date range (include Ad / Ad Set IDs); no historical cost is loaded.`);
  }
  const total = cents(input.totalSpend);
  return { orderCosts, assignedSpend: assigned / 100, unassignedSpend: (total - assigned) / 100, totalSpend: input.totalSpend,
    pendingSpend: pendingCents / 100, otherSpend: otherCents / 100, unmatchedSpend: (total - assigned - pendingCents - otherCents) / 100,
    missingOrderIds, issues: [...new Set(issues)], warnings: [...new Set(warnings)],
    cohorts: cohorts.map(group => ({ code: group.row.code || `Ad ${group.row.entityId}`, from: group.row.from, to: group.row.to, spend: group.spend / 100, csvLeads: group.leads,
      leadsUsed: group.denominator, matched: group.orders.length, selected: group.orders.filter(order => selected.has(order.id)).length, pending: group.orders.filter(order => !selected.has(order.id) && pending(order)).length })) };
}

export function currentCsvProfitSummary(report: PaidWaybillProfitReport, input: CurrentFacebookCsv | null, tiktok: string, allocation?: CurrentCsvAllocation | null) {
  const parsed = tiktok.trim() === '' ? null : Number(tiktok);
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  const tiktokMissing = Boolean(report.ranges.TikTok && parsed === null);
  const ready = report.rows.length > 0 && report.totals.review === 0 && Boolean(input && allocation) && !invalid;
  const facebook = input && allocation ? allocation.assignedSpend : null;
  const afterFacebook = ready ? (cents(report.totals.beforeAds) - cents(facebook!)) / 100 : null;
  const knownProfit = afterFacebook === null ? null : (cents(afterFacebook) - cents(parsed ?? 0)) / 100;
  const facebookMissing = Boolean(allocation && (allocation.missingOrderIds.length || allocation.issues.length));
  return { facebook, tiktok: invalid ? null : parsed, total: (cents(facebook ?? 0) + cents(invalid ? 0 : parsed ?? 0)) / 100,
    afterFacebook, recordedCostProfit: knownProfit, netProfit: tiktokMissing || facebookMissing ? null : knownProfit, invalid, tiktokMissing, facebookMissing,
    accountNetProfit: ready && input && !tiktokMissing ? (cents(report.totals.beforeAds) - cents(input.totalSpend) - cents(parsed ?? 0)) / 100 : null,
    missing: [...(tiktokMissing ? ['TikTok'] : []), ...(facebookMissing ? ['Facebook cost matches'] : [])] };
}
