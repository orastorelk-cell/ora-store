import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { publicStorefrontRequest } from '../src/lib/publicStorefrontRequest';
import { r2MediaHandler } from '../worker/r2PublicMedia';
import { catalogThumbnail } from '../src/lib/catalogThumbnail';

const inline = fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1];
const values = new Map<string, string>();
const requests: string[] = [], links: any[] = [];
const state = { initialized: true, state: { products: [], settings: { website_logo: '/logo.png', hero_banner_image: 'http://[invalid' }, version: 1 } };
let priceRevision = 1;
const fakeWindow: any = { setTimeout, clearTimeout };
const browser: any = {
  window: fakeWindow, localStorage: { getItem: (key: string) => values.get(key) || null },
  location: { pathname: '/', origin: 'https://orastore.test' },
  document: { createElement: () => ({}), head: { appendChild: (link: any) => links.push(link) } },
  URL, AbortController, Date, setTimeout, clearTimeout,
  fetch: async (path: string) => { requests.push(path); await Promise.resolve(); return Response.json({ ...state, priceRevision }); },
};
vm.runInNewContext(inline, browser);
Object.assign(globalThis, { window: fakeWindow, fetch: browser.fetch });
const [first, duplicate] = await Promise.all([publicStorefrontRequest('/api/storefront/state'), publicStorefrontRequest('/api/storefront/state')]);
assert.equal(requests.length, 1, 'HTML prefetch and simultaneous mounts share one request');
assert.equal(first, duplicate);
assert.equal(links.length, 1, 'An invalid preview URL must not break a valid catalog response');
priceRevision = 2;
assert.equal((await publicStorefrontRequest('/api/storefront/state')).priceRevision, 2, 'Future requests must see current prices');
assert.equal(requests.length, 2);
Object.assign(globalThis, { fetch: async () => Response.json({ error: 'Retry' }, { status: 503 }) });
await assert.rejects(publicStorefrontRequest('/api/storefront/state'), /Retry/);
Object.assign(globalThis, { fetch: browser.fetch });
await publicStorefrontRequest('/api/storefront/state');
assert.equal(requests.length, 3, 'Failure does not poison later requests');
values.set('ora_storefront_updated_at', 'saved'); values.set('ora_products', '[]');
vm.runInNewContext(inline, browser);
assert.equal(fakeWindow.__oraStorefrontBoot.path, '/api/storefront/version');
await publicStorefrontRequest('/api/storefront/version');
const beforeStaff = requests.length;
browser.location.pathname = '/system';
vm.runInNewContext(inline, browser);
assert.equal(requests.length, beforeStaff, 'Staff pages must not start public bootstrap requests');
console.log('PASS: early startup, duplicate reads, cache validation, fresh prices, failure retry and staff isolation.');

const edge = new Map<string, Response>();
const waits: Promise<any>[] = [];
const context = { waitUntil: (promise: Promise<any>) => waits.push(promise) };
let reads = 0, writes = 0;
const cache = {
  match: async (request: Request) => edge.get(request.url)?.clone(),
  put: async (request: Request, response: Response) => { edge.set(request.url, new Response(await response.arrayBuffer(), { headers: response.headers })); },
};
Object.assign(globalThis, { caches: { default: cache } });
const env = { ORA_MEDIA_R2: {
  get: async (key: string) => {
    reads++;
    if (key.endsWith('/missing.jpg')) return null;
    return { body: 'unchanged-image-bytes', httpEtag: '"original-etag"', size: 21, writeHttpMetadata: (headers: Headers) => { headers.set('content-type', 'image/jpeg'); } };
  },
  put: async () => { writes++; },
} };
const mediaUrl = 'https://orastore.test/api/media/media/product/sha256/example.jpg';
const cold = (await r2MediaHandler(new Request(mediaUrl), env, context))!;
assert.equal(cold.headers.get('x-ora-media-cache'), 'MISS');
assert.equal(await cold.text(), 'unchanged-image-bytes');
await Promise.all(waits.splice(0));
const warm = (await r2MediaHandler(new Request(mediaUrl + '?ignored=1'), env, context))!;
assert.equal(warm.headers.get('x-ora-media-cache'), 'HIT');
assert.equal(await warm.text(), 'unchanged-image-bytes');
assert.equal(reads, 1, 'Warm public images bypass R2');
const conditional = (await r2MediaHandler(new Request(mediaUrl, { headers: { 'If-None-Match': 'W/"original-etag"' } }), env, context))!;
assert.equal(conditional.status, 304);
assert.equal(await conditional.text(), '');
const privateUrl = 'https://orastore.test/api/media/media/payment-receipt/example.jpg';
for (let i = 0; i < 2; i++) assert.equal((await r2MediaHandler(new Request(privateUrl), env, context))!.headers.get('x-ora-media-cache'), 'BYPASS');
assert.equal(edge.size, 1, 'Receipt bytes never enter the public edge cache');
assert.equal((await r2MediaHandler(new Request('https://orastore.test/api/media/media/product/%ZZ'), env, context))!.status, 400);
assert.equal((await r2MediaHandler(new Request('https://orastore.test/api/media/media/product/missing.jpg'), env, context))!.status, 404);
cache.match = async () => { throw new Error('Cache unavailable'); };
cache.put = async () => { throw new Error('Cache full'); };
assert.equal((await r2MediaHandler(new Request(mediaUrl), env, context))!.status, 200);
await Promise.all(waits.splice(0));
assert.equal(writes, 0, 'Image reads never write original media or operational data');
console.log('PASS: exact image bytes, edge hits, conditional requests, receipt isolation and cache failure fallbacks.');

const handlers: Record<string, (event: any) => void> = {}, shell = new Map<string, Response>();
let networkReads = 0;
const requestKey = (request: any) => typeof request === 'string' ? new URL(request, 'https://orastore.test').href : request.url;
const shellCache = {
  put: async (request: any, response: Response) => { shell.set(requestKey(request), new Response(await response.arrayBuffer(), { headers: response.headers })); },
  keys: async () => [...shell.keys()].map(url => new Request(url)), delete: async (request: any) => shell.delete(requestKey(request)),
};
const browserCache = { match: async (request: any) => shell.get(requestKey(request))?.clone(), open: async () => shellCache };
vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {
  self: { location: { origin: 'https://orastore.test' }, addEventListener: (name: string, handler: any) => { handlers[name] = handler; } },
  URL, Promise,
  caches: browserCache,
  fetch: async () => { networkReads++; return new Response('current-image'); },
});
const swRead = async (path: string) => {
  let response: Promise<Response> | undefined;
  const pending: Promise<any>[] = [];
  handlers.fetch({ request: new Request('https://orastore.test' + path), respondWith: (value: Promise<Response>) => { response = value; }, waitUntil: (value: Promise<any>) => pending.push(value) });
  const result = response && await response;
  await Promise.all(pending);
  return result;
};
await swRead('/api/media/media/product/sha256/example.jpg');
await swRead('/api/media/media/product/sha256/example.jpg');
assert.equal(networkReads, 1, 'Cached public image returns without starting another fetch');
await swRead('/assets/index-aBcDeFg1.js'); await swRead('/assets/index-aBcDeFg1.js');
assert.equal(networkReads, 2, 'Hashed application code also avoids redundant fetches');
browserCache.match = async () => { throw new Error('Browser cache unavailable'); };
assert.equal(await (await swRead('/catalog-thumbnails/000000000000000000000001.webp'))!.text(), 'current-image', 'A browser cache failure still returns the network image');
assert.equal(networkReads, 3);
assert.equal(await swRead('/api/storefront/state'), undefined);
assert.equal(await swRead('/api/orders'), undefined);
assert.equal(await swRead('/api/media/media/payment-receipt/example.jpg'), undefined);
console.log('PASS: service worker reuses immutable files and leaves catalogs, orders and receipts uncached.');

const manifest = JSON.parse(fs.readFileSync('src/data/catalogThumbnails.json', 'utf8'));
assert.ok(Object.keys(manifest).length > 0);
for (const [original, preview] of Object.entries(manifest)) {
  assert.ok(original.startsWith('/api/media/media/product/'));
  const file = fs.readFileSync('public' + preview);
  assert.equal(file.toString('ascii', 8, 12), 'WEBP');
  assert.equal(catalogThumbnail(original), preview);
}
assert.equal(catalogThumbnail('/api/media/media/product/new-upload.jpg'), '/api/media/media/product/new-upload.jpg');
console.log(`PASS: ${Object.keys(manifest).length} valid preview files with original fallback for new uploads.`);
