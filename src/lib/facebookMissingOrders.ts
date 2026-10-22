import { sheetHeader, type SheetTab } from './sheetConfirmRows';

export const FACEBOOK_MISSING_API = '/api/admin/facebook-leads/missing';
export const facebookLeadKey = (value: unknown) => String(value || '').trim().replace(/^l:/i, '');
export type FacebookAuditLead = {lead_id: string; form_id: string; form_name?: string; created_at: string};
export type FacebookSheetOrder = {order_number: string; lead_ids: string[]; rows: number; sheet_ids: number[]; unverified_lead_ids?: string[]; identity_issue?: string};
export type FacebookMissingSnapshot = {
  checked_at: string; orders: {lead_id: string; order_number: string; expected_rows: number}[];
  sheet_orders: FacebookSheetOrder[]; unlinked_sheet_orders: string[]; target_tab: string;
  sheet_review_orders?: {order_number: string; issue: string}[];
};
export type FacebookMissingResult = FacebookAuditLead & {
  order_number: string; system_found: boolean; sheet_found: boolean; sheet_unverified?: boolean; can_import: boolean; issue: string;
};
export type FacebookSheetGroup = FacebookSheetOrder & {headers: string[]; values: string[][]; row_indices: number[]; title: string};
export class FacebookSheetCoverageError extends Error {}

// Numeric similarity is evidence of a possible rounding issue, never proof that
// two leads are the same. Only an exact original Order ID can authorize a join.
export const facebookNumericLeadCompatible = (raw: string, exact: string) => {
  if (!/^\d+$/.test(exact) || !/^(?:\d+(?:\.\d+)?)(?:e[+-]?\d+)?$/i.test(raw)) return false;
  const a = Number(raw), b = Number(exact);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && (a === b || a.toPrecision(15) === b.toPrecision(15));
};

// A Lead ID or original Order ID is the identity. Customer details are never a
// substitute: repeat customers can legitimately place identical orders.
export const facebookSheetGroups = (tabs: SheetTab[], knownOrders: readonly {order_number?: string; platform_lead_id?: unknown; order_source?: string}[] = []) => {
  const groups = new Map<string, FacebookSheetGroup>();
  const layouts: {tab: SheetTab; headers: string[]}[] = [];
  for (const tab of tabs) {
    const at = tab.values.slice(0, 10).findIndex(row => row.some(value => ['order_id', 'order_number', 'order'].includes(sheetHeader(value))));
    if (at < 0) throw new FacebookSheetCoverageError(tab.title + ': Order ID header is missing. Sheet coverage is incomplete.');
    const headers = tab.values[at], keys = headers.map(sheetHeader);
    const col = (names: string[]) => keys.findIndex(key => names.includes(key));
    const id = col(['order_id', 'order_number', 'order']), lead = col(['lead_id', 'platform_lead_id', 'leadid']);
    if (lead < 0 || col(['item_code', 'sku']) < 0 || col(['qty', 'quantity']) < 0 || col(['order_action']) < 0 || new Set(keys.filter(Boolean)).size !== keys.filter(Boolean).length)
      throw new FacebookSheetCoverageError(tab.title + ': Unique Order ID, Lead ID, Item Code, Qty and Order Action headers are required.');
    layouts.push({tab, headers});
    const unverified = new Set(tab.unverified_facebook_lead_rows || []);
    for (let i = at + 1; i < tab.values.length; i++) {
      const row = tab.values[i], number = String(row[id] || '').trim().toUpperCase();
      if (!number.startsWith('FB-')) continue;
      if (!/^FB-\d{6}$/.test(number)) throw new FacebookSheetCoverageError(tab.title + ': Invalid Facebook Order ID. Check the Sheet before importing.');
      const group: FacebookSheetGroup = groups.get(number) || {order_number: number, lead_ids: [], rows: 0, sheet_ids: [], headers, values: [], row_indices: [], title: tab.title};
      const key = facebookLeadKey(row[lead]);
      if (key && (unverified.has(i) || /^\d+(?:\.\d+)?e[+-]?\d+$/i.test(key) || !/^[A-Za-z0-9_-]{1,128}$/.test(key))) {
        group.unverified_lead_ids ||= [];
        if (!group.unverified_lead_ids.includes(key)) group.unverified_lead_ids.push(key);
      } else if (key && !group.lead_ids.includes(key)) group.lead_ids.push(key);
      if (!group.sheet_ids.includes(tab.sheetId)) group.sheet_ids.push(tab.sheetId);
      group.rows++; group.values.push(row); group.row_indices.push(i); groups.set(number, group);
    }
  }
  const knownByNumber = new Map<string, typeof knownOrders[number][]>();
  for (const order of knownOrders) if (order.order_number && order.order_source === 'Facebook Ads') {
    const found = knownByNumber.get(order.order_number) || []; found.push(order); knownByNumber.set(order.order_number, found);
  }
  for (const group of groups.values()) if (group.unverified_lead_ids?.length) {
    const known = knownByNumber.get(group.order_number) || [], exact = facebookLeadKey(known[0]?.platform_lead_id);
    if (known.length === 1 && typeof known[0].platform_lead_id === 'string' && /^\d+$/.test(exact) && group.lead_ids.every(id => id === exact) && group.unverified_lead_ids.every(raw => facebookNumericLeadCompatible(raw, exact)))
      group.lead_ids = [exact];
    else group.identity_issue = group.order_number + ': Sheet Lead ID needs verification. Its original digits could not be confirmed from the system Order ID.';
  }
  // The connected Facebook order tab must be included, even when it is empty.
  let targets = layouts.filter(({tab}) => /facebook|\bfb\b/i.test(tab.title));
  const otherSource = (title: string) => /tiktok|tik.?tok|website|\btk\b|\bweb\b|manual/i.test(title);
  if (!targets.length && layouts.length === 1 && !otherSource(layouts[0].tab.title)) targets = layouts;
  if (!targets.length) targets = layouts.filter(({tab}) => !otherSource(tab.title) && [...groups.values()].some(group => group.sheet_ids.includes(tab.sheetId)));
  if (targets.length !== 1) throw new FacebookSheetCoverageError('Select the Facebook order tab in Confirm / Cancel Upload → Google Sheet connection. The destination tab is ambiguous.');
  return {groups, target: targets[0]};
};

export const compareFacebookLeads = (leads: FacebookAuditLead[], snapshot: FacebookMissingSnapshot): FacebookMissingResult[] => leads.map(lead => {
  const key = facebookLeadKey(lead.lead_id), orders = snapshot.orders.filter(order => order.lead_id === key);
  const byLead = snapshot.sheet_orders.filter(order => order.lead_ids.includes(key));
  const possible = snapshot.sheet_orders.filter(order => order.identity_issue && order.unverified_lead_ids?.some(raw => facebookNumericLeadCompatible(raw, key)));
  const number = orders[0]?.order_number || byLead[0]?.order_number || (possible.length === 1 ? possible[0].order_number : '');
  const sheets = snapshot.sheet_orders.filter(order => order.order_number === number || order.lead_ids.includes(key) || possible.includes(order));
  let issue = '';
  if (orders.length > 1 || sheets.length > 1 || sheets.some(order => order.sheet_ids.length > 1 || order.lead_ids.length > 1)) issue = 'Conflicting Lead ID / Order ID records. Review before importing.';
  else if (sheets[0]?.identity_issue) issue = sheets[0].identity_issue;
  else if (orders[0] && !/^FB-\d{6}$/.test(orders[0].order_number)) issue = 'The system order has an invalid original Order ID. Review before importing.';
  else if (orders[0] && sheets[0] && orders[0].order_number !== sheets[0].order_number) issue = 'The same Lead ID has different Order IDs in the system and Sheet. Review the original order.';
  else if (sheets[0]?.lead_ids.length && !sheets[0].lead_ids.includes(key)) issue = 'The Sheet Order ID belongs to another Lead ID.';
  else if (orders[0] && sheets[0] && orders[0].expected_rows !== sheets[0].rows) issue = 'Item row count differs. Review the existing Sheet rows.';
  else if (!orders.length && !sheets.length && snapshot.unlinked_sheet_orders.length) issue = 'Some Sheet-only orders have missing or unverified Lead IDs. Review the listed original Order IDs before importing a new order.';
  const system_found = orders.length > 0, sheet_found = sheets.some(order => !order.identity_issue), sheet_unverified = sheets.some(order => Boolean(order.identity_issue));
  return {...lead, order_number: number, system_found, sheet_found, sheet_unverified, can_import: !issue && (!system_found || !sheet_found), issue};
});
