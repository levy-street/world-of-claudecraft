// The Breath vein's air, weather and light (phase 2G, presentation only:
// breath_air_core.ts, heart_environment.ts): the gusts' and the strikes'
// schedules (the same arithmetic the shaders run), the clouds under the
// Cornice's walk and past its rim, the tier's thinning (never the strikes),
// and the Breath's own light: a cold key over a neutral grey fill, never navy.

import { describe, expect, it } from 'vitest';
import {
  BREATH_GUST,
  BREATH_STRIKE,
  breathGustAt,
  breathStrikeAt,
  planBreathAir,
} from '../src/render/smith_heart/breath_air_core';
import { SMITH_HEART_BREATH_LIGHT } from '../src/render/smith_heart/heart_environment';
import { BREATH, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';

const F = SMITH_HEART_FIELD;
const RODS = F.props.filter((p) => p.kind === 'sh_lightning_rod').length;

describe("the Breath's air, weather and light", () => {
  it('sweeps each gust down the bridge in its time, then lets it die', () => {
    const t0 = BREATH_GUST.offset + BREATH_GUST.period * 3;
    expect(breathGustAt(t0).front).toBeCloseTo(0, 6);
    expect(breathGustAt(t0 + BREATH_GUST.sweep / 2).front).toBeCloseTo(0.5, 6);
    expect(breathGustAt(t0 + BREATH_GUST.sweep / 2).strength).toBe(1);
    expect(breathGustAt(t0 + BREATH_GUST.sweep + 2).strength).toBe(0);
    expect(breathGustAt(t0 + BREATH_GUST.period).index).toBe(breathGustAt(t0).index + 1);
  });

  it('strikes every rod in turn, one flash a cell', () => {
    const seen = new Set<number>();
    for (let k = 0; k < RODS; k++) {
      const s = breathStrikeAt(k * BREATH_STRIKE.cell + 0.01, RODS);
      seen.add(s.rod);
      expect(s.rod).toBeGreaterThanOrEqual(0);
      expect(s.rod).toBeLessThan(RODS);
      expect(s.since).toBeLessThan(BREATH_STRIKE.cell);
    }
    expect(seen.size).toBe(RODS);
  });

  it('rolls its clouds past the rim under the walk, thinning with the tier', () => {
    const full = planBreathAir(1);
    const low = planBreathAir(0.35);
    const C = BREATH.cornice;
    expect(full.crowns).toHaveLength(RODS);
    for (const c of full.clouds.slice(0, 22)) {
      expect(c.y).toBeLessThan(C.h - 5);
      expect(Math.hypot((c.x - C.x) / (C.rx + 9), (c.z - C.z) / (C.rz + 9))).toBeGreaterThan(1);
    }
    const count = (p: typeof full) => p.volumes.reduce((n, v) => n + v.streaks + v.grit, 0);
    expect(count(low)).toBeLessThan(count(full) * 0.45);
    // The strikes stay on every tier.
    expect(low.crowns).toEqual(full.crowns);
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
});
