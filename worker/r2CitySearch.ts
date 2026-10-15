import { readDataTable } from './cloudflareData';
import { searchCourierCities } from '../src/lib/courierCitySearch';

export const r2CitySearchHandler = async (request: Request, env: unknown): Promise<Response | null> => {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/courier/fardar/search') return null;
  const query = (url.searchParams.get('q') || '').trim();
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ora-storage': 'cloudflare-r2' };
  if (query.length > 100) return new Response(JSON.stringify({ error: 'City search is too long.' }), { status: 400, headers });
  // Checkout needs neither a staff session nor a working Supabase project/key.
  // Only public city/district fields leave the encrypted courier table.
  const rows = query.length < 2 ? [] : await readDataTable(env, 'fardar_cities');
  return new Response(JSON.stringify(searchCourierCities(rows, query, url.searchParams.get('limit') ?? 20)), { headers });
};
