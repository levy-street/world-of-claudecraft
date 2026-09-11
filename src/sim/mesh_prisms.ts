// Collision Master mesh -> banded convex prisms.
//
// The maker models real triangle volumes in Collision Master and the editor
// draws those volumes as the blue collision outline. The sim, however, can only
// collide against a small set of primitives, so the authored mesh has to be
// re-expressed in them. Fitting ONE yawed rectangle per Y band (the old
// meshToHitboxes path) is a poor re-expression: measured over the shipped
// override table it put 10.6% of the collider volume OUTSIDE the drawn shape
// (61% on the worst rock) - an invisible wall short of the thing you modeled,
// which is what "the collision does not match Collision Master" feels like in
// game.
//
// A PRISM is the honest primitive: the band's own convex section outline,
// extruded over the band. A box is just a 4-gon prism, so nothing is lost, and
// round/hexagonal/angled sections stop being approximated at all. What is left
// is purely vertical discretization, so the bands are chosen ADAPTIVELY: a band
// splits only while its outline over-covers its own mid-height section, which
// means a straight-sided volume (box, cylinder, wall) stays ONE prism while a
// taper or dome spends its bands where the shape actually changes.
//
// Pure math: sim layer, no DOM/three, deterministic, so the editor derive, the
// playtest projection and the node scripts all agree.

/** Source geometry: flat xyz vertex triplets + index triplets (model space). */
export interface PrismSourceMesh {
  readonly verts: readonly number[];
  readonly tris: readonly number[];
  /** Walkable deck volumes are handled by placement_ramps, never as blockers. */
  readonly ramp?: boolean;
}

/** A convex XZ outline extruded over [y0, y1], in the mesh's own space. */
export interface CollisionPrism {
  y0: number;
  y1: number;
  /** Convex outline, counter-clockwise, as flat x,z pairs: the UNION hull of
   *  everything the mesh occupies across the band (coverage-complete, the
   *  shape height-blind consumers collide with). */
  poly: readonly number[];
  /**
   * LOFT outlines: the mesh's own section at the band's bottom and top,
   * radially resampled onto poly's vertex count so index i corresponds
   * across all three. A height-aware consumer interpolates between them at
   * the mover's own height, which makes a linear taper collide EXACTLY as
   * authored instead of as a stack of flat-walled hulls - the maker's
   * Collision Master volume and the in-game shape finally look and feel the
   * same. Absent when a band's end section is degenerate.
   */
  polyLo?: readonly number[];
  polyHi?: readonly number[];
}

/** Bands never subdivide below this height: past it the split is finer than
 *  the collision resolution anyone can feel, and a cone tip would recurse
 *  forever chasing a section whose area goes to zero. */
const MIN_BAND = 0.05;
/** A band is also done once its prism's MEAN OVERHANG, excess volume spread
 *  over the band's wall area (perimeter x height), is under this distance
 *  in WORLD yards. This is the system's ONE fidelity dial, and it is
 *  deliberately set to the felt threshold rather than the visible one: ~8cm
 *  of wall standoff on an organic taper is invisible in play, and every band
 *  under it is pure collider-count cost, collision cost is per shape, paid
 *  by every mover query near it and by the playtest boot that grids them
 *  all. A tree trunk is 1-2 bands under this rule; only shapes whose section
 *  genuinely jumps (a dome, a spread of roots) spend more.
 *
 *  WORLD yards matter: CM volumes are authored in placed-normalized space
 *  and a building placement multiplies them 4-15x, so a mesh-space tolerance
 *  silently became half a yard of slop on exactly the assets the maker
 *  authors most carefully. Callers pass the placement scale via
 *  `worldScale`; the tolerance (and the band floor) divide by it. */
const OVERHANG_TOL = 0.08;
/** No band may leave any single corner further off the drawn shape than
 *  this, in WORLD yards (see WorkBand.maxOverhang). The mean criterion
 *  handles diffuse slop; this one catches LEANED volumes whose staircase
 *  corners a maker can see against the wireframe. */
const MAX_OVERHANG_TOL = 0.18;
/** How much MORE under-coverage (the loft dipping inside the mesh) is
 *  tolerated than over-coverage. Brushing into a bulge's visual is barely
 *  felt; an invisible wall is fully felt. */
const UNDER_COVER_SLACK = 1.5;
/** A band is done once the volume its prism adds OVER the volume the mesh
 *  actually fills there is within this fraction of that filled volume... */
const BAND_VOLUME_TOL = 0.05;
/** ...plus this absolute slack (yards^3), so a spire tip or a chamfer stops
 *  instead of chasing a relative tolerance against a vanishing section. */
const BAND_VOLUME_SLACK = 0.004;
/** How many heights the filled volume of a band is sampled at (midpoint rule:
 *  never lands on the degenerate sections at the band's own planes). */
const VOLUME_SAMPLES = 5;
/** Per-mesh and per-asset prism budgets, HARD performance caps, not
 *  tolerances. Six bands covers a natural-scale organic taper; a LEANED
 *  authored volume (Collision Master lets the maker pitch a box, roof
 *  slopes, leaning roots) staircases under Y-banding and genuinely needs
 *  more bands to hug what was drawn, so the ceiling is higher and
 *  prismsForAssetId allocates the ASSET budget by NEED across the meshes
 *  (a straight box asks for 1 band and leaves its share to the leaned
 *  ones). Dropping a whole authored volume is a walk-through wall, never
 *  an acceptable saving. */
export const MAX_MESH_PRISMS = 6;
export const MAX_MESH_PRISMS_CEIL = 48;
export const MAX_ASSET_PRISMS = 48;
/** Outline vertex cap: past this the extra sides cost more than they hug.
 *  24, not 16: simplifyPoly only ever CUTS corners inward, so a cap a
 *  castle-sized authored section actually hits turns into a walk-through
 *  sliver through the maker's wall (measured 0.31yd at placement scale). */
const MAX_POLY_VERTS = 24;
/** Corners flatter than this (triangle area in yards^2) are dropped from an
 *  outline: they are slicing noise, not shape. */
const FLAT_CORNER_AREA = 2e-4;

/** Andrew's monotone chain convex hull (XZ), counter-clockwise. */
export function convexHullXZ(points: readonly (readonly [number, number])[]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq: [number, number][] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) {
      uniq.push([p[0], p[1]]);
    }
  }
  if (uniq.length <= 2) return uniq;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Signed-area magnitude of a polygon given as flat x,z pairs. */
export function polyArea(poly: readonly number[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length;
    a += poly[i] * poly[j + 1] - poly[j] * poly[i + 1];
  }
  return Math.abs(a) / 2;
}

function hullToPoly(hull: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [];
  for (const [x, z] of hull) out.push(x, z);
  return out;
}

/**
 * Trim an outline down to something cheap to collide with: drop corners that
 * are almost flat, then, if it is still over budget, keep dropping the flattest
 * corner. Dropping a corner CUTS it, so the outline only ever shrinks - the
 * collider stays inside the drawn shape rather than growing an invisible bulge.
 */
function simplifyPoly(poly: readonly number[], maxVerts = MAX_POLY_VERTS): number[] {
  let pts: [number, number][] = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i + 1]]);
  const cornerArea = (i: number): number => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  };
  // Flat corners are slicing noise; drop them regardless of the budget.
  for (let guard = 0; guard < poly.length && pts.length > 3; guard++) {
    let flattest = -1;
    let flattestArea = FLAT_CORNER_AREA;
    for (let i = 0; i < pts.length; i++) {
      const area = cornerArea(i);
      if (area < flattestArea) {
        flattestArea = area;
        flattest = i;
      }
    }
    if (flattest < 0) break;
    pts.splice(flattest, 1);
  }
  while (pts.length > maxVerts && pts.length > 3) {
    let flattest = 0;
    let flattestArea = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const area = cornerArea(i);
      if (area < flattestArea) {
        flattestArea = area;
        flattest = i;
      }
    }
    pts.splice(flattest, 1);
  }
  if (pts.length < 3) pts = pts.slice(0, 3);
  return hullToPoly(pts);
}

/** Y extent of a mesh, or null when it has no usable vertices. */
export function meshYRange(m: PrismSourceMesh): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < m.verts.length; i += 3) {
    const y = m.verts[i];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

/** Outline of everything the mesh occupies between y0 and y1: the vertices
 *  inside the band plus where its edges cross the two band planes. A mid-band
 *  slice of a box owns no vertices at all - the section lives on the cuts. */
function bandOutline(m: PrismSourceMesh, y0: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < m.verts.length; i += 3) {
    const y = m.verts[i + 1];
    if (y >= y0 - 1e-6 && y <= y1 + 1e-6) pts.push([m.verts[i], m.verts[i + 2]]);
  }
  for (let t = 0; t < m.tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.tris[t + e] * 3;
      const b = m.tris[t + ((e + 1) % 3)] * 3;
      const ya = m.verts[a + 1];
      const yb = m.verts[b + 1];
      for (const yc of [y0, y1]) {
        if ((ya < yc && yb > yc) || (yb < yc && ya > yc)) {
          const f = (yc - ya) / (yb - ya);
          pts.push([
            m.verts[a] + (m.verts[b] - m.verts[a]) * f,
            m.verts[a + 2] + (m.verts[b + 2] - m.verts[a + 2]) * f,
          ]);
        }
      }
    }
  }
  return convexHullXZ(pts);
}

/** Outline of the single slice at height y (edge crossings only). */
function sliceOutline(m: PrismSourceMesh, y: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let t = 0; t < m.tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.tris[t + e] * 3;
      const b = m.tris[t + ((e + 1) % 3)] * 3;
      const ya = m.verts[a + 1];
      const yb = m.verts[b + 1];
      if ((ya < y && yb > y) || (yb < y && ya > y)) {
        const f = (y - ya) / (yb - ya);
        pts.push([
          m.verts[a] + (m.verts[b] - m.verts[a]) * f,
          m.verts[a + 2] + (m.verts[b + 2] - m.verts[a + 2]) * f,
        ]);
      }
    }
  }
  return convexHullXZ(pts);
}

function polysMatch(a: readonly number[], b: readonly number[], eps = 0.01): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

interface WorkBand {
  y0: number;
  y1: number;
  hull: [number, number][];
  /** How much volume this band's prism adds beyond what the mesh fills. */
  excess: number;
  /** Volume the mesh actually fills across the band (midpoint rule). */
  filled: number;
  /** Perimeter of the band's hull (yards): with `excess` it gives the band's
   *  MEAN OVERHANG, how far the prism wall actually stands off the mesh. */
  perimeter: number;
  /** The band's WORST overhang: the farthest any hull corner stands outside
   *  the mesh's own mid-band section. The mean misses this on a LEANED
   *  volume (a pitched Collision Master box, a tilted slab): the swept hull
   *  is thin, so excess-over-wall-area reads small while the corners stand
   *  a full sweep off the drawn shape, exactly the "collision doesn't
   *  match what I built" a maker sees in the wireframe. */
  maxOverhang: number;
  /** Mesh sections just inside the band's two planes, for the loft. */
  sliceLo: [number, number][];
  sliceHi: [number, number][];
}

/** Distance from (px, pz) to a convex hull's boundary when outside it, 0 inside. */
function distOutsideHull(
  px: number,
  pz: number,
  hull: readonly (readonly [number, number])[],
): number {
  if (hull.length < 3) return 0;
  let inside = true;
  let minD = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    if ((bx - ax) * (pz - az) - (bz - az) * (px - ax) < 0) inside = false;
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)),
    );
    minD = Math.min(minD, Math.hypot(px - (ax + vx * t), pz - (az + vz * t)));
  }
  return inside ? 0 : minD;
}

function makeBand(m: PrismSourceMesh, y0: number, y1: number): WorkBand {
  const hull = bandOutline(m, y0, y1);
  const h = y1 - y0;
  const prismVolume = hull.length >= 3 ? polyArea(hullToPoly(hull)) * h : 0;
  let filled = 0;
  for (let i = 0; i < VOLUME_SAMPLES; i++) {
    // 0.463, not 0.5: bisection midpoints land EXACTLY on mesh vertex rings
    // (a sphere's rings sit at even fractions), and the strict-inequality
    // slicer returns an empty section on the plane itself - the sample
    // scored zero area and the whole criterion went blind there.
    const y = y0 + (h * (i + 0.463)) / VOLUME_SAMPLES;
    filled += polyArea(hullToPoly(sliceOutline(m, y)));
  }
  filled = (filled / VOLUME_SAMPLES) * h;
  let perimeter = 0;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    perimeter += Math.hypot(bx - ax, bz - az);
  }
  // Two off-lattice probes stand in for the naive midpoint (see the volume
  // sampler note: exact midpoints often land on vertex rings and slice empty).
  const probeTs = [0.463, 0.547];
  // End sections, sampled a hair inside the planes (the planes themselves
  // are degenerate on meshes whose faces lie exactly on them).
  const eps = Math.min(0.01, h * 0.05);
  const sliceLo = sliceOutline(m, y0 + eps);
  const sliceHi = sliceOutline(m, y1 - eps);
  // LOFT-AWARE error: the band will COLLIDE as the loft between its end
  // sections (see CollisionPrism.polyLo/polyHi), so the split criteria must
  // measure the loft against the mesh, not the union hull against it - the
  // hull metric split a linear taper into a stack of bands whose extra
  // fidelity the loft already carries for free (one band now collides
  // exactly as the maker's tapered volume looks).
  let loftVolume = prismVolume;
  let maxOverhang = 0;
  const polyB = hullToPoly(hull);
  let cx = 0;
  let cz = 0;
  for (const [hx, hz] of hull) {
    cx += hx;
    cz += hz;
  }
  cx /= Math.max(1, hull.length);
  cz /= Math.max(1, hull.length);
  const loftLo = loftOutline(sliceLo, polyB, cx, cz);
  const loftHi = loftOutline(sliceHi, polyB, cx, cz);
  let excess = Math.max(0, prismVolume - filled);
  if (loftLo && loftHi) {
    const aLo = polyArea(loftLo);
    const aHi = polyArea(loftHi);
    // Frustum rule: exact for similar sections, close enough for the rest.
    loftVolume = (h * (aLo + aHi + Math.sqrt(aLo * aHi))) / 3;
    // TWO-SIDED: the loft must neither stand off the mesh (invisible wall)
    // nor fall inside it (walk-through). A sphere's end sections are tiny,
    // so a one-sided metric would happily collide it as a spindle.
    // ASYMMETRIC error: the loft standing OFF the mesh is an invisible wall
    // (fully felt); the loft dipping INSIDE it means brushing slightly into
    // a bulge's visual - barely felt, and the editor shows one volume there
    // anyway. Weighting both equally made every irregular lump (rocks!)
    // split to its cap "for no reason" a maker could see.
    excess = loftVolume > filled ? loftVolume - filled : (filled - loftVolume) / UNDER_COVER_SLACK;
    for (const pt of probeTs) {
      const sec = sliceOutline(m, y0 + h * pt);
      if (sec.length < 3) continue;
      const loft: [number, number][] = [];
      for (let i = 0; i < loftLo.length; i += 2) {
        loft.push([
          loftLo[i] + (loftHi[i] - loftLo[i]) * pt,
          loftLo[i + 1] + (loftHi[i + 1] - loftLo[i + 1]) * pt,
        ]);
      }
      for (const [mx2, mz2] of loft) {
        maxOverhang = Math.max(maxOverhang, distOutsideHull(mx2, mz2, sec));
      }
      for (const [mx2, mz2] of sec) {
        maxOverhang = Math.max(maxOverhang, distOutsideHull(mx2, mz2, loft) / UNDER_COVER_SLACK);
      }
    }
  } else {
    for (const pt of probeTs) {
      const sec = sliceOutline(m, y0 + h * pt);
      if (sec.length < 3) continue;
      for (const [hx, hz] of hull) {
        maxOverhang = Math.max(maxOverhang, distOutsideHull(hx, hz, sec));
      }
    }
  }
  return {
    y0,
    y1,
    hull,
    filled,
    perimeter,
    maxOverhang,
    sliceLo,
    sliceHi,
    excess,
  };
}

/** Resample a band-end section onto the band poly's vertex bearings via the
 *  SUPPORT FUNCTION: outline vertex i is the section's farthest point along
 *  poly vertex i's bearing. Support sampling preserves any convex section -
 *  a ridge-like sliver keeps its full length (its ends are the support in
 *  every direction with a lengthwise component), where a radial-from-centroid
 *  resample collapsed it to a speck and the loft walked through the roof.
 *  Support points of a convex set along angularly ordered bearings come back
 *  in the same winding, so index correspondence and CCW both hold. Returns
 *  null on a degenerate section. */
function loftOutline(
  slice: readonly (readonly [number, number])[],
  poly: readonly number[],
  polyCx: number,
  polyCz: number,
): number[] | null {
  if (slice.length < 3) return null;
  const out: number[] = [];
  for (let i = 0; i < poly.length; i += 2) {
    const bx = poly[i] - polyCx;
    const bz = poly[i + 1] - polyCz;
    const len = Math.hypot(bx, bz);
    if (len < 1e-9) return null;
    const dx = bx / len;
    const dz = bz / len;
    let best = -Infinity;
    let sx = 0;
    let sz = 0;
    for (const [px, pz] of slice) {
      const d = px * dx + pz * dz;
      if (d > best) {
        best = d;
        sx = px;
        sz = pz;
      }
    }
    out.push(sx, sz);
  }
  return out;
}

function bandIsDone(b: WorkBand, worldScale: number): boolean {
  if (b.y1 - b.y0 <= (MIN_BAND / worldScale) * 2) return true;
  // The WORST corner must stand within feel of the drawn shape in WORLD
  // yards, whatever the volume numbers say: this is the criterion a maker
  // can see with their own eyes against the wireframe.
  if (b.maxOverhang * worldScale > MAX_OVERHANG_TOL) return false;
  if (b.excess <= b.filled * BAND_VOLUME_TOL + BAND_VOLUME_SLACK / worldScale ** 3) return true;
  // Distance criterion: excess spread over the band's wall area is how far the
  // collider actually stands off the mesh. A thin trunk's slivers save
  // millimetres nobody can feel; a fat dome's save decimetres. Splitting stops
  // once the mean overhang is below feel, however large the volume numbers,   // measured in WORLD yards, so a placement scaled 10x keeps splitting until
  // the world-space wall is honest, not just the mesh-space one.
  const wall = b.perimeter * (b.y1 - b.y0);
  return wall > 0 && (b.excess / wall) * worldScale <= OVERHANG_TOL;
}

/**
 * Slice one authored volume into banded convex prisms.
 *
 * Bands are spent WORST FIRST: start from the whole volume as one prism, then
 * repeatedly split whichever band's prism covers the most volume the mesh does
 * not actually fill, until every band is within tolerance or the budget runs
 * out. Straight-sided geometry (a box, a wall, a cylinder) never splits at all,
 * a taper spends its bands on the taper, and a shape that collapses near one
 * end - a tower's cap, a cone's tip - gets them exactly there instead of
 * spreading them evenly and blocking thin air above the model. Adjacent bands
 * that come back with the same outline are merged again afterwards.
 */
export function meshToPrisms(
  m: PrismSourceMesh,
  maxPrisms = MAX_MESH_PRISMS,
  worldScale = 1,
): CollisionPrism[] {
  if (m.ramp) return [];
  const range = meshYRange(m);
  if (!range) return [];
  if (!(range.max - range.min > 0)) return [];

  const scale = Math.max(0.25, worldScale);
  const bands: WorkBand[] = [makeBand(m, range.min, range.max)];
  while (bands.length < maxPrisms) {
    let worst = -1;
    let worstExcess = 0;
    for (let i = 0; i < bands.length; i++) {
      if (bandIsDone(bands[i], scale)) continue;
      if (bands[i].excess > worstExcess) {
        worstExcess = bands[i].excess;
        worst = i;
      }
    }
    if (worst < 0) break;
    const b = bands[worst];
    const mid = (b.y0 + b.y1) / 2;
    bands.splice(worst, 1, makeBand(m, b.y0, mid), makeBand(m, mid, b.y1));
  }

  interface Draft {
    y0: number;
    y1: number;
    poly: number[];
    sliceLo: [number, number][];
    sliceHi: [number, number][];
  }
  // A band is STRAIGHT when its own end sections match its union hull: only
  // those may merge. Matching hulls alone is loft-blind - a sphere's bands
  // both sides of the equator share the equator ring as their union hull,
  // and merging them lofted pole-to-equator as a cone, gutting the bulge.
  const straight = (b: WorkBand, hullA: number): boolean => {
    if (b.sliceLo.length < 3 || b.sliceHi.length < 3) return false;
    const lo = polyArea(hullToPoly(b.sliceLo));
    const hi = polyArea(hullToPoly(b.sliceHi));
    const tol = Math.max(0.02, hullA * 0.03);
    return Math.abs(lo - hullA) <= tol && Math.abs(hi - hullA) <= tol;
  };
  const drafts: Draft[] = [];
  let prevStraight = false;
  for (const b of bands) {
    if (b.hull.length < 3) continue;
    const poly = simplifyPoly(hullToPoly(b.hull));
    if (poly.length < 6) continue;
    const isStraight = straight(b, polyArea(poly));
    const prev = drafts[drafts.length - 1];
    if (
      prev &&
      prevStraight &&
      isStraight &&
      Math.abs(prev.y1 - b.y0) < 1e-6 &&
      polysMatch(prev.poly, poly)
    ) {
      // Merged straight-walled run: the loft spans first bottom to last top.
      prev.y1 = b.y1;
      prev.sliceHi = b.sliceHi;
    } else {
      drafts.push({ y0: b.y0, y1: b.y1, poly, sliceLo: b.sliceLo, sliceHi: b.sliceHi });
    }
    prevStraight = isStraight;
  }
  const out: CollisionPrism[] = [];
  for (const d of drafts.slice(0, maxPrisms)) {
    let cx = 0;
    let cz = 0;
    const n = d.poly.length / 2;
    for (let i = 0; i < d.poly.length; i += 2) {
      cx += d.poly[i];
      cz += d.poly[i + 1];
    }
    cx /= n;
    cz /= n;
    const lo = loftOutline(d.sliceLo, d.poly, cx, cz);
    const hi = loftOutline(d.sliceHi, d.poly, cx, cz);
    const prism: CollisionPrism = { y0: d.y0, y1: d.y1, poly: d.poly };
    // Only carry a loft when BOTH ends resolved: a one-sided loft would
    // interpolate against nothing and height-aware consumers fall back to
    // the union hull anyway.
    if (lo && hi) {
      prism.polyLo = lo;
      prism.polyHi = hi;
    }
    out.push(prism);
  }
  return out;
}
