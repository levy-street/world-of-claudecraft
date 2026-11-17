// The Guardian of the Quench's holes read as real holes (the owner's heroic
// run of 2026-11-17): the broken lip and its shards (quench_hole_core.ts), the
// sunken water and ice walls drawn by parallax on the hole's one disc
// (quench_hole_glsl.ts, camera-relative, still on its own ladder rung), the
// break and the plunge.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HOLE_DEPTH,
  HOLE_DISC_SCALE,
  HOLE_EDGE,
  HOLE_SHARDS,
  type HoleShard,
  holeHeave,
  holeShard,
} from '../src/render/smith_heart_fx/quench_hole_core';
import { HOLE_FRAG, HOLE_VERT } from '../src/render/smith_heart_fx/quench_hole_glsl';

describe('quench_hole_core: the broken lip', () => {
  it('draws past the hole: its edge is the sim radius inside a wider disc', () => {
    expect(HOLE_DISC_SCALE).toBeGreaterThan(1.2);
    expect(HOLE_EDGE * HOLE_DISC_SCALE).toBeCloseTo(1, 9);
    expect(HOLE_DEPTH).toBeGreaterThan(1);
  });

  it('rings the lip with shards, a little outside it, leaning out, deterministic', () => {
    const r = 2.5;
    const s: HoleShard = { x: 0, z: 0, h: 0, w: 0, lean: 0, yaw: 0 };
    const bearings: number[] = [];
    for (let k = 0; k < HOLE_SHARDS; k++) {
      holeShard(1234, k, r, s);
      const d = Math.hypot(s.x, s.z);
      expect(d).toBeGreaterThanOrEqual(r);
      expect(d).toBeLessThan(r * 1.25);
      expect(s.lean).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0.3);
      bearings.push(Math.atan2(s.x, s.z));
      const again = holeShard(1234, k, r, { x: 0, z: 0, h: 0, w: 0, lean: 0, yaw: 0 });
      expect(again).toEqual(s);
    }
    // All the way round, never bunched on one side.
    const sorted = bearings.map((b) => (b + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i] - sorted[i - 1]).toBeLessThan((2 * Math.PI) / HOLE_SHARDS + 0.8);
  });

  it('heaves the shards up fast as it breaks, then holds', () => {
    expect(holeHeave(0)).toBe(0);
    expect(holeHeave(0.2)).toBeGreaterThan(0.5);
    expect(holeHeave(1)).toBe(1);
  });
});

describe('quench_hole_glsl: a hole with depth, without a flicker', () => {
  it('follows the view ray down to the wall or the water, camera-relative', () => {
    expect(HOLE_VERT).toContain('wocCamRelView');
    expect(HOLE_VERT).not.toMatch(/modelViewMatrix \* instanceMatrix/);
    expect(HOLE_FRAG).toContain('cameraPosition');
    expect(HOLE_FRAG).toContain(HOLE_DEPTH.toFixed(4));
    // GLSL reserves `out`: never a variable of that name.
    expect(HOLE_FRAG).not.toMatch(/float out\b/);
  });

  it('the fight paints it on the ladder, with shards, mist, the break and the plunge', () => {
    const src = readFileSync('src/render/smith_heart_fx/quench_fight_fx.ts', 'utf8');
    expect(src).toContain('HOLE_VERT');
    expect(src).toContain('QUENCH_FLOOR.holes.step');
    expect(src).toContain('smithHeartQuenchHoleShards');
    expect(src).toContain('this.breakHole(');
    expect(src).toContain('this.plunge(');
    expect(src).toContain('HOLE_MIST_RATE');
  });
});
