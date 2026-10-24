// Paint Clutter brush: the pure stroke logic behind app.ts's clutterBegin /
// clutterStep / clutterCommit. A stroke lays one stamp every half radius; each
// stamp freezes the brush settings it was painted with (sim/city_clutter.ts),
// so the renderer can re-scatter it identically forever. Erase lifts whole
// stamps under the brush. DOM-free; tests/editor_clutter_paint.test.ts.

import {
  addClutterStamp,
  CLUTTER_ALL_KINDS,
  CLUTTER_CLUMPS_MAX,
  CLUTTER_DENSITY_MAX,
  CLUTTER_DENSITY_MIN,
  CLUTTER_RADIUS_MAX,
  CLUTTER_RADIUS_MIN,
  CLUTTER_SCALE_MAX,
  CLUTTER_SCALE_MIN,
  type ClutterStamp,
  eraseClutterStamps,
  MAX_CLUTTER_STAMPS,
} from '../sim/city_clutter';

/** The brush panel's settings. */
export interface ClutterBrush {
  density: number;
  minScale: number;
  maxScale: number;
  clumps: number;
  /** Bitmask over CLUTTER_KINDS. */
  kinds: number;
  erase: boolean;
}

export const DEFAULT_CLUTTER_BRUSH: ClutterBrush = {
  density: 4,
  minScale: 0.8,
  maxScale: 1.3,
  clumps: 2,
  kinds: CLUTTER_ALL_KINDS,
  erase: false,
};

// stamps land every half radius along a drag: contiguous cover, few discs
export const CLUTTER_STAMP_SPACING = 0.5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Whether the pointer has travelled far enough since the last stamp. */
export function clutterStampDue(
  last: { x: number; z: number } | null,
  x: number,
  z: number,
  radius: number,
): boolean {
  if (!last) return true;
  return Math.hypot(x - last.x, z - last.z) >= radius * CLUTTER_STAMP_SPACING;
}

/** One stamp from the current brush at (x, z). */
export function makeClutterStamp(
  brush: ClutterBrush,
  x: number,
  z: number,
  radius: number,
  seed: number,
): ClutterStamp {
  const minScale = clamp(brush.minScale, CLUTTER_SCALE_MIN, CLUTTER_SCALE_MAX);
  const maxScale = clamp(brush.maxScale, CLUTTER_SCALE_MIN, CLUTTER_SCALE_MAX);
  const kinds = brush.kinds & CLUTTER_ALL_KINDS || CLUTTER_ALL_KINDS;
  return {
    x: Math.round(x * 100) / 100,
    z: Math.round(z * 100) / 100,
    r: Math.round(clamp(radius, CLUTTER_RADIUS_MIN, CLUTTER_RADIUS_MAX) * 10) / 10,
    kinds,
    density: clamp(Math.round(brush.density), CLUTTER_DENSITY_MIN, CLUTTER_DENSITY_MAX),
    minScale: Math.round(Math.min(minScale, maxScale) * 100) / 100,
    maxScale: Math.round(Math.max(minScale, maxScale) * 100) / 100,
    clumps: clamp(Math.round(brush.clumps), 0, CLUTTER_CLUMPS_MAX),
    seed: Math.round(seed) >>> 0,
  };
}

export interface ClutterStrokeResult {
  stamps: readonly ClutterStamp[];
  /** The document cap stopped this stamp. */
  capped: boolean;
}

/**
 * Apply one brush event to the stroke's stamp list: erase lifts stamps under
 * the brush, paint adds a stamp (unless a same-brush disc already covers it,
 * or the cap is full). Returns the same array when nothing changed.
 */
export function applyClutterBrush(
  stamps: readonly ClutterStamp[],
  brush: ClutterBrush,
  x: number,
  z: number,
  radius: number,
  seed: number,
): ClutterStrokeResult {
  if (brush.erase) return { stamps: eraseClutterStamps(stamps, x, z, radius), capped: false };
  if (stamps.length >= MAX_CLUTTER_STAMPS) return { stamps, capped: true };
  return {
    stamps: addClutterStamp(stamps, makeClutterStamp(brush, x, z, radius, seed)),
    capped: false,
  };
}
