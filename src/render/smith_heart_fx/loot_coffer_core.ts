// The Smith's Heart's loot moment as numbers: the pure half of
// loot_coffer_fx.ts. When a guardian falls with loot on its body, a forge
// coffer rises out of the floor beside the corpse as its death scene
// resolves: a ring of molten light opens in the stone, the coffer climbs out
// of it shedding sparks and dust, locks in place with an anvil's ring, its
// lid swings open and a shaft of golden light climbs out of it into the
// dark. It waits there, breathing, while the body still holds loot; once it
// is empty the lid falls shut, the light goes out and the embers die, so a
// raid can tell at a glance that nothing is left. When the corpse goes, the
// coffer sinks back into the floor.
//
// It is never a fake click target: the coffer's click proxy carries the
// CORPSE's entity id, so a click on it is a click on the body and opens the
// same authoritative corpse loot through the same interaction path. Nothing
// here decides an outcome; the mood is read from what every client already
// mirrors (the body's `lootable`, its loot slots and this viewer's rights,
// `corpseIndicatorFor`), so offline and online look the same. The loot is
// on the body from the moment of death as it always was: the coffer only
// rises later, as the scene ends.
//
// One coffer for every guardian; each boss lends it its palette (the
// council's stone gold, the Breath's storm, the Quench's frost, the Heat's
// ember, the Masterless Strength's white forge), its moment and its spot.
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a
// hash, never rng).

import { BREATH_GUARDIAN } from '../../sim/encounters/smith_heart/breath_ids';
import {
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../../sim/encounters/smith_heart/council_ids';
import { FINAL_BOSS } from '../../sim/encounters/smith_heart/final_ids';
import { HEAT_GUARDIAN } from '../../sim/encounters/smith_heart/heat_ids';
import { QUENCH_GUARDIAN } from '../../sim/encounters/smith_heart/quench_ids';
import { BREATH_DEATH } from './breath_death_core';
import { councilSecondDeathSeconds } from './council_death_core';
import { DEATH_END } from './final_death_core';
import { HEAT_DEATH } from './heat_death_core';
import { QUENCH_DEATH } from './quench_death_core';

// ---- the guardians' flavours -------------------------------------------------------------

export type LootCofferFlavour = 'stone' | 'storm' | 'frost' | 'ember' | 'forge';

export interface LootCofferPalette {
  /** The molten inlays, the runes, the floor ring (hex). */
  readonly accent: number;
  /** The shaft of light: always the gold of loot, warmed toward the accent. */
  readonly shaft: number;
  /** The sparks it sheds, cycled (rgb 0..1). */
  readonly sparks: readonly (readonly [number, number, number])[];
}

export const LOOT_COFFER_PALETTES: Readonly<Record<LootCofferFlavour, LootCofferPalette>> = {
  // The quarry's ochre and the Singer's amber.
  stone: {
    accent: 0xffae3c,
    shaft: 0xffcf6a,
    sparks: [
      [1, 0.78, 0.36],
      [1, 0.62, 0.22],
      [1, 0.9, 0.62],
    ],
  },
  // The storm's pale lightning over the gold.
  storm: {
    accent: 0x7fd8ff,
    shaft: 0xffd98a,
    sparks: [
      [0.62, 0.88, 1],
      [1, 0.86, 0.5],
      [0.86, 0.96, 1],
    ],
  },
  // The Quench's rime light.
  frost: {
    accent: 0x9fe6ff,
    shaft: 0xffe2a0,
    sparks: [
      [0.7, 0.92, 1],
      [1, 0.9, 0.6],
      [0.92, 0.98, 1],
    ],
  },
  // The Heat's embers.
  ember: {
    accent: 0xff6a1e,
    shaft: 0xffc25a,
    sparks: [
      [1, 0.5, 0.14],
      [1, 0.72, 0.3],
      [1, 0.36, 0.08],
    ],
  },
  // The Heart: white forge-gold, its sparks the four veins' colours.
  forge: {
    accent: 0xfff0c4,
    shaft: 0xffe6a8,
    sparks: [
      [1, 0.74, 0.3],
      [0.6, 0.85, 1],
      [0.42, 0.78, 0.94],
      [0.85, 0.58, 0.26],
    ],
  },
};

export interface LootCofferBoss {
  readonly flavour: LootCofferFlavour;
  /** Seconds after the death when the coffer starts to rise: the death
   *  scene's own resolution, so it never steps on the scene's climax. */
  readonly revealAt: number;
  /** Yards from the corpse's centre to the coffer's. At most
   *  `LOOT_COFFER_IN_REACH` past the body's own loot reach bonus (its
   *  bodyRadius, sim/loot/corpse_loot_reach.ts), so a looter standing at the
   *  coffer's front is inside the body's loot reach and the click or the
   *  interact key works from right there. The Heat guardian lies in the
   *  middle of its 10.5 yd wellspring and is looted from the lip, so its
   *  coffer stands further out than the others. */
  readonly reach: number;
  /** Radians off the body's facing (0: straight in front of it). */
  readonly bearing: number;
}

/** A coffer stands no further than this past its corpse's loot reach bonus
 *  (0 for an ordinary body): its front (half its depth, scaled) plus a
 *  looter's step stay inside the body's loot reach (INTERACT_RANGE plus that
 *  bonus). */
export const LOOT_COFFER_IN_REACH = 3.3;
/** No coffer ever stands further than this. */
export const LOOT_COFFER_MAX_REACH = 12;

/** The bosses that raise a coffer (their template ids), each with its look. */
export const LOOT_COFFER_BOSSES: Readonly<Record<string, LootCofferBoss>> = {
  [COUNCIL_GUARDIAN]: {
    flavour: 'stone',
    revealAt: councilSecondDeathSeconds('guardian') - 1.2,
    reach: 3.2,
    bearing: 0.35,
  },
  [COUNCIL_SEAM_SINGER]: {
    flavour: 'stone',
    revealAt: councilSecondDeathSeconds('singer') - 1.2,
    reach: 3.2,
    bearing: -0.35,
  },
  [BREATH_GUARDIAN]: {
    flavour: 'storm',
    revealAt: BREATH_DEATH.end - 1.4,
    reach: 3.2,
    bearing: 0,
  },
  [QUENCH_GUARDIAN]: {
    flavour: 'frost',
    revealAt: QUENCH_DEATH.end - 1.4,
    reach: 3.2,
    bearing: 0,
  },
  [HEAT_GUARDIAN]: {
    flavour: 'ember',
    revealAt: HEAT_DEATH.end - 1.2,
    reach: 8.6,
    bearing: 0,
  },
  [FINAL_BOSS]: {
    flavour: 'forge',
    revealAt: DEATH_END - 1.0,
    reach: 3.3,
    bearing: 1.57,
  },
};

export function lootCofferBoss(templateId: string): LootCofferBoss | null {
  return LOOT_COFFER_BOSSES[templateId] ?? null;
}

/** Where the coffer stands beside a corpse at (x, z) facing `facing` (the
 *  game's bearing: forward is (sin, cos)), and its own yaw (its front looks
 *  away from the body, toward whoever walks up to loot it). */
export function lootCofferSpot(
  x: number,
  z: number,
  facing: number,
  boss: LootCofferBoss,
  out: { x: number; z: number; yaw: number },
): { x: number; z: number; yaw: number } {
  const a = facing + boss.bearing;
  const r = Math.min(boss.reach, LOOT_COFFER_MAX_REACH);
  out.x = x + Math.sin(a) * r;
  out.z = z + Math.cos(a) * r;
  out.yaw = a;
  return out;
}

// ---- what the body still holds ------------------------------------------------------------

/** `yours`: this viewer has loot on the body (the open coffer, its shaft
 *  and sparks at full). `others`: the body is still lootable, but not by
 *  this viewer (rolls running, another's personal drop): the lid ajar, a
 *  soft glow, no shaft. `empty`: nothing left: the lid shut, the light out. */
export type LootCofferMood = 'yours' | 'others' | 'empty';

/** The mood off the viewer's own corpse indicator (`corpseIndicatorFor`:
 *  'loot' when this viewer may take something) and the body's mirrored
 *  `lootable` flag and decay. */
export function lootCofferMood(
  indicator: 'loot' | 'harvest' | 'none',
  dead: boolean,
  lootable: boolean,
  decayed: boolean,
): LootCofferMood {
  if (!dead || decayed) return 'empty';
  if (indicator === 'loot') return 'yours';
  return lootable ? 'others' : 'empty';
}

// ---- the beats ---------------------------------------------------------------------------

/** The rise (seconds after it begins). */
export const LOOT_COFFER = {
  /** The molten ring opens in the floor over this long. */
  ringOpen: 0.55,
  /** The coffer climbs out of the floor between these. */
  climbFrom: 0.3,
  climbTo: 1.25,
  /** How deep it starts under the floor (yards). */
  depth: 2.6,
  /** It locks in place: the flash, the anvil's ring, a burst of sparks. */
  lockAt: 1.25,
  /** The lid swings open from here, over `openFor`. */
  openAt: 1.45,
  openFor: 0.7,
  /** The shaft bursts up out of the open coffer here. */
  shaftAt: 1.5,
  /** The burst settles to the steady shaft over this long. */
  burstFor: 0.9,
  /** The ring in the floor fades out by here. */
  ringGone: 2.6,
  /** The ceremony is over: the coffer simply waits. */
  end: 2.8,
  /** Emptied: the lid falls shut over this long. */
  closeFor: 0.42,
  /** Emptied and shut, it lingers dark this long, then sinks away (so a
   *  looted coffer never holds a slot a later guardian needs). */
  emptyHold: 6,
  /** Gone (the body taken away, or a reset): it sinks back over this long. */
  sinkFor: 1.3,
  /** The floor ring's radius at its widest (yards). */
  ringRadius: 2.9,
} as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

export interface LootCofferRise {
  /** Yards under its resting place. */
  sink: number;
  /** The floor ring: its radius share (0..1) and strength. */
  ring: number;
  ringAlpha: number;
  /** The pool of light under it. */
  pool: number;
  /** The lock's flash, 0..1. */
  flash: number;
  /** The lid's share of its open angle, 0..1. */
  open: number;
  /** The shaft's strength (past 1 in its burst). */
  shaft: number;
  /** How hard it sheds sparks and dust while it climbs, 0..1. */
  shed: number;
  done: boolean;
}

/** The rise `age` seconds in. Reduced motion (`calm`): no climb, no flash,
 *  no burst; the coffer is simply there and its light fades in. */
export function lootCofferRise(age: number, calm: boolean, out: LootCofferRise): LootCofferRise {
  const R = LOOT_COFFER;
  const t = Math.max(0, age);
  if (calm) {
    const fade = smooth(t / 1.2);
    out.sink = 0;
    out.ring = 1;
    out.ringAlpha = 0;
    out.pool = fade;
    out.flash = 0;
    out.open = fade;
    out.shaft = fade;
    out.shed = 0;
    out.done = t >= 1.2;
    return out;
  }
  const climb = clamp01((t - R.climbFrom) / (R.climbTo - R.climbFrom));
  // Out of the floor fast, easing into its lock (a heavy thing, set down).
  const eased = 1 - (1 - climb) * (1 - climb) * (1 - climb);
  out.sink = R.depth * (1 - eased);
  out.ring = 0.25 + 0.75 * smooth(t / R.ringOpen);
  out.ringAlpha =
    smooth(t / (R.ringOpen * 0.6)) * (1 - smooth((t - R.lockAt) / (R.ringGone - R.lockAt)));
  out.pool = smooth(t / R.ringOpen);
  out.flash = Math.max(0, 1 - Math.abs(t - R.lockAt) / 0.16);
  out.open = smooth((t - R.openAt) / R.openFor);
  const burst = t < R.shaftAt ? 0 : Math.max(0, 1 - (t - R.shaftAt) / R.burstFor);
  out.shaft = smooth((t - R.shaftAt) / 0.18) * (1 + 0.9 * burst * burst);
  out.shed = t < R.climbFrom || t > R.lockAt + 0.1 ? 0 : 1;
  out.done = t >= R.end;
  return out;
}

/** Where the coffer's light settles for each mood. */
export interface LootCofferTarget {
  /** Lid angle (degrees open). */
  readonly lid: number;
  /** The molten light inside and in the inlays. */
  readonly glow: number;
  /** The shaft of light. */
  readonly shaft: number;
  /** The sparks and motes it sheds, 0..1. */
  readonly sparks: number;
}

export const LOOT_COFFER_TARGETS: Readonly<Record<LootCofferMood, LootCofferTarget>> = {
  yours: { lid: 68, glow: 1, shaft: 1, sparks: 1 },
  others: { lid: 26, glow: 0.5, shaft: 0, sparks: 0.3 },
  // Shut, the inlays cooled to a last dull ember.
  empty: { lid: 0, glow: 0.07, shaft: 0, sparks: 0 },
};

/** How fast each level eases toward its target (units per second). The lid
 *  falls shut faster than it opens: a lid let go. */
export const LOOT_COFFER_RATES = {
  lidOpen: 120,
  lidShut: 68 / LOOT_COFFER.closeFor,
  glowUp: 1.6,
  glowDown: 1.1,
  shaft: 1.8,
  sparks: 2.5,
} as const;

/** Step `v` toward `target` at `rateUp` (rising) or `rateDown` (falling)
 *  units per second over `dt`. */
export function lootCofferEase(
  v: number,
  target: number,
  dt: number,
  rateUp: number,
  rateDown: number = rateUp,
): number {
  if (v < target) return Math.min(target, v + rateUp * dt);
  if (v > target) return Math.max(target, v - rateDown * dt);
  return v;
}

/** Is the coffer a click on its corpse right now? Only while the body holds
 *  something, the body is there, and the coffer is up out of the floor
 *  (never a click target that would open nothing). */
export function lootCofferClickable(gone: boolean, mood: LootCofferMood, sink: number): boolean {
  return !gone && mood !== 'empty' && sink < 1;
}

/** Has an emptied coffer shut and lingered long enough to sink away? */
export function lootCofferSettled(mood: LootCofferMood, emptyFor: number): boolean {
  return mood === 'empty' && emptyFor >= LOOT_COFFER.closeFor + LOOT_COFFER.emptyHold;
}

/** The waiting coffer's breath: a slow swell with a surge now and then
 *  (each surge nudged by a hash so it never reads as a loop), 0..1. */
export function lootCofferBreath(t: number, calm: boolean): number {
  if (calm) return 0.5;
  const slow = 0.5 + 0.5 * Math.sin(t * 1.6);
  const interval = 3.1;
  const cycle = Math.floor(t / interval);
  const local = t - cycle * interval - hash(cycle, 5) * interval * 0.4;
  const surge = local < 0 || local > 0.6 ? 0 : Math.sin((local / 0.6) * Math.PI);
  return clamp01(0.65 * slow + 0.6 * surge * surge);
}

/** The sinking coffer `age` seconds after its body went: yards under. */
export function lootCofferSink(age: number, calm: boolean): number {
  if (calm) return 0;
  const t = clamp01(age / LOOT_COFFER.sinkFor);
  return LOOT_COFFER.depth * t * t;
}

/** Its alpha while it goes (reduced motion fades instead of sinking). */
export function lootCofferFade(age: number): number {
  return 1 - smooth(age / LOOT_COFFER.sinkFor);
}

// ---- the particles -----------------------------------------------------------------------

/** Sparks and motes per second at full (`sparks` 1), before the tier's
 *  share: rising out of the open coffer, and glints climbing the shaft. */
export const LOOT_COFFER_EMIT = {
  motes: 22,
  glints: 9,
  /** The climb's grit and sparks off the coffer's flanks, per second. */
  climbSparks: 46,
  climbDust: 18,
  /** The lock's burst. */
  lockSparks: 70,
  lockDust: 22,
  /** The lid falling shut: a puff of dust and a last few sparks. */
  shutDust: 12,
  shutSparks: 10,
} as const;

/** Spark colour `i` for a palette (cycled). */
export function lootCofferSpark(
  palette: LootCofferPalette,
  i: number,
): readonly [number, number, number] {
  const list = palette.sparks;
  return list[((i % list.length) + list.length) % list.length];
}

// ---- the sounds (shipped samples only) -----------------------------------------------------

export interface LootCofferSound {
  readonly at: number;
  readonly key: string;
  readonly gain: number;
  readonly rate: number;
}

/** The rise's sounds (seconds after it begins). */
export const LOOT_COFFER_RISE_SOUNDS: readonly LootCofferSound[] = [
  { at: 0.05, key: 'heart_council_slab_grind', gain: 0.55, rate: 1.25 },
  { at: LOOT_COFFER.lockAt - 0.02, key: 'ui_aura_anvil_strike', gain: 0.85, rate: 0.82 },
  { at: LOOT_COFFER.shaftAt, key: 'ui_gather_epic', gain: 0.8, rate: 1 },
];

/** The lid falling shut on an emptied coffer. */
export const LOOT_COFFER_SHUT_SOUND: LootCofferSound = {
  at: 0,
  key: 'heart_council_rock_impact',
  gain: 0.35,
  rate: 1.6,
};

/** Did the rise cross `at` between `prev` and `t` (once, only for a rise
 *  seen crossing it)? */
export function lootCofferCrossed(prev: number, t: number, at: number): boolean {
  return prev >= 0 && prev < at && t >= at && t - at < 0.5;
}

// ---- the tier --------------------------------------------------------------------------------

/** The low tier's share of every particle rate. */
export const LOOT_COFFER_LOW_SHARE = 0.4;

/** The meshes (by name) the low tier never draws: each a cosmetic double
 *  over a beat that reads on its own (the shaft itself, the coffer's light,
 *  its inlays and the floor ring stay on every tier). */
export const LOOT_COFFER_SECONDARY_LAYERS = Object.freeze(['smithHeartLootShaftHalo'] as const);

export function lootCofferBudget(tier: 'low' | 'medium' | 'high' | 'ultra'): {
  share: number;
  secondary: boolean;
} {
  return tier === 'low'
    ? { share: LOOT_COFFER_LOW_SHARE, secondary: false }
    : { share: 1, secondary: true };
}

// ---- helpers -----------------------------------------------------------------------------

/** Deterministic hash in [0, 1). */
export function lootCofferHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash = lootCofferHash;
