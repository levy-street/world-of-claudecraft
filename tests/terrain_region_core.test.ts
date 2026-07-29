import { afterEach, describe, expect, it } from 'vitest';
import {
  chunkIntersectsRegion,
  normalTexelBounds,
  owningRectIndex,
  rectDistance,
  type WorldRect,
} from '../src/render/terrain_region_core';
import {
  advanceWaterSchedule,
  shoreDepthAt,
  snapWaterFieldOrigin,
  WATER_FIELD_CELL_SIZE,
  WATER_MAX_STEPS_PER_FRAME,
  WATER_SCHEDULE_SLEEP,
  WATER_SCHEDULE_WAKE,
  waterFieldNeedsReanchor,
  waterFieldPlan,
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

describe('owningRectIndex (terrain chunk cell -> building zone)', () => {
  // Three rects laid out like the real world's south end: a centre strip, an
  // east wing beside it, and a west wing one band NORTH of them, leaving the
  // south-west corner covered by nobody.
  const STRIP: WorldRect = { minX: -180, maxX: 180, minZ: -180, maxZ: 180 };
  const EAST: WorldRect = { minX: 180, maxX: 540, minZ: -180, maxZ: 180 };
  const WEST_NORTH: WorldRect = { minX: -540, maxX: -180, minZ: 180, maxZ: 700 };
  const RECTS = [STRIP, EAST, WEST_NORTH];

  it('returns the containing rect', () => {
    expect(owningRectIndex(0, 0, RECTS)).toBe(0);
    expect(owningRectIndex(300, -100, RECTS)).toBe(1);
    expect(owningRectIndex(-300, 400, RECTS)).toBe(2);
  });

  it('resolves a shared border to exactly one rect (half-open on max)', () => {
    // x = 180 is STRIP's max edge and EAST's min edge: EAST takes it, and no
    // point is ever claimed twice.
    expect(owningRectIndex(180, 0, RECTS)).toBe(1);
    expect(owningRectIndex(179.999, 0, RECTS)).toBe(0);
  });

  it('gives an uncovered cell to the nearest rect, not to a z-band neighbour', () => {
    // The real bug: (-210, 150) is the chunk cell holding the dry ground south
    // of the Willowfen border, inside no rect at all. It must still be built.
    // Nearest here is a tie (30 west of STRIP, 30 south of WEST_NORTH), broken
    // to the lower index.
    expect(owningRectIndex(-210, 150, RECTS)).toBe(0);
    // Deep in the gap the west wing is unambiguously nearer than the strip,
    // so a z-band clamp (which would say "strip, same latitude") is wrong.
    expect(owningRectIndex(-510, 150, RECTS)).toBe(2);
    // ...and low in the gap the strip is nearer than the west wing.
    expect(owningRectIndex(-210, -150, RECTS)).toBe(0);
  });

  it('gives a cell past a rect edge back to that rect', () => {
    // The chunk grid overhangs the world box by up to one row; the overhanging
    // cell centres sit just outside the northmost rect and must build with it.
    expect(owningRectIndex(-300, 720, RECTS)).toBe(2);
  });

  it('reports -1 for an empty rect list', () => {
    expect(owningRectIndex(0, 0, [])).toBe(-1);
  });
});

describe('rectDistance', () => {
  const R: WorldRect = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

  it('is zero inside and on the border', () => {
    expect(rectDistance(0, 0, R)).toBe(0);
    expect(rectDistance(10, 10, R)).toBe(0);
    expect(rectDistance(-10, 4, R)).toBe(0);
  });

  it('measures the axis gap outside, and the corner diagonal past a corner', () => {
    expect(rectDistance(13, 0, R)).toBeCloseTo(3, 10);
    expect(rectDistance(0, -14, R)).toBeCloseTo(4, 10);
    expect(rectDistance(13, 14, R)).toBeCloseTo(5, 10); // 3-4-5
  });
});

describe('camera-anchored wave field plan', () => {
  it('bounds the field allocation and step rate by graphics tier', () => {
    expect(waterFieldPlan('medium')).toEqual({
      resolution: 64,
      cellSize: WATER_FIELD_CELL_SIZE,
      size: 64 * WATER_FIELD_CELL_SIZE,
      stepHz: 20,
    });
    expect(waterFieldPlan('high')).toEqual({
      resolution: 96,
      cellSize: WATER_FIELD_CELL_SIZE,
      size: 96 * WATER_FIELD_CELL_SIZE,
      stepHz: 24,
    });
    expect(waterFieldPlan('ultra').resolution).toBe(128);
    expect(waterFieldPlan('ultra').stepHz).toBe(30);
    expect(waterFieldPlan('low').resolution).toBe(48);
    expect(waterFieldPlan('low').stepHz).toBe(15);
  });

  it('keeps the world-space cell size fixed across tiers, so only coverage scales', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      const plan = waterFieldPlan(tier);
      expect(plan.cellSize).toBe(WATER_FIELD_CELL_SIZE);
      expect(plan.size).toBeCloseTo(plan.resolution * plan.cellSize, 10);
    }
  });

  it('snaps the field origin to the texel lattice so a re-anchor never resamples', () => {
    // Any snapped origin is an exact multiple of the cell size: that is what
    // makes the scroll pass an integer texel shift instead of a blur.
    for (const value of [0, 0.34, -0.34, 12.7, -103.2]) {
      const snapped = snapWaterFieldOrigin(value, 0.7);
      expect(Math.abs(snapped / 0.7 - Math.round(snapped / 0.7))).toBeLessThan(1e-9);
      expect(Math.abs(snapped - value)).toBeLessThanOrEqual(0.35 + 1e-9);
    }
  });

  it('re-anchors only once the camera leaves the hysteresis band', () => {
    const size = 64;
    // Dead centre and small drifts hold the anchor (no scroll pass per frame).
    expect(waterFieldNeedsReanchor(0, 0, 0, 0, size)).toBe(false);
    expect(waterFieldNeedsReanchor(9, 0, 0, 0, size)).toBe(false);
    // Past 30% of the half-size (9.6 yd here) on either axis, it re-centres.
    expect(waterFieldNeedsReanchor(10, 0, 0, 0, size)).toBe(true);
    expect(waterFieldNeedsReanchor(0, -10, 0, 0, size)).toBe(true);
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
