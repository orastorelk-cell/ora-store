import type { Order } from '../types';
import { facebookAdCode, parseFacebookAdCostCsv, type FacebookAdCost } from './facebookProfitAds';
import { type PaidWaybillProfitReport } from './paidWaybillProfit';

const cents = (amount: number) => Math.round(amount * 100);
export interface CurrentFacebookCsv {
  fileName: string;
  rows: FacebookAdCost[];
  periods: Array<{ from: string; to: string }>;
  itemSpend: number;
  commercialSpend: number;
  totalSpend: number;
}

/** A report input, kept only in memory. No saved ledger is accepted here. */
export function currentFacebookCsv(csv: string, fileName: string, knownCodes: string[] = []): CurrentFacebookCsv {
  const rows = parseFacebookAdCostCsv(csv, knownCodes);
  const periods = [...new Map(rows.map(row => [`${row.from}|${row.to}`, { from: row.from, to: row.to }])).values()]
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const item = rows.filter(row => row.code).reduce((sum, row) => sum + cents(row.spend), 0);
  const commercial = rows.filter(row => !row.code).reduce((sum, row) => sum + cents(row.spend), 0);
  return { fileName: fileName.slice(0, 200), rows, periods, itemSpend: item / 100, commercialSpend: commercial / 100, totalSpend: (item + commercial) / 100 };
}

export interface CurrentCsvOrderCost { item: number; commercial: number; total: number; }
export interface CurrentCsvAllocation {
  orderCosts: Map<string, CurrentCsvOrderCost>;
  assignedSpend: number;
  unassignedSpend: number;
  totalSpend: number;
}

/** The uploaded cost report covers the complete selected payment batches.
 * Dates/Meta lead counts describe the CSV; they never bring back prior reports
 * or omit expenses from this batch. Split optional order shares in exact cents. */
export function allocateCurrentCsvCosts(input: CurrentFacebookCsv, orders: Order[], report: PaidWaybillProfitReport): CurrentCsvAllocation {
  const selected = report.rows.filter(row => row.source === 'Facebook' && row.eligible && row.orderId);
  const selectedIds = new Set(selected.map(row => row.orderId!));
  const system = new Map(orders.filter(order => selectedIds.has(order.id)).map(order => [order.id, order]));
  const budgets = new Map<string, number>();
  for (const row of input.rows) if (row.code) budgets.set(row.code, (budgets.get(row.code) || 0) + cents(row.spend));
  const known = [...budgets.keys()], groups = new Map<string, string[]>();
  const orderCosts = new Map<string, CurrentCsvOrderCost>([...selectedIds].map(id => [id, { item: 0, commercial: 0, total: 0 }]));
  for (const id of selectedIds) {
    const order = system.get(id); if (!order) continue;
    const form = order.notes?.match(/(?:^|\n)Form:\s*([^\n]+)/i)?.[1];
    let code: string | null = null;
    try {
      if (form) code = facebookAdCode(form, known);
      else {
        const candidates = new Set((order.items || []).map(item => facebookAdCode(item.main_sku || item.sku || '', known)).filter(Boolean));
        if (candidates.size === 1) code = [...candidates][0]!;
      }
    } catch { /* An ambiguous order share remains in the full CSV summary. */ }
    if (code && budgets.has(code)) groups.set(code, [...(groups.get(code) || []), id]);
  }
  const split = (budget: number, ids: string[], field: 'item' | 'commercial') => {
    const sorted = ids.slice().sort(); if (!sorted.length) return;
    const perOrder = Math.floor(budget / sorted.length), remainder = budget % sorted.length;
    sorted.forEach((id, index) => {
      const cost = orderCosts.get(id)!;
      cost[field] += (perOrder + (index < remainder ? 1 : 0)) / 100;
    });
  };
  for (const [code, budget] of budgets) split(budget, groups.get(code) || [], 'item');
  split(cents(input.commercialSpend), [...selectedIds], 'commercial');
  let assigned = 0;
  for (const cost of orderCosts.values()) { cost.item = cents(cost.item) / 100; cost.commercial = cents(cost.commercial) / 100; cost.total = (cents(cost.item) + cents(cost.commercial)) / 100; assigned += cents(cost.total); }
  return { orderCosts, assignedSpend: assigned / 100, unassignedSpend: (cents(input.totalSpend) - assigned) / 100, totalSpend: input.totalSpend };
}

export function currentCsvProfitSummary(report: PaidWaybillProfitReport, input: CurrentFacebookCsv | null, tiktok: string) {
  const parsed = tiktok.trim() === '' ? null : Number(tiktok);
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  const tiktokMissing = Boolean(report.ranges.TikTok && parsed === null);
  const ready = report.rows.length > 0 && report.totals.review === 0 && Boolean(input) && !invalid;
  const facebook = input?.totalSpend ?? null;
  const afterFacebook = ready ? (cents(report.totals.beforeAds) - cents(facebook!)) / 100 : null;
  const knownProfit = afterFacebook === null ? null : (cents(afterFacebook) - cents(parsed ?? 0)) / 100;
  return { facebook, tiktok: invalid ? null : parsed, total: (cents(facebook ?? 0) + cents(invalid ? 0 : parsed ?? 0)) / 100,
    afterFacebook, recordedCostProfit: knownProfit, netProfit: tiktokMissing ? null : knownProfit, invalid, tiktokMissing,
    missing: tiktokMissing ? ['TikTok'] : [] };
}
