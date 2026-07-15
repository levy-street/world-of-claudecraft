// Sugarglass Sigils (Trial 2) shape outlines: pure, deterministic etchings in a
// unit square (0..1). The SAME outline drives two consumers, so it MUST be
// byte-identical everywhere: the sim's trace scoring (trial_sigils.ts) and the
// client canvas that draws the etching a player traces. Determinism contract:
// sigilOutline(seed, shapeId, points) is a pure function of its arguments, so
// same (seed, shapeId, points) => same vertices in the browser, on the server,
// and headless.
//
// Leaf module: the only import is the shared Rng, seeded SOLELY by the shape
// seed. That is an independent stream that never touches the per-run or shared
// sim rng streams, so building a shape draws nothing from either.

import { Rng } from '../rng';

// A closed polyline in shape-local space (the unit square 0..1). Vertex i is
// (xs[i], ys[i]); the loop closes from the last vertex back to (xs[0], ys[0]).
// thin[i] flags a vertex on a fragile section (a star point / crown spike) where
// the scorer multiplies crack accrual by GAUNTLET.sigils.thinSectionMult.
export interface SigilOutline {
  xs: number[];
  ys: number[];
  thin: boolean[];
}

// One authored key corner of a shape before arc-length resampling: an angle and
// radius around the shape center, and whether it is a fragile apex.
interface PolarCorner {
  ang: number;
  rad: number;
  sharp: boolean;
}

interface Corner {
  x: number;
  y: number;
  sharp: boolean;
}

// Shape-geometry constants (NOT balance knobs: those live in GAUNTLET.sigils).
// The center of the unit square, the base outer radius (kept small so the
// seeded scale/rotation jitter can never push a vertex outside the square), and
// the arc-fraction band around each fragile apex that resamples to thin.
const CENTER = 0.5;
const OUTER = 0.4;
const THIN_BAND_FRAC = 0.03;

function ringCorners(): PolarCorner[] {
  // A fine regular polygon; resampling turns it into a smooth circle. No apex.
  const n = 72;
  const out: PolarCorner[] = [];
  for (let k = 0; k < n; k++) out.push({ ang: (2 * Math.PI * k) / n, rad: OUTER, sharp: false });
  return out;
}

function wedgeCorners(): PolarCorner[] {
  // Equilateral triangle, one vertex up. Sharp corners to steer, but no thin
  // penalty: ascending difficulty puts crack multipliers only on star/crown.
  const out: PolarCorner[] = [];
  for (let k = 0; k < 3; k++) {
    out.push({ ang: (2 * Math.PI * k) / 3 - Math.PI / 2, rad: OUTER, sharp: false });
  }
  return out;
}

function starCorners(): PolarCorner[] {
  // Five-point star: alternating outer tips (fragile apexes) and inner valleys.
  const tips = 5;
  const inner = OUTER * 0.44;
  const out: PolarCorner[] = [];
  for (let k = 0; k < tips * 2; k++) {
    const tip = k % 2 === 0;
    out.push({ ang: (Math.PI * k) / tips - Math.PI / 2, rad: tip ? OUTER : inner, sharp: tip });
  }
  return out;
}

function crownCorners(): PolarCorner[] {
  // Five tall narrow spikes on a low rim: the hard shape. Each spike is a
  // rim-base, a fragile tip apex, and a rim-base, so the two spike edges are the
  // thin sections.
  const spikes = 5;
  const rim = OUTER * 0.62;
  const half = ((2 * Math.PI) / spikes) * 0.17;
  const out: PolarCorner[] = [];
  for (let k = 0; k < spikes; k++) {
    const a = (2 * Math.PI * k) / spikes - Math.PI / 2;
    out.push({ ang: a - half, rad: rim, sharp: false });
    out.push({ ang: a, rad: OUTER, sharp: true });
    out.push({ ang: a + half, rad: rim, sharp: false });
  }
  return out;
}

function shapeCorners(shapeId: number): PolarCorner[] {
  switch (shapeId) {
    case 0:
      return ringCorners();
    case 1:
      return wedgeCorners();
    case 2:
      return starCorners();
    default:
      return crownCorners(); // 3 = crown; also the safe fallback
  }
}

// Resample a closed key-corner polygon to exactly `points` vertices spaced
// evenly by arc length. A vertex is thin when its arc position lands within
// THIN_BAND_FRAC of any sharp corner (the fragile apex region), which keeps the
// thin band narrow instead of flooding a whole star with it.
function resampleClosed(corners: Corner[], points: number): SigilOutline {
  const m = corners.length;
  const seg = new Array<number>(m);
  const cum = new Array<number>(m + 1);
  cum[0] = 0;
  for (let k = 0; k < m; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % m];
    seg[k] = Math.hypot(b.x - a.x, b.y - a.y);
    cum[k + 1] = cum[k] + seg[k];
  }
  const total = cum[m];
  const sharpArcs: number[] = [];
  for (let k = 0; k < m; k++) if (corners[k].sharp) sharpArcs.push(cum[k]);
  const band = THIN_BAND_FRAC * total;

  const xs = new Array<number>(points);
  const ys = new Array<number>(points);
  const thin = new Array<boolean>(points);
  const step = total / points;
  let k = 0;
  for (let i = 0; i < points; i++) {
    const target = i * step;
    while (k < m - 1 && cum[k + 1] <= target) k++;
    const a = corners[k];
    const b = corners[(k + 1) % m];
    const t = seg[k] > 0 ? (target - cum[k]) / seg[k] : 0;
    xs[i] = a.x + t * (b.x - a.x);
    ys[i] = a.y + t * (b.y - a.y);
    thin[i] = nearSharp(target, sharpArcs, total, band);
  }
  return { xs, ys, thin };
}

function nearSharp(arc: number, sharps: number[], total: number, band: number): boolean {
  for (const s of sharps) {
    let d = Math.abs(arc - s);
    if (d > total / 2) d = total - d; // shortest way round the closed loop
    if (d <= band) return true;
  }
  return false;
}

export function sigilOutline(seed: number, shapeId: number, points: number): SigilOutline {
  const rng = new Rng(seed >>> 0);
  const phi = rng.range(0, Math.PI * 2); // rotation jitter, so runs are not byte-identical
  const scale = rng.range(0.9, 1.0); // slight shrink; stays inside the unit square
  const corners = shapeCorners(shapeId).map<Corner>((c) => ({
    x: CENTER + c.rad * scale * Math.cos(c.ang + phi),
    y: CENTER + c.rad * scale * Math.sin(c.ang + phi),
    sharp: c.sharp,
  }));
  return resampleClosed(corners, points);
}
