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
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { FINAL_BODY_GESTURES } from '../src/render/smith_heart_fx/final_body_core';
import { tornadoDebris, tornadoProfile } from '../src/render/smith_heart_fx/final_kit_fx_core';
import {
  eruptLevel,
  eruptStarts,
  floorThrob,
  strainLook,
  strainPulse,
} from '../src/render/smith_heart_fx/final_overload_core';
import {
  BLADE_DRAW_BACK,
  BLADE_FLY_LIFT,
  BLADE_HOVER_LIFT,
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

  it('a blade hovers level over the rim, draws back as its line locks, and flies its line low', () => {
    const pose = { along: 0, pitch: 0, lift: 0, glow: 0 };
    bladeFlight(0, false, 0, false, 0, pose);
    expect(pose.along).toBe(0);
    // Lying along its line (a small nose-down pitch), high over the rim.
    expect(pose.pitch).toBeLessThan(0.3);
    expect(pose.lift).toBeGreaterThan(BLADE_HOVER_LIFT - 0.5);
    const quiet = pose.glow;
    bladeFlight(0, false, 1, true, 0, pose);
    expect(pose.along).toBeCloseTo(-BLADE_DRAW_BACK, 9);
    expect(pose.glow).toBeGreaterThan(quiet);
    bladeFlight(0, true, 1, true, 0, pose);
    expect(pose.along).toBeCloseTo(-BLADE_DRAW_BACK, 9);
    bladeFlight(0, true, 1, true, 0.5, pose);
    expect(pose.along).toBeCloseTo(-BLADE_DRAW_BACK + (1 + BLADE_DRAW_BACK) * bladeEase(0.5), 9);
    expect(pose.lift).toBeCloseTo(BLADE_FLY_LIFT, 9);
    bladeFlight(0, true, 1, true, 1, pose);
    expect(pose.along).toBeCloseTo(1, 9);
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

describe('the fire tornado', () => {
  it('is a funnel: a narrow throat on the floor flaring wide at its top', () => {
    expect(tornadoProfile(0)).toBeLessThan(0.25);
    expect(tornadoProfile(1)).toBeCloseTo(1, 9);
    for (let h = 0.1; h <= 1; h += 0.1)
      expect(tornadoProfile(h)).toBeGreaterThan(tornadoProfile(h - 0.1));
  });

  it('whirls its rocks round and up the funnel, each its own place', () => {
    const a = { ...tornadoDebris(3, 0, 10, 1) };
    const b = { ...tornadoDebris(3, 5, 10, 1) };
    expect(a.height).toBeGreaterThanOrEqual(0);
    expect(a.height).toBeLessThan(1);
    expect(a.angle).not.toBeCloseTo(b.angle, 3);
    // They climb as time runs.
    const later = tornadoDebris(3.5, 0, 10, 1);
    expect((later.height - a.height + 1) % 1).toBeGreaterThan(0);
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

  it("the body's own cracks throb in three steps, quicker as the bar fills", () => {
    expect(strainPulse(0.2).level).toBe(0);
    const low = strainPulse(0.3);
    const mid = strainPulse(0.6);
    const high = strainPulse(0.95);
    expect([low.level, mid.level, high.level]).toEqual([1, 2, 3]);
    expect(high.every).toBeLessThan(mid.every);
    expect(mid.every).toBeLessThan(low.every);
    // Each step is a glow pulse on the rig itself, each brighter than the last.
    const pulses = SMITH_HEART_BOSS_LOOKS.smith_heart_masterless_strength.glowPulses?.pulses ?? [];
    const peaks = FINAL_BODY_GESTURES.strain.map(
      (g) => pulses.find((p) => p.gesture === g)?.peak ?? 0,
    );
    expect(peaks[0]).toBeGreaterThan(1);
    expect(peaks[1]).toBeGreaterThan(peaks[0]);
    expect(peaks[2]).toBeGreaterThan(peaks[1]);
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
