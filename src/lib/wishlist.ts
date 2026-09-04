export const WISHLIST_STORAGE_KEY = 'ora_customer_wishlist_v1';
export const WISHLIST_CHANGED_EVENT = 'ora:wishlist-changed';
export const WISHLIST_OPEN_EVENT = 'ora:wishlist-open';

const safeIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((id) => String(id || '').trim()).filter(Boolean)));
};

export const readWishlistIds = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    return safeIds(JSON.parse(window.localStorage.getItem(WISHLIST_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
};

const saveWishlistIds = (ids: string[]) => {
  if (typeof window === 'undefined') return;
  const next = safeIds(ids);
  window.localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT, { detail: { ids: next } }));
};

export const isInWishlist = (productId: string) => readWishlistIds().includes(String(productId || '').trim());

export const toggleWishlist = (productId: string): boolean => {
  const id = String(productId || '').trim();
  if (!id) return false;
  const ids = readWishlistIds();
  const exists = ids.includes(id);
  saveWishlistIds(exists ? ids.filter((row) => row !== id) : [...ids, id]);
  return !exists;
};

export const removeFromWishlist = (productId: string) => {
  const id = String(productId || '').trim();
  if (!id) return;
  saveWishlistIds(readWishlistIds().filter((row) => row !== id));
};

export const openWishlist = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(WISHLIST_OPEN_EVENT));
};
