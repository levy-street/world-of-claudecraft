import { describe, expect, it } from 'vitest';
import {
  FX_SPEED_FLOOR,
  FX_SPEED_FULL,
  FX_SPEED_MAX_PLAUSIBLE,
  groundSpeedFromFrame,
  hasTravelFormAura,
  speedStreaks,
  speedStreaksInto,
  stepIntensity,
  targetIntensity,
  trackLocalPos,
  vignetteAlpha,
} from '../src/render/travel_speed_fx';
import { RUN_SPEED } from '../src/sim/types';

describe('travel speed fx (pure core)', () => {
  it('shows nothing when not in travel form, even at top speed', () => {
    expect(
      targetIntensity({ inTravelForm: false, speed: FX_SPEED_FULL, reducedMotion: false }),
    ).toBe(0);
  });

  it('shows nothing while in form but standing still or walking below the floor', () => {
    expect(targetIntensity({ inTravelForm: true, speed: 0, reducedMotion: false })).toBe(0);
    expect(
      targetIntensity({ inTravelForm: true, speed: FX_SPEED_FLOOR, reducedMotion: false }),
    ).toBe(0);
    expect(targetIntensity({ inTravelForm: true, speed: RUN_SPEED, reducedMotion: false })).toBe(0);
  });

  it('ramps up as travel-form speed approaches the +40% top speed', () => {
    const mid = targetIntensity({
      inTravelForm: true,
      speed: (FX_SPEED_FLOOR + FX_SPEED_FULL) / 2,
      reducedMotion: false,
    });
    const full = targetIntensity({
      inTravelForm: true,
      speed: FX_SPEED_FULL,
      reducedMotion: false,
    });
    expect(mid).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(mid);
    expect(full).toBeCloseTo(1, 5);
  });

  it('clamps above the top speed and never exceeds 1', () => {
    expect(
      targetIntensity({ inTravelForm: true, speed: FX_SPEED_FULL * 2, reducedMotion: false }),
    ).toBeCloseTo(1, 5);
  });

  it('is fully suppressed under prefers-reduced-motion', () => {
    expect(targetIntensity({ inTravelForm: true, speed: FX_SPEED_FULL, reducedMotion: true })).toBe(
      0,
    );
  });

  it('rejects implausible teleport / displacement speed spikes', () => {
    // A one-frame zone transition or knockback reads as an enormous speed; the cue
    // must draw nothing rather than flash to full for that frame.
    expect(
      targetIntensity({
        inTravelForm: true,
        speed: FX_SPEED_MAX_PLAUSIBLE + 0.01,
        reducedMotion: false,
      }),
    ).toBe(0);
    expect(targetIntensity({ inTravelForm: true, speed: 10_000, reducedMotion: false })).toBe(0);
    // Just below the ceiling still reads as (clamped) real travel.
    expect(
      targetIntensity({
        inTravelForm: true,
        speed: FX_SPEED_MAX_PLAUSIBLE - 0.01,
        reducedMotion: false,
      }),
    ).toBeCloseTo(1, 5);
  });

  it('eases intensity toward the target and is frame-rate independent in direction', () => {
    let v = 0;
    for (let i = 0; i < 240; i++) v = stepIntensity(v, 1, 1 / 60);
    expect(v).toBeGreaterThan(0.95);
    // a single tiny step moves toward, never past, the target.
    const oneStep = stepIntensity(0, 1, 1 / 60);
    expect(oneStep).toBeGreaterThan(0);
    expect(oneStep).toBeLessThan(1);
    // decays back toward 0 when target drops.
    let down = 1;
    for (let i = 0; i < 240; i++) down = stepIntensity(down, 0, 1 / 60);
    expect(down).toBeLessThan(0.05);
  });

  it('produces no streaks at zero intensity and a populated, bounded field above it', () => {
    expect(speedStreaks(0, 0)).toHaveLength(0);
    const streaks = speedStreaks(0.8, 1.25, 28);
    expect(streaks).toHaveLength(28);
    for (const s of streaks) {
      expect(s.outer).toBeGreaterThan(s.inner);
      expect(s.inner).toBeGreaterThanOrEqual(0);
      expect(s.outer).toBeLessThanOrEqual(1);
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('streak layout is deterministic for the same inputs', () => {
    expect(speedStreaks(0.6, 2.0)).toEqual(speedStreaks(0.6, 2.0));
  });

  it('speedStreaksInto reuses the buffer in place and matches speedStreaks', () => {
    const buf: ReturnType<typeof speedStreaks> = [];
    const first = speedStreaksInto(buf, 0.7, 1.0, 28);
    expect(first).toBe(buf); // returns the same array, no new allocation
    const firstObjs = [...buf];
    const second = speedStreaksInto(buf, 0.4, 3.0, 28);
    expect(second).toBe(buf);
    // the streak objects are reused (mutated in place), not reallocated.
    for (let n = 0; n < buf.length; n++) expect(buf[n]).toBe(firstObjs[n]);
    // and the filled values match the allocating reference for the same inputs.
    expect(speedStreaksInto([], 0.4, 3.0, 28)).toEqual(speedStreaks(0.4, 3.0));
    // intensity 0 empties the buffer.
    expect(speedStreaksInto(buf, 0, 0)).toHaveLength(0);
  });

  it('vignette scales with intensity', () => {
    expect(vignetteAlpha(0)).toBe(0);
    expect(vignetteAlpha(1)).toBeGreaterThan(vignetteAlpha(0.5));
  });

  it('samples ground speed from the remembered position and tracks it without reallocating', () => {
    expect(groundSpeedFromFrame(null, 3, 4, 0.05)).toBe(0);
    const first = trackLocalPos(null, 0, 0);
    expect(first).toEqual({ x: 0, z: 0 });
    // 3-4-5 over 0.05 s is 100 yd/s; a zero or negative dt never divides.
    expect(groundSpeedFromFrame(first, 3, 4, 0.05)).toBeCloseTo(100, 6);
    expect(groundSpeedFromFrame(first, 3, 4, 0)).toBe(0);
    expect(groundSpeedFromFrame(first, 3, 4, -1)).toBe(0);
    const again = trackLocalPos(first, 3, 4);
    expect(again).toBe(first);
    expect(first).toEqual({ x: 3, z: 4 });
    expect(groundSpeedFromFrame(first, 3, 4, 0.05)).toBe(0);
  });

  it('recognises the travel-form aura among any others', () => {
    expect(hasTravelFormAura([])).toBe(false);
    expect(hasTravelFormAura([{ kind: 'form_cat' }, { kind: 'buff' }])).toBe(false);
    expect(hasTravelFormAura([{ kind: 'buff' }, { kind: 'form_travel' }])).toBe(true);
  });
});
