// The Thornhollow battleground field: runtime accessors over the generated
// map data (src/sim/thornhollow_field.generated.ts).
//
// The field is the one place outside the overworld with REAL terrain: the map
// was sculpted in the editor as a stamp chain, and this module evaluates that
// same chain into a heightfield the whole engine samples through groundHeight's
// battleground arm: sim movement, spell sight lines, the chase camera, the
// renderer's ground mesh and the server all read the ONE surface, so they can
// never fork. Sim layer: pure data + math, no DOM, no three.js.
//
// The grid is baked at COMPILE time (1yd cells, 1cm quantization, base64 in
// the generated module) and only decoded here, so first sample costs
// milliseconds, not a stamp-chain evaluation. Every consumer (collider seats
// included: the compiler seats those with the exact chain) agrees to within
// the interpolation error of a smooth brush surface; tests pin the generated
// build-time probes against this runtime decode AND against the exact chain.

import {
  TH_HALF_X,
  TH_HALF_Z,
  TH_HEIGHT_CELL,
  TH_HEIGHT_COLS,
  TH_HEIGHT_MIN,
  TH_HEIGHT_ROWS,
  TH_HEIGHTFIELD_B64,
  TH_PAINT_CELL,
  TH_PAINT_COLS,
  TH_PAINT_ORIGIN_X,
  TH_PAINT_ORIGIN_Z,
  TH_PAINT_RLE,
  TH_PAINT_ROWS,
  TH_STAMPS,
  type ThHeightStamp,
} from './thornhollow_field.generated';

const CELL = TH_HEIGHT_CELL;
const COLS = TH_HEIGHT_COLS;
const ROWS = TH_HEIGHT_ROWS;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// terrain_brush.ts hash01 + the 'splatter' alpha mask, verbatim: the one mask
// the map uses (the compiler refuses anything else at build time).
function hash01(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function splatterAlpha(u: number, v: number): number {
  let best = 0;
  for (let i = 0; i < 26; i++) {
    const bx = hash01(i, 3, 71) * 1.7 - 0.85;
    const by = hash01(i, 7, 71) * 1.7 - 0.85;
    const radius = 0.05 + hash01(i, 11, 71) * 0.22;
    const distance = Math.hypot(u - bx, v - by);
    if (distance < radius) best = Math.max(best, 1 - (distance / radius) ** 2);
  }
  return best;
}

function brushWeight(distanceRatio: number, hardness: number): number {
  if (distanceRatio >= 1) return 0;
  const hard = clamp01(hardness);
  let radial = 1;
  if (hard < 1 && distanceRatio > hard) {
    const t = (distanceRatio - hard) / (1 - hard);
    radial = 1 - t * t * (3 - 2 * t);
  }
  return radial;
}

function applyStamp(e: ThHeightStamp, x: number, z: number, h: number): number {
  if (e.radius <= 0) return h;
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= e.radius) return h;
  const t = d / e.radius;
  const alpha = e.alpha ? splatterAlpha(dx / e.radius, dz / e.radius) : 1;
  const w = (e.falloff === 'flat' ? 1 : brushWeight(t, e.hardness ?? 0)) * alpha;
  if (w <= 0) return h;
  if (e.mode === 'level') return h + (e.delta - h) * w;
  return h + e.delta * w;
}

/** The exact stamp-chain height at a field-local point (no interpolation).
 *  O(stamps); used to build the grid and by tests. Hot paths use the grid. */
export function bgFieldExactHeight(lx: number, lz: number): number {
  let h = 0;
  for (const e of TH_STAMPS) h = applyStamp(e, lx, lz, h);
  return h;
}

let field: Float32Array | null = null;

// Decode the baked uint16 grid. atob is a global in every host this runs in
// (browsers, Node 16+, the RL env); no Buffer dependency, sim stays pure.
function buildField(): Float32Array {
  const raw = atob(TH_HEIGHTFIELD_B64);
  const n = COLS * ROWS;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = raw.charCodeAt(i * 2);
    const hi = raw.charCodeAt(i * 2 + 1);
    out[i] = TH_HEIGHT_MIN + (lo | (hi << 8)) / 100;
  }
  return out;
}

/** Bilinear heightfield sample at a field-local point, clamped to the rect. */
export function bgFieldHeightLocal(lx: number, lz: number): number {
  if (!field) field = buildField();
  const f = field;
  const fx = Math.min(COLS - 1.001, Math.max(0, (lx + TH_HALF_X) / CELL));
  const fz = Math.min(ROWS - 1.001, Math.max(0, (lz + TH_HALF_Z) / CELL));
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fz);
  const tx = fx - c0;
  const tz = fz - r0;
  const a = f[c0 * ROWS + r0];
  const b = f[(c0 + 1) * ROWS + r0];
  const c = f[c0 * ROWS + r0 + 1];
  const d = f[(c0 + 1) * ROWS + r0 + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

export { TH_HALF_X as BG_FIELD_HALF_X, TH_HALF_Z as BG_FIELD_HALF_Z };

// --- authored ground paint --------------------------------------------------
//
// The surface the map was PAINTED with (grass, cobbled court, dirt lanes), the
// other half of "what you see is what you walk on". The compiler emits it as
// run-length pairs over a row-major cell grid; this is the ONE decode of that
// table. Two consumers want two different per-cell values out of the same walk:
// the renderer stores texture-array LAYER indices (src/render/battleground_core.ts
// bgPaintLookup), and the M-map atlas plate stores its own surface family
// (src/ui/bg_field_relief_core.ts). `map` decides which, so neither has to copy
// the walk (and neither retains the other's grid).

/** Cell pitch of the paint grid, yards. */
export const BG_PAINT_CELL = TH_PAINT_CELL;
export const BG_PAINT_COLS = TH_PAINT_COLS;
export const BG_PAINT_ROWS = TH_PAINT_ROWS;
/** Field-local yards at cell (0, 0), the grid's -x/-z corner. */
export const BG_PAINT_ORIGIN_X = TH_PAINT_ORIGIN_X;
export const BG_PAINT_ORIGIN_Z = TH_PAINT_ORIGIN_Z;
/** The value a cell keeps when `map` declines its swatch id. No authored swatch
 *  id reaches it, so it can never collide with a real mapped value. */
export const BG_PAINT_UNPAINTED = 255;

/**
 * Decode the run-length ground paint into a dense row-major cell grid
 * (`row * BG_PAINT_COLS + col`, col along +x from `BG_PAINT_ORIGIN_X`).
 *
 * `map` translates an authored swatch id into the byte the caller wants stored;
 * returning `undefined` leaves the run unpainted.
 */
export function bgFieldPaintCells(
  map: (id: number) => number | undefined,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(TH_PAINT_COLS * TH_PAINT_ROWS);
  out.fill(BG_PAINT_UNPAINTED);
  let at = 0;
  for (let i = 0; i + 1 < TH_PAINT_RLE.length; i += 2) {
    const value = map(TH_PAINT_RLE[i]);
    const run = TH_PAINT_RLE[i + 1];
    if (value !== undefined) out.fill(value, at, Math.min(out.length, at + run));
    at += run;
  }
  return out;
}
