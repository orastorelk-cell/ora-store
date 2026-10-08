type PublicStorefrontPath = '/api/storefront/state' | '/api/storefront/version';
type BootRequest = { path: PublicStorefrontPath; startedAt: number; promise: Promise<any> };

declare global {
  interface Window { __oraStorefrontBoot?: BootRequest }
}

const pending = new Map<PublicStorefrontPath, Promise<any>>();

// Share only requests that are still running. Every later freshness check still
// asks the authoritative server; no catalog or price is cached here.
export const publicStorefrontRequest = (path: PublicStorefrontPath): Promise<any> => {
  const existing = pending.get(path);
  if (existing) return existing;
  const boot = window.__oraStorefrontBoot;
  let request: Promise<any>;
  if (boot?.path === path && Date.now() - boot.startedAt < 30_000) {
    delete window.__oraStorefrontBoot;
    request = boot.promise;
  } else {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    request = fetch(path, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `Shared storefront load failed (${response.status})`);
        return data;
      }).finally(() => window.clearTimeout(timer));
  }
  const shared = request.finally(() => { if (pending.get(path) === shared) pending.delete(path); });
  pending.set(path, shared);
  return shared;
};
