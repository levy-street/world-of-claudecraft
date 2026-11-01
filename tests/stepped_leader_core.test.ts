import { describe, expect, it } from 'vitest';
import {
  AFTERGLOW_END_S,
  arcBoltLeaderPlan,
  BRANCH_PTS,
  createLeaderPath,
  flightLightGain,
  followHead,
  LEADER_AURA_QUALITY,
  LEADER_BRANCH_QUALITY,
  LEADER_KINKS_PER_STEP,
  type LeaderPath,
  leaderCapacity,
  planBranch,
  RESTRIKE_AT_S,
  RESTRIKE_END_S,
  RESTRIKE_GAIN,
  RETURN_STROKE_S,
  resetLeaderPath,
  type StrokeEnvelope,
  segmentBasis,
  setLeaderOrigin,
  stepLeader,
  strokeEnvelopeAt,
  strokeLightGain,
  strokeLightPosition,
} from '../src/render/ability_vfx/stepped_leader_core';

// mulberry32: a seeded stand-in for the painter's Math.random
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function point(path: LeaderPath, i: number): [number, number, number] {
  return [path.xyz[i * 3], path.xyz[i * 3 + 1], path.xyz[i * 3 + 2]];
}

/** Fly a head from (0,1,0) along +x at 1.3 yd per step and carve each step. */
function fly(steps: number, seed = 7, path = createLeaderPath(96)): LeaderPath {
  const rand = seeded(seed);
  resetLeaderPath(path, 0, 1, 0);
  for (let s = 1; s <= steps; s++) stepLeader(path, s * 1.3, 1, 0, 0.5, rand);
  return path;
}

describe('segmentBasis', () => {
  it('returns an orthonormal frame, including for a vertical segment', () => {
    for (const [dx, dy, dz] of [
      [3, 0, 0],
      [1, 2, -1],
      [0, 5, 0],
      [0, -2, 0],
    ]) {
      const b = { dx: 0, dy: 0, dz: 0, sx: 0, sy: 0, sz: 0, ux: 0, uy: 0, uz: 0 };
      expect(segmentBasis(dx, dy, dz, b)).toBe(true);
      const dot = (a: number[], c: number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
      const d = [b.dx, b.dy, b.dz];
      const s = [b.sx, b.sy, b.sz];
      const u = [b.ux, b.uy, b.uz];
      for (const v of [d, s, u]) expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6);
      expect(dot(d, s)).toBeCloseTo(0, 6);
      expect(dot(d, u)).toBeCloseTo(0, 6);
      expect(dot(s, u)).toBeCloseTo(0, 6);
    }
  });

  it('refuses a zero-length segment', () => {
    const b = { dx: 0, dy: 0, dz: 0, sx: 0, sy: 0, sz: 0, ux: 0, uy: 0, uz: 0 };
    expect(segmentBasis(0, 0, 0, b)).toBe(false);
  });
});

describe('stepLeader: a carved, stepped channel', () => {
  it('always ends exactly on the live head and adds the kinks per step', () => {
    const path = fly(5);
    expect(path.count).toBe(1 + 5 * (LEADER_KINKS_PER_STEP + 1));
    expect(point(path, path.count - 1)).toEqual([5 * 1.3, 1, 0]);
    expect(point(path, 0)).toEqual([0, 1, 0]);
  });

  it('keeps every point it already carved (the path is never re-rolled)', () => {
    const rand = seeded(3);
    const path = createLeaderPath(96);
    resetLeaderPath(path, 0, 1, 0);
    stepLeader(path, 1.3, 1, 0, 0.5, rand);
    stepLeader(path, 2.6, 1, 0, 0.5, rand);
    const before = Array.from(path.xyz.slice(0, path.count * 3));
    stepLeader(path, 3.9, 1, 0, 0.5, rand);
    expect(Array.from(path.xyz.slice(0, before.length))).toEqual(before);
  });

  it('really kinks off the straight line, and stays within the jag bound', () => {
    const path = fly(10, 11);
    let maxOff = 0;
    for (let i = 0; i < path.count; i++) {
      const [, y, z] = point(path, i);
      maxOff = Math.max(maxOff, Math.hypot(y - 1, z));
    }
    // a step is 1.3 yd long, the kink bound is len * jag on each axis
    expect(maxOff).toBeGreaterThan(0.05);
    expect(maxOff).toBeLessThanOrEqual(1.3 * 0.5 * Math.SQRT2 + 1e-6);
  });

  it('kinks march forward inside their own step', () => {
    const path = fly(6, 5);
    for (let i = 1; i < path.count; i++) {
      expect(point(path, i)[0]).toBeGreaterThan(point(path, i - 1)[0]);
    }
  });

  it('is deterministic for a given random source', () => {
    expect(Array.from(fly(8, 99).xyz)).toEqual(Array.from(fly(8, 99).xyz));
    expect(Array.from(fly(8, 99).xyz)).not.toEqual(Array.from(fly(8, 100).xyz));
  });

  it('slides the last point once full instead of overflowing', () => {
    const path = createLeaderPath(7);
    const rand = seeded(1);
    resetLeaderPath(path, 0, 0, 0);
    expect(stepLeader(path, 1, 0, 0, 0.5, rand)).toBe(true);
    expect(stepLeader(path, 2, 0, 0, 0.5, rand)).toBe(true);
    expect(path.count).toBe(7);
    expect(stepLeader(path, 3, 0, 0, 0.5, rand)).toBe(false);
    expect(path.count).toBe(leaderCapacity(path));
    expect(point(path, path.count - 1)).toEqual([3, 0, 0]);
  });

  it('carves nothing for a head that has not moved', () => {
    const path = createLeaderPath(16);
    resetLeaderPath(path, 1, 1, 1);
    expect(stepLeader(path, 1, 1, 1, 0.5, seeded(1))).toBe(false);
    expect(path.count).toBe(1);
  });

  it('followHead keeps the tip on the head between steps; setLeaderOrigin re-pins the root', () => {
    const path = fly(2);
    const n = path.count;
    followHead(path, 3.0, 1.2, 0.1);
    expect(path.count).toBe(n);
    expect(point(path, n - 1)).toEqual([3, Math.fround(1.2), Math.fround(0.1)]);
    setLeaderOrigin(path, -0.5, 1.4, 0.2);
    expect(point(path, 0)).toEqual([-0.5, Math.fround(1.4), Math.fround(0.2)]);
    const fresh = createLeaderPath(4);
    followHead(fresh, 2, 2, 2);
    expect(fresh.count).toBe(1);
    followHead(fresh, 3, 3, 3);
    expect(fresh.count).toBe(2);
  });
});

describe('planBranch: forked tendrils', () => {
  it('fills BRANCH_PTS points from the base, angled off the heading, about the asked length', () => {
    const out = createLeaderPath(BRANCH_PTS);
    planBranch(out, 2, 1, 0, 1, 0, 0, 2.5, seeded(4));
    expect(out.count).toBe(BRANCH_PTS);
    expect(point(out, 0)).toEqual([2, 1, 0]);
    const end = point(out, out.count - 1);
    const reach = Math.hypot(end[0] - 2, end[1] - 1, end[2]);
    expect(reach).toBeGreaterThan(1);
    expect(reach).toBeLessThan(2.5 * 1.8);
    // it leaves the main heading: some sideways or vertical departure
    expect(Math.hypot(end[1] - 1, end[2])).toBeGreaterThan(0.2);
  });

  it('a zero heading leaves only the base point', () => {
    const out = createLeaderPath(BRANCH_PTS);
    planBranch(out, 0, 0, 0, 0, 0, 0, 2, seeded(1));
    expect(out.count).toBe(1);
  });
});

describe('the impact sequence envelope', () => {
  const env: StrokeEnvelope = { stroke: 0, afterglow: 0, done: false };

  it('return stroke, dark gap, restrike, then afterglow, then done', () => {
    expect(strokeEnvelopeAt(0, true, env).stroke).toBe(1);
    expect(strokeEnvelopeAt(RETURN_STROKE_S - 0.001, true, env).stroke).toBe(1);
    expect(strokeEnvelopeAt((RETURN_STROKE_S + RESTRIKE_AT_S) / 2, true, env).stroke).toBe(0);
    expect(strokeEnvelopeAt(RESTRIKE_AT_S + 0.01, true, env).stroke).toBe(RESTRIKE_GAIN);
    const glow = strokeEnvelopeAt(RESTRIKE_END_S + 0.05, true, env);
    expect(glow.stroke).toBe(0);
    expect(glow.afterglow).toBeGreaterThan(0);
    expect(glow.done).toBe(false);
    expect(strokeEnvelopeAt(AFTERGLOW_END_S, true, env).done).toBe(true);
    expect(strokeEnvelopeAt(AFTERGLOW_END_S, true, env).afterglow).toBe(0);
  });

  it('without restrike nothing flashes a second time', () => {
    for (let t = RETURN_STROKE_S; t < AFTERGLOW_END_S; t += 0.005) {
      expect(strokeEnvelopeAt(t, false, env).stroke).toBe(0);
      expect(strokeLightGain(t, false)).toBeLessThan(0.3);
    }
  });

  it('the afterglow only fades', () => {
    let prev = 2;
    for (let t = RESTRIKE_END_S; t < AFTERGLOW_END_S; t += 0.02) {
      const a = strokeEnvelopeAt(t, true, env).afterglow;
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  it('light: full at the stroke, the restrike gain at the restrike, zero once done', () => {
    expect(strokeLightGain(0, true)).toBe(1);
    expect(strokeLightGain(RESTRIKE_AT_S + 0.01, true)).toBe(RESTRIKE_GAIN);
    expect(strokeLightGain(AFTERGLOW_END_S, true)).toBe(0);
    expect(strokeLightGain(-0.1, true)).toBe(0);
  });

  it('flight light flickers between 0.7 and 1, clamped', () => {
    expect(flightLightGain(0)).toBeCloseTo(0.7);
    expect(flightLightGain(1)).toBeCloseTo(1);
    expect(flightLightGain(5)).toBeCloseTo(1);
    expect(flightLightGain(-1)).toBeCloseTo(0.7);
  });
});

describe('strokeLightPosition: the flash stands off the struck body', () => {
  it('sits back along the channel toward the caster, lifted', () => {
    const path = fly(8);
    followHead(path, 10, 1, 0);
    const out = { x: 0, y: 0, z: 0 };
    strokeLightPosition(path, 1.3, 0.5, out);
    expect(out.x).toBeLessThan(10);
    expect(out.x).toBeGreaterThan(10 - 1.3 - 1e-6);
    expect(Math.hypot(out.x - 10, out.y - 0.5 - 1, out.z)).toBeLessThanOrEqual(1.3 + 1e-5);
  });

  it('falls back to the end point (lifted) for a single-point path', () => {
    const path = createLeaderPath(4);
    resetLeaderPath(path, 2, 3, 4);
    const out = { x: 0, y: 0, z: 0 };
    strokeLightPosition(path, 1.3, 0.5, out);
    expect(out).toEqual({ x: 2, y: 3.5, z: 4 });
  });
});

describe('arcBoltLeaderPlan: what each budget tier draws', () => {
  it('tier 0 is the full leader, tier 1 drops branches and the restrike, tier 2 draws none', () => {
    expect(arcBoltLeaderPlan(0, false)).toEqual({
      scale: 1,
      branches: true,
      restrike: true,
      aura: true,
    });
    expect(arcBoltLeaderPlan(1, false)).toEqual({
      scale: 1,
      branches: false,
      restrike: false,
      aura: true,
    });
    expect(arcBoltLeaderPlan(2, false)).toBeNull();
  });

  it('the Arc Overload echo is the same bolt, smaller and without a restrike', () => {
    expect(arcBoltLeaderPlan(0, true)).toEqual({
      scale: 0.7,
      branches: true,
      restrike: false,
      aura: true,
    });
    expect(arcBoltLeaderPlan(2, true)).toBeNull();
  });

  it('falling VFX quality sheds branches first, then the plasma aura, never the bolt', () => {
    expect(arcBoltLeaderPlan(0, false, LEADER_BRANCH_QUALITY)).toMatchObject({ branches: true });
    expect(arcBoltLeaderPlan(0, false, LEADER_BRANCH_QUALITY - 0.01)).toMatchObject({
      branches: false,
      aura: true,
    });
    expect(arcBoltLeaderPlan(0, false, LEADER_AURA_QUALITY - 0.01)).toMatchObject({
      branches: false,
      aura: false,
    });
    expect(arcBoltLeaderPlan(0, false, 0)).not.toBeNull();
  });
});
