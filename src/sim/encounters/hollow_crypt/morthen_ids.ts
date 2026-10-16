// Morthen the Gravecaller's fight: ids, tuning and pure geometry (the Rite
// Ring, the Hollow Crypt's last boss before the Knellwyrm:
// docs/design/dungeon-rework/hollow_crypt.md 5.4). A dependency-light leaf:
// the encounter modules (morthen.ts, morthen_gravecall.ts, morthen_candles.ts,
// morthen_grasp.ts), the dev helpers, the renderer, the HUD alert and the
// tests key on these. No SimContext, no rng.
//
// A three-act rite the group must break.
//
//   Act 1, The Calling     Shadow Pulse: a bar, then shadow round him (step
//                          out). Gravecall: a Bound Soul leaves the next
//                          sarcophagus alcove (clockwise) and drifts to him; on
//                          arrival he is Gorged on the Dead (more damage, a
//                          heal, stacking for the fight). A player in its path
//                          takes it instead (the trash engine's G5 walker).
//   Act 2, the Rite        at 65 percent he goes back to the altar inside the
//                          Unquiet Ward (immune) and channels the Rite of the
//                          Unquiet; the four Remembrance Candles gutter out.
//                          Grave Chill rises on everyone, two Restless Bones
//                          climb out of the alcoves. Relighting a candle is a
//                          CHANNEL (the G3 use, kept through hits) that drains
//                          the lighter's health every second: the healer heals
//                          them through it. The fourth candle shatters the
//                          ward: the Rite Broken (an 8 s stun) and 25 percent
//                          more damage taken while it lasts.
//   Act 3, Last Rites      at 35 percent Gravecall stops: Reap the Unquiet, a
//                          huge frontal scythe sweep (bar, aim locked), and a
//                          faster Shadow Pulse.
//   Heroic                 Name the Dead (the Ledger names the order; a wrong
//                          candle snuffs the last lit one and burns the
//                          lighter) and Grasp of the Grave (two players at a
//                          time get a ring; hands erupt: root and shadow), in
//                          every act.

import { HOLLOW_CRYPT_RING } from '../../content/hollow_crypt_layout';
import { KIT_USE_CAST_PREFIX } from '../../types';

export const MORTHEN_CANDLE_ID = 'crypt_remembrance_candle';

// ---- cast ids (his bars) ------------------------------------------------------------
export const MORTHEN_SHADOW_PULSE = 'crypt_morthen_shadow_pulse';
/** The Rite of the Unquiet: his channel on the altar inside the ward. */
export const MORTHEN_RITE = 'crypt_morthen_rite_of_the_unquiet';
export const MORTHEN_REAP = 'crypt_morthen_reap_the_unquiet';
/** The players' own bar on a Remembrance Candle (the G3 use's cast id). */
export const MORTHEN_RELIGHT_CAST = `${KIT_USE_CAST_PREFIX}crypt_relight_candle`;

// ---- spellfx ability ids (presentation cues, never casts) -----------------------------
/** A Bound Soul leaves its alcove (from Morthen to the orb). */
export const MORTHEN_GRAVECALL = 'crypt_morthen_gravecall';
/** A candle catches (from the lighter to the candle's object). */
export const MORTHEN_CANDLE_LIT = 'crypt_morthen_candle_lit';
/** A candle is snuffed (heroic Name the Dead, from Morthen to its object). */
export const MORTHEN_CANDLE_SNUFFED = 'crypt_morthen_candle_snuffed';
/** The fourth candle shatters the ward (on Morthen). */
export const MORTHEN_WARD_SHATTERS = 'crypt_morthen_ward_shatters';
/** Grasp of the Grave: the hands erupt (from Morthen to the ring's object). */
export const MORTHEN_GRASP_ERUPTS = 'crypt_morthen_grasp_erupts';

// ---- auras --------------------------------------------------------------------------
/** On Morthen: a Bound Soul reached him (stacks; a damage-done aura). */
export const MORTHEN_GORGED = 'crypt_morthen_gorged';
/** On Morthen through the Rite: immune; value = candles lit so far. */
export const MORTHEN_UNQUIET_WARD = 'crypt_morthen_unquiet_ward';
/** On Morthen: the ward shattered (a stun the encounter lays itself). */
export const MORTHEN_RITE_BROKEN = 'crypt_morthen_rite_broken';
/** On Morthen: the ward shattered, he takes more damage while it lasts. */
export const MORTHEN_SHATTERED = 'crypt_morthen_shattered_ward';
/** On every player through the Rite: Grave Chill (value = its bite a second). */
export const MORTHEN_GRAVE_CHILL = 'crypt_morthen_grave_chill';
/** Heroic: the ring under a marked player; value2 carries the ring's radius. */
export const MORTHEN_GRASP_MARK = 'crypt_morthen_grasp_mark';
/** Heroic: held by the grave's hands (a root). */
export const MORTHEN_GRASP_ROOT = 'crypt_morthen_grasp_root';

// ---- encounter object templates (the state rides the template id) ------------------------
/** A guttered Remembrance Candle (the Rite has it dark; relight it). */
export const RITE_CANDLE_DARK = 'crypt_rite_candle_dark';
/** Heroic Name the Dead: the dark candle the Ledger names next. */
export const RITE_CANDLE_NAMED = 'crypt_rite_candle_named';
/** A relit candle. */
export const RITE_CANDLE_LIT = 'crypt_rite_candle_lit';
/** A Bound Soul in flight (the G5 walker's orb). */
export const MORTHEN_SOUL_TEMPLATE = 'crypt_morthen_bound_soul';
/** Heroic Grasp of the Grave: the ring while it gathers (scale = radius)... */
export const MORTHEN_GRASP_TEMPLATE = 'crypt_morthen_grasp';
/** ...and the hands holding the rooted once it erupts. */
export const MORTHEN_GRASP_HANDS_TEMPLATE = 'crypt_morthen_grasp_hands';

export const MORTHEN_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([
  RITE_CANDLE_DARK,
  RITE_CANDLE_NAMED,
  RITE_CANDLE_LIT,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_GRASP_HANDS_TEMPLATE,
]);

/** Every candle object template (the renderer's candle painter keys on them). */
export function isRiteCandleTemplate(templateId: string): boolean {
  return (
    templateId === RITE_CANDLE_DARK ||
    templateId === RITE_CANDLE_NAMED ||
    templateId === RITE_CANDLE_LIT
  );
}

// ---- the arena -----------------------------------------------------------------------
/** The four Remembrance Candles (instance-local; the kit's `hc_remembrance_candle`
 *  props in content/hollow_crypt_layout.ts, pinned by tests/hollow_crypt_morthen.test.ts):
 *  north, east, south, west, in that (clockwise) order. */
export const RITE_CANDLE_SPOTS: readonly { x: number; z: number }[] = [
  { x: 0, z: 225 },
  { x: 20, z: 205 },
  { x: 0, z: 185 },
  { x: -20, z: 205 },
];
/** The candle pillar's radius (its collider): the usable body stands at its
 *  foot, this far plus a step toward the ring's centre. */
export const RITE_CANDLE_RADIUS = 1.3;
/** The four sarcophagus alcoves (the kit's `hc_sarcophagus_alcove`), clockwise
 *  from the north-east: where the Bound Souls rise, a step in front of the
 *  alcove's mouth. */
export const RITE_ALCOVE_SPOTS: readonly { x: number; z: number }[] = [0, 1, 2, 3].map((i) => {
  const a = Math.PI / 4 + (i * Math.PI) / 2;
  return { x: Math.sin(a) * 22, z: HOLLOW_CRYPT_RING.z + Math.cos(a) * 22 };
});

/** Where a candle's usable body stands: at the pillar's foot on the ring side. Pure. */
export function candleBodySpot(i: number): { x: number; z: number } {
  const c = RITE_CANDLE_SPOTS[i];
  const dx = HOLLOW_CRYPT_RING.x - c.x;
  const dz = HOLLOW_CRYPT_RING.z - c.z;
  const d = Math.hypot(dx, dz) || 1;
  const out = RITE_CANDLE_RADIUS + 0.6;
  return { x: c.x + (dx / d) * out, z: c.z + (dz / d) * out };
}

// ---- tuning (normal-mode bases; the heroic transform scales the damage) ------------------
// Numbers basis (hollow_crypt.md 5.4 as built): cloth about 340 health at level 10 in the
// dungeon's greens (a mage has 315 in starter gear), a warrior tank about 450. Shadow Pulse
// is an avoidable pulse (about 8 percent), a soul taken about 4, Grave Chill about 1 to 2
// percent a second rising, the candle's drain a share of the lighter's own health, the Reap
// a must-not-stand-in-front hit (about 18 on cloth). The heroic transform's mechanic
// multiplier for `morthen` (dungeon_difficulty.ts) lifts them all onto heroic cloth.
export const MORTHEN_TUNING = {
  // Shadow Pulse (acts 1 and 3): a bar, then shadow on everyone within reach.
  pulseFirst: 8,
  pulseEvery: 12,
  /** Faster in his Last Rites. */
  pulseEveryLastRites: 9,
  pulseCast: 2,
  pulseRadius: 12,
  pulseMin: 24,
  pulseMax: 30,
  // Gravecall (act 1, and after the Rite until his Last Rites).
  soulFirst: 6,
  soulEvery: 15,
  /** Yards a second a Bound Soul drifts; it fades after this many seconds. */
  soulSpeed: 3.2,
  soulSeconds: 16,
  /** A body this close takes it; it gorges him this close. */
  soulIntercept: 1.6,
  soulReach: 2.6,
  /** Shadow on the player who takes a soul. */
  soulInterceptMin: 12,
  soulInterceptMax: 16,
  /** Gorged on the Dead: damage done per stack, the heal per soul (share of
   *  his health), the stack cap, and the seconds it lasts (the fight). */
  gorgedPct: 0.1,
  gorgedHeal: 0.03,
  gorgedMaxStacks: 10,
  gorgedSeconds: 600,
  // Act 2: the Rite of the Unquiet.
  /** His health share at which the Rite begins (he never drops below it first). */
  riteAt: 0.65,
  /** His glide back to the altar (yd a second, at most this long). */
  riteStrideSpeed: 10,
  riteStrideMax: 3,
  /** The Rite's bar (it starts again while the ward stands). */
  riteBar: 60,
  /** Grave Chill: shadow a second on everyone, rising by `chillStep` every
   *  `chillEvery` seconds of the Rite. */
  chillBase: 3,
  chillStep: 1,
  chillEvery: 5,
  /** Restless Bones that climb out of the alcoves when the Rite begins. */
  riteBones: 2,
  /** The relight: the channel, the reach, and the drain each second (a share
   *  of the lighter's own maximum health). */
  relightChannel: 4,
  relightRange: 4,
  relightDrainPct: 0.06,
  relightDrainPctHeroic: 0.08,
  /** The Rite Broken: the stun, and the damage taken while it lasts. */
  brokenSeconds: 8,
  brokenVuln: 0.25,
  // Act 3: Last Rites.
  lastRitesAt: 0.35,
  reapFirst: 4,
  reapEvery: 14,
  reapCast: 2,
  /** The sweep: its reach past his centre and its arc. */
  reapRange: 14,
  reapArcDeg: 120,
  reapMin: 55,
  reapMax: 65,
  /** Only players within this many yards under his floor are struck by his
   *  floor mechanics (the crag top: the Choir Loft lies far under the south
   *  rim, inside his reach on the map). */
  floorBand: 3,
  // Heroic.
  /** Name the Dead: shadow on whoever lights the wrong candle. */
  wrongCandleMin: 28,
  wrongCandleMax: 32,
  /** Grasp of the Grave: every `graspEvery` s two players get a ring that
   *  erupts after `graspFuse`; inside: a root and shadow. */
  graspFirst: 10,
  graspEvery: 16,
  graspTargets: 2,
  graspFuse: 1.5,
  graspRadius: 4,
  graspRootSeconds: 3,
  graspMin: 18,
  graspMax: 22,
  /** The deed (Every Candle Lit): all four candles relit within this many
   *  seconds of the ward rising. */
  candlelightSeconds: 20,
} as const;

/** Grave Chill's bite a second, `t` seconds into the Rite. Pure. */
export function graveChillAt(t: number): number {
  const T = MORTHEN_TUNING;
  return T.chillBase + T.chillStep * Math.floor(Math.max(0, t) / T.chillEvery);
}

/** Is (px, pz) inside a Grasp of the Grave ring centred at (gx, gz)? Pure. */
export function inGraspRing(gx: number, gz: number, px: number, pz: number): boolean {
  return Math.hypot(px - gx, pz - gz) <= MORTHEN_TUNING.graspRadius;
}
