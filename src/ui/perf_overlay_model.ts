// Pure, host-agnostic core for the customizable in-game performance overlay.
//
// This module has NO DOM/Three/i18n-runtime dependencies (only the TranslationKey
// *type*), so it is exercised directly by Vitest. It owns three concerns:
//   1. FrameMeter   — rolling frame-time statistics (FPS, frame ms, 1%/0.1% lows,
//                     hitch count, sparkline samples) computed from raw rAF deltas.
//   2. METRIC_REGISTRY — the declarative catalog of every surfaced metric: its
//                     label key, default visibility, how to read a value from a
//                     MetricsSample, and its color-threshold severity.
//   3. buildPerfOverlayView — turns a sample + the user's view config into an
//                     ordered list of rows (+ badges + graph) for the DOM consumer.
//
// The thin DOM consumer (src/ui/perf_overlay.ts) resolves labelKeys through t()
// and formats values through formatNumber; this core stays locale-free so the
// same row/severity logic is unit-testable without a renderer or a locale loaded.

import type { TranslationKey } from './i18n';

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

export type PerfMetricKey =
  | 'fps' | 'frameTime' | 'fps1Low' | 'fps01Low'
  | 'ping' | 'jitter' | 'snapshot' | 'connection'
  | 'drawCalls' | 'triangles' | 'geometries' | 'textures' | 'programs' | 'renderScale' | 'gpu'
  | 'memory' | 'hitches' | 'entities';

/** A throttled, raw snapshot of every measurable signal. Fields are nullable so
 *  an unsupported source (e.g. performance.memory off Chromium, ping while
 *  offline) is simply omitted from the rendered overlay rather than faked. */
export interface MetricsSample {
  fps: number;
  frameTimeMs: number;
  fps1Low: number | null;
  fps01Low: number | null;
  /** Recent frame times (ms), oldest→newest, for the sparkline. */
  frameSamples: readonly number[];
  // network (online client only)
  online: boolean;
  connected: boolean;
  pingMs: number | null;
  jitterMs: number | null;
  snapshotHz: number | null;
  connectionType: string | null;
  // renderer
  drawCalls: number | null;
  triangles: number | null;
  geometries: number | null;
  textures: number | null;
  programs: number | null;
  renderScale: number | null; // 0..1 effective render scale
  gpu: string | null;
  // browser / world
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  hitches: number | null;
  entities: number | null;
  backgrounded: boolean;
}

export type PerfSeverity = 'good' | 'warn' | 'bad' | 'none';

/** Discriminated value descriptor. The consumer renders each kind through the
 *  locale-aware formatters, so unit text and digit grouping stay localized. */
export type PerfValue =
  | { kind: 'fps'; v: number }
  | { kind: 'ms'; v: number; digits: number }
  | { kind: 'int'; v: number }
  | { kind: 'compact'; v: number }
  | { kind: 'percent'; v: number } // 0..1
  | { kind: 'hz'; v: number }
  | { kind: 'memPair'; usedMb: number; limitMb: number | null }
  | { kind: 'text'; text: string };

export interface PerfOverlayRow {
  key: PerfMetricKey;
  labelKey: TranslationKey;
  value: PerfValue;
  severity: PerfSeverity;
}

export type PerfBadgeKey = 'backgrounded' | 'offline';

export interface PerfOverlayGraph {
  samples: readonly number[];
  targetMs: number;
}

export interface PerfOverlayView {
  rows: PerfOverlayRow[];
  badges: PerfBadgeKey[];
  graph: PerfOverlayGraph | null;
}

/** The slice of the persisted config that drives row/graph selection. */
export interface PerfOverlayViewConfig {
  metrics: Record<PerfMetricKey, boolean>;
  thresholds: boolean;
  graph: boolean;
}

// ---------------------------------------------------------------------------
// Frame-time meter (pure rolling statistics)
// ---------------------------------------------------------------------------

const DEFAULT_RING = 300;       // ~5s at 60fps — enough for stable 1%/0.1% lows
const DEFAULT_REPAINT_MS = 250; // ~4 Hz text repaint, matching the legacy readout
const DEFAULT_GRAPH_POINTS = 90;
const HITCH_MS = 50;            // a frame slower than this counts as a hitch
const EMA_ALPHA = 0.1;          // FPS smoothing — readable, not flickery

export class FrameMeter {
  private ema: number;
  private readonly ring: number[] = [];
  private head = 0;
  private filled = 0;
  private lastPaintMs = 0;

  constructor(
    private readonly cap = DEFAULT_RING,
    private readonly repaintMs = DEFAULT_REPAINT_MS,
    seedFps = 60,
  ) {
    this.ema = seedFps;
  }

  /** Record a frame. Returns true at most ~every `repaintMs` so the caller can
   *  throttle the (relatively expensive) sample-assembly + repaint. */
  step(frameDtSec: number, nowMs: number): boolean {
    if (frameDtSec > 0) {
      this.ema += (1 / frameDtSec - this.ema) * EMA_ALPHA;
      const ms = frameDtSec * 1000;
      if (this.filled < this.cap) {
        this.ring.push(ms);
        this.filled++;
      } else {
        this.ring[this.head] = ms;
        this.head = (this.head + 1) % this.cap;
      }
    }
    if (nowMs - this.lastPaintMs < this.repaintMs) return false;
    this.lastPaintMs = nowMs;
    return true;
  }

  fps(): number {
    return this.ema;
  }

  frameTimeMs(): number {
    return this.ema > 0 ? 1000 / this.ema : 0;
  }

  /** The N-percent low FPS: the FPS at the (100-pct) percentile frame time.
   *  pct=1 → the 99th-percentile (worst 1%) frame. Null until enough samples. */
  lowFps(pct: number): number | null {
    if (this.filled < 20) return null;
    const sorted = this.orderedSamples().slice().sort((a, b) => a - b);
    const q = 1 - pct / 100;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
    const worstMs = sorted[i];
    return worstMs > 0 ? 1000 / worstMs : null;
  }

  /** Count of recent frames slower than the hitch threshold. */
  hitches(thresholdMs = HITCH_MS): number {
    let n = 0;
    for (const ms of this.orderedSamples()) if (ms > thresholdMs) n++;
    return n;
  }

  /** The most recent `max` frame times (ms), oldest→newest, for the sparkline. */
  graphSamples(max = DEFAULT_GRAPH_POINTS): number[] {
    const s = this.orderedSamples();
    return s.length <= max ? s.slice() : s.slice(s.length - max);
  }

  private orderedSamples(): number[] {
    if (this.filled < this.cap) return this.ring;
    return [...this.ring.slice(this.head), ...this.ring.slice(0, this.head)];
  }
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const NONE: PerfSeverity = 'none';

/** Higher is better (FPS, lows): >=good → good, >=warn → warn, else bad. */
function higherBetter(v: number, good: number, warn: number): PerfSeverity {
  return v >= good ? 'good' : v >= warn ? 'warn' : 'bad';
}

/** Lower is better (frame ms, ping, jitter, hitches, heap ratio). */
function lowerBetter(v: number, good: number, warn: number): PerfSeverity {
  return v <= good ? 'good' : v <= warn ? 'warn' : 'bad';
}

// ---------------------------------------------------------------------------
// Metric registry
// ---------------------------------------------------------------------------

interface MetricDef {
  key: PerfMetricKey;
  labelKey: TranslationKey;
  /** Which category subhead the metric's toggle chip sits under in the panel, and
   *  the band it renders in within the overlay (registry order = render order). */
  group: PerfMetricGroup;
  defaultOn: boolean;
  /** Read the display value, or null when the source is unavailable (row hidden). */
  read(s: MetricsSample): PerfValue | null;
  /** Threshold severity for color-coding (ignored when the user turns it off). */
  severity(s: MetricsSample): PerfSeverity;
}

export const METRIC_REGISTRY: readonly MetricDef[] = [
  // --- Frame & timing ---
  {
    key: 'fps', labelKey: 'hudChrome.perf.labels.fps', group: 'frame', defaultOn: true,
    read: (s) => ({ kind: 'fps', v: s.fps }),
    severity: (s) => higherBetter(s.fps, 55, 30),
  },
  {
    key: 'frameTime', labelKey: 'hudChrome.perf.labels.frameTime', group: 'frame', defaultOn: true,
    read: (s) => ({ kind: 'ms', v: s.frameTimeMs, digits: 1 }),
    severity: (s) => lowerBetter(s.frameTimeMs, 18, 33),
  },
  {
    key: 'fps1Low', labelKey: 'hudChrome.perf.labels.fps1Low', group: 'frame', defaultOn: false,
    read: (s) => (s.fps1Low == null ? null : { kind: 'fps', v: s.fps1Low }),
    severity: (s) => (s.fps1Low == null ? NONE : higherBetter(s.fps1Low, 50, 25)),
  },
  {
    key: 'fps01Low', labelKey: 'hudChrome.perf.labels.fps01Low', group: 'frame', defaultOn: false,
    read: (s) => (s.fps01Low == null ? null : { kind: 'fps', v: s.fps01Low }),
    severity: (s) => (s.fps01Low == null ? NONE : higherBetter(s.fps01Low, 45, 20)),
  },
  {
    key: 'hitches', labelKey: 'hudChrome.perf.labels.hitches', group: 'frame', defaultOn: false,
    read: (s) => (s.hitches == null ? null : { kind: 'int', v: s.hitches }),
    severity: (s) => (s.hitches == null ? NONE : lowerBetter(s.hitches, 0, 2)),
  },
  // --- Network (online client only) ---
  {
    key: 'ping', labelKey: 'hudChrome.perf.labels.ping', group: 'network', defaultOn: true,
    read: (s) => (s.online && s.pingMs != null ? { kind: 'ms', v: s.pingMs, digits: 0 } : null),
    severity: (s) => (s.online && s.pingMs != null ? lowerBetter(s.pingMs, 60, 120) : NONE),
  },
  {
    key: 'jitter', labelKey: 'hudChrome.perf.labels.jitter', group: 'network', defaultOn: false,
    read: (s) => (s.online && s.jitterMs != null ? { kind: 'ms', v: s.jitterMs, digits: 0 } : null),
    severity: (s) => (s.online && s.jitterMs != null ? lowerBetter(s.jitterMs, 8, 20) : NONE),
  },
  {
    key: 'snapshot', labelKey: 'hudChrome.perf.labels.snapshot', group: 'network', defaultOn: false,
    read: (s) => (s.online && s.snapshotHz != null ? { kind: 'hz', v: s.snapshotHz } : null),
    severity: () => NONE,
  },
  {
    key: 'connection', labelKey: 'hudChrome.perf.labels.connection', group: 'network', defaultOn: false,
    read: (s) => (s.connectionType ? { kind: 'text', text: s.connectionType.toUpperCase() } : null),
    severity: () => NONE,
  },
  // --- Renderer ---
  {
    key: 'drawCalls', labelKey: 'hudChrome.perf.labels.drawCalls', group: 'renderer', defaultOn: false,
    read: (s) => (s.drawCalls == null ? null : { kind: 'int', v: s.drawCalls }),
    severity: () => NONE,
  },
  {
    key: 'triangles', labelKey: 'hudChrome.perf.labels.triangles', group: 'renderer', defaultOn: false,
    read: (s) => (s.triangles == null ? null : { kind: 'compact', v: s.triangles }),
    severity: () => NONE,
  },
  {
    key: 'geometries', labelKey: 'hudChrome.perf.labels.geometries', group: 'renderer', defaultOn: false,
    read: (s) => (s.geometries == null ? null : { kind: 'int', v: s.geometries }),
    severity: () => NONE,
  },
  {
    key: 'textures', labelKey: 'hudChrome.perf.labels.textures', group: 'renderer', defaultOn: false,
    read: (s) => (s.textures == null ? null : { kind: 'int', v: s.textures }),
    severity: () => NONE,
  },
  {
    key: 'programs', labelKey: 'hudChrome.perf.labels.programs', group: 'renderer', defaultOn: false,
    read: (s) => (s.programs == null ? null : { kind: 'int', v: s.programs }),
    severity: () => NONE,
  },
  {
    key: 'renderScale', labelKey: 'hudChrome.perf.labels.renderScale', group: 'renderer', defaultOn: false,
    read: (s) => (s.renderScale == null ? null : { kind: 'percent', v: s.renderScale }),
    severity: () => NONE,
  },
  {
    key: 'gpu', labelKey: 'hudChrome.perf.labels.gpu', group: 'renderer', defaultOn: false,
    read: (s) => (s.gpu ? { kind: 'text', text: s.gpu } : null),
    severity: () => NONE,
  },
  // --- System ---
  {
    key: 'memory', labelKey: 'hudChrome.perf.labels.memory', group: 'system', defaultOn: false,
    read: (s) => (s.memoryUsedMb == null ? null : { kind: 'memPair', usedMb: s.memoryUsedMb, limitMb: s.memoryLimitMb }),
    severity: (s) => {
      if (s.memoryUsedMb == null || s.memoryLimitMb == null || s.memoryLimitMb <= 0) return NONE;
      return lowerBetter(s.memoryUsedMb / s.memoryLimitMb, 0.6, 0.85);
    },
  },
  {
    key: 'entities', labelKey: 'hudChrome.perf.labels.entities', group: 'system', defaultOn: false,
    read: (s) => (s.entities == null ? null : { kind: 'int', v: s.entities }),
    severity: () => NONE,
  },
];

export const PERF_METRIC_KEYS: readonly PerfMetricKey[] = METRIC_REGISTRY.map((d) => d.key);

// ---------------------------------------------------------------------------
// Metric groups (categorize the Stats toggles + the overlay's render bands)
// ---------------------------------------------------------------------------

export type PerfMetricGroup = 'frame' | 'network' | 'renderer' | 'system';

export interface PerfMetricGroupDef {
  id: PerfMetricGroup;
  labelKey: TranslationKey;
}

/** Ordered category headers; the settings panel renders the metric chips grouped
 *  under these, and the order mirrors the overlay's registry render order. */
export const PERF_METRIC_GROUPS: readonly PerfMetricGroupDef[] = [
  { id: 'frame', labelKey: 'hudChrome.perf.groups.frame' },
  { id: 'network', labelKey: 'hudChrome.perf.groups.network' },
  { id: 'renderer', labelKey: 'hudChrome.perf.groups.renderer' },
  { id: 'system', labelKey: 'hudChrome.perf.groups.system' },
];

/** A single metric's toggle-chip descriptor (key + its short label key). */
export interface PerfMetricChip {
  key: PerfMetricKey;
  labelKey: TranslationKey;
}

export interface PerfMetricGroupView {
  group: PerfMetricGroupDef;
  chips: PerfMetricChip[];
}

/** The metric chips bucketed by category, in group + registry order. A group with
 *  no metrics is omitted (none today, but keeps the consumer defensive). */
export function perfMetricGroups(): PerfMetricGroupView[] {
  return PERF_METRIC_GROUPS
    .map((group) => ({
      group,
      chips: METRIC_REGISTRY.filter((d) => d.group === group.id).map((d) => ({ key: d.key, labelKey: d.labelKey })),
    }))
    .filter((g) => g.chips.length > 0);
}

/** The factory-default per-metric visibility map (FPS + frame time + ping on). */
export function defaultMetricsMap(): Record<PerfMetricKey, boolean> {
  const out = {} as Record<PerfMetricKey, boolean>;
  for (const def of METRIC_REGISTRY) out[def.key] = def.defaultOn;
  return out;
}

/** Convenience presets the "Quick Presets" buttons apply to the metric map. */
export function metricsPreset(kind: 'minimal' | 'standard' | 'everything'): Record<PerfMetricKey, boolean> {
  if (kind === 'everything') {
    const out = {} as Record<PerfMetricKey, boolean>;
    for (const def of METRIC_REGISTRY) out[def.key] = true;
    return out;
  }
  if (kind === 'minimal') {
    const out = {} as Record<PerfMetricKey, boolean>;
    for (const def of METRIC_REGISTRY) out[def.key] = def.key === 'fps';
    return out;
  }
  return defaultMetricsMap(); // standard
}

// ---------------------------------------------------------------------------
// View builder
// ---------------------------------------------------------------------------

export function buildPerfOverlayView(sample: MetricsSample, cfg: PerfOverlayViewConfig): PerfOverlayView {
  const rows: PerfOverlayRow[] = [];
  for (const def of METRIC_REGISTRY) {
    if (!cfg.metrics[def.key]) continue;
    const value = def.read(sample);
    if (value == null) continue;
    rows.push({
      key: def.key,
      labelKey: def.labelKey,
      value,
      severity: cfg.thresholds ? def.severity(sample) : NONE,
    });
  }

  const badges: PerfBadgeKey[] = [];
  if (sample.backgrounded) badges.push('backgrounded');
  if (sample.online && !sample.connected) badges.push('offline');

  const graph: PerfOverlayGraph | null = cfg.graph && sample.frameSamples.length > 1
    ? { samples: sample.frameSamples, targetMs: 1000 / 60 }
    : null;

  return { rows, badges, graph };
}

// ---------------------------------------------------------------------------
// Color themes
// ---------------------------------------------------------------------------

export interface PerfColorTheme {
  id: string;
  labelKey: TranslationKey;
  fg: string;
  bg: string;
}

/** Curated, on-brand presets the swatch row applies (text + background hex).
 *  The first entry is the factory default (classic gold over near-black). */
export const PERF_COLOR_THEMES: readonly PerfColorTheme[] = [
  { id: 'gold', labelKey: 'hudChrome.perf.themes.gold', fg: '#ffd76a', bg: '#08080d' },
  { id: 'frost', labelKey: 'hudChrome.perf.themes.frost', fg: '#8fd8ff', bg: '#070b14' },
  { id: 'ember', labelKey: 'hudChrome.perf.themes.ember', fg: '#ff9a5c', bg: '#130b06' },
  { id: 'jade', labelKey: 'hudChrome.perf.themes.jade', fg: '#88e6a6', bg: '#06120b' },
  { id: 'crimson', labelKey: 'hudChrome.perf.themes.crimson', fg: '#ff8079', bg: '#130708' },
  { id: 'mono', labelKey: 'hudChrome.perf.themes.mono', fg: '#e8e0c8', bg: '#0b0b10' },
];

// ---------------------------------------------------------------------------
// Color helpers (shared by the overlay DOM consumer + the graph painter so the
// hex parse lives in one place; each caller passes its own context fallback —
// the panel background and the accent line legitimately want different defaults).
// ---------------------------------------------------------------------------

const HEX_RGB_RE = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** The factory overlay accent (text) + background colors, taken from the first
 *  theme so the parse fallbacks never drift from the swatch the user sees. */
export const DEFAULT_PERF_FG = PERF_COLOR_THEMES[0].fg;
export const DEFAULT_PERF_BG = PERF_COLOR_THEMES[0].bg;

/** Parse a #rrggbb hex into [r, g, b]; returns `fallback` for any non-matching string. */
export function hexToRgb(hex: string, fallback: readonly [number, number, number]): [number, number, number] {
  const m = HEX_RGB_RE.exec(hex);
  if (!m) return [fallback[0], fallback[1], fallback[2]];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** The canonical fallbacks for a config color that fails to parse: the accent
 *  default for line/text colors, the panel default for backgrounds. */
export const DEFAULT_PERF_FG_RGB: readonly [number, number, number] = hexToRgb(DEFAULT_PERF_FG, [255, 215, 106]);
export const DEFAULT_PERF_BG_RGB: readonly [number, number, number] = hexToRgb(DEFAULT_PERF_BG, [8, 8, 13]);

/** Build an `rgba(...)` string from a #rrggbb hex + alpha (0..1), parsed through
 *  hexToRgb with the caller's context fallback. */
export function rgbaFromHex(hex: string, alpha: number, fallback: readonly [number, number, number]): string {
  const [r, g, b] = hexToRgb(hex, fallback);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Free positioning (normalized 0..1 → on-screen pixels, clamped)
// ---------------------------------------------------------------------------

/** A small safe margin so the panel never sits flush against the screen edge. */
export const PERF_OVERLAY_MARGIN = 8;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Map a normalized position (0..1, top-left origin) to a clamped pixel offset
 *  that always keeps the whole overlay on screen, accounting for its size. */
export function overlayPixelPosition(
  posX: number, posY: number, vw: number, vh: number, ow: number, oh: number, margin = PERF_OVERLAY_MARGIN,
): { left: number; top: number } {
  const availX = Math.max(0, vw - ow - margin * 2);
  const availY = Math.max(0, vh - oh - margin * 2);
  return {
    left: Math.round(margin + clamp01(posX) * availX),
    top: Math.round(margin + clamp01(posY) * availY),
  };
}

/** Inverse of overlayPixelPosition: a dropped pixel offset → normalized 0..1. */
export function overlayFractionFromPixel(
  left: number, top: number, vw: number, vh: number, ow: number, oh: number, margin = PERF_OVERLAY_MARGIN,
): { x: number; y: number } {
  const availX = Math.max(1, vw - ow - margin * 2);
  const availY = Math.max(1, vh - oh - margin * 2);
  return {
    x: clamp01((left - margin) / availX),
    y: clamp01((top - margin) / availY),
  };
}
