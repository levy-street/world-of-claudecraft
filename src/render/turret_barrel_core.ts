// Fire and Fly explosive barrels on screen, the pure half: the powder keg's
// shape and where its painted flame and its wick sit, the flame mark's texels,
// a new keg's pop up, its warning ring's breathing, the shake and swell
// through the fuse, the sparks the fuse throws from the wick's tip, the tall
// fire column of its blast and the keg's shards flying off. The Three
// consumer is turret_barrel_visual.ts; the blast's flash, fireball, shock
// ring, dust, dirt and scorch are the cannon's own (cannon_shell_visuals.ts),
// drawn wider and hotter.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (every spread is a
// hash of the barrel and the index) and allocation-free per frame.

import { TURRET_EXPLOSIVE_BARREL } from '../sim/content/turret_defense';
import {
  type CannonPuff,
  cannonHash01,
  cannonNoiseInto,
  cannonPuffLaunch,
  PUFF,
} from './cannon_puff_core';

/** The faceted powder keg of the cannon tower's own kit. */
export const TURRET_BARREL_MODEL_URL = '/models/biome/hex_barrel.glb';

/**
 * hex_barrel.glb as the visual fits it (TURRET_EXPLOSIVE_BARREL.height tall,
 * its foot on the ground, centred on its axis), in shares of that height:
 * eight flat staves between two iron bands, a bung off the axis on the lid.
 */
export const TURRET_KEG_SHAPE = {
  /** The facet the flame is painted on faces this bearing in the model (x += sin, z += cos): the one beside the bung. */
  markFacet: (3 * Math.PI) / 8,
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
  /** The painted shield's width as a share of its facet's, its height as a share of the bare staves. */
  width: 0.9,
  height: 0.88,
  /** Drawn this far off the facet (yd): no depth fight at the clearing's far side. */
  lift: 0.015,
  /** Texels across the mark's texture; it is twice as tall. */
  texels: 128,
  /** Texture v: the wick's cord below wickTop, the shield above markBottom, clear between. */
  wickTop: 1 / 16,
  markBottom: 1 / 8,
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

/** The painted shield on its facet, in yards of the keg's own frame (before its yaw). */
export const TURRET_KEG_MARK_FRAME = {
  width: TURRET_KEG_MARK.width * TURRET_KEG_SHAPE.facetWidth * KEG_H,
  height: TURRET_KEG_MARK.height * (TURRET_KEG_SHAPE.bareHigh - TURRET_KEG_SHAPE.bareLow) * KEG_H,
  centreY: 0.5 * (TURRET_KEG_SHAPE.bareLow + TURRET_KEG_SHAPE.bareHigh) * KEG_H,
  offset: TURRET_KEG_SHAPE.facetApothem * KEG_H + TURRET_KEG_MARK.lift,
  /** The facet's outward normal, and its right as seen from in front of it. */
  normalX: FACET_X,
  normalZ: FACET_Z,
  sideX: FACET_Z,
  sideZ: -FACET_X,
} as const;

/** The shield's height over its width: its outline spans x in [-1, 1] and y in [-aspect, aspect]. */
export const TURRET_KEG_SHIELD_ASPECT = TURRET_KEG_MARK_FRAME.height / TURRET_KEG_MARK_FRAME.width;

/** The yaw that turns a keg standing at (x, z) so its painted facet faces the tower at (cx, cz). */
export function turretKegYaw(x: number, z: number, cx: number, cz: number): number {
  return Math.atan2(cx - x, cz - z) - TURRET_KEG_SHAPE.markFacet;
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

const SQRT3 = Math.sqrt(3);

/**
 * The shield's outline, counter-clockwise seen from in front, as x, y pairs
 * in its own units (x in [-1, 1], y in [-aspect, aspect]): a heater shield,
 * flat on top, straight sides, then two arcs meeting at a point below.
 */
export function turretKegShieldOutline(perArc: number): number[] {
  const k = TURRET_KEG_SHIELD_ASPECT;
  const mid = SQRT3 - k;
  const n = Math.max(1, Math.floor(perArc));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 3 + (i / n) * (Math.PI / 3);
    out.push(-1 + 2 * Math.cos(a), mid + 2 * Math.sin(a));
  }
  out.push(1, mid, 1, k, -1, k, -1, mid);
  for (let i = 1; i < n; i++) {
    const a = Math.PI + (i / n) * (Math.PI / 3);
    out.push(1 + 2 * Math.cos(a), mid + 2 * Math.sin(a));
  }
  return out;
}

/** Signed distance to the shield's outline, in its own units: negative inside. */
function shieldDistance(x: number, y: number): number {
  const k = TURRET_KEG_SHIELD_ASPECT;
  const mid = SQRT3 - k;
  if (y >= mid) return Math.max(Math.abs(x) - 1, y - k);
  return Math.max(Math.hypot(x + 1, y - mid) - 2, Math.hypot(x - 1, y - mid) - 2, y - k);
}

interface FlameTongue {
  /** The foot of its round bulb, the bulb's radius, and its tip. */
  x0: number;
  y0: number;
  r: number;
  x1: number;
  y1: number;
  /** A sideways sway of its middle. */
  curl: number;
}

const tongue = (x0: number, y0: number, r: number, x1: number, y1: number, curl: number) => ({
  x0,
  y0,
  r,
  x1,
  y1,
  curl,
});

/** The painted flame, in the shield's units: a tall middle tongue and one lick either side. */
const FLAME: readonly FlameTongue[] = [
  tongue(0, -0.88, 0.46, -0.08, 1.02, 0.12),
  tongue(-0.2, -0.8, 0.2, -0.55, 0.3, -0.05),
  tongue(0.2, -0.8, 0.21, 0.52, 0.5, 0.05),
];
const FLAME_CORE = tongue(0, -0.74, 0.26, -0.03, 0.32, 0.06);

/** A tongue's edge above its bulb's middle, `u` of the way to the tip: tapering to a point with hollow flanks. */
function tongueEdge(t: FlameTongue, u: number, side: number): number {
  const c = t.x0 + (t.x1 - t.x0) * u ** 1.6 + t.curl * Math.sin(Math.PI * u);
  return c + side * t.r * (1 - u * u) ** 1.5;
}

/** One tongue's terms along one texel row: all its taper needs depends on the row alone. */
interface TongueRow {
  /** 0 beside its bulb only, 1 along its taper, 2 above its tip. */
  part: number;
  /** The row's height over the bulb's middle, and over the tip. */
  dy: number;
  tipDy: number;
  centre: number;
  left: number;
  right: number;
  /** Each edge's slope term, sqrt(1 + slope^2). */
  leftNorm: number;
  rightNorm: number;
}

const newTongueRow = (): TongueRow => ({
  part: 0,
  dy: 0,
  tipDy: 0,
  centre: 0,
  left: 0,
  right: 0,
  leftNorm: 1,
  rightNorm: 1,
});

function edgeNorm(t: FlameTongue, u: number, du: number, span: number, side: number): number {
  const slope =
    du > 0 ? (tongueEdge(t, u + du, side) - tongueEdge(t, u - du, side)) / (2 * du * span) : 0;
  return Math.sqrt(1 + slope * slope);
}

function tongueRowInto(row: TongueRow, t: FlameTongue, y: number): void {
  const cy = t.y0 + t.r;
  row.dy = y - cy;
  row.tipDy = y - t.y1;
  if (y <= cy) {
    row.part = 0;
    return;
  }
  if (y >= t.y1) {
    row.part = 2;
    return;
  }
  row.part = 1;
  const span = t.y1 - cy;
  const u = (y - cy) / span;
  row.right = tongueEdge(t, u, 1);
  row.left = tongueEdge(t, u, -1);
  row.centre = 0.5 * (row.right + row.left);
  const du = Math.min(1e-3, u, 1 - u);
  row.rightNorm = edgeNorm(t, u, du, span, 1);
  row.leftNorm = edgeNorm(t, u, du, span, -1);
}

/** Signed distance to one tongue on its row, near enough for painting: its round bulb, then its taper's sideways gap eased by the edge's slope. */
function tongueDistance(t: FlameTongue, row: TongueRow, x: number): number {
  const bulb = Math.hypot(x - t.x0, row.dy) - t.r;
  if (row.part === 0) return bulb;
  if (row.part === 2) return Math.min(bulb, Math.hypot(row.tipDy, x - t.x1));
  return x >= row.centre
    ? Math.min(bulb, (x - row.right) / row.rightNorm)
    : Math.min(bulb, -(x - row.left) / row.leftNorm);
}

/** Painted colours (sRGB bytes): the dark outline, the pale field, the flame's three heats, the wick's cord. */
const INK = [43, 26, 16] as const;
const FIELD = [236, 222, 188] as const;
const FLAME_OUTER = [217, 68, 26] as const;
const FLAME_MID = [242, 138, 28] as const;
const FLAME_HOT = [255, 210, 63] as const;
const CORD = [46, 36, 28] as const;
const SHIELD_BORDER = 0.09;
const FLAME_OUTLINE = 0.07;
const FLAME_INSET = 0.12;

/**
 * The flame mark's texture, `texels` wide and twice as tall, row 0 at the
 * bottom (texture v up): the wick's dark cord in a strip along the bottom,
 * then a clear gutter, then a hand-painted heater shield, pale inside a dark
 * border, bearing an orange flame with a yellow heart and a dark outline.
 * Alpha is the shield's coverage (clear around it) and the cord's; RGB past
 * the shield's edge carries its border ink, so no mip level greys the rim.
 */
export function turretKegMarkTexels(texels: number): Uint8Array {
  const w = Math.max(8, Math.floor(texels));
  const h = w * 2;
  const data = new Uint8Array(w * h * 4);
  // One soft octave for the brush's unevenness and one fine one for its grain.
  const brush = cannonNoiseInto(new Float64Array(h * h), h, 6, 83, 1, 1);
  const grain = cannonNoiseInto(new Float64Array(h * h), h, 40, 29, 1, 1);
  // A loop of its own each: one loop crossing from the cord to the shield
  // deoptimized on the way, a cost the page's first paint pays.
  paintKegCord(data, w, grain);
  paintKegShield(data, w, brush, grain);
  return data;
}

function putTexel(data: Uint8Array, at: number, r: number, g: number, b: number, a: number): void {
  data[at] = Math.round(Math.min(255, Math.max(0, r)));
  data[at + 1] = Math.round(Math.min(255, Math.max(0, g)));
  data[at + 2] = Math.round(Math.min(255, Math.max(0, b)));
  data[at + 3] = Math.round(255 * a);
}

/** The wick's cord, twisted in faint diagonal strands, along the bottom; its ink carried on through the clear gutter above. */
function paintKegCord(data: Uint8Array, w: number, grain: Float64Array): void {
  const h = w * 2;
  const wickRows = Math.round(h * TURRET_KEG_MARK.wickTop);
  const markRow = Math.round(h * TURRET_KEG_MARK.markBottom);
  for (let j = 0; j < markRow; j++) {
    for (let i = 0; i < w; i++) {
      const at = (j * w + i) * 4;
      if (j < wickRows) {
        const strand = ((i / w) * 10 + j / wickRows) % 1;
        const fine = grain[j * h + 2 * i] - 0.5;
        const lit = 0.82 + 0.3 * (strand < 0.5 ? strand : 1 - strand) + 0.1 * fine;
        putTexel(data, at, CORD[0] * lit, CORD[1] * lit, CORD[2] * lit, 1);
      } else {
        putTexel(data, at, CORD[0], CORD[1], CORD[2], 0);
      }
    }
  }
}

function paintKegShield(
  data: Uint8Array,
  w: number,
  brush: Float64Array,
  grain: Float64Array,
): void {
  const h = w * 2;
  const markRow = Math.round(h * TURRET_KEG_MARK.markBottom);
  const rows = h - markRow;
  const k = TURRET_KEG_SHIELD_ASPECT;
  const aa = 1.2 / w;
  const cover = (d: number): number => {
    const c = 0.5 - d / aa;
    return c < 0 ? 0 : c > 1 ? 1 : c;
  };
  const rgb = [0, 0, 0];
  const over = (colour: readonly number[], a: number): void => {
    for (let c = 0; c < 3; c++) rgb[c] += (colour[c] - rgb[c]) * a;
  };
  const flameRows = FLAME.map(newTongueRow);
  const coreRow = newTongueRow();
  for (let j = markRow; j < h; j++) {
    const y = (((j - markRow + 0.5) / rows) * 2 - 1) * k;
    for (let t = 0; t < FLAME.length; t++) tongueRowInto(flameRows[t], FLAME[t], y);
    tongueRowInto(coreRow, FLAME_CORE, y);
    for (let i = 0; i < w; i++) {
      const noise = brush[j * h + 2 * i] - 0.5;
      const x = ((i + 0.5) / w) * 2 - 1;
      const d = shieldDistance(x, y);
      // The border's inner edge wanders a little, as a brush's would; its
      // outer edge is the shield's own, the mesh's silhouette.
      const border = cover(-(d + SHIELD_BORDER + 0.025 * noise));
      // Wholly under the border's ink: nothing beneath it shows.
      if (border === 1) {
        rgb[0] = INK[0];
        rgb[1] = INK[1];
        rgb[2] = INK[2];
      } else {
        const tone = 1 + 0.08 * noise + 0.06 * (grain[j * h + 2 * i] - 0.5);
        rgb[0] = FIELD[0] * tone;
        rgb[1] = FIELD[1] * tone;
        rgb[2] = FIELD[2] * tone;
        let df = Number.POSITIVE_INFINITY;
        for (let t = 0; t < FLAME.length; t++) {
          df = Math.min(df, tongueDistance(FLAME[t], flameRows[t], x));
        }
        df += 0.05 * noise;
        over(INK, cover(df - FLAME_OUTLINE));
        over(FLAME_OUTER, cover(df));
        over(FLAME_MID, cover(df + FLAME_INSET));
        over(FLAME_HOT, cover(tongueDistance(FLAME_CORE, coreRow, x) + 0.04 * noise));
        over(INK, border);
      }
      putTexel(data, (j * w + i) * 4, rgb[0], rgb[1], rgb[2], cover(d));
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
