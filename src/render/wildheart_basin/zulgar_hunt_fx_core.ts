// Pure plan for the three additions of Zulgar's hunt rework (their painters:
// zulgar_glyph_fx.ts, zulgar_spear_fx.ts, idol_breath_fx.ts, composed by
// zulgar_hunt_fx.ts):
//  - a sun glyph's four looks (dark, being lit, cold, lit), read off its
//    encounter object's template and its own clock, so "lit" is a pillar of
//    gold light and "dark" is no light at all, from any camera;
//  - the Sunstruck window on the boss (a gold ring draining under him, the
//    spirit jaguar burning gold while it is open);
//  - the Hunting Spear standing in the terrace: its shape, how it drives in
//    and quivers, where its cord ties on;
//  - the Idol's Breath: the half of the terrace it marks (the terrace polygon
//    cut on the sim's own centre line), the warning's fill, the pour's
//    timeline, the stone jaguar's eyes and throat.
// Every size is the sim's (ids.ts ZULGAR_TUNING, the layout's terrace); the
// looks only say how bright each layer draws.
//
// Three-free, DOM-free, deterministic.

import { JAGUAR_MAW, SHRINE_TERRACE } from '../../sim/content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  type IdolBreathSide,
  WILDHEART_DUNGEON,
  WILDHEART_GLYPH_COLD,
  WILDHEART_GLYPH_KINDLE,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_TUNING,
} from '../../sim/encounters/wildheart_basin/ids';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import { BASIN_ACCENTS } from './basin_fx_core';

// ---- the sun glyphs ------------------------------------------------------------------

/** What a glyph is doing: `dark` (it may be lit), `kindling` (a player stands
 *  lighting it), `cold` (it just struck him and cannot be lit yet), `lit`. */
export type GlyphPhase = 'dark' | 'kindling' | 'cold' | 'lit';

/** A glyph object's phase off its template and its clock's cast id (null when
 *  the object is not a sun glyph). */
export function glyphPhase(
  templateId: string,
  clock: string | null | undefined,
): GlyphPhase | null {
  if (templateId === WILDHEART_SUN_GLYPH_LIT) return 'lit';
  if (templateId !== WILDHEART_SUN_GLYPH_DARK) return null;
  if (clock === WILDHEART_GLYPH_KINDLE) return 'kindling';
  return clock === WILDHEART_GLYPH_COLD ? 'cold' : 'dark';
}

/** How much of a clock is left (1 as it opens, 0 as it ends). */
export function clockLeft(
  castRemaining: number | undefined,
  castTotal: number | undefined,
): number {
  const total = castTotal ?? 0;
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, (castRemaining ?? 0) / total));
}

/** The colours a glyph burns in (linear 0..1). */
export const GLYPH_COLORS = {
  /** Sunlight: a lit glyph and the ring that fills as one is lit. */
  gold: [1, 0.8, 0.36],
  /** A spent glyph's dying ember. */
  ember: [0.95, 0.28, 0.1],
} as const;

/** The dark veil's disc over the carved glyph, as a share of its radius: the
 *  carving is gold paint on the floor, so a dark glyph is veiled in ash. */
export const GLYPH_VEIL_SCALE = 1.1;
/** A lit glyph's shaft of sunlight (yards tall). */
export const GLYPH_SHAFT_HEIGHT = 13;

export interface GlyphLook {
  /** 0 dark, 1 lit: the gold disc and its rays. */
  lit: number;
  /** The ash veil over the carving (1 fully dark, 0 gone). */
  veil: number;
  /** The ring round its rim: how far round it is drawn (0..1). */
  arc: number;
  /** The ring's colour: 0 gold (filling as it is lit), 1 ember (draining
   *  while it is cold). */
  arcEmber: number;
  /** The halo over it (0 hidden) and whether it is the ember's. */
  halo: number;
  haloEmber: number;
  /** The shaft of sunlight standing on it (0 hidden), and how much of its
   *  full height it has reached (it rises as the glyph is lit). */
  shaft: number;
  shaftRise: number;
  /** Gold sparks a second (cosmetic), and grey smoke a second. */
  sparks: number;
  smoke: number;
}

export function newGlyphLook(): GlyphLook {
  return {
    lit: 0,
    veil: 1,
    arc: 0,
    arcEmber: 0,
    halo: 0,
    haloEmber: 0,
    shaft: 0,
    shaftRise: 0,
    sparks: 0,
    smoke: 0,
  };
}

/**
 * A glyph's look, written into `out` (a painter passes one reused object).
 * `left` is its clock's share left (clockLeft), `t` the painter's clock.
 * The four phases never share a read: lit is the only one with a gold disc
 * under a full shaft; dark is veiled and unlit; kindling grows a gold ring
 * round the rim while a pillar of light climbs out of it; cold shows an ember
 * ring burning down.
 */
export function glyphLookInto(
  out: GlyphLook,
  phase: GlyphPhase,
  left: number,
  t: number,
): GlyphLook {
  const beat = 0.5 + 0.5 * Math.sin(t * 1.7);
  out.arcEmber = 0;
  out.haloEmber = 0;
  out.smoke = 0;
  if (phase === 'lit') {
    out.lit = 1;
    out.veil = 0;
    out.arc = 1;
    out.halo = 0.55 + 0.15 * beat;
    out.shaft = 0.4 + 0.1 * beat;
    out.shaftRise = 1;
    out.sparks = 6;
    return out;
  }
  out.lit = 0;
  out.shaft = 0;
  out.shaftRise = 0;
  if (phase === 'kindling') {
    const progress = 1 - left;
    // The ring fills round the rim, a pillar of light climbs out of the glyph
    // and the ash thins as the light takes.
    out.arc = progress;
    out.veil = 1 - 0.6 * progress;
    out.halo = 0.2 + 0.45 * progress;
    out.shaft = 0.16 + 0.24 * progress;
    out.shaftRise = 0.12 + 0.6 * progress;
    out.sparks = 6 + 18 * progress;
    return out;
  }
  out.veil = 1;
  out.sparks = 0;
  if (phase === 'cold') {
    out.arc = left;
    out.arcEmber = 1;
    out.halo = 0.08 + 0.14 * left;
    out.haloEmber = 1;
    out.smoke = 1.5 + 3 * left;
    return out;
  }
  out.arc = 0;
  out.halo = 0;
  return out;
}

// ---- the Sunstruck window ---------------------------------------------------------------

/** The gold ring under a Sunstruck Zulgar (yards): wider than the spirit
 *  jaguar's flanks, so it reads round the body from above. */
export const SUNSTRUCK_RING_RADIUS = 5.5;

/** The window's floor ring: its fill is the share of the window left (it
 *  drains to nothing as the window closes) and it beats faster as it ends. */
export function sunstruckRing(
  remaining: number,
  duration: number,
  t: number,
): { fill: number; fade: number } {
  const left = duration > 0 ? Math.min(1, Math.max(0, remaining / duration)) : 0;
  const rate = 7 + 9 * (1 - left);
  return { fill: left, fade: 0.78 + 0.22 * Math.sin(t * rate) };
}

/** Seconds the spirit jaguar takes to turn gold (and back to jade). */
export const AVATAR_GOLD_SECONDS = 0.18;

/** The spirit jaguar's gold (0 jade, 1 burning gold) after `dt`, toward the
 *  window open (`struck`) or shut. */
export function avatarGold(gold: number, struck: boolean, dt: number): number {
  const step = dt / AVATAR_GOLD_SECONDS;
  return Math.max(0, Math.min(1, gold + (struck ? step : -step)));
}

// ---- the Hunting Spear -----------------------------------------------------------------

export const SPEAR_LOOK = {
  /** Tip to butt as modelled (yards), and the size it is drawn at: a spear
   *  for a troll twice a player's height, so it stands 5 yd out of the flags,
   *  clear over the head of the player it pins. */
  length: 4.2,
  scale: 1.45,
  /** How much of the tip is in the floor (drawn yards). */
  buried: 0.6,
  /** Its lean back toward the hand that threw it (radians from upright). */
  lean: 0.4,
  /** Where the cord ties on, along the shaft from the tip (drawn yards). */
  tieAt: 3.6,
  /** The cord's thickness as a share of the Pack Bond's braid. */
  cord: 0.42,
  /** Seconds it takes to drive in, from how far up its own line (yards), and
   *  the seconds its shaft quivers after (a decaying sway of its lean). */
  dropSeconds: 0.14,
  dropFrom: 9,
  quiverSeconds: 0.9,
  quiverLean: 0.16,
  quiverHz: 9,
  /** The thrown streak from his hand to the spear (seconds it lingers). */
  streakSeconds: 0.32,
  /** The ring under the Pinned player (yards). */
  ringRadius: 1.9,
} as const;

/** The spear `elapsed` seconds after it appeared: how far up its own line it
 *  still is (0 once it is in), and the sway added to its lean. */
export function spearDrive(elapsed: number): { rise: number; sway: number } {
  const e = Math.max(0, elapsed);
  if (e < SPEAR_LOOK.dropSeconds) {
    const k = 1 - e / SPEAR_LOOK.dropSeconds;
    return { rise: SPEAR_LOOK.dropFrom * k * k, sway: 0 };
  }
  const q = e - SPEAR_LOOK.dropSeconds;
  if (q >= SPEAR_LOOK.quiverSeconds) return { rise: 0, sway: 0 };
  const decay = (1 - q / SPEAR_LOOK.quiverSeconds) ** 2;
  return {
    rise: 0,
    sway: SPEAR_LOOK.quiverLean * decay * Math.sin(q * SPEAR_LOOK.quiverHz * Math.PI * 2),
  };
}

/** The shaft's unit direction from its tip up to its butt, for a body facing
 *  `facing` (toward the thrower) leaning `lean` radians, written into `out`. */
export function spearAxisInto(
  out: { x: number; y: number; z: number },
  facing: number,
  lean: number,
): { x: number; y: number; z: number } {
  const s = Math.sin(lean);
  out.x = Math.sin(facing) * s;
  out.y = Math.cos(lean);
  out.z = Math.cos(facing) * s;
  return out;
}

/** The ring under a Pinned player: the telegraph palette's control violet (a
 *  root), with the wound's red in its motes. */
export const PINNED_RING = {
  color: TELEGRAPH_THREAT_COLORS.control,
  accent: 0xff5a4a,
} as const;

// ---- the Idol's Breath -----------------------------------------------------------------

/** The warned half and the breath over it: the signature hit of the final
 *  phase in the threat palette, the idol's jade in its motes. */
export const IDOL_BREATH_COLORS = {
  color: TELEGRAPH_THREAT_COLORS.lethal,
  accent: BASIN_ACCENTS.spirit,
  /** The breath itself (the world entrance's jade, wildheart_basin_entrance.ts). */
  jade: [0.16, 1, 0.52],
} as const;

/** The origin of the Basin claim a world spot stands in (its instance slot
 *  read back off its z, as the sim lays the slots out), written into `out`. */
export function basinOriginInto(
  out: { x: number; z: number },
  pos: { x: number; z: number },
): { x: number; z: number } {
  const def = DUNGEONS[WILDHEART_DUNGEON];
  const o = instanceOrigin(def?.index ?? 0, instanceSlotForZ(pos.z));
  out.x = o.x;
  out.z = o.z;
  return out;
}

/** Clip a convex polygon to the half-plane side * x >= 0 (Sutherland-Hodgman). */
function clipToSide(
  points: readonly (readonly [number, number])[],
  side: IdolBreathSide,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const da = a[0] * side;
    const db = b[0] * side;
    if (da >= 0) out.push([a[0], a[1]]);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const k = da / (da - db);
      out.push([0, a[1] + (b[1] - a[1]) * k]);
    }
  }
  return out;
}

/** The half of the terrace a side's breath marks: the terrace polygon cut on
 *  the sim's centre line (instance-local [x, z], counter-clockwise or
 *  clockwise as the terrace's own points run). */
export function idolBreathHalf(side: IdolBreathSide): readonly (readonly [number, number])[] {
  return clipToSide(SHRINE_TERRACE.points, side);
}

/** The lane the warning's shader measures the half along: from the idol's end
 *  of the terrace southward (the fill races out of its maw), as wide as the
 *  terrace reaches from the centre line. Instance-local. */
export function idolBreathLane(side: IdolBreathSide): {
  x: number;
  z: number;
  length: number;
  half: number;
} {
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let reach = 0;
  for (const [x, z] of SHRINE_TERRACE.points) {
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    reach = Math.max(reach, Math.abs(x));
  }
  return { x: (side * reach) / 2, z: maxZ, length: maxZ - minZ, half: reach / 2 };
}

/** A fan of triangles over a half (from its first vertex), with each one's
 *  share of the area: what a painter scatters its breath over. */
export function idolBreathFan(side: IdolBreathSide): {
  points: readonly (readonly [number, number])[];
  /** Cumulative area share at each triangle (the last is 1). */
  cumulative: number[];
} {
  const points = idolBreathHalf(side);
  const areas: number[] = [];
  let total = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const [ax, az] = points[0];
    const [bx, bz] = points[i];
    const [cx, cz] = points[i + 1];
    const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    total += area;
    areas.push(total);
  }
  return { points, cumulative: areas.map((a) => (total > 0 ? a / total : 1)) };
}

/** A spot inside a half for three draws in [0, 1) (uniform over its area),
 *  written into `out` as instance-local (x, z). */
export function idolBreathSpotInto(
  out: { x: number; z: number },
  fan: ReturnType<typeof idolBreathFan>,
  pick: number,
  u: number,
  v: number,
): { x: number; z: number } {
  let tri = 0;
  while (tri < fan.cumulative.length - 1 && pick > fan.cumulative[tri]) tri++;
  const a = fan.points[0];
  const b = fan.points[tri + 1];
  const c = fan.points[tri + 2];
  let s = u;
  let w = v;
  if (s + w > 1) {
    s = 1 - s;
    w = 1 - w;
  }
  out.x = a[0] + (b[0] - a[0]) * s + (c[0] - a[0]) * w;
  out.z = a[1] + (b[1] - a[1]) * s + (c[1] - a[1]) * w;
  return out;
}

/** Where the breath leaves the stone jaguar: the middle of its open maw over
 *  the terrace's north lip (instance-local x and z, and its height). */
export const IDOL_MAW_MOUTH = {
  x: JAGUAR_MAW.x,
  y: (JAGUAR_MAW.jawY + JAGUAR_MAW.roofY) / 2,
  z: JAGUAR_MAW.minZ + 5,
  halfWidth: JAGUAR_MAW.halfWidth * 0.7,
} as const;

/** The pour once it has landed, `age` seconds in: a flash as it hits, the
 *  sheet racing from the maw across the half, then thinning to nothing over
 *  the seconds the sim keeps its object (ZULGAR_TUNING.breathLinger). */
export function breathPour(age: number): { alpha: number; front: number; flash: number } {
  const span = ZULGAR_TUNING.breathLinger;
  const u = Math.min(1, Math.max(0, span > 0 ? age / span : 1));
  const front = Math.min(1, u / 0.28);
  const fade = u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45);
  return { alpha: fade, front, flash: Math.max(0, 1 - u / 0.2) };
}

/** What the stone jaguar is doing: asleep (the hunt's own eye states stand),
 *  awake between breaths, drawing breath over a warning, breathing out. */
export type IdolState = 'asleep' | 'awake' | 'inhale' | 'exhale';

/** The idol's eyes over the hunt's own burn (basin_fx_core.ts jaguarEyesBurn):
 *  awake they never sink below full fire, they flutter harder as it draws
 *  breath (`fill` 0..1 of the warning) and blaze as it breathes out. */
export function idolEyesBurn(state: IdolState, fill: number, t: number): number {
  if (state === 'asleep') return 0;
  if (state === 'exhale') return 1;
  if (state === 'inhale') return 0.9 + 0.1 * Math.sin(t * (10 + 22 * fill));
  return 0.92 + 0.06 * Math.sin(t * 5.1);
}

/** The jade in its throat (0 dark, 1 full): a smoulder awake, swelling as it
 *  draws breath, a blast as it lets go. */
export function idolThroatGlow(state: IdolState, fill: number, t: number): number {
  if (state === 'asleep') return 0;
  if (state === 'exhale') return 1;
  if (state === 'inhale') return 0.3 + 0.6 * fill + 0.08 * Math.sin(t * 9);
  return 0.22 + 0.06 * Math.sin(t * 1.9);
}
