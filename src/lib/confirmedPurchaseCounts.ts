export type ConfirmedPurchaseCountMap = Record<string, number>;

let cachedCounts: ConfirmedPurchaseCountMap | null = null;
let cachedAt = 0;
let pending: Promise<ConfirmedPurchaseCountMap> | null = null;
const CACHE_MS = 60_000;

export const loadConfirmedPurchaseCounts = async (): Promise<ConfirmedPurchaseCountMap> => {
  const now = Date.now();
  if (cachedCounts && now - cachedAt < CACHE_MS) return cachedCounts;
  if (pending) return pending;

  pending = fetch('/api/public/confirmed-purchase-counts', {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) return {};
      const data = await response.json().catch(() => ({}));
      const raw = data?.counts && typeof data.counts === 'object' ? data.counts : {};
      const next: ConfirmedPurchaseCountMap = {};
      Object.entries(raw).forEach(([sku, value]) => {
        const key = String(sku || '').trim().toUpperCase();
        const count = Math.max(0, Number(value || 0));
        if (key && Number.isFinite(count)) next[key] = count;
      });
      cachedCounts = next;
      cachedAt = Date.now();
      return next;
    })
    .catch(() => {
      cachedCounts = cachedCounts || {};
      cachedAt = Date.now();
      return cachedCounts;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
};

export const confirmedPurchaseCountForSku = async (sku: string): Promise<number> => {
  const counts = await loadConfirmedPurchaseCounts();
  return Math.max(0, Number(counts[String(sku || '').trim().toUpperCase()] || 0));
};
