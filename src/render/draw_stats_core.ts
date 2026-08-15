// Draw-stats frame accumulator: real per-frame draw-call/triangle deltas on the
// post-processing tiers, where three's per-render auto-reset makes every post-frame
// reader see only the final fullscreen pass (1 call / 1 triangle; confirmed
// live on high and ultra, packet 0 phase 01).
//
// Version-pinned three behavior this module compensates for (three r165,
// WebGLRenderer.render): when info.autoReset is true, render() calls
// info.reset() after WebGLShadowMap.render and before the scene pass, so the
// counters only ever hold the most recent pass (and even single-pass tiers
// exclude shadow draws). WebGLInfo.reset() zeroes render.calls/triangles/
// points/lines only; info.memory and info.programs are never reset. The
// renderer flips info.autoReset to false only when a post chain is active,
// letting the counters run monotonically across all
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

/** Structural subset of Three's WebGLInfo used by the renderer wiring. */
export interface LogicalFrameDrawInfo {
  autoReset: boolean;
  readonly render: DrawStatsCounters;
  reset(): void;
}

/**
 * One owner for the renderer's post-processing draw-counter lifecycle. Keeping
 * setup, frame snapshots, governor reads, and out-of-band resets together
 * prevents one consumer from silently falling back to the final fullscreen pass.
 */
export interface LogicalFrameDrawStats {
  beginFrame(): Readonly<DrawStatsCounters>;
  currentFrame(): Readonly<DrawStatsCounters>;
  governorSignal(tier: GfxTier): Readonly<DrawStatsCounters>;
  discardOutOfBand(): void;
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
 * The governor's draw-pressure input. Post-processing profiles pass the
 * logical-frame accumulator snapshot through here, while direct profiles
 * already feed their live frame counters to the governor at the caller. The
 * tier argument keeps that caller contract explicit and prevents a future tier
 * from silently substituting a synthetic signal.
 */
export function governorDrawSignal(
  _tier: GfxTier,
  frame: DrawStatsCounters,
): Readonly<DrawStatsCounters> {
  return frame;
}

export function createLogicalFrameDrawStats(info: LogicalFrameDrawInfo): LogicalFrameDrawStats {
  info.autoReset = false;
  const accumulator = createDrawStatsAccumulator();
  const frame = zeroFrame();
  return {
    beginFrame(): Readonly<DrawStatsCounters> {
      return accumulator.beginFrame(info.render, frame);
    },
    currentFrame(): Readonly<DrawStatsCounters> {
      return frame;
    },
    governorSignal(tier: GfxTier): Readonly<DrawStatsCounters> {
      return governorDrawSignal(tier, frame);
    },
    discardOutOfBand(): void {
      accumulator.noteOutOfBand(info.render);
      info.reset();
    },
  };
}
