import { describe, expect, it } from 'vitest';
import { newCustomMap } from '../src/editor/custom_map';
import { type KeyValueStore, MapStore, serializeMapCompact } from '../src/editor/persist';

const LEGACY_KEY = 'woc_editor_maps';
const INDEX_KEY = 'woc_editor_maps_index';
const mapKey = (id: string): string => `woc_editor_map:${id}`;

interface MemStorage extends KeyValueStore {
  data: Map<string, string>;
  writes: string[]; // keys, in setItem order
}

function memStorage(): MemStorage {
  const data = new Map<string, string>();
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(k);
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

describe('MapStore (per-map keys + meta index)', () => {
  it('saves each map under its own key plus one small index', () => {
    const s = memStorage();
    const store = new MapStore(s);
    expect(store.save(newCustomMap('Alpha', 'a', 100))).toBe(true);
    expect(store.save(newCustomMap('Beta', 'b', 200))).toBe(true);
    expect(s.data.has(mapKey('a'))).toBe(true);
    expect(s.data.has(mapKey('b'))).toBe(true);
    expect(s.data.has(INDEX_KEY)).toBe(true);
    expect(s.data.has(LEGACY_KEY)).toBe(false);
  });

  it('REGRESSION: saving map B never rewrites map A bytes', () => {
    // Audit M: the single-blob store re-stringified EVERY map on each save,
    // so a cross-tab read-modify-write could drop a whole map.
    const s = memStorage();
    const store = new MapStore(s);
    store.save(newCustomMap('Alpha', 'a', 100));
    s.writes.length = 0;
    store.save(newCustomMap('Beta', 'b', 200));
    expect(s.writes).not.toContain(mapKey('a'));
    expect(s.writes).toContain(mapKey('b'));
  });

  it('stores compact JSON (no pretty-print inflation)', () => {
    const s = memStorage();
    const store = new MapStore(s);
    const map = newCustomMap('Compact', 'c', 1);
    store.save(map);
    const raw = s.data.get(mapKey('c'));
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('\n');
    expect(raw).toBe(serializeMapCompact(map));
  });

  it('list() reads metas from the index, not the full documents', () => {
    const s = memStorage();
    const store = new MapStore(s);
    store.save(newCustomMap('Alpha', 'a', 100));
    store.save(newCustomMap('Beta', 'b', 200));
    // Corrupt a stored document: list must still work purely off the index.
    s.data.set(mapKey('a'), 'not json at all');
    const list = store.list();
    expect(list.map((m) => m.id)).toEqual(['b', 'a']); // updatedAt desc
    expect(list[1].name).toBe('Alpha');
  });

  it('load/remove round-trip', () => {
    const s = memStorage();
    const store = new MapStore(s);
    store.save(newCustomMap('Alpha', 'a', 100));
    expect(store.load('a')?.meta.name).toBe('Alpha');
    expect(store.remove('a')).toBe(true);
    expect(store.load('a')).toBeNull();
    expect(store.list()).toEqual([]);
    expect(store.remove('a')).toBe(false);
  });

  it('a quota failure on one save leaves the other maps intact', () => {
    const s = memStorage();
    const base = s.setItem.bind(s);
    let fail = false;
    s.setItem = (k, v) => {
      if (fail) throw new Error('quota');
      base(k, v);
    };
    const store = new MapStore(s);
    store.save(newCustomMap('Alpha', 'a', 100));
    fail = true;
    expect(store.save(newCustomMap('Huge', 'huge', 200))).toBe(false);
    fail = false;
    expect(store.load('a')?.meta.name).toBe('Alpha');
    expect(store.list().map((m) => m.id)).toEqual(['a']);
  });

  it('migrates the legacy single-blob store on first access', () => {
    const s = memStorage();
    const a = newCustomMap('Old Alpha', 'a', 100);
    const b = newCustomMap('Old Beta', 'b', 200);
    s.data.set(LEGACY_KEY, JSON.stringify({ a, b }));
    const store = new MapStore(s);
    const list = store.list();
    expect(list.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(store.load('a')?.meta.name).toBe('Old Alpha');
    // Moved out of the blob into per-map keys.
    expect(s.data.has(LEGACY_KEY)).toBe(false);
    expect(s.data.has(mapKey('a'))).toBe(true);
    expect(s.data.has(mapKey('b'))).toBe(true);
  });

  it('degrades gracefully with no storage', () => {
    const store = new MapStore(null);
    expect(store.save(newCustomMap('X', 'x', 0))).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.load('x')).toBeNull();
    expect(store.remove('x')).toBe(false);
  });
});
