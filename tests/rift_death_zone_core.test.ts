import { describe, expect, it } from 'vitest';
import {
  deathZonePlan,
  deathZonePulseSpeed,
  deathZoneSweepFraction,
  deathZoneSweepScale,
  FILL_OPACITY,
  PULSE_SPEED_CALM,
  PULSE_SPEED_URGENT,
  RING_MAX_OPACITY,
  RING_MIN_OPACITY,
  SWEEP_BASE_OPACITY,
  SWEEP_URGENT_OPACITY,
  URGENT_REMAINING_SEC,
} from '../src/render/rift_death_zone_core';

// The readability contract behind the v0.36.0 player feedback ("very hard to
// see the red circles"): the telegraph may pulse but never near-invisible, the
// danger area always carries a fill, and the timer sweep tells players how
// much fuse is left instead of an undated countdown.

describe('rift death zone core: visual plan', () => {
  it('ring opacity pulses but never drops below half opacity at any phase', () => {
    let min = 1;
    let max = 0;
    for (let phase = 0; phase < Math.PI * 4; phase += 0.05) {
      const plan = deathZonePlan(phase, 3, 4);
      min = Math.min(min, plan.ringOpacity);
      max = Math.max(max, plan.ringOpacity);
    }
    expect(min, 'pulse floor holds the readability contract').toBeGreaterThanOrEqual(
      RING_MIN_OPACITY,
    );
    expect(RING_MIN_OPACITY, 'the floor itself is at least half opacity').toBeGreaterThanOrEqual(
      0.5,
    );
    expect(max, 'the pulse actually reaches the ceiling').toBeGreaterThan(RING_MAX_OPACITY - 0.02);
    expect(min, 'the pulse actually moves (it is not a static ring)').toBeLessThan(
      RING_MIN_OPACITY + 0.02,
    );
  });

  it('the interior fill is always on so the danger AREA reads, not just the rim', () => {
    for (const [remaining, total] of [
      [4, 4],
      [2, 4],
      [0.2, 4],
    ] as const) {
      expect(deathZonePlan(0, remaining, total).fillOpacity).toBe(FILL_OPACITY);
      expect(FILL_OPACITY).toBeGreaterThan(0);
    }
  });

  it('sweep fraction runs 0 at spawn to 1 at detonation, monotonically', () => {
    const total = 4.5;
    expect(deathZoneSweepFraction(total, total), 'zero elapsed at spawn').toBe(0);
    expect(deathZoneSweepFraction(0, total), 'full at detonation').toBe(1);
    let prev = -1;
    for (let remaining = total; remaining >= 0; remaining -= 0.1) {
      const f = deathZoneSweepFraction(remaining, total);
      expect(f, `monotonic at remaining=${remaining.toFixed(1)}`).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('sweep fraction clamps degenerate inputs toward MORE warning, never less', () => {
    expect(deathZoneSweepFraction(1, 0), 'zero total reads fully elapsed').toBe(1);
    expect(deathZoneSweepFraction(1, -2), 'negative total reads fully elapsed').toBe(1);
    expect(deathZoneSweepFraction(5, 4), 'remaining above total clamps to 0').toBe(0);
    expect(deathZoneSweepFraction(-1, 4), 'negative remaining clamps to 1').toBe(1);
  });

  it('the final window pulses faster and brightens the sweep', () => {
    expect(deathZonePulseSpeed(URGENT_REMAINING_SEC + 0.01)).toBe(PULSE_SPEED_CALM);
    expect(deathZonePulseSpeed(URGENT_REMAINING_SEC)).toBe(PULSE_SPEED_URGENT);
    expect(PULSE_SPEED_URGENT, 'urgent strobes faster than calm').toBeGreaterThan(PULSE_SPEED_CALM);
    const calm = deathZonePlan(1, URGENT_REMAINING_SEC + 0.5, 4);
    const urgent = deathZonePlan(1, URGENT_REMAINING_SEC - 0.5, 4);
    expect(calm.sweepOpacity).toBe(SWEEP_BASE_OPACITY);
    expect(urgent.sweepOpacity).toBe(SWEEP_URGENT_OPACITY);
    expect(SWEEP_URGENT_OPACITY).toBeGreaterThan(SWEEP_BASE_OPACITY);
  });

  it('is deterministic: identical inputs produce identical plans', () => {
    expect(deathZonePlan(2.2, 1.1, 4.5)).toEqual(deathZonePlan(2.2, 1.1, 4.5));
  });

  it('sweep scale is radially uniform in the disc plane (local x/y), local z fixed at 1', () => {
    // The sweep mesh is a CircleGeometry in its LOCAL x/y plane laid flat by
    // rotation.x, and Three applies scale before rotation: scaling local z
    // instead of local y shipped the sweep as an ellipse once already.
    for (const f of [0, 0.25, 0.5, 1]) {
      const [sx, sy, sz] = deathZoneSweepScale(f);
      expect(sx, `radial axes match at fraction ${f}`).toBe(sy);
      expect(sz, `normal axis stays unscaled at fraction ${f}`).toBe(1);
      expect(sx, `scale tracks the fraction at ${f}`).toBeCloseTo(Math.max(f, 0.001), 10);
    }
    expect(deathZoneSweepScale(0)[0], 'zero fraction stays non-degenerate').toBeGreaterThan(0);
  });
});
