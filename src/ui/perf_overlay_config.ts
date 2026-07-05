// Persisted appearance/layout config for the performance overlay.
//
// The master on/off lives in GameSettings (`showFps`, for back-compat with the
// legacy FPS toggle). Everything richer — position, colors, opacity, text size,
// graph, thresholds, and the per-metric visibility map — lives here under its own
// localStorage key, because GameSettings only stores flat numbers/booleans and
// this needs hex strings + a nested metric map. The store is pure aside from a
// try/catch-guarded localStorage (so it imports cleanly under Vitest/jsdom).

import {
  defaultMetricsMap, METRIC_REGISTRY, PERF_COLOR_THEMES, type PerfMetricKey,
} from './perf_overlay_model';

export interface PerfOverlayConfig {
  /** Normalized 0..1 position of the overlay's top-left corner (top-left origin). */
  posX: number;
  posY: number;
  /** Panel background alpha when not in solid mode (0..1). */
  opacity: number;
  /** Force a fully opaque background for maximum contrast over bright scenes. */
  solidBg: boolean;
  /** Text scale multiplier. */
  fontScale: number;
  /** Text/accent color (hex #rrggbb). */
  textColor: string;
  /** Background color (hex #rrggbb); alpha comes from `opacity`/`solidBg`. */
  bgColor: string;
  /** Frame-time sparkline on/off. */
  graph: boolean;
  /** Green/amber/red threshold coloring on/off. */
  thresholds: boolean;
  /** Per-metric visibility. */
  metrics: Record<PerfMetricKey, boolean>;
}

/** A partial update: top-level fields are optional and `metrics` may be sparse. */
export type PerfOverlayPatch =
  Partial<Omit<PerfOverlayConfig, 'metrics'>> & { metrics?: Partial<Record<PerfMetricKey, boolean>> };

const STORE_KEY = 'woc_perf_overlay';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.6;

const DEFAULT_THEME = PERF_COLOR_THEMES[0];

/** The factory defaults: off-screen state aside, top-left, classic gold, the
 *  standard metric trio (FPS + frame time + ping), graph + thresholds on. */
export function defaultPerfOverlayConfig(): PerfOverlayConfig {
  return {
    posX: 0,
    posY: 0,
    opacity: 0.55,
    solidBg: false,
    fontScale: 1,
    textColor: DEFAULT_THEME.fg,
    bgColor: DEFAULT_THEME.bg,
    graph: true,
    thresholds: true,
    metrics: defaultMetricsMap(),
  };
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function hexOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : fallback;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Coerce arbitrary stored/patched data into a valid config (clamped + filtered). */
export function sanitizePerfOverlayConfig(raw: unknown, base = defaultPerfOverlayConfig()): PerfOverlayConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const metrics = { ...base.metrics };
  const rawMetrics = r.metrics;
  if (rawMetrics && typeof rawMetrics === 'object') {
    for (const def of METRIC_REGISTRY) {
      const v = (rawMetrics as Record<string, unknown>)[def.key];
      if (typeof v === 'boolean') metrics[def.key] = v;
    }
  }
  return {
    posX: clamp(r.posX, 0, 1, base.posX),
    posY: clamp(r.posY, 0, 1, base.posY),
    opacity: clamp(r.opacity, 0, 1, base.opacity),
    solidBg: boolOr(r.solidBg, base.solidBg),
    fontScale: clamp(r.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, base.fontScale),
    textColor: hexOr(r.textColor, base.textColor),
    bgColor: hexOr(r.bgColor, base.bgColor),
    graph: boolOr(r.graph, base.graph),
    thresholds: boolOr(r.thresholds, base.thresholds),
    metrics,
  };
}

/** Loads, persists, and validates the overlay config. One instance per session. */
export class PerfOverlayConfigStore {
  private cfg: PerfOverlayConfig;

  constructor() {
    this.cfg = this.load();
  }

  private load(): PerfOverlayConfig {
    let stored: unknown = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); } catch { /* corrupt / unavailable */ }
    return sanitizePerfOverlayConfig(stored);
  }

  private save(): void {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.cfg)); } catch { /* storage unavailable */ }
  }

  /** A defensive copy — callers must go through patch() to persist a change. */
  get(): PerfOverlayConfig {
    return { ...this.cfg, metrics: { ...this.cfg.metrics } };
  }

  /** Merge a partial update (metrics shallow-merged), validate, persist, return it. */
  patch(p: PerfOverlayPatch): PerfOverlayConfig {
    const merged: Record<string, unknown> = { ...this.cfg, ...p };
    if (p.metrics) merged.metrics = { ...this.cfg.metrics, ...p.metrics };
    this.cfg = sanitizePerfOverlayConfig(merged);
    this.save();
    return this.get();
  }

  /** Toggle/set a single metric's visibility. */
  setMetric(key: PerfMetricKey, on: boolean): PerfOverlayConfig {
    return this.patch({ metrics: { [key]: on } });
  }

  /** Restore appearance/layout/metrics to factory defaults (does not touch the
   *  master on/off, which lives in GameSettings). */
  reset(): PerfOverlayConfig {
    this.cfg = defaultPerfOverlayConfig();
    this.save();
    return this.get();
  }

  /** Reset only the position to top-left (the "Reset Position" button). */
  resetPosition(): PerfOverlayConfig {
    return this.patch({ posX: 0, posY: 0 });
  }
}
