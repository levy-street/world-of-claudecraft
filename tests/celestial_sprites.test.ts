import { describe, expect, it } from 'vitest';
import {
  ECLIPSE_STEPS_PER_RADIUS,
  eclipseCanvasCentre,
  MOON_FACE_SCALE,
  MOON_HALO_SCALE,
  MOON_LIMB_IN_HALO,
  MOON_PHASE_BUCKETS,
  moonHaloAlpha,
  moonPhaseBucket,
  naturalMoonRepaintKey,
} from '../src/render/celestial_sprites';

// The moon's halo profile. The canvas paints themselves need a real 2D context
// and are eyeballed, but this one number governs whether the face reads at all:
// the halo sprite is ADDITIVE and much wider than the face, so anything it puts
// inside the limb is added to every pixel of the moon. Enough of it and the
// painted contrast collapses into the tonemap shoulder and the unlit side of a
// crescent fills back in as a grey disc. A future "the halo looks a bit weak"
// tweak that raises the core is exactly the regression this exists to catch.

describe('moon halo profile', () => {
  it('puts the face inside the inner third of the halo sprite', () => {
    // Derived from the two sprite scales, not typed in: rescaling either sprite
    // has to move the profile with it.
    expect(MOON_LIMB_IN_HALO).toBeCloseTo((MOON_FACE_SCALE * (118 / 128)) / MOON_HALO_SCALE, 6);
    expect(MOON_LIMB_IN_HALO).toBeGreaterThan(0.2);
    expect(MOON_LIMB_IN_HALO).toBeLessThan(0.5);
  });

  it('stays a trace across the face instead of washing over it', () => {
    // Sampled over the whole disc, not one point: a profile that dipped only at
    // the exact centre would pass a single-sample check and still flood the rest.
    for (let i = 0; i <= 20; i++) {
      const t = (i / 20) * MOON_LIMB_IN_HALO * 0.85;
      expect(moonHaloAlpha(t), `halo at t=${t.toFixed(3)}`).toBeLessThan(0.05);
    }
    // and it really is a hollow profile: the peak is many times the core
    expect(moonHaloAlpha(0)).toBeLessThan(moonHaloAlpha(MOON_LIMB_IN_HALO * 1.2) / 5);
  });

  it('peaks outside the limb, where a halo belongs', () => {
    let peakT = 0;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      if (moonHaloAlpha(t) > moonHaloAlpha(peakT)) peakT = t;
    }
    expect(peakT).toBeGreaterThan(MOON_LIMB_IN_HALO);
    // ...but hugging it, so the halo reads as this moon's glow and not a
    // detached ring floating around it
    expect(peakT).toBeLessThan(MOON_LIMB_IN_HALO * 1.6);
    expect(moonHaloAlpha(peakT)).toBeGreaterThan(0.3); // still a real glow
  });

  it('falls monotonically to nothing at the sprite edge', () => {
    // A sprite whose alpha does not reach zero at its own edge draws a visible
    // square seam against the night sky.
    expect(moonHaloAlpha(1)).toBe(0);
    expect(moonHaloAlpha(1.4)).toBe(0);
    const peak = MOON_LIMB_IN_HALO * 1.2;
    let previous = moonHaloAlpha(peak);
    for (let i = 1; i <= 60; i++) {
      const t = peak + ((1 - peak) * i) / 60;
      const alpha = moonHaloAlpha(t);
      expect(alpha, `halo at t=${t.toFixed(3)}`).toBeLessThanOrEqual(previous);
      previous = alpha;
    }
  });

  it('rises monotonically from the core to the peak', () => {
    const peak = MOON_LIMB_IN_HALO * 1.2;
    let previous = moonHaloAlpha(0);
    for (let i = 1; i <= 60; i++) {
      const alpha = moonHaloAlpha((peak * i) / 60);
      expect(alpha).toBeGreaterThanOrEqual(previous);
      previous = alpha;
    }
  });
});

describe('natural moon face repaints', () => {
  it('repaints once per phase bucket outside an eclipse', () => {
    expect(MOON_PHASE_BUCKETS).toBe(64);
    expect(naturalMoonRepaintKey(0.1, null)).toBe(naturalMoonRepaintKey(0.1 + 0.2 / 64, null));
    expect(naturalMoonRepaintKey(0.1, null)).not.toBe(naturalMoonRepaintKey(0.1 + 1 / 64, null));
    // wraps, so a phase past 1 is the same bucket as its fraction
    expect(naturalMoonRepaintKey(1.25, null)).toBe(naturalMoonRepaintKey(0.25, null));
    expect(moonPhaseBucket(-0.25)).toBe(moonPhaseBucket(0.75));
  });

  it('repaints when the umbra moves a tenth of a radius, and not within one', () => {
    expect(ECLIPSE_STEPS_PER_RADIUS).toBe(10);
    const base = naturalMoonRepaintKey(0.5, [1.0, -0.5]);
    expect(naturalMoonRepaintKey(0.5, [1.03, -0.52])).toBe(base);
    expect(naturalMoonRepaintKey(0.5, [1.1, -0.5])).not.toBe(base);
    expect(naturalMoonRepaintKey(0.5, [1.0, -0.6])).not.toBe(base);
    // entering or leaving an eclipse always repaints
    expect(naturalMoonRepaintKey(0.5, [0, 0])).not.toBe(naturalMoonRepaintKey(0.5, null));
  });

  it('never collides across the whole reach of an eclipse', () => {
    // the umbra centre stays inside the penumbra's reach, under 7 radii either way
    const seen = new Map<number, string>();
    for (const p of [0.48, 0.5, 0.52]) {
      for (let x = -70; x <= 70; x += 1) {
        for (let y = -70; y <= 70; y += 7) {
          const key = naturalMoonRepaintKey(p, [x / 10, y / 10]);
          const id = `${moonPhaseBucket(p)}:${x}:${y}`;
          const prior = seen.get(key);
          expect(prior === undefined || prior === id, `${id} vs ${prior}`).toBe(true);
          seen.set(key, id);
          expect(key).toBeGreaterThan(63); // never a plain phase bucket
        }
      }
    }
  });

  it('draws the umbra above the face centre for a +y offset (canvas y grows down)', () => {
    expect(eclipseCanvasCentre([0, 0])).toEqual([128, 128]);
    expect(eclipseCanvasCentre([0, 1])[1]).toBeLessThan(128);
    expect(eclipseCanvasCentre([1, 0])[0]).toBeGreaterThan(128);
  });
});
