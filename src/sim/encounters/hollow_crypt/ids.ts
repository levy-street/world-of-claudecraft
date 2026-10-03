// The Hollow Crypt finale's ids, tuning and pure geometry, as a dependency-
// light leaf: the encounter modules, the dev helpers, the renderer's rite and
// wyrm visuals and the tests all key on these. No SimContext, no rng.
//
//   Morthen's entrance: he is entombed under the Rite Ring (hidden, untouchable)
//   until the group steps into the ring; the rite wakes (the circle ignites),
//   he RISES out of the floor high into the sky, proclaims, descends onto the
//   ring and only then fights.
//   The Knellwyrm: when Morthen falls the ritual circle bursts into ghost fire
//   (the warning), and a great bone wyrm arrives FROM THE SKY, lands in the
//   pyre and fights: Barrowflame Breath, Tail Lash and Wing Gust as the
//   Ossuary Drake, plus Pyre Strafe (a flying run that sets a lane of the ring
//   burning) and Dread Bellow (a roar that throws the close back and bares its
//   ribs: the damage window).

import { HOLLOW_CRYPT_RING } from '../../content/hollow_crypt_layout';
import { inLane } from '../../mob/trash_kit/lane';

export const MORTHEN_ID = 'morthen';
export const KNELLWYRM_ID = 'crypt_knellwyrm';

// ---- Morthen's entrance: cast ids (the phases ride his cast bar) ---------------------
/** Still entombed: the ritual circle ignites over him. */
export const MORTHEN_RITE_WAKES = 'crypt_morthen_rite_wakes';
/** He rises out of the floor into the sky. */
export const MORTHEN_RISE = 'crypt_morthen_rise';
/** He hangs in the sky and speaks. */
export const MORTHEN_PROCLAIM = 'crypt_morthen_proclaim';
/** He comes down onto the ring. */
export const MORTHEN_DESCEND = 'crypt_morthen_descend';

// ---- auras ------------------------------------------------------------------------------
/** Concealed under the ring (Morthen before the group arrives, the Knellwyrm
 *  before it arrives): the client builds no view for the entity. */
export const CRYPT_ENTOMBED = 'crypt_entombed';
/** Is this entity concealed by an encounter (entombed under the ring, or not
 *  yet arrived)? Clients build no view for it: no body, plate or click. */
export function isEntombed(e: { auras?: readonly { id: string }[] }): boolean {
  if (!e.auras) return false;
  for (const a of e.auras) if (a.id === CRYPT_ENTOMBED) return true;
  return false;
}
/** Held by the rite through the entrance: untouchable (a cinematic, not a fight). */
export const CRYPT_GRAVE_ASCENSION = 'crypt_grave_ascension';
/** The Knellwyrm's ribs bared after Dread Bellow: it takes more damage. */
export const KNELLWYRM_BARED_RIBS = 'crypt_knellwyrm_bared_ribs';

// ---- the Knellwyrm: cast ids ------------------------------------------------------------
/** Its flight in from the sky (the whole approach rides this bar). */
export const KNELLWYRM_ARRIVE = 'crypt_knellwyrm_arrive';
/** The lane is marked and it takes wing. */
export const KNELLWYRM_PYRE_STRAFE = 'crypt_knellwyrm_pyre_strafe';
/** The strafing run itself: fire poured down the lane as it flies it. */
export const KNELLWYRM_STRAFE_RUN = 'crypt_knellwyrm_strafe_run';
/** The roar that throws the close back and bares its ribs. */
export const KNELLWYRM_DREAD_BELLOW = 'crypt_knellwyrm_dread_bellow';

// ---- spellfx ability ids (presentation cues, never casts) --------------------------------
export const MORTHEN_LANDING = 'crypt_morthen_landing';
export const KNELLWYRM_TOUCHDOWN = 'crypt_knellwyrm_touchdown';

// ---- encounter object templates (the state rides the template id) ------------------------
/** The ritual circle bursting into ghost fire: the Knellwyrm's warning. */
export const KNELL_PYRE_TEMPLATE = 'crypt_knell_pyre';
/** A Pyre Strafe lane while its bar runs (the telegraph); the same object
 *  swaps to the burning template when the run has passed over it. */
export const KNELL_LANE_MARK_TEMPLATE = 'crypt_knell_lane_mark';
/** A lane of the ring left burning by Pyre Strafe. */
export const KNELL_LANE_TEMPLATE = 'crypt_knell_fire_lane';

/** Every Hollow Crypt encounter object template (the renderer draws them itself). */
export const CRYPT_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([
  KNELL_PYRE_TEMPLATE,
  KNELL_LANE_MARK_TEMPLATE,
  KNELL_LANE_TEMPLATE,
]);

// ---- tuning -------------------------------------------------------------------------------
export const RITE_RING = HOLLOW_CRYPT_RING;
/** Morthen's spot at the altar (the ritual circle he rises through). */
export const MORTHEN_SPOT = { x: 0, z: 212 } as const;

export const MORTHEN_RISE_TUNING = {
  /** A player this far inside the ring's rim, on the ring floor, wakes the rite. */
  triggerInset: 3,
  /** Seconds the circle burns before he breaks the floor. */
  wakeSeconds: 3,
  /** How deep under the ring floor he waits. */
  buriedDepth: 7,
  /** Seconds of the rise, and how high over the floor it carries him. */
  riseSeconds: 6,
  apex: 14,
  proclaimSeconds: 3.5,
  descendSeconds: 2.5,
  /** Seconds he stands on the floor before the fight (the landing beat). */
  landSeconds: 1.2,
  /** The landing's reach: anyone this close is thrown clear (no damage). */
  landingReach: 7,
  landingKnockback: 6,
  /** He picks his first victim within this range of the altar. */
  engageRange: 60,
} as const;

/** Morthen's Last Rites (hollow_crypt.md 5.4, phase 3) begin at this fraction
 *  of his health. Today it only drives the presentation (the bell staff unfolds
 *  into his scythe: src/render/hollow_crypt/morthen_fx_core.ts); the phase's
 *  mechanics are still to be designed and will key on the same line. */
export const MORTHEN_LAST_RITES_FRACTION = 0.35;

/** Total seconds from the rite waking to the fight. */
export const MORTHEN_ENTRANCE_SECONDS =
  MORTHEN_RISE_TUNING.wakeSeconds +
  MORTHEN_RISE_TUNING.riseSeconds +
  MORTHEN_RISE_TUNING.proclaimSeconds +
  MORTHEN_RISE_TUNING.descendSeconds +
  MORTHEN_RISE_TUNING.landSeconds;

/** Morthen's height over the ring floor `t` seconds into a phase: buried, the
 *  slow rise (eased), the hover (a breath of bob), the descent. Pure. */
export function morthenEntranceHeight(
  phase: 'dormant' | 'wakes' | 'rise' | 'proclaim' | 'descend' | 'land' | 'risen',
  t: number,
): number {
  const T = MORTHEN_RISE_TUNING;
  switch (phase) {
    case 'dormant':
    case 'wakes':
      return -T.buriedDepth;
    case 'rise': {
      const k = Math.min(1, Math.max(0, t / T.riseSeconds));
      // Slow out of the ground, gathering speed, easing into the hover.
      const ease = k * k * (3 - 2 * k);
      return -T.buriedDepth + (T.apex + T.buriedDepth) * ease;
    }
    case 'proclaim':
      return T.apex + Math.sin((t / T.proclaimSeconds) * Math.PI * 2) * 0.4;
    case 'descend': {
      const k = Math.min(1, Math.max(0, t / T.descendSeconds));
      return T.apex * (1 - k * k);
    }
    default:
      return 0;
  }
}

export const KNELLWYRM_TUNING = {
  /** The ritual circle burns this long before it lands in it (the warning). */
  pyreSeconds: 5,
  /** The pyre's radius: standing in it when it lands is a mistake. */
  pyreRadius: 9,
  /** The landing blast inside the pyre. */
  landingMin: 60,
  landingMax: 75,
  landingKnockback: 9,
  /** The flight in from the sky. */
  arriveSeconds: 5,
  /** Where it starts: this far out beyond the rim and this high over the floor. */
  arriveFrom: { distance: 110, height: 55 },
  /** Seconds it stands in the pyre after touching down before it fights. */
  settleSeconds: 1.2,
  // Pyre Strafe: the lane is marked, it lifts off, then flies the lane pouring fire.
  strafeFirst: 14,
  strafeEvery: 26,
  strafeMark: 2.5,
  strafeFlight: 2,
  strafeHeight: 9,
  laneHalf: 3,
  /** The fire poured over the lane as it passes. */
  strafeMin: 35,
  strafeMax: 45,
  /** The lane burns this long, ticking each second on anyone in it. */
  laneSeconds: 10,
  lanePerSecond: 14,
  // Dread Bellow: a roar that throws the close back and bares its ribs.
  bellowFirst: 24,
  bellowEvery: 30,
  bellowCast: 2,
  bellowRadius: 14,
  bellowKnockback: 10,
  bellowMin: 12,
  bellowMax: 18,
  /** Bared Ribs: seconds, and how much more damage it takes. */
  baredSeconds: 8,
  baredVuln: 0.25,
} as const;

/** The strafe's lane across the ring: through the victim's spot, starting on
 *  the rim BEHIND the wyrm and running rim to rim, so the whole ring width
 *  burns. Instance-local coordinates in and out. Pure. */
export function strafeLane(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): { x: number; z: number; yaw: number; length: number } {
  let yaw = Math.atan2(toX - fromX, toZ - fromZ);
  if (!Number.isFinite(yaw) || (toX === fromX && toZ === fromZ)) yaw = 0;
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  // The chord of the ring along this line through the victim.
  const r = RITE_RING.r - 1;
  const ox = toX - RITE_RING.x;
  const oz = toZ - RITE_RING.z;
  const b = ox * ax + oz * az;
  const c = ox * ox + oz * oz - r * r;
  const disc = Math.max(0, b * b - c);
  const back = -b - Math.sqrt(disc);
  const ahead = -b + Math.sqrt(disc);
  return {
    x: toX + ax * back,
    z: toZ + az * back,
    yaw,
    length: Math.max(0, ahead - back),
  };
}

/** Is (px, pz) inside a strafe lane? */
export function inStrafeLane(
  lane: { x: number; z: number; yaw: number; length: number },
  px: number,
  pz: number,
): boolean {
  return inLane(lane.x, lane.z, lane.yaw, lane.length, KNELLWYRM_TUNING.laneHalf, px, pz);
}

/** The Knellwyrm's flight in, `k` in [0, 1]: from high over the mist beyond
 *  the rim (the side away from the Bone Stair's mouth) down onto the pyre.
 *  Instance-local x, z and height over the ring floor. Pure. */
export function wyrmArrivalPose(k: number): { x: number; z: number; up: number; yaw: number } {
  const T = KNELLWYRM_TUNING;
  const t = Math.min(1, Math.max(0, k));
  // It comes in from the north-west, over the chasm, never from the stair.
  const dirX = -Math.SQRT1_2;
  const dirZ = Math.SQRT1_2;
  const ease = 1 - (1 - t) ** 2;
  const dist = T.arriveFrom.distance * (1 - ease);
  // A long glide that flares steeply at the end.
  const up = T.arriveFrom.height * (1 - t) ** 1.6;
  return {
    x: MORTHEN_SPOT.x + dirX * dist,
    z: MORTHEN_SPOT.z + dirZ * dist,
    up,
    // Facing the way it flies (toward the ring), then onto the stair.
    yaw: Math.atan2(-dirX, -dirZ),
  };
}
