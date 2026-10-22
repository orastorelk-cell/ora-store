import { sheetHeader, type SheetTab } from './sheetConfirmRows';

export const FACEBOOK_MISSING_API = '/api/admin/facebook-leads/missing';
export const facebookLeadKey = (value: unknown) => String(value || '').trim().replace(/^l:/i, '');
export type FacebookAuditLead = {lead_id: string; form_id: string; form_name?: string; created_at: string};
export type FacebookSheetOrder = {order_number: string; lead_ids: string[]; rows: number; sheet_ids: number[]};
export type FacebookMissingSnapshot = {
  checked_at: string; orders: {lead_id: string; order_number: string; expected_rows: number}[];
  sheet_orders: FacebookSheetOrder[]; unlinked_sheet_orders: string[]; target_tab: string;
};
export type FacebookMissingResult = FacebookAuditLead & {
  order_number: string; system_found: boolean; sheet_found: boolean; can_import: boolean; issue: string;
};
export type FacebookSheetGroup = FacebookSheetOrder & {headers: string[]; values: string[][]; row_indices: number[]; title: string};
export class FacebookSheetCoverageError extends Error {}

// A Lead ID or original Order ID is the identity. Customer details are never a
// substitute: repeat customers can legitimately place identical orders.
export const facebookSheetGroups = (tabs: SheetTab[]) => {
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
    for (let i = at + 1; i < tab.values.length; i++) {
      const row = tab.values[i], number = String(row[id] || '').trim().toUpperCase();
      if (!number.startsWith('FB-')) continue;
      if (!/^FB-\d{6}$/.test(number)) throw new FacebookSheetCoverageError(tab.title + ': Invalid Facebook Order ID. Check the Sheet before importing.');
      const group = groups.get(number) || {order_number: number, lead_ids: [], rows: 0, sheet_ids: [], headers, values: [], row_indices: [], title: tab.title};
      const key = facebookLeadKey(row[lead]);
      if (key && !group.lead_ids.includes(key)) group.lead_ids.push(key);
      if (!group.sheet_ids.includes(tab.sheetId)) group.sheet_ids.push(tab.sheetId);
      group.rows++; group.values.push(row); group.row_indices.push(i); groups.set(number, group);
    }
  }
  // The connected Facebook order tab must be included, even when it is empty.
  let targets = layouts.filter(({tab}) => /facebook|\bfb\b/i.test(tab.title));
  if (!targets.length && layouts.length === 1) targets = layouts;
  if (!targets.length) targets = layouts.filter(({tab}) => [...groups.values()].some(group => group.sheet_ids.includes(tab.sheetId)));
  if (targets.length !== 1) throw new FacebookSheetCoverageError('Select the Facebook order tab in Confirm / Cancel Upload → Google Sheet connection. The destination tab is ambiguous.');
  return {groups, target: targets[0]};
};

export const compareFacebookLeads = (leads: FacebookAuditLead[], snapshot: FacebookMissingSnapshot): FacebookMissingResult[] => leads.map(lead => {
  const key = facebookLeadKey(lead.lead_id), orders = snapshot.orders.filter(order => order.lead_id === key);
  const byLead = snapshot.sheet_orders.filter(order => order.lead_ids.includes(key));
  const number = orders[0]?.order_number || byLead[0]?.order_number || '';
  const sheets = snapshot.sheet_orders.filter(order => order.order_number === number || order.lead_ids.includes(key));
  let issue = '';
  if (orders.length > 1 || sheets.length > 1 || sheets.some(order => order.sheet_ids.length > 1 || order.lead_ids.length > 1)) issue = 'Conflicting Lead ID / Order ID records. Review before importing.';
  else if (orders[0] && !/^FB-\d{6}$/.test(orders[0].order_number)) issue = 'The system order has an invalid original Order ID. Review before importing.';
  else if (orders[0] && sheets[0] && orders[0].order_number !== sheets[0].order_number) issue = 'The same Lead ID has different Order IDs in the system and Sheet. Review the original order.';
  else if (sheets[0]?.lead_ids.length && !sheets[0].lead_ids.includes(key)) issue = 'The Sheet Order ID belongs to another Lead ID.';
  else if (orders[0] && sheets[0] && orders[0].expected_rows !== sheets[0].rows) issue = 'Item row count differs. Review the existing Sheet rows.';
  else if (!orders.length && !sheets.length && snapshot.unlinked_sheet_orders.length) issue = 'Some Sheet-only orders have no Lead ID. Add their original Lead IDs before importing a new order.';
  const system_found = orders.length > 0, sheet_found = sheets.length > 0;
  return {...lead, order_number: number, system_found, sheet_found, can_import: !issue && (!system_found || !sheet_found), issue};
});
