import type { DataBucket } from './cloudflareData';

type Row = Record<string, any>;
type ObjectState = { value: any; text: string; object: { etag: string; customMetadata?: Record<string, string> } };
type Access = { read: (key: string) => Promise<ObjectState | null>; cache: (key: string, etag: string, text: string, value: any) => void };
type Cell = { id: string; value?: any; deleted?: true };
type Manifest = { format: 'ora-admin-changes-v1'; base_etag: string; count: number; keys: string[]; updated_at: string; shards: Record<string, string>; catalog: {initialized:boolean;updated_at:string} };
const CATALOG = 'storefront-state-v1';
const options = { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }, customMetadata: { oraData: '1' } };
const caches = new WeakMap<DataBucket, Map<string, { revision: string; rows: Row[]; shards: Map<string, Cell[]>; text?: string }>>();
const cellId = (...parts: string[]) => JSON.stringify(parts);
const shardFor = (id: string) => { let hash = 2166136261; for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619); return String((hash >>> 0) % 16); };
const invalid = (): never => { throw new Error('Cloudflare admin journal is missing or invalid.'); };
const same = (a: any, b: any) => a === b || JSON.stringify(a) === JSON.stringify(b);

// Keep the restored table intact. Catalog products and setting fields are cells,
// so changing one stock quantity never encrypts logos or old packing histories.
// One conditional manifest publishes ALL changed cells together, including the
// stock-operation record and catalog change used by the existing transaction guards.
const rowCells = (row: Row): Cell[] => {
  const key = String(row?.key || '');
  if (!key) invalid();
  if (key !== CATALOG) return [{ id: cellId('row', key), value: { kind: 'row', row } }];
  const payload = row.payload;
  if (!payload || !Array.isArray(payload.products) || !Array.isArray(payload.categories) ||
      !payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) invalid();
  const ids = payload.products.map((product: any) => product?.id);
  if (ids.some((id: any) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) invalid();
  const { payload: _payload, ...header } = row;
  const { products, categories, settings, ...metadata } = payload;
  return [
    { id: cellId('row', key), value: { kind: 'catalog', row: header, row_keys: Object.keys(row), payload: metadata, payload_keys: Object.keys(payload), product_ids: ids, setting_keys: Object.keys(settings) } },
    { id: cellId('categories'), value: categories },
    ...products.map((product: any) => ({ id: cellId('product', product.id), value: product })),
    ...Object.entries(settings).map(([name, value]) => ({ id: cellId('setting', name), value })),
  ];
};

const materialize = (base: Row[], changes: Map<string, Cell>) => {
  const cells = new Map<string, any>();
  for (const row of base) for (const cell of rowCells(row)) {
    if (cells.has(cell.id)) invalid();
    cells.set(cell.id, cell.value);
  }
  for (const cell of changes.values()) {
    if (cell.deleted) cells.delete(cell.id);
    else cells.set(cell.id, cell.value);
  }
  const rows: Row[] = [];
  for (const [id, value] of cells) {
    const parts = JSON.parse(id);
    if (parts[0] !== 'row') continue;
    if (value?.kind === 'row' && value.row?.key === parts[1] && parts[1] !== CATALOG) rows.push(value.row);
    else if (value?.kind === 'catalog' && parts[1] === CATALOG && value.row?.key === CATALOG &&
        Array.isArray(value.product_ids) && Array.isArray(value.setting_keys) && Array.isArray(value.row_keys) && Array.isArray(value.payload_keys)) {
      if (new Set(value.product_ids).size !== value.product_ids.length || new Set(value.setting_keys).size !== value.setting_keys.length) invalid();
      const products = value.product_ids.map((productId: string) => {
        const product = cells.get(cellId('product', productId));
        if (!product || product.id !== productId) invalid();
        return product;
      });
      const settings = Object.fromEntries(value.setting_keys.map((name: string) => {
        const key = cellId('setting', name); if (!cells.has(key)) invalid(); return [name, cells.get(key)];
      }));
      const categories = cells.get(cellId('categories')); if (!Array.isArray(categories)) invalid();
      const fields = { ...value.payload, products, categories, settings };
      const payload = Object.fromEntries(value.payload_keys.map((key: string) => [key, fields[key]]));
      rows.push(Object.fromEntries(value.row_keys.map((key: string) => [key, key === 'payload' ? payload : value.row[key]])));
    } else invalid();
  }
  return rows;
};

const validCellId = (id: unknown): id is string => {
  if (typeof id !== 'string') return false;
  let parts: any; try { parts = JSON.parse(id); } catch { return false; }
  return Array.isArray(parts) && parts.every(part => typeof part === 'string' && part.length > 0) &&
    JSON.stringify(parts) === id && (parts.length === 1 && parts[0] === 'categories' ||
    parts.length === 2 && ['row', 'product', 'setting'].includes(parts[0]));
};

export const readAdminJournal = async (bucket: DataBucket, prefix: string, base: ObjectState, access: Access) => {
  const path = prefix + 'admin-changes-v1.json', saved = await access.read(path), manifest: Manifest | null = saved?.value || null;
  if (saved && (!manifest || manifest.format !== 'ora-admin-changes-v1' || manifest.base_etag !== base.object.etag ||
      !Number.isSafeInteger(manifest.count) || manifest.count < 0 || !Number.isFinite(Date.parse(manifest.updated_at)) ||
      !Array.isArray(manifest.keys) || manifest.keys.length !== manifest.count || new Set(manifest.keys).size !== manifest.count || manifest.keys.some(key=>typeof key!=='string'||!key) ||
      !manifest.shards || typeof manifest.shards !== 'object' || Array.isArray(manifest.shards) ||
      Object.entries(manifest.shards).some(([shard, key]) => !/^([0-9]|1[0-5])$/.test(shard) || typeof key !== 'string' ||
        !key.startsWith(prefix + 'admin-changes-v1/' + shard + '/') || !/^\d{13}-[a-f0-9-]+\.json$/.test(key.split('/').pop() || '')))) invalid();
  const revision = saved ? base.object.etag + ':' + saved.object.etag : base.object.etag;
  let cache = caches.get(bucket); if (!cache) { cache = new Map(); caches.set(bucket, cache); }
  let merged = cache.get(prefix);
  if (merged?.revision !== revision) {
    const shards = new Map<string, Cell[]>(), changes = new Map<string, Cell>();
    const entries = Object.entries(manifest?.shards || {});
    for (let offset = 0; offset < entries.length; offset += 4) await Promise.all(entries.slice(offset, offset + 4).map(async ([shard, key]) => {
      const part = await access.read(key); if (!part || !Array.isArray(part.value)) invalid();
      const seen = new Set<string>();
      for (const cell of part!.value as Cell[]) {
        if (!cell || !validCellId(cell.id) || seen.has(cell.id) || shardFor(cell.id) !== shard ||
            cell.deleted !== undefined && cell.deleted !== true || cell.deleted !== true && !Object.hasOwn(cell, 'value')) invalid();
        seen.add(cell.id); changes.set(cell.id, cell);
      }
      shards.set(shard, part!.value);
    }));
    let rows = saved ? materialize(base.value, changes) : base.value as Row[];
    if (manifest && rows.length !== manifest.count) invalid();
    if(manifest){const byKey=new Map(rows.map(row=>[String(row.key),row]));rows=manifest.keys.map(key=>{const row=byKey.get(key);if(!row)invalid();return row!;});}
    merged = { revision, rows, shards, ...(!saved ? { text: base.text } : {}) }; cache.set(prefix, merged);
    if (cache.size > 2) cache.delete(cache.keys().next().value!);
  }
  return { rows: merged!.rows, etag: revision, get text() { return merged!.text ?? (merged!.text = JSON.stringify(merged!.rows)); },
    journal: undefined, adminJournal: { path, saved, manifest, base, shards: merged!.shards, access },
    customMetadata: manifest ? { oraCount: String(manifest.count), oraUpdatedAt: manifest.updated_at } : base.object.customMetadata };
};

export const writeAdminJournal = async (bucket: DataBucket, prefix: string, state: Awaited<ReturnType<typeof readAdminJournal>>, rows: readonly Row[]) => {
  const previous = new Map(state.rows.map(row => [String(row.key), row])), changed = new Map<string, Cell>(), seen = new Set<string>();
  for (const row of rows) {
    const key = String(row?.key || ''); if (!key || seen.has(key)) invalid(); seen.add(key);
    const old = previous.get(key); previous.delete(key);
    if (old === row) continue;
    const before = new Map((old ? rowCells(old) : []).map(cell => [cell.id, cell]));
    for (const cell of rowCells(row)) {
      if (!before.has(cell.id) || !same(before.get(cell.id)!.value, cell.value)) changed.set(cell.id, cell);
      before.delete(cell.id);
    }
    for (const id of before.keys()) changed.set(id, { id, deleted: true });
  }
  for (const row of previous.values()) for (const cell of rowCells(row)) changed.set(cell.id, { id: cell.id, deleted: true });
  if (!changed.size) return true;
  const { adminJournal: journal } = state, now = new Date().toISOString(), commit = Date.now() + '-' + crypto.randomUUID();
  const shards = { ...journal.manifest?.shards }, updates = new Map<string, Map<string, Cell>>();
  for (const cell of changed.values()) {
    const shard = shardFor(cell.id); let part = updates.get(shard);
    if (!part) { part = new Map((journal.shards.get(shard) || []).map(cell => [cell.id, cell])); updates.set(shard, part); }
    part.set(cell.id, cell);
  }
  for (const [shard, part] of updates) {
    const key = prefix + 'admin-changes-v1/' + shard + '/' + commit + '.json', value = Array.from(part.values()), text = JSON.stringify(value);
    const saved = await bucket.put(key, text, { ...options, onlyIf: { etagDoesNotMatch: '*' } });
    if (!saved) throw new Error('Admin changes could not be staged. Retry this same save.');
    journal.access.cache(key, saved.etag, text, value); shards[shard] = key;
  }
  const hour = Math.floor(Date.now() / 3_600_000), backup = 'ora-data/backups-v2/admin_data_store/' + hour % 168 + '.json', old = await bucket.get(backup);
  if (old?.customMetadata?.hour !== String(hour)) await bucket.put(backup, JSON.stringify({ format: 'ora-admin-checkpoint-v1', base_key: prefix + 'admin_data_store.json', base_etag: journal.base.object.etag, changes: journal.manifest, count: state.rows.length, created_at: now }),
    { ...options, customMetadata: { oraData: '1', hour: String(hour), createdAt: now }, onlyIf: old ? { etagMatches: old.etag } : { etagDoesNotMatch: '*' } });
  const catalog=rows.find(row=>row.key===CATALOG);
  const manifest: Manifest = { format: 'ora-admin-changes-v1', base_etag: journal.base.object.etag, count: rows.length, keys: rows.map(row=>String(row.key)), updated_at: now, shards,
    catalog:{initialized:Boolean(catalog),updated_at:String(catalog?.updated_at||catalog?.payload?.updated_at||'')} }, text = JSON.stringify(manifest);
  const saved = await bucket.put(journal.path, text, { ...options, customMetadata: { oraData: '1', oraCount: String(rows.length), oraUpdatedAt: now }, onlyIf: journal.saved ? { etagMatches: journal.saved.object.etag } : { etagDoesNotMatch: '*' } });
  if (!saved) return false;
  journal.access.cache(journal.path, saved.etag, text, manifest);
  return true;
};
