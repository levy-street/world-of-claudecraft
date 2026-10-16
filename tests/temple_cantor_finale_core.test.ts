// The plan of Laverock's finale (src/render/drowned_temple/temple_cantor_finale_core.ts):
// the fallen rise one after another across the song, deterministically, each
// breaking into moonlight off its own body's outline and sending a stream of
// light toward the moon (north); the song's light swells, holds while the
// fallen rise, then calms to a steady glow that a late arrival also finds.

import { describe, expect, it } from 'vitest';
import {
  ALTAR_FROM_STAND,
  altarFromSinger,
  ambientStream,
  bodyShape,
  FADE_SEC,
  fallenStream,
  finaleIntensity,
  HOLD_END_SEC,
  LAGOON_GLOW,
  lagoonStillness,
  MOON_DRIFT,
  moteBudget,
  PEAK,
  RISE_EMIT_SEC,
  RISE_LEAD_SEC,
  RISE_MOTES,
  RISE_SPREAD_SEC,
  riseMote,
  riseSchedule,
  STEADY,
  SWELL_SEC,
  songMote,
} from '../src/render/drowned_temple/temple_cantor_finale_core';
import { CANTOR_GUIDE } from '../src/sim/content/drowned_temple_cantor';
import { ALTAR_STONE } from '../src/sim/content/drowned_temple_layout';

describe('the finale plan', () => {
  it('staggers every fallen across the song window, none at once, malformed spots dropped', () => {
    const spots: number[] = [];
    for (let i = 0; i < 30; i++) spots.push(i * 3, 1, -i * 4);
    spots.push(Number.NaN, 0, 0);
    const plan = riseSchedule(spots, 100);
    expect(plan).toHaveLength(30);
    for (const s of plan) {
      expect(s.at).toBeGreaterThanOrEqual(100 + RISE_LEAD_SEC);
      expect(s.at).toBeLessThan(100 + RISE_LEAD_SEC + RISE_SPREAD_SEC);
    }
    const times = plan.map((s) => s.at).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(0.05);
    expect(riseSchedule(spots, 100)).toEqual(plan);
  });

  it('a mote peels off the body (its outline first), rises and drifts toward the moon', () => {
    const [spot] = riseSchedule([10, 2, 20], 0);
    const body = bodyShape(0);
    let rimFirst = 0;
    for (let k = 0; k < RISE_MOTES; k++) {
      const m = riseMote(spot, 0, k);
      expect(m.vy).toBeGreaterThan(0);
      expect(Math.sign(m.vz)).toBe(Math.sign(MOON_DRIFT.z));
      const d = Math.hypot(m.x - spot.x, m.z - spot.z);
      // Inside the body's footprint (its long half-axis, a hair over for the rim).
      expect(d).toBeLessThan((body.len / 2) * 1.06);
      // The first motes come off the outline, never the middle.
      if (k < RISE_MOTES * 0.4) {
        expect(d).toBeGreaterThan((body.wid / 2) * 0.85);
        rimFirst++;
      }
      expect(m).toEqual(riseMote(spot, 0, k));
    }
    expect(rimFirst).toBeGreaterThan(0);
    const s = songMote(0, 12, 0, 3);
    expect(s.vy).toBeGreaterThan(0);
    expect(Math.hypot(s.x, s.z)).toBeLessThan(7);
  });

  it('carries the fraction of a mote between frames', () => {
    let debt = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const b = moteBudget(debt, 1 / 60, 9);
      debt = b.debt;
      total += b.count;
    }
    expect(total).toBe(9);
  });
});

describe("the song's light", () => {
  it('swells to the peak, holds while the fallen rise, then calms to the steady glow', () => {
    expect(finaleIntensity(0, 0)).toBe(0);
    expect(finaleIntensity(SWELL_SEC / 2, 0)).toBeGreaterThan(0);
    expect(finaleIntensity(SWELL_SEC / 2, 0)).toBeLessThan(PEAK);
    expect(finaleIntensity(SWELL_SEC, 0)).toBe(PEAK);
    // The peak holds until the last fallen has risen.
    expect(HOLD_END_SEC).toBeGreaterThanOrEqual(RISE_LEAD_SEC + RISE_SPREAD_SEC + RISE_EMIT_SEC);
    expect(finaleIntensity(HOLD_END_SEC - 0.1, 0)).toBe(PEAK);
    // Then a calm, monotone fade down to the steady glow, which stays.
    let prev = PEAK;
    for (let t = HOLD_END_SEC; t < HOLD_END_SEC + 12; t += 0.5) {
      const v = finaleIntensity(t, 0);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    expect(finaleIntensity(HOLD_END_SEC + 60, 0)).toBeCloseTo(STEADY, 6);
    expect(finaleIntensity(5000, 0)).toBeCloseTo(STEADY, 6);
    expect(STEADY).toBeGreaterThan(0.3);
    expect(STEADY).toBeLessThan(PEAK);
  });

  it('a player who arrives after the song began still finds it lit, faded in', () => {
    expect(finaleIntensity(null, 0)).toBe(0);
    expect(finaleIntensity(null, FADE_SEC / 2)).toBeGreaterThan(0);
    expect(finaleIntensity(null, FADE_SEC)).toBeCloseTo(STEADY, 6);
    expect(finaleIntensity(null, 600)).toBeCloseTo(STEADY, 6);
    expect(lagoonStillness(null, FADE_SEC)).toBe(1);
  });

  it('the lagoon stills as the song swells and stays still', () => {
    expect(lagoonStillness(0, 0)).toBe(0);
    const mid = lagoonStillness(SWELL_SEC, 0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(lagoonStillness(HOLD_END_SEC, 0)).toBe(1);
  });

  it('finds the altar stone from where he stands to sing (the finale walk ends there)', () => {
    const stand = CANTOR_GUIDE.finale.path[CANTOR_GUIDE.finale.path.length - 1];
    expect(stand.x + ALTAR_FROM_STAND.x).toBe(ALTAR_STONE.x);
    expect(stand.z + ALTAR_FROM_STAND.z).toBe(ALTAR_STONE.z);
    expect(altarFromSinger(1000 + stand.x, -500 + stand.z)).toEqual({
      x: 1000 + ALTAR_STONE.x,
      z: -500 + ALTAR_STONE.z,
    });
  });
});

describe('the streams of light', () => {
  it('each fallen sends its streams up as its outline breaks, from inside its body', () => {
    const [spot] = riseSchedule([10, 2, 20], 50);
    for (let k = 0; k < 2; k++) {
      const s = fallenStream(spot, 0, k);
      expect(s.at).toBeGreaterThan(spot.at);
      expect(s.at).toBeLessThan(spot.at + 2);
      expect(Math.hypot(s.x - spot.x, s.z - spot.z)).toBeLessThan(bodyShape(0).len / 2);
      expect(s.height).toBeGreaterThan(20);
      expect(s.reach).toBeGreaterThan(20);
      expect(s.width).toBeGreaterThan(0);
      expect(s).toEqual(fallenStream(spot, 0, k));
    }
  });

  it('the lagoon streams rise off the water round the island, never on it', () => {
    for (let k = 0; k < 50; k++) {
      const s = ambientStream(100, 200, 0, k, 7);
      const r = Math.hypot(s.x - 100, s.z - 200);
      expect(r).toBeGreaterThan(LAGOON_GLOW.inner);
      expect(r).toBeLessThan(LAGOON_GLOW.outer);
      expect(s.y).toBeCloseTo(0.1, 6);
      expect(s.at).toBe(7);
    }
  });
});
