import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { create, act } from 'react-test-renderer';
import { ACTIVE_KEY, dataBucket, replaceDataTable } from '../worker/cloudflareData';
import { withR2DataFallback } from '../worker/r2RecoveryFallback';
import { CityAutocomplete } from '../src/components/CityAutocomplete';

class MemoryBucket {
  objects = new Map<string, { value: string; etag: string }>();
  revision = 0;
  fail = false;
  async get(key: string) {
    if (this.fail) throw new Error('City storage unavailable');
    const object = this.objects.get(key);
    return object ? { etag: object.etag, text: async () => object.value } : null;
  }
  async put(key: string, value: string, options: any = {}) {
    const existing = this.objects.get(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== existing?.etag) return null;
    const etag = String(++this.revision);
    this.objects.set(key, { value, etag });
    return { etag };
  }
}
const raw = new MemoryBucket();
// Deliberately no Supabase URL or key: public checkout must use only R2.
const env = { ORA_MEDIA_R2: raw, STAFF_SESSION_SECRET: 'synthetic-city-test', ORA_R2_COMPRESSION_ENABLED: '1' };
const bucket = dataBucket(env)!;
const prefix = 'ora-data/generations/city-test/';
await bucket.put(ACTIVE_KEY, JSON.stringify({ format: 'ora-r2-tables-v2', prefix }));
await bucket.put(prefix + 'fardar_cities.json', JSON.stringify([
  { id: '1', name: 'Parana Veyangoda', district: 'Gampaha', code: 'private-code' },
  { id: '2', name: 'Veyangoda Town', district: 'Gampaha' },
  { id: '3', name: 'Veyangoda', district: 'Gampaha' },
  { id: '4', name: 'Naiwala', district: 'Gampaha' },
  { id: '5', name: 'Veyangoda', district: 'Gampaha' },
  { id: '6', name: 'කොළඹ', district: 'Colombo' },
  ...Array.from({ length: 40 }, (_, index) => ({ id: 'sample-' + index, name: 'Test City ' + index, district: 'Test' })),
]));
const writes = raw.revision;
let bridged = 0;
const search = (query: string, limit?: string) => withR2DataFallback(new Request('https://store.test/api/courier/fardar/search?q=' + encodeURIComponent(query) + (limit ? '&limit=' + limit : '')), env, {}, async () => {
  bridged++;
  throw new Error('Public cities must never enter Express or Supabase');
});
const found = await search(' VEYANGODA ');
assert.equal(found.status, 200);
assert.equal(found.headers.get('x-ora-storage'), 'cloudflare-r2');
assert.deepEqual(await found.json(), { ok: true, total: 3, cities: [
  { city: 'Veyangoda', district: 'Gampaha' }, { city: 'Veyangoda Town', district: 'Gampaha' }, { city: 'Parana Veyangoda', district: 'Gampaha' },
] });
assert.deepEqual((await (await search('Na')).json()).cities[0], { city: 'Naiwala', district: 'Gampaha' });
assert.equal((await (await search('කොළ')).json()).cities[0].city, 'කොළඹ');
assert.equal((await (await search('Test', '500')).json()).cities.length, 30);
assert.equal((await (await search('Test', 'NaN')).json()).cities.length, 20);
assert.equal((await (await search('Test', '-2')).json()).cities.length, 1);
assert.equal((await (await search('Test', '2.8')).json()).cities.length, 2);
assert.equal((await (await search('Test')).json()).total, 40);
assert.equal((await (await search('%_')).json()).cities.length, 0);
assert.equal((await search('a'.repeat(101))).status, 400);
assert.equal(raw.revision, writes, 'Public city queries must never write storage');
assert.equal(bridged, 0);
await replaceDataTable(env, 'fardar_cities', rows => ({ rows: [...rows, { id: 'new', name: 'New Imported City', district: 'Galle' }], result: true }));
assert.equal((await (await search('New Imported')).json()).cities[0].district, 'Galle', 'Courier imports must become searchable without redeployment');
raw.fail = true;
const failed = await search('Naiwala');
assert.equal(failed.status, 503, 'A failed read must be visible, not an empty success');
assert.equal(failed.headers.get('retry-after'), '2');
raw.fail = false;
assert.equal((await search('Naiwala')).status, 200);
console.log('PASS: native encrypted R2 city search, no Supabase credentials/bridge, public fields only, ranking, limits, imports and storage failure recovery.');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const originalFetch = globalThis.fetch;
const requests: { url: string; signal: AbortSignal; resolve: (response: Response) => void }[] = [];
globalThis.fetch = ((url: any, options: any) => new Promise<Response>(resolve => requests.push({ url: String(url), signal: options.signal, resolve }))) as typeof fetch;
let ui: any;
const Harness = () => {
  const [address, setAddress] = useState({ city: '', district: '' });
  return <><CityAutocomplete value={address.city} language="en"
    onChange={city => setAddress({ city, district: '' })} onSelect={city => setAddress(city)} />
    <output>{address.district}</output></>;
};
const input = () => ui.root.findByType('input');
const options = () => ui.root.findAllByProps({ role: 'option' });
const text = () => JSON.stringify(ui.toJSON());
const debounce = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 280)); });
const change = async (value: string) => { await act(async () => input().props.onChange({ target: { value } })); await debounce(); };
const answer = async (request: typeof requests[number], body: any, status = 200) => {
  await act(async () => { request.resolve(Response.json(body, { status })); await new Promise(resolve => setImmediate(resolve)); });
};
try {
  await act(async () => { ui = create(<Harness />); });
  await act(async () => input().props.onFocus());
  await change('N');
  assert.equal(requests.length, 0, 'One-letter queries wait for more input');
  await change('Co');
  const oldRequest = requests.at(-1)!;
  await change('Na');
  const currentRequest = requests.at(-1)!;
  assert(oldRequest.signal.aborted, 'Typing a new city aborts the previous lookup');
  await answer(currentRequest, { cities: [{ city: 'Naiwala', district: 'Gampaha' }] });
  assert.equal(options().length, 1, 'Two letters show the dropdown');
  assert.equal(input().props['aria-expanded'], true);
  await answer(oldRequest, { cities: [{ city: 'Colombo', district: 'Colombo' }] });
  assert.equal(options().length, 1);
  assert.equal(options()[0].findAllByType('span')[0].children[0], 'Naiwala', 'Late responses cannot replace the current list');
  await act(async () => options()[0].props.onClick());
  assert.equal(input().props.value, 'Naiwala');
  assert.deepEqual(ui.root.findByType('output').children, ['Gampaha']);
  assert.equal(options().length, 0, 'Selecting a city closes its dropdown');
  await change('Kandy');
  assert.deepEqual(ui.root.findByType('output').children, [], 'Changing city clears the previous district');
  await answer(requests.at(-1)!, { error: 'Storage unavailable' }, 503);
  assert(text().includes('Could not load cities.') && text().includes('Try again'));
  await act(async () => ui.root.findAllByType('button').find((button: any) => button.children.includes('Try again')).props.onClick());
  await debounce();
  await answer(requests.at(-1)!, { cities: [{ city: 'Kandy', district: 'Kandy' }] });
  let prevented = false;
  await act(async () => input().props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true; } }));
  assert(prevented, 'Enter selects a suggestion without submitting the order');
  assert.deepEqual(ui.root.findByType('output').children, ['Kandy']);
  await change('Galle');
  await answer(requests.at(-1)!, { cities: [] });
  assert(text().includes('No matching city.'));
  await change('Matara');
  const lastRequest = requests.at(-1)!;
  await act(async () => ui.unmount());
  assert(lastRequest.signal.aborted, 'Closing checkout cancels a pending lookup');
  console.log('PASS: two-letter dropdown, stale response cancellation, city/district selection, error/retry, empty results, keyboard selection and unmount cleanup.');
} finally {
  globalThis.fetch = originalFetch;
}
