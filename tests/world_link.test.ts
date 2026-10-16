// Link-to-World: the worldAnchor doc field (map_doc.ts sanitizer) and the
// linked playtest projection (custom_map.ts linkedWorldContent), an authored
// map anchored into the world embeds its layers at the offset while the FULL
// built-in world keeps running around it.

import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent, mapBounds, newFlatCustomMap } from '../src/editor/custom_map';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { terrainHeight } from '../src/sim/world';

const NOW = 1752710400000; // 2026-07-17

function blankMap() {
  return newFlatCustomMap('Linked Test', 'map_link_test', NOW, { width: 60, height: 60 });
}

describe('worldAnchor document field', () => {
  it('round-trips through the sanitizer and clamps junk', () => {
    const map = blankMap();
    map.worldAnchor = { x: 500, z: 1200 };
    const doc = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(doc?.worldAnchor).toEqual({ x: 500, z: 1200 });

    const junk = sanitizeMapDoc(
      JSON.parse(JSON.stringify({ ...map, worldAnchor: { x: 'nope', z: 3 } })),
    );
    expect(junk?.worldAnchor).toBeUndefined();
  });
});

describe('generated terrain (terrainBase)', () => {
  afterEach(() => setActiveWorldContent(null));

  it('round-trips through the sanitizer', () => {
    const map = blankMap();
    map.terrainBase = { x: -120, z: 950 };
    const doc = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(doc?.terrainBase).toEqual({ x: -120, z: 950 });
  });

  it('samples the shipped heightfield at the picked offset, edits on top', () => {
    const map = blankMap();
    map.terrainEdits = []; // generation clears the flat-slate stamps
    const world = customMapToWorldContent(map);
    const SEED = 20061;

    // Flat slate without a source.
    setActiveWorldContent(world);
    expect(terrainHeight(3, 7, SEED)).toBe(0);

    // With a source: non-flat, and translating the source translates the
    // field (the sampling contract, without reaching into baseHeight).
    const src = { x: 40, z: 620 };
    setActiveWorldContent({ ...world, terrainBase: src });
    const h1 = terrainHeight(3, 7, SEED);
    setActiveWorldContent({ ...world, terrainBase: { x: src.x + 11, z: src.z - 23 } });
    const h2 = terrainHeight(3 - 11, 7 + 23, SEED);
    expect(h1).toBe(h2);
    setActiveWorldContent({ ...world, terrainBase: src });
    const samples = [terrainHeight(0, 0, SEED), terrainHeight(25, 40, SEED), h1];
    expect(samples.some((h) => Math.abs(h) > 0.05)).toBe(true);
  });

  it('rides the standalone projection but never the linked one', () => {
    const map = blankMap();
    map.terrainBase = { x: 40, z: 620 };
    expect(customMapToWorldContent(map).terrainBase).toEqual({ x: 40, z: 620 });
    map.worldAnchor = { x: 500, z: 1200 };
    expect(customMapToWorldContent(map).terrainBase).toBeUndefined();
  });
});

describe('linked terrain stamp (linkedMap region override)', () => {
  afterEach(() => setActiveWorldContent(null));
  const SEED = 20061;

  it('projects the linkedMap region (bounds + terrainBase) for the world to read', () => {
    const map = blankMap();
    map.terrainBase = { x: 40, z: 620 };
    map.worldAnchor = { x: 500, z: 1200 };
    const world = customMapToWorldContent(map);
    expect(world.linkedMap).toEqual({
      anchor: { x: 500, z: 1200 },
      minX: -30,
      maxX: 30,
      minZ: -30,
      maxZ: 30,
      terrainBase: { x: 40, z: 620 },
    });
  });

  it("replaces the overworld base with the map's own terrain inside the rect", () => {
    const map = blankMap();
    map.terrainEdits = []; // isolate the override from the flatten stamps
    map.worldAnchor = { x: 500, z: 1200 };
    const world = customMapToWorldContent(map);

    setActiveWorldContent(null);
    const builtinCenter = terrainHeight(500, 1200, SEED);
    const builtinFar = terrainHeight(700, 1400, SEED);

    setActiveWorldContent(world);
    // Deep inside the rect: the blank map's flat slate (0), not the hills.
    expect(terrainHeight(500, 1200, SEED)).toBe(0);
    expect(terrainHeight(500, 1200, SEED)).not.toBe(builtinCenter);
    // Far outside: the shipped world unchanged.
    expect(terrainHeight(700, 1400, SEED)).toBe(builtinFar);
  });

  it('suppresses lethal open-sea fatigue inside a rect placed offshore', async () => {
    const w = await import('../src/sim/world');
    const map = blankMap();
    map.terrainEdits = [];
    // Far west of the shipped strip: open sea on the built-in world.
    map.worldAnchor = { x: -900, z: 300 };
    const world = customMapToWorldContent(map);

    setActiveWorldContent(null);
    const openSeaBefore = w.inHollowOpenSea(-900, 300);

    setActiveWorldContent(world);
    expect(w.inHollowOpenSea(-900, 300)).toBe(false); // safe ground now
    expect(terrainHeight(-900, 300, SEED)).toBe(0); // the map's slate, not seabed
    // Outside the rect the sea keeps its rules.
    expect(w.inHollowOpenSea(-900 + 200, 300)).toBe(
      (() => {
        setActiveWorldContent(null);
        const v = w.inHollowOpenSea(-900 + 200, 300);
        setActiveWorldContent(world);
        return v;
      })(),
    );
    void openSeaBefore;
  });
});

describe('linked playtest projection', () => {
  it('unlinked maps keep the standalone authored world', () => {
    const world = customMapToWorldContent(blankMap());
    expect(world.presentationMode).toBe('blank');
    expect(world.zones[0].id).toBe('blank_world');
  });

  it('embeds every authored layer into the full built-in world at the anchor', () => {
    const map = blankMap();
    const { halfW, zMin, zMax } = mapBounds(map);
    map.placements.push({ assetId: 'props/well', x: 5, z: 5, rotY: 0, scale: 1, collide: false });
    // One interior blocker + the auto perimeter walls already on the doc.
    map.blockers = [...(map.blockers ?? []), { x1: -3, z1: -3, x2: 3, z2: -3 }];
    map.playerStart = { x: 2, z: -2 };
    map.locations = [{ name: 'My District', minX: -5, minZ: -5, maxX: 5, maxZ: 5 }];
    map.worldAnchor = { x: 500, z: 1200 };

    const world = customMapToWorldContent(map);

    // The world is the BUILT-IN one: its zones/props stand, no authored
    // presentation, no world shrink, no custom water level.
    expect(world.presentationMode).toBeUndefined();
    expect(world.worldHalfX).toBeUndefined();
    expect(world.waterLevel).toBeUndefined();
    expect(world.zones.map((z) => z.id)).toEqual(BUILTIN_WORLD.zones.map((z) => z.id));
    expect(world.props.buildings.length).toBe(BUILTIN_WORLD.props.buildings.length);

    // Authored layers ride at the offset.
    const placements = world.placements ?? [];
    const placed = placements[placements.length - 1];
    expect(placed?.x).toBe(505);
    expect(placed?.z).toBe(1205);
    expect(world.playerStart).toEqual({ x: 502, z: 1198 });
    expect(world.locations?.[0]).toMatchObject({ minX: 495, maxX: 505, minZ: 1195, maxZ: 1205 });
    // Terrain stamps (the blank map's flatten grid) offset with the map.
    const stamp = (world.terrainEdits ?? [])[0];
    const local = map.terrainEdits[0];
    expect(stamp.x).toBe(local.x + 500);
    expect(stamp.z).toBe(local.z + 1200);

    // The auto perimeter walls are STRIPPED (walk in from the world); the
    // maker's interior blocker survives at the offset.
    const blockers = world.blockers ?? [];
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ x1: 497, z1: 1197, x2: 503, z2: 1197 });
    // ...and nothing remains on the old rect perimeter lines.
    for (const b of blockers) {
      expect(Math.abs(b.x1) === halfW && Math.abs(b.x2) === halfW).toBe(false);
      expect(b.z1 === zMin && b.z2 === zMin).toBe(false);
      expect(b.z1 === zMax && b.z2 === zMax).toBe(false);
    }
  });

  it('merges authored camps/npcs/objects into the built-in world at the offset', () => {
    const map = blankMap();
    map.content = {
      ...map.content,
      camps: [
        ...map.content.camps,
        { mobId: 'forest_wolf', center: { x: 10, z: 10 }, radius: 6, count: 2 },
      ],
    };
    map.content = {
      ...map.content,
      npcs: {
        ...map.content.npcs,
        custom_greeter: {
          id: 'custom_greeter',
          name: 'Greeter',
          title: '',
          pos: { x: 1, z: 1 },
          facing: 0,
          color: 0xffffff,
        } as (typeof map.content.npcs)[string],
      },
    };
    map.worldAnchor = { x: -200, z: 800 };

    const world = customMapToWorldContent(map);
    expect(world.camps.length).toBe(BUILTIN_WORLD.camps.length + 1);
    const linkedCamp = world.camps[world.camps.length - 1];
    expect(linkedCamp.center).toEqual({ x: -190, z: 810 });
    expect(world.npcs.custom_greeter?.pos).toEqual({ x: -199, z: 801 });
    // Built-in NPCs are all still present.
    for (const id of Object.keys(BUILTIN_WORLD.npcs)) {
      expect(world.npcs[id]).toBeDefined();
    }
  });

  // Sound authoring is positional, so it embeds at the offset like the props do.
  it('embeds point sounds and music areas at the anchor', () => {
    const map = blankMap();
    map.pointSounds = [{ x: 5, z: -5, y: 2, sound: 'amb_campfire', volume: 0.6, radius: 20 }];
    map.music = {
      zoneTrack: 'town_eastbrook',
      areas: [{ minX: -10, minZ: -10, maxX: 10, maxZ: 10, track: 'dungeon_hollow_crypt' }],
    };
    map.worldAnchor = { x: -200, z: 800 };

    const world = customMapToWorldContent(map);
    expect(world.pointSounds).toEqual([
      { x: -195, z: 795, y: 2, sound: 'amb_campfire', volume: 0.6, radius: 20 },
    ]);
    expect(world.music?.areas).toEqual([
      { minX: -210, minZ: 790, maxX: -190, maxZ: 810, track: 'dungeon_hollow_crypt' },
    ]);
    // The map-wide track stays behind: a linked patch does not rescore the world.
    expect(world.music?.zoneTrack).toBeUndefined();
  });

  it('keeps the map-wide track on the standalone projection', () => {
    const map = blankMap();
    map.music = { zoneTrack: 'town_eastbrook' };

    expect(customMapToWorldContent(map).music?.zoneTrack).toBe('town_eastbrook');
  });
});
