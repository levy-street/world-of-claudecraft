import { afterEach, describe, expect, it } from 'vitest';
import { chunkIntersectsRegion, normalTexelBounds } from '../src/render/terrain_region_core';
import { shoreDepthAt } from '../src/render/water_core';
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
