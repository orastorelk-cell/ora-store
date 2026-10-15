export type CourierCityOption = { city: string; district: string };

// Both the native Worker and local server search the same imported courier list.
export const searchCourierCities = (rows: Record<string, any>[], query: string, requestedLimit: unknown = 20) => {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const value = Number(requestedLimit);
  const limit = Number.isFinite(value) ? Math.min(30, Math.max(1, Math.floor(value))) : 20;
  if (q.length < 2) return { ok: true, total: 0, cities: [] as CourierCityOption[] };
  const matches = new Map<string, CourierCityOption>();
  for (const row of rows) {
    const city = String(row.name || row.city_name || row.city || '').trim();
    const district = String(row.district || '').trim();
    if (!city.toLowerCase().replace(/\s+/g, ' ').includes(q)) continue;
    matches.set(city.toLowerCase() + '\n' + district.toLowerCase(), { city, district });
  }
  const rank = (city: string) => {
    const name = city.toLowerCase().replace(/\s+/g, ' ');
    return name === q ? 0 : name.startsWith(q) ? 1 : 2;
  };
  const cities = [...matches.values()].sort((a, b) => rank(a.city) - rank(b.city) || a.city.localeCompare(b.city) || a.district.localeCompare(b.district));
  return { ok: true, total: cities.length, cities: cities.slice(0, limit) };
};
