import type { Order } from '../types';
import { parseCsv } from './csv';
import { profitAdvertisingSummary, profitSystemDay, savedProfitPaymentKind, type PaidProfitSelection, type PaidWaybillProfitReport } from './paidWaybillProfit';

export const FACEBOOK_AD_LEDGER_KEY = 'profit-facebook-ads-v1';
export interface FacebookAdCost {
  campaign: string; adSet: string; entityId: string; level: string;
  code: string | null; from: string; to: string; spend: number; leads: number;
}
export interface FacebookAdLedger {
  format: 'ora-facebook-ad-costs-v1'; version: number;
  rows: Array<FacebookAdCost & { fileName: string; importedAt: string; importedBy: string }>;
}
export const emptyFacebookAdLedger = (): FacebookAdLedger => ({ format: 'ora-facebook-ad-costs-v1', version: 0, rows: [] });
export class FacebookAdError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const key = (value: string) => value.trim().toUpperCase();
const cents = (value: number) => Math.round(value * 100);
const round = (value: number) => cents(value) / 100;
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from <= b.to && b.from <= a.to;
const samePeriod = (a: FacebookAdCost, b: FacebookAdCost) => a.from === b.from && a.to === b.to;
const cohortKey = (row: FacebookAdCost) => `${row.code || 'Commercial'}|${row.from}|${row.to}`;
const costSignature = (rows: FacebookAdCost[]) => JSON.stringify(rows.map(row => JSON.stringify({ campaign: row.campaign, adSet: row.adSet,
  entityId: row.entityId, level: row.level, code: row.code, from: row.from, to: row.to, spend: row.spend, leads: row.leads })).sort());

/** A CB SKU is one complete catalog code. Never extract its component R codes. */
export function facebookAdCode(name: string, knownCodes: string[] = []): string | null {
  const upper = key(name);
  const combos = upper.match(/\bCB-R\d{4}(?:-R\d{4})+\b/g) || [];
  if (new Set(combos).size > 1) throw new FacebookAdError('More than one CB code was found in the ad name. Use one catalog code per ad.');
  if (combos.length) return combos[0];
  const codes = [...new Set(upper.match(/\bR\d{4}\b/g) || [])];
  if (codes.length > 1) throw new FacebookAdError('More than one item code was found in the ad name. Use the complete CB code for a combo.');
  const known = [...new Set(knownCodes.map(key).filter(code => code && (!codes.length || code.startsWith(codes[0]))))].sort((a, b) => b.length - a.length);
  const matches = known.filter(code => {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(upper);
  });
  const longest = matches.filter(code => !matches.some(other => other !== code && other.startsWith(code + '-')));
  if (longest.length > 1) throw new FacebookAdError('More than one item code was found in the ad name. Use one catalog code per ad.');
  if (longest.length) return longest[0];
  return codes[0] || null;
}

const numeric = (value: string, label: string, line: number) => {
  const clean = value.trim().replace(/^(?:LKR|RS\.?)[\s:]*/i, '').replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(clean)) throw new FacebookAdError(`Row ${line}: ${label} must be a number of 0 or more.`);
  const result = Number(clean);
  if (!Number.isFinite(result) || result > 1_000_000_000) throw new FacebookAdError(`Row ${line}: ${label} is too large.`);
  return result;
};

export function parseFacebookAdCostCsv(csv: string, knownCodes: string[] = []): FacebookAdCost[] {
  if (!csv.trim() || csv.length > 2_000_000) throw new FacebookAdError('Choose a Facebook CSV report smaller than 2 MB.');
  // The shared CSV reader preserves quoted newlines. Reject unfinished quoting before using it.
  let quoted = false;
  for (let i = 0; i < csv.length; i++) if (csv[i] === '"') {
    if (quoted && csv[i + 1] === '"') i++; else quoted = !quoted;
  }
  if (quoted) throw new FacebookAdError('The CSV has an unfinished quoted field. Export it again.');
  const parsed = parseCsv(csv.replace(/^\uFEFF/, ''));
  const header = (aliases: string[]) => parsed.headers.find(h => aliases.includes(normalized(h))) || '';
  const campaign = header(['campaign name']), adSet = header(['ad set name']), spend = header(['amount spent (lkr)']);
  const from = header(['reporting starts']), to = header(['reporting ends']), results = header(['results']);
  const resultType = header(['result type']), level = header(['delivery level']);
  const explicitCode = header(['product code', 'item code', 'main code']);
  if (!campaign || !spend || !from || !to || !results || !resultType)
    throw new FacebookAdError('Export Campaign name, Results, Result type, Amount spent (LKR), Reporting starts and Reporting ends.');
  if (!parsed.rows.length || parsed.rows.length > 5000) throw new FacebookAdError('The CSV must contain 1 to 5,000 ad rows.');
  const codesByMain = new Map<string, string[]>(), otherCodes: string[] = [];
  for (const raw of knownCodes) {
    const code = key(raw), main = code.match(/^R\d{4}\b/)?.[0];
    if (main) codesByMain.set(main, [...(codesByMain.get(main) || []), code]); else otherCodes.push(code);
  }
  const idHeaders = Object.fromEntries(['ad', 'campaign', 'adset'].map(value => [value, header([value === 'ad' ? 'ad id' : value === 'campaign' ? 'campaign id' : 'ad set id'])]));
  const rows = parsed.rows.map((row, index): FacebookAdCost => {
    const line = index + 2, name = String(row[campaign] || '').trim(), set = String(row[adSet] || '').trim();
    if (!name || name.length > 300 || set.length > 300) throw new FacebookAdError(`Row ${line}: a valid campaign name is required; remove account-total rows.`);
    const start = String(row[from] || ''), end = String(row[to] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || profitSystemDay(start) !== start
      || !/^\d{4}-\d{2}-\d{2}$/.test(end) || profitSystemDay(end) !== end || start > end)
      throw new FacebookAdError(`Row ${line}: Reporting starts / ends must be valid dates in date order.`);
    const deliveryLevel = normalized(row[level] || 'adset');
    if (!['adset', 'ad', 'campaign'].includes(deliveryLevel)) throw new FacebookAdError(`Row ${line}: export one reporting level (ad set, ad or campaign).`);
    const idHeader = idHeaders[deliveryLevel];
    const names = `${name} ${set}`, main = key(names).match(/\bR\d{4}\b/)?.[0];
    const code = explicitCode && row[explicitCode] ? key(row[explicitCode]) : facebookAdCode(names, main ? codesByMain.get(main) || [] : otherCodes);
    if (code && !/^[A-Z0-9][A-Z0-9._-]{0,119}$/.test(code)) throw new FacebookAdError(`Row ${line}: use a valid catalog code of at most 120 characters.`);
    if (deliveryLevel === 'ad' && !(idHeader && row[idHeader])) throw new FacebookAdError(`Row ${line}: include Ad ID when exporting individual ads.`);
    if (!code && !/\b(?:commercial|commersial)\b|\bcm\s+ad\b/i.test(`${name} ${set}`))
      throw new FacebookAdError(`Row ${line}: no catalog code was found in "${name}". Only named Commercial ads can be saved without a code.`);
    const type = normalized(row[resultType] || ''), rawLeads = String(row[results] || '').trim();
    if (code && !/^(?:leads? \(form\)|on-facebook leads?|leadgen|onsite_conversion\.lead_grouped)$/.test(type))
      throw new FacebookAdError(`Row ${line}: item ads need form-lead results; messages, clicks and purchases cannot be used as lead counts.`);
    const leads = rawLeads ? numeric(rawLeads, 'Results', line) : 0;
    if (!Number.isSafeInteger(leads)) throw new FacebookAdError(`Row ${line}: Results must be a whole lead count.`);
    return { campaign: name, adSet: set, entityId: String(row[idHeader] || '').trim(), level: deliveryLevel,
      code, from: start, to: end, spend: round(numeric(row[spend], 'Amount spent (LKR)', line)), leads: code ? leads : 0 };
  });
  if (new Set(rows.map(row => row.level)).size !== 1) throw new FacebookAdError('Do not combine campaign, ad set and ad totals in one file. Export one reporting level.');
  const identities = new Set<string>(), namedPeriods = new Map<string, { unnamed: boolean; count: number }>();
  for (const row of rows) {
    const period = `${row.from}|${row.to}`, nameKey = JSON.stringify([row.level, normalized(row.campaign), normalized(row.adSet), period]);
    const identity = row.entityId ? `${row.level}|${row.entityId}|${period}` : nameKey, named = namedPeriods.get(nameKey);
    if (identities.has(identity) || named && (named.unnamed || !row.entityId))
      throw new FacebookAdError('The CSV repeats the same ad and dates. Remove breakdown subtotals or export without overlapping breakdowns.');
    identities.add(identity); namedPeriods.set(nameKey, { unnamed: !row.entityId, count: (named?.count || 0) + 1 });
  }
  return rows;
}

export function readFacebookAdLedger(value: unknown): FacebookAdLedger {
  if (value === undefined || value === null) return emptyFacebookAdLedger();
  const ledger = value as FacebookAdLedger;
  if (ledger.format !== 'ora-facebook-ad-costs-v1' || !Number.isSafeInteger(ledger.version) || ledger.version < 0 || !Array.isArray(ledger.rows) || ledger.rows.length > 20000
    || ledger.rows.some(row => !row || !Number.isFinite(row.spend) || row.spend < 0 || !Number.isSafeInteger(row.leads) || row.leads < 0
      || typeof row.campaign !== 'string' || typeof row.adSet !== 'string' || typeof row.entityId !== 'string'
      || !['adset', 'ad', 'campaign'].includes(row.level) || !(row.code === null || typeof row.code === 'string')
      || !/^\d{4}-\d{2}-\d{2}$/.test(row.from) || !/^\d{4}-\d{2}-\d{2}$/.test(row.to)
      || profitSystemDay(row.from) !== row.from || profitSystemDay(row.to) !== row.to || row.from > row.to))
    throw new FacebookAdError('Saved advertising history needs review. It was not replaced with an empty report.', 503);
  return ledger;
}

/** Each upload is a complete snapshot for its code/period. Rename/removal of an
 * ad set cannot leave an old cost behind, even in exports without Ad set IDs. */
export function mergeFacebookAdLedger(current: FacebookAdLedger, incoming: FacebookAdCost[], meta: {
  expectedVersion: number; fileName: string; importedAt: string; importedBy: string;
}): { ledger: FacebookAdLedger; unchanged: boolean } {
  const existing = new Map<string, FacebookAdCost[]>(), replacements = new Map<string, FacebookAdCost[]>();
  for (const row of current.rows) existing.set(cohortKey(row), [...(existing.get(cohortKey(row)) || []), row]);
  for (const row of incoming) replacements.set(cohortKey(row), [...(replacements.get(cohortKey(row)) || []), row]);
  if ([...replacements].every(([id, rows]) => costSignature(existing.get(id) || []) === costSignature(rows))) return { ledger: current, unchanged: true };
  if (meta.expectedVersion !== current.version) throw new FacebookAdError('Advertising history changed in another session. Refresh it before importing this file.', 409);
  const periods = new Map<string | null, FacebookAdCost[]>();
  for (const rows of existing.values()) periods.set(rows[0].code, [...(periods.get(rows[0].code) || []), rows[0]]);
  for (const rows of replacements.values()) {
    const row = rows[0], conflicts = (periods.get(row.code) || []).filter(old => overlaps(old, row));
    if (conflicts.some(old => !samePeriod(old, row)))
      throw new FacebookAdError(`Overlapping dates for ${row.code || 'Commercial'}: saved costs already cover part of ${row.from} to ${row.to}. Re-upload the same dates, or use non-overlapping / daily reports.`, 409);
    periods.set(row.code, [...(periods.get(row.code) || []), row]);
  }
  const rows = [...current.rows.filter(row => !replacements.has(cohortKey(row))), ...incoming.map(row => ({ ...row,
    fileName: meta.fileName.slice(0, 200), importedAt: meta.importedAt, importedBy: meta.importedBy }))];
  if (rows.length > 20000) throw new FacebookAdError('Advertising history has reached its row limit. Export longer non-overlapping periods.', 413);
  rows.sort((a, b) => a.from.localeCompare(b.from) || (a.code || '').localeCompare(b.code || '') || a.campaign.localeCompare(b.campaign) || a.adSet.localeCompare(b.adSet));
  return { ledger: { format: current.format, version: current.version + 1, rows }, unchanged: false };
}

export interface FacebookAdCohort {
  code: string; from: string; to: string; spend: number; leads: number; matched: number;
  paid: number; pending: number; lost: number; unmatched: number;
  paidCost: number; pendingCost: number; lostCost: number; unmatchedCost: number; fallbackDates: number; issues: string[];
}
export interface FacebookAdAllocation {
  cohorts: FacebookAdCohort[]; orderCosts: Map<string, { cost: number; state: 'paid' | 'pending' | 'lost'; from: string; to: string; code: string }>;
  paidCost: number; lostCost: number; commercialCost: number; pendingCost: number; unmatchedCost: number;
  missingOrderIds: string[]; issues: string[]; totalSpend: number;
  waybillScoped?: boolean;
}
export interface FacebookWaybillScope {
  orderIds: readonly string[];
  reportingPeriods: Array<{ from: string; to: string }>;
}
/** These are CSV reporting dates, not order arrival or payment dates. */
export function facebookReportingPeriods(ledger: FacebookAdLedger, keys?: string[]) {
  const latestImport = ledger.rows.reduce((last, row) => row.importedAt > last ? row.importedAt : last, '');
  const selected = keys ? new Set(keys) : undefined;
  const periods = new Map<string, { from: string; to: string }>();
  for (const row of ledger.rows) if (selected ? selected.has(`${row.from}|${row.to}`) : row.importedAt === latestImport)
    periods.set(`${row.from}|${row.to}`, { from: row.from, to: row.to });
  return [...periods.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}
const facebookOrder = (order: Order) => order.order_source === 'Facebook Ads' || /^FB-/i.test(order.order_number);
const lostOrder = (order: Order & { return_tracking_waybill?: string }) => order.order_status === 'Cancelled' || order.call_center_status === 'Cancelled'
  || order.payment_status === 'Refunded' || Boolean(order.return_tracking_waybill || order.return_sheet_id)
  || /return/i.test(order.delivery_status || '');
const orderState = (order: Order): 'paid' | 'pending' | 'lost' => lostOrder(order) ? 'lost'
  : savedProfitPaymentKind(order) && (order.cod_payment_received || order.order_status === 'Delivered') ? 'paid' : 'pending';
const inSelection = (order: Order, selection: PaidProfitSelection) => {
  const date = profitSystemDay(order.created_at);
  return Boolean(date && (!selection.fromDate || date >= selection.fromDate) && (!selection.toDate || date <= selection.toDate));
};

/** Read-only management allocation. The full incurred spend is retained in the ledger. */
export function allocateFacebookAdCosts(ledger: FacebookAdLedger, orders: Order[], report: PaidWaybillProfitReport,
  selection: PaidProfitSelection = {}, scope?: FacebookWaybillScope): FacebookAdAllocation {
  const selectedOrderIds = scope ? new Set(scope.orderIds) : undefined;
  const selectedPeriod = (row: { from: string; to: string }) => scope?.reportingPeriods.some(period => period.from === row.from && period.to === row.to);
  const groups = new Map<string, FacebookAdCohort>();
  const issues: string[] = [];
  let commercialCost = 0;
  for (const row of ledger.rows) {
    if (!row.code) {
      if (scope) { if (selectedPeriod(row)) commercialCost += row.spend; continue; }
      if ((!selection.fromDate || row.to >= selection.fromDate) && (!selection.toDate || row.from <= selection.toDate)) {
        if ((selection.fromDate && row.from < selection.fromDate) || (selection.toDate && row.to > selection.toDate))
          issues.push(`Commercial cost covers ${row.from} to ${row.to}. Select its full period or upload daily costs for a narrower report.`);
        else commercialCost += row.spend;
      }
      continue;
    }
    const id = `${row.code}|${row.from}|${row.to}`;
    const cohort = groups.get(id) || { code: row.code, from: row.from, to: row.to, spend: 0, leads: 0, matched: 0,
      paid: 0, pending: 0, lost: 0, unmatched: 0, paidCost: 0, pendingCost: 0, lostCost: 0, unmatchedCost: 0, fallbackDates: 0, issues: [] };
    cohort.spend = round(cohort.spend + row.spend); cohort.leads += row.leads; groups.set(id, cohort);
  }
  const cohorts = [...groups.values()], assignments = new Map<FacebookAdCohort, Order[]>(), cohortsByCode = new Map<string, FacebookAdCohort[]>();
  for (const cohort of cohorts) cohortsByCode.set(cohort.code, [...(cohortsByCode.get(cohort.code) || []), cohort]);
  const knownCodes = [...new Set(cohorts.map(row => row.code))];
  const uniqueLeads = new Map<string, Order[]>();
  for (const order of orders) {
    if (!facebookOrder(order) || order.is_test_order || order.is_duplicate_order || order.is_replacement_order) continue;
    const id = order.platform_lead_id ? `lead:${order.platform_lead_id.trim()}` : `order:${order.id}`;
    uniqueLeads.set(id, [...(uniqueLeads.get(id) || []), order]);
  }
  for (const lead of uniqueLeads.values()) {
    const order = lead[0], day = profitSystemDay(order.platform_lead_created_at || order.created_at);
    // Original auto-import form metadata survives edits to confirmed order items.
    const form = order.notes?.match(/(?:^|\n)Form:\s*([^\n]+)/i)?.[1];
    let originalCode: string | null = null;
    try { if (form) originalCode = facebookAdCode(form, knownCodes); } catch { /* Ambiguous form remains unmatched. */ }
    const itemCodes = new Set((order.items || []).flatMap(item => [key(item.main_sku || ''), key(item.sku || ''),
      key(item.main_sku || item.sku || '').startsWith('CB-') ? key(item.main_sku || item.sku || '') : (key(item.main_sku || item.sku || '').match(/^R\d{4}\b/)?.[0] || '')]));
    const candidates = form ? cohortsByCode.get(originalCode || '') || [] : [...itemCodes].flatMap(code => cohortsByCode.get(code) || []);
    const matches = candidates.filter(row => day >= row.from && day <= row.to);
    if (matches.length !== 1 || lead.length !== 1) {
      if (matches.length) for (const row of matches) row.issues.push(lead.length > 1
        ? `${order.order_number}: multiple orders share this Lead ID.` : `${order.order_number}: its original advertising code is ambiguous.`);
      continue;
    }
    const cohort = matches[0];
    if (!order.platform_lead_created_at) cohort.fallbackDates++;
    assignments.set(cohort, [...(assignments.get(cohort) || []), order]);
  }
  const orderCosts: FacebookAdAllocation['orderCosts'] = new Map();
  let paidCost = 0, lostCost = 0;
  const selectedReady = new Set(report.rows.filter(row => row.profit !== null).map(row => row.orderId));
  for (const cohort of cohorts) {
    const matched = (assignments.get(cohort) || []).sort((a, b) => (a.platform_lead_id || a.id).localeCompare(b.platform_lead_id || b.id));
    cohort.matched = matched.length;
    if (matched.length > cohort.leads) cohort.issues.push(`System has ${matched.length} unique leads; Facebook reports ${cohort.leads}. Check dates, attribution and lead counts.`);
    if (cohort.issues.length) {
      cohort.unmatched = cohort.leads; cohort.unmatchedCost = cohort.spend; continue;
    }
    if (!cohort.leads) { cohort.lostCost = cohort.spend; continue; }
    cohort.unmatched = cohort.leads - matched.length;
    const allocated = Math.round(cents(cohort.spend) * matched.length / cohort.leads);
    const base = matched.length ? Math.floor(allocated / matched.length) : 0, remainder = allocated - base * matched.length;
    matched.forEach((order, index) => {
      const cost = (base + (index < remainder ? 1 : 0)) / 100, state = orderState(order);
      cohort[state]++; cohort[`${state}Cost`] = round(cohort[`${state}Cost`] + cost);
      orderCosts.set(order.id, { cost, state, from: cohort.from, to: cohort.to, code: cohort.code });
      if (state === 'paid' && selectedReady.has(order.id)) paidCost += cost;
      if (state === 'lost' && (selectedOrderIds ? selectedOrderIds.has(order.id) : inSelection(order, selection))) lostCost += cost;
    });
    cohort.unmatchedCost = (cents(cohort.spend) - allocated) / 100;
  }
  const selectedCohorts = new Set(report.rows.flatMap(row => { const saved = row.orderId ? orderCosts.get(row.orderId) : undefined;
    return saved ? [`${saved.code}|${saved.from}|${saved.to}`] : []; }));
  const visible = cohorts.filter(row => (scope ? selectedPeriod(row) : (!selection.fromDate || row.to >= selection.fromDate) && (!selection.toDate || row.from <= selection.toDate))
    || selectedCohorts.has(`${row.code}|${row.from}|${row.to}`));
  for (const cohort of visible) {
    if (!scope || selectedCohorts.has(`${cohort.code}|${cohort.from}|${cohort.to}`)) issues.push(...cohort.issues.map(issue => `${cohort.code}: ${issue}`));
    if (!cohort.leads && cohort.spend > 0) {
      if (scope) continue; // No selected waybill can own a zero-lead item-ad expense.
      else if ((selection.fromDate && cohort.from < selection.fromDate) || (selection.toDate && cohort.to > selection.toDate))
        issues.push(`${cohort.code}: zero-lead spend covers a wider period. Select ${cohort.from} to ${cohort.to}.`);
      else lostCost += cohort.spend;
    }
  }
  const missingOrderIds = report.rows.filter(row => row.source === 'Facebook' && row.orderId
    && orderCosts.get(row.orderId)?.state !== 'paid').map(row => row.orderId!);
  return { cohorts: visible, orderCosts, paidCost: round(paidCost), lostCost: round(lostCost), commercialCost: round(commercialCost),
    pendingCost: round(visible.reduce((sum, row) => sum + row.pendingCost, 0)), unmatchedCost: round(visible.reduce((sum, row) => sum + row.unmatchedCost, 0)),
    missingOrderIds, issues: [...new Set(issues)], totalSpend: round(ledger.rows.reduce((sum, row) => sum + row.spend, 0)), waybillScoped: Boolean(scope) };
}

export function facebookAllocatedAdvertisingSummary(report: PaidWaybillProfitReport, allocation: FacebookAdAllocation, tiktok: string) {
  const result = profitAdvertisingSummary(report, String(round(allocation.paidCost + allocation.lostCost + allocation.commercialCost)), tiktok);
  return { ...result, netProfit: allocation.issues.length || allocation.missingOrderIds.length || !allocation.waybillScoped && allocation.unmatchedCost > 0 ? null : result.netProfit };
}
