// Ingest bounds for the world-entry blocks the client beacon carries in
// rawSummary (JSONB, no DDL): the post-curtain program window
// (src/render/post_reveal_links_core.ts), the boot phase durations
// (src/game/perf_boot_phases_core.ts), and the shader warm-up end state
// (src/render/shader_warm_client.ts). Same treatment as the longtask and
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

/** The bound a block's GATING field runs on: only a real finite number opens
 *  the block. Coercion is deliberately absent here, because `Number(false)` and
 *  `Number([])` are both 0, so `{ windowMs: false }` would plant a zero-window
 *  row instead of being dropped. */
function gatingIntOrNull(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.floor(Math.min(max, Math.max(0, value)));
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

/** Undefined without a finite NUMERIC windowMs: an empty record is not a
 *  window, and neither is one whose window is a boolean, a list or a string. */
export function sanitizePostRevealLinks(value: unknown): PostRevealLinksBlock | undefined {
  if (!isRecord(value)) return undefined;
  const windowMs = gatingIntOrNull(value.windowMs, WINDOW_MS_MAX);
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

/** Undefined without a finite NUMERIC entry root: the client sends null for
 *  that, and a non-number is not an entry either. */
export function sanitizeBootPhases(value: unknown): BootPhasesBlock | undefined {
  if (!isRecord(value)) return undefined;
  const entryMs = gatingIntOrNull(value.entryMs, PHASE_MS_MAX);
  if (entryMs === null) return undefined;
  return {
    entryMs,
    rendererCtorMs: boundedIntOrNull(value.rendererCtorMs, PHASE_MS_MAX),
    prepareZoneMs: boundedIntOrNull(value.prepareZoneMs, PHASE_MS_MAX),
    prepareNeighborsMs: boundedIntOrNull(value.prepareNeighborsMs, PHASE_MS_MAX),
    prewarmInitialMs: boundedIntOrNull(value.prewarmInitialMs, PHASE_MS_MAX),
  };
}

// One lowercase cause token: the vocabulary the shader warm-up client mints
// ('ready-timeout', 'hold-timeouts:expired-share', 'extension-drift:<name>',
// ...). The beacon is public, so the token is bounded in length and restricted
// to the token charset; anything else is dropped whole rather than stored
// half-sanitized. Lowercasing comes first on purpose: an extension name
// arrives in the driver's own casing, and rejecting it on case would throw
// away the only field that says WHICH extension drifted. The charset is read
// over the WHOLE value before the cut, so a long hostile string cannot pass by
// having a clean first line's worth; the bound then only trims a real token
// that ran long. It fits the longest one the client can mint, an
// extension-drift naming the longest WebGL extension name (50 characters for
// 'extension-drift:webgl_compressed_texture_s3tc_srgb'), so the one field that
// says which extension drifted arrives whole.
const SHADER_WARM_TOKEN_MAX = 64;
const SHADER_WARM_TOKEN_RE = /^[a-z0-9:_-]+$/;

export function shaderWarmToken(value: unknown): string {
  if (typeof value !== 'string') return '';
  const token = value.trim().toLowerCase();
  return SHADER_WARM_TOKEN_RE.test(token) ? token.slice(0, SHADER_WARM_TOKEN_MAX) : '';
}

export interface ShaderWarmBlock {
  active: boolean;
  worker: string;
  refusal: string;
  mode: string;
  setting: string;
  backend: string;
  warmed: number;
  held: number;
  heldTimedOut: number;
}

/** Undefined without a `mode` token: the client resolves a mode ('off',
 *  'reveal', 'all') before anything else in this block exists, so a block
 *  without one is not a warm-up readout. */
export function sanitizeShaderWarm(value: unknown): ShaderWarmBlock | undefined {
  if (!isRecord(value)) return undefined;
  const mode = shaderWarmToken(value.mode);
  if (!mode) return undefined;
  return {
    active: value.active === true,
    worker: shaderWarmToken(value.worker),
    refusal: shaderWarmToken(value.refusal),
    mode,
    setting: shaderWarmToken(value.setting),
    backend: shaderWarmToken(value.backend),
    // Program and gate counts, bounded like the post-reveal program counts:
    // a session cannot warm or hold more than a page can hold programs.
    warmed: boundedInt(value.warmed, PROGRAMS_MAX),
    held: boundedInt(value.held, PROGRAMS_MAX),
    heldTimedOut: boundedInt(value.heldTimedOut, PROGRAMS_MAX),
  };
}
