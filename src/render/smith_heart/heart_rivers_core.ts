// Pure plan for the Smith's Heart's floor light-rivers (LIGHT_RIVERS in
// content/smith_heart_layout.ts): one emissive ribbon per vein, draped on the
// floor from its guardian's arena down the vein's walking line to the heart
// seal. Dim while the vein is dark; once its guardian falls the bright
// ribbon runs from the arena to the seal (its draw range grows, so the light
// visibly travels toward the heart) and then holds.
//
// Where a river leaves the floor (the Balcony's tip over the caldera, a stair
// over a gap) it spans the void at the height blended between the floors on
// either side: a beam of light leaping the gap, never a drop to the depth.
//
// Three-free, DOM-free, deterministic.

/** The ribbon's half width and its lift over the floor (yards). */
export const HEART_RIVER_HALF_WIDTH = 0.9;
export const HEART_RIVER_LIFT = 0.12;
/** The longest ribbon segment (yards). */
export const HEART_RIVER_STEP = 1.5;
/** Seconds the light takes to run from the arena to the seal. */
export const HEART_RIVER_RUN_SECONDS = 6;

export interface HeartRiverStrip {
  /** xyz per vertex: one quad (left, right at its start; left, right at its
   *  end) per segment, segment by segment from the river's source (the
   *  arena) to its mouth (the seal). Each quad takes its own segment's
   *  direction, so a hairpin in the walking line never folds the ribbon. */
  positions: Float32Array;
  /** Two up-facing triangles per segment, in segment order, so a draw range
   *  of `6 * n` indices draws the first n segments. */
  indices: Uint32Array;
  /** Resampled points along the line (xz and the draped height, the lift
   *  included), and the segment count (points - 1). */
  points: { x: number; y: number; z: number }[];
  segments: number;
}

/**
 * Drape a polyline on the floor. `floor(x, z)` is the walkable height there,
 * or null over the void.
 */
export function planHeartRiver(
  points: readonly { x: number; z: number }[],
  floor: (x: number, z: number) => number | null,
  step = HEART_RIVER_STEP,
  halfWidth = HEART_RIVER_HALF_WIDTH,
  lift = HEART_RIVER_LIFT,
): HeartRiverStrip {
  // Resample at <= step along every leg, keeping every vertex.
  const xs: number[] = [];
  const zs: number[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k];
    const b = points[k + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let s = 0; s < n; s++) {
      xs.push(a.x + ((b.x - a.x) * s) / n);
      zs.push(a.z + ((b.z - a.z) * s) / n);
    }
  }
  const last = points[points.length - 1];
  xs.push(last.x);
  zs.push(last.z);
  const count = xs.length;
  // Floor heights, then bridge every void run between its floored ends.
  const hs: (number | null)[] = xs.map((x, i) => floor(x, zs[i]));
  const arc: number[] = [0];
  for (let i = 1; i < count; i++)
    arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  const ys = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const h = hs[i];
    if (h !== null) {
      ys[i] = h;
      continue;
    }
    let a = i - 1;
    while (a >= 0 && hs[a] === null) a--;
    let b = i + 1;
    while (b < count && hs[b] === null) b++;
    const ha = a >= 0 ? (hs[a] as number) : null;
    const hb = b < count ? (hs[b] as number) : null;
    if (ha !== null && hb !== null) {
      const t = (arc[i] - arc[a]) / Math.max(1e-6, arc[b] - arc[a]);
      ys[i] = ha + (hb - ha) * t;
    } else {
      ys[i] = ha ?? hb ?? 0;
    }
  }
  const segments = count - 1;
  const positions = new Float32Array(segments * 12);
  const indices = new Uint32Array(segments * 6);
  for (let i = 0; i < segments; i++) {
    let tx = xs[i + 1] - xs[i];
    let tz = zs[i + 1] - zs[i];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // Left of the direction of travel (x right, z forward, seen from above).
    const nx = -tz * halfWidth;
    const nz = tx * halfWidth;
    const y0 = ys[i] + lift;
    const y1 = ys[i + 1] + lift;
    positions.set(
      [
        xs[i] + nx,
        y0,
        zs[i] + nz,
        xs[i] - nx,
        y0,
        zs[i] - nz,
        xs[i + 1] + nx,
        y1,
        zs[i + 1] + nz,
        xs[i + 1] - nx,
        y1,
        zs[i + 1] - nz,
      ],
      i * 12,
    );
    const l0 = i * 4;
    indices.set([l0, l0 + 2, l0 + 1, l0 + 1, l0 + 2, l0 + 3], i * 6);
  }
  const out = xs.map((x, i) => ({ x, y: ys[i] + lift, z: zs[i] }));
  return { positions, indices, points: out, segments };
}

/**
 * How many segments of the bright ribbon draw `since` seconds after its vein
 * lit (negative: not lit). The light runs source to mouth in
 * HEART_RIVER_RUN_SECONDS; a vein met already lit is whole at once.
 */
export function heartRiverLitSegments(since: number, segments: number): number {
  if (since < 0) return 0;
  const t = Math.min(1, since / HEART_RIVER_RUN_SECONDS);
  return Math.round(segments * t);
}

/** The yards from a river's source of each strip vertex (four per segment:
 *  left and right at its start, then at its end), for the surge's shader. */
export function heartRiverArcs(strip: HeartRiverStrip): Float32Array {
  const out = new Float32Array(strip.segments * 4);
  let arc = 0;
  for (let i = 0; i < strip.segments; i++) {
    const a = strip.points[i];
    const b = strip.points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    out[i * 4] = arc;
    out[i * 4 + 1] = arc;
    out[i * 4 + 2] = arc + len;
    out[i * 4 + 3] = arc + len;
    arc += len;
  }
  return out;
}

/** Where the surge rides (yards from the source) `since` seconds after its
 *  vein lit, its river `total` yards long: with the bright ribbon's front
 *  while the light runs, then a little past the mouth as it pours onto the
 *  seal; -1 before and after (no surge). */
export function heartRiverSurgeHead(since: number, total: number): number {
  if (since < 0) return -1;
  const t = since / HEART_RIVER_RUN_SECONDS;
  if (t > 1.15) return -1;
  return total * t;
}
