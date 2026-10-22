import { staffJsonRequest } from './staffRequest';
import { FACEBOOK_MISSING_API, type FacebookAuditLead } from './facebookMissingOrders';

export const facebookMissingRequest = async (body: any, audit = false) => {
  const result = await staffJsonRequest(audit ? '/api/admin/facebook-leads/audit' : FACEBOOK_MISSING_API, {
    method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + (localStorage.getItem('ora_staff_session_token') || '')}, body: JSON.stringify(body),
  }, !audit && body.action === 'import' ? 120000 : 25000);
  if (result.ok !== true) throw new Error('The source check did not complete. Retry the check.');
  return result;
};

// Every returned cursor is consumed. A failed, repeated or malformed page never
// becomes an all-clear report. Source calls run only after the explicit click.
export const scanMissingFacebookLeads = async (since: string, until: string, progress: (text: string) => void, request = facebookMissingRequest) => {
  const common: any = {scope: 'all_available', since, until}, forms: any[] = [], seenForms = new Set<string>();
  let cursor = '', page_id = '';
  const cursors = new Set<string>();
  do {
    progress('Reading Facebook forms…');
    const data = await request({...common, action: 'forms', cursor, ...(page_id ? {page_id} : {})}, true);
    if (!Array.isArray(data.forms) || !data.page_id || page_id && page_id !== data.page_id) throw new Error('Facebook form coverage could not be verified. Run the check again.');
    page_id = data.page_id;
    for (const form of data.forms) {
      if (!form.id || seenForms.has(form.id)) throw new Error('Facebook repeated a form. The check is incomplete.');
      seenForms.add(form.id); forms.push(form);
    }
    cursor = data.next_cursor;
    if (typeof cursor !== 'string' || Boolean(data.done) !== !cursor || cursor && cursors.has(cursor)) throw new Error('Facebook form pagination is incomplete.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const leads = new Map<string, FacebookAuditLead>();
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i], seen = new Set<string>(); cursor = '';
    do {
      progress('Checking Facebook form ' + (i + 1) + ' / ' + forms.length + ' · ' + leads.size + ' leads found');
      const data = await request({...common, page_id, action: 'lead_page', form_id: form.id, cursor}, true);
      if (!Array.isArray(data.leads) || data.page_id !== page_id || data.form_id !== form.id) throw new Error('Facebook returned an incomplete lead page.');
      for (const lead of data.leads) {
        const time = Date.parse(lead.created_at);
        if (!lead.lead_id || lead.form_id !== form.id || !Number.isFinite(time) || time < Date.parse(since) || time > Date.parse(until)) throw new Error('Facebook returned an invalid lead identity.');
        const old = leads.get(lead.lead_id);
        if (old && (old.form_id !== lead.form_id || old.created_at !== lead.created_at)) throw new Error('Facebook returned conflicting lead identities.');
        leads.set(lead.lead_id, lead);
      }
      cursor = data.next_cursor;
      if (typeof cursor !== 'string' || Boolean(data.done) !== !cursor || cursor && seen.has(cursor)) throw new Error('Facebook lead pagination is incomplete.');
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  progress('Comparing the system with the connected Google Sheet…');
  const data = await request({action: 'snapshot'});
  if (!data.snapshot || !Array.isArray(data.snapshot.orders) || !Array.isArray(data.snapshot.sheet_orders) || !Array.isArray(data.snapshot.unlinked_sheet_orders)) throw new Error('Google Sheet coverage could not be verified.');
  return {leads: [...leads.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)), page_id, snapshot: data.snapshot};
};
