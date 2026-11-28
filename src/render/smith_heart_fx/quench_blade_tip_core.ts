// The risen Quench blade's point and its kit piece split (Jose's playtest of
// 2026-11-04: risen, the end of the blade showed "a weird ice spike that does
// not look like part of the sword"): the pure half of quench_blades_fx.ts.
//
// The Quench kit's Kit_SunkBlade (docs/design/raid/kit/quench_pieces.py
// `sunk_blade`) is cut at the ice and carries the lake's heaved plates round
// its foot in the same mesh. Risen, the old point was a pale four-sided cone
// stood straight down the frame while the blade leans on its own axis, so it
// read as a separate spike, and the heaved plates rose with the blade as a
// collar. Here:
//  - the point CONTINUES the blade: the kit's own flat-diamond section (its
//    half width and half thickness at the cut, `sunk_blade`'s `half_w` and
//    `t`) carried down the blade's own leaning axis and closing to a keen
//    point along a convex edge, its paint the kit's own (sampled off the
//    piece: the deep heart, the clear body, the pale keen edges), its top
//    tucked a breath inside the piece so no seam shows;
//  - the heaved plates stay in the lake: a kit triangle low by the foot and
//    outside the blade's section belongs to the collar, drawn at the blade's
//    home round its socket whatever the blade does.
// Node-only (RENDER_PURE_CORES): no three.js, no DOM.

/** The kit piece leans this far toward its +x (quench_pieces.py BLADE_LEAN). */
export const BLADE_KIT_LEAN = 0.17;
const CA = Math.cos(BLADE_KIT_LEAN);
const SA = Math.sin(BLADE_KIT_LEAN);

/** The blade's half width along its own axis `lz` (quench_pieces.py half_w). */
export function bladeHalfWidth(lz: number): number {
  return 1.12 + 0.035 * Math.min(9, Math.max(0, lz));
}

/** The blade's half thickness along its own axis (quench_pieces.py `t`). */
export function bladeHalfThick(lz: number): number {
  return 0.5 + 0.01 * Math.min(9, Math.max(0, lz));
}

/** The piece's frame (x right, y up, z through its faces) to the blade's own
 *  axes: across its width, along its leaning axis. */
export function bladeLocal(x: number, y: number): { lx: number; lz: number } {
  return { lx: x * CA - y * SA, lz: x * SA + y * CA };
}

/** How far into the blade's flat-diamond section a point sits: under 1
 *  inside, 1 on its surface. */
export function bladeSectionReach(x: number, y: number, z: number): number {
  const { lx, lz } = bladeLocal(x, y);
  return Math.abs(lx) / bladeHalfWidth(lz) + Math.abs(z) / bladeHalfThick(lz);
}

/** Below this height (yards, the piece's frame) the lake's plates lie. */
export const COLLAR_TOP = 0.62;
/** A collar triangle's centroid sits this far past the blade's section. */
const COLLAR_REACH = 1.12;

/** Is the kit triangle with this centroid part of the heaved lake round the
 *  blade's foot (stays in the lake), not the blade (rises)? */
export function isCollarTriangle(cx: number, cy: number, cz: number): boolean {
  return cy < COLLAR_TOP && bladeSectionReach(cx, cy, cz) > COLLAR_REACH;
}

/** Split an indexed (or non-indexed: `index` null) kit mesh's triangles into
 *  the blade's and the collar's index lists. */
export function splitKitBlade(
  pos: ArrayLike<number>,
  index: ArrayLike<number> | null,
  vertexCount: number,
): { blade: number[]; collar: number[] } {
  const blade: number[] = [];
  const collar: number[] = [];
  const n = index ? index.length : vertexCount;
  for (let t = 0; t + 2 < n; t += 3) {
    const a = index ? index[t] : t;
    const b = index ? index[t + 1] : t + 1;
    const c = index ? index[t + 2] : t + 2;
    const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
    const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    (isCollarTriangle(cx, cy, cz) ? collar : blade).push(a, b, c);
  }
  return { blade, collar };
}

/** The blade's paint across its width: RAMP_STEPS colours (linear RGB) from
 *  the middle of a face (0) to its keen edge (last). */
export const RAMP_STEPS = 6;
/** The kit's paint when no piece is at hand (sampled off the GLB: the deep
 *  heart, the clear body, the pale edge). */
export const DEFAULT_BLADE_RAMP: readonly (readonly [number, number, number])[] = [
  [0.016, 0.08, 0.2],
  [0.045, 0.15, 0.3],
  [0.07, 0.19, 0.35],
  [0.11, 0.29, 0.48],
  [0.135, 0.33, 0.527],
  [0.22, 0.4, 0.57],
];

/** The kit piece's own paint across its width, averaged off its body (above
 *  the guard's shadow, below the ricasso): the ramp the point wears. Bins
 *  with no vertex take the default's. */
export function sampleBladeRamp(
  pos: ArrayLike<number>,
  col: ArrayLike<number>,
  vertexCount: number,
): [number, number, number][] {
  const sum = Array.from({ length: RAMP_STEPS }, () => [0, 0, 0, 0]);
  for (let i = 0; i < vertexCount; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const { lx, lz } = bladeLocal(x, y);
    if (lz < 0.3 || lz > 4 || Math.abs(z) > 1.2) continue;
    if (bladeSectionReach(x, y, z) > 1.15) continue;
    const e = Math.min(1, Math.abs(lx) / bladeHalfWidth(lz));
    const k = Math.min(RAMP_STEPS - 1, Math.round(e * (RAMP_STEPS - 1)));
    const s = sum[k];
    s[0] += col[i * 3];
    s[1] += col[i * 3 + 1];
    s[2] += col[i * 3 + 2];
    s[3]++;
  }
  return sum.map((s, k) =>
    s[3] > 0
      ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
      : [DEFAULT_BLADE_RAMP[k][0], DEFAULT_BLADE_RAMP[k][1], DEFAULT_BLADE_RAMP[k][2]],
  );
}

/** The point's top: a breath inside the piece (above its slanted cut), so no
 *  seam shows; the section a hair narrower there so no face fights. */
export const TIP_TUCK = 0.24;
const TIP_INSET = 0.985;
/** Rings down the point and stations across each half face. */
const TIP_RINGS = 9;
const ACROSS: readonly number[] = [0, 0.3, 0.6, 0.85, 1];

/** The point's width and thickness as fractions of the cut's (0 at the cut,
 *  1 at the point): a convex edge closing to a keen point, the faces
 *  thinning with it. */
export function tipProfile(s: number): { w: number; t: number } {
  const u = Math.min(1, Math.max(0, s));
  return { w: (1 - u) * (1 + 0.62 * u), t: (1 - u) * (1 + 0.25 * u) };
}

/**
 * The point under the piece, in the piece's frame (x right, y up, z through
 * its faces), as flat-shaded triangles: the blade's flat-diamond section
 * carried from TIP_TUCK above the cut down `length` yards of its own leaning
 * axis to a keen point. Colours from `ramp` by the station's distance across
 * the face, a touch paler at the very point where the ice thins.
 */
export function bladeTipMesh(
  length: number,
  ramp: readonly (readonly [number, number, number])[] = DEFAULT_BLADE_RAMP,
): { positions: Float32Array; colors: Float32Array } {
  const W0 = bladeHalfWidth(0) * TIP_INSET;
  const T0 = bladeHalfThick(0) * TIP_INSET;
  const span = length + TIP_TUCK;
  // The section's loop: across each of the four half faces (+x+z, -x+z,
  // -x-z, +x-z), middle (e 0) to edge (e 1) and back.
  const loop: { e: number; sx: number; sz: number }[] = [];
  const faces: [number, number][] = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (const [fx, fz] of faces) {
    const order = fx * fz > 0 ? ACROSS : [...ACROSS].reverse();
    for (const e of order) loop.push({ e, sx: fx, sz: fz });
  }
  const ring = (k: number) => {
    const s = k / TIP_RINGS;
    const p = tipProfile(s);
    const lz = TIP_TUCK - s * span;
    return loop.map(({ e, sx, sz }) => {
      const lx = sx * e * W0 * p.w;
      const lt = sz * (1 - e) * T0 * p.t;
      return { x: lx * CA + lz * SA, y: -lx * SA + lz * CA, z: lt, e, s };
    });
  };
  const rings = Array.from({ length: TIP_RINGS + 1 }, (_, k) => ring(k));
  const P: number[] = [];
  const Cl: number[] = [];
  const colorOf = (e: number, s: number) => {
    const f = e * (ramp.length - 1);
    const i = Math.min(ramp.length - 2, Math.floor(f));
    const m = f - i;
    const pale = 0.12 * s * s;
    return [0, 1, 2].map((c) => {
      const v = ramp[i][c] * (1 - m) + ramp[i + 1][c] * m;
      return v + (ramp[ramp.length - 1][c] - v) * pale;
    });
  };
  const put = (v: { x: number; y: number; z: number; e: number; s: number }) => {
    P.push(v.x, v.y, v.z);
    Cl.push(...colorOf(v.e, v.s));
  };
  for (let k = 0; k < TIP_RINGS; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    for (let j = 0; j < loop.length; j++) {
      const j2 = (j + 1) % loop.length;
      // Two stations of the same face only (the loop wraps face to face
      // through a shared edge or middle point, never across the section).
      if (loop[j].sx !== loop[j2].sx || loop[j].sz !== loop[j2].sz) continue;
      // The loop runs one way round the section on every face: wound so
      // every face looks outward.
      for (const v of [a[j], b[j], b[j2], a[j], b[j2], a[j2]]) put(v);
    }
  }
  return { positions: new Float32Array(P), colors: new Float32Array(Cl) };
}
