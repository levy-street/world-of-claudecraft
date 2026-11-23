// Pure plan for the Hollow Crypt trash mechanics pass's hero effects
// (crypt_trash_kit_fx.ts and its two parts, crypt_bone_fx.ts and
// crypt_mark_fx.ts): the Reassemble bone pile's countdown glow and the soul
// tether to its necromancer, the Grave Rupture blast and its heroic pool, the
// Splinter Burst, the Marrow Crush crack, the gargoyle's Granite Skin crust and
// its Cracked Stone, the Carrion Eye bolt and glyph, the Rimesilk Spit strand
// and web net, and the heroic Barrow Embers.
//
// Every footprint and every clock comes from the sim's own templates
// (src/sim/content/hollow_crypt_trash.ts, the widow in dungeons.ts), so the
// glow counts down the seconds the sim counts and the fire covers the cone the
// sim burns. Presentation only: nothing here decides an outcome.
//
// Three-free, DOM-free, deterministic.

import { dungeonAt, MOBS } from '../../sim/data';
import { type CreatureAnchor, fxHash } from './crypt_creature_fx_core';

/** The templates the trash kit's effects key on. */
export const CRYPT_KIT_MOBS = {
  warrior: 'crypt_ossuary_warrior',
  necromancer: 'crypt_gravecaller_necromancer',
  minion: 'crypt_bone_minion',
  brute: 'crypt_bone_brute',
  gargoyle: 'crypt_chapel_gargoyle',
  caller: 'crypt_crow_caller',
  crow: 'crypt_carrion_crow',
  drake: 'crypt_ossuary_drake',
  widow: 'bonechill_widow',
} as const;

// ---------------------------------------------------------------- the host

/** The crypt's dungeon id. The kit's roster walks run only while the local
 *  player stands in its claim (an instance x-band, `dungeonAt`): everywhere
 *  else there is nothing of it to find, so the walk is skipped outright. */
export const HOLLOW_CRYPT_DUNGEON = 'hollow_crypt';
export function inHollowCrypt(x: number): boolean {
  return dungeonAt(x)?.id === HOLLOW_CRYPT_DUNGEON;
}

/** How often (seconds) the host walks the roster for the parts. */
export const KIT_SCAN_SECONDS = 0.1;

/** Slots of the pools a roster walk claims (one per live owner). A crypt pack
 *  holds at most three Ossuary Warriors and one gargoyle, so a double pull
 *  fits; a newcomer past the cap simply goes undrawn until a slot frees. */
export const CRYPT_KIT_SLOTS = {
  piles: 6,
  pools: 3,
  gargoyles: 3,
  eyes: 4,
  nets: 5,
  embers: 2,
  objects: 8,
} as const;

/**
 * The slot `owner` holds, else a free one (claimed for it), else null. A slot
 * whose owner still lives is NEVER taken: evicting a live owner made the next
 * walk re-lay it, restarting its clock and flash every scan. One-shot effects
 * (bolts, strands, shockwaves, flashes) recycle their oldest instead; they are
 * fired by events, never re-claimed by a walk.
 */
export function claimSlot<T extends { owner: number }>(
  slots: readonly T[],
  owner: number,
): T | null {
  let free: T | null = null;
  for (const s of slots) {
    if (s.owner === owner) return s;
    if (free === null && s.owner < 0) free = s;
  }
  if (free) free.owner = owner;
  return free;
}

/** Linear RGB triples of the kit's elements (the shaders and particles read
 *  these; HDR multipliers are applied by the painter). */
export type Rgb = readonly [number, number, number];
/** Sickly soul-green: the necromancers' grave light on the bones. */
export const SOUL_GREEN: Rgb = [0.52, 1.0, 0.4];
/** Old bone, the colour of every shard and splinter. */
export const BONE_WHITE: Rgb = [0.88, 0.84, 0.72];
/** The Crow Caller's carrion light: a bruised violet, near black at its heart. */
export const CARRION_VIOLET: Rgb = [0.66, 0.24, 1.0];
/** Rimesilk: frost-white web. */
export const RIME_WHITE: Rgb = [0.86, 0.96, 1.0];
/** The gargoyle's thickening stone: pale granite. */
export const GRANITE_PALE: Rgb = [0.72, 0.7, 0.66];
/** Cracked Stone's fissures: a hot amber that reads as "hit it now". */
export const CRACK_AMBER: Rgb = [1.0, 0.6, 0.2];

// ---------------------------------------------------------------- Reassemble

/** Seconds a bone pile lies before its warrior stands (the template's own clock). */
export function reassembleSeconds(): number {
  return MOBS[CRYPT_KIT_MOBS.warrior]?.trashKit?.reassemble?.seconds ?? 8;
}

/** How far a living necromancer may stand from its pile for the soul tether. */
export const PILE_TETHER_REACH = 40;

/** The pile's countdown progress in [0, 1]: 0 as it is laid, 1 as it stands. */
export function pileProgress(elapsed: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / seconds));
}

/** The glow's pulse rate (beats a second): a slow breath that quickens to a
 *  frantic heartbeat as the countdown runs out. */
export function pilePulseHz(progress: number): number {
  const k = Math.min(1, Math.max(0, progress));
  return 0.7 + 4.6 * k * k;
}

/**
 * The glow's brightness at pulse `phase` (in beats) and countdown `progress`:
 * a sharp beat over a floor that rises as the warrior nears standing, so the
 * last seconds read as urgent even between beats.
 */
export function pileGlow(phase: number, progress: number): { ring: number; core: number } {
  const k = Math.min(1, Math.max(0, progress));
  const c = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
  const beat = c * c * c;
  const floor = 0.32 + 0.38 * k;
  return { ring: Math.min(1.6, floor + (0.55 + 0.45 * k) * beat), core: floor * 0.8 + 0.6 * beat };
}

/** Bone chips rattling on the pile, per second: a twitch that becomes a stir. */
export function pileRattleRate(progress: number): number {
  const k = Math.min(1, Math.max(0, progress));
  return 3 + 22 * k * k;
}

/**
 * When a pile's countdown began, on the painter's clock. The sim keeps the
 * pile's own clock (Entity.trashLife) off the wire, so the windup spellfx it
 * sends as the pile is laid is the exact start. A pile first seen without it
 * (laid out of this client's interest, or before it joined) is placed
 * PILE_UNSEEN_PROGRESS into its countdown: its beat then reads too urgent
 * rather than too calm, which is the safe error for "it stands soon".
 */
export const PILE_UNSEEN_PROGRESS = 0.5;
export function pileBornAt(windupAt: number | null, firstSeen: number, seconds: number): number {
  if (windupAt !== null) return windupAt;
  return firstSeen - Math.max(0, seconds) * PILE_UNSEEN_PROGRESS;
}

/** The index of the point nearest (x, z) within `reach`, or -1. Ties go to
 *  the earlier point (callers pass entities in a stable order). */
export function nearestWithin(
  x: number,
  z: number,
  points: readonly { x: number; z: number }[],
  count: number,
  reach: number,
): number {
  let best = -1;
  let bestD = reach * reach;
  const n = Math.min(count, points.length);
  for (let i = 0; i < n; i++) {
    const dx = points[i].x - x;
    const dz = points[i].z - z;
    const d = dx * dx + dz * dz;
    if (d <= bestD && (best < 0 || d < bestD)) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** The bones drawn back into a standing warrior: each shard starts on a ring
 *  out to `reach` and arrives at the body over `seconds`. */
export const REASSEMBLE_GATHER = { reach: 4.2, seconds: 0.42 } as const;
/** The crumble's scatter: how far the bones fly and how long the glow dies. */
export const CRUMBLE = { speed: 6.5, glowFade: 0.45 } as const;

// ---------------------------------------------------------------- Grave Rupture

/** The rupture's ring, cast bar and heroic pool, off the necromancer's template. */
export function ruptureSpec(): {
  radius: number;
  range: number;
  castTime: number;
  poolSeconds: number;
} {
  const r = MOBS[CRYPT_KIT_MOBS.necromancer]?.trashKit?.rupture;
  return {
    radius: r?.radius ?? 0,
    range: r?.range ?? 0,
    castTime: r?.castTime ?? 0,
    poolSeconds: r?.pool.seconds ?? 0,
  };
}

/**
 * The ring's fill in [0, 1]. `casterFill` is the bar of the necromancer
 * casting it (null when none is in view); without it the ring fills on its own
 * age over the template's cast time, so a far caster still reads.
 */
export function ruptureRingFill(casterFill: number | null, age: number, castTime: number): number {
  if (casterFill !== null) return Math.min(1, Math.max(0, casterFill));
  if (castTime <= 0) return 1;
  return Math.min(1, Math.max(0, age / castTime));
}

/** The blast's timeline: a white-green flash, then a charred crater whose
 *  embers die over `scorch` seconds. */
export const RUPTURE_BLAST = { flash: 0.28, scorch: 4.2 } as const;

/** The scorch under a burst corpse `t` seconds after the blast. */
export function ruptureScorch(t: number): { flash: number; char: number; embers: number } {
  if (t < 0 || t > RUPTURE_BLAST.scorch) return { flash: 0, char: 0, embers: 0 };
  const flash = t < RUPTURE_BLAST.flash ? 1 - t / RUPTURE_BLAST.flash : 0;
  const k = t / RUPTURE_BLAST.scorch;
  const char = Math.min(1, t / 0.12) * (1 - k * k);
  const embers = Math.min(1, t / 0.2) * (1 - k) * (1 - k);
  return { flash, char, embers };
}

/** A floor hazard's level: a quick swell in, and a quick fade once its object
 *  is gone (`goneFor` seconds since, negative while it stands). */
export function hazardLevel(age: number, goneFor: number, fadeIn = 0.25, fadeOut = 0.4): number {
  const up = fadeIn > 0 ? Math.min(1, Math.max(0, age / fadeIn)) : 1;
  if (goneFor < 0) return up;
  return up * Math.max(0, 1 - goneFor / fadeOut);
}

// ---------------------------------------------------------------- Splinter Burst

/** The minion's burst reach (its deathThroes radius). */
export function splinterReach(): number {
  return MOBS[CRYPT_KIT_MOBS.minion]?.deathThroes?.radius ?? 0;
}

// ---------------------------------------------------------------- Marrow Crush

/** The Bone Brute's crush footprint, off its breath cone. */
export function marrowCrushCone(): { range: number; arcDeg: number } {
  const b = MOBS[CRYPT_KIT_MOBS.brute]?.breathCone;
  return { range: b?.range ?? 0, arcDeg: b?.arcDeg ?? 0 };
}

/** The crush crack `t` seconds after it lands: the fissure tears down the
 *  cone to its tip (`reach`, a share of the range), then the cracks cool. */
export const MARROW_CRACK = { tear: 0.24, seconds: 3.2 } as const;
export function marrowCrack(t: number): { reach: number; glow: number; fade: number } {
  if (t < 0 || t > MARROW_CRACK.seconds) return { reach: 0, glow: 0, fade: 0 };
  const k = Math.min(1, t / MARROW_CRACK.tear);
  const reach = 1 - (1 - k) ** 3;
  const glow = Math.max(0, 1 - t / 0.9);
  const fade = 1 - Math.max(0, (t - MARROW_CRACK.seconds * 0.55) / (MARROW_CRACK.seconds * 0.45));
  return { reach, glow, fade };
}

// ---------------------------------------------------------------- Granite Skin

/** The gargoyle's ward: its stack cap and the crack's seconds. */
export function graniteSpec(): { maxStacks: number; crackedSeconds: number } {
  const g = MOBS[CRYPT_KIT_MOBS.gargoyle]?.trashKit?.granite;
  return { maxStacks: g?.maxStacks ?? 0, crackedSeconds: g?.cracked.seconds ?? 0 };
}

/** The gargoyle's body volume at its authored size (its Ready crouch): its
 *  centre over the floor and its half extents, in yards at scale 1. Scaled by
 *  the entity's own scale. */
export const GARGOYLE_BODY: CreatureAnchor & { rx: number; ry: number; rz: number } = {
  forward: 0.53,
  up: 3.51,
  rx: 1.66,
  ry: 1.63,
  rz: 2.11,
};

/** Stone plates each layer of Granite Skin lays on the body. */
export const GRANITE_PLATES_PER_LAYER = 8;
/** Stone flakes orbiting per layer. */
export const GRANITE_FLAKES_PER_LAYER = 4;

/** The crust at `stacks` of `maxStacks`: how many plates show, how thick they
 *  stand off the body, how pale they read, and how many flakes orbit. */
export function graniteCrust(
  stacks: number,
  maxStacks: number,
): { plates: number; crustDepth: number; pale: number; flakes: number; orbit: number } {
  const cap = Math.max(1, maxStacks);
  const s = Math.min(cap, Math.max(0, Math.floor(stacks)));
  const k = s / cap;
  return {
    plates: s * GRANITE_PLATES_PER_LAYER,
    crustDepth: s > 0 ? 0.55 + 0.45 * k : 0,
    pale: k,
    flakes: s * GRANITE_FLAKES_PER_LAYER,
    orbit: 0.6 + 0.9 * k,
  };
}

/**
 * Plate `i` of `total`'s spot on the unit body ellipsoid (+z forward, +y up)
 * and its size: a Fibonacci sphere walked in a stride coprime to its count,
 * so each layer's plates land spread over the whole body, every new layer
 * fills the gaps the earlier ones left, and the crust closes as it thickens.
 * The lowest band is left free (the legs and talons).
 */
export function crustPlateSpot(
  i: number,
  total: number,
): { x: number; y: number; z: number; size: number } {
  const n = Math.max(1, total);
  let stride = 13;
  while (gcd(stride, n) !== 1) stride++;
  const j = (i * stride) % n;
  const y = 0.94 - 1.66 * ((j + 0.5) / n) + (fxHash(j * 5.3) - 0.5) * 0.05;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = j * 2.399963 + fxHash(j * 3.1) * 0.3;
  return {
    x: Math.sin(a) * r,
    y,
    z: Math.cos(a) * r,
    size: 0.2 + 0.14 * fxHash(j * 1.7 + 0.3),
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

/** A new layer slams on: its plates start oversized and settle with a flash. */
export const LAYER_SLAM_SECONDS = 0.38;
export function layerSlam(age: number): { scale: number; flash: number } {
  if (age < 0 || age >= LAYER_SLAM_SECONDS) return { scale: 1, flash: 0 };
  const k = age / LAYER_SLAM_SECONDS;
  return { scale: 1 + 0.3 * (1 - k) * (1 - k), flash: 1 - k };
}

/** Cracked Stone's glow on the body: it flares in at the shatter, flickers
 *  hot while the crack holds, and dims over its last second. Zero when gone. */
export function crackedGlow(remaining: number, elapsed: number, clock: number): number {
  if (remaining <= 0) return 0;
  const inn = Math.min(1, Math.max(0, elapsed / 0.15));
  const out = Math.min(1, remaining / 1);
  const flicker = 0.78 + 0.14 * Math.sin(clock * 17.3) + 0.08 * Math.sin(clock * 41.1);
  return inn * out * flicker;
}

/** Glowing fissure sprites on the cracked body. */
export const CRACK_SPRITES = 7;

// ---------------------------------------------------------------- Carrion Eye

/** The mark's seconds, off the Crow Caller's template. */
export function carrionEyeSeconds(): number {
  return MOBS[CRYPT_KIT_MOBS.caller]?.trashKit?.eye?.seconds ?? 0;
}

/** The carrion bolt's flight from the caller's staff to its victim. */
export const CARRION_BOLT = { seconds: 0.42, lift: 1.6 } as const;

/** A point on an arced bolt flight from a to b at `t` in [0, 1], written
 *  into `out` (the arc lifts `lift` yards at its middle). */
export function boltArcInto(
  t: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  lift: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const k = Math.min(1, Math.max(0, t));
  out.x = ax + (bx - ax) * k;
  out.y = ay + (by - ay) * k + 4 * lift * k * (1 - k);
  out.z = az + (bz - az) * k;
  return out;
}

/** How high over the victim's feet the eye hangs (a player stands 2.6). */
export const EYE_LIFT = 4.1;

/** The eye glyph `age` seconds into the mark with `remaining` left: it opens
 *  wide with a snap, bobs, blinks now and then, and closes as the mark ends. */
export function eyeGlyph(
  age: number,
  remaining: number,
  clock: number,
): { alpha: number; scale: number; bob: number; open: number } {
  if (remaining <= 0) return { alpha: 0, scale: 0, bob: 0, open: 0 };
  const snap = Math.min(1, Math.max(0, age / 0.22));
  const pop = 1 + 0.35 * Math.sin(Math.min(1, snap) * Math.PI);
  const end = Math.min(1, remaining / 0.4);
  // A blink every ~2.3 s: the lid shuts for a tenth of a second.
  const beat = (clock * 0.43) % 1;
  const blink = beat < 0.04 ? Math.abs(beat - 0.02) / 0.02 : 1;
  return {
    alpha: snap * end,
    scale: pop * (0.85 + 0.15 * end),
    bob: Math.sin(clock * 2.4) * 0.12,
    open: snap * end * blink,
  };
}

// ---------------------------------------------------------------- Rimesilk Spit

/** The widow's lane and root, off her template. */
export function rimesilkLane(): { length: number; halfWidth: number; root: number } {
  const l = MOBS[CRYPT_KIT_MOBS.widow]?.trashKit?.line;
  return { length: l?.length ?? 0, halfWidth: l?.halfWidth ?? 0, root: l?.root ?? 0 };
}

/** The strand shot down the lane: its head races out, it hangs, then it
 *  sags and frays away. Shares of the lane's length and a fade. */
export const STRAND = { shoot: 0.16, hang: 0.45, fade: 0.4 } as const;
export function strandPhase(t: number): { head: number; tail: number; alpha: number } {
  if (t < 0 || t > STRAND.shoot + STRAND.hang + STRAND.fade) return { head: 0, tail: 0, alpha: 0 };
  const head = Math.min(1, t / STRAND.shoot);
  const after = t - STRAND.shoot - STRAND.hang;
  const alpha = after <= 0 ? 1 : Math.max(0, 1 - after / STRAND.fade);
  const tail = after <= 0 ? 0 : Math.min(1, after / STRAND.fade) * 0.6;
  return { head: 1 - (1 - head) * (1 - head), tail, alpha };
}

/** The web net round a rooted player's feet: it snaps shut and thaws away. */
export function webNetLevel(remaining: number, elapsed: number): number {
  if (remaining <= 0) return 0;
  return Math.min(1, Math.max(0, elapsed / 0.12)) * Math.min(1, remaining / 0.35);
}

/** The net's radius round the feet, in yards. */
export const WEB_NET_RADIUS = 1.45;

// ---------------------------------------------------------------- Barrow Embers

/** The drake's heroic embers: the cone's arc and how long it burns. */
export function barrowEmbersSpec(): { arcDeg: number; seconds: number } {
  const d = MOBS[CRYPT_KIT_MOBS.drake];
  return { arcDeg: d?.breathCone?.arcDeg ?? 0, seconds: d?.trashKit?.scorch?.seconds ?? 0 };
}

/** Ghost-fire tongues a second across a burning cone of `range` yards (scaled
 *  by the effects density). */
export function embersFlameRate(range: number, arcDeg: number, density: number): number {
  const area = (Math.PI * range * range * Math.min(360, arcDeg)) / 360;
  return Math.min(260, area * 0.55) * density;
}
