import {dataBucket} from './cloudflareData';

const KEY = 'ora-data/facebook-missing-import-lock-v1.json';
export class FacebookSheetBusyError extends Error {readonly status = 409;}
export const isFacebookSheetWrite = (body: any) => body?.action === 'sync_orders' && (
  Object.keys(body.groups || {}).some(key => key === 'Facebook Ads') ||
  [body.order, ...(Array.isArray(body.orders) ? body.orders : [])].some(order => order && (order.order_source === 'Facebook Ads' || order.source === 'Facebook Ads'))
);

// The native append and existing Apps Script mirrors share one conditional R2
// lease. A cron/webhook already writing completes before a manual import can
// check physical rows; a queued mirror cannot append during that import.
export const acquireFacebookSheetWriteLock = async (env?: unknown) => {
  const bucket = dataBucket(env);
  if (!bucket) return async () => {}; // Existing local-development storage path.
  const previous = await bucket.get(KEY), value = previous ? JSON.parse(await previous.text()) : null;
  if (value?.until > Date.now()) throw new FacebookSheetBusyError('A Facebook Sheet sync is running. Wait for it to finish, then retry the saved missing orders.');
  const owner = crypto.randomUUID();
  const saved = await bucket.put(KEY, JSON.stringify({owner, until: Date.now() + 180000}), {onlyIf: previous ? {etagMatches: previous.etag} : {etagDoesNotMatch: '*'}});
  if (!saved) throw new FacebookSheetBusyError('Another Facebook Sheet sync started. Retry after it finishes.');
  return async () => {
    const current = await bucket.get(KEY);
    if (current && JSON.parse(await current.text()).owner === owner) await bucket.put(KEY, JSON.stringify({owner, until: 0}), {onlyIf: {etagMatches: current.etag}});
  };
};
