// Pins for src/render/draw_stats_core.ts: the composer-tier draw-stats
// accumulator (packet 0 phase 01). The composer-tier legacy constant asserted
// here is the live-confirmed pre-change governor input: 150/150 sampled
// frames on both high and ultra read exactly 1 call / 1 triangle / 0 points /
// 0 lines (the final fullscreen output pass).
import { describe, expect, it } from 'vitest';
import {
  COMPOSER_TIER_LEGACY_DRAW_SIGNAL,
  createDrawStatsAccumulator,
  type DrawStatsCounters,
  governorDrawSignal,
} from '../src/render/draw_stats_core';
import { GFX_CONFIG_VERSION } from '../src/render/gfx';
import { assertAllocationStable } from './util/alloc_probe';

const counters = (
  calls: number,
  triangles: number,
  points: number,
  lines: number,
): DrawStatsCounters => ({ calls, triangles, points, lines });

describe('draw_stats_core', () => {
  it('fills one caller-owned frame counter on the composer hot path', () => {
    const acc = createDrawStatsAccumulator();
    const read = counters(0, 0, 0, 0);
    const out = counters(0, 0, 0, 0);
    acc.beginFrame(read, out);
    expect(() =>
      assertAllocationStable(
        () => {
          read.calls++;
          read.triangles += 10;
          return acc.beginFrame(read, out);
        },
        64,
        'draw stats frame',
      ),
    ).not.toThrow();
  });

  it('accumulates across passes: consecutive monotonic reads become per-frame deltas', () => {
    const acc = createDrawStatsAccumulator();
    acc.beginFrame(counters(0, 0, 0, 0)); // baseline capture, return discarded
    // Two frames of a composer session with autoReset off: the counter runs
    // monotonically 0 -> 412 -> 799 across all passes of each frame.
    const first = acc.beginFrame(counters(412, 300100, 17, 5));
    expect(first).toEqual(counters(412, 300100, 17, 5));
    const second = acc.beginFrame(counters(799, 512400, 40, 9));
    expect(second).toEqual(counters(387, 212300, 23, 4));
    // The regression traps: the raw monotonic total and the legacy final-pass value.
    expect(second.calls).not.toBe(799);
    expect(second.calls).not.toBe(1);
  });

  it('excludes an out-of-band render from the next frame delta', () => {
    const acc = createDrawStatsAccumulator();
    acc.beginFrame(counters(0, 0, 0, 0)); // baseline capture
    // A NON-ZERO in-band baseline first, so the exclusion has an observable
    // effect: a no-op noteOutOfBand would leave this baseline armed and clamp
    // the post-reset delta below to zero instead of 250.
    acc.beginFrame(counters(500, 400000, 20, 6));
    // A screenshot renders 37 calls / 21k triangles out of band (the counter
    // reads 537 at that point); the renderer reports the discarded reading and
    // resets the WebGL counter to zero right after.
    acc.noteOutOfBand(counters(537, 421000, 23, 7));
    // The next in-band frame accumulates from the reset counter.
    const frame = acc.beginFrame(counters(250, 180000, 12, 2));
    expect(frame).toEqual(counters(250, 180000, 12, 2));
  });

  it('guard flip: without noteOutOfBand the out-of-band render contaminates the delta', () => {
    const acc = createDrawStatsAccumulator();
    acc.beginFrame(counters(0, 0, 0, 0)); // baseline capture
    acc.beginFrame(counters(500, 400000, 20, 6)); // same in-band baseline as above
    // Same screenshot and frame, but nobody excludes and nobody resets: the
    // monotonic counter reads 500 + 37 + 250 = 787 at the next frame start,
    // and the out-of-band 37 contaminates the delta.
    const frame = acc.beginFrame(counters(787, 601000, 35, 9));
    expect(frame).toEqual(counters(287, 201000, 15, 3));
    expect(frame.calls).not.toBe(250);
  });

  it('governorDrawSignal pins the frozen legacy constant on composer tiers', () => {
    const input = counters(641, 2400123, 9, 4);
    for (const tier of ['high', 'ultra'] as const) {
      const out = governorDrawSignal(tier, input);
      // The live-confirmed pre-accumulator governor input, pinned as literals.
      expect(out).toEqual({ calls: 1, triangles: 1, points: 0, lines: 0 });
      expect(out.calls).not.toBe(input.calls);
      expect(out.triangles).not.toBe(input.triangles);
      expect(out).toBe(COMPOSER_TIER_LEGACY_DRAW_SIGNAL);
    }
    expect(Object.isFrozen(COMPOSER_TIER_LEGACY_DRAW_SIGNAL)).toBe(true);
  });

  it('governorDrawSignal passes the frame through verbatim on low and medium', () => {
    const input = counters(405, 683731, 4154, 0);
    for (const tier of ['low', 'medium'] as const) {
      const out = governorDrawSignal(tier, input);
      expect(out).toBe(input);
      expect(out.calls).toBe(405);
      expect(out.triangles).toBe(683731);
    }
  });

  it('discards the first-frame baseline instead of reporting the seed as a delta', () => {
    const acc = createDrawStatsAccumulator();
    // The counter already reads 5000 when the accumulator first samples it
    // (e.g. renders that predate the first sync).
    const discarded = acc.beginFrame(counters(5000, 3700000, 60, 20));
    expect(discarded).toEqual(counters(0, 0, 0, 0));
    // The first real frame adds 300 calls / 200k triangles.
    const first = acc.beginFrame(counters(5300, 3900000, 75, 26));
    expect(first).toEqual(counters(300, 200000, 15, 6));
    expect(first.calls).not.toBe(5300);
  });

  it('pins the config version that segments perceptual scenery LOD telemetry', () => {
    // Deliberate future bumps move this pin; v19 separates the first relaxed
    // scenery contract from the pixel-exact v18 renderer.
    expect(GFX_CONFIG_VERSION).toBe(19);
  });

  it('clamps a backward counter jump at zero, per field, and recovers', () => {
    const acc = createDrawStatsAccumulator();
    acc.beginFrame(counters(0, 0, 0, 0)); // baseline capture
    acc.beginFrame(counters(799, 640000, 30, 8));
    // Context restore zeroes the WebGL counters; the next read lands below
    // the baseline. The delta must clamp at zero, never go negative.
    const clamped = acc.beginFrame(counters(12, 9000, 2, 1));
    expect(clamped).toEqual(counters(0, 0, 0, 0));
    // The clamp is per field: one field advancing while another regresses
    // reports only the advancing field.
    const mixed = acc.beginFrame(counters(13, 4000, 6, 0));
    expect(mixed).toEqual(counters(1, 0, 4, 0));
    // Recovery: the baseline re-armed at the restored counter values.
    const recovered = acc.beginFrame(counters(263, 194000, 16, 5));
    expect(recovered).toEqual(counters(250, 190000, 10, 5));
  });
});
