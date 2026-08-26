// Ingest bounds for the two world-entry blocks the client beacon carries in
// rawSummary (JSONB, no DDL): the post-curtain program window
// (src/render/post_reveal_links_core.ts) and the boot phase durations
// (src/game/perf_boot_phases_core.ts). Same treatment as the longtask and
// GPU-queue blocks in perf_report.ts: a fixed key set with a numeric bound per
// field, so a hostile payload cannot plant an absurd number or a list where
// the admin raw-report reader expects a handful of ints. Host-agnostic on
// purpose so the bounds are pinned without the HTTP pipeline.

// A page cannot see more programs than three can hold; the count is a list
// length, never a rate.
const PROGRAMS_MAX = 100_000;
// The client window is 20 s; the bound only defends the ingest.
const WINDOW_MS_MAX = 10 * 60_000;
// One sample per DRAWN frame (the watch samples after the draw, never on a
// skipped frame) for the window's length, with slack for a 240 Hz panel.
const SAMPLES_MAX = 1_000_000;
const REVEALS_MAX = 10_000;
// A phone-class entry can legitimately hold the curtain for minutes; the
// ceiling matches the other "span of a session" bounds in perf_report.ts.
const PHASE_MS_MAX = 30 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Non-negative whole number at most `max`; 0 for anything non-numeric. */
function boundedInt(value: unknown, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(Math.min(max, Math.max(0, n)));
}

/** Same bound, but null / undefined / '' and non-numbers stay null (the
 *  perf_report.ts nullableNumberIn contract). */
function boundedIntOrNull(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(Math.min(max, Math.max(0, n)));
}

export interface PostRevealLinksBlock {
  reveals: number;
  revealsInWindow: number;
  windowMs: number;
  programsAtReveal: number;
  programsGained: number;
  samples: number;
  unsampledMs: number;
  closed: boolean;
  baselineLost: boolean;
}

/** Undefined without a finite windowMs: an empty record is not a window. */
export function sanitizePostRevealLinks(value: unknown): PostRevealLinksBlock | undefined {
  if (!isRecord(value)) return undefined;
  const windowMs = boundedIntOrNull(value.windowMs, WINDOW_MS_MAX);
  if (windowMs === null) return undefined;
  return {
    reveals: boundedInt(value.reveals, REVEALS_MAX),
    revealsInWindow: boundedInt(value.revealsInWindow, REVEALS_MAX),
    windowMs,
    programsAtReveal: boundedInt(value.programsAtReveal, PROGRAMS_MAX),
    programsGained: boundedInt(value.programsGained, PROGRAMS_MAX),
    samples: boundedInt(value.samples, SAMPLES_MAX),
    unsampledMs: boundedInt(value.unsampledMs, WINDOW_MS_MAX),
    closed: value.closed === true,
    baselineLost: value.baselineLost === true,
  };
}

export interface BootPhasesBlock {
  entryMs: number;
  rendererCtorMs: number | null;
  prepareZoneMs: number | null;
  prepareNeighborsMs: number | null;
  prewarmInitialMs: number | null;
}

/** Undefined without a finite entry root: the client sends null for that. */
export function sanitizeBootPhases(value: unknown): BootPhasesBlock | undefined {
  if (!isRecord(value)) return undefined;
  const entryMs = boundedIntOrNull(value.entryMs, PHASE_MS_MAX);
  if (entryMs === null) return undefined;
  return {
    entryMs,
    rendererCtorMs: boundedIntOrNull(value.rendererCtorMs, PHASE_MS_MAX),
    prepareZoneMs: boundedIntOrNull(value.prepareZoneMs, PHASE_MS_MAX),
    prepareNeighborsMs: boundedIntOrNull(value.prepareNeighborsMs, PHASE_MS_MAX),
    prewarmInitialMs: boundedIntOrNull(value.prewarmInitialMs, PHASE_MS_MAX),
  };
}
