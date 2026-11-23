// Pure mesh plan for an authored open-air field (src/sim/instances/
// authored_field): the walkable tops of every surface and the cliff faces
// under every generated cliff run, as plain typed arrays the painter wraps in
// Three geometry. Heights come from the SAME sim records (the surfaces and
// their cliff runs), so what you see is what you stand on: every top vertex
// sits exactly on its surface, and the cliff tops meet the walkable edge.
//
// Three-free, DOM-free, deterministic (hash noise, no Math.random).

import {
  type AuthoredFieldDef,
  authoredFieldHeight,
  authoredFieldSurfaceAt,
  type FieldCliffRun,
  type FieldGround,
  type FieldSurface,
  surfaceOutline,
} from '../../sim/instances/authored_field';
import {
  pathHeightUnbounded,
  pathOutline,
  surfaceHeightAt,
} from '../../sim/instances/authored_field/height';
import type { FieldPathSurface } from '../../sim/instances/authored_field/types';
import {
  type PreparedClipper,
  prepareClipper,
  type Ring,
  ringBox,
  subtractAll,
} from './field_clip_core';
import { ownedSkirtRing } from './field_skirt_core';

export interface FieldMeshData {
  positions: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

export type Rgb = readonly [number, number, number];

/** Linear-ish colours per ground kind (the painter's vertex paint). */
export const FIELD_GROUND_COLORS: Readonly<Record<FieldGround, Rgb>> = {
  flagstone: [0.3, 0.29, 0.29],
  earth: [0.2, 0.16, 0.13],
  grave: [0.13, 0.11, 0.08],
  frost: [0.38, 0.43, 0.5],
  bone: [0.42, 0.39, 0.33],
  ritual: [0.2, 0.2, 0.24],
  mud: [0.16, 0.15, 0.12],
  wetstone: [0.23, 0.26, 0.26],
  quay: [0.3, 0.3, 0.28],
  shallows: [0.14, 0.14, 0.11],
  moss: [0.16, 0.2, 0.1],
  basalt: [0.17, 0.18, 0.17],
  // Steel works: blued steel deck plate, near-black bar grating, flagstone
  // under a film of soot.
  plate: [0.27, 0.28, 0.3],
  grating: [0.2, 0.2, 0.21],
  soot: [0.22, 0.21, 0.21],
  // Gravewyrm Sanctum: wind-packed snow (a cold white the blue hour turns
  // faintly blue), blue glacier and lake ice (cloudy, matte enough to read),
  // and the dark slate of Thornpeak. Each has its own painter below.
  snow: [0.66, 0.72, 0.8],
  ice: [0.3, 0.47, 0.6],
  slate: [0.2, 0.21, 0.235],
};

/** The texture families a walkable top draws with (one mesh each). */
export const FIELD_TOP_FAMILIES = [
  'stone',
  'soil',
  'moss',
  'basalt',
  'plate',
  'grating',
  'snow',
  'ice',
  'slate',
] as const;
export type FieldTopFamily = (typeof FIELD_TOP_FAMILIES)[number];

/** Texture repeats per yard of a top family (most tile every 4 yd; the
 *  slate flags are drawn at a plate's real size, one tile every 12 yd). */
export function fieldFamilyUvScale(family: FieldTopFamily): number {
  return family === 'slate' ? 1 / 12 : 0.25;
}

/** Which texture family a ground kind draws with. */
export function fieldGroundFamily(ground: FieldGround): FieldTopFamily {
  if (ground === 'moss') return 'moss';
  if (ground === 'basalt') return 'basalt';
  // The Gravewyrm Sanctum's grounds: each its own texture family.
  if (ground === 'snow') return 'snow';
  if (ground === 'ice') return 'ice';
  if (ground === 'slate') return 'slate';
  if (ground === 'plate') return 'plate';
  if (ground === 'grating') return 'grating';
  return ground === 'earth' ||
    ground === 'grave' ||
    ground === 'frost' ||
    ground === 'mud' ||
    ground === 'shallows'
    ? 'soil'
    : 'stone';
}

// ---- deterministic noise ----------------------------------------------------

function hash2(x: number, z: number): number {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const w = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

/** Fractal value noise in [0, 1). */
export function fieldNoise(x: number, z: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// ---- polygon triangulation --------------------------------------------------

function signedArea(pts: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  }
  return a / 2;
}

function pointInTri(
  px: number,
  pz: number,
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): boolean {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (pz - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (pz - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (pz - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Ear-clipping triangulation of a simple polygon: index triples into `pts`. */
export function triangulatePolygon(pts: readonly (readonly [number, number])[]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  // Work with a positive shoelace area so a convex corner has a positive cross.
  const order = Array.from({ length: n }, (_, i) => i);
  if (signedArea(pts) < 0) order.reverse();
  const out: number[] = [];
  let guard = 0;
  while (order.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < order.length; i++) {
      const ia = order[(i + order.length - 1) % order.length];
      const ib = order[i];
      const ic = order[(i + 1) % order.length];
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-9) continue; // reflex or degenerate
      let inside = false;
      for (const k of order) {
        if (k === ia || k === ib || k === ic) continue;
        if (pointInTri(pts[k][0], pts[k][1], a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      out.push(ia, ib, ic);
      order.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (order.length === 3) out.push(order[0], order[1], order[2]);
  return out;
}

// ---- walkable tops ------------------------------------------------------------

/** Height a surface gives at (x, z), extended past its band for paths (the
 *  outline's own vertices sit exactly on the edge, where containment is
 *  ambiguous), so every top vertex gets its surface's own height: the sim's
 *  own function, so the drawn ramp is the walked ramp. */
export function surfaceTopHeight(s: FieldSurface, x: number, z: number): number {
  if (s.kind !== 'path') return s.h;
  return pathHeightUnbounded(s, x, z);
}

interface Tri {
  a: [number, number];
  b: [number, number];
  c: [number, number];
}

function subdivide(tri: Tri, maxEdge: number, out: Tri[], depth = 0): void {
  const ab = Math.hypot(tri.a[0] - tri.b[0], tri.a[1] - tri.b[1]);
  const bc = Math.hypot(tri.b[0] - tri.c[0], tri.b[1] - tri.c[1]);
  const ca = Math.hypot(tri.c[0] - tri.a[0], tri.c[1] - tri.a[1]);
  if (Math.max(ab, bc, ca) <= maxEdge || depth > 9) {
    out.push(tri);
    return;
  }
  const mid = (p: [number, number], q: [number, number]): [number, number] => [
    (p[0] + q[0]) / 2,
    (p[1] + q[1]) / 2,
  ];
  // Split across the longest edge: no slivers, and neighbours sharing that
  // edge split it at the same midpoint.
  if (ab >= bc && ab >= ca) {
    const m = mid(tri.a, tri.b);
    subdivide({ a: tri.a, b: m, c: tri.c }, maxEdge, out, depth + 1);
    subdivide({ a: m, b: tri.b, c: tri.c }, maxEdge, out, depth + 1);
  } else if (bc >= ca) {
    const m = mid(tri.b, tri.c);
    subdivide({ a: tri.a, b: tri.b, c: m }, maxEdge, out, depth + 1);
    subdivide({ a: tri.a, b: m, c: tri.c }, maxEdge, out, depth + 1);
  } else {
    const m = mid(tri.c, tri.a);
    subdivide({ a: tri.a, b: tri.b, c: m }, maxEdge, out, depth + 1);
    subdivide({ a: m, b: tri.b, c: tri.c }, maxEdge, out, depth + 1);
  }
}

/** Longest edge of a drawn circle's ring. The sim's circle is exact; a ring
 *  this fine keeps the drawn rim within a hundredth of a yard of it (the sim's
 *  own 5 yd ring only lays out the cliff colliders). */
export const RENDER_CIRCLE_EDGE = 1.5;

/** The outline the renderer draws a surface with: the sim outline, with a
 *  circle refined to RENDER_CIRCLE_EDGE so its drawn rim hugs the true circle. */
export function renderOutline(s: FieldSurface): [number, number][] {
  if (s.kind !== 'circle') return surfaceOutline(s);
  const n = Math.max(24, Math.ceil((2 * Math.PI * s.r) / RENDER_CIRCLE_EDGE));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([s.x + Math.cos(a) * s.r, s.z + Math.sin(a) * s.r]);
  }
  return out;
}

/** A path band as quads between its mitred cross-sections, split down to
 *  `maxEdge`. Each quad spans exactly one centreline segment, so the linear
 *  height along it is reproduced exactly (an ear-clipped band stretched
 *  triangles across the flat-to-ramp kinks and bowed the stairs). */
function pathStripTris(s: FieldPathSurface, maxEdge: number): Tri[] {
  const ring = pathOutline(s);
  const n = s.points.length;
  const lerp = (p: [number, number], q: [number, number], t: number): [number, number] => [
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
  ];
  const out: Tri[] = [];
  const across = Math.max(1, Math.ceil((2 * s.halfWidth) / maxEdge));
  for (let i = 0; i + 1 < n; i++) {
    const l0 = ring[i];
    const l1 = ring[i + 1];
    const r0 = ring[2 * n - 1 - i];
    const r1 = ring[2 * n - 2 - i];
    const span = Math.max(
      Math.hypot(l1[0] - l0[0], l1[1] - l0[1]),
      Math.hypot(r1[0] - r0[0], r1[1] - r0[1]),
    );
    // A rising segment is split finer, so the drawn ramp follows the walked
    // blend between its two cross-sections to well under a hand.
    const rise = Math.abs(s.points[i + 1][2] - s.points[i][2]);
    const along = Math.max(1, Math.ceil(span / maxEdge), Math.ceil(rise / 0.35));
    const at = (u: number, v: number): [number, number] =>
      lerp(lerp(l0, r0, v), lerp(l1, r1, v), u);
    for (let a = 0; a < along; a++) {
      for (let b = 0; b < across; b++) {
        const p00 = at(a / along, b / across);
        const p10 = at((a + 1) / along, b / across);
        const p01 = at(a / along, (b + 1) / across);
        const p11 = at((a + 1) / along, (b + 1) / across);
        out.push({ a: p00, b: p10, c: p11 }, { a: p00, b: p11, c: p01 });
      }
    }
  }
  return out;
}

/** The fine triangles covering a surface's drawn outline, before clipping. */
function surfaceTris(s: FieldSurface, maxEdge: number): Tri[] {
  if (s.kind === 'path') return pathStripTris(s, maxEdge);
  const ring = renderOutline(s);
  const tris = triangulatePolygon(ring);
  const fine: Tri[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    subdivide(
      {
        a: [ring[tris[i]][0], ring[tris[i]][1]],
        b: [ring[tris[i + 1]][0], ring[tris[i + 1]][1]],
        c: [ring[tris[i + 2]][0], ring[tris[i + 2]][1]],
      },
      maxEdge,
      fine,
    );
  }
  return fine;
}

/**
 * For each surface, the later drawn surfaces that overlap it, prepared as
 * clippers: the sim gives the ground under a point to the LAST surface that
 * contains it, so a surface is drawn only outside every later one. A hidden
 * surface (the drawbridge that exists once lowered) never cuts the ground
 * under it, so that ground stays drawn while the bridge is raised.
 */
export function laterClippers(def: AuthoredFieldDef): PreparedClipper[][] {
  const rings = def.surfaces.map((s) => renderOutline(s));
  const boxes = rings.map((r) => ringBox(r));
  const prepared = new Map<number, PreparedClipper>();
  return def.surfaces.map((s, i) => {
    const out: PreparedClipper[] = [];
    if (s.hidden) return out;
    const box = boxes[i];
    for (let j = i + 1; j < def.surfaces.length; j++) {
      if (def.surfaces[j].hidden) continue;
      const b = boxes[j];
      if (b.minX >= box.maxX || box.minX >= b.maxX || b.minZ >= box.maxZ || box.minZ >= b.maxZ) {
        continue;
      }
      let c = prepared.get(j);
      if (!c) {
        c = prepareClipper(rings[j], triangulatePolygon);
        prepared.set(j, c);
      }
      out.push(c);
    }
    return out;
  });
}

export interface FieldTopOptions {
  /** Longest triangle edge on the walkable tops (yards). */
  maxEdge: number;
  /** Each later surface floats this much above the one before (a z-fight
   *  guard; 0 is right now the tops are clipped and never overlap). */
  layerLift: number;
}

/** Vertex paint of a walkable top: ground colour, broad mottling, grit. */
export function topColor(ground: FieldGround, x: number, z: number, onPath: boolean): Rgb {
  const base = FIELD_GROUND_COLORS[ground];
  const broad = fieldNoise(x * 0.045, z * 0.045, 3);
  const grit = hash2(Math.floor(x * 1.7), Math.floor(z * 1.7));
  let k = 0.62 + broad * 0.7 + (grit - 0.5) * 0.1;
  if (onPath) k *= 1.1;
  // Patches: cold moss on the stone in the damp hollows, grave dirt and
  // bone dust drifted across it, so no two stretches read alike.
  const patch = fieldNoise(x * 0.11 + 13, z * 0.11 - 7, 2);
  // Sea-worn stone carries more algae, and it creeps further.
  const damp = ground === 'wetstone' || ground === 'quay';
  const moss =
    ground === 'flagstone' || ground === 'bone' || damp
      ? Math.max(0, patch - (damp ? 0.5 : 0.58)) * (damp ? 2.2 : 1.8)
      : 0;
  const dirt = Math.max(0, fieldNoise(x * 0.07 - 3, z * 0.07 + 5, 2) - 0.6) * 1.6;
  if (ground === 'moss') return mossColor(base, k, patch, dirt);
  if (ground === 'basalt') return basaltColor(base, k, patch);
  if (ground === 'plate' || ground === 'grating' || ground === 'soot')
    return sootColor(base, k, patch, dirt, ground === 'grating');
  if (ground === 'snow') return snowColor(base, x, z, onPath);
  if (ground === 'ice') return iceColor(base, x, z);
  if (ground === 'slate') return slateColor(base, k, x, z, onPath);
  const r = base[0] * k * (1 - moss * 0.35) * (1 - dirt * 0.25) + dirt * 0.05;
  const g = base[1] * k * (1 - moss * 0.05) * (1 - dirt * 0.3) + dirt * 0.035;
  const b = base[2] * k * (1 - moss * 0.3) * (1 - dirt * 0.45) + dirt * 0.02;
  return [r, g, b];
}

/** Jungle moss: bright sunlit cushions, darker damp loam showing through,
 *  never one flat green (the patches and the dirt fields break it up). */
function mossColor(base: Rgb, k: number, patch: number, dirt: number): Rgb {
  const lush = Math.max(0, patch - 0.45) * 1.6;
  const loam = Math.min(1, dirt * 1.4);
  return [
    base[0] * k * (1 + lush * 0.25) * (1 - loam * 0.2) + loam * 0.05,
    base[1] * k * (1 + lush * 0.45) * (1 - loam * 0.35) + loam * 0.03,
    base[2] * k * (1 - lush * 0.2) * (1 - loam * 0.3) + loam * 0.015,
  ];
}

/** Wet basalt: near-black with a cool cast, a few mossy seams where it is
 *  damp and dry grey crowns where the sun dries it. */
function basaltColor(base: Rgb, k: number, patch: number): Rgb {
  const seam = Math.max(0, patch - 0.6) * 1.8;
  const dry = Math.max(0, 0.35 - patch) * 1.2;
  return [
    base[0] * k * (1 - seam * 0.25 + dry * 0.35),
    base[1] * k * (1 + seam * 0.35 + dry * 0.3),
    base[2] * k * (1.06 - seam * 0.3 + dry * 0.25),
  ];
}

/** Steel-works floors: soot pooled in drifts, oil-dark stains, and the odd
 *  bright worn track where boots and carts polish the metal. */
function sootColor(base: Rgb, k: number, patch: number, dirt: number, grating: boolean): Rgb {
  const soot = Math.min(1, Math.max(0, patch - 0.5) * 2.2);
  const worn = grating ? 0 : Math.max(0, 0.32 - patch) * 1.4;
  const oil = Math.min(1, dirt * 1.2);
  const t = k * (1 - soot * 0.45) * (1 - oil * 0.3) + worn * 0.18;
  return [base[0] * t + oil * 0.012, base[1] * t + oil * 0.01, base[2] * t * (1 + worn * 0.1)];
}

/** Wind-packed snow: a cold white, bluer in the hollows where the dusk sky
 *  is all the light it gets, long wind-scoured streaks of harder crust, and
 *  (on a path) the trodden, greyer trail down the middle. Never dirty. */
function snowColor(base: Rgb, x: number, z: number, onPath: boolean): Rgb {
  const swell = fieldNoise(x * 0.05, z * 0.05, 3);
  // Long streaks along the prevailing wind (from the west).
  const scour = fieldNoise(x * 0.02, z * 0.16 + x * 0.015, 2);
  const crust = Math.max(0, scour - 0.54) * 2.6;
  // Mid-distance wind ripples: drifts a few yards apart across the wind.
  const ripple = fieldNoise(x * 0.09 + z * 0.02, z * 0.35, 2);
  const lee = Math.max(0, ripple - 0.55) * 1.6;
  const hollow = Math.max(0, 0.45 - swell) * 1.8;
  const k = 0.9 + swell * 0.18 + (hash2(Math.floor(x * 2.3), Math.floor(z * 2.3)) - 0.5) * 0.03;
  const trodden = onPath ? 0.08 : 0;
  return [
    base[0] * k * (1 - hollow * 0.22 - trodden - lee * 0.1) - crust * 0.03,
    base[1] * k * (1 - hollow * 0.12 - trodden * 0.8 - lee * 0.06) - crust * 0.01,
    base[2] * k * (1 + hollow * 0.04 - trodden * 0.5) + crust * 0.03,
  ];
}

/** Glacier and lake ice: cloudy blue with paler drifts of powder snow over
 *  it and darker clear patches where the eye sees down into the ice. Matte
 *  paint: the depth reads from the tone, never from a mirror. */
function iceColor(base: Rgb, x: number, z: number): Rgb {
  const cloud = fieldNoise(x * 0.06 + 31, z * 0.06 - 17, 3);
  const powder = Math.max(0, fieldNoise(x * 0.12 - 5, z * 0.035 + 9, 2) - 0.55) * 2.4;
  const clear = Math.max(0, 0.38 - cloud) * 2.2;
  const k = 0.85 + cloud * 0.35;
  return [
    base[0] * k * (1 - clear * 0.35) + powder * 0.3,
    base[1] * k * (1 - clear * 0.18) + powder * 0.28,
    base[2] * k * (1 + clear * 0.05) + powder * 0.25,
  ];
}

/** Thornpeak slate: blue-black plates, a rusty stain where water stands,
 *  rime and old snow caught in the lee patches; trodden paths a shade paler
 *  where boots have scraped the rime off. */
function slateColor(base: Rgb, k: number, x: number, z: number, onPath: boolean): Rgb {
  const rust = Math.max(0, fieldNoise(x * 0.05 + 7, z * 0.05 - 3, 2) - 0.7) * 1.6;
  const rime = Math.max(0, fieldNoise(x * 0.07 - 11, z * 0.03 + 4, 2) - 0.62) * 1.8;
  const t = k * (onPath ? 1.08 : 1);
  return [
    base[0] * t + rust * 0.05 + rime * 0.32,
    base[1] * t + rust * 0.025 + rime * 0.36,
    base[2] * t + rust * 0.012 + rime * 0.42,
  ];
}

function pushVertex(
  out: FieldMeshData,
  x: number,
  y: number,
  z: number,
  color: Rgb,
  uvScale: number,
): number {
  const index = out.positions.length / 3;
  out.positions.push(x, y, z);
  out.colors.push(color[0], color[1], color[2]);
  out.uvs.push(x * uvScale, z * uvScale);
  return index;
}

/**
 * The walkable tops of the field, one batch per texture family. Each surface
 * is its outline triangulated (a path as strips along its segments) and split
 * down to `maxEdge`, then clipped to where it owns the ground (laterClippers),
 * so the drawn floor is the floor the sim stands a body on, everywhere.
 */
export function planFieldTops(
  def: AuthoredFieldDef,
  opts: FieldTopOptions,
): Record<FieldTopFamily, FieldMeshData> {
  const out: Record<FieldTopFamily, FieldMeshData> = {
    stone: { positions: [], colors: [], uvs: [], indices: [] },
    soil: { positions: [], colors: [], uvs: [], indices: [] },
    moss: { positions: [], colors: [], uvs: [], indices: [] },
    basalt: { positions: [], colors: [], uvs: [], indices: [] },
    plate: { positions: [], colors: [], uvs: [], indices: [] },
    grating: { positions: [], colors: [], uvs: [], indices: [] },
    snow: { positions: [], colors: [], uvs: [], indices: [] },
    ice: { positions: [], colors: [], uvs: [], indices: [] },
    slate: { positions: [], colors: [], uvs: [], indices: [] },
  };
  const clippers = laterClippers(def);
  def.surfaces.forEach((s, layer) => {
    if (s.hidden) return;
    const ground: FieldGround = s.ground ?? (s.kind === 'path' ? 'flagstone' : 'earth');
    const batch = out[fieldGroundFamily(ground)];
    const uvScale = fieldFamilyUvScale(fieldGroundFamily(ground));
    const lift = layer * opts.layerLift;
    const onPath = s.kind === 'path';
    const emit = (p: readonly [number, number]): void => {
      const y = surfaceTopHeight(s, p[0], p[1]) + lift;
      batch.indices.push(
        pushVertex(batch, p[0], y, p[1], topColor(ground, p[0], p[1], onPath), uvScale),
      );
    };
    const cut = clippers[layer];
    for (const t of surfaceTris(s, opts.maxEdge)) {
      const tri: Ring = [t.a, t.b, t.c];
      const pieces = cut.length > 0 ? subtractAll(tri, cut) : [tri];
      for (const piece of pieces) {
        // Every piece is convex: fan it from its first corner.
        for (let k = 1; k + 1 < piece.length; k++) {
          const a = piece[0];
          let b = piece[k];
          let c = piece[k + 1];
          // Wound to face up (+Y) seen from above.
          if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) {
            const swap = b;
            b = c;
            c = swap;
          }
          emit(a);
          emit(b);
          emit(c);
        }
      }
    }
  });
  return out;
}

/**
 * The drawn walkable top at (x, z): the highest top triangle over the point,
 * or NaN where none is drawn. A brute-force reader for tests and tools (the
 * floor-height sweep holds it against the sim's height across a whole field).
 */
export function drawnTopAt(tops: FieldMeshData, x: number, z: number): number {
  const p = tops.positions;
  let best = Number.NaN;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i];
    const az = p[i + 2];
    const bx = p[i + 3];
    const bz = p[i + 5];
    const cx = p[i + 6];
    const cz = p[i + 8];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) continue;
    const y = l1 * p[i + 1] + l2 * p[i + 4] + l3 * p[i + 7];
    if (!(y <= best)) best = y;
  }
  return best;
}

// ---- cliff faces ------------------------------------------------------------------

export interface FieldCliffOptions {
  /** Where a drop into the void bottoms out (below the mist). */
  voidFloor: number;
  /** Horizontal and vertical sampling of a face (yards). */
  columnStep: number;
  rowStep: number;
  /** How far a face bulges out per yard of depth below its top (massif flare). */
  flare: number;
  /** Surfaces whose drop into the void stops `depth` yards under their top
   *  (open air under a catwalk; the dungeon draws its own trusses there). */
  shallow?: { surfaces: ReadonlySet<string>; depth: number };
  /** The faces' vertex paint (default `cliffColor`). */
  paint?: CliffPaint;
  /** Texture repeats per yard on the faces (default 0.12). */
  uvScale?: number;
}

/** A glacier wall's texture repeats per yard (one 512 px tile every 20 yd:
 *  flutes a few yards wide, bands a few yards apart). */
export const GLACIER_CLIFF_UV = 0.05;

/** A cliff face's vertex paint at (x, y, z) under a lip at height `top`. */
export type CliffPaint = (run: FieldCliffRun, x: number, y: number, z: number, top: number) => Rgb;

/** Cliff rock tint: cold strata banding, darker with depth. */
export function cliffColor(run: FieldCliffRun, x: number, y: number, z: number, top: number): Rgb {
  const depth = Math.max(0, top - y);
  const strata = 0.5 + 0.5 * Math.sin(y * 1.9 + fieldNoise(x * 0.1, z * 0.1, 2) * 6);
  const n = fieldNoise(x * 0.3 + y * 0.2, z * 0.3 - y * 0.15, 3);
  // Dark basalt under a bright moon: the faces must stay well below the lit
  // terraces so the walkable tops read first, and sink fast into the mist.
  const dark = Math.max(0.25, 1 - depth / 40);
  const masonry = run.style === 'masonry' || run.style === 'balustrade';
  const base: Rgb = masonry && depth < 3.2 ? [0.34, 0.32, 0.3] : [0.19, 0.18, 0.2];
  const k = (0.7 + strata * 0.18 + n * 0.3) * dark;
  return [base[0] * k, base[1] * k, base[2] * k * 1.05];
}

/** The depth a glacier crevasse's paint darkens toward (the Gravewyrm
 *  Sanctum's crevasse void; its faces run on down past it). */
export const GLACIER_CREVASSE_VOID = -60;

/** How far under its lip a glacier wall's rock band reaches at (x, y, z). */
function glacierRockBand(x: number, y: number, z: number): number {
  return 2.2 + fieldNoise(x * 0.21 + y * 0.05, z * 0.21 - y * 0.04, 3) * 3.4;
}

/**
 * A glacier crevasse wall (the Gravewyrm Sanctum): the terrace's lip is a
 * dark slate band crusted with rime for its top few yards, snow caught on
 * the ledges of the band, then clear glacier ice that deepens from a bright
 * cold blue just under the rock through deep ice to near-black blue at the
 * crevasse depth. Horizontal annual layers run through the ice (pale
 * bubble-rich bands and dark clear bands that wander a little) and vertical
 * meltwater streaks run down it. Never grey, never a mist or water colour:
 * the drop reads as ice going down.
 */
export function glacierCliffColor(
  run: FieldCliffRun,
  x: number,
  y: number,
  z: number,
  top: number,
): Rgb {
  const depth = Math.max(0, top - y);
  const n = fieldNoise(x * 0.21 + y * 0.05, z * 0.21 - y * 0.04, 3);
  const band = glacierRockBand(x, y, z);
  if (depth < band) {
    const ledge = Math.max(0, Math.sin(y * 2.6 + n * 5) - 0.55) * 2.2;
    const rime = Math.max(0, fieldNoise(x * 0.4, z * 0.4 + y * 0.6, 2) - 0.58) * 2.4;
    const masonry = run.style === 'masonry' || run.style === 'balustrade';
    const rock: Rgb = masonry ? [0.2, 0.205, 0.22] : [0.085, 0.09, 0.105];
    const snow = Math.min(1, ledge * 0.7 + rime * 0.55);
    const k = 0.8 + n * 0.4;
    return [
      rock[0] * k + (0.62 - rock[0] * k) * snow,
      rock[1] * k + (0.68 - rock[1] * k) * snow,
      rock[2] * k + (0.78 - rock[2] * k) * snow,
    ];
  }
  const t = glacierDepthShare(depth - band, top);
  const ice = glacierIceRamp(t);
  const fade = 1 - Math.max(0, t * 1.6 - 0.6);
  // Large zones: milky bubble-rich ice (paler, whiter) against clear ice
  // (deeper, more saturated), tens of yards across.
  const zone = fieldNoise(x * 0.035 + y * 0.01, z * 0.035 - y * 0.012, 2);
  const milky = Math.max(0, zone - 0.55) * 2.2 * fade;
  const clear = Math.max(0, 0.42 - zone) * 2;
  // Annual bands: a few yards apart, wandering up and down along the wall.
  const wander = fieldNoise(x * 0.025, z * 0.025, 2) * 14;
  const layer = Math.sin((y + wander) * 0.55) * 0.6 + Math.sin((y + wander) * 0.21 + 1.7) * 0.4;
  const pale = Math.max(0, layer - 0.6) * 1.5 * fade;
  const dark = Math.max(0, -layer - 0.62) * 0.45;
  // Flutes: broad vertical runs of wet ice a few yards wide.
  const flute = Math.max(0, fieldNoise(x * 0.14 + z * 0.14, y * 0.012, 2) - 0.58) * 2 * fade;
  // Sparse dark fissures.
  const fissure =
    Math.max(0, 0.035 - Math.abs(fieldNoise(x * 0.06 - z * 0.05, y * 0.03, 2) - 0.5)) * 18;
  const lift = pale * 0.18 + flute * 0.1 + milky * 0.16;
  const k = (1 - dark) * (1 - Math.min(0.6, fissure)) * (0.94 + clear * 0.08);
  return [
    ice[0] * k * (1 - clear * 0.25) + lift * 0.55,
    ice[1] * k * (1 - clear * 0.08) + lift * 0.8,
    ice[2] * k + lift,
  ];
}

/** How far down the ice a point is, 0 just under the rock band to 1 at the
 *  crevasse depth (yards into the ice over the lip's height above the void). */
export function glacierDepthShare(intoIce: number, top: number): number {
  const reach = Math.max(1, top - GLACIER_CREVASSE_VOID);
  return Math.max(0, Math.min(1, intoIce / reach));
}

/** The glacier wall's ice colour at a depth share (0..1): bright cold blue,
 *  deep blue, then near-black blue. Monotone darker with depth. */
export function glacierIceRamp(t: number): Rgb {
  const bright: Rgb = [0.22, 0.48, 0.66];
  const deep: Rgb = [0.03, 0.12, 0.26];
  const black: Rgb = [0.006, 0.018, 0.05];
  const u = Math.min(1, Math.max(0, t) * 1.6);
  const w = Math.min(1, Math.max(0, t * 1.6 - 0.6));
  const r = bright[0] + (deep[0] - bright[0]) * u;
  const g = bright[1] + (deep[1] - bright[1]) * u;
  const b = bright[2] + (deep[2] - bright[2]) * u;
  return [r + (black[0] - r) * w, g + (black[1] - g) * w, b + (black[2] - b) * w];
}

/** Densify a closed ring so no edge is longer than `step`. */
function densify(ring: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/**
 * The kerb where a later, lower surface is cut into an earlier, higher one
 * (the moat ring sunk into the Lower Bailey, the Sea Gate ramp cut into its
 * lip): a straight face from the lower floor up to the higher floor's cut
 * edge, dressed in the higher surface's style. A higher terrace that merely
 * abuts a lower one draws that face as its own skirt, so a riser is laid only
 * where the higher surface also covers the ground just inside this outline.
 */
function planRisers(
  def: AuthoredFieldDef,
  index: number,
  ring: [number, number][],
  out: FieldMeshData,
  paint: CliffPaint,
): void {
  const s = def.surfaces[index];
  const n = ring.length;
  const rise: number[] = new Array(n).fill(0);
  const tops: number[] = new Array(n).fill(0);
  const styles: (FieldCliffRun['style'] | null)[] = new Array(n).fill(null);
  let any = false;
  for (let i = 0; i < n; i++) {
    const [px, pz] = ring[(i + n - 1) % n];
    const [x, z] = ring[i];
    const [qx, qz] = ring[(i + 1) % n];
    let nx = qz - z + (z - pz);
    let nz = -(qx - x) - (x - px);
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    const top = surfaceTopHeight(s, x, z);
    tops[i] = top;
    const probe = 0.05;
    const high = authoredFieldSurfaceAt(def, x + nx * probe, z + nz * probe);
    if (!high || high === s || high.hidden) continue;
    const highIndex = def.surfaces.indexOf(high);
    if (highIndex > index) continue;
    if (Number.isNaN(surfaceHeightAt(high, x - nx * probe, z - nz * probe))) continue;
    const h = surfaceTopHeight(high, x, z);
    if (h <= top + 0.02) continue;
    rise[i] = h - top;
    styles[i] = high.edge ?? 'rock';
    any = true;
  }
  if (!any) return;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (rise[i] <= 0 && rise[j] <= 0) continue;
    const style = styles[i] ?? styles[j] ?? 'masonry';
    const run = { style } as FieldCliffRun;
    const base = out.positions.length / 3;
    for (const k of [i, j]) {
      const [x, z] = ring[k];
      const lo = tops[k];
      const hi = tops[k] + rise[k];
      for (const y of [lo, hi]) {
        const c = paint(run, x, y, z, hi);
        out.positions.push(x, y, z);
        out.colors.push(c[0], c[1], c[2]);
        out.uvs.push((x + z) * 0.12, y * 0.12);
      }
    }
    // base: i-lo, i-hi, j-lo, j-hi.
    out.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}

/** The longest outward flare (up to `push`) that keeps a skirt vertex at
 *  height `y`, and the faces it shares with its neighbours `side` yards
 *  either way along the outline, from standing over a walkable floor they
 *  would rise through. */
function flareClear(
  def: AuthoredFieldDef,
  ex: number,
  ez: number,
  n: readonly [number, number],
  y: number,
  push: number,
  side: number,
): number {
  const clear = (x: number, z: number): boolean => {
    const floor = authoredFieldHeight(def, x, z);
    return floor <= def.voidHeight + 0.5 || y < floor - 0.5;
  };
  let p = push;
  for (let k = 0; k < 5; k++) {
    const x = ex + n[0] * p;
    const z = ez + n[1] * p;
    if (
      clear(x, z) &&
      clear(x - n[1] * side, z + n[0] * side) &&
      clear(x + n[1] * side, z - n[0] * side)
    )
      return p;
    p *= 0.5;
  }
  return 0;
}

/**
 * The rock under every surface: its outline dropped as one closed skirt, pinned
 * at the walkable edge (the wall you collide with is the wall you see), straight
 * where it steps down onto a lower terrace, and flaring into a jagged massif
 * where it falls into the chasm, so each terrace reads as the top of a crag.
 */
export function planFieldCliffs(def: AuthoredFieldDef, opts: FieldCliffOptions): FieldMeshData {
  const out: FieldMeshData = { positions: [], colors: [], uvs: [], indices: [] };
  const paint = opts.paint ?? cliffColor;
  const uv = opts.uvScale ?? 0.12;
  for (let index = 0; index < def.surfaces.length; index++) {
    const s = def.surfaces[index];
    if (s.hidden) continue;
    let ring = densify(renderOutline(s), opts.columnStep);
    if (signedArea(ring) < 0) ring = ring.reverse();
    planRisers(def, index, ring, out, paint);
    // The skirt stands only where this surface owns the ground inside its
    // outline: a later surface across it (a stair cut down through the lip)
    // draws its own sides there (field_skirt_core.ts).
    const skirt = ownedSkirtRing(def, index, ring);
    ring = skirt.ring;
    const shallow = opts.shallow?.surfaces.has(s.id) ? opts.shallow.depth : 0;
    const n = ring.length;
    const tops: number[] = [];
    const bottoms: number[] = [];
    const normals: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const [px, pz] = ring[(i + n - 1) % n];
      const [x, z] = ring[i];
      const [qx, qz] = ring[(i + 1) % n];
      // Outward normal of a counter-clockwise ring (shoelace-positive in x, z).
      let nx = qz - z + (z - pz);
      let nz = -(qx - x) - (x - px);
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      normals.push([nx, nz]);
      const top = surfaceTopHeight(s, x, z);
      tops.push(top);
      if (!skirt.owned[i]) {
        bottoms.push(top);
        continue;
      }
      const outside = authoredFieldHeight(def, x + nx * 0.8, z + nz * 0.8);
      const open = outside <= def.voidHeight + 0.5;
      bottoms.push(
        open && shallow ? top - shallow : open ? opts.voidFloor : Math.min(top, outside) - 0.4,
      );
    }
    const drop = Math.max(...tops.map((t, i) => t - bottoms[i]));
    if (drop < 0.3) continue;
    const rows = Math.max(1, Math.ceil(drop / opts.rowStep));
    const base = out.positions.length / 3;
    const style = s.edge ?? 'rock';
    const masonry = style === 'masonry' || style === 'balustrade';
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      for (let i = 0; i <= n; i++) {
        const k = i % n;
        const [ex, ez] = ring[k];
        const top = tops[k];
        const y = top + (bottoms[k] - top) * t;
        const depth = top - y;
        const intoVoid = bottoms[k] <= opts.voidFloor + 0.01;
        const straight = r === 0 || !intoVoid || (masonry && depth < 3.2);
        const jag = straight
          ? 0
          : (fieldNoise(ex * 0.35 + y * 0.21, ez * 0.35 - y * 0.17, 3) - 0.3) * 2.6;
        const flare = straight ? 0 : Math.max(0, depth * opts.flare + jag);
        // The massif never flares out over a neighbouring walkable floor at
        // or below the rock's height (it would stand through that floor's
        // walk): it pulls back toward its own lip there.
        const push =
          flare > 0 ? flareClear(def, ex, ez, normals[k], y, flare, opts.columnStep * 0.6) : 0;
        const x = ex + normals[k][0] * push;
        const z = ez + normals[k][1] * push;
        const run = { style } as FieldCliffRun;
        const c = paint(run, ex, y, ez, top);
        out.positions.push(x, y, z);
        out.colors.push(c[0], c[1], c[2]);
        out.uvs.push(i * opts.columnStep * uv, y * uv);
      }
    }
    const stride = n + 1;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < n; i++) {
        // No face between two left-out columns (a later surface's ground).
        if (!skirt.owned[i] && !skirt.owned[(i + 1) % n]) continue;
        const i0 = base + r * stride + i;
        const i1 = i0 + 1;
        const i2 = i0 + stride;
        const i3 = i2 + 1;
        out.indices.push(i0, i1, i2, i1, i3, i2);
      }
    }
  }
  return out;
}
