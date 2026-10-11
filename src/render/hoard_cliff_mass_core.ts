// The continuous cliff body behind the Buried Hoard wall rocks.
//
// The wall used to be NOTHING but instanced rocks, so from most angles it read as
// a pile: gaps showed daylight between them and the cornice seemed to float. This
// core generates one unbroken geological mass that follows the room boundary, a
// face that leans back, a plateau and a back slope, all broadly deformed. The
// rocks stay, but as detail embedded IN this body (hoard_valley_core.ts sinks
// them into it and sizes them from the same height field).
//
// Pure and deterministic: no Three, no rng. Same polygon and seed, same cliff.
// It never touches gameplay: collision and the room shape are simulation-owned,
// and the body starts ON the boundary and only ever grows outward from it.

export interface CliffPoint {
  x: number;
  z: number;
}

/** Yards between columns of the mass along the wall. */
export const CLIFF_COLUMN_STEP = 2.4;
/** Columns per cutaway chunk (the camera can hide a stretch of wall). */
export const CLIFF_CHUNK_COLUMNS = 5;
/** Wall height range in yards, before the reveal-shoulder boost. */
export const CLIFF_MIN_HEIGHT = 9;
export const CLIFF_MAX_HEIGHT = 15.5;
export const CLIFF_SHOULDER_BOOST = 1.3;

/** Cross-section, room side first: [depth outward, height fraction, deform amp].
 *  The foot sinks under the floor, the face leans back as it climbs (dense and
 *  heavy below, broken above), then a plateau and a slope close it behind. */
const PROFILE: readonly (readonly [number, number, number])[] = [
  [0.3, -0.14, 0.15],
  [0.55, 0.1, 0.7],
  [1.25, 0.36, 1.35],
  [2.0, 0.64, 1.6],
  [3.0, 0.88, 1.3],
  [4.6, 1.0, 0.9],
  [9.0, 0.94, 0.6],
  [14.0, 0.45, 0],
];

function hash(seed: number, a: number, b: number): number {
  let value = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

/** Smooth value noise in [0, 1] that wraps after `period` cells, so the wall
 *  closes on itself with no seam where the loop meets. */
export function cliffNoise(seed: number, salt: number, u: number, period: number): number {
  const cells = Math.max(1, Math.round(period));
  const base = Math.floor(u);
  const t = u - base;
  const a = hash(seed, ((base % cells) + cells) % cells, salt);
  const b = hash(seed, (((base + 1) % cells) + cells) % cells, salt);
  const eased = t * t * (3 - 2 * t);
  return a + (b - a) * eased;
}

/** cliffNoise along the wall at perimeter distance `s`, with a wavelength of
 *  about `wavelength` yards snapped so a whole number of cells fits the loop:
 *  the value at the end of the wall is exactly the value at its start. */
export function cliffLoopNoise(
  seed: number,
  salt: number,
  s: number,
  perimeter: number,
  wavelength: number,
): number {
  const cells = Math.max(1, Math.round(perimeter / wavelength));
  return cliffNoise(seed, salt, (s / Math.max(0.001, perimeter)) * cells, cells);
}

export interface CliffEdge {
  a: CliffPoint;
  b: CliffPoint;
  length: number;
  /** Perimeter distance at `a`. */
  start: number;
  /** Unit normal pointing OUT of the room. */
  nx: number;
  nz: number;
}

export interface CliffPerimeter {
  edges: CliffEdge[];
  length: number;
}

/** The room outline as edges with outward normals, whatever its winding. */
export function cliffPerimeter(polygon: readonly CliffPoint[]): CliffPerimeter {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.z - b.x * a.z;
  }
  const flip = area < 0 ? -1 : 1;
  const edges: CliffEdge[] = [];
  let start = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    edges.push({
      a,
      b,
      length,
      start,
      nx: (dz / length) * flip,
      nz: (-dx / length) * flip,
    });
    start += length;
  }
  return { edges, length: start };
}

/** Tall shoulders frame the reveal into the open valley (the wall rocks have
 *  always been boosted there; the body under them has to rise with them). */
export function cliffShoulder(x: number, z: number, revealZ: number): boolean {
  return Math.abs(z - revealZ) < 4.8 && Math.abs(x) > 5 && Math.abs(x) < 38;
}

/** Height of the wall at perimeter distance `s`: long swells plus shorter
 *  breaks, so the skyline is irregular but never a row of equal pieces. */
export function cliffHeight(seed: number, s: number, perimeter: number): number {
  const swell = cliffLoopNoise(seed, 1, s, perimeter, 15);
  const breaks = cliffLoopNoise(seed, 2, s, perimeter, 4.6);
  const t = swell * 0.72 + breaks * 0.28;
  return CLIFF_MIN_HEIGHT + (CLIFF_MAX_HEIGHT - CLIFF_MIN_HEIGHT) * t;
}

/** How far out of the room the FACE of the body is at a height fraction (0 at
 *  the floor, 1 at the plateau). Rocks use this to sink into the face. */
export function cliffFaceDepth(
  seed: number,
  s: number,
  perimeter: number,
  heightFraction: number,
): number {
  const h = Math.max(PROFILE[0][1], Math.min(1, heightFraction));
  // Rings 0 to 5 are the face, foot to plateau lip.
  for (let ring = 0; ring < 5; ring++) {
    const [d0, h0] = PROFILE[ring];
    const [d1, h1] = PROFILE[ring + 1];
    if (h > h1) continue;
    const t = h1 === h0 ? 0 : Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
    const lower = d0 + deform(seed, s, perimeter, ring);
    const upper = d1 + deform(seed, s, perimeter, ring + 1);
    return lower + (upper - lower) * t;
  }
  return PROFILE[5][0] + deform(seed, s, perimeter, 5);
}

function deform(seed: number, s: number, perimeter: number, ring: number): number {
  const amp = PROFILE[ring][2];
  if (amp === 0) return 0;
  const broad = cliffLoopNoise(seed, 20 + ring, s, perimeter, 6.2);
  const fine = cliffLoopNoise(seed, 40 + ring, s, perimeter, 2.3);
  return amp * (broad * 0.68 + fine * 0.32);
}

export interface CliffMassChunk {
  /** First vertex and vertex count of this stretch of wall (triangles, flat). */
  start: number;
  count: number;
  min: [number, number, number];
  max: [number, number, number];
}

export interface CliffMass {
  positions: Float32Array;
  /** Painted light times the zone rock colour, per vertex. */
  colors: Float32Array;
  chunks: CliffMassChunk[];
}

interface Column {
  x: number;
  z: number;
  nx: number;
  nz: number;
  s: number;
  height: number;
}

function columns(perimeter: CliffPerimeter, seed: number, revealZ: number): Column[] {
  const out: Column[] = [];
  const { edges } = perimeter;
  for (let e = 0; e < edges.length; e++) {
    const edge = edges[e];
    const previous = edges[(e + edges.length - 1) % edges.length];
    // The corner column splits the angle, pushed out so the body keeps its
    // thickness round the bend instead of pinching.
    let mx = edge.nx + previous.nx;
    let mz = edge.nz + previous.nz;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const stretch = Math.min(2, 1 / Math.max(0.5, mx * edge.nx + mz * edge.nz));
    const steps = Math.max(1, Math.round(edge.length / CLIFF_COLUMN_STEP));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const x = edge.a.x + (edge.b.x - edge.a.x) * t;
      const z = edge.a.z + (edge.b.z - edge.a.z) * t;
      const s = edge.start + edge.length * t;
      const corner = step === 0;
      const boost = cliffShoulder(x, z, revealZ) ? CLIFF_SHOULDER_BOOST : 1;
      out.push({
        x,
        z,
        nx: corner ? mx * stretch : edge.nx,
        nz: corner ? mz * stretch : edge.nz,
        s,
        height: cliffHeight(seed, s, perimeter.length) * boost,
      });
    }
  }
  return out;
}

/** sRGB hex to LINEAR channels. The wall rocks take their colour through
 *  THREE.Color, which linearizes it; the body writes raw vertex colours, so it
 *  has to do the same or it renders washed out next to them. */
export function cliffLinearChannels(color: number): [number, number, number] {
  const linear = (byte: number): number => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [linear((color >>> 16) & 0xff), linear((color >>> 8) & 0xff), linear(color & 0xff)];
}

/** Build the body. Triangles are emitted flat (three vertices each, column by
 *  column), so a chunk is a contiguous vertex range the adapter can hide. */
export function buildHoardCliffMass(input: {
  polygon: readonly CliffPoint[];
  seed: number;
  revealZ: number;
  cliff: number;
  cliffLight: number;
}): CliffMass {
  const perimeter = cliffPerimeter(input.polygon);
  const cols = columns(perimeter, input.seed, input.revealZ);
  const rings = PROFILE.length;
  const dark = cliffLinearChannels(input.cliff);
  const light = cliffLinearChannels(input.cliffLight);
  // ring points per column: x, y, z, recess (0 proud of the face, 1 deep in a crease)
  const points = new Float32Array(cols.length * rings * 4);
  for (let c = 0; c < cols.length; c++) {
    const col = cols[c];
    for (let ring = 0; ring < rings; ring++) {
      const amp = PROFILE[ring][2];
      const push = deform(input.seed, col.s, perimeter.length, ring);
      const depth = PROFILE[ring][0] + push;
      const wobble =
        ring > 0 && ring < 5
          ? (cliffLoopNoise(input.seed, 60 + ring, col.s, perimeter.length, 3.4) - 0.5) * 1.1
          : 0;
      const at = (c * rings + ring) * 4;
      points[at] = col.x + col.nx * depth;
      points[at + 1] = PROFILE[ring][1] * col.height + wobble;
      points[at + 2] = col.z + col.nz * depth;
      points[at + 3] = amp > 0 ? push / amp : 0;
    }
  }
  const quads = cols.length * (rings - 1);
  const positions = new Float32Array(quads * 6 * 3);
  const colors = new Float32Array(quads * 6 * 3);
  const chunks: CliffMassChunk[] = [];
  let vertex = 0;
  let chunk: CliffMassChunk | null = null;

  const emit = (
    p: number[],
    height: number,
    colSeed: number,
    ring: number,
    rx: number,
    ry: number,
    rz: number,
  ): void => {
    // p: three points as [x, y, z, recess] * 3
    const ux = p[4] - p[0];
    const uy = p[5] - p[1];
    const uz = p[6] - p[2];
    const vx = p[8] - p[0];
    const vy = p[9] - p[1];
    const vz = p[10] - p[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // Face the room (or the sky, on the plateau): flip any triangle the wound
    // loop turned away, so a single-sided material never shows a hole.
    if (nx * rx + ny * ry + nz * rz < 0) {
      for (let k = 0; k < 4; k++) {
        const swap = p[4 + k];
        p[4 + k] = p[8 + k];
        p[8 + k] = swap;
      }
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    // Hemispheric light with a touch of a fixed key, the valley's painted look:
    // no face ever goes black just because it looks away from one lamp.
    const key = (nx * 0.35 + ny * 0.8 + nz * 0.45) * 0.5 + 0.5;
    const centreY = (p[1] + p[5] + p[9]) / 3;
    const hf = Math.max(0, Math.min(1, centreY / Math.max(1, height)));
    // Heavy and dark where the rock meets the floor, opening up as it climbs.
    const lift = Math.min(1, hf / 0.42);
    const ao = 0.46 + 0.54 * lift * lift * (3 - 2 * lift);
    // Creases (the recessed stretches of the deformed face) hold shadow.
    const recess = (p[3] + p[7] + p[11]) / 3;
    const crease = 1 - 0.26 * recess;
    const shade = (0.44 + 0.34 * Math.max(0, ny) + 0.14 * key) * ao * crease;
    // Tops catch the zone's light tone (snow, moss, dust); faces stay rock.
    const tone = Math.min(
      1,
      0.08 + 0.34 * hash(input.seed, colSeed, 80 + ring) + (ny > 0.62 ? 0.4 : 0),
    );
    for (let corner = 0; corner < 3; corner++) {
      positions[vertex * 3] = p[corner * 4];
      positions[vertex * 3 + 1] = p[corner * 4 + 1];
      positions[vertex * 3 + 2] = p[corner * 4 + 2];
      for (let ch = 0; ch < 3; ch++) {
        colors[vertex * 3 + ch] = (dark[ch] + (light[ch] - dark[ch]) * tone) * shade;
      }
      if (chunk) {
        for (let axis = 0; axis < 3; axis++) {
          const value = p[corner * 4 + axis];
          if (value < chunk.min[axis]) chunk.min[axis] = value;
          if (value > chunk.max[axis]) chunk.max[axis] = value;
        }
      }
      vertex++;
    }
  };

  const scratch: number[] = new Array(12).fill(0);
  const corner = (slot: number, c: number, ring: number): void => {
    const at = (c * rings + ring) * 4;
    for (let k = 0; k < 4; k++) scratch[slot * 4 + k] = points[at + k];
  };

  for (let c = 0; c < cols.length; c++) {
    if (c % CLIFF_CHUNK_COLUMNS === 0) {
      chunk = {
        start: vertex,
        count: 0,
        min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
        max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
      };
      chunks.push(chunk);
    }
    const next = (c + 1) % cols.length;
    const height = (cols[c].height + cols[next].height) / 2;
    for (let ring = 0; ring < rings - 1; ring++) {
      // The face looks INTO the room; the plateau and the back slope look up.
      const face = ring < 4;
      const rx = face ? -cols[c].nx : cols[c].nx * 0.4;
      const ry = face ? 0.3 : 1;
      const rz = face ? -cols[c].nz : cols[c].nz * 0.4;
      corner(0, c, ring);
      corner(1, c, ring + 1);
      corner(2, next, ring);
      emit(scratch, height, c, ring, rx, ry, rz);
      corner(0, next, ring);
      corner(1, c, ring + 1);
      corner(2, next, ring + 1);
      emit(scratch, height, c + 7919, ring, rx, ry, rz);
    }
    if (chunk) chunk.count = vertex - chunk.start;
  }
  return { positions, colors, chunks };
}
