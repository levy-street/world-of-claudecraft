import { afterEach, describe, expect, it } from 'vitest';
import { chunkIntersectsRegion, normalTexelBounds } from '../src/render/terrain_region_core';
import {
  advanceWaterSchedule,
  shoreDepthAt,
  WATER_MAX_STEPS_PER_FRAME,
  WATER_SCHEDULE_SLEEP,
  WATER_SCHEDULE_WAKE,
  waterBodyVisible,
  waterCellIntersectsDisc,
  waterGridPlan,
  waterResidentBodyBudget,
  waterSimulationPlan,
  waterSimulationTargetResolution,
} from '../src/render/water_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { terrainHeight, WATER_LEVEL, waterLevel } from '../src/sim/world';

// The map editor's realtime render layer: chunk-local terrain rebuilds pick
// their chunks and macro-normal texels through these pure helpers, and the
// water view's shore-depth attribute goes through shoreDepthAt. All Node-side
// (no GL): the Three-side consumers are thin loops over these.

const SEED = 1234;

describe('chunkIntersectsRegion (terrain partial rebuild selection)', () => {
  // The live layout: regular 60u chunks, far-field 2x2 super-chunks of 120u.
  const CHUNK = 60;
  const SUPER = 120;

  it('selects a chunk fully containing the region', () => {
    expect(chunkIntersectsRegion(0, 0, CHUNK, 10, 10, 20, 20)).toBe(true);
  });

  it('selects a chunk partially overlapped by the region', () => {
    expect(chunkIntersectsRegion(0, 0, CHUNK, 50, 50, 90, 90)).toBe(true);
    expect(chunkIntersectsRegion(60, 60, CHUNK, 50, 50, 90, 90)).toBe(true);
  });

  it('rejects chunks fully outside the region on either axis', () => {
    expect(chunkIntersectsRegion(120, 0, CHUNK, 10, 10, 20, 20)).toBe(false);
    expect(chunkIntersectsRegion(0, 120, CHUNK, 10, 10, 20, 20)).toBe(false);
    expect(chunkIntersectsRegion(-120, -120, CHUNK, 10, 10, 20, 20)).toBe(false);
  });

  it('is INCLUSIVE at borders (shared border/skirt vertices must rebuild)', () => {
    // Region right edge exactly on the chunk left edge, and vice versa.
    expect(chunkIntersectsRegion(60, 0, CHUNK, 10, 10, 60, 20)).toBe(true);
    expect(chunkIntersectsRegion(0, 0, CHUNK, 60, 10, 90, 20)).toBe(true);
    // Corner touch counts too.
    expect(chunkIntersectsRegion(60, 60, CHUNK, 10, 10, 60, 60)).toBe(true);
  });

  it('handles 2x2 far super-chunks (size 120) with the same predicate', () => {
    // A region inside the second 60u cell of a super-chunk still selects it.
    expect(chunkIntersectsRegion(-180, 600, SUPER, -90, 690, -80, 700)).toBe(true);
    // Just past its far edge does not.
    expect(chunkIntersectsRegion(-180, 600, SUPER, -59.9, 721, -50, 730)).toBe(false);
  });

  it('a brush footprint straddling a chunk corner selects all four neighbours', () => {
    const chunks = [
      { x0: 0, z0: 0 },
      { x0: 60, z0: 0 },
      { x0: 0, z0: 60 },
      { x0: 60, z0: 60 },
      { x0: 120, z0: 0 }, // and one that must not match
    ];
    const hit = chunks.filter((c) => chunkIntersectsRegion(c.x0, c.z0, CHUNK, 55, 55, 65, 65));
    expect(hit.length).toBe(4);
    expect(hit).not.toContainEqual({ x0: 120, z0: 0 });
  });
});

describe('normalTexelBounds (macro normal partial rebake)', () => {
  // The live texture: 640x1920 over x [-180, 180], z [-180, 900] would be the
  // shipped world; the helper is parametric, so use round numbers here.
  const W = 100; // world 0..100 wide -> stepX 1 with texW 100
  const D = 200;
  const TEX_W = 100;
  const TEX_H = 200;

  it('covers the whole texture for a whole-world region', () => {
    expect(normalTexelBounds(0, 0, W, D, 0, 0, W, D, TEX_W, TEX_H, 0)).toEqual({
      i0: 0,
      i1: TEX_W - 1,
      j0: 0,
      j1: TEX_H - 1,
    });
  });

  it('maps a small interior region to its texel rect (with over-coverage <= 1)', () => {
    const b = normalTexelBounds(10, 20, 12, 22, 0, 0, W, D, TEX_W, TEX_H, 0);
    expect(b).not.toBeNull();
    if (!b) return;
    // Texel i samples x = i + 0.5 here, so texels 9..12 can all touch [10, 12].
    expect(b.i0).toBeGreaterThanOrEqual(9);
    expect(b.i1).toBeLessThanOrEqual(13);
    expect(b.j0).toBeGreaterThanOrEqual(19);
    expect(b.j1).toBeLessThanOrEqual(23);
    // And the mapped rect really contains every texel whose sample point lies
    // inside the region.
    expect(b.i0).toBeLessThanOrEqual(10);
    expect(b.i1).toBeGreaterThanOrEqual(11);
  });

  it('margin expands by whole texels and clamps at the texture edge', () => {
    const noMargin = normalTexelBounds(10, 20, 12, 22, 0, 0, W, D, TEX_W, TEX_H, 0);
    const margin = normalTexelBounds(10, 20, 12, 22, 0, 0, W, D, TEX_W, TEX_H, 1);
    expect(noMargin).not.toBeNull();
    expect(margin).not.toBeNull();
    if (!noMargin || !margin) return;
    expect(margin.i0).toBe(noMargin.i0 - 1);
    expect(margin.i1).toBe(noMargin.i1 + 1);
    expect(margin.j0).toBe(noMargin.j0 - 1);
    expect(margin.j1).toBe(noMargin.j1 + 1);
    // Clamped at the border even with a huge margin.
    const clamped = normalTexelBounds(0, 0, 5, 5, 0, 0, W, D, TEX_W, TEX_H, 50);
    expect(clamped?.i0).toBe(0);
    expect(clamped?.j0).toBe(0);
  });

  it('returns null for a region that misses the texture or is empty', () => {
    expect(normalTexelBounds(-30, 0, -10, 5, 0, 0, W, D, TEX_W, TEX_H, 1)).toBeNull();
    expect(normalTexelBounds(0, 250, 5, 260, 0, 0, W, D, TEX_W, TEX_H, 1)).toBeNull();
    expect(normalTexelBounds(20, 20, 10, 25, 0, 0, W, D, TEX_W, TEX_H, 1)).toBeNull();
  });

  it('a region overlapping one edge clamps to the texture, not null', () => {
    const b = normalTexelBounds(-10, 5, 5, 8, 0, 0, W, D, TEX_W, TEX_H, 1);
    expect(b).not.toBeNull();
    expect(b?.i0).toBe(0);
  });
});

describe('optimized water geometry and culling', () => {
  it('bounds tessellation for very large editor-authored lakes', () => {
    expect(waterGridPlan(48, 2.6, 8, 64)).toEqual({ size: 96, segments: 37 });
    expect(waterGridPlan(10_000, 2, 8, 64).segments).toBe(64);
  });

  it('drops corner cells but retains every cell touching the circular boundary', () => {
    expect(waterCellIntersectsDisc(-1, -1, 1, 1, 5)).toBe(true);
    expect(waterCellIntersectsDisc(4.9, -0.2, 5.2, 0.2, 5)).toBe(true);
    expect(waterCellIntersectsDisc(7, 7, 8, 8, 5)).toBe(false);
  });

  it('culls only after the whole lake has left fog range', () => {
    expect(waterBodyVisible(70, 0, 0, 0, 20, 50)).toBe(true);
    expect(waterBodyVisible(70.01, 0, 0, 0, 20, 50)).toBe(false);
    expect(waterBodyVisible(0, 0, 500, 500, 20, 100)).toBe(false);
  });

  it('bounds fixed-step wave simulation by graphics tier', () => {
    expect(waterSimulationPlan(29, 'medium')).toEqual({ resolution: 64, stepHz: 20 });
    expect(waterSimulationPlan(48, 'high')).toEqual({ resolution: 96, stepHz: 24 });
    expect(waterSimulationPlan(56, 'ultra')).toEqual({ resolution: 128, stepHz: 30 });
    expect(waterSimulationPlan(10_000, 'ultra')).toEqual({ resolution: 128, stepHz: 30 });
    expect(waterSimulationPlan(0, 'low')).toEqual({ resolution: 48, stepHz: 15 });
  });

  it('keeps target allocation fixed for every lake radius and contact order', () => {
    const radii = [0, 1, 29, 48, 96, 10_000];
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      const allocation = waterSimulationTargetResolution(tier);
      expect(radii.map((radius) => waterSimulationPlan(radius, tier).resolution)).toEqual(
        radii.map(() => allocation),
      );
    }
  });

  it('bounds resident height fields independently of custom-map lake count', () => {
    expect(waterResidentBodyBudget('low')).toBe(1);
    expect(waterResidentBodyBudget('medium')).toBe(2);
    expect(waterResidentBodyBudget('high')).toBe(3);
    expect(waterResidentBodyBudget('ultra')).toBe(4);
  });

  it('drops hidden impulses without extending the wake and sleeps on schedule', () => {
    const state = {
      active: true,
      pendingCount: 4,
      accumulator: 0.03,
      awakeUntil: 6,
      stepSeconds: 1 / 30,
    };
    expect(advanceWaterSchedule(state, false, 5, 0.1)).toBe(0);
    expect(state.pendingCount).toBe(0);
    expect(state.accumulator).toBe(0);
    expect(state.awakeUntil).toBe(6);
    expect(advanceWaterSchedule(state, false, 6, 0.1)).toBe(WATER_SCHEDULE_SLEEP);
  });

  it('wakes once and caps hitch catch-up to two fixed steps', () => {
    const stepSeconds = 1 / 24;
    const state = {
      active: false,
      pendingCount: 1,
      accumulator: 0,
      awakeUntil: 0,
      stepSeconds,
    };
    expect(advanceWaterSchedule(state, true, 10, 1)).toBe(WATER_SCHEDULE_WAKE);
    expect(state.active).toBe(true);
    expect(state.awakeUntil).toBe(16);
    expect(state.accumulator).toBe(stepSeconds * WATER_MAX_STEPS_PER_FRAME);
    state.pendingCount = 0;
    state.accumulator = 0;
    expect(advanceWaterSchedule(state, true, 16, 0.01)).toBe(WATER_SCHEDULE_SLEEP);
  });
});

describe('shoreDepthAt (the water view aShoreDepth sample)', () => {
  afterEach(() => setActiveWorldContent(null));

  it('built-in world: exactly WATER_LEVEL minus terrainHeight', () => {
    for (const [x, z] of [
      [0, 0],
      [40, 140],
      [-92, 88],
    ] as const) {
      expect(shoreDepthAt(x, z, SEED)).toBeCloseTo(WATER_LEVEL - terrainHeight(x, z, SEED), 10);
    }
  });

  it('tracks a custom map water level (waterLevel() reaches the shore bake)', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, waterLevel: 2.5 });
    expect(waterLevel()).toBe(2.5);
    // Compare against terrainHeight sampled under the SAME active content
    // (raising the water also raises the dry-land soft floor).
    for (const [x, z] of [
      [0, 0],
      [40, 140],
      [120, 360],
    ] as const) {
      expect(shoreDepthAt(x, z, SEED)).toBeCloseTo(2.5 - terrainHeight(x, z, SEED), 10);
    }
  });
});
