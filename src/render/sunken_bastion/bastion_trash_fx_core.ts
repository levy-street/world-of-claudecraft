// Pure plan for the Sunken Bastion trash mechanics' own visuals
// (bastion_trash_fx.ts): the garrison fighting as soldiers.
//
//  - Boathook Drag (Drowned Watchman): the rusted hook shot down its lane on a
//    chain, the chain taut to whoever it caught for the whole drag, reeled in
//    slack when it caught nobody.
//  - Halberd Wall (heroic): the linked ward two watchmen side by side share.
//  - Fall Back (Fogbound Arbalest): the push-off, the spray trail, the landing.
//  - Soul Hunger (Wreckbound Sailor): the soul swelling with every stack.
//  - Pack Frenzy (Bastion Warhound): the howl and the sea light in its eyes.
//  - Fog Bank (Mist Chanter): the fog patch on the floor and the shroud on the
//    allies standing in it.
//  - Brine Column (Tidebound Acolyte): the column of sea water round its victim.
//  - Snapped Fetters (Shackled Prisoner): the chains breaking, the kneel, the
//    release.
//
// Every size is read back from the sim's own templates, so the chain reaches
// the lane the sim tests and the fog's edge is the radius the sim shrouds in.
// Model-space anchors are in the creatures' Blender units (the builders under
// scripts/assets/), scaled by the VISUALS height exactly as
// bastion_creature_fx_core.ts does.
//
// Presentation only. Three-free, DOM-free, deterministic.

import { dungeonAt, MOBS } from '../../sim/data';
import type { ModelPoint } from './bastion_creature_fx_core';

export const WATCHMAN = 'drowned_watchman';
export const CRAWLER = 'barnacle_crawler';
export const WARHOUND = 'bastion_warhound';
export const CHANTER = 'mistweaver';
export const ACOLYTE = 'tidebound_acolyte';
export const PRISONER = 'shackled_prisoner';
export const ARBALEST_TEMPLATE = 'fogbound_arbalest';

/** The surviving hounds' haste aura (sim/mob/lifecycle.ts frenzyPackmates). */
export const PACK_FRENZY_AURA = 'pack_frenzy';
/** The gesture the renderer plays when a warhound flies into its frenzy (its
 *  VISUALS row maps it to the Howl clip). */
export const BASTION_PACK_HOWL_GESTURE = 'bastion_pack_howl';
/** The gesture the renderer plays when a prisoner's chains snap (its VISUALS
 *  row maps it to the Kneel clip; the KneelLoop holds while the aura lasts). */
export const BASTION_FETTERS_KNEEL_GESTURE = 'bastion_fetters_kneel';

// ---------------------------------------------------------------- pools

/** Every pool the trash painters draw from. A pool never evicts a live read:
 *  a full pool drops the newcomer (the scan retries it while it lasts), and
 *  each count covers the most a Bastion pull can put up at once. */
export const TRASH_FX_SLOTS = {
  /** Boathooks in flight or dragging (one per watchman throw). */
  hooks: 4,
  /** Fog Bank patches (one per Mist Chanter at a time). */
  fogs: 4,
  /** Shrouded allies standing in the fog. */
  shrouds: 8,
  /** Brine Columns (one per Tidebound Acolyte channel). */
  columns: 4,
  /** Warded watchmen holding the Halberd Wall. */
  wards: 8,
  /** Partner links between them (every pair of four, and some). */
  bands: 8,
  /** Released prisoners fading from the world. */
  souls: 3,
  /** Cosmetic shock rings on the floor (howls, splashes, landings). */
  rings: 12,
} as const;

/** The dungeon interior these visuals belong to. */
export const BASTION_INTERIOR = 'sunken_bastion';

/** Whether a body at `x` stands inside a Sunken Bastion claim (the instance
 *  band's own lookup): the trash visuals scan the roster only there. */
export function inBastionClaim(x: number): boolean {
  return dungeonAt(x)?.interior === BASTION_INTERIOR;
}

/**
 * Which body each slot of a pool shows, keeping every body already on a slot
 * where it is (no flicker, never an eviction) and filling free slots with the
 * newcomers in order. `slotIds` holds each slot's current body (-1 free) and
 * is rewritten in place; `wanted` lists the bodies to show, its first
 * `count` used. Bodies past the free slots are dropped. Returns how many
 * slots show a body. Allocation-free.
 */
export function stableSlots(slotIds: number[], wanted: readonly number[], count: number): number {
  // Free every slot whose body is no longer wanted.
  for (let s = 0; s < slotIds.length; s++) {
    const id = slotIds[s];
    if (id < 0) continue;
    let keep = false;
    for (let i = 0; i < count; i++) {
      if (wanted[i] === id) {
        keep = true;
        break;
      }
    }
    if (!keep) slotIds[s] = -1;
  }
  // Seat each newcomer in the first free slot.
  for (let i = 0; i < count; i++) {
    const id = wanted[i];
    if (slotIds.includes(id)) continue;
    const free = slotIds.indexOf(-1);
    if (free < 0) break;
    slotIds[free] = id;
  }
  let used = 0;
  for (const id of slotIds) if (id >= 0) used++;
  return used;
}

// ---------------------------------------------------------------- Boathook

/** The Drowned Watchman GLB's bounding height half a second into Idle (model
 *  units; bastion_drowned_fx_core.ts DROWNED_FX carries the same measure). */
export const WATCHMAN_RAW_HEIGHT = 4.946;
/** Where the hook leaves from: the right fist at the thrust's contact frame
 *  (watchman/clips.py attack: hand_r (-0.22, -1.22, 2.6) in the lunge). */
export const WATCHMAN_HOOK_HAND: ModelPoint = { side: -0.22, up: 2.6, fwd: 1.3 };
/** The chest height a caught victim is hooked at (yards over its feet). */
export const HOOK_VICTIM_CHEST = 1.3;
/** How fast the hook flies (yards a second): the drag starts on the sim's next
 *  tick, so the hook must already be there. */
export const HOOK_SPEED = 110;
/** Seconds the hook takes to snap back to the fist after the drag, or to reel
 *  back slack over the lane when it caught nobody. */
export const HOOK_REEL_CAUGHT = 0.22;
export const HOOK_REEL_MISS = 0.42;
/** Yards between two chain links (a heavy mooring chain, drawn chunky). */
export const CHAIN_LINK_SPACING = 0.34;
/** The most links one chain draws (the 22 yd lane plus the reach to the fist). */
export const CHAIN_MAX_LINKS = 80;

export interface HookSpec {
  length: number;
  halfWidth: number;
  pullSeconds: number;
}

/** The hook's lane and drag, from the watchman's template. */
export function hookSpec(): HookSpec {
  const h = MOBS[WATCHMAN]?.trashKit?.hook;
  return {
    length: h?.length ?? 22,
    halfWidth: h?.halfWidth ?? 1.2,
    pullSeconds: h?.pullSeconds ?? 0.6,
  };
}

/** Seconds the hook flies `distance` yards (a few frames at least). */
export function hookFlightSeconds(distance: number): number {
  return Math.min(0.24, Math.max(0.06, distance / HOOK_SPEED));
}

export type HookStage = 'fly' | 'drag' | 'reel' | 'done';

/**
 * Where a thrown hook is `age` seconds after the throw: flying out (`k` the
 * share of the way flown), holding the caught victim through the drag, or
 * reeling back (`k` the share reeled in). A miss skips the drag.
 */
export function hookPhase(
  age: number,
  flight: number,
  caught: boolean,
  pullSeconds: number,
): { stage: HookStage; k: number } {
  if (age < 0) return { stage: 'fly', k: 0 };
  if (age < flight) return { stage: 'fly', k: flight > 0 ? age / flight : 1 };
  const drag = caught ? Math.max(0.1, pullSeconds - flight) : 0;
  if (age < flight + drag) return { stage: 'drag', k: (age - flight) / drag };
  const reel = caught ? HOOK_REEL_CAUGHT : HOOK_REEL_MISS;
  const t = age - flight - drag;
  if (t < reel) return { stage: 'reel', k: t / reel };
  return { stage: 'done', k: 1 };
}

/** How far a chain of `length` yards hangs at its middle: taut while it drags
 *  someone (a faint thrum), sagging as it flies out and reels in slack. */
export function chainSag(length: number, stage: HookStage, k: number): number {
  if (stage === 'drag') return 0.02;
  if (stage === 'fly') return Math.min(1.4, length * 0.04) * (0.4 + 0.6 * k);
  if (stage === 'reel') return Math.min(1.6, length * 0.06) * (1 - k * 0.5);
  return 0;
}

/** The drop of a chain point `t` of the way along (0 at the fist, 1 at the
 *  hook) for a chain hanging `sag` yards at its middle (a parabola). */
export function chainDrop(t: number, sag: number): number {
  return 4 * sag * t * (1 - t);
}

/** How many links a chain of `length` yards draws. */
export function chainLinkCount(length: number): number {
  return Math.max(2, Math.min(CHAIN_MAX_LINKS, Math.round(length / CHAIN_LINK_SPACING)));
}

// ---------------------------------------------------------------- Halberd Wall

/** The reach two watchmen hold the wall within (the sim's radius). */
export function wallRadius(): number {
  return MOBS[WATCHMAN]?.trashKit?.wall?.radius ?? 5;
}

export interface WallBody {
  id: number;
  x: number;
  z: number;
}

/**
 * The partner pairs a linked ward draws its band between: every two warded
 * watchmen within the wall's reach (a little slack for the interpolated
 * positions), each pair once, lower index first. Writes up to `max` pairs of
 * indices into `out` (flat: a, b, a, b...) and returns how many it wrote.
 */
export function wallPairs(
  bodies: readonly WallBody[],
  count: number,
  radius: number,
  out: number[],
  max: number,
): number {
  const reach = radius * 1.1;
  const r2 = reach * reach;
  let n = 0;
  for (let i = 0; i < count && n < max; i++) {
    for (let j = i + 1; j < count && n < max; j++) {
      const dx = bodies[i].x - bodies[j].x;
      const dz = bodies[i].z - bodies[j].z;
      if (dx * dx + dz * dz > r2) continue;
      out[n * 2] = i;
      out[n * 2 + 1] = j;
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- Fall Back

/** Seconds the arbalest's leap back flies (the sim's own). */
export function fallBackSeconds(): number {
  return MOBS[ARBALEST_TEMPLATE]?.trashKit?.fallBack?.seconds ?? 0.5;
}

/** Seconds between two spray bursts along the leap's trail. */
export const FALL_TRAIL_INTERVAL = 0.035;

// ---------------------------------------------------------------- Soul Hunger

/** Wreckbound Sailor's measured Idle height in model units. The stable mob
 *  id remains barnacle_crawler, but its authored model is a naval spirit. */
export const CRAWLER_RAW_HEIGHT = 4.131697;
/** Soul lights at the sailor's chest and ribs (glTF model coordinates). */
export const CRAWLER_SOUL_ANCHORS: readonly ModelPoint[] = [
  { side: 0, up: 3.1, fwd: 0.42 },
  { side: 0.24, up: 2.85, fwd: 0.38 },
  { side: -0.24, up: 2.85, fwd: 0.38 },
];
/** How much bigger the body draws per stack fed (three stacks, about a fifth). */
export const GLUT_SWELL_PER_STACK = 0.07;
export const GLUT_MAX_STACKS = 3;
/** The gulp's overshoot on each new stack, and how fast it settles. */
export const GLUT_GULP = 0.09;
export const GLUT_GULP_SEC = 0.42;

/** The stacks a body's Carrion Glut aura carries (the wire leaves a single
 *  stack's count out), or 0. */
export function glutStacks(
  auras: readonly { id: string; stacks?: number }[] | undefined,
  id: string,
): number {
  if (!auras) return 0;
  for (const a of auras) if (a.id === id) return Math.min(GLUT_MAX_STACKS, a.stacks ?? 1);
  return 0;
}

/** The drawn scale multiplier of a crawler fed `stacks` times, `sinceGulp`
 *  seconds after its last gulp (a swell that overshoots and settles). */
export function glutSwell(stacks: number, sinceGulp: number): number {
  const base = 1 + GLUT_SWELL_PER_STACK * Math.max(0, Math.min(GLUT_MAX_STACKS, stacks));
  if (sinceGulp < 0 || sinceGulp >= GLUT_GULP_SEC) return base;
  const u = sinceGulp / GLUT_GULP_SEC;
  return base + GLUT_GULP * Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u);
}

/** How bright the soul lights burn at `stacks` (0 dim, 1 at full hunger). */
export function glutGlow(stacks: number): number {
  return Math.max(0, Math.min(1, stacks / GLUT_MAX_STACKS));
}

/** The drawn swell a fed crawler keeps: the painter (bastion_trash_fx.ts)
 *  holds one per crawler on its own instance (a fed corpse keeps its swell
 *  after the sim strips its auras at death, so the body never shrinks back
 *  before it bursts) and the renderer reads it through rift_death_zone.ts's
 *  bodySwell; at or under this it is dropped (drawn at 1). */
export const SWELL_EPSILON = 1.0005;

// ---------------------------------------------------------------- Pack Frenzy

/** The warhound's eyes and throat (bastion_drowned_fx_core.ts measures them):
 *  the sea light burns there while the frenzy lasts. */
export const WARHOUND_EYES: readonly ModelPoint[] = [
  { side: 0.3, up: 3.75, fwd: 3.2 },
  { side: -0.3, up: 3.75, fwd: 3.2 },
];
export const WARHOUND_THROAT: ModelPoint = { side: 0, up: 3.0, fwd: 3.35 };
/** Seconds between two flickers of the frenzied eyes' light. */
export const FRENZY_EMBER_INTERVAL = 0.05;
/** The howl's shock ring: how wide it runs out and how long it takes. */
export const HOWL_RING_RADIUS = 9;
export const HOWL_RING_SEC = 0.75;

/** How hard the frenzy burns with `remaining` of its `duration` left: full
 *  until its last second and a half, then guttering out. */
export function frenzyGlow(remaining: number, duration: number): number {
  if (remaining <= 0 || duration <= 0) return 0;
  return Math.min(1, remaining / 1.5);
}

// ---------------------------------------------------------------- Fog Bank

/** The fog patch's radius (the sim's, also the object's scale). */
export function fogBankRadius(): number {
  return MOBS[CHANTER]?.trashKit?.fogBank?.radius ?? 4;
}

/** Seconds a fog patch takes to roll in, and to lift once its object goes. */
export const FOG_ROLL_IN = 0.6;
export const FOG_LIFT = 0.9;

/** The fog patch's strength `age` seconds after it settled, or `lifting`
 *  seconds into its lift (negative while it still stands). */
export function fogAlpha(age: number, lifting: number): number {
  const rise = Math.min(1, Math.max(0, age / FOG_ROLL_IN));
  if (lifting < 0) return rise;
  return rise * Math.max(0, 1 - lifting / FOG_LIFT);
}

/** Rings and segments of the draped fog disc (it reaches past its radius by
 *  FOG_FEATHER, where the edge fades out). */
export const FOG_DISC_RINGS = 10;
export const FOG_DISC_SEGMENTS = 64;
export const FOG_FEATHER = 1.12;

// ---------------------------------------------------------------- Brine Column

/** The column round a rooted player: a little over their height. */
export const COLUMN_HEIGHT = 3.6;
export const COLUMN_RADIUS = 1.15;
/** Seconds it takes the column to rise, to collapse on its last tick, and to
 *  burst apart when the channel broke early. */
export const COLUMN_RISE = 0.35;
export const COLUMN_COLLAPSE = 0.45;
export const COLUMN_BURST = 0.38;
/** The Tidebound Acolyte GLB's bounding height (model units). */
export const ACOLYTE_RAW_HEIGHT = 5.079;
/** The conch held high and tipped in the Mend loop (acolyte/clips.py
 *  mend_pose hand_l (0.5, -0.35, 4.55)), where the stream pours from. */
export const ACOLYTE_CONCH: ModelPoint = { side: 0.55, up: 4.7, fwd: 0.55 };

export type ColumnStage = 'rise' | 'hold' | 'collapse' | 'burst' | 'done';

/** The column's stage and the share of it run: rising, holding, collapsing
 *  `ended` seconds after the channel ran out, or bursting `ended` seconds
 *  after it broke (`ended` negative while it still stands). */
export function columnPhase(
  age: number,
  ended: number,
  broke: boolean,
): { stage: ColumnStage; k: number } {
  if (ended >= 0) {
    const sec = broke ? COLUMN_BURST : COLUMN_COLLAPSE;
    if (ended >= sec) return { stage: 'done', k: 1 };
    return { stage: broke ? 'burst' : 'collapse', k: ended / sec };
  }
  if (age < COLUMN_RISE) return { stage: 'rise', k: Math.max(0, age) / COLUMN_RISE };
  return { stage: 'hold', k: 1 };
}

/** The column's drawn height share and width share at a phase. */
export function columnShape(stage: ColumnStage, k: number): { height: number; width: number } {
  switch (stage) {
    case 'rise': {
      const e = 1 - (1 - k) ** 3;
      return { height: e, width: 0.7 + 0.3 * e };
    }
    case 'hold':
      return { height: 1, width: 1 };
    case 'collapse':
      return { height: Math.max(0, 1 - k * k * 1.1), width: 1 + 0.45 * k };
    case 'burst':
      return { height: 1 - 0.3 * k, width: 1 + 1.6 * k };
    default:
      return { height: 0, width: 0 };
  }
}

/** A point `t` of the way along the stream from the conch (x0..z0) to the
 *  column's crown (x1..z1): a pour arcing over between them. Writes `out`. */
export function streamPoint(
  t: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const lift = Math.min(4, 0.6 + d * 0.18);
  out.x = x0 + (x1 - x0) * t;
  out.z = z0 + (z1 - z0) * t;
  out.y = y0 + (y1 - y0) * t + 4 * lift * t * (1 - t);
  return out;
}

// ---------------------------------------------------------------- Snapped Fetters

/** The prisoner GLB's bounding height (model units; DROWNED_FX shares it). */
export const PRISONER_RAW_HEIGHT = 4.105;
/** The irons that snap: both manacles, the collar and the ankle shackle
 *  (prisoner/clips.py stance; the manacles are the drip anchors). */
export const PRISONER_IRONS: readonly ModelPoint[] = [
  { side: 0.42, up: 2.08, fwd: 0.74 },
  { side: -0.44, up: 2.02, fwd: 0.76 },
  { side: 0.04, up: 2.96, fwd: 0.52 },
  { side: 0.34, up: 0.25, fwd: 0.04 },
];
/** His eyes standing (where the drowned light leaves him) and kneeling (where
 *  his head bows to; the Kneel clip drops the pelvis 1.15). */
export const PRISONER_EYES: ModelPoint = { side: 0.2, up: 3.74, fwd: 0.79 };
export const PRISONER_HEART_KNEELING: ModelPoint = { side: 0, up: 1.9, fwd: 0.35 };
/** Seconds the release takes: the light gathering, then the wisps rising. */
export const RELEASE_SEC = 2.2;

/** The release's glow `t` seconds in: a soft swell, a hold, a long fade. */
export function releaseEnvelope(t: number): number {
  if (t < 0 || t > RELEASE_SEC) return 0;
  const rise = Math.min(1, t / 0.3);
  const fall = 1 - Math.max(0, (t - 0.6) / (RELEASE_SEC - 0.6));
  return rise * fall;
}
