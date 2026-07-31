// Scene census core: the on-demand per-system draw-cost breakdown behind the
// ?perf overlay's "census" button, plus the hitch tracker that correlates long
// frames with what changed (shader compiles, texture uploads, view creates).
//
// The census is a one-shot MEASURED breakdown, not an estimate: for each
// category bucket of top-level scene subtrees it hides the bucket, re-renders
// through the real pipeline (composer and shadow passes included), and diffs
// the WebGL draw counters against an all-visible baseline. Costs therefore
// include everything a bucket drags along (its shadow-caster draws, its AO
// beauty-pass draws), which also means bucket rows OVERLAP the shadow row and
// do not sum exactly to the baseline; `residual` is the floor the scene never
// gives up (post-chain passes, untoggled leftovers).
//
// Pure core contract: no three import (the renderer adapts itself behind the
// structural SceneCensusHost seam), no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/scene_census_core.test.ts.

import type { DrawStatsCounters } from './draw_stats_core';

/** One toggleable top-level scene subtree, adapted by the renderer. */
export interface SceneCensusChild {
  readonly category: string;
  readonly visible: boolean;
  setVisible(visible: boolean): void;
}

/**
 * What the census needs from the live renderer. Counter contract: the host
 * puts the WebGL counters in manual-reset mode for the duration of the
 * capture (setCountersAutoReset), so `resetCounters` + `render` + `counters`
 * reads one full pipeline pass INCLUDING the shadow pass on every tier
 * (three's auto-reset would otherwise drop shadow draws from the read).
 */
export interface SceneCensusHost {
  /** Top-level toggleable subtrees. Lights must already be excluded: hiding a
   * light changes the scene's lighting hash and recompiles programs mid-census. */
  children(): SceneCensusChild[];
  /** One full pipeline render (composer path when active). */
  render(): void;
  counters(): DrawStatsCounters;
  resetCounters(): void;
  countersAutoReset(): boolean;
  setCountersAutoReset(autoReset: boolean): void;
  programCount(): number;
  textureCount(): number;
  geometryCount(): number;
  /** Whether the directional shadow pass runs at all on this tier. */
  shadowsEnabled(): boolean;
  shadowAutoUpdate(): boolean;
  setShadowAutoUpdate(autoUpdate: boolean): void;
  /** Drop the census renders from the live per-frame draw-stats delta. */
  discardOutOfBand(): void;
}

export interface SceneCensusRow {
  category: string;
  /** Top-level subtrees in this bucket (visible ones at capture time). */
  roots: number;
  visibleRoots: number;
  calls: number;
  triangles: number;
  points: number;
  /** Share of the baseline's calls/triangles this bucket accounts for. */
  callsShare: number;
  trianglesShare: number;
}

export interface SceneCensusReport {
  /** Caller-supplied timestamp and location so a capture is reproducible. */
  atMs: number;
  tier: string;
  playerPosition: { x: number; y: number; z: number };
  cameraPosition: { x: number; y: number; z: number };
  /** Full-pipeline pass with everything visible (shadow + post included). */
  baseline: DrawStatsCounters;
  /** Shadow pass share (baseline minus a pass with shadow updates frozen). */
  shadow: { measured: boolean; calls: number; triangles: number; callsShare: number };
  /** Per-bucket cost, sorted by calls descending. Rows overlap `shadow`. */
  rows: SceneCensusRow[];
  /** baseline minus the sum of bucket rows: post-chain passes + untoggled
   * leftovers. Clamped at zero (overlap can push the sum past the baseline). */
  residual: { calls: number; triangles: number };
  programs: number;
  textures: number;
  geometries: number;
  /** Measurement renders performed (baseline + shadow + one per bucket). */
  renders: number;
}

export interface SceneCensusMeta {
  atMs: number;
  tier: string;
  playerPosition: { x: number; y: number; z: number };
  cameraPosition: { x: number; y: number; z: number };
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 1000;
}

function counterDiff(baseline: DrawStatsCounters, without: DrawStatsCounters): DrawStatsCounters {
  return {
    calls: Math.max(0, baseline.calls - without.calls),
    triangles: Math.max(0, baseline.triangles - without.triangles),
    points: Math.max(0, baseline.points - without.points),
    lines: Math.max(0, baseline.lines - without.lines),
  };
}

/**
 * Run the one-shot census: baseline render, shadow-frozen render, then one
 * render per category bucket with that bucket hidden, diffing the counters
 * each time. Restores every toggled flag, the counter auto-reset mode, and
 * the shadow auto-update mode, and discards the whole burst from the live
 * draw-stats delta, even when a render throws.
 */
export function captureSceneCensus(
  host: SceneCensusHost,
  meta: SceneCensusMeta,
): SceneCensusReport {
  const children = host.children();
  const savedVisible = children.map((c) => c.visible);
  const savedShadowAuto = host.shadowAutoUpdate();
  const savedAutoReset = host.countersAutoReset();
  let renders = 0;
  const measure = (): DrawStatsCounters => {
    host.resetCounters();
    host.render();
    renders++;
    return host.counters();
  };
  try {
    host.setCountersAutoReset(false);
    const baseline = measure();

    let shadow: SceneCensusReport['shadow'] = {
      measured: false,
      calls: 0,
      triangles: 0,
      callsShare: 0,
    };
    if (host.shadowsEnabled()) {
      host.setShadowAutoUpdate(false);
      const frozen = counterDiff(baseline, measure());
      host.setShadowAutoUpdate(savedShadowAuto);
      shadow = {
        measured: true,
        calls: frozen.calls,
        triangles: frozen.triangles,
        callsShare: share(frozen.calls, baseline.calls),
      };
    }

    const buckets = new Map<string, number[]>();
    children.forEach((child, i) => {
      const members = buckets.get(child.category);
      if (members) members.push(i);
      else buckets.set(child.category, [i]);
    });

    const rows: SceneCensusRow[] = [];
    for (const [category, members] of buckets) {
      for (const i of members) children[i].setVisible(false);
      const cost = counterDiff(baseline, measure());
      for (const i of members) children[i].setVisible(savedVisible[i]);
      rows.push({
        category,
        roots: members.length,
        visibleRoots: members.filter((i) => savedVisible[i]).length,
        calls: cost.calls,
        triangles: cost.triangles,
        points: cost.points,
        callsShare: share(cost.calls, baseline.calls),
        trianglesShare: share(cost.triangles, baseline.triangles),
      });
    }
    rows.sort(
      (a, b) =>
        b.calls - a.calls || b.triangles - a.triangles || (a.category < b.category ? -1 : 1),
    );

    const rowCalls = rows.reduce((sum, r) => sum + r.calls, 0);
    const rowTriangles = rows.reduce((sum, r) => sum + r.triangles, 0);
    return {
      atMs: meta.atMs,
      tier: meta.tier,
      playerPosition: meta.playerPosition,
      cameraPosition: meta.cameraPosition,
      baseline,
      shadow,
      rows,
      residual: {
        calls: Math.max(0, baseline.calls - rowCalls),
        triangles: Math.max(0, baseline.triangles - rowTriangles),
      },
      programs: host.programCount(),
      textures: host.textureCount(),
      geometries: host.geometryCount(),
      renders,
    };
  } finally {
    children.forEach((child, i) => {
      if (child.visible !== savedVisible[i]) child.setVisible(savedVisible[i]);
    });
    host.setShadowAutoUpdate(savedShadowAuto);
    host.setCountersAutoReset(savedAutoReset);
    // One trailing render with everything restored: the burst runs inside a
    // single task, so without this the frame the browser presents would be
    // the last bucket-hidden pass until the next live sync(). Fail-soft: a
    // throw here (context loss mid-census) must neither mask the original
    // error nor skip the counter discard below.
    try {
      host.render();
    } catch {
      // presentation-only pass; the discard below still runs
    }
    host.discardOutOfBand();
  }
}

const K = 1000;
const M = 1_000_000;

/** Dev-diagnostic number formatting (English by design, like the ?perf overlay). */
export function censusCount(n: number): string {
  if (n >= 10 * M) return `${Math.round(n / M)}M`;
  if (n >= M) return `${Math.round((n / M) * 10) / 10}M`;
  if (n >= 10 * K) return `${Math.round(n / K)}K`;
  if (n >= K) return `${Math.round((n / K) * 10) / 10}K`;
  return `${n}`;
}

/** Monospace table lines for the ?perf overlay (and terminal logs). */
export function censusTableLines(report: SceneCensusReport): string[] {
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const lines = [
    `census ${report.tier}  calls ${report.baseline.calls}  tris ${censusCount(report.baseline.triangles)}  prog ${report.programs}`,
    `pos ${Math.round(report.playerPosition.x)},${Math.round(report.playerPosition.z)}`,
  ];
  if (report.shadow.measured) {
    lines.push(
      `shadow      ${String(report.shadow.calls).padStart(5)} ${pct(report.shadow.callsShare).padStart(4)} ${censusCount(report.shadow.triangles).padStart(6)}`,
    );
  }
  for (const row of report.rows) {
    if (row.calls === 0 && row.triangles === 0) continue;
    lines.push(
      `${row.category.slice(0, 11).padEnd(11)} ${String(row.calls).padStart(5)} ${pct(row.callsShare).padStart(4)} ${censusCount(row.triangles).padStart(6)}`,
    );
  }
  lines.push(
    `residual    ${String(report.residual.calls).padStart(5)}      ${censusCount(report.residual.triangles).padStart(6)}`,
  );
  return lines;
}

// ---------------------------------------------------------------------------
// Hitch tracker: per-frame correlation of long frames with program/texture
// growth and view creation. Fed by the renderer only while the ?perf overlay
// is up (zero cost otherwise); all timestamps come from the caller.
// ---------------------------------------------------------------------------

export type HitchCause = 'shader-compile' | 'texture-upload' | 'view-create' | 'other';

export interface HitchFrameSample {
  atMs: number;
  frameMs: number;
  submitMs: number;
  programs: number;
  textures: number;
  createdViews: number;
}

export interface HitchEvent {
  atMs: number;
  frameMs: number;
  submitMs: number;
  programDelta: number;
  textureDelta: number;
  createdViews: number;
  cause: HitchCause;
}

export interface HitchSummary {
  frames: number;
  hitches: number;
  byCause: Record<HitchCause, number>;
  /** Frames whose program count grew, hitching or not (mid-play compiles). */
  programGrowthFrames: number;
  /** Total programs added since tracking started. */
  programsAdded: number;
  recent: HitchEvent[];
}

export interface HitchTracker {
  frame(sample: HitchFrameSample): HitchEvent | null;
  summary(): HitchSummary;
  reset(): void;
}

// Absolute threshold tuned for the 60 fps target the budgets are written
// against (two missed vsyncs). On a 30 fps-capped profile or 30 Hz panel
// nearly every frame crosses it, so callers on such targets should pass
// their own hitchFrameMs; the counts stay comparable only per-target.
export const HITCH_FRAME_MS = 33;
const HITCH_RECENT_LIMIT = 20;

function hitchCause(programDelta: number, textureDelta: number, createdViews: number): HitchCause {
  if (programDelta > 0) return 'shader-compile';
  if (textureDelta > 0) return 'texture-upload';
  if (createdViews > 0) return 'view-create';
  return 'other';
}

export function createHitchTracker(
  opts: { hitchFrameMs?: number; recentLimit?: number } = {},
): HitchTracker {
  const hitchFrameMs = opts.hitchFrameMs ?? HITCH_FRAME_MS;
  const recentLimit = opts.recentLimit ?? HITCH_RECENT_LIMIT;
  let frames = 0;
  let hitches = 0;
  let byCause: Record<HitchCause, number> = {
    'shader-compile': 0,
    'texture-upload': 0,
    'view-create': 0,
    other: 0,
  };
  let programGrowthFrames = 0;
  let programsAdded = 0;
  // Scalars, not an object: this runs per frame while the overlay is up, and
  // the per-frame path stays allocation-free outside actual hitch events.
  let lastPrograms = -1;
  let lastTextures = -1;
  let recent: HitchEvent[] = [];
  return {
    frame(sample: HitchFrameSample): HitchEvent | null {
      frames++;
      // First sample only establishes the baseline: a delta needs two reads.
      const programDelta = lastPrograms >= 0 ? sample.programs - lastPrograms : 0;
      const textureDelta = lastTextures >= 0 ? sample.textures - lastTextures : 0;
      lastPrograms = sample.programs;
      lastTextures = sample.textures;
      if (programDelta > 0) {
        programGrowthFrames++;
        programsAdded += programDelta;
      }
      if (sample.frameMs < hitchFrameMs) return null;
      const event: HitchEvent = {
        atMs: Math.round(sample.atMs),
        frameMs: Math.round(sample.frameMs * 100) / 100,
        submitMs: Math.round(sample.submitMs * 100) / 100,
        programDelta,
        textureDelta,
        createdViews: sample.createdViews,
        cause: hitchCause(programDelta, textureDelta, sample.createdViews),
      };
      hitches++;
      byCause[event.cause]++;
      recent.push(event);
      if (recent.length > recentLimit) recent.splice(0, recent.length - recentLimit);
      return event;
    },
    summary(): HitchSummary {
      return {
        frames,
        hitches,
        byCause: { ...byCause },
        programGrowthFrames,
        programsAdded,
        recent: recent.slice(),
      };
    },
    reset(): void {
      frames = 0;
      hitches = 0;
      byCause = { 'shader-compile': 0, 'texture-upload': 0, 'view-create': 0, other: 0 };
      programGrowthFrames = 0;
      programsAdded = 0;
      lastPrograms = -1;
      lastTextures = -1;
      recent = [];
    },
  };
}
