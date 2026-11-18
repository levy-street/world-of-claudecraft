// The Masterless Strength's woken stars' look and its Overload in the world,
// the pure plans (src/render/smith_heart_fx/final_stars_fx_core.ts,
// final_overload_core.ts; the owner's rework of 2026-11-18):
//   - a bolt out of the sky lands on its spot, deterministic from its seed,
//     its fork leaving the trunk;
//   - a floor ring races out to its reach and fades;
//   - a Crossing Blade hovers upright at its rise, tips as its line locks,
//     flies its line point first on the sim's own eased curve;
//   - a line fills off its mark's own aura;
//   - the Overload: the body's strain swells and burns hotter as the bar
//     fills, the floor throbs, the wall erupts from three quarters.

import { describe, expect, it } from 'vitest';
import {
  eruptLevel,
  eruptStarts,
  floorThrob,
  strainLook,
} from '../src/render/smith_heart_fx/final_overload_core';
import {
  bladeEase,
  bladeFlight,
  boltFlash,
  boltPath,
  chargedArc,
  laneFill,
  ringWave,
  STAR_COLORS,
} from '../src/render/smith_heart_fx/final_stars_fx_core';
import { FINAL_OVERLOAD } from '../src/sim/encounters/smith_heart/final_ids';

describe("the stars' look", () => {
  it('a bolt falls out of the sky onto its spot, the same for the same seed, with a fork', () => {
    const a = new Float32Array(64);
    const b = new Float32Array(64);
    const trunk = boltPath(77, 40, a);
    boltPath(77, 40, b);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[1]).toBeCloseTo(40, 5);
    // Its last trunk point lands on the spot.
    expect(a[(trunk - 1) * 3]).toBeCloseTo(0, 5);
    expect(a[(trunk - 1) * 3 + 1]).toBeCloseTo(0, 5);
    expect(a[(trunk - 1) * 3 + 2]).toBeCloseTo(0, 5);
    // The fork is under the sky and over the floor.
    expect(a[trunk * 3 + 1]).toBeLessThan(40);
    expect(a[trunk * 3 + 1]).toBeGreaterThan(0);
    expect(boltFlash(0, 0.4)).toBe(1);
    expect(boltFlash(0.41, 0.4)).toBe(0);
  });

  it('a floor ring races out to its reach and fades', () => {
    expect(ringWave(0, 9, 0.5).front).toBe(0);
    const mid = ringWave(0.25, 9, 0.5);
    expect(mid.front).toBeGreaterThan(4);
    expect(mid.alpha).toBeLessThan(1);
    expect(ringWave(0.5, 9, 0.5).alpha).toBe(0);
  });

  it('a blade hovers upright, tips as its line locks, and flies point first', () => {
    const pose = { along: 0, tilt: 0, lift: 0, glow: 0 };
    bladeFlight(0, false, 0, false, 0, pose);
    expect(pose.along).toBe(0);
    expect(pose.tilt).toBeLessThan(0.2);
    const quiet = pose.glow;
    bladeFlight(0, false, 1, true, 0, pose);
    expect(pose.tilt).toBeGreaterThan(0.2);
    expect(pose.glow).toBeGreaterThan(quiet);
    bladeFlight(0, true, 1, true, 0.5, pose);
    expect(pose.tilt).toBe(1);
    expect(pose.along).toBeCloseTo(bladeEase(0.5), 9);
    bladeFlight(0, true, 1, true, 1, pose);
    expect(pose.along).toBe(1);
  });

  it("a line fills off its mark's own aura, whole once it locks", () => {
    expect(laneFill('warn', 4, 4)).toBe(0);
    expect(laneFill('warn', 1, 4)).toBeCloseTo(0.75, 9);
    expect(laneFill('lock', 0.5, 4)).toBe(1);
    expect(laneFill('fly', 0, 4)).toBe(1);
  });

  it('a charged pillar crawls with arcs on its own stone, violet-white', () => {
    const arc = chargedArc(1.3, 41, 0);
    expect(arc.from).toBeGreaterThanOrEqual(0);
    expect(arc.to).toBeLessThanOrEqual(1);
    expect(arc.to).toBeGreaterThan(arc.from);
    // Violet-white: blue and red high, never a plain white.
    const [r, g, b] = STAR_COLORS.charged;
    expect(b).toBeGreaterThanOrEqual(r);
    expect(r).toBeGreaterThan(g);
  });
});

describe('the Overload in the world', () => {
  it('the strain swells and burns hotter as the bar fills; nothing at an empty bar', () => {
    expect(strainLook(0, 1).crack).toBe(0);
    const half = strainLook(0.5, 1);
    const full = strainLook(1, 1);
    expect(full.crack).toBeGreaterThan(half.crack);
    expect(full.swell).toBeGreaterThan(half.swell);
    expect(half.swell).toBeGreaterThan(1);
  });

  it('the floor throbs from a third, the wall erupts from three quarters', () => {
    expect(floorThrob(0.2, 3)).toBe(0);
    expect(floorThrob(0.9, 3)).toBeGreaterThan(0);
    expect(eruptLevel(FINAL_OVERLOAD.eruptAt - 0.01)).toBe(0);
    expect(eruptLevel(FINAL_OVERLOAD.eruptAt + 0.1)).toBe(1);
    expect(eruptStarts(0.7, 0.76)).toBe(true);
    expect(eruptStarts(0.76, 0.8)).toBe(false);
  });
});
