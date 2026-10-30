// The painted-sky policy (src/render/sky_painted_core.ts): the dusk crossfade
// from a biome's painted day sky to its painted night, the residency fade that
// keeps a late-landing night from popping, the per-arm weights the dome binds,
// the thinned procedural stars, the night glow's anchor, and the two grades.
// The wiring into the dome is pinned in tests/sky_zone_assets.test.ts.
import { describe, expect, it } from 'vitest';
import {
  globalDayness,
  moonDirection,
  nightSkyDesat,
  nightStarAmount,
} from '../src/render/day_night_core';
import {
  PAINTED_DAY_TUNE,
  PAINTED_NIGHT_ANCHOR_U,
  PAINTED_NIGHT_FADE_SEC,
  PAINTED_NIGHT_FULL,
  PAINTED_NIGHT_STAR_KEEP,
  PAINTED_NIGHT_START,
  PAINTED_NIGHT_TUNE,
  PAINTED_STARS,
  paintedNightArms,
  paintedNightOffsetU,
  paintedNightStarScale,
  paintedNightWeight,
  paintedStarLayerScale,
  stepPaintedNightFade,
} from '../src/render/sky_painted_core';

/** The weight as the dome sees it: through the desaturation the renderer passes
 *  SkyView.setCycle for the grade's night amount. */
const weightAt = (nightAmt: number): number => paintedNightWeight(nightSkyDesat(nightAmt));

describe('the painted night crossfade weight', () => {
  it('is 0 at full day and 1 at deep night', () => {
    expect(weightAt(0)).toBe(0);
    expect(weightAt(1)).toBe(1);
    expect(paintedNightWeight(0)).toBe(0);
  });

  it('holds 0 until the window opens and 1 once it closes', () => {
    for (const n of [0, 0.1, 0.25, PAINTED_NIGHT_START]) expect(weightAt(n)).toBe(0);
    for (const n of [PAINTED_NIGHT_FULL, 0.95, 1]) expect(weightAt(n)).toBe(1);
    expect(weightAt(PAINTED_NIGHT_START + 0.01)).toBeGreaterThan(0);
    expect(weightAt(PAINTED_NIGHT_FULL - 0.01)).toBeLessThan(1);
  });

  it('rises monotonically through dusk, with no step larger than the cycle can smooth', () => {
    let previous = -1;
    let largestStep = 0;
    for (let i = 0; i <= 1000; i++) {
      const w = weightAt(i / 1000);
      expect(w).toBeGreaterThanOrEqual(previous);
      if (previous >= 0) largestStep = Math.max(largestStep, w - previous);
      previous = w;
    }
    // A thousandth of the night amount never moves the weight by more than
    // half a percent: smooth, no pop anywhere in the window.
    expect(largestStep).toBeLessThan(0.005);
  });

  it('eases in and out: the slope vanishes at both ends of the window', () => {
    const slope = (n: number) => (weightAt(n + 1e-4) - weightAt(n - 1e-4)) / 2e-4;
    const middle = slope((PAINTED_NIGHT_START + PAINTED_NIGHT_FULL) / 2);
    expect(slope(PAINTED_NIGHT_START + 1e-3)).toBeLessThan(middle * 0.05);
    expect(slope(PAINTED_NIGHT_FULL - 1e-3)).toBeLessThan(middle * 0.05);
  });

  it('sits where the art brief wants it across the real cycle', () => {
    // A neutral realm's night amount is 1 - globalDayness(phase); dusk is 0.75.
    const atPhase = (phase: number) => weightAt(1 - globalDayness(phase));
    // Noon and the afternoon show the painted day alone.
    expect(atPhase(0.5)).toBe(0);
    expect(atPhase(0.65)).toBe(0);
    // A little in at the horizon crossing, so the painted day carries the sunset.
    const atSunset = atPhase(0.75);
    expect(atSunset).toBeGreaterThan(0);
    expect(atSunset).toBeLessThan(0.25);
    // Past half once the first stars come out, and complete before they are full.
    const firstStars = [...Array(1000).keys()]
      .map((i) => 0.75 + (0.25 * i) / 1000)
      .find((phase) => nightStarAmount(globalDayness(phase)) > 0);
    if (firstStars === undefined) throw new Error('expected stars after dusk');
    expect(atPhase(firstStars)).toBeGreaterThan(0.5);
    expect(atPhase(0)).toBe(1);
    // Dawn runs the same curve back.
    expect(atPhase(0.25)).toBeCloseTo(atSunset, 12);
  });

  it('tolerates junk input as full day', () => {
    expect(paintedNightWeight(Number.NaN)).toBe(0);
    expect(paintedNightWeight(-1)).toBe(0);
    expect(paintedNightWeight(10)).toBe(1);
  });
});

describe('the residency fade and the per-arm weights', () => {
  it('fades a newly bound night in over its fixed time, and drops an unbound one at once', () => {
    let fade = 0;
    const dt = 1 / 20;
    let frames = 0;
    while (fade < 1) {
      const next = stepPaintedNightFade(fade, true, dt);
      expect(next).toBeGreaterThan(fade);
      fade = next;
      frames++;
    }
    expect(frames).toBe(Math.ceil(PAINTED_NIGHT_FADE_SEC / dt));
    // No dt holds; an unbound slot shows its placeholder, so it must read 0 now.
    expect(stepPaintedNightFade(0.4, true, 0)).toBe(0.4);
    expect(stepPaintedNightFade(0.9, false, dt)).toBe(0);
    expect(stepPaintedNightFade(1, true, dt)).toBe(1);
  });

  it('weights each arm by its own fade and mixes them exactly as the shader does', () => {
    const arms = paintedNightArms(0.8, 1, 0, 0.25);
    expect(arms.a).toBeCloseTo(0.8, 12);
    expect(arms.b).toBe(0);
    expect(arms.share).toBeCloseTo(0.8 * 0.75, 12);
    // A sky without a painted night contributes nothing at any hour.
    expect(paintedNightArms(1, 0, 0, 0.5)).toEqual({ a: 0, b: 0, share: 0 });
    // By day nothing shows, whatever is resident.
    expect(paintedNightArms(0, 1, 1, 0.5)).toEqual({ a: 0, b: 0, share: 0 });
    // Both arms painted (the vale and the beach that aliases it).
    expect(paintedNightArms(1, 1, 1, 0.3).share).toBeCloseTo(1, 12);
  });
});

describe('the procedural stars over a painted night', () => {
  it('hand the classic field over to the painted layer exactly by the painted share', () => {
    // The painted night ships with its painted stars removed (compress_sky_ldr.mjs);
    // the painted star layer takes their place, crossfading with the classic field
    // so the two never double up and the sum stays the cycle's star amount.
    expect(PAINTED_NIGHT_STAR_KEEP).toBe(0);
    for (const share of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      expect(paintedNightStarScale(share) + paintedStarLayerScale(share)).toBeCloseTo(1, 12);
    }
    // Day, and every sky without a painted night (share 0): the classic field whole,
    // the painted layer off, exactly.
    expect(paintedNightStarScale(0)).toBe(1);
    expect(paintedStarLayerScale(0)).toBe(0);
    // A fully shown painted night: the painted layer whole, the classic field off.
    expect(paintedNightStarScale(1)).toBe(0);
    expect(paintedStarLayerScale(1)).toBe(1);
    expect(paintedStarLayerScale(-1)).toBe(0);
    expect(paintedStarLayerScale(2)).toBe(1);
  });

  it('keeps every painted star shape inside the cells that draw it, so none is clipped', () => {
    const S = PAINTED_STARS;
    // Small points: a point sits at least a quarter cell from its cell edge; its
    // largest radius stays well inside that (a gaussian is spent by about two radii).
    const pointCellDeg = 180 / S.pointCells[1];
    expect(360 / S.pointCells[0]).toBeCloseTo(pointCellDeg, 12);
    expect(2 * S.pointRadiusDeg[1]).toBeLessThanOrEqual(0.25 * pointCellDeg);
    expect(S.pointRadiusDeg[0]).toBeLessThan(S.pointRadiusDeg[1]);
    // Bright stars: the four-nearest search covers anything within half a cell, and
    // the shader caps the arms (horizontal and vertical) and the halo under that.
    const brightCellDeg = 180 / S.sparkleCells[1];
    expect(360 / S.sparkleCells[0]).toBeCloseTo(brightCellDeg, 12);
    expect(S.sparkleArmDeg[0]).toBeLessThan(0.45 * brightCellDeg);
    expect(2.2 * S.haloDeg * 1.4).toBeLessThan(0.5 * brightCellDeg);
    expect(S.sparkleCoreDeg * 1.3 * 2).toBeLessThan(0.5 * brightCellDeg);
    // Fills are shares of cells, the cross share a share of the bright stars.
    for (const share of [S.pointFill, S.sparkleFill, S.crossShare, S.zenithFloor, S.twinkle]) {
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(1);
    }
    // A few bright stars, many small points: the coarse layer is the sparse one.
    const brightPerDeg2 = S.sparkleFill / (brightCellDeg * brightCellDeg);
    const pointsPerDeg2 = S.pointFill / (pointCellDeg * pointCellDeg);
    expect(pointsPerDeg2).toBeGreaterThan(10 * brightPerDeg2);
    // The tint stays near white: a hint of warm and cool, never a coloured star.
    for (const rgb of [S.warm, S.cool]) {
      expect(Math.max(...rgb)).toBe(1);
      expect(Math.min(...rgb)).toBeGreaterThan(0.7);
    }
  });
});

describe('the painted grades and the night glow anchor', () => {
  it('turns the night glow to the moon at midnight, in the dome shader u convention', () => {
    const [x, , z] = moonDirection(0);
    expect(PAINTED_NIGHT_ANCHOR_U).toBeCloseTo(Math.atan2(z, x) / (2 * Math.PI) + 0.5, 12);
    expect(PAINTED_NIGHT_ANCHOR_U).toBeCloseTo(0.75, 6);
    expect(paintedNightOffsetU(0.497)).toBeCloseTo(0.497 - 0.75, 6);
  });

  it('grades the painted day near the old dome and the night with a small lift, under bloom', () => {
    // Day: the calibrated identity gain with a mild deepening contrast.
    expect(PAINTED_DAY_TUNE).toEqual({ gain: 1, clamp: 1.6, contrast: 1.1 });
    // Night: lifted a little, never darkened, no contrast curve.
    expect(PAINTED_NIGHT_TUNE.gain).toBeGreaterThan(1);
    expect(PAINTED_NIGHT_TUNE.gain).toBeLessThan(1.5);
    expect(PAINTED_NIGHT_TUNE.contrast ?? 1).toBe(1);
    // An LDR texel peaks at 1: through the dome's contrast pivot it stays under
    // both the clamp and the 1.32 bloom threshold.
    const peak = 0.8 * (PAINTED_DAY_TUNE.gain / 0.8) ** (PAINTED_DAY_TUNE.contrast ?? 1);
    expect(peak).toBeLessThan(PAINTED_DAY_TUNE.clamp);
    expect(peak).toBeLessThan(1.32);
    expect(PAINTED_NIGHT_TUNE.gain).toBeLessThan(PAINTED_NIGHT_TUNE.clamp);
  });
});
