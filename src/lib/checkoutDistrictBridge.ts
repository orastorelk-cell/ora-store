// Checkout already knows the exact courier district selected with the city.
// StoreContext's legacy Order shape can drop that field before POST /api/orders.
// Preserve the exact UI-selected district at the durable server boundary without
// guessing from city names (important because one city name can exist in more
// than one district).

declare global {
  interface Window {
    __ORA_DISTRICT_BRIDGE_INSTALLED__?: boolean;
  }
}

if (typeof window !== 'undefined' && !window.__ORA_DISTRICT_BRIDGE_INSTALLED__) {
  window.__ORA_DISTRICT_BRIDGE_INSTALLED__ = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const pathname = new URL(requestUrl, window.location.origin).pathname;

      if (method === 'POST' && pathname === '/api/orders' && typeof init?.body === 'string') {
        const payload = JSON.parse(init.body);
        const order = payload?.order;
        if (order && !String(order.district || '').trim()) {
          const districtInput = document.querySelector<HTMLInputElement>(
            'input[readonly][placeholder="Auto-filled from city"]',
          );
          const district = String(districtInput?.value || '').trim();
          if (district) {
            const nextPayload = {
              ...payload,
              order: { ...order, district },
            };
            return nativeFetch(input, { ...init, body: JSON.stringify(nextPayload) });
          }
        }
      }
    } catch {
      // Never block checkout if the guard cannot inspect a non-standard request.
    }
    return nativeFetch(input, init);
  }) as typeof window.fetch;
}

export {};
