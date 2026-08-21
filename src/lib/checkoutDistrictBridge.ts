// Checkout already knows the exact courier district selected with the city.
// StoreContext's legacy Order shape currently drops that field before POST /api/orders.
// Preserve the exact UI-selected district at the durable server boundary without
// guessing from city names (important because one city name can exist in more
// than one district).

declare global {
  interface Window {
    __ORA_DISTRICT_BRIDGE_INSTALLED__?: boolean;
  }
}

type CityDistrictPair = { city: string; district: string };

const norm = (value: unknown) => String(value || '').trim();
const key = (value: unknown) => norm(value).toLowerCase();

if (typeof window !== 'undefined' && !window.__ORA_DISTRICT_BRIDGE_INSTALLED__) {
  window.__ORA_DISTRICT_BRIDGE_INSTALLED__ = true;
  const nativeFetch = window.fetch.bind(window);
  const recentPairs = new Map<string, Set<string>>();

  const cachePairs = (rows: unknown) => {
    if (!Array.isArray(rows)) return;
    for (const raw of rows) {
      const pair = raw as Partial<CityDistrictPair>;
      const city = norm(pair.city);
      const district = norm(pair.district);
      if (!city || !district) continue;
      const k = key(city);
      const set = recentPairs.get(k) || new Set<string>();
      set.add(district);
      recentPairs.set(k, set);
    }
  };

  const districtFromCheckoutDom = () => {
    const exact = document.querySelector<HTMLInputElement>(
      'input[readonly][placeholder="Auto-filled from city"]',
    );
    if (norm(exact?.value)) return norm(exact?.value);

    const readonlyInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]'));
    for (const input of readonlyInputs) {
      const parentText = norm(input.parentElement?.textContent).toLowerCase();
      const previousText = norm(input.previousElementSibling?.textContent).toLowerCase();
      if ((parentText.includes('district') || previousText.includes('district')) && norm(input.value)) {
        return norm(input.value);
      }
    }
    return '';
  };

  const districtFromRecentSearch = (city: unknown) => {
    const matches = recentPairs.get(key(city));
    if (!matches || matches.size !== 1) return '';
    return Array.from(matches)[0] || '';
  };

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const pathname = new URL(requestUrl, window.location.origin).pathname;

    // Cache the exact City + District pairs that the checkout search returned.
    // This gives us a second safe source if the React field is unavailable for a moment.
    if (method === 'GET' && pathname === '/api/courier/fardar/search') {
      const response = await nativeFetch(input, init);
      try {
        response.clone().json().then((data: any) => cachePairs(data?.cities)).catch(() => undefined);
      } catch {}
      return response;
    }

    try {
      if (method === 'POST' && pathname === '/api/orders' && typeof init?.body === 'string') {
        const payload = JSON.parse(init.body);
        const order = payload?.order;
        if (order && !norm(order.district)) {
          // First choice: the exact district currently shown in Checkout.
          // Fallback: only use a cached city when that city maps to exactly one district.
          // Ambiguous city names are never guessed.
          const district = districtFromCheckoutDom() || districtFromRecentSearch(order.city);
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
