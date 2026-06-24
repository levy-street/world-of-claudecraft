// Pure geometry + animation math for the daily-spinner wheel. Zero DOM/canvas so
// it is unit-testable and the HUD renderer is a thin consumer (the repo's
// pure-core + thin-consumer pattern, like unit_portrait.ts). The wheel is drawn
// from the published prize odds the spin status/catalog endpoint returns
// ({key, weight}); this module turns those into proportional segments and
// computes the exact rotation that lands the fixed top pointer inside the winning
// segment. No player-facing strings here (labels are localized by the consumer).

export interface WheelInput {
  key: string;
  weight: number;
}

export interface WheelSegment {
  key: string;
  index: number;
  /** Segment span as fractions of a full turn, in [0, 1). */
  startFraction: number;
  endFraction: number;
  midFraction: number;
}

/**
 * Lay the weighted prizes out as contiguous wheel segments covering [0, 1). The
 * widths are proportional to weight, so a 60%-weight tier owns 60% of the wheel.
 * Throws on an empty list or a non-positive weight (a configuration bug).
 */
export function wheelSegments(items: readonly WheelInput[]): WheelSegment[] {
  if (items.length === 0) throw new Error('wheelSegments: no items');
  let total = 0;
  for (const it of items) {
    if (!(it.weight > 0) || !Number.isFinite(it.weight)) throw new Error(`wheelSegments: bad weight for ${it.key}`);
    total += it.weight;
  }
  const segments: WheelSegment[] = [];
  let acc = 0;
  items.forEach((it, index) => {
    const startFraction = acc / total;
    acc += it.weight;
    const endFraction = acc / total;
    segments.push({ key: it.key, index, startFraction, endFraction, midFraction: (startFraction + endFraction) / 2 });
  });
  return segments;
}

/** A segment's selection probability (its share of the wheel), in [0, 1]. */
export function segmentProbability(segment: WheelSegment): number {
  return segment.endFraction - segment.startFraction;
}

/**
 * Whether a segment is angularly wide enough to carry a legible on-wheel label.
 * Thin slices (a 0.1% jackpot) physically cannot hold text, so the consumer skips
 * the on-wheel label for those and relies on the legend instead. `minFraction`
 * defaults to 7% of the wheel.
 */
export function fitsLabel(segment: WheelSegment, minFraction = 0.07): boolean {
  return segmentProbability(segment) >= minFraction;
}

/** The wheel fraction currently under the fixed top pointer after `rotationTurns`. */
export function pointerFractionAfter(rotationTurns: number): number {
  const f = rotationTurns % 1;
  return f < 0 ? f + 1 : f;
}

/** The segment a normalized fraction falls in (boundaries belong to the next segment). */
export function segmentAtFraction(segments: readonly WheelSegment[], fraction: number): WheelSegment {
  const x = pointerFractionAfter(fraction);
  for (const s of segments) if (x >= s.startFraction && x < s.endFraction) return s;
  // Reachable only at exactly 1.0 through float drift; the last segment owns it.
  return segments[segments.length - 1];
}

/**
 * Total rotation (in turns) to animate so the pointer lands inside `key`'s
 * segment: `fullTurns` complete spins for drama, then stop at the segment's mid,
 * nudged by `jitter` in [-1, 1] (kept within 80% of the half-width so it never
 * crosses into a neighbor). `pointerFractionAfter(landingRotation(...))` is
 * guaranteed to be inside the target segment. Throws if `key` is not on the wheel.
 */
export function landingRotation(segments: readonly WheelSegment[], key: string, fullTurns: number, jitter = 0): number {
  const seg = segments.find((s) => s.key === key);
  if (!seg) throw new Error(`landingRotation: no segment ${key}`);
  const halfWidth = (seg.endFraction - seg.startFraction) / 2;
  const j = Math.max(-1, Math.min(1, jitter));
  const within = seg.midFraction + j * halfWidth * 0.8;
  return Math.max(0, Math.trunc(fullTurns)) + within;
}
