import { readFileSync } from 'node:fs';
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
  DAY_ONLY,
  dayNightGrade,
  duskWarmAmount,
  effectiveDayness,
  fullDayGrade,
  globalDayness,
  LUNAR_CYCLE_MS,
  lunarPhase,
  moonDirection,
  moonTerminator,
  NEUTRAL_DAY_GRADE,
  nightSkyDesat,
  nightStarAmount,
  REALM_DAYNIGHT_AMPLITUDE,
  skyTintForDayness,
  sunDirection,
  sunsetWarmGate,
  warmDuskGrade,
} from '../src/render/day_night_core';
import type { BiomeId } from '../src/sim/types';

// The day_night_core: the pure clock-to-grade math of the world day/night cycle.
// The renderer supplies the wall-clock ms (Date.now) and applies the grade to the
// sun/hemi/IBL/fog/sky; here we drive any moment of the cycle deterministically.

describe('the live cycle contract', () => {
  it('runs a one-hour cycle, epoch-anchored so it is identical for every player', () => {
    // Literal pin: an hour, not a derived expression, so a period change is a
    // deliberate act here too. Epoch anchoring (cyclePhase of an absolute ms)
    // is what makes the phase global; there is no per-client or per-zone term.
    expect(DAY_NIGHT_CYCLE_MS).toBe(3_600_000);
  });

  it('ships with the cycle LIVE (DAY_ONLY off): the sun and moon move', () => {
    expect(DAY_ONLY).toBe(false);
  });

  it('lands noon exactly on the authored day look (the identity grade)', () => {
    // The lighting rig and per-biome HDRI gains are tuned against the identity
    // grade, so the cycle must only ever dip DOWN from it, never re-dim day.
    expect(dayNightGrade(1)).toEqual(NEUTRAL_DAY_GRADE);
  });
});

describe('water follows the cycle (source pins)', () => {
  // The water surface shader is unlit (baked palette + fog), so the day/night
  // grade and the moving key light have to be wired in by hand; these pins
  // fail if that wiring is dropped in a refactor.
  it('water.ts shares the live sun + day/night uniforms and applies the grade', () => {
    const source = readFileSync(new URL('../src/render/water.ts', import.meta.url), 'utf8');
    expect(source).toContain('uSunDir: WATER_SUN_UNIFORM');
    expect(source).toContain('uDayNight: WATER_DAYNIGHT_UNIFORM');
    expect(source).toContain('uniform vec3 uDayNight;');
    expect(source).toContain('col *= uDayNight;');
  });

  it('the renderer drives both from its key-light update every frame', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain('setWaterSunDirection(this.lightDir);');
    expect(source).toContain('setWaterDayNight(this.dnGrade.fog);');
  });
});

describe('the night visibility layers stay outdoors (source pins)', () => {
  // The world clock governs the sky, not a dungeon, a delve, the Last Keep, or
  // the seabed: each of those runs its own authored light rig all cycle long. A
  // night layer that ignored that would light a pool under every mob underground
  // at world-midnight and take it away again at world-noon, which is incoherent
  // to a player who has not seen the sky in an hour. The gate is one ternary per
  // call site in renderer.ts, so these pins are what keep it from being dropped
  // in a refactor; there is no pure core to assert it on.
  const renderer = () =>
    readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('gates the mob ground glow on the outdoor fog state', () => {
    expect(renderer()).toContain(
      "this.fogState === 'outdoor' ? mobGlowAmount(this.dnGlobalNight) : 0",
    );
  });

  it('gates the wilderness accents on the outdoor fog state', () => {
    expect(renderer()).toContain(
      "this.fogState === 'outdoor' ? wildGlowAmount(this.dnGlobalNight) : 0",
    );
  });

  it('drives the streetlamps and the ember pools from the same lamp amount', () => {
    // One amount for both, so a lamp and the campfire beside it never disagree
    // about whether it is dusk.
    const source = renderer();
    expect(source).toContain('const lampGlow = lampGlowAmount(this.dnGlobalNight);');
    expect(source).toContain('this.streetlamps?.update(lampGlow, this.time);');
    expect(source).toContain('this.emberPools?.update(lampGlow, this.time);');
  });
});

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
  it('is the brightest grade at e = 1: the neutral authored day, untouched', () => {
    const g = dayNightGrade(1);
    // peak day is the identity: the rig and HDRI gains already grade the day,
    // so the cycle must not re-dim it (that was the pre-overhaul tuning)
    expect(g.lightScale).toBeCloseTo(1, 12);
    expect(g.sky).toEqual([1, 1, 1]);
    expect(g.fog).toEqual([1, 1, 1]);
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

describe('per-realm night palettes (region style survives the dark)', () => {
  it('holds the raised moonlit floor for the neutral night', () => {
    expect(dayNightGrade(0).lightScale).toBeCloseTo(0.36, 12);
  });

  it('keeps realms without a palette on the global deep-blue night', () => {
    expect(dayNightGrade(0, 'vale')).toEqual(dayNightGrade(0));
    expect(dayNightGrade(0.4, 'marsh')).toEqual(dayNightGrade(0.4));
  });

  it('gives the Nightbloom a violet night, darker than neutral', () => {
    const g = dayNightGrade(0, 'night');
    // violet: red beats green, blue leads both
    expect(g.sky[0]).toBeGreaterThan(g.sky[1]);
    expect(g.sky[2]).toBeGreaterThan(g.sky[0]);
    expect(g.fog[2]).toBeGreaterThan(g.fog[1]);
    // and its floor dips under the global moonlit floor
    expect(g.lightScale).toBeLessThan(dayNightGrade(0).lightScale);
  });

  it('keeps the Drakelands night warm: embers, not moonlight', () => {
    const g = dayNightGrade(0, 'ember');
    expect(g.sky[0]).toBeGreaterThan(g.sky[1]);
    expect(g.sky[1]).toBeGreaterThan(g.sky[2]);
    expect(g.fog[0]).toBeGreaterThan(g.fog[2]);
    // the lava glow keeps its floor a touch above the global night
    expect(g.lightScale).toBeGreaterThan(dayNightGrade(0).lightScale);
  });

  it('always lands day on the identity grade regardless of realm', () => {
    for (const b of ['night', 'ember', 'frost', 'haunt', 'dusk', 'amber'] as BiomeId[]) {
      expect(dayNightGrade(1, b)).toEqual(NEUTRAL_DAY_GRADE);
    }
  });
});

describe('the night ambient floor (readable silhouettes at deep night)', () => {
  it('is the identity at noon, exactly like every other day target', () => {
    expect(dayNightGrade(1).ambientScale).toBeCloseTo(1, 12);
    expect(NEUTRAL_DAY_GRADE.ambientScale).toBe(1);
  });

  it('holds a HIGHER floor than the key light at deepest night', () => {
    const g = dayNightGrade(0);
    // The two halves of the rig answer different questions after dark: the sun
    // scale is the moon (genuinely dim), the ambient scale is the sky bounce
    // that keeps terrain shape and bodies legible. Pinning both to one floor is
    // what made night read as a black cutout.
    expect(g.ambientScale).toBeGreaterThan(g.lightScale);
    expect(g.ambientScale).toBeCloseTo(0.78, 12);
    // The CONTRAST between the two halves is the night cue, not the absolute
    // level: the ambient may be walked up for readability, but if it ever
    // reaches the key light the moon stops casting and the frame reads as an
    // overcast afternoon. Keep a real gap.
    expect(g.ambientScale - g.lightScale).toBeGreaterThan(0.15);
  });

  it('never brightens past the authored day, at any point of the cycle', () => {
    for (let i = 0; i <= 20; i++) {
      const g = dayNightGrade(i / 20);
      expect(g.ambientScale).toBeLessThanOrEqual(1);
      expect(g.ambientScale).toBeGreaterThanOrEqual(g.lightScale - 1e-12);
    }
  });

  it('brightens monotonically from night to day', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const g = dayNightGrade(i / 20);
      expect(g.ambientScale).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = g.ambientScale;
    }
  });

  it('takes the realm floor scale, capped so a warm realm cannot outshine noon', () => {
    // the Nightbloom scales its floor DOWN (0.85), so its ambient dips with it
    expect(dayNightGrade(0, 'night').ambientScale).toBeLessThan(dayNightGrade(0).ambientScale);
    // the Drakelands scale UP (1.1): warmer than neutral, still under the day
    const ember = dayNightGrade(0, 'ember');
    expect(ember.ambientScale).toBeGreaterThan(dayNightGrade(0).ambientScale);
    expect(ember.ambientScale).toBeLessThanOrEqual(1);
  });

  it('survives the dusk warm untouched (warmDuskGrade is hue only)', () => {
    const g = dayNightGrade(0.5);
    expect(warmDuskGrade(g, 1).ambientScale).toBe(g.ambientScale);
  });
});

describe('warmDuskGrade (the whole frame goes orange at the horizon)', () => {
  it('returns the grade untouched when the sun is high or deep under', () => {
    const g = dayNightGrade(0.8);
    expect(warmDuskGrade(g, 0)).toEqual(g);
  });

  it('warms sky and fog toward orange at full dusk, light level untouched', () => {
    const g = dayNightGrade(0.5);
    const w = warmDuskGrade(g, 1);
    // red rises, blue falls: the sunset push
    expect(w.sky[0]).toBeGreaterThan(g.sky[0]);
    expect(w.sky[2]).toBeLessThan(g.sky[2]);
    expect(w.fog[0]).toBeGreaterThan(g.fog[0]);
    expect(w.fog[2]).toBeLessThan(g.fog[2]);
    // hue only: intensity and sightlines stay the cycle's own curve
    expect(w.lightScale).toBe(g.lightScale);
    expect(w.farScale).toBe(g.farScale);
  });

  it('buys its amber with saturation, never with extra light', () => {
    // The guard that matters at dusk. Distant sprite impostors and the sun-path
    // water glints already sit near the top of the range there, so a tint that
    // lifts RED is what blows them out to detail-less white peach. The drama has
    // to come from pulling green and blue down instead. Pinned as a hard ceiling
    // on the red gain plus a floor on saturation, so a future "make it hotter"
    // tuning pass cannot quietly buy warmth with radiance again.
    const g = dayNightGrade(1); // identity grade: the tint shows undiluted
    const w = warmDuskGrade(g, 1);
    const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    // red may not exceed the gain this grade replaced (sky 1.14, fog 1.20)
    expect(w.sky[0]).toBeLessThanOrEqual(1.14);
    expect(w.fog[0]).toBeLessThanOrEqual(1.2);
    // and the tint as a whole must REMOVE energy, not add it
    expect(lum(w.sky)).toBeLessThan(1);
    expect(lum(w.fog)).toBeLessThan(1);
    // while still reading as a genuine amber, not the old tea stain (was ~1.8)
    expect(w.sky[0] / w.sky[2]).toBeGreaterThan(2.5);
    expect(w.fog[0] / w.fog[2]).toBeGreaterThan(2.5);
    // fog stays lighter than sky for readability, the pre-existing contract
    expect(w.fog[0]).toBeGreaterThan(w.sky[0]);
  });
});

describe('lunarPhase / moonTerminator (the moon runs real phases)', () => {
  it('anchors the lunar cycle to the epoch across eight world days', () => {
    expect(LUNAR_CYCLE_MS).toBe(8 * DAY_NIGHT_CYCLE_MS);
    expect(lunarPhase(0)).toBe(0);
    expect(lunarPhase(LUNAR_CYCLE_MS / 2)).toBeCloseTo(0.5, 12);
    expect(lunarPhase(LUNAR_CYCLE_MS * 2.25)).toBeCloseTo(0.25, 12);
  });

  it('traces the classic phases: new, quarters, full', () => {
    const newMoon = moonTerminator(0);
    expect(newMoon.litFrac).toBeCloseTo(0, 12);
    expect(newMoon.rx).toBeCloseTo(1, 12);
    const firstQuarter = moonTerminator(0.25);
    expect(firstQuarter.litFrac).toBeCloseTo(0.5, 12);
    expect(firstQuarter.rx).toBeCloseTo(0, 6);
    expect(firstQuarter.shadowSide).toBe(-1); // waxing: lit from the right
    const full = moonTerminator(0.5);
    expect(full.litFrac).toBeCloseTo(1, 12);
    const lastQuarter = moonTerminator(0.75);
    expect(lastQuarter.litFrac).toBeCloseTo(0.5, 12);
    expect(lastQuarter.shadowSide).toBe(1); // waning: lit from the left
  });

  it('bulges the terminator toward the lit side for crescents, the shadow side for gibbous', () => {
    const waxingCrescent = moonTerminator(0.1);
    expect(waxingCrescent.shadowSide).toBe(-1);
    expect(waxingCrescent.bulgeSide).toBe(1);
    const waxingGibbous = moonTerminator(0.4);
    expect(waxingGibbous.shadowSide).toBe(-1);
    expect(waxingGibbous.bulgeSide).toBe(-1);
    const waningCrescent = moonTerminator(0.9);
    expect(waningCrescent.shadowSide).toBe(1);
    expect(waningCrescent.bulgeSide).toBe(-1);
  });
});

describe('duskWarmAmount / nightSkyDesat (the cycle sky grading)', () => {
  it('the dusk glow peaks at the horizon crossing and vanishes high or deep under', () => {
    expect(duskWarmAmount(0.66)).toBeCloseTo(0, 6); // noon sun: no sunset glow
    expect(duskWarmAmount(0)).toBeCloseTo(1, 2); // crossing: full glow
    expect(duskWarmAmount(-0.5)).toBeCloseTo(0, 6); // deep night: none
  });

  it('holds a wide golden band so the sunset lasts, without leaking either end', () => {
    // The band was widened deliberately: the original window (open at y 0.3,
    // shut at y -0.24) gave about ten minutes of golden hour per cycle, which
    // a player crossing a zone missed entirely. These pins are the two ends
    // that must NOT move: the peak sun elevation is ~0.659, so a high sun stays
    // exactly zero, and deep night stays exactly zero so no warmth reaches the
    // moonlit grade. Between them the glow is strong well before the crossing
    // and lingers as afterglow well after it.
    expect(duskWarmAmount(0.5)).toBe(0); // still full afternoon: nothing yet
    expect(duskWarmAmount(0.22)).toBeGreaterThan(0.5); // golden hour has opened
    expect(duskWarmAmount(0.06)).toBeGreaterThan(0.9);
    expect(duskWarmAmount(-0.15)).toBeGreaterThan(0.5); // afterglow lingers
    expect(duskWarmAmount(-0.32)).toBe(0); // sun well under: back to moonlight
  });

  it('keeps the key light warm across the horizon but off before the moon takes it', () => {
    // The whole point of a gate separate from aboveHorizon: the sun sitting ON
    // the horizon is the most orange moment of the day, and aboveHorizon had
    // already faded to ~0.35 there, washing the key light pale.
    expect(sunsetWarmGate(0)).toBeGreaterThan(0.9);
    expect(aboveHorizon(0)).toBeLessThan(0.4); // the curve this replaces
    expect(sunsetWarmGate(0.2)).toBe(1); // full warmth above the horizon
    // ...and fully off by y -0.14, ahead of the key light's handover to the
    // moon at y -0.15 (updateKeyLight), so moonlight is never sunset-tinted.
    expect(sunsetWarmGate(-0.14)).toBe(0);
    expect(sunsetWarmGate(-0.5)).toBe(0);
    expect(sunsetWarmGate(-0.1)).toBeLessThan(0.2); // already nearly gone
  });

  it('the night desaturation rises from zero and stays capped under one', () => {
    expect(nightSkyDesat(0)).toBe(0);
    expect(nightSkyDesat(1)).toBeCloseTo(0.75, 6);
    const mid = nightSkyDesat(0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.75);
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
