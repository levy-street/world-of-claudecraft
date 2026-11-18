// Pure plan of the Islands of the Wind's 50 percent phase look (the sim:
// encounters/smith_heart/breath_isles.ts and breath_isle_adds.ts; painted by
// breath_cocoon_fx.ts, breath_isle_storm_fx.ts, breath_stillstone_fx.ts and
// breath_isle_adds_fx.ts). Three-free, DOM-free, deterministic (hashes,
// never rng), every number read off the sim's own ids and tuning:
//
//  - the Gale Cocoon round the guardian and Skyrend Nova gathering over it,
//    its growth read off the guardian's own channel bar (castRemaining of
//    castTotal), the two seals (one tether to each Stillstone) and the two
//    endings (the cocoon shattering, the nova's blast);
//  - each isle's Closing Storm: the ring closing on the isle's own rim shape
//    off the template's whole seconds, smoothed between its updates, white
//    blue to angry violet; Sky's Reckoning's break;
//  - the Stillstone's states (dormant, awake, channelled, stilled);
//  - the Gust Herald's Shoving Gale lane (the sim's exact reach and width)
//    and the Squall Shieldbearer's frontal ward (its aura's own arc).
//
// Readability (binding, docs/design/graphics-settings-fairness.md): the
// nova's growth, the seals, the closing ring, the lane, the ward and the
// stones' states draw on EVERY tier; only sparks, motes and debris thin.

import { BREATH_ISLES } from '../../sim/content/smith_heart_layout';
import { isleSpots } from '../../sim/encounters/smith_heart/breath_isle_geometry';
import {
  closingOf,
  ISLE_AURAS,
  ISLE_OBJECTS,
  ISLE_TUNING as IT,
} from '../../sim/encounters/smith_heart/breath_isle_ids';

/** The phase's palette: the storm's white blue, the closing's violet, the
 *  Stillstone's calm teal and its stilled gold, the ward's grey wind. */
export const PHASE_COLORS = {
  cocoon: 0x58d4ff,
  cocoonEdge: 0xffffff,
  nova: 0x9fe6ff,
  novaCore: 0xffffff,
  novaHot: 0x8f3dff,
  storm: 0x241e3a,
  calm: 0xcfefff,
  angry: 0x9b3dff,
  stone: 0x63f2dd,
  stoneCore: 0xe8fffb,
  stilled: 0xffe7a8,
  ward: 0xbfe4ff,
  wardRim: 0xffffff,
  mend: 0x7affd8,
} as const;

/** A hex colour as rgb 0..1 (the particle pools' format). */
export function phaseRgb(hex: number): readonly [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** A small integer hash to 0..1. */
export function phaseHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---- the cocoon and the nova ------------------------------------------------------------

/** How far Skyrend Nova has gathered (0 as it begins, 1 as it lands), off
 *  the guardian's channel bar; 0 without a bar. */
export function novaCharge(remaining: number, total: number): number {
  if (!(total > 0)) return 0;
  return clamp01(1 - remaining / total);
}

/** The cocoon's radius over the guardian's own scale (yards). */
export function cocoonRadius(scale: number): number {
  return 3.4 * Math.max(1, scale);
}

/** The nova's sphere: its smallest and largest radius (in cocoon radii) and
 *  the height its middle hangs at over the guardian's feet (cocoon radii),
 *  so the sphere never swallows the guardian or its cocoon. */
export const NOVA_SHAPE = { r0: 0.3, r1: 1.15, base: 1.75 } as const;

export interface NovaLook {
  /** The sphere's radius (cocoon radii). */
  radius: number;
  /** Its middle over the guardian's feet (cocoon radii). */
  lift: number;
  /** Its light (1 a steady storm, past 2 a white-hot sun). */
  glow: number;
  /** Arcs a second crawling over it. */
  crackle: number;
  /** Its throb (0..1 this instant), quicker as it nears its end. */
  throb: number;
  /** How far the sky round the Cornice darkens (0..1). */
  sky: number;
  /** The hum's gain (0..1). */
  hum: number;
  /** Its turn toward the angry violet (0..1, the last quarter). */
  hot: number;
  /** The ground's tremble near its end (a shake's strength). */
  tremble: number;
}

/** The nova `charge` (0..1) of the way in, at `t` seconds: it grows with the
 *  bar (never with the clock), so a glance from any isle reads the time left. */
export function novaLook(charge: number, t: number, out?: NovaLook): NovaLook {
  const c = clamp01(charge);
  const o = out ?? {
    radius: 0,
    lift: 0,
    glow: 0,
    crackle: 0,
    throb: 0,
    sky: 0,
    hum: 0,
    hot: 0,
    tremble: 0,
  };
  o.radius = NOVA_SHAPE.r0 + (NOVA_SHAPE.r1 - NOVA_SHAPE.r0) * c ** 0.8;
  o.lift = NOVA_SHAPE.base + o.radius * 0.6;
  const rate = 1.2 + 5.5 * c * c;
  o.throb = 0.5 + 0.5 * Math.sin(t * rate * Math.PI * 2);
  o.glow = 0.75 + 1.35 * c + 0.25 * c * o.throb;
  o.crackle = 2 + 22 * c * c;
  o.sky = 0.25 + 0.6 * smooth(0, 1, c);
  o.hum = 0.25 + 0.7 * c;
  o.hot = smooth(0.72, 1, c);
  o.tremble = c > 0.85 ? 0.04 + 0.12 * ((c - 0.85) / 0.15) : 0;
  return o;
}

/** Where Stillstone `side` (0 east, 1 west) stands (instance-local, at its
 *  floor), the far end of its seal. */
export function sealEnd(side: 0 | 1): { x: number; y: number; z: number } {
  const i = side * 3 + 2;
  const sp = isleSpots()[i];
  const s = sp.stone ?? { x: sp.x, z: sp.z };
  return { x: s.x, y: sp.h + STILLSTONE.hover, z: s.z };
}

/** Each seal's life (1 whole, 0 broken) from what the guardian's cocoon
 *  counts stilled and which stones the scan saw stilled: a stone seen
 *  stilled breaks its own seal; a count past the stones seen breaks the
 *  rest in east-then-west order. Fills `out` ([east, west]). */
export function sealLives(
  count: number,
  seen: readonly [boolean, boolean],
  out: [number, number] = [1, 1],
): [number, number] {
  out[0] = seen[0] ? 0 : 1;
  out[1] = seen[1] ? 0 : 1;
  let extra = Math.max(0, Math.round(count)) - (seen[0] ? 1 : 0) - (seen[1] ? 1 : 0);
  for (let k = 0; k < 2 && extra > 0; k++)
    if (out[k] > 0) {
      out[k] = 0;
      extra--;
    }
  return out;
}

/** A point on a seal's arc from the nova (a) to its stone (b) at k (0..1):
 *  lifted high over the void so it reads from the isles as a road home. */
export function sealArc(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  k: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  const t = clamp01(k);
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const lift = Math.min(28, d * 0.16);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.y = a.y + (b.y - a.y) * t + lift * 4 * t * (1 - t);
  return out;
}

/** The cocoon shattering (both stones stilled) and the nova's blast (it ran
 *  out), as seconds. */
export const COCOON_ENDS = { shatter: 2.4, blast: 3.2 } as const;

export interface EndLook {
  /** The bright flash (0..1). */
  flash: number;
  /** The shockwave's shell radius (cocoon radii) and its light. */
  wave: number;
  waveGlow: number;
  /** What is left of the cocoon / nova sphere (1 whole, 0 gone). */
  left: number;
  /** The sky clearing (shatter) or blazing (blast): its darkness. */
  sky: number;
}

/** An ending `age` seconds in (`blast` the nova's, else the shatter). */
export function endLook(age: number, blast: boolean, out?: EndLook): EndLook {
  const o = out ?? { flash: 0, wave: 0, waveGlow: 0, left: 0, sky: 0 };
  const T = blast ? COCOON_ENDS.blast : COCOON_ENDS.shatter;
  const t = Math.max(0, age);
  o.flash = t < 0.06 ? t / 0.06 : Math.max(0, 1 - (t - 0.06) / (blast ? 0.4 : 0.3));
  const k = clamp01(t / T);
  const reach = blast ? 14 : 4;
  o.wave = 1 + reach * (1 - (1 - k) ** 2.4);
  o.waveGlow = Math.max(0, 1 - k) ** 1.4;
  o.left = Math.max(0, 1 - t / (blast ? 0.25 : 0.45));
  // The sky: a short flash, never a wash; the storm clears behind it.
  o.sky = blast ? 0.7 * Math.max(0, 1 - k * 1.6) : 0.7 * Math.max(0, 1 - k * 1.4);
  return o;
}

/** The endings' floor shockwave: how far it races (yards) and how fast
 *  (seconds), a fast ring on the floor ladder. */
export const END_RING = {
  shatter: { reach: 34, seconds: 0.9 },
  blast: { reach: 95, seconds: 1.3 },
} as const;

/** A floor shockwave `age` seconds in: its radius (yards) and light. */
export function endRing(age: number, blast: boolean): { r: number; glow: number } {
  const R = blast ? END_RING.blast : END_RING.shatter;
  const k = clamp01(age / R.seconds);
  return { r: 1 + (R.reach - 1) * (1 - (1 - k) ** 3), glow: (1 - k) ** 1.2 };
}

/** The cocoon's shards: how many fly (the low tier halves them), and the
 *  flight of shard `j` `age` seconds after the shatter (cocoon radii from
 *  its middle, y up): thrown out and up on a ballistic arc, tumbling.
 *  Even shards are wind-glass, odd ones granite. */
export const SHARDS = { count: 48, gravity: 6, seconds: 2.4 } as const;
export function shardAt(
  j: number,
  age: number,
  out: { x: number; y: number; z: number; spin: number; size: number; life: number },
): { x: number; y: number; z: number; spin: number; size: number; life: number } {
  const a = phaseHash(j, 701) * Math.PI * 2;
  const up = 0.35 + phaseHash(j, 703) * 1.1;
  const speed = 2.2 + phaseHash(j, 705) * 3.2;
  const t = Math.max(0, age);
  const r0 = 0.6 + phaseHash(j, 707) * 0.5;
  const h0 = 0.4 + phaseHash(j, 709) * 1.4;
  out.x = Math.sin(a) * (r0 + speed * t);
  out.z = Math.cos(a) * (r0 + speed * t);
  out.y = h0 + up * speed * t - 0.5 * SHARDS.gravity * t * t;
  out.spin = t * (3 + phaseHash(j, 711) * 7);
  // Splinters and chips against the guardian's size, never boulders (the
  // cocoon's radius scales them: a 0.17 share flew yard-and-a-half rocks).
  out.size = j % 2 === 0 ? 0.05 + phaseHash(j, 713) * 0.05 : 0.03 + phaseHash(j, 713) * 0.035;
  out.life = t >= SHARDS.seconds ? 0 : 1 - (t / SHARDS.seconds) ** 3;
  return out;
}

/** The sky dome round the Cornice (yards: past the farthest isle and its
 *  crag, under the camera's far plane). */
export const SKY_DOME_R = 230;

// ---- the Closing Storm --------------------------------------------------------------------

/** What an isle's Closing Storm object says: the isle, whole seconds left
 *  and its whole (null for any other object). */
export function closingParts(
  templateId: string,
): { isle: number; left: number; whole: number } | null {
  if (!templateId.startsWith(ISLE_OBJECTS.closingPrefix)) return null;
  const c = closingOf(templateId);
  return c && c.isle < BREATH_ISLES.length ? c : null;
}

/** The painter's smooth seconds between the sim's whole-second updates: the
 *  sim's `left` is the ceiling of what remains, so the true clock lies in
 *  (left - 1, left]; it runs down with the frame and stays in that window. */
export function stepClosingClock(cur: number, left: number, dt: number): number {
  if (!Number.isFinite(cur) || cur > left + 0.05 || cur < left - 1.05) return left;
  return Math.max(Math.max(0, left - 1), Math.min(left, cur - dt));
}

/** The ring's last stand: the share of the rim it closes to at zero. */
export const CLOSING_MIN = 0.28;

export interface ClosingLook {
  /** The ring's share of the isle's rim (1 at the rim, CLOSING_MIN at 0). */
  k: number;
  /** How near the end (0 fresh, 1 out). */
  late: number;
  /** Its colour's turn from white blue to angry violet (0..1). */
  violet: number;
  /** The storm wall's height (yards) and its darkness (0..1). */
  wall: number;
  dark: number;
  /** A throb (0..1) quickening in the last seconds. */
  throb: number;
}

/** A Closing Storm with `rem` of `whole` seconds left, at `t` seconds. */
export function closingLook(rem: number, whole: number, t: number, out?: ClosingLook): ClosingLook {
  const o = out ?? { k: 1, late: 0, violet: 0, wall: 0, dark: 0, throb: 0 };
  const f = whole > 0 ? clamp01(rem / whole) : 0;
  const late = 1 - f;
  o.late = late;
  o.k = CLOSING_MIN + (1 - CLOSING_MIN) * f;
  o.violet = smooth(0.35, 0.92, late);
  o.wall = 3 + 9 * late;
  o.dark = 0.25 + 0.6 * late;
  const last = rem < 10 ? 1 - rem / 10 : 0;
  o.throb = 0.5 + 0.5 * Math.sin(t * (2 + 9 * last) * Math.PI);
  return o;
}

/** Sky's Reckoning's break over an isle: bolts in its first second and a
 *  half, flickering out (`age` seconds in); the strikes after it are the
 *  barrage's own telegraphs. */
export const RECKONING_SECONDS = 1.6;
export function reckoningBolts(age: number): number {
  if (age < 0 || age > RECKONING_SECONDS) return 0;
  return Math.round(6 * (1 - age / RECKONING_SECONDS)) + (age < 0.15 ? 3 : 0);
}

// ---- the Stillstone ---------------------------------------------------------------------

/** The Stillstone crystal: its hover over the floor, its height and width
 *  (yards), its cage of wind (rings). */
export const STILLSTONE = { hover: 3.4, height: 4.6, width: 1.5, rings: 3 } as const;

/** The two isles that hold a Stillstone (the last of each chain). */
export const STILLSTONE_ISLES: readonly number[] = BREATH_ISLES.flatMap((b, i) =>
  b.step === 2 ? [i] : [],
);

export type StoneState = 'dormant' | 'awake' | 'channel' | 'stilled';

export interface StoneLook {
  /** The crystal's inner light (0..2). */
  glow: number;
  /** Its colour: 0 the calm teal, 1 the stilled gold. */
  gold: number;
  /** The cage of wind round it: how bright and how fast it turns. */
  cage: number;
  cageSpin: number;
  /** Its spin and its bob (yards). */
  spin: number;
  bob: number;
  /** A beckoning pulse (0..1). */
  pulse: number;
}

/** The stone's look in `state` at `t` seconds (`channel` its channel's
 *  share, 0..1). */
export function stoneLook(state: StoneState, t: number, channel = 0, out?: StoneLook): StoneLook {
  const o = out ?? { glow: 0, gold: 0, cage: 0, cageSpin: 0, spin: 0, bob: 0, pulse: 0 };
  const c = clamp01(channel);
  o.pulse = 0.5 + 0.5 * Math.sin(t * (state === 'awake' ? 3.2 : 1.1));
  o.bob = 0.25 * Math.sin(t * 0.9);
  if (state === 'dormant') {
    o.glow = 0.22 + 0.06 * o.pulse;
    o.gold = 0;
    o.cage = 0.9;
    o.cageSpin = 2.4;
    o.spin = 0.15;
  } else if (state === 'awake') {
    o.glow = 0.9 + 0.5 * o.pulse;
    o.gold = 0;
    o.cage = 0.55;
    o.cageSpin = 1.6;
    o.spin = 0.4;
  } else if (state === 'channel') {
    o.glow = 1.2 + 0.8 * c + 0.2 * Math.sin(t * 14);
    o.gold = 0.6 * c;
    o.cage = 0.55 * (1 - c);
    o.cageSpin = 1.6 * (1 - c * 0.8);
    o.spin = 0.4 + 1.6 * c;
  } else {
    o.glow = 0.85 + 0.1 * o.pulse;
    o.gold = 1;
    o.cage = 0;
    o.cageSpin = 0;
    o.spin = 0.08;
  }
  return o;
}

/** A stone's state from what the scan read: its body (alive or not), the
 *  stilled marker on it and a player channelling it. */
export function stoneState(
  body: { auras: readonly { id: string }[] } | null,
  channelling: boolean,
): StoneState {
  if (!body) return 'dormant';
  if (body.auras.some((a) => a.id === ISLE_AURAS.cocoon)) return 'stilled';
  return channelling ? 'channel' : 'awake';
}

// ---- the adds ---------------------------------------------------------------------------

/** The Gust Herald's lane: the sim's own reach and half width (yards). */
export const SHOVE_LANE = { length: IT.shoveReach, half: IT.shoveHalfWidth } as const;

/** The Squall Shieldbearer's ward from its aura (`value2`: the front arc's
 *  half in degrees; the sim's own default 60): the half arc in radians. */
export function wardHalfArc(value2: number | undefined): number {
  const deg = value2 !== undefined && value2 > 0 ? Math.min(180, value2) : 60;
  return (deg * Math.PI) / 180;
}

/** The ward's shield of wind and stone: its radius (yards) round the
 *  Shieldbearer and its height over its feet. */
export const WARD_SHAPE = { radius: 2.9, height: 3.6, floor: 6.5 } as const;

/** A Riven Squall's split: seconds of its burst. */
export const SPLIT_SECONDS = 0.9;

/** Pools (fixed: no allocation in a fight). */
export const PHASE_POOLS = {
  /** Heralds' lanes at once (one per Herald isle, a spare). */
  lanes: 3,
  /** Shieldbearers' wards at once. */
  wards: 3,
  /** Mending Gale beams at once (a Mender to each ally). */
  mendBeams: 6,
  /** Channellers on the stones at once. */
  channels: 4,
} as const;

/** A stilled Stillstone's choke on the nova (Jose's playtest of 2026-11-18:
 *  "when the crystal lights up it should channel lightning"): from the
 *  moment its stone is stilled until the cocoon ends, a beam of gold calm
 *  pours from the crystal into the nova, lightning crawling along it and
 *  forking over the nova where it bites, so the two stones visibly strangle
 *  it. `rise` seconds to full (it follows the stilling's bolt home), the
 *  beam's half width at the stone (yards), how often its lightning re-forms
 *  (a second), the forks over the nova where it lands. */
export const CHOKE = { rise: 0.7, half: 1.7, flicker: 14, forks: 3 } as const;

export interface ChokeLook {
  /** The beam's half width at the stone (yards) and its light. */
  half: number;
  glow: number;
  /** Its lightning's light and width (yards). */
  bolt: number;
  boltWidth: number;
  /** The bite on the nova: the glow's size in nova radii. */
  bite: number;
}

/** The choke's look `age` seconds after its stone was stilled, at clock `t`:
 *  surging in, then a steady throb (never dark while the stone holds). */
export function chokeLook(
  age: number,
  t: number,
  out: ChokeLook = { half: 0, glow: 0, bolt: 0, boltWidth: 0, bite: 0 },
): ChokeLook {
  const rise = clamp01(age / CHOKE.rise);
  const surge = rise * rise * (3 - 2 * rise);
  // A flare as it first bites, settling to its throb.
  const flare = Math.max(0, 1 - Math.abs(age - CHOKE.rise) / 0.5);
  const throb = 0.85 + 0.15 * Math.sin(t * 5.3) + 0.06 * Math.sin(t * 17.1);
  out.half = CHOKE.half * surge * (1 + 0.35 * flare);
  out.glow = surge * (1.5 * throb + 1.2 * flare);
  out.bolt = surge * (1.1 + 0.9 * flare) * (0.8 + 0.2 * Math.sin(t * 31));
  out.boltWidth = 0.9 + 0.6 * flare;
  out.bite = surge * (0.9 + 0.25 * throb + 0.6 * flare);
  return out;
}
