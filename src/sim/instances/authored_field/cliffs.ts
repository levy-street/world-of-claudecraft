// Cliff derivation for an authored field: every place where the ground drops
// by more than the field's step becomes a wall, so the one-height-per-point
// terrain can never be walked off or climbed up except along a path. Derived
// once from the surface outlines (never hand-placed), so collision and the
// renderer's cliff dressing come from one source.
//
// Each outline edge is sampled every yard; a sample needs a wall when the
// ground just inside and just outside it differ by more than `cliffStep`.
// Consecutive wall samples along one edge merge into a single run, and a run
// becomes one thin OBB. A spatial dedupe keeps two surfaces sharing an edge
// from emitting the same wall twice.

import {
  authoredFieldHeight,
  authoredFieldSurfaceAt,
  pathHeightAt,
  pathOutline,
  pointInPolygon,
} from './height';
import type { AuthoredFieldDef, FieldEdgeStyle, FieldSurface } from './types';

/** One straight stretch of cliff: world-local endpoints and the two heights. */
export interface FieldCliffRun {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Ground height on the high side and the low side (mid-run sample). */
  high: number;
  low: number;
  /** Unit normal pointing from the high side to the low side. */
  nx: number;
  nz: number;
  style: FieldEdgeStyle;
  /** The surface whose outline produced this run. */
  surface: string;
}

const SAMPLE_STEP = 1;
const PROBE = 0.6;
/** Circles become polygons with edges about this long. */
const CIRCLE_EDGE = 5;

/** The closed outline of a surface as a ring of points (no repeat at the end). */
export function surfaceOutline(s: FieldSurface): [number, number][] {
  if (s.kind === 'poly') return s.points.map((p) => [p[0], p[1]]);
  if (s.kind === 'circle') {
    const n = Math.max(12, Math.ceil((2 * Math.PI * s.r) / CIRCLE_EDGE));
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push([s.x + Math.cos(a) * s.r, s.z + Math.sin(a) * s.r]);
    }
    return out;
  }
  return pathOutline(s);
}

function surfaceContains(s: FieldSurface, x: number, z: number): boolean {
  if (s.kind === 'circle') return (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r;
  if (s.kind === 'poly') return pointInPolygon(s.points, x, z);
  return !Number.isNaN(pathHeightAt(s, x, z));
}

/** Every cliff run of the field, in surface then edge order (deterministic). */
export function authoredFieldCliffRuns(def: AuthoredFieldDef): FieldCliffRun[] {
  const runs: FieldCliffRun[] = [];
  const claimed = new Set<number>();
  const keyOf = (x: number, z: number): number =>
    Math.round(x * 2 + 4096) * 16384 + Math.round(z * 2 + 4096);
  for (const s of def.surfaces) {
    const ring = surfaceOutline(s);
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const ex = (bx - ax) / len;
      const ez = (bz - az) / len;
      // Outward normal: the side of the edge the surface does NOT cover.
      let nx = ez;
      let nz = -ex;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (surfaceContains(s, mx + nx * 0.3, mz + nz * 0.3)) {
        nx = -nx;
        nz = -nz;
      }
      const samples = Math.max(1, Math.round(len / SAMPLE_STEP));
      let runStart = -1;
      let runHigh = 0;
      let runLow = 0;
      let runSign = 0;
      const flush = (endIdx: number): void => {
        if (runStart < 0) return;
        const t0 = runStart / samples;
        const t1 = (endIdx + 1) / samples;
        // The run is dressed and owned by its HIGH side: this surface when it
        // stands above the drop, else whatever surface the outside belongs to.
        const mx2 = ax + (bx - ax) * ((t0 + t1) / 2);
        const mz2 = az + (bz - az) * ((t0 + t1) / 2);
        const high =
          runSign > 0 ? s : (authoredFieldSurfaceAt(def, mx2 + nx * PROBE, mz2 + nz * PROBE) ?? s);
        runs.push({
          ax: ax + (bx - ax) * t0,
          az: az + (bz - az) * t0,
          bx: ax + (bx - ax) * t1,
          bz: az + (bz - az) * t1,
          high: runHigh,
          low: runLow,
          nx: nx * runSign,
          nz: nz * runSign,
          style: high.edge ?? 'rock',
          surface: high.id,
        });
        runStart = -1;
      };
      for (let k = 0; k < samples; k++) {
        const t = (k + 0.5) / samples;
        const sx = ax + (bx - ax) * t;
        const sz = az + (bz - az) * t;
        const hIn = authoredFieldHeight(def, sx - nx * PROBE, sz - nz * PROBE);
        const hOut = authoredFieldHeight(def, sx + nx * PROBE, sz + nz * PROBE);
        const diff = hIn - hOut;
        const key = keyOf(sx, sz);
        const wall = Math.abs(diff) > def.cliffStep && !claimed.has(key);
        const sign = diff > 0 ? 1 : -1;
        if (wall && runStart >= 0 && sign !== runSign) flush(k - 1);
        if (wall) {
          claimed.add(key);
          if (runStart < 0) {
            runStart = k;
            runSign = sign;
            runHigh = Math.max(hIn, hOut);
            runLow = Math.min(hIn, hOut);
          }
        } else {
          flush(k - 1);
        }
      }
      flush(samples - 1);
    }
  }
  return runs;
}
