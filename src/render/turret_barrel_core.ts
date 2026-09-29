// Fire and Fly explosive barrels on screen, the pure half: the powder keg's
// shape and where its stencilled bomb and its wick sit, the mark's texels and
// the outline its mesh is cut to, a new keg's pop up, its warning ring's
// breathing, the shake and swell through the fuse, the sparks the fuse throws
// from the wick's tip, the tall fire column of its blast and the keg's shards
// flying off. The Three consumer is turret_barrel_visual.ts; the blast's
// flash, fireball, shock ring, dust, dirt and scorch are the cannon's own
// (cannon_shell_visuals.ts), drawn wider and hotter.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (every spread is a
// hash of the barrel and the index) and allocation-free per frame.

import { TURRET_EXPLOSIVE_BARREL } from '../sim/content/turret_defense';
import { type CannonPuff, cannonHash01, cannonPuffLaunch, PUFF } from './cannon_puff_core';

/** The faceted powder keg of the cannon tower's own kit. */
export const TURRET_BARREL_MODEL_URL = '/models/biome/hex_barrel.glb';

/**
 * hex_barrel.glb as the visual fits it (TURRET_EXPLOSIVE_BARREL.height tall,
 * its foot on the ground, centred on its axis), in shares of that height:
 * eight flat staves between two iron bands, a bung off the axis on the lid.
 */
export const TURRET_KEG_SHAPE = {
  /** The facet the bomb is painted on faces this bearing in the model (x += sin, z += cos): the one beside the bung. */
  markFacet: (3 * Math.PI) / 8,
  /** A facet spans this bearing either side of its middle; the kit's normals point out through its corners. */
  facetSpread: Math.PI / 8,
  /** That facet's distance from the axis, and its width between its two corners. */
  facetApothem: 0.4137,
  facetWidth: 0.3427,
  /** The bare staves between the lower and the upper band. */
  bareLow: 0.2785,
  bareHigh: 0.7131,
  /** The bung's top, off the axis on the model's +x. */
  bungX: 0.0654,
  bungTop: 1,
} as const;

export const TURRET_KEG_MARK = {
  /** Drawn this far off the facet (yd): no depth fight at the clearing's far side. */
  lift: 0.015,
  /** Texels across the mark's texture; turretKegMarkLayout gives its rows. */
  texels: 128,
} as const;

/**
 * The painted facet's bare wood as hex_barrel.glb's palette atlas holds it
 * (TURRET_KEG_WOOD.atlas texels square, decoded): the facet's v at its upper
 * and at its lower band, and the atlas rows between, one sRGB colour each from
 * `firstRow` down, the same across the facet's columns and a few beyond. The
 * mark paints its bare wood from them, so under the keg's own light the wood
 * round the bomb and in its gaps is the keg's.
 */
export const TURRET_KEG_WOOD = {
  atlas: 512,
  vTop: 6545 / 65535,
  vBottom: 8578 / 65535,
  firstRow: 50,
  rows: [
    163, 97, 72, 163, 97, 72, 161, 95, 71, 161, 95, 71, 161, 95, 71, 161, 95, 71, 158, 92, 76, 158,
    92, 76, 158, 92, 76, 158, 92, 76, 156, 90, 74, 156, 90, 74, 156, 90, 74, 156, 90, 74, 158, 92,
    68, 154, 88, 64, 154, 88, 64, 154, 88, 64,
  ],
} as const;

export const TURRET_KEG_WICK = {
  /** Its rise over the bung, its bend aside and toward the painted facet, its thickness (yd). */
  rise: 0.24,
  bend: 0.09,
  lean: 0.03,
  radius: 0.024,
  /** Sunk this far into the bung so no gap shows (yd). */
  sink: 0.015,
} as const;

const KEG_H = TURRET_EXPLOSIVE_BARREL.height;
const FACET_X = Math.sin(TURRET_KEG_SHAPE.markFacet);
const FACET_Z = Math.cos(TURRET_KEG_SHAPE.markFacet);

/** The bare staves' height over the facet's width: mark units run x over [-1, 1] between its corners and y over [-aspect, aspect] between its bands. */
export const TURRET_KEG_BARE_ASPECT =
  (TURRET_KEG_SHAPE.bareHigh - TURRET_KEG_SHAPE.bareLow) / TURRET_KEG_SHAPE.facetWidth;

export interface TurretKegMarkLayout {
  width: number;
  height: number;
  /** Rows of the wick's cord along the bottom; the gutter above it ends at markRow, where the facet's bare staves begin. */
  cordRows: number;
  markRow: number;
  /** The same as texture v: the cord below wickTop, the facet above markBottom. */
  wickTop: number;
  markBottom: number;
}

/** The mark texture's rows for `texels` across: a cord strip and a gutter an eighth of its width each, then the facet in square texels. */
export function turretKegMarkLayout(texels: number): TurretKegMarkLayout {
  const width = Math.max(8, Math.floor(texels));
  const cordRows = Math.max(1, Math.round(width / 8));
  const markRow = 2 * cordRows;
  const height = markRow + Math.round(width * TURRET_KEG_BARE_ASPECT);
  return {
    width,
    height,
    cordRows,
    markRow,
    wickTop: cordRows / height,
    markBottom: markRow / height,
  };
}

/** The painted facet's bare staves, in yards of the keg's own frame (before its yaw); one mark unit is half its width. */
export const TURRET_KEG_MARK_FRAME = {
  width: TURRET_KEG_SHAPE.facetWidth * KEG_H,
  height: (TURRET_KEG_SHAPE.bareHigh - TURRET_KEG_SHAPE.bareLow) * KEG_H,
  centreY: 0.5 * (TURRET_KEG_SHAPE.bareLow + TURRET_KEG_SHAPE.bareHigh) * KEG_H,
  offset: TURRET_KEG_SHAPE.facetApothem * KEG_H + TURRET_KEG_MARK.lift,
  /** The facet's outward normal, and its right as seen from in front of it. */
  normalX: FACET_X,
  normalZ: FACET_Z,
  sideX: FACET_Z,
  sideZ: -FACET_X,
} as const;

/** The yaw that turns a keg standing at (x, z) so its painted facet faces the tower at (cx, cz). */
export function turretKegYaw(x: number, z: number, cx: number, cz: number): number {
  return Math.atan2(cx - x, cz - z) - TURRET_KEG_SHAPE.markFacet;
}

export interface TurretKegNormal {
  x: number;
  z: number;
}

/**
 * The keg's own shading normal on its painted facet at mark x, in its frame
 * before its yaw and not normalized: the kit shades its staves smooth, each
 * corner's normal pointing out through the corner and blended across the
 * facet, so bare wood painted on the mark and lit by it matches the facet.
 */
export function turretKegFacetNormalInto(out: TurretKegNormal, x: number): TurretKegNormal {
  const s = x <= -1 ? 0 : x >= 1 ? 1 : 0.5 * (x + 1);
  const left = TURRET_KEG_SHAPE.markFacet - TURRET_KEG_SHAPE.facetSpread;
  const right = TURRET_KEG_SHAPE.markFacet + TURRET_KEG_SHAPE.facetSpread;
  out.x = (1 - s) * Math.sin(left) + s * Math.sin(right);
  out.z = (1 - s) * Math.cos(left) + s * Math.cos(right);
  return out;
}

export interface TurretKegPoint {
  x: number;
  y: number;
  z: number;
}

/** A point `t` (0 at the bung, 1 at the tip) along the wick, in the keg's own frame (yd, before its yaw). */
export function turretKegWickInto(out: TurretKegPoint, t: number): TurretKegPoint {
  const w = TURRET_KEG_WICK;
  const f = TURRET_KEG_MARK_FRAME;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  // A quadratic curve: straight up out of the bung, then bending over.
  const b = u * u;
  const aside = w.bend * b;
  const toward = w.lean * b;
  out.x = TURRET_KEG_SHAPE.bungX * KEG_H + f.sideX * aside + f.normalX * toward;
  out.y = TURRET_KEG_SHAPE.bungTop * KEG_H - w.sink + (w.rise + w.sink) * (2 * u - u * u);
  out.z = f.sideZ * aside + f.normalZ * toward;
  return out;
}

const wickTip = turretKegWickInto({ x: 0, y: 0, z: 0 }, 1);

/** The wick's tip over a keg standing at (x, y, z) turned by `yaw`: where its lit fuse burns. */
export function turretKegWickTipInto(
  out: TurretKegPoint,
  x: number,
  y: number,
  z: number,
  yaw: number,
): TurretKegPoint {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.x = x + wickTip.x * c + wickTip.z * s;
  out.y = y + wickTip.y;
  out.z = z - wickTip.x * s + wickTip.z * c;
  return out;
}

/** Mark units per unit of the bomb's design panel (360 across the facet, y down), and where that panel's origin lands. */
const PANEL = 1 / 150;
const panelX = (x: number): number => -1.263 + x * PANEL;
const panelY = (y: number): number => 1.485 - y * PANEL;
const DEG = Math.PI / 180;

/**
 * The stencilled bomb, in mark units: a black ball low in the middle, a bare
 * highlight crescent on it tied to its rim by two stencil bridges, its neck,
 * a dashed fuse curling up to a yellow spark at the upper right. Traced from
 * its design panel a fifth larger, the facet being taller than the panel.
 */
export const TURRET_KEG_BOMB = {
  ballX: panelX(168),
  ballY: panelY(270),
  ballR: 96 * PANEL,
  /** The crescent: an arc at this share of the ball's radius between two bearings (counter-clockwise from +x), this wide. */
  crescentR: 0.72,
  crescentFrom: 98 * DEG,
  crescentTo: 164 * DEG,
  crescentWidth: 15 * PANEL,
  /** A bridge from each end of the crescent out through the rim, this far from the ball's centre. */
  bridgeWidth: 5 * PANEL,
  bridgeReach: 100 * PANEL,
  neckX: panelX(214),
  neckY: panelY(170),
  neckLong: 48 * PANEL,
  neckShort: 28 * PANEL,
  neckRound: 4 * PANEL,
  neckTilt: -28 * DEG,
  /** Two cubic curves from the neck: a start, two controls and an end, then two controls and the end at the spark. */
  fuse: [
    panelX(225),
    panelY(150),
    panelX(232),
    panelY(128),
    panelX(212),
    panelY(116),
    panelX(232),
    panelY(100),
    panelX(250),
    panelY(86),
    panelX(262),
    panelY(108),
    panelX(280),
    panelY(92),
  ],
  fuseWidth: 12 * PANEL,
  dash: 19 * PANEL,
  gap: 6 * PANEL,
  /** The spark: a jagged yellow star round a paler heart, each point's reach and bearing wandering by `jitter`; its body a little fuller than the design's, so it stays a yellow dot from afar. */
  sparkX: panelX(288),
  sparkY: panelY(86),
  sparkOuter: 34 * PANEL,
  sparkInner: 14 * PANEL,
  sparkPoints: 8,
  sparkTurn: 0.2,
  heartOuter: 19 * PANEL,
  heartInner: 9 * PANEL,
  heartPoints: 6,
  heartTurn: -0.3,
  jitter: 0.18,
  /** The soft dark overspray round and under the paint: it fades out over twice this either side of the paint's edge, at this strength. */
  spray: 5 * PANEL,
  sprayStrength: 0.32,
  /** How far the mark's mesh reaches past the paint's edge: past the overspray, so its own edge lies on bare wood. */
  margin: 15 * PANEL,
  /** The spark sprays nothing: its disc reaches this far past the star's tips. */
  sparkMargin: 6 * PANEL,
} as const;

/** Sides of the discs the mesh cuts round the ball and the spark, and steps along each fuse curve. */
const BALL_SIDES = 32;
const SPARK_SIDES = 16;
const FUSE_STEPS = 10;

/** Painted colours (sRGB bytes): the stencil black, the spark's yellow and its heart, the wick's cord. */
const BOMB_INK = [27, 20, 17] as const;
const SPARK = [255, 210, 79] as const;
const SPARK_HEART = [255, 247, 218] as const;
const CORD = [46, 36, 28] as const;
/** The paint's edge wanders this far (mark units); a worn streak along the grain takes up to this share of the paint. */
const PAINT_WOBBLE = 0.013;
const PAINT_WEAR = 0.85;

/** The keg's bare wood at mark height `y`, as sRGB bytes (unrounded) into `out`: its atlas column, sampled as the facet samples it. */
export function turretKegWoodInto<T extends number[] | Float64Array>(out: T, y: number): T {
  const wood = TURRET_KEG_WOOD;
  const up = 0.5 * (y / TURRET_KEG_BARE_ASPECT + 1);
  const v = wood.vBottom + (wood.vTop - wood.vBottom) * up;
  const last = wood.rows.length / 3 - 1;
  const r = Math.min(last, Math.max(0, v * wood.atlas - 0.5 - wood.firstRow));
  const r0 = Math.min(last - 1, Math.floor(r));
  const f = r - r0;
  for (let c = 0; c < 3; c++) {
    const a = wood.rows[r0 * 3 + c];
    out[c] = a + (wood.rows[(r0 + 1) * 3 + c] - a) * f;
  }
  return out;
}

/** The fuse as a polyline (x, y pairs, mark units) and each point's distance along it. */
interface FusePath {
  points: Float64Array;
  along: Float64Array;
}

function fusePath(): FusePath {
  const f = TURRET_KEG_BOMB.fuse;
  const count = 2 * FUSE_STEPS + 1;
  const points = new Float64Array(count * 2);
  const along = new Float64Array(count);
  let n = 0;
  for (let curve = 0; curve < 2; curve++) {
    const o = curve * 6;
    for (let k = curve === 0 ? 0 : 1; k <= FUSE_STEPS; k++) {
      const t = k / FUSE_STEPS;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      points[n * 2] = a * f[o] + b * f[o + 2] + c * f[o + 4] + d * f[o + 6];
      points[n * 2 + 1] = a * f[o + 1] + b * f[o + 3] + c * f[o + 5] + d * f[o + 7];
      if (n > 0) {
        along[n] =
          along[n - 1] +
          Math.hypot(points[n * 2] - points[n * 2 - 2], points[n * 2 + 1] - points[n * 2 - 1]);
      }
      n++;
    }
  }
  return { points, along };
}

/** A jagged star's outline (x, y pairs, mark units), every tip and dip wandering by a hash of `salt`. */
function starOutline(
  x: number,
  y: number,
  points: number,
  outer: number,
  inner: number,
  turn: number,
  salt: number,
): Float64Array {
  const out = new Float64Array(points * 4);
  const jitter = TURRET_KEG_BOMB.jitter;
  for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0 ? outer : inner) * (1 + (cannonHash01(salt, 2 * i) - 0.5) * 2 * jitter);
    const a =
      turn +
      (i / (points * 2)) * 2 * Math.PI +
      (cannonHash01(salt, 2 * i + 1) - 0.5) * (Math.PI / points) * 0.45;
    out[i * 2] = x + Math.cos(a) * r;
    out[i * 2 + 1] = y + Math.sin(a) * r;
  }
  return out;
}

const SPARK_SALT = 77;
const HEART_SALT = 78;

/** The spark's farthest reach from its centre: its disc in the mesh clears it by sparkMargin. */
function sparkReach(): number {
  const b = TURRET_KEG_BOMB;
  return b.sparkOuter * (1 + b.jitter);
}

/** Signed distance to a closed outline (x, y pairs): negative inside. */
function outlineDistance(outline: Float64Array, x: number, y: number): number {
  const n = outline.length / 2;
  let best = Number.POSITIVE_INFINITY;
  let crossings = 0;
  let xj = outline[n * 2 - 2];
  let yj = outline[n * 2 - 1];
  for (let i = 0; i < n; i++) {
    const xi = outline[i * 2];
    const yi = outline[i * 2 + 1];
    const ex = xi - xj;
    const ey = yi - yj;
    const wx = x - xj;
    const wy = y - yj;
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const gx = wx - ex * t;
    const gy = wy - ey * t;
    best = Math.min(best, gx * gx + gy * gy);
    // Both tests on every edge, so the loop never meets an untried branch.
    const spans = yi > y !== yj > y;
    const left = x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    crossings += spans && left ? 1 : 0;
    xj = xi;
    yj = yi;
  }
  const d = Math.sqrt(best);
  return crossings % 2 === 1 ? -d : d;
}

/** A value-noise lattice over the facet, `across` cells wide and `up` cells tall. */
interface NoiseLattice {
  across: number;
  up: number;
  values: Float64Array;
}

function noiseLattice(across: number, up: number, salt: number): NoiseLattice {
  const values = new Float64Array((across + 2) * (up + 2));
  for (let j = 0; j < up + 2; j++) {
    for (let i = 0; i < across + 2; i++) values[j * (across + 2) + i] = cannonHash01(salt + j, i);
  }
  return { across, up, values };
}

/** The lattice's noise at facet shares (u, v), each in [0, 1], eased between its cells. */
function noiseAt(l: NoiseLattice, u: number, v: number): number {
  const x = u * l.across;
  const y = v * l.up;
  const i = Math.max(0, Math.min(l.across, Math.floor(x)));
  const j = Math.max(0, Math.min(l.up, Math.floor(y)));
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const row = l.across + 2;
  const a = l.values[j * row + i];
  const b = l.values[j * row + i + 1];
  const c = l.values[(j + 1) * row + i];
  const d = l.values[(j + 1) * row + i + 1];
  const bottom = a + (b - a) * sx;
  return bottom + (c + (d - c) * sx - bottom) * sy;
}

/**
 * The mesh the mark is drawn on, cut to the bomb: a disc round its ball, its
 * neck, a strip along its fuse and a disc round its spark, each grown by the
 * margin so its edge lies on bare wood, as triangles (x, y per corner, in
 * mark units) wound counter-clockwise seen from in front. The pieces overlap;
 * the texture maps flat across all of them, so an overlap draws the same texel.
 */
export function turretKegBombTriangles(): number[] {
  const b = TURRET_KEG_BOMB;
  const m = b.margin;
  const out: number[] = [];
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void => {
    if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0) out.push(ax, ay, bx, by, cx, cy);
    else out.push(ax, ay, cx, cy, bx, by);
  };
  const disc = (x: number, y: number, reach: number, sides: number): void => {
    // The polygon's sides, not its corners, clear the reach.
    const r = reach / Math.cos(Math.PI / sides);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * 2 * Math.PI;
      const a1 = ((i + 1) / sides) * 2 * Math.PI;
      tri(
        x,
        y,
        x + Math.cos(a0) * r,
        y + Math.sin(a0) * r,
        x + Math.cos(a1) * r,
        y + Math.sin(a1) * r,
      );
    }
  };
  disc(b.ballX, b.ballY, b.ballR + m, BALL_SIDES);
  const c = Math.cos(b.neckTilt);
  const s = Math.sin(b.neckTilt);
  const hl = b.neckLong / 2 + m;
  const hs = b.neckShort / 2 + m;
  const corner = (u: number, v: number, k: number): number =>
    k === 0 ? b.neckX + c * u - s * v : b.neckY + s * u + c * v;
  const x0 = corner(-hl, -hs, 0);
  const y0 = corner(-hl, -hs, 1);
  const x1 = corner(hl, -hs, 0);
  const y1 = corner(hl, -hs, 1);
  const x2 = corner(hl, hs, 0);
  const y2 = corner(hl, hs, 1);
  const x3 = corner(-hl, hs, 0);
  const y3 = corner(-hl, hs, 1);
  tri(x0, y0, x1, y1, x2, y2);
  tri(x0, y0, x2, y2, x3, y3);
  const { points } = fusePath();
  const count = points.length / 2;
  const half = b.fuseWidth / 2 + m;
  let leftX = 0;
  let leftY = 0;
  let rightX = 0;
  let rightY = 0;
  for (let k = 0; k < count; k++) {
    const a = Math.max(0, k - 1);
    const z = Math.min(count - 1, k + 1);
    let tx = points[z * 2] - points[a * 2];
    let ty = points[z * 2 + 1] - points[a * 2 + 1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // Its two ends reach past the curve by the margin too.
    const ext = k === 0 ? -m : k === count - 1 ? m : 0;
    const x = points[k * 2] + tx * ext;
    const y = points[k * 2 + 1] + ty * ext;
    const lx = x - ty * half;
    const ly = y + tx * half;
    const rx = x + ty * half;
    const ry = y - tx * half;
    if (k > 0) {
      tri(leftX, leftY, rightX, rightY, rx, ry);
      tri(leftX, leftY, rx, ry, lx, ly);
    }
    leftX = lx;
    leftY = ly;
    rightX = rx;
    rightY = ry;
  }
  disc(b.sparkX, b.sparkY, sparkReach() + b.sparkMargin, SPARK_SIDES);
  return out;
}

/**
 * The mark's texture as turretKegMarkLayout sizes it, row 0 at the bottom
 * (texture v up): the wick's dark cord in a strip along the bottom, a gutter,
 * then the painted facet's bare staves between its bands, the keg's own wood
 * (TURRET_KEG_WOOD) bearing the stencilled bomb: black paint with a soft
 * overspray, worn in streaks along the grain, bare wood in its crescent and
 * its bridges, and the spark's yellow star. Opaque throughout: the mesh's
 * outline is the bomb's, grown onto bare wood.
 */
export function turretKegMarkTexels(texels: number): Uint8Array {
  const layout = turretKegMarkLayout(texels);
  const data = new Uint8Array(layout.width * layout.height * 4);
  // A loop of its own each: one loop crossing from the cord to the facet
  // deoptimized on the way, a cost the page's first paint pays.
  paintKegCord(data, layout);
  paintKegBomb(data, layout);
  return data;
}

/** The wick's cord, twisted in faint diagonal strands, along the bottom; the gutter above it carries the cord's ink, then the wood's, so no mip level greys either. */
function paintKegCord(data: Uint8Array, layout: TurretKegMarkLayout): void {
  const w = layout.width;
  const wickRows = layout.cordRows;
  const markRow = layout.markRow;
  // The cord's fibre: a faint unevenness along it, the same all round it.
  const grain = noiseLattice(40, 1, 29);
  for (let j = 0; j < wickRows; j++) {
    for (let i = 0; i < w; i++) {
      const strand = ((i / w) * 10 + j / wickRows) % 1;
      const fine = noiseAt(grain, i / w, 0) - 0.5;
      const lit = 0.82 + 0.3 * (strand < 0.5 ? strand : 1 - strand) + 0.1 * fine;
      const at = (j * w + i) * 4;
      data[at] = CORD[0] * lit + 0.5;
      data[at + 1] = CORD[1] * lit + 0.5;
      data[at + 2] = CORD[2] * lit + 0.5;
      data[at + 3] = 255;
    }
  }
  const wood = turretKegWoodInto(new Float64Array(3), -TURRET_KEG_BARE_ASPECT);
  const split = Math.round((wickRows + markRow) / 2);
  for (let j = wickRows; j < markRow; j++) {
    const ink = j < split ? CORD : wood;
    for (let i = 0; i < w; i++) {
      const at = (j * w + i) * 4;
      data[at] = ink[0] + 0.5;
      data[at + 1] = ink[1] + 0.5;
      data[at + 2] = ink[2] + 0.5;
      data[at + 3] = 255;
    }
  }
}

/** Rows of the mark's texture and where they sit in mark units: row `j` of the facet's stretch is at mark height `y0 + j * dy`. */
interface MarkGrid {
  w: number;
  markRow: number;
  rows: number;
  dy: number;
  y0: number;
}

function markGrid(layout: TurretKegMarkLayout): MarkGrid {
  const rows = layout.height - layout.markRow;
  const dy = (2 * TURRET_KEG_BARE_ASPECT) / rows;
  return {
    w: layout.width,
    markRow: layout.markRow,
    rows,
    dy,
    y0: -TURRET_KEG_BARE_ASPECT + dy / 2,
  };
}

/** The texel range [lo, hi) a span of mark units covers, clamped to `count`. */
function spanLo(lo: number, step: number, origin: number): number {
  return Math.max(0, Math.floor((lo - origin) / step));
}

function spanHi(hi: number, step: number, origin: number, count: number): number {
  return Math.min(count, Math.ceil((hi - origin) / step) + 1);
}

/**
 * The bomb over the keg's wood, in passes of one small loop each (a loop
 * that meets a new branch rows after the optimizer took it deoptimizes, a
 * cost the page's first paint pays): the wood, then the paint's signed
 * distance (the ball less its crescent and bridges, the neck, then the fuse),
 * then the ink from that field, then the spark.
 */
function paintKegBomb(data: Uint8Array, layout: TurretKegMarkLayout): void {
  const grid = markGrid(layout);
  paintKegWood(data, grid);
  const field = new Float64Array(grid.w * grid.rows).fill(Number.POSITIVE_INFINITY);
  inkBall(field, grid);
  inkNeck(field, grid);
  inkFuse(field, grid);
  const wear = { streaks: noiseLattice(48, 3, 911), patches: noiseLattice(5, 6, 419) };
  paintKegInk(data, field, grid, wear);
  paintKegSpark(data, grid, wear);
}

function paintKegWood(data: Uint8Array, g: MarkGrid): void {
  const wood = new Float64Array(3);
  for (let j = 0; j < g.rows; j++) {
    turretKegWoodInto(wood, g.y0 + j * g.dy);
    const r = wood[0] + 0.5;
    const gr = wood[1] + 0.5;
    const b = wood[2] + 0.5;
    const row = (g.markRow + j) * g.w * 4;
    for (let i = 0; i < g.w; i++) {
      const at = row + i * 4;
      data[at] = r;
      data[at + 1] = gr;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
}

/**
 * The ball less its bare crescent and the crescent's two stencil bridges.
 * Past the mesh's margin a texel is bare whatever the cuts say, so there the
 * plain disc's distance stands in for them.
 */
function inkBall(field: Float64Array, g: MarkGrid): void {
  const b = TURRET_KEG_BOMB;
  const bx = b.ballX;
  const by = b.ballY;
  const r = b.ballR;
  const cutR = b.crescentR * r;
  const cutHalf = b.crescentWidth / 2;
  const bridgeHalf = b.bridgeWidth / 2;
  const fromX = Math.cos(b.crescentFrom);
  const fromY = Math.sin(b.crescentFrom);
  const toX = Math.cos(b.crescentTo);
  const toY = Math.sin(b.crescentTo);
  const ax0 = bx + fromX * cutR;
  const ay0 = by + fromY * cutR;
  const ax1 = bx + toX * cutR;
  const ay1 = by + toY * cutR;
  const ex0 = fromX * (b.bridgeReach - cutR);
  const ey0 = fromY * (b.bridgeReach - cutR);
  const ex1 = toX * (b.bridgeReach - cutR);
  const ey1 = toY * (b.bridgeReach - cutR);
  const len = (b.bridgeReach - cutR) ** 2;
  const reach = r + b.margin;
  const dx = 2 / g.w;
  const x0 = -1 + dx / 2;
  const jLo = spanLo(by - reach, g.dy, g.y0);
  const jHi = spanHi(by + reach, g.dy, g.y0, g.rows);
  const iLo = spanLo(bx - reach, dx, x0);
  const iHi = spanHi(bx + reach, dx, x0, g.w);
  for (let j = jLo; j < jHi; j++) {
    const y = g.y0 + j * g.dy;
    const oy = y - by;
    for (let i = iLo; i < iHi; i++) {
      const x = x0 + i * dx;
      const ox = x - bx;
      const rho = Math.sqrt(ox * ox + oy * oy);
      const cell = j * g.w + i;
      if (!(rho < reach)) {
        field[cell] = rho - r;
        continue;
      }
      // Within the crescent's sweep (under half a turn): past its start and short of its end.
      const pastStart = fromX * oy - fromY * ox >= 0;
      const shortOfEnd = ox * toY - oy * toX >= 0;
      const arc = Math.abs(rho - cutR);
      const caps = Math.sqrt(
        Math.min((x - ax0) ** 2 + (y - ay0) ** 2, (x - ax1) ** 2 + (y - ay1) ** 2),
      );
      const crescent = (pastStart && shortOfEnd ? arc : caps) - cutHalf;
      const t0 = Math.min(1, Math.max(0, ((x - ax0) * ex0 + (y - ay0) * ey0) / len));
      const t1 = Math.min(1, Math.max(0, ((x - ax1) * ex1 + (y - ay1) * ey1) / len));
      const bridge0 = Math.sqrt((x - ax0 - ex0 * t0) ** 2 + (y - ay0 - ey0 * t0) ** 2) - bridgeHalf;
      const bridge1 = Math.sqrt((x - ax1 - ex1 * t1) ** 2 + (y - ay1 - ey1 * t1) ** 2) - bridgeHalf;
      field[cell] = Math.max(rho - r, -Math.min(crescent, bridge0, bridge1));
    }
  }
}

/** The bomb's neck, a rounded bar tilted over the ball's upper right, over the ball's field. */
function inkNeck(field: Float64Array, g: MarkGrid): void {
  const b = TURRET_KEG_BOMB;
  const nx = b.neckX;
  const ny = b.neckY;
  const c = Math.cos(b.neckTilt);
  const s = Math.sin(b.neckTilt);
  const round = b.neckRound;
  const hl = b.neckLong / 2 - round;
  const hs = b.neckShort / 2 - round;
  const reach = Math.hypot(b.neckLong, b.neckShort) / 2 + b.margin;
  const dx = 2 / g.w;
  const x0 = -1 + dx / 2;
  const jLo = spanLo(ny - reach, g.dy, g.y0);
  const jHi = spanHi(ny + reach, g.dy, g.y0, g.rows);
  const iLo = spanLo(nx - reach, dx, x0);
  const iHi = spanHi(nx + reach, dx, x0, g.w);
  for (let j = jLo; j < jHi; j++) {
    const ny0 = g.y0 + j * g.dy - ny;
    for (let i = iLo; i < iHi; i++) {
      const nx0 = x0 + i * dx - nx;
      const qx = Math.abs(nx0 * c + ny0 * s) - hl;
      const qy = Math.abs(-nx0 * s + ny0 * c) - hs;
      const outX = Math.max(qx, 0);
      const outY = Math.max(qy, 0);
      const neck = Math.sqrt(outX * outX + outY * outY) + Math.min(Math.max(qx, qy), 0) - round;
      const cell = j * g.w + i;
      field[cell] = Math.min(field[cell], neck);
    }
  }
}

/** The dashed fuse: each texel near it measures the segments its row comes near. */
function inkFuse(field: Float64Array, g: MarkGrid): void {
  const b = TURRET_KEG_BOMB;
  const { points, along } = fusePath();
  const segments = points.length / 2 - 1;
  const half = b.fuseWidth / 2;
  const reach = half + b.margin;
  const dash = b.dash;
  const period = b.dash + b.gap;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let k = 0; k <= segments; k++) {
    low = Math.min(low, points[k * 2 + 1]);
    high = Math.max(high, points[k * 2 + 1]);
  }
  const dx = 2 / g.w;
  const x0 = -1 + dx / 2;
  const jLo = spanLo(low - reach, g.dy, g.y0);
  const jHi = spanHi(high + reach, g.dy, g.y0, g.rows);
  const near = new Int32Array(segments);
  for (let j = jLo; j < jHi; j++) {
    const y = g.y0 + j * g.dy;
    let count = 0;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < segments; k++) {
      const ay = points[k * 2 + 1];
      const by = points[k * 2 + 3];
      const inReach = y > Math.min(ay, by) - reach && y < Math.max(ay, by) + reach;
      near[count] = k;
      count += inReach ? 1 : 0;
      left = inReach ? Math.min(left, points[k * 2], points[k * 2 + 2]) : left;
      right = inReach ? Math.max(right, points[k * 2], points[k * 2 + 2]) : right;
    }
    if (count === 0) continue;
    const iLo = spanLo(left - reach, dx, x0);
    const iHi = spanHi(right + reach, dx, x0, g.w);
    for (let i = iLo; i < iHi; i++) {
      const x = x0 + i * dx;
      let best = Number.POSITIVE_INFINITY;
      let at = 0;
      for (let n = 0; n < count; n++) {
        const k = near[n];
        const ax = points[k * 2];
        const ay = points[k * 2 + 1];
        const ex = points[k * 2 + 2] - ax;
        const ey = points[k * 2 + 3] - ay;
        const t = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
        const gx = x - ax - ex * t;
        const gy = y - ay - ey * t;
        const dist = gx * gx + gy * gy;
        const closer = dist < best;
        at = closer ? along[k] + (along[k + 1] - along[k]) * t : at;
        best = closer ? dist : best;
      }
      const phase = at % period;
      const inDash = -Math.min(phase, dash - phase);
      const inGap = Math.min(phase - dash, period - phase);
      const along2 = phase < dash ? inDash : inGap;
      const cell = j * g.w + i;
      field[cell] = Math.min(field[cell], Math.max(Math.sqrt(best) - half, along2));
    }
  }
}

/** How much of the paint a worn patch keeps at facet shares (u, v): streaks along the grain, gathered in patches. */
function wearKeep(wear: KegWear, u: number, v: number): number {
  const patch = smoothstep((noiseAt(wear.patches, u, v) - 0.4) / 0.25);
  return 1 - PAINT_WEAR * patch * smoothstep((noiseAt(wear.streaks, u, v) - 0.55) / 0.15);
}

interface KegWear {
  streaks: NoiseLattice;
  patches: NoiseLattice;
}

/**
 * The stencil black from the paint's distance field: a soft overspray round
 * and under it, the paint over that with a wandering edge, worn off in
 * streaks along the grain where a patch of wear lies.
 */
function paintKegInk(data: Uint8Array, field: Float64Array, g: MarkGrid, wear: KegWear): void {
  const b = TURRET_KEG_BOMB;
  const wobble = noiseLattice(10, 12, 263);
  const wood = new Float64Array(3);
  const aa = 2.4 / g.w;
  const reach = b.margin;
  const strength = b.sprayStrength;
  const sprayIn = -2 * b.spray;
  const sprayOut = 4 * b.spray;
  const dx = 2 / g.w;
  const x0 = -1 + dx / 2;
  for (let j = 0; j < g.rows; j++) {
    const y = g.y0 + j * g.dy;
    const v = 0.5 * (y / TURRET_KEG_BARE_ASPECT + 1);
    turretKegWoodInto(wood, y);
    const row = j * g.w;
    for (let i = 0; i < g.w; i++) {
      const d = field[row + i];
      if (!(d < reach)) continue;
      const u = 0.5 * (x0 + i * dx + 1);
      const keep = wearKeep(wear, u, v);
      const spray = strength * (1 - smoothstep((d - sprayIn) / sprayOut));
      // The stencil's edge wanders a little; the overspray under it does not.
      const edge = d + PAINT_WOBBLE * (2 * noiseAt(wobble, u, v) - 1);
      const paint = Math.min(1, Math.max(0, 0.5 - edge / aa)) * keep;
      const ink = spray + (1 - spray) * paint;
      const at = (g.markRow * g.w + row + i) * 4;
      data[at] = wood[0] + (BOMB_INK[0] - wood[0]) * ink + 0.5;
      data[at + 1] = wood[1] + (BOMB_INK[1] - wood[1]) * ink + 0.5;
      data[at + 2] = wood[2] + (BOMB_INK[2] - wood[2]) * ink + 0.5;
    }
  }
}

/** The spark's yellow star, then its paler heart, over whatever lies under them (the fuse's end). */
function paintKegSpark(data: Uint8Array, g: MarkGrid, wear: KegWear): void {
  const b = TURRET_KEG_BOMB;
  const reach = 1 + b.jitter;
  const spark = starOutline(
    b.sparkX,
    b.sparkY,
    b.sparkPoints,
    b.sparkOuter,
    b.sparkInner,
    b.sparkTurn,
    SPARK_SALT,
  );
  paintKegStar(data, g, wear, spark, b.sparkOuter * reach, SPARK);
  const heart = starOutline(
    b.sparkX,
    b.sparkY,
    b.heartPoints,
    b.heartOuter,
    b.heartInner,
    b.heartTurn,
    HEART_SALT,
  );
  paintKegStar(data, g, wear, heart, b.heartOuter * reach, SPARK_HEART);
}

/** One star outline filled in `colour` round the spark's centre, out to `reach`, worn like the paint. */
function paintKegStar(
  data: Uint8Array,
  g: MarkGrid,
  wear: KegWear,
  outline: Float64Array,
  reach: number,
  colour: readonly number[],
): void {
  const b = TURRET_KEG_BOMB;
  const aa = 2.4 / g.w;
  const out = reach + aa;
  const dx = 2 / g.w;
  const x0 = -1 + dx / 2;
  const jLo = spanLo(b.sparkY - out, g.dy, g.y0);
  const jHi = spanHi(b.sparkY + out, g.dy, g.y0, g.rows);
  const iLo = spanLo(b.sparkX - out, dx, x0);
  const iHi = spanHi(b.sparkX + out, dx, x0, g.w);
  for (let j = jLo; j < jHi; j++) {
    const y = g.y0 + j * g.dy;
    const v = 0.5 * (y / TURRET_KEG_BARE_ASPECT + 1);
    const oy = y - b.sparkY;
    for (let i = iLo; i < iHi; i++) {
      const x = x0 + i * dx;
      const ox = x - b.sparkX;
      if (ox * ox + oy * oy > out * out) continue;
      const fill =
        Math.min(1, Math.max(0, 0.5 - outlineDistance(outline, x, y) / aa)) *
        wearKeep(wear, 0.5 * (x + 1), v);
      const at = ((g.markRow + j) * g.w + i) * 4;
      data[at] += (colour[0] - data[at]) * fill + 0.5;
      data[at + 1] += (colour[1] - data[at + 1]) * fill + 0.5;
      data[at + 2] += (colour[2] - data[at + 2]) * fill + 0.5;
    }
  }
}

export const TURRET_BARREL_LOOK = {
  /** Seconds a new barrel takes to pop up to its size (a little over on the way). */
  popSeconds: 0.35,
  /** The warning ring on the ground: its outer radius (yd), its band's inner edge as a share of it, and its lift. */
  ringRadius: 1.35,
  ringInner: 0.74,
  ringLift: 0.08,
  /** An unlit ring breathes gently; a lit one throbs fast and wide until the blast. */
  ringPulse: 0.05,
  ringHz: 0.7,
  litRingPulse: 0.22,
  litRingHz: 7,
  /** The fuse's shake at its end: offset (yd), tilt (rad), and how fast it rattles. */
  shakeOffset: 0.06,
  shakeTilt: 0.1,
  shakeHz: 26,
  /** How much the keg swells by the end of the fuse, as a share of its size. */
  swell: 0.1,
  /** The cannon's blast drawn this much bigger than a shell's (flash, fireball, dust, shake). */
  blastScale: 1.4,
} as const;

/** How far the wick's tip rises over a fuse as the keg swells from its foot (yd). */
const WICK_TIP_SWELL_RISE = wickTip.y * TURRET_BARREL_LOOK.swell;

/** The keg's shards: pieces per blast, blasts whose shards fly at once, their life and pull. */
export const TURRET_BARREL_SHARDS = { perBlast: 10, pool: 6, life: 2.6, gravity: 26 } as const;

/** Cosmetic counts per blast and per fuse. The low preset sheds these only; the warning ring,
 *  the fuse's glow and the cannon blast's fixed pieces are the same on every tier. */
export interface TurretBarrelCounts {
  fuseSparks: number;
  embers: number;
  shards: number;
}

const FULL_COUNTS: Readonly<TurretBarrelCounts> = { fuseSparks: 12, embers: 12, shards: 10 };
const LOW_COUNTS: Readonly<TurretBarrelCounts> = { fuseSparks: 5, embers: 5, shards: 5 };

export function turretBarrelCounts(low: boolean): Readonly<TurretBarrelCounts> {
  return low ? LOW_COUNTS : FULL_COUNTS;
}

/** The fire column's fixed part: rising fireballs and the bright flame core. */
export const TURRET_BARREL_FIREBALLS = 10;
export const TURRET_BARREL_FLAMES = 8;
/** The fuse's fixed part: the hot glow at the wick's tip and two flame licks. */
export const TURRET_FUSE_FIXED_PUFFS = 3;
/** The most puffs one fuse and one blast's fire column launch (the full counts). */
export const TURRET_FUSE_PUFFS = TURRET_FUSE_FIXED_PUFFS + FULL_COUNTS.fuseSparks;
export const TURRET_BARREL_FIRE_PUFFS =
  TURRET_BARREL_FIREBALLS + TURRET_BARREL_FLAMES + FULL_COUNTS.embers;

const TAU = Math.PI * 2;
const NO_FLOOR = Number.NEGATIVE_INFINITY;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function smoothstep(n: number): number {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
}

/** A new barrel's size, 0 to 1 and a little over on the way, `age` seconds after it was first drawn. */
export function turretBarrelPop(age: number): number {
  if (!(age > 0)) return 0;
  const u = age / TURRET_BARREL_LOOK.popSeconds;
  if (u >= 1) return 1;
  const c = 1.7;
  const t = u - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
}

/** The warning ring's radius at frame seconds `time`; `litAge` is the fuse's age, or null while unlit. */
export function turretBarrelRingRadius(time: number, litAge: number | null, seed: number): number {
  const look = TURRET_BARREL_LOOK;
  if (litAge === null) {
    const phase = cannonHash01(seed, 1) * TAU;
    return look.ringRadius * (1 + look.ringPulse * Math.sin(TAU * look.ringHz * time + phase));
  }
  const beat = 0.5 - 0.5 * Math.cos(TAU * look.litRingHz * Math.max(0, litAge));
  return look.ringRadius * (1 + look.litRingPulse * beat);
}

export interface TurretBarrelFuseFrame {
  dx: number;
  dz: number;
  tiltX: number;
  tiltZ: number;
  /** A multiplier on the keg's size. */
  swell: number;
}

export function newTurretBarrelFuseFrame(): TurretBarrelFuseFrame {
  return { dx: 0, dz: 0, tiltX: 0, tiltZ: 0, swell: 1 };
}

/** The keg rattling harder and swelling as its fuse of `fuse` seconds burns down, `age` seconds in. */
export function turretBarrelFuseInto(
  out: TurretBarrelFuseFrame,
  age: number,
  fuse: number,
  seed: number,
): TurretBarrelFuseFrame {
  const look = TURRET_BARREL_LOOK;
  const u = fuse > 0 ? clamp01(age / fuse) : 1;
  const k = 0.35 + 0.65 * u;
  const w = TAU * look.shakeHz * Math.max(0, age);
  // Called per lit barrel per frame: no closure, the hash is inlined.
  out.dx = look.shakeOffset * k * Math.sin(w + cannonHash01(seed, 10) * TAU);
  out.dz = look.shakeOffset * k * Math.sin(1.37 * w + cannonHash01(seed, 11) * TAU);
  out.tiltX = look.shakeTilt * k * Math.sin(1.13 * w + cannonHash01(seed, 12) * TAU);
  out.tiltZ = look.shakeTilt * k * Math.sin(0.91 * w + cannonHash01(seed, 13) * TAU);
  out.swell = 1 + look.swell * smoothstep(u);
  return out;
}

/**
 * Launches a lit fuse's puffs into `out` from index 0 and returns how many: a
 * hot glow on the wick's tip at (x, tipY, z) for the whole fuse and two flame
 * licks (every tier), then `sparks` sparks spraying up and out of the tip,
 * spread over the fuse. The tip is where it stands when the keg is lit; each
 * puff starts where the swelling keg has lifted it by then, and the glow rises
 * with it. `floorY` is the ground the sparks come to rest on.
 */
export function turretFuseSparksInto(
  out: CannonPuff[],
  seed: number,
  x: number,
  tipY: number,
  z: number,
  floorY: number,
  fuse: number,
  sparks: number,
): number {
  const h = (i: number, k: number): number => cannonHash01(seed ^ 0x5f3a, i * 8 + k);
  const lift = (delay: number): number =>
    fuse > 0 ? WICK_TIP_SWELL_RISE * smoothstep(delay / fuse) : 0;
  let n = 0;
  cannonPuffLaunch(
    out[n++],
    PUFF.glow,
    x,
    tipY + 0.04,
    z,
    0,
    fuse > 0 ? WICK_TIP_SWELL_RISE / fuse : 0,
    0,
    0,
    0,
    0.8,
    1.5,
    fuse + 0.04,
    0,
    h(0, 0) * TAU,
    0,
    NO_FLOOR,
  );
  for (let i = 0; i < 2; i++) {
    const delay = i * fuse * 0.45;
    cannonPuffLaunch(
      out[n++],
      PUFF.flame,
      x,
      tipY + 0.02 + lift(delay),
      z,
      (h(1 + i, 0) - 0.5) * 0.6,
      2.2 + 1.6 * h(1 + i, 1),
      (h(1 + i, 2) - 0.5) * 0.6,
      2,
      0,
      0.45,
      0.85,
      0.16 + 0.06 * h(1 + i, 3),
      delay,
      h(1 + i, 4) * TAU,
      0,
      NO_FLOOR,
    );
  }
  const count = Math.max(0, Math.min(out.length - n, sparks));
  for (let i = 0; i < count; i++) {
    const a = h(10 + i, 0) * TAU;
    const speed = 2.5 + 3.5 * h(10 + i, 1);
    const delay = (i / Math.max(1, count)) * fuse;
    cannonPuffLaunch(
      out[n++],
      PUFF.spark,
      x + Math.sin(a) * 0.03,
      tipY + lift(delay),
      z + Math.cos(a) * 0.03,
      Math.sin(a) * speed,
      3 + 4 * h(10 + i, 2),
      Math.cos(a) * speed,
      1.2,
      14,
      0.26 + 0.12 * h(10 + i, 3),
      0.06,
      0.35 + 0.25 * h(10 + i, 4),
      delay,
      0,
      0,
      floorY + 0.05,
    );
  }
  return n;
}

/**
 * Writes entries `first` to `first + count - 1` of a barrel blast's fire
 * column into `out` from index 0 and returns how many it wrote: fireballs
 * rising in a tall column and cooling into faint smoke, a bright flame core
 * bursting up (every tier), then `embers` embers flung high and falling. The
 * column spans more puffs than one pooled burst holds, so a caller fills
 * several bursts from successive ranges of the same recipe.
 */
export function turretBarrelFireInto(
  out: CannonPuff[],
  first: number,
  count: number,
  seed: number,
  x: number,
  y: number,
  z: number,
  floorY: number,
  embers: number,
): number {
  const h = (i: number, k: number): number => cannonHash01(seed ^ 0x7e11, i * 12 + k);
  const total = TURRET_BARREL_FIREBALLS + TURRET_BARREL_FLAMES + Math.max(0, embers);
  const end = Math.min(total, first + Math.min(count, out.length));
  let n = 0;
  for (let i = Math.max(0, first); i < end; i++) {
    const p = out[n++];
    if (i < TURRET_BARREL_FIREBALLS) {
      const k = i / TURRET_BARREL_FIREBALLS;
      const a = h(i, 0) * TAU;
      const r = 0.3 + 0.5 * h(i, 1);
      const spread = 0.8 + 1.2 * h(i, 2);
      cannonPuffLaunch(
        p,
        PUFF.fireball,
        x + Math.sin(a) * r,
        y + 0.6 + 0.4 * k,
        z + Math.cos(a) * r,
        Math.sin(a) * spread,
        5 + 7 * k + 2 * h(i, 3),
        Math.cos(a) * spread,
        1.8,
        -2.5,
        1.2 + 0.5 * h(i, 4),
        3.2 + 1.6 * h(i, 5),
        1 + 0.5 * h(i, 6),
        0.02 * i,
        h(i, 7) * TAU,
        (h(i, 8) - 0.5) * 1.2,
        NO_FLOOR,
      );
    } else if (i < TURRET_BARREL_FIREBALLS + TURRET_BARREL_FLAMES) {
      // The column itself: flame tongues shot up one after another, the later
      // ones faster, so the fire stands several yards tall for half a second.
      const k = (i - TURRET_BARREL_FIREBALLS) / TURRET_BARREL_FLAMES;
      const a = h(i, 0) * TAU;
      cannonPuffLaunch(
        p,
        PUFF.flame,
        x + Math.sin(a) * 0.25,
        y + 0.7,
        z + Math.cos(a) * 0.25,
        Math.sin(a) * 0.9,
        8 + 8 * k + 2 * h(i, 1),
        Math.cos(a) * 0.9,
        1.6,
        0,
        1.8 + 0.5 * h(i, 2),
        3.4 + 1 * h(i, 3),
        0.5 + 0.3 * h(i, 4),
        0.12 * k,
        h(i, 5) * TAU,
        0,
        NO_FLOOR,
      );
    } else {
      const a = h(i, 0) * TAU;
      const speed = 6 + 6 * h(i, 1);
      cannonPuffLaunch(
        p,
        PUFF.spark,
        x,
        y + 1,
        z,
        Math.sin(a) * speed,
        8 + 7 * h(i, 2),
        Math.cos(a) * speed,
        0.6,
        16,
        0.5 + 0.2 * h(i, 3),
        0.1,
        0.9 + 0.6 * h(i, 4),
        0.03 * h(i, 5),
        0,
        0,
        floorY + 0.05,
      );
    }
  }
  return n;
}

/** The most puffs a blast's fire column launches for `embers` embers. */
export function turretBarrelFirePuffs(embers: number): number {
  return TURRET_BARREL_FIREBALLS + TURRET_BARREL_FLAMES + Math.max(0, embers);
}

/** Seconds after the event by which every one of `count` launched puffs is spent. */
export function turretPuffsEnd(puffs: readonly CannonPuff[], count: number): number {
  let end = 0;
  for (let i = 0; i < count; i++) end = Math.max(end, puffs[i].delay + puffs[i].life);
  return end;
}

/** A shard whose shade is under this is a piece of an iron band; above it, a stave. */
export const TURRET_SHARD_BAND_SHADE = 0.35;

export interface TurretShard {
  startX: number;
  startY: number;
  startZ: number;
  vx: number;
  vz: number;
  lift: number;
  /** Seconds until it comes down on `floorY`; it lies there afterwards. */
  landAt: number;
  floorY: number;
  spin: number;
  axisX: number;
  axisY: number;
  axisZ: number;
  /** Its plate's width, thickness and height (yd). */
  sx: number;
  sy: number;
  sz: number;
  /** 0 to 1: which piece of the keg it is: 0 the lid, under TURRET_SHARD_BAND_SHADE a band, then darker to lighter staves. */
  shade: number;
}

export function newTurretShard(): TurretShard {
  return {
    startX: 0,
    startY: 0,
    startZ: 0,
    vx: 0,
    vz: 0,
    lift: 0,
    landAt: 0,
    floorY: 0,
    spin: 0,
    axisX: 1,
    axisY: 0,
    axisZ: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    shade: 0,
  };
}

function landTime(lift: number, startY: number, floorY: number): number {
  const g = TURRET_BARREL_SHARDS.gravity;
  const disc = lift * lift + 2 * g * (startY - floorY);
  if (disc <= 0) return lift / g;
  return (lift + Math.sqrt(disc)) / g;
}

/**
 * Launches shard `index` of `count` off a keg blowing at (x, y, z): torn
 * around the keg, thrown out and high at a hashed speed, tumbling about a
 * hashed axis; the first one is the lid. The floor it lands on is sampled
 * once, under where it comes down.
 */
export function turretShardLaunch(
  out: TurretShard,
  seed: number,
  index: number,
  count: number,
  x: number,
  y: number,
  z: number,
  ground: (x: number, z: number) => number,
): TurretShard {
  const h = (k: number): number => cannonHash01(seed ^ 0x3d27, index * 13 + k);
  const angle = ((index + 0.8 * (h(0) - 0.5)) / Math.max(1, count)) * TAU;
  const speed = 5 + 7 * h(1);
  out.vx = Math.sin(angle) * speed;
  out.vz = Math.cos(angle) * speed;
  out.startX = x + Math.sin(angle) * 0.4;
  out.startY = y + 0.4 + 0.8 * h(2);
  out.startZ = z + Math.cos(angle) * 0.4;
  out.lift = index === 0 ? 17 : 8 + 8 * h(3);
  out.spin = 7 + 11 * h(4);
  const ax = h(5) - 0.5;
  const ay = h(6) - 0.5;
  const az = h(7) - 0.5;
  const len = Math.hypot(ax, ay, az);
  out.axisX = len > 1e-6 ? ax / len : 1;
  out.axisY = len > 1e-6 ? ay / len : 0;
  out.axisZ = len > 1e-6 ? az / len : 0;
  if (index === 0) {
    out.sx = 0.72;
    out.sy = 0.06;
    out.sz = 0.72;
    out.shade = 0;
  } else {
    out.sx = 0.28 + 0.25 * h(8);
    out.sy = 0.05;
    out.sz = 0.4 + 0.35 * h(9);
    out.shade = 0.2 + 0.8 * h(10);
  }
  const guess = landTime(out.lift, out.startY, y);
  const floor = ground(out.startX + out.vx * guess, out.startZ + out.vz * guess);
  out.floorY = (Number.isFinite(floor) ? floor : y) + out.sy * 0.5;
  out.landAt = landTime(out.lift, out.startY, out.floorY);
  return out;
}

export interface TurretShardFrame {
  x: number;
  y: number;
  z: number;
  /** Tumble angle about the shard's axis (rad): it stops turning when it lands. */
  angle: number;
  /** Its size multiplier, shrinking away at the end of its life. */
  scale: number;
}

/** A shard `age` seconds into its flight; false before and after its life. */
export function turretShardInto(shard: TurretShard, age: number, out: TurretShardFrame): boolean {
  const life = TURRET_BARREL_SHARDS.life;
  if (!(age >= 0) || age >= life) return false;
  const t = Math.min(age, shard.landAt);
  out.x = shard.startX + shard.vx * t;
  out.z = shard.startZ + shard.vz * t;
  out.y =
    age < shard.landAt
      ? shard.startY + shard.lift * age - 0.5 * TURRET_BARREL_SHARDS.gravity * age * age
      : shard.floorY;
  out.angle = shard.spin * t;
  out.scale = 1 - smoothstep((age - 0.7 * life) / (0.3 * life));
  return true;
}
