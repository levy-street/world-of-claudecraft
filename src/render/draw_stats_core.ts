// Draw-stats frame accumulator: real per-frame draw-call/triangle deltas on the
// composer tiers, where three's per-render auto-reset makes every post-frame
// reader see only the final fullscreen pass (1 call / 1 triangle; confirmed
// live on high and ultra, packet 0 phase 01).
//
// Version-pinned three behavior this module compensates for (three r165,
// WebGLRenderer.render): when info.autoReset is true, render() calls
// info.reset() after WebGLShadowMap.render and before the scene pass, so the
// counters only ever hold the most recent pass (and even single-pass tiers
// exclude shadow draws). WebGLInfo.reset() zeroes render.calls/triangles/
// points/lines only; info.memory and info.programs are never reset. The
// renderer flips info.autoReset to false ONLY when the composer is active
// (packet ruling R1), letting the counters run monotonically across all
// passes; this core turns consecutive reads into per-frame deltas.
//
// Pure core contract: no three import (structural counters only), no DOM, no
// clocks, no randomness. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts); tested by tests/draw_stats_core.test.ts.

import type { GfxTier } from './gfx';

/** Structural mirror of three's WebGLInfo.render counters. */
export interface DrawStatsCounters {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
}

export interface DrawStatsAccumulator {
  /**
   * Snapshot the monotonic counters at frame start and return the PREVIOUS
   * frame's delta (per-field, clamped at zero so a backward jump, e.g. a
   * context restore zeroing the counters, never reports negative work). The
   * first call only establishes the baseline: its return value is a zero
   * frame, never the raw counter reading.
   */
  beginFrame(read: DrawStatsCounters, out?: DrawStatsCounters): DrawStatsCounters;
  /**
   * Exclude an out-of-band render (screenshot capture, prewarm pass) from the
   * next frame's delta. Contract: the caller resets the WebGL counters
   * (info.reset()) immediately after this call, so the baseline drops to
   * zero; `read` is the discarded reading, accepted so call sites document
   * what was excluded. In-band draws accumulated since the last beginFrame
   * are discarded with it (one under-reported frame per exclusion).
   */
  noteOutOfBand(read: DrawStatsCounters): void;
}

const zeroFrame = (): DrawStatsCounters => ({ calls: 0, triangles: 0, points: 0, lines: 0 });

const copyFrame = (read: DrawStatsCounters): DrawStatsCounters => ({
  calls: read.calls,
  triangles: read.triangles,
  points: read.points,
  lines: read.lines,
});

export function createDrawStatsAccumulator(): DrawStatsAccumulator {
  let baseline: DrawStatsCounters | null = null;
  return {
    beginFrame(read: DrawStatsCounters, out?: DrawStatsCounters): DrawStatsCounters {
      const frame = out ?? zeroFrame();
      if (baseline === null) {
        baseline = copyFrame(read);
        frame.calls = 0;
        frame.triangles = 0;
        frame.points = 0;
        frame.lines = 0;
        return frame;
      }
      frame.calls = Math.max(0, read.calls - baseline.calls);
      frame.triangles = Math.max(0, read.triangles - baseline.triangles);
      frame.points = Math.max(0, read.points - baseline.points);
      frame.lines = Math.max(0, read.lines - baseline.lines);
      baseline.calls = read.calls;
      baseline.triangles = read.triangles;
      baseline.points = read.points;
      baseline.lines = read.lines;
      return frame;
    },
    noteOutOfBand(_read: DrawStatsCounters): void {
      if (baseline) {
        baseline.calls = 0;
        baseline.triangles = 0;
        baseline.points = 0;
        baseline.lines = 0;
      } else {
        baseline = zeroFrame();
      }
    },
  };
}

/**
 * What the render-budget governor saw on the composer tiers before the
 * accumulator existed: the final fullscreen output pass, one call drawing
 * one fullscreen triangle (observed live on high and ultra, 150/150 frames
 * each, and pinned by tests/draw_stats_core.test.ts).
 */
export const COMPOSER_TIER_LEGACY_DRAW_SIGNAL: Readonly<DrawStatsCounters> = Object.freeze({
  calls: 1,
  triangles: 1,
  points: 0,
  lines: 0,
});

/**
 * The governor's draw-pressure input per tier (packet ruling R1). Composer
 * tiers (high/ultra) receive the frozen legacy constant so the governor's
 * draw arm stays exactly as dead as it was before the accumulator; low and
 * medium pass the live frame through verbatim. Callers on a non-composer
 * high/ultra profile (native iOS memory profile, advanced preset with
 * effects shed) must NOT route through this shim: their live counters are
 * real and already feed the governor unchanged.
 */
export function governorDrawSignal(
  tier: GfxTier,
  frame: DrawStatsCounters,
): Readonly<DrawStatsCounters> {
  return tier === 'high' || tier === 'ultra' || tier === 'insane'
    ? COMPOSER_TIER_LEGACY_DRAW_SIGNAL
    : frame;
}
