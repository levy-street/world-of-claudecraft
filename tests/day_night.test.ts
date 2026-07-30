import { describe, expect, it } from 'vitest';
import {
  currentDayNightPhase,
  dayNightPhaseOverride,
  setDayNightPhaseOverride,
} from '../src/render/day_night_clock';
import {
  aboveHorizon,
  cyclePhase,
  DAY_NIGHT_CYCLE_MS,
  dayNightGrade,
  effectiveDayness,
  fullDayGrade,
  globalDayness,
  moonDirection,
  nightStarAmount,
  REALM_DAYNIGHT_AMPLITUDE,
  skyTintForDayness,
  sunDirection,
} from '../src/render/day_night_core';
import type { BiomeId } from '../src/sim/types';

// The day_night_core: the pure clock-to-grade math of the world day/night cycle.
// The renderer supplies the wall-clock ms (Date.now) and applies the grade to the
// sun/hemi/IBL/fog/sky; here we drive any moment of the cycle deterministically.

describe('cyclePhase', () => {
  it('maps epoch 0 to phase 0 and the half-cycle to 0.5', () => {
    expect(cyclePhase(0)).toBe(0);
    expect(cyclePhase(DAY_NIGHT_CYCLE_MS / 2)).toBeCloseTo(0.5, 12);
  });

  it('wraps to [0, 1) at a full cycle and beyond', () => {
    expect(cyclePhase(DAY_NIGHT_CYCLE_MS)).toBeCloseTo(0, 12);
    expect(cyclePhase(DAY_NIGHT_CYCLE_MS * 3.25)).toBeCloseTo(0.25, 12);
  });

  it('stays in range for a negative timestamp (defensive)', () => {
    const p = cyclePhase(-DAY_NIGHT_CYCLE_MS / 4);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
    expect(p).toBeCloseTo(0.75, 12);
  });

  it('is deterministic: same input, same output', () => {
    const t = 1_700_000_000_000;
    expect(cyclePhase(t)).toBe(cyclePhase(t));
  });
});

describe('globalDayness', () => {
  it('is darkest at midnight (phase 0) and brightest at noon (phase 0.5)', () => {
    expect(globalDayness(0)).toBeCloseTo(0, 6);
    expect(globalDayness(0.5)).toBeCloseTo(1, 6);
    expect(globalDayness(1)).toBeCloseTo(0, 6);
  });

  it('is symmetric about noon', () => {
    expect(globalDayness(0.25)).toBeCloseTo(globalDayness(0.75), 12);
  });

  it('rises monotonically from midnight to noon', () => {
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const v = globalDayness((i / 50) * 0.5);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('REALM_DAYNIGHT_AMPLITUDE', () => {
  it('covers every biome with a weight in (0, 1]', () => {
    for (const amp of Object.values(REALM_DAYNIGHT_AMPLITUDE)) {
      expect(amp).toBeGreaterThan(0);
      expect(amp).toBeLessThanOrEqual(1);
    }
  });

  it('gives neutral daylight realms the full swing and signature realms less', () => {
    // neutral realms take the whole day/night grade
    for (const b of ['vale', 'marsh', 'peaks', 'fen', 'garden', 'gale'] as BiomeId[]) {
      expect(REALM_DAYNIGHT_AMPLITUDE[b]).toBe(1);
    }
    // realms whose fixed time of day is their identity swing less than neutral
    for (const b of ['night', 'dusk', 'ember', 'amber', 'frost', 'haunt'] as BiomeId[]) {
      expect(REALM_DAYNIGHT_AMPLITUDE[b]).toBeLessThan(1);
    }
  });
});

describe('effectiveDayness', () => {
  it('passes the global value through unchanged for a full-amplitude realm', () => {
    for (const g of [0, 0.3, 0.5, 1]) {
      expect(effectiveDayness(g, 'vale')).toBeCloseTo(g, 12);
    }
  });

  it('compresses a signature realm toward its authored day look', () => {
    // at global midnight the Nightbloom never reaches full night: it keeps a
    // floor of (1 - amplitude), so it stays luminous
    const amp = REALM_DAYNIGHT_AMPLITUDE.night;
    expect(effectiveDayness(0, 'night')).toBeCloseTo(1 - amp, 12);
    // and at global noon every realm sits at its full authored day
    expect(effectiveDayness(1, 'night')).toBeCloseTo(1, 12);
  });

  it('clamps out-of-range global input', () => {
    expect(effectiveDayness(-1, 'vale')).toBe(0);
    expect(effectiveDayness(2, 'vale')).toBe(1);
  });
});

describe('dayNightGrade', () => {
  it('is the brightest grade at e = 1, but a calm capped daylight (not blown-out white)', () => {
    const g = dayNightGrade(1);
    expect(g.lightScale).toBeCloseTo(0.65, 12); // peak day held well under full
    // the day sky/fog are bright but capped under white so the HDRI does not bloom out
    expect(Math.min(...g.sky)).toBeGreaterThan(0.5);
    expect(Math.max(...g.sky)).toBeLessThan(1);
    expect(Math.max(...g.fog)).toBeLessThan(1);
    expect(g.farScale).toBeCloseTo(1, 12);
    expect(g.nightAmt).toBeCloseTo(0, 12);
  });

  it('darkens, cools, and pulls sightlines in toward night (e = 0)', () => {
    const g = dayNightGrade(0);
    // moonlit, not black
    expect(g.lightScale).toBeGreaterThan(0);
    expect(g.lightScale).toBeLessThan(1);
    // sky goes darker and bluer than fog (blue channel dominates, all < 1)
    expect(g.sky[2]).toBeGreaterThan(g.sky[0]);
    expect(Math.max(...g.sky)).toBeLessThan(1);
    expect(Math.max(...g.fog)).toBeLessThan(1);
    // fog stays lighter than the sky for readability
    expect(g.fog[0]).toBeGreaterThan(g.sky[0]);
    expect(g.farScale).toBeLessThan(1);
    expect(g.nightAmt).toBeCloseTo(1, 12);
  });

  it('brightens monotonically from night to day', () => {
    let prevLight = -1;
    let prevSky = -1;
    for (let i = 0; i <= 20; i++) {
      const g = dayNightGrade(i / 20);
      expect(g.lightScale).toBeGreaterThanOrEqual(prevLight - 1e-9);
      expect(g.sky[2]).toBeGreaterThanOrEqual(prevSky - 1e-9);
      prevLight = g.lightScale;
      prevSky = g.sky[2];
    }
  });

  it('clamps out-of-range e', () => {
    expect(dayNightGrade(-5).lightScale).toBe(dayNightGrade(0).lightScale);
    expect(dayNightGrade(5).lightScale).toBe(dayNightGrade(1).lightScale);
  });
});

describe('fullDayGrade', () => {
  it('equals the e = 1 grade (the safe pre-first-frame default)', () => {
    expect(fullDayGrade()).toEqual(dayNightGrade(1));
  });
});

describe('day/night clock override (the /daynight dev command)', () => {
  it('returns the frozen phase while an override is set, then resumes', () => {
    setDayNightPhaseOverride(0.5);
    expect(dayNightPhaseOverride()).toBe(0.5);
    expect(currentDayNightPhase()).toBe(0.5);
    setDayNightPhaseOverride(null);
    expect(dayNightPhaseOverride()).toBeNull();
    const live = currentDayNightPhase();
    expect(live).toBeGreaterThanOrEqual(0);
    expect(live).toBeLessThan(1);
  });

  it('wraps an out-of-range override phase into [0, 1)', () => {
    setDayNightPhaseOverride(1.25);
    expect(currentDayNightPhase()).toBeCloseTo(0.25, 12);
    setDayNightPhaseOverride(-0.25);
    expect(currentDayNightPhase()).toBeCloseTo(0.75, 12);
    setDayNightPhaseOverride(null); // do not leak override into other tests
  });
});

describe('sunDirection / moonDirection (the moving sun and moon)', () => {
  const len = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2]);

  it('returns unit vectors', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 0.9]) {
      expect(len(sunDirection(p))).toBeCloseTo(1, 12);
      expect(len(moonDirection(p))).toBeCloseTo(1, 12);
    }
  });

  it('puts the sun on the horizon at dawn/dusk, up at noon, below at night', () => {
    expect(sunDirection(0.25)[1]).toBeCloseTo(0, 6); // dawn: y ~ 0
    expect(sunDirection(0.75)[1]).toBeCloseTo(0, 6); // dusk: y ~ 0
    // noon peak is capped (~40 deg) so the sun stays in view, not overhead
    expect(sunDirection(0.5)[1]).toBeGreaterThan(0.5);
    expect(sunDirection(0.5)[1]).toBeLessThan(0.85);
    expect(sunDirection(0)[1]).toBeLessThan(-0.5); // midnight: below horizon
  });

  it('makes the moon the sun antipode, so it is up at midnight', () => {
    expect(moonDirection(0)).toEqual(sunDirection(0.5));
    expect(moonDirection(0)[1]).toBeGreaterThan(0.5); // moon up at midnight
    expect(moonDirection(0.5)[1]).toBeLessThan(-0.5); // moon down at noon
  });

  it('sweeps east to west across the day (x flips sign dawn -> dusk)', () => {
    expect(Math.sign(sunDirection(0.25)[0])).toBe(-Math.sign(sunDirection(0.75)[0]));
  });
});

describe('aboveHorizon', () => {
  it('is 0 well below, 1 well above, and rises monotonically', () => {
    expect(aboveHorizon(-1)).toBe(0);
    expect(aboveHorizon(1)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = aboveHorizon(-0.3 + (i / 20) * 0.6);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('nightStarAmount', () => {
  it('is off by day, full at deep night, and rises as it darkens', () => {
    expect(nightStarAmount(1)).toBe(0); // full day
    expect(nightStarAmount(0.5)).toBe(0); // still daytime
    expect(nightStarAmount(0)).toBe(1); // deep night
    expect(nightStarAmount(0.2)).toBeGreaterThan(0);
    expect(nightStarAmount(0.2)).toBeLessThan(1);
    // more stars the darker it gets
    expect(nightStarAmount(0.1)).toBeGreaterThan(nightStarAmount(0.3));
  });
});

describe('skyTintForDayness (minimap dial ring colors)', () => {
  it('is deep navy at night, a warm glow at the transition, day-blue at noon', () => {
    const night = skyTintForDayness(0);
    const glow = skyTintForDayness(0.5);
    const day = skyTintForDayness(1);
    // night: dark and blue-dominant
    expect(Math.max(...night)).toBeLessThan(0.3);
    expect(night[2]).toBeGreaterThan(night[0]);
    // dawn/dusk glow: warm, red-dominant
    expect(glow[0]).toBeGreaterThan(glow[2]);
    // day: bright and blue-dominant
    expect(day[2]).toBeGreaterThan(0.8);
    expect(day[2]).toBeGreaterThan(day[0]);
  });

  it('brightens overall from night to day', () => {
    const lum = (c: [number, number, number]) => c[0] + c[1] + c[2];
    expect(lum(skyTintForDayness(1))).toBeGreaterThan(lum(skyTintForDayness(0)));
    expect(lum(skyTintForDayness(0.5))).toBeGreaterThan(lum(skyTintForDayness(0)));
  });

  it('returns channels in [0, 1] and clamps out-of-range input', () => {
    for (const d of [-1, 0, 0.25, 0.5, 0.75, 1, 2]) {
      for (const ch of skyTintForDayness(d)) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
    }
    expect(skyTintForDayness(-1)).toEqual(skyTintForDayness(0));
    expect(skyTintForDayness(5)).toEqual(skyTintForDayness(1));
  });
});
