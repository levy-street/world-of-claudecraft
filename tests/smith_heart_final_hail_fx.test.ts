// The Hailstorm's stones (the second polish pass of 2026-11-24: the first
// pass's stones read as big smooth blue balloons): the pure plan
// (src/render/smith_heart_fx/final_hail_core.ts). The painter over a fake
// world is in tests/smith_heart_final_elements_ui.test.ts.

import { describe, expect, it } from 'vitest';
import {
  type HailChunk,
  type HailShard,
  hailChunk,
  hailChunkHeight,
  hailShardAt,
  hailShardReach,
  hailTrailLength,
  iceCornerScale,
  HAIL_LOOK as L,
} from '../src/render/smith_heart_fx/final_hail_core';
import { ELEMENT_TUNING as E } from '../src/sim/encounters/smith_heart/final_elements_ids';

const chunk = (): HailChunk => ({
  dx: 0,
  dz: 0,
  size: 0,
  sx: 0,
  sy: 0,
  sz: 0,
  lag: 0,
  shape: 0,
  ax: 0,
  ay: 0,
  az: 0,
  spin: 0,
});

describe('the hail chunks', () => {
  it('every chunk lands inside the sim circle (its offset and its own size)', () => {
    const c = chunk();
    for (const r of [E.hailR, 2, 4])
      for (let seed = 0; seed < 40; seed++)
        for (let k = 0; k < L.stones; k++) {
          hailChunk(k, seed, r, c);
          const widest = Math.max(c.sx, c.sy, c.sz);
          expect(Math.hypot(c.dx, c.dz) + widest, `r ${r} seed ${seed} k ${k}`).toBeLessThanOrEqual(
            r + 1e-9,
          );
        }
  });

  it('a cluster: the main stone in the middle, smaller lumps round it, several shapes', () => {
    const c = chunk();
    hailChunk(0, 7, E.hailR, c);
    expect(c.dx).toBe(0);
    expect(c.dz).toBe(0);
    expect(c.size).toBe(L.mainSize);
    const shapes = new Set<number>();
    for (let seed = 0; seed < 12; seed++)
      for (let k = 1; k < L.stones; k++) {
        hailChunk(k, seed, E.hailR, c);
        expect(c.size).toBeLessThan(L.mainSize);
        // A lump, never a ball: its axes differ.
        expect(Math.max(c.sx, c.sy, c.sz) - Math.min(c.sx, c.sy, c.sz)).toBeGreaterThan(0);
        shapes.add(c.shape);
      }
    expect(shapes.size).toBe(L.shapes);
    // Smaller than the first pass's ball (1.35 yd across its radius).
    expect(L.mainSize).toBeLessThan(1);
  });

  it('every chunk lands with the main stone (the sim beat)', () => {
    for (const lag of [0, 0.1, L.lag]) {
      expect(hailChunkHeight(0, lag)).toBe(0);
      expect(hailChunkHeight(10, lag)).toBeGreaterThanOrEqual(10);
    }
  });

  it('the same corner always moves the same way (a closed lump), never collapsing', () => {
    for (let s = 0; s < L.shapes; s++) {
      const a = iceCornerScale(0.5257, 0.8507, 0, s);
      expect(iceCornerScale(0.5257, 0.8507, 0, s)).toBe(a);
      expect(a).toBeGreaterThan(0.6);
      expect(a).toBeLessThan(1.2);
    }
  });

  it('the frost trail grows as the stone speeds up', () => {
    expect(hailTrailLength(20, 20)).toBeCloseTo(L.trail[0], 6);
    expect(hailTrailLength(0, 20)).toBeCloseTo(L.trail[1], 6);
  });
});

describe('the shatter', () => {
  it('shards fly, fall to the floor and melt away inside their life', () => {
    const s: HailShard = { x: 0, y: 0, z: 0, scale: 0, spin: 0 };
    for (let i = 0; i < L.shards; i++) {
      hailShardAt(i, 3, 0.05, s);
      expect(s.scale).toBeGreaterThan(0);
      for (let t = 0; t < L.shardLife; t += 0.05) {
        hailShardAt(i, 3, t, s);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(hailShardReach() + 1e-9);
      }
      hailShardAt(i, 3, L.shardLife, s);
      expect(s.scale).toBe(0);
    }
    // The debris stays round the circle it hit.
    expect(hailShardReach()).toBeLessThan(E.hailR * 4);
  });

  it('the low tier keeps the stones, fewer of them and fewer shards', () => {
    expect(L.stonesLow).toBeGreaterThanOrEqual(1);
    expect(L.stonesLow).toBeLessThan(L.stones);
    expect(L.shardsLow).toBeGreaterThan(0);
    expect(L.shardsLow).toBeLessThan(L.shards);
  });
});
