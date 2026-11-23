// Ysolei's moon in the sky and on the island (src/render/drowned_temple/
// temple_moon_core.ts, painted by temple_moon_fx.ts): the moon swells as she
// beckons it and stays close while her tears roll, descends over the Falling
// Moon bar, goes dark in eclipse; the Plenilune Ward cracks as it drains; a
// tear turns as it rolls; the comet lands on time.

import { describe, expect, it } from 'vitest';
import {
  approach,
  burstEnvelope,
  burstEnvelopeInto,
  COMET_HEIGHT,
  COMET_SECONDS,
  cometHeight,
  ECLIPSE_FADE,
  easeInOut,
  MOON_CALL_SWELL,
  MOON_FALL_DROP,
  MOON_FALL_HOLD,
  MOON_FALL_SWELL,
  type MoonSkyInput,
  type MoonSkyLook,
  moonShake,
  moonSkyTarget,
  moonswellGlow,
  tearRollAngle,
  wardCrack,
  wardPulseRate,
} from '../src/render/drowned_temple/temple_moon_core';

function input(over: Partial<MoonSkyInput> = {}): MoonSkyInput {
  return { beckoning: null, tears: 0, falling: null, eclipsedLeft: 0, sinceFall: 999, ...over };
}

function look(i: MoonSkyInput, calm = false): MoonSkyLook {
  return moonSkyTarget(i, calm, { swell: -1, drop: -1, eclipse: -1 });
}

describe('the sky moon answers Ysolei', () => {
  it('rests untouched with nothing running', () => {
    expect(look(input())).toEqual({ swell: 0, drop: 0, eclipse: 0 });
  });

  it('swells over the Beckoning Moon bar and holds close while tears roll', () => {
    expect(look(input({ beckoning: 0 })).swell).toBe(0);
    expect(look(input({ beckoning: 0.5 })).swell).toBeCloseTo(MOON_CALL_SWELL * 0.5, 6);
    expect(look(input({ beckoning: 1 })).swell).toBeCloseTo(MOON_CALL_SWELL, 6);
    expect(look(input({ tears: 2 })).swell).toBe(MOON_CALL_SWELL);
    expect(look(input({ tears: 2 })).drop).toBe(0);
  });

  it('descends over the Falling Moon bar, biggest and lowest at its end', () => {
    const start = look(input({ falling: 0 }));
    const mid = look(input({ falling: 0.5 }));
    const end = look(input({ falling: 1 }));
    expect(start.swell).toBeLessThan(mid.swell);
    expect(mid.swell).toBeLessThan(end.swell);
    expect(end.swell).toBeCloseTo(MOON_FALL_SWELL, 6);
    expect(end.drop).toBeCloseTo(MOON_FALL_DROP, 6);
    expect(start.drop).toBe(0);
    // It blazes at its lowest a moment after it falls, then eases home.
    expect(look(input({ sinceFall: MOON_FALL_HOLD - 0.1 })).swell).toBe(MOON_FALL_SWELL);
    expect(look(input({ sinceFall: MOON_FALL_HOLD + 0.1 })).swell).toBe(0);
  });

  it('goes dark in eclipse while she reels, fading back out at the end', () => {
    expect(look(input({ eclipsedLeft: 4 })).eclipse).toBe(1);
    expect(look(input({ eclipsedLeft: ECLIPSE_FADE / 2 })).eclipse).toBeCloseTo(0.5, 6);
    expect(look(input({ eclipsedLeft: 0 })).eclipse).toBe(0);
  });

  it('reduced motion halves the swell and the drop, never the eclipse', () => {
    const calm = look(input({ falling: 1, eclipsedLeft: 3 }), true);
    expect(calm.swell).toBeCloseTo(MOON_FALL_SWELL / 2, 6);
    expect(calm.drop).toBeCloseTo(MOON_FALL_DROP / 2, 6);
    expect(calm.eclipse).toBe(1);
  });

  it('approaches its target smoothly and lands on it', () => {
    let v = 0;
    for (let i = 0; i < 400; i++) v = approach(v, 1, 1 / 60, 3);
    expect(v).toBe(1);
    const one = approach(0, 1, 0.1, 2);
    const two = approach(approach(0, 1, 0.05, 2), 1, 0.05, 2);
    expect(one).toBeCloseTo(two, 9);
    expect(approach(0.5, 0.5, 0.1, 2)).toBe(0.5);
  });

  it('eases in and out, clamped', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(2)).toBe(1);
  });
});

describe('the Plenilune Ward, the tears and the bursts', () => {
  it('cracks the ward as its absorb drains', () => {
    expect(wardCrack(1000, 1000)).toBe(0);
    expect(wardCrack(250, 1000)).toBeCloseTo(0.75, 9);
    expect(wardCrack(0, 1000)).toBe(1);
    // No full size known: drawn whole.
    expect(wardCrack(500, undefined)).toBe(0);
  });

  it('turns a tear by the distance it rolled', () => {
    expect(tearRollAngle(0, 0.7)).toBe(0);
    expect(tearRollAngle(Math.PI * 1.4, 0.7)).toBeCloseTo(Math.PI * 2, 9);
    expect(tearRollAngle(3, 0)).toBe(0);
  });

  it('drops the comet from the sky onto its spot in COMET_SECONDS', () => {
    expect(cometHeight(0)).toBe(COMET_HEIGHT);
    expect(cometHeight(COMET_SECONDS / 2)).toBeGreaterThan(COMET_HEIGHT / 2);
    expect(cometHeight(COMET_SECONDS)).toBe(0);
    expect(cometHeight(COMET_SECONDS * 3)).toBe(0);
  });

  it('a burst grows fast and fades out, done at its life', () => {
    const a = burstEnvelope(0, 1);
    expect(a.grow).toBe(0);
    expect(a.alpha).toBe(1);
    expect(burstEnvelope(0.5, 1).grow).toBeGreaterThan(0.8);
    expect(burstEnvelope(1, 1).done).toBe(true);
  });

  it('fills a caller-owned envelope the same as the fresh one', () => {
    const out = { grow: -1, alpha: -1, done: true };
    expect(burstEnvelopeInto(0.3, 1, out)).toBe(out);
    expect(out).toEqual(burstEnvelope(0.3, 1));
  });

  it('pulses the ward faster as it cracks, slow and steady when calm', () => {
    expect(wardPulseRate(0, false)).toBe(2);
    expect(wardPulseRate(1, false)).toBe(8);
    expect(wardPulseRate(5, false)).toBe(8);
    expect(wardPulseRate(1, true)).toBe(wardPulseRate(0, true));
    expect(wardPulseRate(1, true)).toBeLessThan(wardPulseRate(0, false));
  });

  it('brightens her Moonswell halo with every stack', () => {
    expect(moonswellGlow(0)).toBe(0);
    expect(moonswellGlow(1)).toBeGreaterThan(0);
    expect(moonswellGlow(3)).toBeGreaterThan(moonswellGlow(1));
    expect(moonswellGlow(20)).toBe(1);
  });

  it('kicks the camera hard near the impact, softer further, none beyond', () => {
    expect(moonShake(5, 0.55, 18, 0.25, 50)).toBe(0.55);
    expect(moonShake(30, 0.55, 18, 0.25, 50)).toBe(0.25);
    expect(moonShake(80, 0.55, 18, 0.25, 50)).toBe(0);
  });
});
