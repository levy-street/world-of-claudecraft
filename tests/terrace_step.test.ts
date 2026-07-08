import { describe, expect, it } from 'vitest';
import { TERRACE_APRON, TERRACE_STEP, TERRACE_TREAD, terraceStep } from '../src/sim/world';

// Direct pins for the pure terracing math behind the mountain walls
// (src/sim/world.ts). The parameters below are independent literals, pinned
// against the production constants so neither can drift silently;
// tests/impact_site.test.ts and tests/terrain_walls.test.ts pin the composed
// terrain, this file pins the edges of the function itself, especially the
// base-of-wall behavior that once flattened the Mirefen impact-site wall.
const STEP = 6;
const TREAD = 0.6;
const APRON = 0.5;

const terrace = (v: number) => terraceStep(v, STEP, TREAD, APRON);

describe('terraceStep', () => {
  it('the production terrace constants are the values pinned here', () => {
    expect(TERRACE_STEP).toBe(6);
    expect(TERRACE_TREAD).toBe(0.6);
    expect(TERRACE_APRON).toBe(0.5);
  });

  it('returns exactly 0 at and below 0, so callers can add it unconditionally', () => {
    expect(terrace(0)).toBe(0);
    expect(terrace(-3)).toBe(0);
    expect(Object.is(terrace(0), 0)).toBe(true);
  });

  it('keeps a linear half-slope apron under the first tread instead of a dead zone', () => {
    // Rises below TREAD * STEP (3.6) used to terrace to exactly 0, which
    // erased the wall base the Mirefen impact site leans on. They now keep
    // APRON of the smooth rise.
    expect(terrace(1)).toBe(0.5);
    expect(terrace(2)).toBe(1);
    expect(terrace(3)).toBe(1.5);
    // The old dead-zone boundary itself (TREAD * STEP): still on the apron.
    expect(terrace(3.6)).toBe(1.8);
    // The measured smooth rise at the impact-site wall sample is ~3.13yd and
    // the landmark needs > 1.31 of it kept (tests/impact_site.test.ts).
    expect(terrace(3.13)).toBeGreaterThan(1.31);
    // By v = 5 the first riser has overtaken the apron floor (2.5):
    // smoothstep(0.6, 1, 5/6) * 6 = 539/144.
    expect(terrace(5)).toBeCloseTo(539 / 144, 10);
    expect(terrace(5)).toBeGreaterThan(2.5);
  });

  it('the apron floor never reaches past the first band', () => {
    // For v >= STEP the floor caps at STEP * APRON = 3, below every higher
    // band's base, so bands 1+ are pure terracing.
    expect(terrace(STEP)).toBe(STEP);
    for (let v = STEP; v <= 40; v += 0.25) {
      expect(terrace(v), `v=${v}`).toBeGreaterThanOrEqual(STEP);
    }
  });

  it('holds treads flat through the tread fraction of higher bands', () => {
    // Band 2 spans v in [12, 18); its tread ([12, 12 + 3.6)) stays at 12.
    expect(terrace(12)).toBe(12);
    expect(terrace(13)).toBe(12);
    expect(terrace(15.5)).toBe(12);
    // The riser then reaches the next band exactly at the boundary.
    expect(terrace(18)).toBe(18);
  });

  it('risers climb steeper than the smooth ramp they replace', () => {
    // Band 1's riser lifts the full 6yd band over the last (1 - TREAD) of the
    // band, an average slope of 1 / (1 - TREAD) = 2.5 in v, vs the smooth
    // ramp's 1 (tests/terrain_walls.test.ts leans on this for impassability).
    const riserStart = STEP + TREAD * STEP; // 9.6
    const avgSlope = (terrace(2 * STEP) - terrace(riserStart)) / (2 * STEP - riserStart);
    expect(terrace(riserStart)).toBe(STEP);
    expect(avgSlope).toBeCloseTo(2.5, 10);
  });

  it('is monotonic and continuous', () => {
    // Max slope is on a riser: STEP * smoothstep'(max 1.5) / (STEP * (1 - TREAD))
    // = 3.75, so with dv = 0.01 no step may move more than 0.0375 (+ float slack).
    const dv = 0.01;
    let prev = terrace(0);
    for (let v = dv; v <= 40; v += dv) {
      const cur = terrace(v);
      expect(cur, `monotonic at v=${v}`).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(cur - prev), `continuous at v=${v}`).toBeLessThan(0.05);
      prev = cur;
    }
  });
});
