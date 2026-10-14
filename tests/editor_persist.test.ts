import { describe, expect, it } from 'vitest';
import {
  customMapFromContent,
  customMapToWorldContent,
  newCustomMap,
} from '../src/editor/custom_map';
import { type KeyValueStore, MapStore, parseMap, serializeMap } from '../src/editor/persist';
import { BUILTIN_WORLD } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';

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
    expect(w.props).not.toBe(BUILTIN_WORLD.props);
    expect(w.props.buildings).not.toBe(BUILTIN_WORLD.props.buildings);
    expect(w.playerStart).toBeTruthy();
    expect(w.terrainEdits).toHaveLength(1);
  });

  // Studio keeps the authored towns' (Eastbrook Vale, Fenbridge) buildings,
  // wells, stalls and fences on a custom map (commit 1c426ac1ba,
  // custom_world_props.ts clonePropsKeepingAuthoredTowns): with those records
  // stripped the authored town subtrees had nothing to gate on and the editor
  // drew the pre-rebuild kit stand-ins instead of the live game's town. Only
  // those four categories have a matching skip on the generic prop path, so
  // the benches, walls and town graveyard stay stripped (restoring them would
  // draw them twice). The full-world STATIC projection (no propsMode, the
  // shape this test was written for) is pinned below; Studio's default
  // editable-all mode promotes the remaining props to placements, so it is
  // pinned separately at the end, for the town records alone.
  it('keeps the authored-town props, strips the rest, and fresh-clones exterior props', () => {
    const staticMap = newCustomMap('M', 'id', 0);
    staticMap.propsMode = undefined;
    const world = customMapToWorldContent(staticMap);
    const eastbrookIds = {
      buildings: new Set<string>([
        ...EASTBROOK_LAYOUT.preservedBuildings.map((placement) => placement.id),
        ...EASTBROOK_LAYOUT.buildings.map((placement) => placement.id),
      ]),
      wells: new Set<string>([EASTBROOK_LAYOUT.civic.monument.id]),
      stalls: new Set<string>(EASTBROOK_LAYOUT.market.stalls.map((placement) => placement.id)),
      fences: new Set<string>(EASTBROOK_LAYOUT.fences.map((placement) => placement.id)),
      benches: new Set<string>(EASTBROOK_LAYOUT.civic.benches.map((placement) => placement.id)),
      walls: new Set<string>(EASTBROOK_LAYOUT.wall.segments.map((placement) => placement.id)),
    };
    const builtInOnlyWallIds = new Set<string>([
      ...eastbrookIds.walls,
      ...FENBRIDGE_LAYOUT.wall.segments.map((placement) => placement.id),
    ]);
    const builtInOnlyBuildingIds = new Set<string>([
      ...eastbrookIds.buildings,
      ...FENBRIDGE_LAYOUT.buildings.map((placement) => placement.id),
    ]);
    const builtInOnlyWellIds = new Set<string>([
      ...eastbrookIds.wells,
      FENBRIDGE_LAYOUT.civic.cistern.id,
    ]);
    const builtInOnlyStallIds = new Set<string>([
      ...eastbrookIds.stalls,
      FENBRIDGE_LAYOUT.civic.provisionStall.id,
    ]);

    // The authored towns' records ride along, in full and in order.
    const ids = (records: readonly { id?: string }[]): string[] =>
      records.map(({ id }) => id).filter((id): id is string => id !== undefined);
    expect(ids(world.props.buildings).filter((id) => builtInOnlyBuildingIds.has(id))).toEqual(
      ids(BUILTIN_WORLD.props.buildings).filter((id) => builtInOnlyBuildingIds.has(id)),
    );
    expect(ids(world.props.buildings).some((id) => builtInOnlyBuildingIds.has(id))).toBe(true);
    expect(ids(world.props.wells).filter((id) => builtInOnlyWellIds.has(id))).toEqual(
      ids(BUILTIN_WORLD.props.wells).filter((id) => builtInOnlyWellIds.has(id)),
    );
    expect(ids(world.props.stalls).filter((id) => builtInOnlyStallIds.has(id))).toEqual(
      ids(BUILTIN_WORLD.props.stalls).filter((id) => builtInOnlyStallIds.has(id)),
    );
    expect(ids(world.props.fences).filter((id) => eastbrookIds.fences.has(id))).toEqual(
      ids(BUILTIN_WORLD.props.fences).filter((id) => eastbrookIds.fences.has(id)),
    );
    // ...while the categories with no generic-path skip stay stripped.
    expect(
      (world.props.benches ?? [])
        .map((placement) => placement.id)
        .filter((id) => eastbrookIds.benches.has(id)),
    ).toEqual([]);
    expect(
      (world.props.walls ?? [])
        .map((placement) => placement.id)
        .filter((id) => builtInOnlyWallIds.has(id)),
    ).toEqual([]);

    expect(world.props.buildings).toEqual(BUILTIN_WORLD.props.buildings);
    expect(world.props.wells).toEqual(BUILTIN_WORLD.props.wells);
    expect(world.props.stalls).toEqual(BUILTIN_WORLD.props.stalls);
    expect(world.props.fences).toEqual(BUILTIN_WORLD.props.fences);
    expect(world.props.benches).toEqual(
      (BUILTIN_WORLD.props.benches ?? []).filter(({ id }) => !eastbrookIds.benches.has(id)),
    );
    expect(world.props.walls).toEqual(
      (BUILTIN_WORLD.props.walls ?? []).filter(({ id }) => !builtInOnlyWallIds.has(id)),
    );

    const eastbrookGraveyard = EASTBROOK_LAYOUT.services.graveyard.position;
    expect(world.props.graveyards).toEqual(
      BUILTIN_WORLD.props.graveyards.filter(
        ({ x, z }) => x !== eastbrookGraveyard.x || z !== eastbrookGraveyard.z,
      ),
    );
    expect(world.props.mines).toEqual(BUILTIN_WORLD.props.mines);
    expect(world.props.docks).toEqual(BUILTIN_WORLD.props.docks);
    expect(world.props.tents).toEqual(BUILTIN_WORLD.props.tents);
    expect(world.props.crates).toEqual(BUILTIN_WORLD.props.crates);
    expect(world.props.campfires).toEqual(BUILTIN_WORLD.props.campfires);
    expect(world.props.mudHuts).toEqual(BUILTIN_WORLD.props.mudHuts);
    expect(world.props.ruinRings).toEqual(BUILTIN_WORLD.props.ruinRings);
    expect(world.props.delveMarkers).toEqual(BUILTIN_WORLD.props.delveMarkers);

    const exteriorValeMine = BUILTIN_WORLD.props.mines.find(({ x, z }) => x === -38 && z === 138);
    const fenbridgeInn = BUILTIN_WORLD.props.buildings.find(
      ({ id }) => id === 'fenbridge_crooked_reed_inn',
    );
    const highwatchForge = BUILTIN_WORLD.props.stalls.find(
      ({ x, z, smithy }) => x === -4.5 && z === 673.5 && smithy,
    );
    const templeCampfire = BUILTIN_WORLD.props.campfires.find(([x, z]) => x === -63 && z === 788);
    expect(exteriorValeMine).toBeDefined();
    expect(fenbridgeInn).toMatchObject({
      id: 'fenbridge_crooked_reed_inn',
      assetId: '/models/props/fenbridge_crooked_reed_inn.glb',
      x: -21.25,
      z: 317,
    });
    expect(highwatchForge).toBeDefined();
    expect(templeCampfire).toBeDefined();
    expect(world.props.mines).toContainEqual(exteriorValeMine);
    expect(world.props.buildings).toContainEqual(fenbridgeInn);
    expect(world.props.buildings.find(({ id }) => id === 'fenbridge_crooked_reed_inn')).not.toBe(
      fenbridgeInn,
    );
    expect(world.props.wells.some(({ id }) => id === FENBRIDGE_LAYOUT.civic.cistern.id)).toBe(true);
    expect(
      world.props.stalls.some(({ id }) => id === FENBRIDGE_LAYOUT.civic.provisionStall.id),
    ).toBe(true);
    expect(world.props.stalls).toContainEqual(highwatchForge);
    expect(world.props.campfires).toContainEqual(templeCampfire);
    expect(world.props.mines.find(({ x, z }) => x === -38 && z === 138)).not.toBe(exteriorValeMine);
    expect(world.props.stalls.find(({ x, z }) => x === -4.5 && z === 673.5)).not.toBe(
      highwatchForge,
    );
    expect(world.props.campfires.find(([x, z]) => x === -63 && z === 788)).not.toBe(templeCampfire);
    expect(world.props.docks[0]).not.toBe(BUILTIN_WORLD.props.docks[0]);
    expect(world.props.docks[0].hutLocal).not.toBe(BUILTIN_WORLD.props.docks[0].hutLocal);

    // Studio's default (editable-all) map keeps the town buildings static too
    // (everything else became an editable placement).
    const editable = customMapToWorldContent(newCustomMap('M', 'id', 0));
    const townBuildings = ids(BUILTIN_WORLD.props.buildings).filter((id) =>
      builtInOnlyBuildingIds.has(id),
    );
    expect(townBuildings.length).toBeGreaterThan(0);
    expect(ids(editable.props.buildings)).toEqual(expect.arrayContaining(townBuildings));
    expect(editable.props.buildings.length).toBeLessThan(BUILTIN_WORLD.props.buildings.length);
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
    expect(parsed?.terrainEdits).toEqual(map.terrainEdits);
    expect(parsed?.placements).toEqual(map.placements);
    expect(parsed?.content.zones.length).toBe(map.content.zones.length);
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
    expect(parsed?.content.camps).toEqual([]);
    expect(parsed?.content.roads).toEqual([]);
    expect(parsed?.terrainEdits).toHaveLength(1);
    expect(parsed?.placements).toHaveLength(1);
    expect(parsed?.placements[0].scale).toBe(1); // def-filled
    expect(parsed?.meta.name).toBe('Untitled Map'); // def-filled
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
