// The Wildheart Basin trash's Blender bodies, measured (scripts/assets/
// wildheart_basin_raptor and its siblings, the delivery notes, and the shipped
// GLBs): the facts their looks (characters/wildheart_creature_looks.ts) and the
// hunt's effects (basin_trash_fx_core.ts: the heights its glows and anchors
// ride) key on. Each body is drawn at its authored size: one model yard per
// game yard at the template's sim scale.
//
// Model space: yards at the authored size, glTF axes: +Y up, the body faces
// +Z, its LEFT is +X; the origin on the ground under the body. Clip times are
// seconds in the shipped clips (their first key one 24 fps frame in: every
// authored beat sits KEY_LEAD later).
//
// Three-free, DOM-free, deterministic.

import { KEY_LEAD } from './gorgebloom_model_core';

/** The Basin Raptor's sim scale (sim/content/wildheart.ts basin_raptor). */
export const RAPTOR_SIM_SCALE = 1.7;

export const RAPTOR_MODEL = {
  url: 'models/creatures/wildheart_basin_raptor.glb',
  /** The Idle pose's skinned bounds (0.5 s in): the soles to the crest's tips
   *  (the head itself tops out lower, see `head`). */
  idleMin: -0.002,
  idleTop: 5.167,
  /** The skull's top at Idle (yards): nearly twice a 2.6 yd player. */
  head: 4.5,
  /** The gaits' reference speeds (planted feet slide at these). */
  walkRef: 2.6,
  runRef: 8,
} as const;

export const RAPTOR_CLIP = {
  /** Bite: the jaws snap shut at 0.42, a tearing shake to 0.75. */
  bite: 0.42 + KEY_LEAD,
  /** Slash: the sickle cuts down through the target at 0.46. */
  slash: 0.46 + KEY_LEAD,
  /** Pounce (the trash kit's leap, flown by the sim over 0.6 s from the
   *  windup's tick): airborne from its first frame, the feet strike at 0.60. */
  pounceLand: 0.6 + KEY_LEAD,
  /** Screech (the Pack Frenzy gesture and its flourish): peaks at 0.55. */
  screechPeak: 0.55 + KEY_LEAD,
  /** Death: the body hits the ground at 1.10, the head at 1.30. */
  deathBody: 1.1 + KEY_LEAD,
} as const;

/** The Spore Toad's sim scale (sim/content/wildheart.ts spore_toad). */
export const TOAD_SIM_SCALE = 2.4;

export const TOAD_MODEL = {
  url: 'models/creatures/wildheart_spore_toad.glb',
  /** The Idle pose's skinned bounds (0.5 s in): the claw tips' dip below the
   *  soles to the tops of its eyes. */
  idleMin: -0.107,
  idleTop: 3.783,
  /** Its eyes' tops at Idle (yards): its highest point, over a player's head. */
  eyes: 3.78,
  /** Where the tongue leaves its open mouth on the Snaring Tongue's release
   *  (Tongue at the bar's end, sampled off the shipped clip): yards up and
   *  forward of its origin. */
  mouth: { up: 1.38, forward: 3.45 },
  /** The gaits' reference speeds (planted feet slide at these). */
  walkRef: 2.4,
  runRef: 6,
} as const;

export const TOAD_CLIP = {
  /** Bite: the jaws shut at 0.45. Slam: the chest hits at 0.58. */
  bite: 0.45 + KEY_LEAD,
  slam: 0.58 + KEY_LEAD,
  /** Tongue (the Snaring Tongue's 1.5 s bar, played from its start): the
   *  throat swells to 1.22, the head snaps down the lane and the jaws fly
   *  open at 1.50, held wide through the reel to 2.35, shut by 2.65. */
  tongueFire: 1.5 + KEY_LEAD,
  tongueShut: 2.65 + KEY_LEAD,
  /** Death (the Spore Burst): it bloats, the puffballs burst at 0.85, it lies
   *  flat at 1.45 (at 1x; the look plays it faster). */
  burst: 0.85 + KEY_LEAD,
  flat: 1.45 + KEY_LEAD,
} as const;

/** The Sunbone totems' sim scale (both templates, sim/content/wildheart.ts). */
export const TOTEM_SIM_SCALE = 1.6;

/** The Sunbone Totem (its bone sun and jaguar skull) and the Dread Totem (its
 *  tusked red skull): one carved post, rigged so it rises out of the ground,
 *  flares and rattles. */
export const SUN_TOTEM_MODEL = {
  url: 'models/creatures/wildheart_sunbone_totem.glb',
  /** The Idle pose's skinned bounds: the plinth to the sun's top rays. */
  idleMin: -0.013,
  idleTop: 6.608,
} as const;

export const DREAD_TOTEM_MODEL = {
  url: 'models/creatures/wildheart_sunbone_dread_totem.glb',
  /** The Idle pose's skinned bounds: the plinth to the plume tips. */
  idleMin: -0.013,
  idleTop: 6.364,
} as const;

export const TOTEM_CLIP = {
  /** Rise (its entrance, the Binder's Plant Totem just landed): out of the
   *  ground at 0.62, still by 1.40. */
  riseUp: 0.62 + KEY_LEAD,
  riseLength: 34 / 24 + KEY_LEAD,
  /** Pulse (the mending, every 2 s): the flare peaks at 0.30. */
  pulsePeak: 0.3 + KEY_LEAD,
  /** Rattle (the Rattling Dread's 2 s bar): the scream on the bar's end, 2.00. */
  rattleScream: 2.0 + KEY_LEAD,
  /** Death: down at 1.00, under the ground by 2.20. */
  deathDown: 1.0 + KEY_LEAD,
} as const;

/** The Sunbone Totem-Binder's sim scale (sim/content/wildheart.ts). */
export const BINDER_SIM_SCALE = 1.95;

/** The Totem-Binder (scripts/assets/wildheart_totem_binder): a hunched jungle
 *  troll under a jaguar-skull mask, his carved staff in his right fist. */
export const BINDER_MODEL = {
  url: 'models/creatures/wildheart_totem_binder.glb',
  /** The Idle pose's skinned bounds: the soles to the plumes' tips. */
  idleMin: 0,
  idleTop: 6.048,
  /** The gaits' reference speeds (planted feet slide at these). */
  walkRef: 1.548,
  runRef: 6.316,
} as const;

export const BINDER_CLIP = {
  /** PlantTotem (the 1.5 s Plant Totem bar, played from its start at 1x): the
   *  staff raised overhead to 1.30, driven butt first into the earth at 1.50
   *  (where the totem rises, 2 yd before him), recovered by 2.55. Exported
   *  with its first key at 0. */
  plantStrike: 1.5,
  plantLength: 61 / 24,
  /** Attack: the overhead smash lands at 0.56; Attack2: the butt jab at 0.48. */
  smash: 0.56,
  jab: 0.48,
} as const;

/** The Fanglord Beastmaster's sim scale (sim/content/wildheart.ts). */
export const BEASTMASTER_SIM_SCALE = 2.35;

/** The Fanglord Beastmaster (scripts/assets/wildheart_beastmaster, the
 *  Binder's troll body built bigger, scaled 1.12 at the end): a scarred troll
 *  under a jaguar-head hood, the pelt for a cloak, the Beastspear in his fist. */
export const BEASTMASTER_MODEL = {
  url: 'models/creatures/wildheart_beastmaster_blender.glb',
  /** The Idle pose's skinned bounds: the soles to the hood's ears. */
  idleMin: 0,
  idleTop: 6.295,
  walkRef: 1.792,
  runRef: 7.074,
} as const;

export const BEASTMASTER_CLIP = {
  /** Quake (the Beast Pit Quake's 1.5 s bar, played from its start at 1x):
   *  the spear and his foot strike the pit floor at 1.50. */
  quakeStrike: 1.5,
  /** WarCry (Call of the Hunt, a gesture off its spellfx): the roar peaks at
   *  0.50. Ward (Thickhide Ward): the spear points at his jaguar at 0.55. */
  warCryPeak: 0.5,
  wardPoint: 0.55,
} as const;

/** The Quake rate over the Beast Pit Quake bar (its strike on the bar's end). */
export function beastmasterQuakeRate(bar: number): number {
  return bar > 0 ? BEASTMASTER_CLIP.quakeStrike / bar : 1;
}

/** The PlantTotem rate over the Plant Totem bar (its strike on the bar's end). */
export function binderPlantRate(bar: number): number {
  return bar > 0 ? BINDER_CLIP.plantStrike / bar : 1;
}

/** The Rattle's rate over the Rattling Dread's bar (its scream on the bar's
 *  end; the bar is the dread kit's own, sim/content/wildheart.ts). */
export function dreadRattleRate(bar: number): number {
  return bar > 0 ? TOTEM_CLIP.rattleScream / bar : 1;
}

/** The Pounce's rate: its feet strike on the last tick of the sim's flight
 *  (`seconds`, the leap kit's own). */
export function raptorPounceRate(seconds: number): number {
  return seconds > 0 ? RAPTOR_CLIP.pounceLand / seconds : 1;
}

/** The def height (pivot to the Idle bounds' top at sim scale 1) that draws a
 *  model at its authored size at sim `scale`. */
export function trashLookHeight(m: { idleMin: number; idleTop: number }, scale: number): number {
  return (m.idleTop - m.idleMin) / scale;
}

/** The def hover that keeps the authored ground on the pivot. */
export function trashLookHover(m: { idleMin: number }, scale: number): number {
  return m.idleMin / scale;
}
