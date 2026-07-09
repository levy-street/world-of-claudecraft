// Sugarglass Sigils (Trial 2) shape outlines: pure, deterministic etchings in a
// unit square (0..1), authored as flat SVG paths. Five plain geometric shapes:
// triangle, circle, star, rectangle, hexagon. The SAME outline drives two
// consumers, so it MUST be byte-identical everywhere: the sim's trace scoring
// (trial_sigils.ts) and the client slab that draws the flat etching a player
// traces. Determinism contract: sigilOutline(seed, shapeId, points) is a pure
// function of its arguments, so same (seed, shapeId, points) => same vertices in
// the browser, on the server, and headless.
//
// Leaf module: the only import is the shared Rng, seeded SOLELY by the shape
// seed. That is an independent stream that never touches the per-run or shared
// sim rng streams, so building a shape draws nothing from either (the number of
// draws here is free to change without shifting any gameplay rng order).

import { Rng } from '../rng';

// A closed polyline in shape-local space (the unit square 0..1). Vertex i is
// (xs[i], ys[i]); the loop closes from the last vertex back to (xs[0], ys[0]).
// thin[i] flags a vertex on a sharp corner (a triangle/rectangle/hexagon vertex
// or a star point) where the scorer multiplies crack accrual by
// GAUNTLET.sigils.thinSectionMult: the corners are the fragile parts to hug.
export interface SigilOutline {
  xs: number[];
  ys: number[];
  thin: boolean[];
}

interface Pt {
  x: number;
  y: number;
}

// One authored shape: an SVG path (the traceable silhouette) plus the sharp
// corner anchors, authored in the SAME coordinate space as the path. A resampled
// vertex is `thin` when it lands within TIP_FRAC of the fit radius of any corner.
// A shape with no corners (the circle) leaves the array empty and carries no thin
// sections.
interface SigilShapeDef {
  path: string;
  corners: Pt[];
}

// Shape-geometry constants (NOT balance knobs: those live in GAUNTLET.sigils).
// The center of the unit square, the base outer radius (kept small so the seeded
// scale/rotation jitter can never push a vertex outside the square), the seeded
// rotation jitter (kept modest so the shape stays recognizable), and the fixed
// bezier flattening resolution.
const CENTER = 0.5;
const OUTER = 0.4;
const ROT_JITTER = 0.4; // radians (~23 deg) either way
const CURVE_STEPS = 20; // bezier subdivisions per C/Q segment
// Corner rounding (authored-space fractions of the shape's fit radius): the
// fillet radius carved off each sharp corner, and the corner proximity radius. A
// vertex is a "corner" worth rounding only when its turn exceeds ROUND_DOT (so
// the already-smooth circle curve is left alone; only the polygon vertices and
// star points round).
const ROUND_FRAC = 0.14;
const ROUND_DOT = 0.9; // cos(~26 deg): round when the turn is sharper than this
const ROUND_STEPS = 6; // samples along each corner fillet
// A resampled vertex is thin (fragile) when it lands within this many unit-square
// units of a transformed corner anchor: a small neighborhood around each corner,
// so the fragile band is a minority of the loop, not a whole edge.
const THIN_FRAC = 0.07;

// The five-shape set. Paths are authored in a loose centered box (x right, y
// down) and fit to the unit square by sigilOutline, so absolute scale here is
// free; only proportions matter. shapeId indexes this array: 0 triangle,
// 1 circle, 2 star, 3 rectangle, 4 hexagon.
const TRIANGLE: SigilShapeDef = {
  // Equilateral triangle, one vertex up.
  path: 'M 0,-95 L 82.27,47.5 L -82.27,47.5 Z',
  corners: [
    { x: 0, y: -95 },
    { x: 82.27, y: 47.5 },
    { x: -82.27, y: 47.5 },
  ],
};

const CIRCLE: SigilShapeDef = {
  // A circle from four cubic beziers (kappa = 0.5523 * r). No corners: the whole
  // loop is smooth, so it carries no thin sections (the easy shape of the set).
  path:
    'M 90,0 C 90,49.7 49.7,90 0,90 C -49.7,90 -90,49.7 -90,0 ' +
    'C -90,-49.7 -49.7,-90 0,-90 C 49.7,-90 90,-49.7 90,0 Z',
  corners: [],
};

const STAR: SigilShapeDef = {
  // Five-point star: outer tips (the fragile points) alternating with inner
  // valleys.
  path:
    'M 0,-95 L 23.51,-32.36 L 90.36,-29.35 L 38.04,12.36 L 55.84,76.85 ' +
    'L 0,40 L -55.84,76.85 L -38.04,12.36 L -90.36,-29.35 L -23.51,-32.36 Z',
  corners: [
    { x: 0, y: -95 },
    { x: 90.36, y: -29.35 },
    { x: 55.84, y: 76.85 },
    { x: -55.84, y: 76.85 },
    { x: -90.36, y: -29.35 },
  ],
};

const RECTANGLE: SigilShapeDef = {
  // A landscape rectangle (wider than tall) so it reads distinct from a square.
  path: 'M -80,-52 L 80,-52 L 80,52 L -80,52 Z',
  corners: [
    { x: -80, y: -52 },
    { x: 80, y: -52 },
    { x: 80, y: 52 },
    { x: -80, y: 52 },
  ],
};

const HEXAGON: SigilShapeDef = {
  // Regular hexagon, pointy top/bottom (vertices every 60 degrees from the top).
  path: 'M 0,-90 L 77.94,-45 L 77.94,45 L 0,90 L -77.94,45 L -77.94,-45 Z',
  corners: [
    { x: 0, y: -90 },
    { x: 77.94, y: -45 },
    { x: 77.94, y: 45 },
    { x: 0, y: 90 },
    { x: -77.94, y: 45 },
    { x: -77.94, y: -45 },
  ],
};

const SHAPES: SigilShapeDef[] = [TRIANGLE, CIRCLE, STAR, RECTANGLE, HEXAGON];

function shapeDef(shapeId: number): SigilShapeDef {
  return SHAPES[shapeId] ?? STAR; // out of range -> a cornered shape (safe fallback)
}

// Flatten an SVG path (a subset: M/L/H/V/C/Q/Z, absolute and relative) into a
// dense polyline. Pure arithmetic (no DOM), fixed subdivision so it is
// byte-identical across hosts. The authored shapes are one closed subpath each;
// Z restores the current point to the subpath start (the loop close is handled
// by the resampler, which treats the polyline as closed).
function flattenPath(d: string): Pt[] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  const num = (): number => Number.parseFloat(toks[i++]);
  const push = (x: number, y: number): void => {
    pts.push({ x, y });
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): void => {
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const e = t * t * t;
      push(a * cx + b * x1 + c * x2 + e * x, a * cy + b * y1 + c * y2 + e * y);
    }
    cx = x;
    cy = y;
  };
  const quad = (x1: number, y1: number, x: number, y: number): void => {
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const mt = 1 - t;
      const a = mt * mt;
      const b = 2 * mt * t;
      const c = t * t;
      push(a * cx + b * x1 + c * x, a * cy + b * y1 + c * y);
    }
    cx = x;
    cy = y;
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        let x = num();
        let y = num();
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = x;
        cy = y;
        sx = x;
        sy = y;
        push(x, y);
        cmd = rel ? 'l' : 'L'; // an implicit lineto follows extra M coordinate pairs
        break;
      }
      case 'L': {
        let x = num();
        let y = num();
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = x;
        cy = y;
        push(x, y);
        break;
      }
      case 'H': {
        let x = num();
        if (rel) x += cx;
        cx = x;
        push(cx, cy);
        break;
      }
      case 'V': {
        let y = num();
        if (rel) y += cy;
        cy = y;
        push(cx, cy);
        break;
      }
      case 'C': {
        let x1 = num();
        let y1 = num();
        let x2 = num();
        let y2 = num();
        let x = num();
        let y = num();
        if (rel) {
          x1 += cx;
          y1 += cy;
          x2 += cx;
          y2 += cy;
          x += cx;
          y += cy;
        }
        cubic(x1, y1, x2, y2, x, y);
        break;
      }
      case 'Q': {
        let x1 = num();
        let y1 = num();
        let x = num();
        let y = num();
        if (rel) {
          x1 += cx;
          y1 += cy;
          x += cx;
          y += cy;
        }
        quad(x1, y1, x, y);
        break;
      }
      case 'Z': {
        cx = sx;
        cy = sy;
        break;
      }
      default:
        i++; // skip an unrecognized token rather than spin
    }
  }
  return pts;
}

// Fit factor + centroid that map an authored polyline so its farthest point sits
// at radius OUTER around CENTER: normalize by the centroid and the max radius.
function fitTransform(pts: Pt[]): { cx: number; cy: number; r: number } {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
  return { cx, cy, r: r > 0 ? r : 1 };
}

// Mark each resampled vertex fragile when it sits within `radius` (unit-square
// units) of any transformed corner anchor. Done AFTER the shape is fit to the
// square, so a shape whose authored path is all corners (a triangle/rectangle)
// still only flags the small neighborhood around each corner, not every edge.
function markThin(xs: number[], ys: number[], corners: Pt[], radius: number): boolean[] {
  return xs.map((x, i) => corners.some((c) => Math.hypot(x - c.x, ys[i] - c.y) <= radius));
}

// Round the sharp corners of a closed polyline: each vertex whose turn is
// sharper than ROUND_DOT is replaced by a short quadratic fillet (cut `radius`
// back along each edge, capped at 0.45 of the shorter edge so adjacent fillets
// never meet). Already-smooth vertices (dense curve samples) pass through
// untouched.
function roundCorners(pts: Pt[], radius: number): Pt[] {
  const m = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < m; i++) {
    const prev = pts[(i - 1 + m) % m];
    const cur = pts[i];
    const next = pts[(i + 1) % m];
    const e1x = cur.x - prev.x;
    const e1y = cur.y - prev.y;
    const e2x = next.x - cur.x;
    const e2y = next.y - cur.y;
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    const dot = l1 > 1e-6 && l2 > 1e-6 ? (e1x * e2x + e1y * e2y) / (l1 * l2) : 1;
    if (dot > ROUND_DOT) {
      out.push(cur);
      continue;
    }
    const d = Math.min(radius, l1 * 0.45, l2 * 0.45);
    const ax = cur.x - (e1x / l1) * d;
    const ay = cur.y - (e1y / l1) * d;
    const bx = cur.x + (e2x / l2) * d;
    const by = cur.y + (e2y / l2) * d;
    for (let s = 0; s <= ROUND_STEPS; s++) {
      const t = s / ROUND_STEPS;
      const mt = 1 - t;
      out.push({
        x: mt * mt * ax + 2 * mt * t * cur.x + t * t * bx,
        y: mt * mt * ay + 2 * mt * t * cur.y + t * t * by,
      });
    }
  }
  return out;
}

// Resample a closed polyline to exactly `points` vertices spaced evenly by arc
// length.
function resampleClosed(loop: Pt[], points: number): { xs: number[]; ys: number[] } {
  const m = loop.length;
  const seg = new Array<number>(m);
  const cum = new Array<number>(m + 1);
  cum[0] = 0;
  for (let k = 0; k < m; k++) {
    const a = loop[k];
    const b = loop[(k + 1) % m];
    seg[k] = Math.hypot(b.x - a.x, b.y - a.y);
    cum[k + 1] = cum[k] + seg[k];
  }
  const total = cum[m];
  const xs = new Array<number>(points);
  const ys = new Array<number>(points);
  const step = total / points;
  let k = 0;
  for (let i = 0; i < points; i++) {
    const target = i * step;
    while (k < m - 1 && cum[k + 1] <= target) k++;
    const a = loop[k];
    const b = loop[(k + 1) % m];
    const t = seg[k] > 0 ? (target - cum[k]) / seg[k] : 0;
    xs[i] = a.x + t * (b.x - a.x);
    ys[i] = a.y + t * (b.y - a.y);
  }
  return { xs, ys };
}

export function sigilOutline(seed: number, shapeId: number, points: number): SigilOutline {
  const def = shapeDef(shapeId);
  const raw = flattenPath(def.path);
  const fit0 = fitTransform(raw);
  const rounded = roundCorners(raw, ROUND_FRAC * fit0.r);
  const { cx, cy, r } = fitTransform(rounded);
  const rng = new Rng(seed >>> 0);
  const phi = rng.range(-ROT_JITTER, ROT_JITTER); // rotation jitter, so runs are not byte-identical
  const scale = rng.range(0.9, 1.0); // slight shrink; stays inside the unit square
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  // Fit to radius OUTER around the centroid, apply the seeded scale + rotation,
  // then place at CENTER. Farthest rounded point sits at OUTER * scale <= OUTER
  // from center, so every vertex stays well inside the unit square. The same
  // transform maps the corner anchors so fragility is measured in the square.
  const place = (p: Pt): Pt => {
    const nx = ((p.x - cx) / r) * OUTER * scale;
    const ny = ((p.y - cy) / r) * OUTER * scale;
    return { x: CENTER + nx * cosP - ny * sinP, y: CENTER + nx * sinP + ny * cosP };
  };
  const loop = rounded.map(place);
  const { xs, ys } = resampleClosed(loop, points);
  const thin = markThin(xs, ys, def.corners.map(place), THIN_FRAC);
  return { xs, ys, thin };
}
