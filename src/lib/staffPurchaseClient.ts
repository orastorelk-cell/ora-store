import { canonicalJson, confirmCsvRequestWithRetry } from './confirmCsvSave';
import { staffJsonRequest } from './staffRequest';
import { parseStaffPurchase, STAFF_PURCHASE_API, type StaffPurchaseInput } from './staffPurchases';

export const staffPurchaseRequest = async (query = '', input?: StaffPurchaseInput) => {
  const data = await confirmCsvRequestWithRetry(async (url, options) => {
    const result = await staffJsonRequest(url, { ...options, headers: { 'content-type': 'application/json',
      authorization: 'Bearer ' + (localStorage.getItem('ora_staff_session_token') || '') } });
    let valid = result.ok === true;
    if (valid && input) {
      try { valid = canonicalJson(parseStaffPurchase(result.purchase)) === canonicalJson(input); } catch { valid = false; }
    } else if (valid) valid = Array.isArray(result.purchases) && Number.isSafeInteger(result.total);
    if (!valid) { const error: any = new Error('The staff purchase response could not be verified. Retry the saved purchase.'); error.status = 503; throw error; }
    return result;
  }, STAFF_PURCHASE_API + query, input ? { method: 'POST', body: JSON.stringify(input) } : undefined);
  return data;
};
