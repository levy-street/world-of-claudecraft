// The Hollow Crypt wing bosses' pure effect plan (src/render/hollow_crypt/
// crypt_boss_fx_core.ts): the lantern looks follow the sim's lantern states,
// the bell rope and its swing, the grave opening and the slot origin. (The
// Dirge's pillar shadows are the shared sight field now:
// tests/ilvane_dirge_fx_core.test.ts.)

import { describe, expect, it } from 'vitest';
import {
  BELL_MOUTH_OVER_YARD,
  bellSwing,
  cryptSlotOrigin,
  embraceSpiral,
  fadeIn,
  graveOpening,
  lanternLook,
  noteRun,
  pulse,
  ropePull,
} from '../src/render/hollow_crypt/crypt_boss_fx_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';

describe('crypt boss fx core: the lanterns, the bell, the graves', () => {
  it('draws the shelter pool only for a lit lantern, a weak stutter while kindling', () => {
    expect(lanternLook('dark', 3, 1).pool).toBe(0);
    expect(lanternLook('dark', 3, 1).flame).toBe(0);
    expect(lanternLook('lit', 3, 1).pool).toBeGreaterThan(0.8);
    for (let t = 0; t < 4; t += 0.13) expect(lanternLook('kindling', t, 2).pool).toBeLessThan(0.31);
  });

  it('hauls the rope once a second, bottoming at 0.9, and swings the bell harder each peal', () => {
    expect(ropePull(0)).toBe(0);
    expect(ropePull(0.9)).toBeCloseTo(1, 6);
    expect(ropePull(1.9)).toBeCloseTo(1, 6);
    expect(ropePull(-1)).toBe(0);
    expect(bellSwing(-1)).toBe(0);
    const peak = (from: number) => {
      let m = 0;
      for (let t = from; t < from + 1; t += 0.01) m = Math.max(m, Math.abs(bellSwing(t)));
      return m;
    };
    expect(peak(2)).toBeGreaterThan(peak(0));
    expect(BELL_MOUTH_OVER_YARD).toBeGreaterThan(15);
  });

  it('opens a grave over 0.45 s, fades a decal in, pulses and runs the notes', () => {
    expect(graveOpening(0)).toBe(0);
    expect(graveOpening(0.45)).toBe(1);
    expect(graveOpening(0.2)).toBeGreaterThan(0.5);
    expect(fadeIn(0.2, 0.4)).toBeCloseTo(0.5, 9);
    expect(pulse(-1, 1)).toBe(0);
    expect(pulse(0.15, 1)).toBeCloseTo(1, 6);
    expect(pulse(2, 1)).toBe(0);
    expect(noteRun(0, 0, 5)).toBe(0);
    expect(noteRun(5, 0, 5)).toBe(-1);
    const [x, y, z] = embraceSpiral(1, 3, 12, 1, 2);
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it('finds the claim origin of any spot in a Hollow Crypt slot', () => {
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 2);
    expect(cryptSlotOrigin(o.x + 80, o.z + 112)).toEqual({ x: o.x, z: o.z });
    expect(cryptSlotOrigin(o.x - 82, o.z - 120)).toEqual({ x: o.x, z: o.z });
  });
});
