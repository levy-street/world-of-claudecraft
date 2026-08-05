import { beforeEach, describe, expect, it } from 'vitest';
import {
  compactScreeMatrices,
  SCREE_CELL,
  screeSpotAt,
  screeSpotsInBounds,
} from '../src/render/cliff_scree_core';
import { BUILTIN_WORLD, GATHER_NODES, setActiveWorldContent } from '../src/sim/data';
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

  it('never places inside a gather node footprint (the harvest disc plus margin)', () => {
    // The v0.34.0 merge audit: scree had road and hub exclusions but no
    // gather-node exclusion, and at the SHIPPED seed 22 boulders landed
    // inside 5yd harvest discs, two essentially ON node props. The shipped
    // seed is therefore the decisive one here: with the exclusion removed
    // this sweep fails at 20061 (the measured regression), not just in
    // principle. 6 = INTERACT_RANGE + 1yd of visual margin
    // (cliff_scree_core.ts NODE_EXCLUSION_RADIUS).
    const SHIPPED_SEED = 20061;
    const pad = 6 + SCREE_CELL; // exclusion radius + one full candidate cell
    let spotsSeen = 0;
    for (const seed of [SHIPPED_SEED, SEED]) {
      for (const node of GATHER_NODES) {
        for (
          let ci = Math.floor((node.pos.x - pad) / SCREE_CELL);
          ci <= Math.ceil((node.pos.x + pad) / SCREE_CELL);
          ci++
        ) {
          for (
            let cj = Math.floor((node.pos.z - pad) / SCREE_CELL);
            cj <= Math.ceil((node.pos.z + pad) / SCREE_CELL);
            cj++
          ) {
            const spot = screeSpotAt(seed, ci, cj);
            if (!spot) continue;
            spotsSeen++;
            const d = Math.hypot(spot.x - node.pos.x, spot.z - node.pos.z);
            expect(d, `${node.id} seed ${seed} cell ${ci},${cj}`).toBeGreaterThanOrEqual(6);
          }
        }
      }
    }
    // Non-vacuity: the sweep must actually see surviving neighbours, or a
    // content or cell retune could hollow this pin out silently (measured
    // 365 + 400 surviving spots across the two seeds at the fix round).
    expect(spotsSeen).toBeGreaterThan(200);
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
