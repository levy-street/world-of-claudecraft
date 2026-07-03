import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, getActiveWorldContent, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import type { WorldContent } from '../src/sim/types';
import { biomeAt, terrainHeight, WATER_LEVEL, waterLevel, zoneBiomeAt } from '../src/sim/world';

// The custom-map seam (Phase 0): the terrain function reads the active world
// content registry, defaulting to the built-in world. These tests prove (a) the
// built-in path is unchanged and deterministic, and (b) a custom world actually
// re-shapes the terrain the sim and renderer both sample.

const SEED = 1234;
// A spread of overworld sample points across the three zone bands.
const POINTS: [number, number][] = [
  [0, 0],
  [40, 140],
  [-92, 88],
  [149.5, 295],
  [0, -3],
  [80, 80],
  [-60, 4],
  [120, 360],
];

function sampleDefault(): number[] {
  setActiveWorldContent(null);
  return POINTS.map(([x, z]) => terrainHeight(x, z, SEED));
}

afterEach(() => {
  // Active content is module-global; never leak a custom world into other tests.
  setActiveWorldContent(null);
});

describe('custom-map terrain seam', () => {
  it('defaults to the built-in world', () => {
    expect(getActiveWorldContent()).toBe(BUILTIN_WORLD);
  });

  it('built-in terrain is deterministic across calls', () => {
    const a = sampleDefault();
    const b = sampleDefault();
    expect(a).toEqual(b);
  });

  it('injecting the built-in content as a custom world is byte-identical', () => {
    const golden = sampleDefault();
    // A WorldContent that reuses the exact built-in arrays must reproduce terrain
    // bit-for-bit: this proves the registry indirection added no drift.
    const clone: WorldContent = { ...BUILTIN_WORLD };
    setActiveWorldContent(clone);
    const got = POINTS.map(([x, z]) => terrainHeight(x, z, SEED));
    expect(got).toEqual(golden);
  });

  it('restores the built-in world when cleared', () => {
    const golden = sampleDefault();
    setActiveWorldContent({ ...BUILTIN_WORLD, zones: [BUILTIN_WORLD.zones[0]] });
    setActiveWorldContent(null);
    const got = POINTS.map(([x, z]) => terrainHeight(x, z, SEED));
    expect(got).toEqual(golden);
  });

  it('a terrain edit raises the ground at the stamp centre (sim + render agree)', () => {
    const baseAtOrigin = terrainHeight(0, 0, SEED); // default content
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      terrainEdits: [{ x: 0, z: 0, radius: 25, delta: 12, falloff: 'smooth' }],
    });
    // Smooth falloff is 1.0 at the centre, so the centre rises by exactly delta.
    expect(terrainHeight(0, 0, SEED)).toBeCloseTo(baseAtOrigin + 12, 6);
    // Outside the radius is untouched.
    expect(terrainHeight(100, 0, SEED)).toBeCloseTo(terrainHeightDefaultAt(100, 0), 6);
  });

  it('biome paint overrides shape + biome lookup only inside painted cells', () => {
    const baseBiome = biomeAt(40, 60); // built-in vale here
    const baseH = terrainHeight(40, 60, SEED);
    // Paint a 1-cell peaks patch covering (40,60); everywhere else unpainted.
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      biomePaint: {
        cell: 20,
        cols: 1,
        rows: 1,
        originX: 30,
        originZ: 50,
        ids: [2], // peaks
      },
    });
    expect(biomeAt(40, 60)).toBe('peaks');
    expect(terrainHeight(40, 60, SEED)).not.toBeCloseTo(baseH, 3); // shape changed
    // A point outside the painted cell is unchanged.
    expect(biomeAt(200, 200)).toBe(zoneBiomeAt(200));
    expect(baseBiome).toBe('vale');
  });

  it('a level stamp pulls the centre to an absolute height (flatten brush)', () => {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      terrainEdits: [{ x: 0, z: 0, radius: 25, delta: 7, falloff: 'smooth', mode: 'level' }],
    });
    // Full falloff weight at the centre: the height becomes exactly the target.
    expect(terrainHeight(0, 0, SEED)).toBeCloseTo(7, 6);
    // Outside the radius is untouched.
    expect(terrainHeight(100, 0, SEED)).toBeCloseTo(terrainHeightDefaultAt(100, 0), 6);
  });

  it('stamps compose in array order (add after level)', () => {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      terrainEdits: [
        { x: 0, z: 0, radius: 25, delta: 7, falloff: 'flat', mode: 'level' },
        { x: 0, z: 0, radius: 25, delta: 2, falloff: 'flat' },
      ],
    });
    expect(terrainHeight(0, 0, SEED)).toBeCloseTo(9, 6);
  });

  it('custom water level flows through waterLevel() and terrain shaping', () => {
    expect(waterLevel()).toBe(WATER_LEVEL);
    setActiveWorldContent({ ...BUILTIN_WORLD, waterLevel: 2.5 });
    expect(waterLevel()).toBe(2.5);
    // The dry-land soft floor tracks the raised water, so low ground rises with it.
    const raised = terrainHeight(0, -3, SEED);
    setActiveWorldContent(null);
    expect(waterLevel()).toBe(WATER_LEVEL);
    const builtin = terrainHeight(0, -3, SEED);
    expect(raised).toBeGreaterThanOrEqual(builtin);
  });

  it('a colliding placement blocks movement; a cosmetic one does not', () => {
    // Find a spot that is clear in the built-in world so the only possible
    // blocker is our placement.
    setActiveWorldContent(null);
    let spot: { x: number; z: number } | null = null;
    for (let x = 30; x < 120 && !spot; x += 7) {
      for (let z = 10; z < 120 && !spot; z += 7) {
        if (!isBlocked(SEED, x, z, 0.4)) spot = { x, z };
      }
    }
    expect(spot).not.toBeNull();
    if (!spot) return;
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      placements: [
        {
          path: '/models/props/well.glb',
          x: spot.x,
          z: spot.z,
          rotY: 0,
          scale: 1,
          collideRadius: 1.2,
        },
      ],
    });
    expect(isBlocked(SEED, spot.x, spot.z, 0.4)).toBe(true);
    // The same placement without a footprint is walk-through.
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      placements: [{ path: '/models/props/well.glb', x: spot.x, z: spot.z, rotY: 0, scale: 1 }],
    });
    expect(isBlocked(SEED, spot.x, spot.z, 0.4)).toBe(false);
  });

  it('new paint-only biomes reshape painted cells', () => {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      biomePaint: { cell: 20, cols: 1, rows: 1, originX: 30, originZ: 50, ids: [5] }, // volcano
    });
    expect(biomeAt(40, 60)).toBe('volcano');
    expect(biomeAt(200, 200)).toBe(zoneBiomeAt(200));
  });

  it('sanitizeMapDoc keeps v2 fields and drops garbage', () => {
    const doc = sanitizeMapDoc({
      version: 2,
      meta: { id: 'm1', name: 'X'.repeat(200), seed: 7, parentId: 'p1' },
      content: {
        zones: [
          { id: 'z', name: 'Z', zMin: -10, zMax: 10, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
          { bogus: true },
        ],
        camps: [],
        npcs: {},
        objects: [],
        roads: [
          [
            { x: 0, z: 0 },
            { x: 5, z: 5 },
          ],
          'not-a-road',
        ],
      },
      terrainEdits: [
        { x: 0, z: 0, radius: 10, delta: 3, falloff: 'smooth', mode: 'level' },
        { x: Number.NaN, z: 0, radius: 10, delta: 3, falloff: 'smooth' },
      ],
      placements: [
        { assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 2, collide: true },
        { assetId: 42, x: 1, z: 2 },
      ],
      waterLevel: 999,
      playerStart: { x: 3, z: 4 },
    });
    expect(doc).not.toBeNull();
    expect(doc?.meta.name.length).toBeLessThanOrEqual(60);
    expect(doc?.meta.parentId).toBe('p1');
    expect(doc?.content.zones.length).toBe(1);
    expect(doc?.content.roads.length).toBe(1);
    expect(doc?.terrainEdits).toEqual([
      { x: 0, z: 0, radius: 10, delta: 3, falloff: 'smooth', mode: 'level' },
    ]);
    expect(doc?.placements).toEqual([
      { assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 2, collide: true },
    ]);
    expect(doc?.waterLevel).toBe(40); // clamped
    expect(doc?.playerStart).toEqual({ x: 3, z: 4 });
    expect(sanitizeMapDoc('not json {')).toBeNull();
    expect(sanitizeMapDoc({ content: { zones: [] } })).toBeNull();
  });

  it('sanitizeMapDoc def-fills nested zone sub-fields (QA finding)', () => {
    const doc = sanitizeMapDoc({
      content: {
        zones: [{ zMin: -10, zMax: 10, hub: { x: 0, z: 0 } }],
        camps: [],
        npcs: {},
        objects: [],
        roads: [],
      },
    });
    const zone = doc?.content.zones[0];
    expect(zone?.lakes).toEqual([]);
    expect(zone?.pois).toEqual([]);
    expect(zone?.biome).toBe('vale');
    expect(zone?.hub.radius).toBeGreaterThan(0);
    expect(zone?.graveyard).toEqual({ x: 0, z: 0 });
    // A minimal zone must sample terrain without throwing.
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      zones: doc?.content.zones ?? [],
      camps: [],
      roads: [],
    });
    expect(() => terrainHeight(0, 0, SEED)).not.toThrow();
  });

  it('sanitizeMapDoc caps npcs and objects (review hardening)', () => {
    const npcs: Record<string, unknown> = {};
    for (let i = 0; i < 500; i++) npcs[`npc${i}`] = { id: `npc${i}`, pos: { x: 0, z: 0 } };
    const objects = Array.from({ length: 900 }, (_, i) => ({ id: `o${i}`, positions: [] }));
    const doc = sanitizeMapDoc({
      content: {
        zones: [
          { id: 'z', name: 'Z', zMin: -10, zMax: 10, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
        ],
        camps: [],
        npcs,
        objects,
        roads: [],
      },
    });
    expect(Object.keys(doc?.content.npcs ?? {}).length).toBeLessThanOrEqual(200);
    expect(doc?.content.objects.length).toBeLessThanOrEqual(400);
  });

  it('a custom single-biome world re-shapes terrain and biome lookup', () => {
    const peaks: WorldContent = {
      ...BUILTIN_WORLD,
      zones: [
        {
          id: 'custom',
          name: 'Custom Peaks',
          zMin: -180,
          zMax: 180,
          levelRange: [1, 10],
          biome: 'peaks',
          hub: { x: 0, z: 0, radius: 20, name: 'Camp' },
          graveyard: { x: 0, z: 0 },
          lakes: [],
          pois: [],
          welcome: '',
        },
      ],
      camps: [],
      roads: [],
    };
    setActiveWorldContent(peaks);
    expect(zoneBiomeAt(50)).toBe('peaks');
    // Peaks biome has a high base elevation, so an arbitrary far point should sit
    // well above the built-in vale terrain at the same spot.
    expect(terrainHeight(60, 60, SEED)).toBeGreaterThan(0);
  });
});

// Helper: sample the built-in terrain at a point without disturbing the active
// content the calling test has set (restores it afterwards is handled by afterEach).
function terrainHeightDefaultAt(x: number, z: number): number {
  const active = getActiveWorldContent();
  setActiveWorldContent(null);
  const h = terrainHeight(x, z, SEED);
  setActiveWorldContent(active === BUILTIN_WORLD ? null : active);
  return h;
}
