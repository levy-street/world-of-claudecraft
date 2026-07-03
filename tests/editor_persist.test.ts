import { describe, expect, it } from 'vitest';
import {
  customMapFromContent,
  customMapToWorldContent,
  newCustomMap,
} from '../src/editor/custom_map';
import { type KeyValueStore, MapStore, parseMap, serializeMap } from '../src/editor/persist';

function memStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

describe('CustomMap build + projection', () => {
  it('newCustomMap seeds from the built-in world and is non-empty', () => {
    const map = newCustomMap('My Map', 'id1', 1000);
    expect(map.content.zones.length).toBeGreaterThan(0);
    expect(map.meta.name).toBe('My Map');
    expect(map.terrainEdits).toEqual([]);
  });

  it('projects to a WorldContent the engine can consume', () => {
    const map = newCustomMap('M', 'id', 0);
    map.terrainEdits.push({ x: 0, z: 0, radius: 10, delta: 5, falloff: 'smooth' });
    const w = customMapToWorldContent(map);
    expect(Array.isArray(w.zones)).toBe(true);
    expect(w.props).toBeTruthy();
    expect(w.playerStart).toBeTruthy();
    expect(w.terrainEdits).toHaveLength(1);
  });

  it('customMapFromContent deep-clones (independent of later edits)', () => {
    const content = {
      zones: [
        {
          id: 'z',
          name: 'Z',
          zMin: -10,
          zMax: 10,
          levelRange: [1, 2] as [number, number],
          biome: 'vale' as never,
          hub: { x: 0, z: 0, radius: 5, name: 'H' },
          graveyard: { x: 0, z: 0 },
          lakes: [],
          pois: [],
          welcome: '',
        },
      ],
      camps: [],
      npcs: {},
      objects: [],
      roads: [],
    };
    const map = customMapFromContent(content, {
      meta: {
        id: 'a',
        name: 'A',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        seed: 1,
        parentId: '',
      },
    });
    content.zones[0].hub.x = 999;
    expect(map.content.zones[0].hub.x).toBe(0); // clone, not the live ref
  });
});

describe('serialize / parse round-trip', () => {
  it('round-trips a map exactly', () => {
    const map = newCustomMap('Round', 'rid', 42);
    map.terrainEdits.push({ x: 1, z: 2, radius: 8, delta: -3, falloff: 'flat' });
    map.placements.push({ assetId: 'props/well', x: 5, z: 6, rotY: 1, scale: 2, collide: true });
    const parsed = parseMap(serializeMap(map));
    expect(parsed).not.toBeNull();
    expect(parsed!.terrainEdits).toEqual(map.terrainEdits);
    expect(parsed!.placements).toEqual(map.placements);
    expect(parsed!.content.zones.length).toBe(map.content.zones.length);
  });

  it('rejects unsalvageable input (no usable zones)', () => {
    expect(parseMap('not json')).toBeNull();
    expect(parseMap('{}')).toBeNull();
    expect(parseMap({ content: { zones: [] } })).toBeNull();
    expect(parseMap({ content: { zones: [{ name: 'no z-band' }] } })).toBeNull();
  });

  it('clamps/def-fills garbage fields instead of crashing', () => {
    const dirty = {
      content: {
        zones: [{ zMin: -5, zMax: 5, hub: { x: 0, z: 0 } }],
        // camps/npcs/objects/roads missing entirely
      },
      terrainEdits: [
        { x: 0, z: 0, radius: 10, delta: 4, falloff: 'smooth' },
        { x: 1, z: 1, radius: -1, delta: 4, falloff: 'smooth' }, // bad radius -> dropped
        'garbage',
      ],
      placements: [{ assetId: 'props/well', x: 1, z: 1 }, { x: 1 }], // 2nd dropped (no id)
      meta: { name: 123 }, // wrong type -> def-filled
    };
    const parsed = parseMap(dirty);
    expect(parsed).not.toBeNull();
    expect(parsed!.content.camps).toEqual([]);
    expect(parsed!.content.roads).toEqual([]);
    expect(parsed!.terrainEdits).toHaveLength(1);
    expect(parsed!.placements).toHaveLength(1);
    expect(parsed!.placements[0].scale).toBe(1); // def-filled
    expect(parsed!.meta.name).toBe('Untitled Map'); // def-filled
  });
});

describe('MapStore', () => {
  it('saves, lists, loads, and removes maps', () => {
    const store = new MapStore(memStore());
    const a = newCustomMap('Alpha', 'a', 100);
    const b = newCustomMap('Beta', 'b', 200);
    expect(store.save(a)).toBe(true);
    expect(store.save(b)).toBe(true);
    const list = store.list();
    expect(list.map((m) => m.id).sort()).toEqual(['a', 'b']);
    // list is sorted by updatedAt desc: Beta (200) first
    expect(list[0].id).toBe('b');
    expect(store.load('a')?.meta.name).toBe('Alpha');
    expect(store.remove('a')).toBe(true);
    expect(store.load('a')).toBeNull();
    expect(store.list().map((m) => m.id)).toEqual(['b']);
  });

  it('degrades gracefully with no storage', () => {
    const store = new MapStore(null);
    expect(store.save(newCustomMap('X', 'x', 0))).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.load('x')).toBeNull();
  });
});
