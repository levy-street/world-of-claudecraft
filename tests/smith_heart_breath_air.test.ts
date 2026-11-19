// The Breath vein's air, weather and light (phase 2G, presentation only:
// breath_air_core.ts, heart_environment.ts): the gusts' schedule (the same
// arithmetic the shaders run), the clouds under the Cornice's walk and past
// its rim, the tier's thinning,
// and the Breath's own light: a cold key over a neutral grey fill, never navy.

import { describe, expect, it } from 'vitest';
import {
  BREATH_GUST,
  breathGustAt,
  planBreathAir,
} from '../src/render/smith_heart/breath_air_core';
import {
  SMITH_HEART_BREATH_FOG,
  SMITH_HEART_BREATH_LIGHT,
  SMITH_HEART_BREATH_STORM_SKY,
  SMITH_HEART_KEY_DIRECTION,
  SMITH_HEART_RING_FOG,
  SMITH_HEART_RING_LIGHT,
} from '../src/render/smith_heart/heart_environment';
import { BREATH } from '../src/sim/content/smith_heart_layout';

describe("the Breath's air, weather and light", () => {
  it('sweeps each gust down the bridge in its time, then lets it die', () => {
    const t0 = BREATH_GUST.offset + BREATH_GUST.period * 3;
    expect(breathGustAt(t0).front).toBeCloseTo(0, 6);
    expect(breathGustAt(t0 + BREATH_GUST.sweep / 2).front).toBeCloseTo(0.5, 6);
    expect(breathGustAt(t0 + BREATH_GUST.sweep / 2).strength).toBe(1);
    expect(breathGustAt(t0 + BREATH_GUST.sweep + 2).strength).toBe(0);
    expect(breathGustAt(t0 + BREATH_GUST.period).index).toBe(breathGustAt(t0).index + 1);
  });

  it('rolls its clouds past the rim under the walk, thinning with the tier', () => {
    const full = planBreathAir(1);
    const low = planBreathAir(0.35);
    const C = BREATH.cornice;
    for (const c of full.clouds.slice(0, 22)) {
      expect(c.y).toBeLessThan(C.h - 5);
      expect(Math.hypot((c.x - C.x) / (C.rx + 9), (c.z - C.z) / (C.rz + 9))).toBeGreaterThan(1);
    }
    const count = (p: typeof full) => p.volumes.reduce((n, v) => n + v.streaks + v.grit, 0);
    expect(count(low)).toBeLessThan(count(full) * 0.45);
  });

  it('lights the Breath its own: a cold key over a neutral grey fill, never navy', () => {
    const L = SMITH_HEART_BREATH_LIGHT;
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const [r, g, b] = rgb(L.hemiSky);
    expect(b - r).toBeLessThan(40);
    expect(Math.min(r, g, b)).toBeGreaterThan(110);
    const [kr, , kb] = rgb(L.sunColor);
    expect(kb).toBeGreaterThanOrEqual(kr);
    expect(L.env).toBeLessThanOrEqual(0.05);
  });

  it('stands the summit under a thunderhead: darker than the hub, neutral, the rift on the one sun', () => {
    // The storm pass (design doc section 5.27): the guardian, the crystal and
    // the lightning are the brightest things on the Cornice.
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const luma = (c: number) => {
      const [r, g, b] = rgb(c);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // A dark slate storm air, well under the Ring's hub air, and never navy.
    expect(luma(SMITH_HEART_BREATH_FOG.color)).toBeLessThan(
      luma(SMITH_HEART_RING_FOG.color) * 0.85,
    );
    const [fr, , fb] = rgb(SMITH_HEART_BREATH_FOG.color);
    expect(fb - fr).toBeLessThan(40);
    // An overcast's light: the key under the hub's sun, the fill under the key
    // (a stronger key on this pale stone read as snow).
    const L = SMITH_HEART_BREATH_LIGHT;
    expect(L.sun).toBeLessThan(SMITH_HEART_RING_LIGHT.sun);
    expect(L.hemi).toBeLessThan(L.sun);
    // A body still reads off the dark slate: its rim over the hub's.
    expect(L.rim).toBeGreaterThan(SMITH_HEART_RING_LIGHT.rim);
    // The painted deck hangs low (its dark bellies at the horizon, the painting
    // spent a third of the way up), pressed to a thunderhead with its tears kept.
    const S = SMITH_HEART_BREATH_STORM_SKY;
    expect(S.foot).toBeLessThanOrEqual(0.65);
    expect(S.foot - 0.7 * S.rise).toBeLessThan(0.05);
    expect(S.shade).toBeLessThan(0.5);
    expect(S.lit).toBeGreaterThan(S.shade * 2);
    // The rift is a COLD light, low, and it sits on the raid's one sun: the
    // Breath's rig reads the same constant the dome's uniform is built from.
    expect(S.rift[2]).toBeGreaterThan(S.rift[0]);
    expect(S.riftTop).toBeLessThan(0.5);
    expect(L.keyDirection).toBe(SMITH_HEART_KEY_DIRECTION);
  });
});
