import { sameStorefrontValue, type Storefront } from './storefrontProductSave';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type StorefrontDraft = { user: string; base: Storefront; next: Storefront; version: number; saved_at: string };
const key = (user: string) => 'ora_storefront_pending_v1:' + user;
const valid = (value: any): value is Storefront => value && Array.isArray(value.products) && Array.isArray(value.categories) &&
  value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings);

export const readStorefrontDraft = (storage: Storage, user: string): StorefrontDraft | null => {
  try {
    const draft = JSON.parse(storage.getItem(key(user)) || 'null');
    return draft?.user === user && valid(draft.base) && valid(draft.next) && Number.isSafeInteger(draft.version) && draft.version >= 0 ? draft : null;
  } catch { return null; }
};
export const rememberStorefrontDraft = (storage: Storage, user: string, base: Storefront, next: Storefront, version: number) => {
  try {
    storage.setItem(key(user), JSON.stringify({ user, base, next, version, saved_at: new Date().toISOString() }));
    return true;
  } catch { return false; }
};
export const acknowledgeStorefrontDraft = (storage: Storage, user: string, saved: Storefront, version: number) => {
  const draft = readStorefrontDraft(storage, user); if (!draft) return;
  try {
    if (sameStorefrontValue(draft.next, saved)) storage.removeItem(key(user));
    else rememberStorefrontDraft(storage, user, saved, draft.next, version);
  } catch { /* Server acknowledgment remains authoritative if local cache is full. */ }
};
export const archiveStorefrontDraft = (storage: Storage, user: string) => {
  const draft = readStorefrontDraft(storage, user); if (!draft) return;
  try { storage.setItem('ora_storefront_conflicting_edit_v1:' + user, JSON.stringify(draft)); } catch {}
};
