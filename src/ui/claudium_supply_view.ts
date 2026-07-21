// Pure, host-agnostic view model for the CLAUDIUM supply panel: how much
// Claudium exists across the whole economy, and how that total moved over time.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md
// Conventions; reference claudium_view.ts / vendor_view.ts). Like every Claudium
// core, the economy service is authoritative: the totals, the peg, and the curve
// points ALL arrive from the service. This core derives NO economic quantity. It
// only decides what is displayable and converts the service points into the
// normalized chart geometry the painter strokes. DOM-free and i18n-free so
// tests/claudium_supply_view.test.ts can drive it directly.
//
// The one non-negotiable, shared with claudium_view.ts: when the service is off
// (totals null) the model is a clean disabled/empty state, NEVER an error crash.
// A real zero total and an unreachable service must render differently, so
// `available` is a separate flag rather than an inference from circulating === 0.

/** The service supply payload. All null when the economy service is unreachable. */
export interface ClaudiumSupplyInput {
  circulating: number | null;
  issued: number | null;
  sunk: number | null;
  holders: number | null;
  usdPerClaudium: number | null;
  atMs: number | null;
}

/** One service curve point: the circulating total as of `atMs`. */
export interface ClaudiumSupplyPointInput {
  atMs: number;
  circulating: number;
}

/** The selectable chart windows, mirroring the range buttons. */
export type ClaudiumSupplyRange = '24h' | '7d' | '30d';

export interface ClaudiumSupplyViewInput {
  supply: ClaudiumSupplyInput;
  points: readonly ClaudiumSupplyPointInput[];
  range: ClaudiumSupplyRange;
  /**
   * The window the SERVICE actually computed these points for, echoed back on
   * the payload. Plotting against this rather than a locally recomputed window
   * is load-bearing for two reasons:
   *  - Points are stamped at their BUCKET FLOOR, so the first one is normally
   *    slightly OLDER than the requested sinceMs. Re-deriving the window and
   *    filtering to it silently drops that first point, which is the chart's
   *    left anchor and one end of the period delta.
   *  - A repaint happens at a later clock than the fetch. A window re-derived
   *    from "now" slides forward under fixed data, so points fall off the left
   *    edge the longer the panel stays open.
   * Named serviceWindow, not window: the src/ui purity guard scans for DOM
   * globals by name, and a bare `window` property reads as the browser global.
   * Null only when the service is off (no window was returned).
   */
  serviceWindow: { sinceMs: number; untilMs: number } | null;
}

/** Window length per range, in ms. The bucket that pairs with each is below. */
const RANGE_MS: Record<ClaudiumSupplyRange, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/**
 * Bucket size per range, chosen so every window yields a comparable number of
 * points (about 144 for 24h, 168 for 7d, 180 for 30d). Enough to show shape,
 * few enough that the painter strokes a bounded path.
 */
const RANGE_BUCKET_MS: Record<ClaudiumSupplyRange, number> = {
  '24h': 600_000, // 10 minutes
  '7d': 3_600_000, // 1 hour
  '30d': 4 * 3_600_000, // 4 hours
};

/** The service query for a range: what the window should fetch. */
export interface ClaudiumSupplyQuery {
  sinceMs: number;
  untilMs: number;
  bucketMs: number;
}

/** Resolve the fetch window for a range. Pure: `nowMs` is injected. */
export function claudiumSupplyQuery(
  range: ClaudiumSupplyRange,
  nowMs: number,
): ClaudiumSupplyQuery {
  return {
    sinceMs: nowMs - RANGE_MS[range],
    untilMs: nowMs,
    bucketMs: RANGE_BUCKET_MS[range],
  };
}

/** A chart point in normalized [0,1] space, y already flipped for canvas. */
export interface ClaudiumChartPoint {
  /** 0 at the window start, 1 at the window end. */
  x: number;
  /** 0 at the TOP of the plot (max value), 1 at the bottom (min value). */
  y: number;
  atMs: number;
  circulating: number;
}

/** An axis label: the value plus where it sits in normalized space. */
export interface ClaudiumChartAxisLabel {
  value: number;
  /** Normalized position along the axis, matching the point convention. */
  at: number;
}

export interface ClaudiumSupplyChart {
  points: readonly ClaudiumChartPoint[];
  /** Plot bounds, after padding. The painter labels these, it never recomputes. */
  minCirculating: number;
  maxCirculating: number;
  sinceMs: number;
  untilMs: number;
  /** Value-axis ticks, bottom to top. Empty when there is nothing to plot. */
  valueLabels: readonly ClaudiumChartAxisLabel[];
  /** Time-axis ticks, left to right. Empty when there is nothing to plot. */
  timeLabels: readonly ClaudiumChartAxisLabel[];
}

export interface ClaudiumSupplyModel {
  /** False when the service is off: render the empty state, not a zero. */
  available: boolean;
  /** Integer Claudium in existence, or null when unavailable. */
  circulating: number | null;
  issued: number | null;
  sunk: number | null;
  holders: number | null;
  /** circulating at the display peg, or null when either input is missing. */
  circulatingUsd: number | null;
  range: ClaudiumSupplyRange;
  /** The selectable ranges and which one is active, for the button row. */
  rangeOptions: readonly { id: ClaudiumSupplyRange; selected: boolean }[];
  /** Null when there is nothing plottable (no points, or all-equal with no total). */
  chart: ClaudiumSupplyChart | null;
  /**
   * Net change across the plotted window (last minus first), or null when the
   * window holds fewer than two points. Service-derived: it is a subtraction of
   * two service totals, never an independently computed figure.
   */
  changeInWindow: number | null;
}

const ALL_RANGES: readonly ClaudiumSupplyRange[] = ['24h', '7d', '30d'];

/** Value-axis tick count, matching the reference chart's five gridlines. */
const VALUE_TICKS = 5;
/** Time-axis tick count. */
const TIME_TICKS = 4;

/**
 * Pad a flat series so a constant supply draws as a centered horizontal line
 * rather than collapsing to a divide-by-zero. Uses a fraction of the value
 * itself so the padding scales with the economy, with an absolute floor for the
 * all-zero case.
 */
function padBounds(min: number, max: number): { min: number; max: number } {
  if (max > min) {
    // A little headroom top and bottom so the stroke never rides the edge.
    const pad = (max - min) * 0.08;
    return { min: min - pad, max: max + pad };
  }
  const pad = Math.max(Math.abs(max) * 0.1, 1);
  return { min: max - pad, max: max + pad };
}

/**
 * Build the chart geometry from the service points. Returns null when there is
 * nothing to plot, so the painter has one unambiguous empty check.
 *
 * Points arrive bucket-aligned and ascending with inactive buckets OMITTED (see
 * ClaudiumSupplyHistoryV1). That omission is meaningful: supply did not change,
 * so the line should hold flat across the gap. Positioning x by TIMESTAMP rather
 * than by array index is what renders that correctly, since a gap then shows as
 * a long flat run instead of being compressed to one step.
 *
 * The plot domain starts at the EARLIER of the requested window start and the
 * first point. Points carry their bucket floor, so the first one usually sits
 * just before sinceMs; anchoring on it keeps that point on the chart (and every
 * x within [0,1]) instead of discarding the curve's left end.
 */
function buildChart(
  points: readonly ClaudiumSupplyPointInput[],
  sinceMs: number,
  untilMs: number,
): ClaudiumSupplyChart | null {
  if (points.length === 0) return null;
  const domainStart = Math.min(sinceMs, points[0].atMs);
  if (untilMs <= domainStart) return null;

  let lo = points[0].circulating;
  let hi = points[0].circulating;
  for (const p of points) {
    if (p.circulating < lo) lo = p.circulating;
    if (p.circulating > hi) hi = p.circulating;
  }
  const bounds = padBounds(lo, hi);
  const span = bounds.max - bounds.min;
  const timeSpan = untilMs - domainStart;

  const chartPoints = points.map((p) => ({
    x: (p.atMs - domainStart) / timeSpan,
    // Flipped: 0 is the top of the plot, matching canvas coordinates.
    y: 1 - (p.circulating - bounds.min) / span,
    atMs: p.atMs,
    circulating: p.circulating,
  }));

  const valueLabels: ClaudiumChartAxisLabel[] = [];
  for (let i = 0; i < VALUE_TICKS; i++) {
    const frac = i / (VALUE_TICKS - 1);
    valueLabels.push({ value: bounds.min + span * frac, at: 1 - frac });
  }
  const timeLabels: ClaudiumChartAxisLabel[] = [];
  for (let i = 0; i < TIME_TICKS; i++) {
    const frac = i / (TIME_TICKS - 1);
    timeLabels.push({ value: domainStart + timeSpan * frac, at: frac });
  }

  return {
    points: chartPoints,
    minCirculating: bounds.min,
    maxCirculating: bounds.max,
    sinceMs: domainStart,
    untilMs,
    valueLabels,
    timeLabels,
  };
}

/**
 * Project the service supply payload and curve into the panel model.
 *
 * The ONLY arithmetic here is presentational: the USD equivalent at the
 * service-supplied peg, the window delta (a subtraction of two service totals),
 * and the normalization of service points into [0,1] chart space. No supply
 * figure is derived, defaulted, or reconstructed locally.
 */
export function buildClaudiumSupplyModel(input: ClaudiumSupplyViewInput): ClaudiumSupplyModel {
  const { supply } = input;
  const available = supply.circulating !== null;
  const rangeOptions = ALL_RANGES.map((id) => ({ id, selected: id === input.range }));

  if (!available) {
    return {
      available: false,
      circulating: null,
      issued: null,
      sunk: null,
      holders: null,
      circulatingUsd: null,
      range: input.range,
      rangeOptions,
      chart: null,
      changeInWindow: null,
    };
  }

  // The service already windowed these points; re-filtering them against a
  // locally derived window is what dropped the first one. Trust the echoed
  // window, and fall back to an empty plot when the service sent none.
  const chart = input.serviceWindow
    ? buildChart(input.points, input.serviceWindow.sinceMs, input.serviceWindow.untilMs)
    : null;
  const plotted = chart?.points ?? [];

  return {
    available: true,
    circulating: supply.circulating,
    issued: supply.issued,
    sunk: supply.sunk,
    holders: supply.holders,
    circulatingUsd:
      supply.circulating !== null && supply.usdPerClaudium !== null
        ? supply.circulating * supply.usdPerClaudium
        : null,
    range: input.range,
    rangeOptions,
    chart,
    // Derived from exactly the points that got plotted, so the stated delta and
    // the drawn curve can never disagree.
    changeInWindow:
      plotted.length >= 2 ? plotted[plotted.length - 1].circulating - plotted[0].circulating : null,
  };
}
