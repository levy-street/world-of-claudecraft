// Spline railways: the pure geometry of a track swept along a rail line.
//
// SPACEY (2026-09-18): "have real railways that follow a spline that will then
// be seamless rails that conform to the terrain throughout the cave". The
// mine's track was one straight kit piece stamped every 3.3 yd, which cannot
// bend, breaks at every change of grade and cost a placement apiece. A rail
// line is a list of floor points (WorldContent.rails); this module threads a
// centripetal Catmull-Rom through them and sweeps two continuous rails plus
// evenly spaced sleepers along it, pitching with the grade, as ONE indexed
// mesh with vertex colours (steel and timber share a material, so a whole
// line is a single draw). Pure: no three, no DOM, deterministic.

export interface RailPoint {
  x: number;
  y: number;
  z: number;
}

export interface RailMeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Arc length of the swept centreline, in yards. */
  length: number;
}

export interface RailOptions {
  /** Centre-to-centre rail spacing, yards. */
  gauge?: number;
  /** Optional floor sampler: each centreline sample is re-seated on it so the
   *  track hugs the ground between the authored points. */
  floorAt?: (x: number, z: number, y: number) => number | null;
}

export const RAIL_GAUGE = 1.5;
const SAMPLE_STEP = 0.75;
const SLEEPER_STEP = 1.15;
const RAIL_W = 0.13;
const RAIL_H = 0.17;
const SLEEPER_LEN_PAD = 0.55;
const SLEEPER_W = 0.34;
const SLEEPER_H = 0.12;
const BED_LIFT = 0.03;
const STEEL: readonly [number, number, number] = [0.46, 0.47, 0.5];
const TIMBER: readonly [number, number, number] = [0.3, 0.2, 0.13];

function catmull(p0: RailPoint, p1: RailPoint, p2: RailPoint, p3: RailPoint, t: number): RailPoint {
  // centripetal parameterisation: no cusps or overshoot on uneven spacing
  const d = (a: RailPoint, b: RailPoint): number =>
    Math.sqrt(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)) || 1e-4;
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: RailPoint, b: RailPoint, ta: number, tb: number): RailPoint => {
    const w = (u - ta) / (tb - ta || 1e-6);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** The centreline resampled at an even arc-length step. */
export function sampleRailLine(points: readonly RailPoint[], step = SAMPLE_STEP): RailPoint[] {
  if (points.length < 2) return [];
  const dense: RailPoint[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const span = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
    const n = Math.max(2, Math.ceil(span / (step * 0.5)));
    for (let k = 0; k < n; k++) dense.push(catmull(p0, p1, p2, p3, k / n));
  }
  dense.push(points[points.length - 1]);
  // even arc-length walk over the dense polyline
  const out: RailPoint[] = [dense[0]];
  let carry = 0;
  for (let i = 0; i + 1 < dense.length; i++) {
    const a = dense[i];
    const b = dense[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    let at = step - carry;
    while (at <= seg) {
      const w = at / seg;
      out.push({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w });
      at += step;
    }
    carry = seg - (at - step);
  }
  const last = dense[dense.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y, last.z - tail.z) > step * 0.3) out.push(last);
  return out;
}

/** Sweep the track mesh along a rail line. Null for a degenerate line. */
export function buildRailMesh(
  points: readonly RailPoint[],
  options: RailOptions = {},
): RailMeshArrays | null {
  const gauge = options.gauge ?? RAIL_GAUGE;
  const line = sampleRailLine(points);
  if (line.length < 2) return null;
  if (options.floorAt) {
    for (const p of line) {
      const f = options.floorAt(p.x, p.z, p.y + 1);
      if (f !== null && Math.abs(f - p.y) < 2.5) p.y = f;
    }
    // a light smooth so the rail reads as steel, not as every floor ripple
    const ys = line.map((p) => p.y);
    for (let i = 1; i + 1 < line.length; i++) line[i].y = (ys[i - 1] + ys[i] * 2 + ys[i + 1]) / 4;
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  // frames: tangent, side (horizontal, right of travel), up (perpendicular to both)
  const frames = line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    let tz = b.z - a.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    let sx = tz;
    let sz = -tx;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    // up = side x tangent
    const ux = -sz * ty;
    const uy = sz * tx - sx * tz;
    const uz = sx * ty;
    const ul = Math.hypot(ux, uy, uz) || 1;
    const flip = uy < 0 ? -1 : 1;
    return {
      p,
      tx,
      ty,
      tz,
      sx,
      sz,
      ux: (ux / ul) * flip,
      uy: (uy / ul) * flip,
      uz: (uz / ul) * flip,
    };
  });

  // one rail: a 4-sided box profile swept along the frames, flat-shaded per side
  const rail = (offset: number): void => {
    const hw = RAIL_W / 2;
    // profile corners in (side, up): bottom-left, bottom-right, top-right, top-left
    const prof: readonly [number, number][] = [
      [offset - hw, SLEEPER_H + BED_LIFT],
      [offset + hw, SLEEPER_H + BED_LIFT],
      [offset + hw, SLEEPER_H + BED_LIFT + RAIL_H],
      [offset - hw, SLEEPER_H + BED_LIFT + RAIL_H],
    ];
    // sides: right (1-2), top (2-3), left (3-0); the underside never shows
    const sides: readonly [number, number, number, number][] = [
      [1, 2, 1, 0],
      [2, 3, 0, 1],
      [3, 0, -1, 0],
    ];
    for (const [ia, ib, ns, nu] of sides) {
      const base = pos.length / 3;
      for (const f of frames) {
        for (const c of [prof[ia], prof[ib]]) {
          pos.push(
            f.p.x + f.sx * c[0] + f.ux * c[1],
            f.p.y + f.uy * c[1],
            f.p.z + f.sz * c[0] + f.uz * c[1],
          );
          nrm.push(f.sx * ns + f.ux * nu, f.uy * nu, f.sz * ns + f.uz * nu);
          col.push(STEEL[0], STEEL[1], STEEL[2]);
        }
      }
      for (let i = 0; i + 1 < frames.length; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
  };
  rail(-gauge / 2);
  rail(gauge / 2);

  // sleepers: a box every SLEEPER_STEP along the arc, oriented by the local frame
  const stepFrames = Math.max(1, Math.round(SLEEPER_STEP / SAMPLE_STEP));
  const half = gauge / 2 + SLEEPER_LEN_PAD;
  for (let i = 0; i < frames.length; i += stepFrames) {
    const f = frames[i];
    const corner = (s: number, u: number, t: number): [number, number, number] => [
      f.p.x + f.sx * s + f.ux * u + f.tx * t,
      f.p.y + f.uy * u + f.ty * t,
      f.p.z + f.sz * s + f.uz * u + f.tz * t,
    ];
    const hwT = SLEEPER_W / 2;
    const y0 = BED_LIFT;
    const y1 = BED_LIFT + SLEEPER_H;
    // top + the four sides
    const faces: readonly (readonly [
      [number, number, number],
      [number, number, number],
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ])[] = [
      [
        corner(-half, y1, -hwT),
        corner(half, y1, -hwT),
        corner(half, y1, hwT),
        corner(-half, y1, hwT),
        [f.ux, f.uy, f.uz],
      ],
      [
        corner(-half, y0, hwT),
        corner(-half, y1, hwT),
        corner(half, y1, hwT),
        corner(half, y0, hwT),
        [f.tx, f.ty, f.tz],
      ],
      [
        corner(half, y0, -hwT),
        corner(half, y1, -hwT),
        corner(-half, y1, -hwT),
        corner(-half, y0, -hwT),
        [-f.tx, -f.ty, -f.tz],
      ],
      [
        corner(half, y0, hwT),
        corner(half, y1, hwT),
        corner(half, y1, -hwT),
        corner(half, y0, -hwT),
        [f.sx, 0, f.sz],
      ],
      [
        corner(-half, y0, -hwT),
        corner(-half, y1, -hwT),
        corner(-half, y1, hwT),
        corner(-half, y0, hwT),
        [-f.sx, 0, -f.sz],
      ],
    ];
    for (const face of faces) {
      const base = pos.length / 3;
      const n = face[4];
      for (let c = 0; c < 4; c++) {
        const v = face[c];
        pos.push(v[0], v[1], v[2]);
        nrm.push(n[0], n[1], n[2]);
        const shade = 0.85 + ((i / stepFrames) % 3) * 0.07;
        col.push(TIMBER[0] * shade, TIMBER[1] * shade, TIMBER[2] * shade);
      }
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  return {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nrm),
    colors: Float32Array.from(col),
    indices: Uint32Array.from(idx),
    length: (line.length - 1) * SAMPLE_STEP,
  };
}
