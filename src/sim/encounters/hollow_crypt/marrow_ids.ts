// Sexton Marrow's ids, tuning and pure geometry (the Bell Yard, the first
// Hollow Crypt boss: docs/design/dungeon-rework/hollow_crypt.md 5.1), as a
// dependency-light leaf: the encounter module, the dev helpers, the renderer's
// grave and bell visuals, the HUD alert and the tests all key on these. No
// SimContext, no rng.
//
//   Shovelful               a short bar, then a cone of grave dirt off the
//                           spade at the one he fights: a heavy hit and a slow
//                           on everyone in front of him. Stand behind him.
//   Measured for the Grave  a non-tank player is marked; 4 s later an Open
//                           Grave caves in where they stand. The pit stays:
//                           Grave Dirt burns and slows whoever stands in it.
//                           Lay the graves at the yard's edge.
//   Burial Toll             at 66 and 33 percent he strides to the bell rope
//                           (immune) and rings the Burial Bell: a shockwave on
//                           everyone, and every Open Grave gives up a Restless
//                           Bones.
//   Heroic                  Gravedigger's Blow (a stacking strike on the tank),
//                           Grave Vigor (he swings faster standing in a grave),
//                           Unquiet Earth (lingering in a grave raises a
//                           Restless Bones on the spot).

import {
  HOLLOW_CRYPT_ANCHORS,
  HOLLOW_CRYPT_BELL_TOWER_ROT,
} from '../../content/hollow_crypt_layout';

export const MARROW_ID = 'sexton_marrow';
/** The dead his bell raises (a level-8 Restless Bones, no loot). */
export const MARROW_BONES_ID = 'marrow_restless_bones';

// ---- cast ids (his bars) ------------------------------------------------------------
export const MARROW_SHOVELFUL = 'crypt_marrow_shovelful';
export const MARROW_MEASURE = 'crypt_marrow_measure';
/** He rings the bell: the channel that ends in the Toll. */
export const MARROW_BURIAL_TOLL = 'crypt_marrow_burial_toll';
/** Heroic: the stacking strike (a short bar on the tank). */
export const MARROW_GRAVEDIGGERS_BLOW = 'crypt_marrow_gravediggers_blow';

// ---- spellfx ability ids (presentation cues, never casts) -----------------------------
/** A grave caves in (from the marked player's spot). */
export const MARROW_GRAVE_OPENS = 'crypt_marrow_grave_opens';
/** One peal of the bell during the Toll (cosmetic rings). */
export const MARROW_BELL_PEAL = 'crypt_marrow_bell_peal';
/** A Restless Bones claws out of a grave. */
export const MARROW_BONES_RISE = 'crypt_marrow_bones_rise';

// ---- auras --------------------------------------------------------------------------
/** On the marked player: the grave opens under them when it runs out. value2
 *  carries the grave's radius so every client paints the ring the sim opens. */
export const MARROW_MEASURED = 'crypt_marrow_measured';
/** Standing in an Open Grave: slowed (and burned once a second). */
export const MARROW_GRAVE_DIRT = 'crypt_marrow_grave_dirt';
/** Shovelful's dirt in the eyes: slowed. */
export const MARROW_DIRT_IN_EYES = 'crypt_marrow_dirt_in_eyes';
/** On Marrow while he strides to the rope and rings: immune. */
export const MARROW_TOLLING = 'crypt_marrow_tolling';
/** Heroic: Gravedigger's Blow stacks (more physical damage taken). */
export const MARROW_BLOW_STACKS = 'crypt_marrow_blow_stacks';
/** Heroic: Grave Vigor, standing in a grave he swings faster. */
export const MARROW_GRAVE_VIGOR = 'crypt_marrow_grave_vigor';

// ---- encounter object templates --------------------------------------------------------
/** An Open Grave (scale = radius); persistent for the fight. */
export const MARROW_GRAVE_TEMPLATE = 'crypt_open_grave';

export const MARROW_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([MARROW_GRAVE_TEMPLATE]);

// ---- the arena ---------------------------------------------------------------------
/** The Bell Yard (instance-local): its centre and floor radius. */
export const BELL_YARD = {
  x: HOLLOW_CRYPT_ANCHORS.bellYard.x,
  z: HOLLOW_CRYPT_ANCHORS.bellYard.z,
  r: 22,
} as const;
/** How far along the tower's broken beam (its local +X) the Burial Bell hangs
 *  (the kit's `bell_tower`, docs/design/dungeon-rework/kit). */
export const BELL_BEAM_REACH = 17.5;

/** Where the bell rope reaches the yard floor, under the Burial Bell
 *  (instance-local): the tower's beam carried into the yard. Pure. */
export function bellRopeSpot(): { x: number; z: number } {
  const t = HOLLOW_CRYPT_ANCHORS.bellTower;
  // The beam is the piece's local +X turned by the prop's yaw (the renderer's
  // rotation.y): (cos yaw, -sin yaw) on the floor.
  return {
    x: t.x + Math.cos(HOLLOW_CRYPT_BELL_TOWER_ROT) * BELL_BEAM_REACH,
    z: t.z - Math.sin(HOLLOW_CRYPT_BELL_TOWER_ROT) * BELL_BEAM_REACH,
  };
}

// ---- tuning (normal-mode bases; the heroic transform scales the damage) ------------------
// Numbers basis (docs/design/dungeon-rework/README.md 7): cloth about 300 health at
// level 8 in the dungeon's own gear. Shovelful rides his own melee roll through the
// tank's armor; the Grave's cave-in is a must-avoid hit for anyone but its mark (about
// 15 percent); Grave Dirt about 3 percent a second; the Toll a raid-wide pulse (about
// 11 percent). The heroic transform (mechanicDamageMult) lifts them all.
export const MARROW_TUNING = {
  shovelFirst: 6,
  shovelEvery: 11,
  shovelCast: 1.2,
  shovelRange: 8,
  shovelArcDeg: 80,
  /** A multiple of his own melee roll, through armor. */
  shovelMult: 1.5,
  /** Dirt in the Eyes: a movement multiplier and its seconds. */
  shovelSlow: 0.5,
  shovelSlowSeconds: 6,
  measureFirst: 9,
  measureEvery: 15,
  measureCast: 1,
  /** Seconds the mark runs before the grave caves in under them. */
  markSeconds: 4,
  graveRadius: 3,
  graveOpenMin: 42,
  graveOpenMax: 52,
  graveDirtPerSecond: 9,
  /** Grave Dirt's movement multiplier (40 percent slow). */
  graveSlow: 0.6,
  /** Open Graves at most; a new one past the cap fills in the oldest. */
  graveCap: 8,
  /** Health fractions that start a Burial Toll. */
  tollAt: [0.66, 0.33] as readonly number[],
  /** His stride to the rope (yd a second), and the longest it may take. */
  tollStrideSpeed: 10,
  tollStrideMax: 4,
  /** The ringing: seconds, peals in it, and the Toll that ends it. */
  tollRing: 3,
  tollPeals: 3,
  tollMin: 30,
  tollMax: 38,
  // Heroic.
  blowFirst: 5,
  blowEvery: 9,
  blowCast: 0.8,
  /** Gravedigger's Blow: a multiple of his melee roll, and the stack it leaves. */
  blowMult: 1.0,
  blowVulnPerStack: 0.06,
  blowMaxStacks: 6,
  blowSeconds: 20,
  /** Grave Vigor: his swing haste while he stands in a grave. */
  graveVigorHaste: 1.3,
  /** Unquiet Earth: seconds a player lingers in a grave before the dead stir,
   *  and the grave's rest after it raises one. */
  unquietLinger: 2,
  unquietRest: 8,
} as const;

/** Is (px, pz) inside an Open Grave centred at (gx, gz)? Pure. */
export function inGrave(gx: number, gz: number, radius: number, px: number, pz: number): boolean {
  return Math.hypot(px - gx, pz - gz) <= radius;
}
