// Pure plan of the Islands of the Wind's look (breath_isles_fx.ts paints it;
// the sim: encounters/smith_heart/breath_isles.ts). Three-free, DOM-free,
// deterministic (a hash, never rng): which Blender sculpt each floating isle
// is (the Breath kit's Kit_WindIsleA and B), its bob in the wind, its ring
// of wind runes, its drifting stones,
// the Gale Path's and the Homeward Gale's circles and the route of wind each
// draws to where it carries, a rider's ribbons, the Gale Bulwark round the
// guardian and the Gale Mender's stream into it, read off the sim's own
// numbers (ISLE_TUNING, the layout, the ride's own arc), never tuned here.
//
// Readability (binding): the circles, their routes, the Bulwark and the
// Mender's stream draw on EVERY tier (the raid acts on them); the drifting
// stones, the mist and the motes thin on the low tier.

import {
  bearingDeg,
  ISLE_FLOOR_SPECS,
  isleRimRadius,
} from '../../sim/content/smith_heart_isle_floor';
import { BREATH, BREATH_ISLES } from '../../sim/content/smith_heart_layout';
import { isleSpots, rideArc } from '../../sim/encounters/smith_heart/breath_isle_geometry';
import {
  ISLE_OBJECTS,
  ISLE_TUNING as IT,
  isleCircleOf,
  rideOf,
} from '../../sim/encounters/smith_heart/breath_isle_ids';

/** The palette: the vein's storm teal and white for the wind, a pale gold
 *  for the way home, the crystals' cold blue, the granite's warm grey. */
export const ISLE_COLORS = {
  path: 0x7fe8ff,
  pathCore: 0xf2feff,
  home: 0xffe2a0,
  homeCore: 0xfffbe8,
  rune: 0x8ff0ff,
  crystal: 0x3f9ee8,
  crystalCore: 0xc8f2ff,
  granite: 0x8d8981,
  graniteLight: 0xa9a59b,
  graniteDark: 0x2f2b27,
  strata: 0x7a6d5c,
  moss: 0x5d7149,
  root: 0x4a3828,
  bulwark: 0x58d4ff,
  bulwarkEdge: 0xffffff,
  mend: 0x7affd8,
  ribbon: 0xe8fbff,
  mist: 0xd8eef8,
} as const;

/** A hex colour as linear-ish rgb 0..1 (the particle pools' format). */
function rgb(hex: number): readonly [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** The particles' colours (rgb 0..1). */
export const ISLE_RGB = {
  pathCore: rgb(ISLE_COLORS.pathCore),
  homeCore: rgb(ISLE_COLORS.homeCore),
  ribbon: rgb(ISLE_COLORS.ribbon),
  bulwarkEdge: rgb(ISLE_COLORS.bulwarkEdge),
  dust: rgb(0xd6dde2),
  mendCore: rgb(0xd8fff2),
  path: rgb(ISLE_COLORS.path),
} as const;

/** Pool sizes (fixed: no allocation in a fight). */
export const ISLE_POOLS = {
  /** Gale Paths (one per isle) and Homeward Gales (one per isle). */
  circles: BREATH_ISLES.length * 2,
  /** Riders in the air at once (a whole raid could ride). */
  riders: 10,
  /** Menders streaming into the Bulwark at once. */
  streams: BREATH_ISLES.length,
  /** Drifting stones under each isle. */
  stones: 9,
} as const;

/** A small integer hash to 0..1. */
export function isleHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x45d9f3b) ^ Math.imul(b | 0, 0x119de1f3)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** What an isle's circle object is (a Gale Path, a Homeward Gale, a ride's
 *  carrier), or null. */
export type IsleObjectKind = 'path' | 'home' | 'ride';
export function isleObjectKind(templateId: string): IsleObjectKind | null {
  if (templateId.startsWith(ISLE_OBJECTS.ridePrefix)) return rideOf(templateId) ? 'ride' : null;
  const c = isleCircleOf(templateId);
  return c ? c.kind : null;
}

// ---- the isles ------------------------------------------------------------------------

/** Each isle's Blender sculpt in the Breath kit (docs/design/raid/kit/
 *  breath_isles.py wind_isle: a turf walk whose edge is the sim's own floor,
 *  the ruined wind shrine on it, the runed stones, the arch or the tree and
 *  the satellite rocks past it, the crag hanging under it with roots, vines
 *  and crystal), its turn (three's rotation.y), how deep its crag hangs
 *  under the floor (yards) and where its point hangs (the kit's frame,
 *  Blender x and y: the spec's lean times four, breath_isles.py
 *  ISLE_SPECS). */
export const ISLE_KIT: readonly {
  piece: string;
  rot: number;
  depth: number;
  tip: readonly [number, number];
}[] = [
  { piece: 'Kit_WindIsleA', rot: 0.6, depth: 26, tip: [-2.2, 3.8] },
  { piece: 'Kit_WindIsleB', rot: 2.4, depth: 18.5, tip: [3.4, -2.0] },
];

/** A point of an isle's kit frame (Blender x, y) as an offset from its
 *  centre in the game's frame (x, z): the glTF turn (x, -y) and then the
 *  isle's own turn. Fills `out`. */
export function isleKitOffset(
  i: number,
  bx: number,
  by: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const rot = ISLE_KIT[i % ISLE_KIT.length].rot;
  const lz = -by;
  out.x = bx * Math.cos(rot) + lz * Math.sin(rot);
  out.z = -bx * Math.sin(rot) + lz * Math.cos(rot);
  return out;
}
/** The stone that drifts round the isles (the kit's Kit_IsleShard). */
export const ISLE_SHARD = 'Kit_IsleShard';

/** How deep an isle hangs under its floor (yards). */
export function isleDepth(i: number): number {
  return ISLE_KIT[i % ISLE_KIT.length].depth;
}

/** The isles ride the wind: a slow bob and sway while nothing stands on
 *  them, eased all but still (`held`, under a body's notice) while the
 *  round is on (the sim's floor never moves, so a body never sinks). */
export const ISLE_BOB = { free: 0.3, held: 0.03, period: 7.2, tilt: 0.012 } as const;

/** An isle's bob `t` seconds in: its lift (yards) and its tilt (radians
 *  round x and z). `calm` 0 (free) to 1 (held). Fills `out`. */
export function isleBob(
  i: number,
  t: number,
  calm: number,
  out: { y: number; rx: number; rz: number } = { y: 0, rx: 0, rz: 0 },
): { y: number; rx: number; rz: number } {
  const k = Math.max(0, Math.min(1, calm));
  const amp = ISLE_BOB.free + (ISLE_BOB.held - ISLE_BOB.free) * k;
  const w = (Math.PI * 2) / ISLE_BOB.period;
  const ph = i * 2.3;
  out.y = amp * Math.sin(t * w + ph) + amp * 0.35 * Math.sin(t * w * 2.7 + ph * 1.7);
  const lean = ISLE_BOB.tilt * (1 - k);
  out.rx = lean * Math.sin(t * w * 0.8 + ph + 1.1);
  out.rz = lean * Math.cos(t * w * 0.65 + ph);
  return out;
}

const _tipAt = { x: 0, z: 0 };

/** The isles' life (cosmetic: each thins with the tier's density, the low
 *  tier keeps a trace): mist streaming off the hang and away on the wind,
 *  grit falling from under the turf's lip, dust sifting off the crag.
 *  Births per second per isle at full density. */
export const ISLE_LIFE = { mist: 1.3, grit: 1.1, dust: 0.9 } as const;

export interface IsleMote {
  /** Birth, isle-local (relative to the isle's floor centre, y up). */
  x: number;
  y: number;
  z: number;
  /** The way it heads (yards a second before its drag). */
  vx: number;
  vy: number;
  vz: number;
}

/** The wind's way past an isle: from the Cornice out through it (unit,
 *  game x and z). */
export function isleWindAway(i: number): { x: number; z: number } {
  const isle = BREATH_ISLES[i];
  const dx = isle.x - BREATH.cornice.x;
  const dz = isle.z - BREATH.cornice.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: dx / d, z: dz / d };
}

/** Where a wisp of mist is born on an isle's hang and how it streams (u, v,
 *  w: three draws in 0..1): on the crag's flank between a quarter and nearly
 *  all its depth down (the crag narrowing to its leaning point), drifting
 *  out from it, away on the wind and a little down. Fills `out`. */
export function isleMist(i: number, u: number, v: number, w: number, out: IsleMote): IsleMote {
  const isle = BREATH_ISLES[i];
  const depth = isleDepth(i);
  const tip = ISLE_KIT[i % ISLE_KIT.length].tip;
  const at = isleKitOffset(i, tip[0], tip[1], _tipAt);
  const f = 0.25 + 0.7 * u;
  const r = (isle.r + 1) * (1 - f) ** 1.75 + 1.2;
  const a = v * Math.PI * 2;
  const cx = at.x * f * f;
  const cz = at.z * f * f;
  out.x = cx + Math.sin(a) * r;
  out.y = -f * depth;
  out.z = cz + Math.cos(a) * r;
  const wind = isleWindAway(i);
  const s = 0.9 + 0.8 * w;
  out.vx = Math.sin(a) * 0.4 + wind.x * s;
  out.vy = -0.25 - 0.3 * w;
  out.vz = Math.cos(a) * 0.4 + wind.z * s;
  return out;
}

/** How far isle `i`'s walk reaches along game bearing `a` (radians, x = sin a,
 *  z = cos a): its organic rim (smith_heart_isle_floor.ts), the sim's own. */
export function isleRimAt(i: number, a: number): number {
  const isle = BREATH_ISLES[i];
  const spec = ISLE_FLOOR_SPECS[isle.id];
  const toward = bearingDeg(isle.x, isle.z, BREATH.cornice.x, BREATH.cornice.z);
  return isleRimRadius(spec, toward, (a * 180) / Math.PI);
}

/** Where a grain of grit breaks from under the turf's lip (u, v: draws in
 *  0..1): round the rim just past the walk (its bays and tongues), under the
 *  turf, falling. */
export function isleGrit(i: number, u: number, v: number, out: IsleMote): IsleMote {
  const a = u * Math.PI * 2;
  const r = isleRimAt(i, a) + 0.4 + v * 0.9;
  out.x = Math.sin(a) * r;
  out.y = -0.6 - v * 1.2;
  out.z = Math.cos(a) * r;
  out.vx = Math.sin(a) * 0.5;
  out.vy = 0;
  out.vz = Math.cos(a) * 0.5;
  return out;
}

/** The ring of wind runes round an isle's floor (its inner and outer radius:
 *  inside the deepest of its bays, so it never hangs over the void). */
export function isleRuneRing(i: number): { inner: number; outer: number } {
  const r = BREATH_ISLES[i].r;
  return { inner: r - 4.0, outer: r - 2.6 };
}

/** A drifting stone round an isle `t` seconds in: its place (instance-local)
 *  and spin (a slow orbit on two beats). Two of every three ride a ring
 *  round the rim, a little over the walk and out past the satellite rocks
 *  (whose reach the kit keeps inside 1.95 walks); the third hangs under
 *  the point, torn off with it. */
export function driftStone(
  i: number,
  k: number,
  t: number,
  out: { x: number; y: number; z: number; spin: number; size: number } = {
    x: 0,
    y: 0,
    z: 0,
    spin: 0,
    size: 0,
  },
): { x: number; y: number; z: number; spin: number; size: number } {
  const isle = BREATH_ISLES[i];
  const a = isleHash(k, 171 + i) * Math.PI * 2 + t * (0.08 + isleHash(k, 173) * 0.12);
  const bob = Math.sin(t * 0.7 + k) * 0.6;
  if (k % 3 !== 2) {
    // The rim's ring, in the open air past every satellite.
    const r = isle.r * (2.05 + isleHash(k, 175) * 0.45);
    out.x = isle.x + Math.sin(a) * r;
    out.y = isle.h + 0.6 + isleHash(k, 177) * 3.4 + bob;
    out.z = isle.z + Math.cos(a) * r;
  } else {
    // Under the point, a step of void between each and the crystal.
    const tip = ISLE_KIT[i % ISLE_KIT.length].tip;
    const at = isleKitOffset(i, tip[0], tip[1], _tipAt);
    const r = 2.5 + isleHash(k, 175) * 4;
    out.x = isle.x + at.x + Math.sin(a) * r;
    out.y = isle.h - isleDepth(i) - 4 - isleHash(k, 177) * 5 + bob;
    out.z = isle.z + at.z + Math.cos(a) * r;
  }
  out.spin = t * (0.3 + isleHash(k, 179));
  out.size = 0.6 + isleHash(k, 181) * 0.6;
  return out;
}

// ---- the circles and their routes ----------------------------------------------------

/** A circle's look `age` seconds after it opened: its swirl's speed and
 *  brightness (a quick flare as it opens, then a steady beckon). */
export function circleLook(age: number): { open: number; glow: number; spin: number } {
  const open = Math.max(0, Math.min(1, age / 0.6));
  const flare = age < 1.2 ? 1 - age / 1.2 : 0;
  return { open, glow: 0.75 + 0.25 * Math.sin(age * 3.1) + 0.6 * flare, spin: 1.6 };
}

/** The route a circle draws to where it carries (instance-local points on
 *  the ride's own arc, from the circle's middle to its landing). */
export function circleRoute(
  isle: number,
  kind: 'path' | 'home',
  steps: number,
  heights: { cornice: number },
): { x: number; y: number; z: number }[] {
  const s = isleSpots()[isle];
  const from =
    kind === 'path'
      ? { x: s.path.x, y: heights.cornice, z: s.path.z }
      : { x: s.home.x, y: s.h, z: s.home.z };
  const to =
    kind === 'path'
      ? { x: s.land.x, y: s.h, z: s.land.z }
      : { x: s.back.x, y: heights.cornice, z: s.back.z };
  const out: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k <= steps; k++) out.push(rideArc(from, to, k / steps));
  return out;
}

// ---- the Bulwark and the Mender ------------------------------------------------------

/** The Bulwark's look from its absorb (`left` of `whole`) at `clock`: how
 *  solid it stands, how cracked, how fast its wind turns. */
export function bulwarkLook(
  left: number,
  whole: number,
  clock: number,
): { solid: number; crack: number; spin: number; pulse: number } {
  const k = whole > 0 ? Math.max(0, Math.min(1, left / whole)) : 0;
  return {
    solid: 0.35 + 0.65 * k,
    crack: 1 - k,
    spin: 0.6 + 1.4 * k,
    pulse: 0.85 + 0.15 * Math.sin(clock * (2 + 3 * (1 - k))),
  };
}

/** The ride's flourish: how a rider's ribbons wrap them `k` (0 to 1) into
 *  the ride (tight and bright in the middle, loosening as it sets down). */
export function riderLook(k: number): { wrap: number; bright: number } {
  const t = Math.max(0, Math.min(1, k));
  return { wrap: 0.6 + 0.4 * Math.sin(t * Math.PI), bright: 0.5 + 0.5 * Math.sin(t * Math.PI) };
}

/** The ride's seconds and arc apex, read once (the painter's guards). */
export const RIDE = { seconds: IT.rideSeconds, apex: IT.rideApex, circleR: IT.circleR } as const;

// ---- the Bulwark's vortex (the third pass) -------------------------------------------

/** The Gale Bulwark's vortex: three bands of wind round the guardian (the
 *  foot, the waist, the crown; heights and radii in shell radii), each
 *  turning its own way at its own slant. A band's `over` is the share of
 *  the shell below which it peels away: the crown goes first (under two
 *  thirds), then the waist (under a third); the foot holds to the end, so
 *  the shell's strength reads at a glance. */
export const BULWARK_BANDS: readonly {
  y0: number;
  y1: number;
  r0: number;
  r1: number;
  spin: number;
  slant: number;
  over: number;
}[] = [
  { y0: 0, y1: 0.75, r0: 1.3, r1: 1.15, spin: 1.5, slant: 1.6, over: 0 },
  { y0: 0.45, y1: 1.3, r0: 1.18, r1: 0.98, spin: -2.1, slant: -2.4, over: 1 / 3 },
  { y0: 1.05, y1: 1.8, r0: 1.0, r1: 0.4, spin: 2.8, slant: 3, over: 2 / 3 },
];

/** A band's life (0 gone, 1 whole) at the shell's charge `k` (0..1). */
export function bulwarkBandLife(k: number, over: number): number {
  const c = Math.max(0, Math.min(1, k));
  if (over <= 0) return 0.45 + 0.55 * c;
  return Math.max(0, Math.min(1, (c - over) / 0.1));
}

/** The stones orbiting in the vortex: the most there are, and how many the
 *  charge `k` keeps (fewer as it thins; the low tier a half). */
export const BULWARK_DEBRIS = 16;
export function bulwarkDebrisCount(k: number, density: number): number {
  const c = Math.max(0, Math.min(1, k));
  const n = Math.round(BULWARK_DEBRIS * (0.2 + 0.8 * c));
  return density < 0.5 ? Math.ceil(n / 2) : n;
}

/** Orbiting stone `j` at `t` seconds, the charge `k`: its place in shell
 *  radii round the guardian's foot (x, y, z) and its spin; faster and
 *  tighter while the shell is whole. Fills `out`. */
export function bulwarkDebris(
  j: number,
  t: number,
  k: number,
  out: { x: number; y: number; z: number; spin: number; size: number },
): { x: number; y: number; z: number; spin: number; size: number } {
  const c = Math.max(0, Math.min(1, k));
  const a = isleHash(j, 601) * Math.PI * 2 + t * (0.9 + isleHash(j, 603) * 0.8) * (0.45 + 0.55 * c);
  const r = 1.22 + isleHash(j, 605) * 0.3 + (1 - c) * 0.15;
  out.x = Math.sin(a) * r;
  out.z = Math.cos(a) * r;
  out.y = 0.15 + isleHash(j, 607) * 1.45 + Math.sin(t * 1.3 + j) * 0.08;
  out.spin = t * (1 + isleHash(j, 609) * 2);
  out.size = 0.035 + isleHash(j, 611) * 0.055;
  return out;
}

/** Seconds a cut Mending Gale takes to part and fade. */
export const BEAM_CUT_SECONDS = 0.7;

/** A Mending Gale cut `since` seconds ago: the gap at its middle (0..1) and
 *  what is left of its light. */
export function beamCutLook(since: number): { cut: number; glow: number } {
  const t = Math.max(0, since);
  return {
    cut: Math.min(1, (t / (BEAM_CUT_SECONDS * 0.7)) ** 0.6),
    glow: Math.max(0, 1 - t / BEAM_CUT_SECONDS),
  };
}

// ---- the ride (the third pass) -------------------------------------------------------

/** Seconds the Gale Path's launch funnel spins up and thins away. */
export const FUNNEL_SECONDS = 1.1;

/** The launch funnel `age` seconds in: its height (yards), its spread (a
 *  scale on its radius) and its life (0..1). */
export function funnelLook(age: number): { h: number; spread: number; life: number } {
  const t = Math.max(0, Math.min(1, age / FUNNEL_SECONDS));
  const ease = 1 - (1 - t) ** 3;
  return {
    h: 5 + 15 * ease,
    spread: 0.8 + 1.1 * ease,
    life: t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) / 0.88),
  };
}

/** A rider's trail: how many past places it keeps, and how far apart in
 *  time (seconds). */
export const RIDE_TRAIL = { points: 26, every: 0.045 } as const;
