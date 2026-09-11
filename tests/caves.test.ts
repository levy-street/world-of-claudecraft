import { afterEach, describe, expect, it } from 'vitest';
import {
  caveCameraMaxDist,
  caveClearance,
  caveFloorAt,
  caveSampleAt,
  HOLE_WALL_RISE,
  inTerrainHole,
  sanitizeCaveNode,
  sanitizeTerrainHole,
} from '../src/sim/caves';
import { resolvePosition } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc, serializeMapDoc } from '../src/sim/map_doc';
import { HOLE_MAX_RADIUS } from '../src/sim/terrain_cuts';
import type { CaveDef, WorldContent } from '../src/sim/types';
import {
  groundHeight,
  groundHeightNear,
  onCaveSheet,
  terrainCutAt,
  terrainHeight,
} from '../src/sim/world';

// The rebuilt cave system: standalone tube volumes (sim/caves.ts) that ignore
// the terrain entirely, terrain-hole cutouts, the hole-aware ground sheets
// (sim/world.ts), and the document round-trip.

const SEED = 20061;

function world(extra: Partial<WorldContent>): WorldContent {
  return { ...BUILTIN_WORLD, ...extra };
}

afterEach(() => {
  setActiveWorldContent(null);
});

// A straight tube: floor at floorY, radius 4.
function tube(x: number, z: number, floorY: number): CaveDef {
  return {
    id: 'test_cave',
    nodes: [
      { x: x - 20, y: floorY, z, radius: 4 },
      { x: x + 20, y: floorY, z, radius: 4 },
    ],
  };
}

describe('cave tube geometry (sim/caves.ts)', () => {
  const cave = tube(0, 40, -30);

  it('samples the bore inside the footprint, null outside', () => {
    const s = caveSampleAt([cave], 0, 40);
    expect(s).not.toBeNull();
    expect(s?.floor).toBe(-30);
    expect(s?.ceiling).toBeCloseTo(-30 + caveClearance(4), 5);
    expect(caveSampleAt([cave], 0, 50)).toBeNull();
  });

  it('ceiling drops to the floor at the lateral edge (horseshoe)', () => {
    const edge = caveSampleAt([cave], 0, 43.9);
    expect(edge).not.toBeNull();
    expect((edge?.ceiling ?? 0) - (edge?.floor ?? 0)).toBeLessThan(1);
  });

  it('the tube exists at ANY height ? nothing about terrain touches it', () => {
    // Same chain, floors from deep underground to high in the air: the sample
    // is identical modulo the floor offset. There is no surface parameter to
    // squish it with ? the entrance is always as big as authored.
    for (const floorY of [-200, -5, 0, 50, 400]) {
      const s = caveSampleAt([tube(0, 40, floorY)], 0, 40);
      expect(s?.floor).toBe(floorY);
      expect(s?.radius).toBe(4);
      expect((s?.ceiling ?? 0) - floorY).toBeCloseTo(caveClearance(4), 5);
    }
  });

  it('caveFloorAt returns the walkable tube sheet (edge sliver excluded)', () => {
    expect(caveFloorAt([cave], 0, 40)?.floor).toBe(-30);
    expect(caveFloorAt([cave], 0, 43.95)).toBeNull(); // horseshoe edge
    expect(caveFloorAt([cave], 0, 50)).toBeNull(); // outside footprint
  });

  it('camera clamp confines BURIED bores only; open/above-ground spans are free', () => {
    // Surface far above the tube (floor -30): genuinely buried -> clamped.
    const buried = (): number => 20;
    const d = caveCameraMaxDist([cave], buried, 0, -28, 40, 0, -10, 40, 0.3);
    expect(d).toBeLessThan(18); // clamped well before the 18yd zoom
    // Eye on the surface far above the tube: no clamp.
    expect(caveCameraMaxDist([cave], buried, 0, 20, 40, 0, 30, 40, 0.3)).toBe(
      Number.POSITIVE_INFINITY,
    );
    // Tube standing ABOVE the ground (surface below its ceiling): the shell
    // is open air ? the chase cam is never confined.
    const low = (): number => -35;
    expect(caveCameraMaxDist([cave], low, 0, -28, 40, 0, -10, 40, 0.3)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('sanitizeCaveNode clamps radius and rejects non-finite fields', () => {
    expect(sanitizeCaveNode({ x: 1, y: 2, z: 3, radius: 99 })?.radius).toBe(20);
    expect(sanitizeCaveNode({ x: 1, y: 2, z: 3, radius: 0.1 })?.radius).toBe(1.5);
    expect(sanitizeCaveNode({ x: Number.NaN, y: 2, z: 3, radius: 4 })).toBeNull();
    expect(sanitizeCaveNode({ x: 1, y: Infinity, z: 3, radius: 4 })).toBeNull();
  });

  it('sanitizeTerrainHole clamps radius and rejects junk', () => {
    expect(sanitizeTerrainHole({ x: 1, y: 2, z: 3, radius: 999 })?.radius).toBe(HOLE_MAX_RADIUS);
    expect(sanitizeTerrainHole({ x: 1, y: 2, z: 3, radius: 0.01 })?.radius).toBe(1);
    expect(sanitizeTerrainHole({ x: 'junk', y: 2, z: 3, radius: 4 })).toBeNull();
  });
});

describe('cave scaling', () => {
  const cave = tube(0, 40, -30);

  it('width multiplier widens the bore footprint', () => {
    const wide = { ...cave, width: 2 };
    // q = 7 is outside the base radius (4) but inside the widened one (8).
    expect(caveSampleAt([cave], 0, 47)).toBeNull();
    expect(caveSampleAt([wide], 0, 47)).not.toBeNull();
  });

  it('height multiplier raises the interior clearance', () => {
    const tall = { ...cave, height: 2 };
    const base = caveSampleAt([cave], 0, 40);
    const s = caveSampleAt([tall], 0, 40);
    expect((s?.ceiling ?? 0) - (s?.floor ?? 0)).toBeCloseTo(
      ((base?.ceiling ?? 0) - (base?.floor ?? 0)) * 2,
      5,
    );
  });

  it('floor bumps roll the walkable floor deterministically, flat at walls', () => {
    const bumpy = { ...cave, floorVariance: 1 };
    // Deterministic: identical defs sample identically.
    const a = caveSampleAt([bumpy], 3.7, 41.2);
    const b = caveSampleAt([{ ...bumpy }], 3.7, 41.2);
    expect(a?.floor).toBeCloseTo(b?.floor ?? 0, 8);
    // Somewhere along the centerline the floor leaves the flat -30 line, and
    // the ceiling BASE (arch) stays derived from the unbumped line.
    let moved = false;
    for (let x = -18; x <= 18; x += 1.3) {
      const s = caveSampleAt([bumpy], x, 40);
      if (!s) continue;
      expect(Math.abs(s.floor + 30)).toBeLessThan(2); // bounded amplitude
      expect(s.ceiling).toBeCloseTo(-30 + caveClearance(4), 5);
      if (Math.abs(s.floor + 30) > 0.15) moved = true;
    }
    expect(moved).toBe(true);
    // At the wall edge the bump fades out: floor meets the arch base.
    const edge = caveSampleAt([bumpy], 0, 43.96);
    expect(Math.abs((edge?.floor ?? 0) + 30)).toBeLessThan(0.1);
    // Slider off = exact flat floor.
    expect(caveSampleAt([cave], 3.7, 41.2)?.floor).toBe(-30);
  });
});

describe('terrain holes + ground sheets (sim/world.ts)', () => {
  it('terrain is NEVER carved by caves: heightfield identical with and without', () => {
    setActiveWorldContent(world({}));
    const spots: [number, number][] = [
      [0, 40],
      [-120, 300],
      [80, 700],
    ];
    const before = spots.map(([x, z]) => terrainHeight(x, z, SEED));
    // A tube RIGHT at the surface ? the old system would have carved a trench.
    const surface = terrainHeight(0, 40, SEED);
    setActiveWorldContent(world({ caves: [tube(0, 40, surface - 1)] }));
    spots.forEach(([x, z], i) => {
      expect(terrainHeight(x, z, SEED)).toBe(before[i]);
    });
  });

  it('a mover picks the sheet continuous with its previous height', () => {
    setActiveWorldContent(world({}));
    const surface = terrainHeight(0, 40, SEED);
    const floorY = surface - 12;
    setActiveWorldContent(world({ caves: [tube(0, 40, floorY)] }));
    // Surface sheet: a mover standing on top stays on top.
    expect(groundHeightNear(0, 40, SEED, surface)).toBeCloseTo(terrainHeight(0, 40, SEED), 5);
    // Cave sheet: a mover at the floor stays at the floor.
    expect(groundHeightNear(0, 40, SEED, floorY)).toBeCloseTo(floorY, 5);
    expect(onCaveSheet(0, 40, SEED, floorY)).toBe(true);
    expect(onCaveSheet(0, 40, SEED, surface)).toBe(false);
  });

  it('a hole removes the terrain sheet: drop into the tube below', () => {
    setActiveWorldContent(world({}));
    const surface = terrainHeight(0, 40, SEED);
    const floorY = surface - 12;
    setActiveWorldContent(
      world({
        caves: [tube(0, 40, floorY)],
        holes: [{ x: 0, y: surface, z: 40, radius: 6 }],
      }),
    );
    expect(terrainCutAt(0, 40, SEED)).toBe(true);
    expect(terrainCutAt(0, 60, SEED)).toBe(false);
    // Even a mover whose previous height was the SURFACE lands on the cave
    // floor inside the hole: there is no ground left to stand on.
    expect(groundHeightNear(0, 40, SEED, surface)).toBeCloseTo(floorY, 5);
    expect(onCaveSheet(0, 40, SEED, surface)).toBe(true);
  });

  it('a hole with nothing underneath walls the step off', () => {
    setActiveWorldContent(world({}));
    const surface = terrainHeight(0, 40, SEED);
    setActiveWorldContent(world({ holes: [{ x: 0, y: surface, z: 40, radius: 6 }] }));
    const h = groundHeightNear(0, 40, SEED, surface);
    expect(h).toBeGreaterThan(surface + HOLE_WALL_RISE - 1);
    // Outside the hole: plain ground.
    expect(groundHeightNear(0, 60, SEED, surface)).toBe(groundHeight(0, 60, SEED));
  });

  it('a patch sphere restores the ground inside hole cutouts', () => {
    setActiveWorldContent(world({}));
    const surface = terrainHeight(0, 40, SEED);
    setActiveWorldContent(
      world({
        holes: [{ x: 0, y: surface, z: 40, radius: 8 }],
        holePatches: [{ x: 4, y: surface, z: 40, radius: 5 }],
      }),
    );
    // Inside the hole but under the patch: ground is back.
    expect(terrainCutAt(4, 40, SEED)).toBe(false);
    expect(groundHeightNear(4, 40, SEED, surface)).toBe(groundHeight(4, 40, SEED));
    // Inside the hole, outside the patch: still cut.
    expect(terrainCutAt(-4, 40, SEED)).toBe(true);
  });

  it('inTerrainHole is a sphere test against the surface height', () => {
    const holes = [{ x: 0, y: 10, z: 0, radius: 5 }];
    expect(inTerrainHole(holes, 0, 0, 10)).toBe(true); // center
    expect(inTerrainHole(holes, 4.9, 0, 10)).toBe(true); // inside rim
    expect(inTerrainHole(holes, 5.1, 0, 10)).toBe(false); // outside rim
    expect(inTerrainHole(holes, 0, 0, 16)).toBe(false); // surface above sphere
    // Patch overrides the cut.
    expect(inTerrainHole(holes, 0, 0, 10, [{ x: 0, y: 10, z: 0, radius: 2 }])).toBe(false);
    expect(inTerrainHole(holes, 3, 0, 10, [{ x: 0, y: 10, z: 0, radius: 2 }])).toBe(true);
    expect(inTerrainHole(holes, 3, 0, 14)).toBe(false); // 3-4-5: just outside
    expect(inTerrainHole(holes, 2.9, 0, 13.9)).toBe(true);
  });
});

describe('cave pass-under collision (sim/colliders.ts)', () => {
  it('a mover deep in a tube passes under surface props; surface movers still collide', () => {
    setActiveWorldContent(world({}));
    // A solid OBB collider on the surface, read from the layout rather than
    // written as a literal: v0.31's Eastbrook rebuild moved the house this test
    // used to name by coordinate, and (10, 12) is open ground now.
    const house = BUILTIN_WORLD.props.buildings.find((b) => b.id === 'eastbrook_bank');
    if (!house) throw new Error('expected the eastbrook_bank footprint');
    const { x: hx, z: hz } = house;
    const ground = groundHeight(hx, hz, SEED);
    // Surface mover (no y / y at ground): pushed out of the footprint.
    const legacy = resolvePosition(SEED, hx, hz, 0.5);
    expect(Math.abs(legacy.x - hx) + Math.abs(legacy.z - hz)).toBeGreaterThan(0.5);
    const atGround = resolvePosition(SEED, hx, hz, 0.5, false, undefined, { y: ground, lift: 0 });
    expect(Math.abs(atGround.x - hx) + Math.abs(atGround.z - hz)).toBeGreaterThan(0.5);
    // Mover 12yd below the house's ground (inside a cave tube): passes clean.
    const under = resolvePosition(SEED, hx, hz, 0.5, false, undefined, { y: ground - 12, lift: 0 });
    expect(under.x).toBe(hx);
    expect(under.z).toBe(hz);
  });

  it('blocker walls stay height-agnostic: they block at any depth', () => {
    setActiveWorldContent(world({ blockers: [{ x1: -5, z1: 40, x2: 5, z2: 40 }] }));
    const deep = resolvePosition(SEED, 0, 40, 0.5, false, undefined, { y: -200, lift: 0 });
    expect(Math.abs(deep.x - 0) + Math.abs(deep.z - 40)).toBeGreaterThan(0.1);
  });
});

describe('cave document round-trip (sim/map_doc.ts)', () => {
  const baseDoc = {
    version: 2,
    meta: { id: 'm1', name: 'caves', seed: SEED },
    content: {
      zones: [
        { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
      ],
      camps: [],
      npcs: {},
      objects: [],
      roads: [],
    },
    terrainEdits: [],
    placements: [],
  };

  it('caves + holes survive serialize -> parse; junk is dropped', () => {
    const doc = sanitizeMapDoc(
      JSON.parse(
        JSON.stringify({
          ...baseDoc,
          caves: [
            {
              id: 'c1',
              nodes: [
                { x: 0, y: -5, z: 40, radius: 4 },
                { x: 10, y: -6, z: 40, radius: 5 },
              ],
              spikeSize: 9,
              startOpen: false,
              stalactites: 0.5,
            },
            { id: '', nodes: [{ x: 0, y: 0, z: 0, radius: 3 }] }, // no id: dropped
            { id: 'c2', nodes: [] }, // no nodes: dropped
            { id: 'c3', nodes: [{ x: 'junk', y: 0, z: 0, radius: 3 }] }, // all nodes junk: dropped
          ],
          holes: [
            { x: 5, y: 12, z: -8, radius: 7 },
            { x: 'junk', y: 0, z: 0, radius: 3 }, // dropped
          ],
        }),
      ),
    );
    expect(doc).not.toBeNull();
    expect(doc?.caves?.length).toBe(1);
    expect(doc?.caves?.[0].nodes.length).toBe(2);
    expect(doc?.caves?.[0].spikeSize).toBe(3); // clamped to the max
    expect(doc?.caves?.[0].startOpen).toBe(false);
    expect(doc?.caves?.[0].endOpen).toBeUndefined(); // absent = open
    expect(doc?.holes).toEqual([{ x: 5, y: 12, z: -8, radius: 7 }]);
    const reparsed = sanitizeMapDoc(JSON.parse(serializeMapDoc(doc as never)));
    expect(reparsed?.caves).toEqual(doc?.caves);
    expect(reparsed?.holes).toEqual(doc?.holes);
  });

  it('width/height multipliers are kept (clamped)', () => {
    const doc = sanitizeMapDoc({
      ...baseDoc,
      caves: [{ ...tube(0, 40, -30), width: 99, height: 0.01 }],
    });
    expect(doc?.caves?.[0].width).toBe(3);
    expect(doc?.caves?.[0].height).toBe(0.5);
  });

  it('a document without caves or holes parses with the fields absent', () => {
    const doc = sanitizeMapDoc({ ...baseDoc });
    expect(doc?.caves).toBeUndefined();
    expect(doc?.holes).toBeUndefined();
  });

  it('legacy cavePatches still parse (ignored at runtime, kept in the doc)', () => {
    const doc = sanitizeMapDoc({
      ...baseDoc,
      cavePatches: [
        { x: 1, z: 2, radius: 999 },
        { x: 'junk', z: 2, radius: 3 },
      ],
    });
    expect(doc?.cavePatches).toEqual([{ x: 1, z: 2, radius: 30 }]);
  });
});
