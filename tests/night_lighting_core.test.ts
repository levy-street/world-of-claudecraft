import { describe, expect, it } from 'vitest';
import { globalDayness } from '../src/render/day_night_core';
import {
  lampGlowAmount,
  MOB_GLOW_POOL,
  MOB_GLOW_RANGE,
  mobGlowAmount,
  mobGlowStrength,
  nightLightAmount,
  nightRimBoost,
} from '../src/render/night_lighting_core';

// night_lighting_core: the shared ramps the streetlamps, the mob ground glow,
// and the character rim lift all fade on. The renderer supplies the world's
// night amount; here we drive the whole curve by hand.

describe('nightLightAmount (the one driver)', () => {
  it('passes the world night amount through on a tier that grades the world', () => {
    expect(nightLightAmount(0, true)).toBe(0);
    expect(nightLightAmount(0.42, true)).toBeCloseTo(0.42, 12);
    expect(nightLightAmount(1, true)).toBe(1);
  });

  it('reports full day on a tier that never applies the day/night grade', () => {
    // The Lambert tier keeps its noon light rig all cycle long (renderer.ts
    // returns before the outdoor grade on lowGfx), so it has nothing to
    // compensate for: lighting its lamps would put burning lanterns under a
    // bright sky. Nothing a player reacts to rides these layers, so holding
    // them at 0 sheds cosmetics only.
    for (const night of [0, 0.5, 1]) expect(nightLightAmount(night, false)).toBe(0);
  });

  it('clamps a nonsense input instead of propagating it', () => {
    expect(nightLightAmount(-3, true)).toBe(0);
    expect(nightLightAmount(7, true)).toBe(1);
  });
});

describe('lampGlowAmount (lamps light at dusk, out by dawn)', () => {
  it('is fully out in broad daylight and fully lit at deep night', () => {
    expect(lampGlowAmount(0)).toBe(0);
    expect(lampGlowAmount(1)).toBe(1);
  });

  it('rises monotonically, with no discontinuity across the dusk window', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = lampGlowAmount(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('lights the lamps around sunset, not at mid-afternoon', () => {
    // globalDayness: phase 0.5 is noon, 0.75 is dusk, 0 is midnight. The lamps
    // must be dark through the afternoon and lit by the time the sun is down.
    const at = (phase: number) => lampGlowAmount(1 - globalDayness(phase));
    expect(at(0.5)).toBe(0); // noon
    expect(at(0.62)).toBe(0); // mid-afternoon
    expect(at(0.75)).toBeGreaterThan(0.3); // sunset: coming up
    expect(at(0.85)).toBe(1); // well after dark
    expect(at(0)).toBe(1); // midnight
    // and the curve is symmetric, so dawn snuffs them again
    expect(at(0.15)).toBe(1);
    expect(at(0.38)).toBe(0);
  });
});

describe('mobGlowAmount (a hint of warmth, and only in real dark)', () => {
  it('stays out through dusk, when the sky still silhouettes a body', () => {
    const at = (phase: number) => mobGlowAmount(1 - globalDayness(phase));
    expect(at(0.5)).toBe(0);
    expect(at(0.75)).toBe(0); // sunset: the lamps are coming up, this is not
    expect(at(0)).toBeGreaterThan(0); // midnight
  });

  it('never reaches full strength: it is a cue, not a spotlight', () => {
    expect(mobGlowAmount(1)).toBeLessThan(1);
    expect(mobGlowAmount(1)).toBeGreaterThan(0.5);
  });

  it('comes up later than the lamps do', () => {
    // Lamps are a world fixture that a lamplighter turns on at dusk; the mob
    // glow is compensation for darkness that has actually arrived.
    for (const n of [0.35, 0.45, 0.5]) {
      expect(lampGlowAmount(n)).toBeGreaterThan(0);
      expect(mobGlowAmount(n)).toBe(0);
    }
  });

  it('rises monotonically', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = mobGlowAmount(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });
});

describe('mobGlowStrength (per-character distance fade)', () => {
  const full = mobGlowAmount(1);

  it('is the full frame amount for a character close by', () => {
    expect(mobGlowStrength(0, full)).toBe(full);
    expect(mobGlowStrength(10 * 10, full)).toBe(full);
  });

  it('is exactly zero at and past the range, so a disc never pops in', () => {
    const rangeSq = MOB_GLOW_RANGE * MOB_GLOW_RANGE;
    expect(mobGlowStrength(rangeSq, full)).toBe(0);
    expect(mobGlowStrength(rangeSq * 4, full)).toBe(0);
    // and it has already eased down before it gets there
    expect(mobGlowStrength(rangeSq * 0.98, full)).toBeLessThan(full * 0.1);
  });

  it('falls monotonically across the fade band', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= MOB_GLOW_RANGE; d += 1) {
      const v = mobGlowStrength(d * d, full);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });

  it('short-circuits to zero when the frame has no glow at all', () => {
    expect(mobGlowStrength(0, 0)).toBe(0);
  });

  it('keeps a pool big enough for a crowded scene', () => {
    // The disc layer is the FALLBACK body cue now (the night light field
    // carries bodies on the tiers that splice it; see mob_night_glow.ts), but
    // wherever the discs DO run they still cover an ordinary throng inside
    // the 80 yd view create band; past the pool a body simply goes without a
    // disc, which is the crowd-safe failure mode (cosmetic only). The field
    // side's companion pin lives in tests/night_light_field_core.test.ts.
    expect(MOB_GLOW_POOL).toBeGreaterThanOrEqual(48);
  });
});

describe('nightRimBoost (the free silhouette separator)', () => {
  it('is exactly 1 by day: an untouched daylight look', () => {
    expect(nightRimBoost(0)).toBe(1);
    expect(nightRimBoost(0.2)).toBe(1);
  });

  it('lifts at night but stays well under the dungeon crank', () => {
    // DUNGEON_RIM_BOOST is 2.4 in renderer.ts: outdoors at night must read as a
    // moonlit edge, not as the underground silhouette rescue.
    expect(nightRimBoost(1)).toBeGreaterThan(1);
    expect(nightRimBoost(1)).toBeLessThan(2.4);
  });

  it('rises monotonically and shares the mob glow window', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = nightRimBoost(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    // both come up on the same ramp, so a body's edge and its ground pool
    // arrive together instead of one leading the other by minutes
    for (const n of [0, 0.4, 0.52, 0.7, 1]) {
      expect(nightRimBoost(n) > 1).toBe(mobGlowAmount(n) > 0);
    }
  });
});
