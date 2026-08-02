import { beforeEach, describe, expect, it } from 'vitest';
import {
  compactScreeMatrices,
  screeSpotAt,
  screeSpotsInBounds,
} from '../src/render/cliff_scree_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { WorldContent } from '../src/sim/types';
import {
  groundHeight,
  invalidateTerrainEditIndex,
  roadDistance,
  terrainHeight,
  waterLevel,
} from '../src/sim/world';

// The scree module is the renderer's single pure placement source. The rocks
// are tier-gated visual dressing and must not alter shared simulation ground.

const SEED = 1337;
// a broad sample rectangle over the original vale/marsh/peaks strip
const BOUNDS = { minX: -360, maxX: 360, minZ: -120, maxZ: 760 };

describe('cliff scree placement', () => {
  it('compacts live matrices by variant in ascending source-slot order', () => {
    const variants = new Int8Array([-1, 1, 0, 1, -1, 0]);
    const slots = new Float32Array(variants.length * 16);
    for (let slot = 0; slot < variants.length; slot++) {
      slots.fill(slot + 0.25, slot * 16, slot * 16 + 16);
    }
    const targets = [
      new Float32Array(variants.length * 16),
      new Float32Array(variants.length * 16),
    ];
    const counts = compactScreeMatrices(variants, slots, targets, new Uint16Array(2));

    expect([...counts]).toEqual([2, 2]);
    expect([...targets[0].slice(0, 32)]).toEqual([
      ...new Array(16).fill(2.25),
      ...new Array(16).fill(5.25),
    ]);
    expect([...targets[1].slice(0, 32)]).toEqual([
      ...new Array(16).fill(1.25),
      ...new Array(16).fill(3.25),
    ]);
  });

  beforeEach(() => {
    setActiveWorldContent(BUILTIN_WORLD);
  });

  it('is deterministic per (seed, cell)', () => {
    const spots = screeSpotsInBounds(SEED, BOUNDS);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots.slice(0, 25)) {
      const again = screeSpotAt(SEED, Math.round(s.x / 6.5), Math.round(s.z / 6.5));
      expect(again).not.toBeNull();
      expect(again?.x).toBe(s.x);
      expect(again?.baseY).toBe(s.baseY);
      expect(again?.scale).toBe(s.scale);
    }
  });

  it('never places on roads, underwater, or at hub centres', () => {
    const spots = screeSpotsInBounds(SEED, BOUNDS);
    for (const s of spots) {
      expect(roadDistance(s.x, s.z)).toBeGreaterThanOrEqual(3);
      expect(s.baseY).toBeGreaterThanOrEqual(waterLevel() + 0.5);
      for (const zone of BUILTIN_WORLD.zones) {
        const d = Math.hypot(s.x - zone.hub.x, s.z - zone.hub.z);
        expect(d).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('keeps tier-gated visual scree out of the shared walkable heightfield', () => {
    const spots = screeSpotsInBounds(SEED, BOUNDS);
    const s = spots[0];
    expect(s).toBeDefined();
    if (!s) return;
    // Cliff scree only renders on tiers that enable the detail layer. Folding
    // it into groundHeight would create invisible walls on lower tiers
    // and perturb every deterministic sim consumer of the shared heightfield.
    expect(groundHeight(s.x, s.z, SEED)).toBeCloseTo(terrainHeight(s.x, s.z, SEED), 5);
  });

  it('keeps walk-through dressing below human-scale wall size', () => {
    const spots = screeSpotsInBounds(SEED, BOUNDS);
    expect(spots.some((s) => s.scale < 0.4)).toBe(true);
    expect(Math.max(...spots.map((s) => s.scale))).toBeLessThanOrEqual(0.55);
  });

  it('honours a custom world water level', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, waterLevel: 20 });
    const spots = screeSpotsInBounds(SEED, BOUNDS);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((spot) => spot.baseY >= 20.5)).toBe(true);
  });

  it('recomputes placement after an in-place terrain edit', () => {
    const world: WorldContent = {
      ...BUILTIN_WORLD,
      terrainEdits: [...(BUILTIN_WORLD.terrainEdits ?? [])],
    };
    setActiveWorldContent(world);
    const before = screeSpotsInBounds(SEED, BOUNDS)[0];
    expect(before).toBeDefined();
    if (!before) return;

    world.terrainEdits?.push({
      x: before.x,
      z: before.z,
      radius: 20,
      delta: 20,
      falloff: 'flat',
      mode: 'add',
    });
    invalidateTerrainEditIndex();

    const ci = Math.round(before.x / 6.5);
    const cj = Math.round(before.z / 6.5);
    expect(screeSpotAt(SEED, ci, cj)?.baseY).toBeCloseTo(before.baseY + 20, 8);
  });
});
