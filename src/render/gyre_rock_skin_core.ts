// The Gyre's rock skin, as geometry: the steep ground of the storm peak (the faces between the
// road's turns and the flank below the outer rail) re-cut as a faceted cliff of stacked ledges,
// so the mountain reads as painted rock where the terrain alone is a smooth dome. A second skin
// laid a hand over the ground, never under it: the terrain keeps every collision and height, and
// this only draws. Pure core: no Three, no DOM, no clock; the painter (gyre_surface.ts) turns
// these arrays into a mesh. Deterministic (the sim's coordinate hash), so every client draws the
// same rock.
//
// How it is cut: the finished ground is sampled on a regular grid; where it is steep (and inside
// the peak's own body, and not the road) the grid vertex is pushed UP by a lift plus a faceted
// noise (a 3D cellular noise whose cells are tilted planes, so the surface breaks along hard
// creases) plus bedding ledges (a sawtooth in height, warped by bearing so the strata tilt). Only
// ever up, never sideways, so the skin stays a heightfield over the ground and cannot fold into
// spikes however hard the facets break; the push is scaled up with the slope so a steep face
// still stands off by a hand's breadth along its normal. Each triangle is textured from a
// projection chosen by its own normal, so the painted cliff never smears over a steep face.

import { GYRE_PEAK, gyreGroundAt, gyrePathAt } from '../sim/quartered_landmarks';
import { hash2 } from '../sim/rng';

/** Grid spacing, yards. */
export const SKIN_CELL = 1;
/** Reach of the skin from the peak's axis, yards (the outer flank ends well inside it). */
export const SKIN_REACH = 62;
/** The ground's slope (rise over run) the skin starts to wear in, and wears fully at. */
export const SKIN_SLOPE_LO = 0.55;
export const SKIN_SLOPE_HI = 0.95;
/** How far the skin stands off the ground before any noise, yards of height. */
export const SKIN_LIFT = 0.4;
/** The least it ever stands off where it is worn at all: it never sinks into the ground. */
export const SKIN_MIN_STANDOFF = 0.08;
/** Yards of world per repeat of the cliff painting. */
export const SKIN_TILE = 16;
/** How far from the road's edge the skin has faded fully in, yards (on both sides: the lip below
 *  the rail, and the face above the road). */
const ROAD_FADE = 3;
/** How far under the road's edge the skin runs flush, so no strip of bare ground shows beside the
 *  paving whatever way the grid falls against the curve, yards. */
const ROAD_TUCK = 1.5;
/** Past this slope the ground is the start seam's wall, a sheer step the skin hugs flat. */
const SEAM_SLOPE_LO = 3;
const SEAM_SLOPE_HI = 5;

const LEDGE_PERIOD = 4.2;
const LEDGE_AMP = 0.34;
const COARSE_CELL = 5;
const COARSE_AMP = 0.3;
const FINE_CELL = 2.3;
const FINE_AMP = 0.1;

function smooth(lo: number, hi: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Faceted noise at a point: the nearest of a scatter of feature points (one per `cell` cube)
 *  owns it, and carries a tilted plane through its own point at its own offset, so the value is
 *  piecewise linear with a step at every border between two owners: facets with hard edges.
 *  In [-amp, amp] near each feature point, a little more far from it. */
export function facetNoise(
  x: number,
  y: number,
  z: number,
  cell: number,
  amp: number,
  seed: number,
): number {
  const fx = x / cell;
  const fy = y / cell;
  const fz = z / cell;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  const cz = Math.floor(fz);
  let best = Number.POSITIVE_INFINITY;
  let value = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ix = cx + dx;
        const iy = cy + dy;
        const iz = cz + dz;
        const key = ix + iz * 1237;
        const px = ix + hash2(key, iy, seed);
        const py = iy + hash2(key, iy + 7919, seed + 1);
        const pz = iz + hash2(key, iy - 4421, seed + 2);
        const d = (px - fx) * (px - fx) + (py - fy) * (py - fy) + (pz - fz) * (pz - fz);
        if (d >= best) continue;
        best = d;
        const gx = (hash2(key, iy + 101, seed + 4) - 0.5) * 0.5;
        const gy = (hash2(key, iy + 211, seed + 5) - 0.5) * 0.5;
        const gz = (hash2(key, iy + 307, seed + 6) - 0.5) * 0.5;
        value =
          (hash2(key, iy + 31, seed + 3) - 0.5) * 2 * amp +
          amp * (gx * (fx - px) + gy * (fy - py) + gz * (fz - pz));
      }
    }
  }
  return value;
}

/** The bedding: a sawtooth of height, a long slope up to a ledge and a drop below the next, its
 *  phase warped by bearing so the strata tilt along the mountain's strike. */
export function ledgeProfile(x: number, y: number, z: number): number {
  const theta = Math.atan2(z - GYRE_PEAK.z, x - GYRE_PEAK.x);
  const warp = 1.1 * Math.sin(theta * 2 + 0.7) + 0.6 * Math.sin(theta * 5 + 2.3);
  const band = (y + warp) / LEDGE_PERIOD;
  const f = band - Math.floor(band);
  return LEDGE_AMP * (f ** 2.2 - 0.3);
}

export interface SkinGeometry {
  /** xyz per vertex, three vertices to a triangle (not shared: flat shading) */
  positions: Float32Array;
  uvs: Float32Array;
  /** rgb per vertex */
  colors: Float32Array;
  triangles: number;
}

/** What a vertex of the skin carries before it is placed. */
interface SkinVertex {
  x: number;
  y: number;
  z: number;
  /** the skin's colour multiplier there */
  r: number;
  g: number;
  b: number;
}

/** The skin's colour at a vertex: a cooler, paler stone toward the crown and a warmer, greyer one
 *  at the foot, dark in the hollows between facets, a little lichen on the ledges that face up. */
function skinColour(
  out: SkinVertex,
  height01: number,
  hollow: number,
  up: number,
  x: number,
  z: number,
): void {
  const warm = 1 - height01;
  let r = 0.96 + 0.05 * warm - 0.03 * height01;
  let g = 0.98 + 0.01 * warm;
  let b = 1.02 - 0.05 * warm + 0.04 * height01;
  const shade = 1 - 0.26 * hollow;
  r *= shade;
  g *= shade;
  b *= shade;
  // lichen: on the ledges that face up, in patches
  const patch = hash2(Math.floor(x / 2.6), Math.floor(z / 2.6), 0x11c4);
  const lichen = smooth(0.5, 0.85, up) * smooth(0.55, 0.8, patch) * 0.55;
  r = r * (1 - lichen) + 0.74 * lichen * shade;
  g = g * (1 - lichen) + 1.08 * lichen * shade;
  b = b * (1 - lichen) + 0.82 * lichen * shade;
  out.r = r;
  out.g = g;
  out.b = b;
}

/** True on the crown (the paved plaza) and on the approach ramp running south from the path's
 *  foot (the town's road onto the climb): ground the skin leaves alone. */
function crownOrApron(x: number, z: number): boolean {
  const dx = x - GYRE_PEAK.x;
  const dz = z - GYRE_PEAK.z;
  if (Math.hypot(dx, dz) <= GYRE_PEAK.endR - GYRE_PEAK.pathW / 2 + 1) return true;
  return (
    dz < -(GYRE_PEAK.startR + GYRE_PEAK.pathW / 2 - 3) && Math.abs(dx) <= GYRE_PEAK.pathW / 2 + 0.5
  );
}

/** Cut the skin over `groundAt` (the world's finished height). */
export function buildGyreRockSkin(groundAt: (x: number, z: number) => number): SkinGeometry {
  const cell = SKIN_CELL;
  const n = Math.round((2 * SKIN_REACH) / cell) + 1;
  const x0 = GYRE_PEAK.x - SKIN_REACH;
  const z0 = GYRE_PEAK.z - SKIN_REACH;
  const half = GYRE_PEAK.pathW / 2;
  const top = GYRE_PEAK.baseY + GYRE_PEAK.rise;

  // the ground, sampled where the skin can reach it and a ring beyond for the slopes
  const h = new Float32Array(n * n).fill(Number.NaN);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      if (Math.hypot(x - GYRE_PEAK.x, z - GYRE_PEAK.z) <= SKIN_REACH + 2 * cell) {
        h[j * n + i] = groundAt(x, z);
      }
    }
  }

  // how far each grid vertex is from the road's strip, yards (a two-pass chamfer over the grid),
  // so the skin ramps up from flush on both sides of the road, not just on it
  const roadDist = new Float32Array(n * n).fill(Number.POSITIVE_INFINITY);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      if (Math.hypot(x - GYRE_PEAK.x, z - GYRE_PEAK.z) > SKIN_REACH + 2 * cell) continue;
      if (gyrePathAt(x, z)) roadDist[j * n + i] = 0;
    }
  }
  const diag = Math.SQRT2 * cell;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let d = roadDist[j * n + i];
      if (i > 0) d = Math.min(d, roadDist[j * n + i - 1] + cell);
      if (j > 0) {
        d = Math.min(d, roadDist[(j - 1) * n + i] + cell);
        if (i > 0) d = Math.min(d, roadDist[(j - 1) * n + i - 1] + diag);
        if (i < n - 1) d = Math.min(d, roadDist[(j - 1) * n + i + 1] + diag);
      }
      roadDist[j * n + i] = d;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      let d = roadDist[j * n + i];
      if (i < n - 1) d = Math.min(d, roadDist[j * n + i + 1] + cell);
      if (j < n - 1) {
        d = Math.min(d, roadDist[(j + 1) * n + i] + cell);
        if (i < n - 1) d = Math.min(d, roadDist[(j + 1) * n + i + 1] + diag);
        if (i > 0) d = Math.min(d, roadDist[(j + 1) * n + i - 1] + diag);
      }
      roadDist[j * n + i] = d;
    }
  }

  // pass one, per grid vertex: how much skin it wears (none off the steep, off the peak's body or
  // on the road), the raw facet height it is pushed up by, and how its colour sits
  interface Worn {
    x: number;
    y: number;
    z: number;
    /** w * fade * flat * steep: how much of the facet height the vertex takes */
    gain: number;
    /** facets, fine facets and ledges, in yards of height */
    f: number;
    height01: number;
    up: number;
  }
  const worn: (Worn | null)[] = new Array(n * n).fill(null);
  const tint = { gyreRock: 0, gyreWay: 0, gyreCap: 0 };
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      if (Math.hypot(x - GYRE_PEAK.x, z - GYRE_PEAK.z) > SKIN_REACH) continue;
      const gx = (h[j * n + i + 1] - h[j * n + i - 1]) / (2 * cell);
      const gz = (h[(j + 1) * n + i] - h[(j - 1) * n + i]) / (2 * cell);
      if (!Number.isFinite(gx) || !Number.isFinite(gz)) continue;
      const y = h[j * n + i];
      const slope = Math.hypot(gx, gz);
      gyreGroundAt(x, z, tint);
      if (tint.gyreRock <= 0.004) continue;
      // the road's own strip is the paving's. The skin runs right up to its edge lying flush,
      // and a little way under it, so the paving's border never has bare ground beside it
      let tuck = false;
      const road = gyrePathAt(x, z);
      if (road) {
        const off = Math.abs(road.off);
        if (off < half - ROAD_TUCK) continue;
        if (off < half - 0.25) tuck = true;
      }
      const fade = smooth(0, ROAD_FADE, roadDist[j * n + i]);
      // inside the peak's own body the skin covers the ground whatever its slope (flush where it is
      // shallow, as a face's foot is beside the road), so no bare band is left along the road; the
      // crown's plaza and the approach ramp are not rock (their flat ground stays bare, but a
      // steep wall there, such as the start seam's step, is)
      const body = tint.gyreRock >= 0.9 && !(slope < SKIN_SLOPE_LO && crownOrApron(x, z));
      let w = smooth(SKIN_SLOPE_LO, SKIN_SLOPE_HI, slope) * tint.gyreRock;
      if (w <= 0.004 && !tuck && !body) continue;
      if (tuck) w = 0;
      const f =
        facetNoise(x, y, z, COARSE_CELL, COARSE_AMP, 0x6a1e) +
        facetNoise(x, y, z, FINE_CELL, FINE_AMP, 0x3b77) +
        ledgeProfile(x, y, z);
      // up by the lift and facets, more on a steeper face (a push of one along the normal is
      // 1 / cos of it in height); none on the seam's wall, which the skin only clothes
      const steep = 1 + 0.25 * Math.min(slope, 2.4);
      const flat = 1 - smooth(SEAM_SLOPE_LO, SEAM_SLOPE_HI, slope);
      worn[j * n + i] = {
        x,
        y,
        z,
        gain: w * fade * flat * steep,
        f,
        height01: Math.max(0, Math.min(1, (y - GYRE_PEAK.baseY) / (top - GYRE_PEAK.baseY))),
        up: 1 / Math.hypot(gx, 1, gz),
      };
    }
  }

  // pass two: the facet height is blurred over the worn neighbours (a binomial 1-2-1 each way), so
  // the hard steps between facets ramp over two cells and a steep face never grows spikes
  const placed: (SkinVertex | null)[] = new Array(n * n).fill(null);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const me = worn[j * n + i];
      if (!me) continue;
      let sum = 0;
      let wsum = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const o = worn[(j + dj) * n + i + di];
          if (!o) continue;
          const k = (2 - Math.abs(di)) * (2 - Math.abs(dj));
          sum += o.f * k;
          wsum += k;
        }
      }
      const f = sum / wsum;
      const dy = me.gain * Math.max(SKIN_MIN_STANDOFF, SKIN_LIFT + f);
      const v: SkinVertex = { x: me.x, y: me.y + dy, z: me.z, r: 1, g: 1, b: 1 };
      skinColour(v, me.height01, Math.max(0, Math.min(1, -f / 0.55)), me.up, me.x, me.z);
      placed[j * n + i] = v;
    }
  }

  // the cells: a quad is worn when all four of its corners are placed
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  let triangles = 0;
  const pushTri = (a: SkinVertex, b: SkinVertex, c: SkinVertex): void => {
    // the face's normal picks the projection: top-down on ledges, else along the wall; both read
    // right-handed (u x v lies along the face's normal), so no face shows the painting mirrored
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const top = Math.abs(ny) / nl >= 0.75;
    const alongX = Math.abs(nx) >= Math.abs(nz);
    // u runs to the viewer's right as seen from outside the face, so the painting is never
    // mirrored from one side of a crag to the other
    const sx = alongX ? (nx > 0 ? -1 : 1) : nz > 0 ? 1 : -1;
    for (const p of [a, b, c]) {
      pos.push(p.x, p.y, p.z);
      if (top) uv.push((ny >= 0 ? -p.x : p.x) / SKIN_TILE, p.z / SKIN_TILE);
      else if (alongX) uv.push((sx * p.z) / SKIN_TILE, p.y / SKIN_TILE);
      else uv.push((sx * p.x) / SKIN_TILE, p.y / SKIN_TILE);
      col.push(p.r, p.g, p.b);
    }
    triangles++;
  };
  for (let j = 1; j < n - 2; j++) {
    for (let i = 1; i < n - 2; i++) {
      const a = placed[j * n + i];
      const b = placed[j * n + i + 1];
      const c = placed[(j + 1) * n + i];
      const d = placed[(j + 1) * n + i + 1];
      if (!a || !b || !c || !d) continue;
      // alternate the diagonal so no grain runs the whole mountain
      if (hash2(i, j, 0x7d1a) < 0.5) {
        pushTri(a, c, b);
        pushTri(b, c, d);
      } else {
        pushTri(a, c, d);
        pushTri(a, d, b);
      }
    }
  }
  return {
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    colors: new Float32Array(col),
    triangles,
  };
}
