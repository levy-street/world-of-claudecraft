// Old Thatchgrin's world state (pure leaf: no SimContext, no rng, no clock). Lives on
// the seasonal world state (SeasonalWorldState.scarecrow), reached by the lifecycle
// (scarecrow.ts) and his kit (scarecrow_kit.ts) through the `ctx.seasonal` live view.
// Process-local like the world-boss slot timers: nothing here is persisted, so a realm
// restart during the event raises him fresh in his field.

/** One pull's telegraphs and burning ground. Dropped when the pull ends. */
export interface ScarecrowKitState {
  /** The boss entity this pull belongs to (a respawn is a new pull). */
  bossId: number;
  /** Seconds until the next Gourdfall may start. */
  rainTimer: number;
  /** Pumpkins in the air, as x, z, seconds to landing (RAIN_STRIDE each). */
  rain: number[];
  /** Pumpkins landed this pull (every other one carries the blast sound). */
  rainLanded: number;
  /** Live Smoldering Chaff patches, as x, z, seconds left, seconds to the next burn. */
  chaff: number[];
  /** How many of the kit's calls have fired this pull (they fire in order). */
  callsFired: number;
  /** Seconds left on a call's windup (0 = none). */
  callWindup: number;
  /** Seconds of quiet after a telegraph lands, before the next may start. */
  spacing: number;
  /** How many Swelling Gourds have risen this pull (they rise in threshold order). */
  swellsRisen: number;
  /** The live Swelling Gourd's entity id, null when none stands. */
  swellId: number | null;
  /** Seconds left on its fuse (its cast bar). */
  swellFuse: number;
  /** Seconds until the next Thatchbound may start (scarecrow_puppet.ts). */
  puppetTimer: number;
  /** A Thatchbound cast in flight: its marked victims, in pick order, and its clock. */
  puppetCast: { victims: number[]; elapsed: number } | null;
  /** Live puppets, as player id, the friend it is turned on, seconds to its next swing
   *  (PUPPET_STRIDE each). */
  puppets: number[];
  /** The last cast's victims (spared the next one when anyone else is free). */
  puppetLast: number[];
}

export interface ScarecrowState {
  /** The live (or lingering-corpse) boss, null when none stands in the field. */
  bossId: number | null;
  /** Sim time he may next stand up in his field (0 = at once). */
  respawnAt: number;
  /** His participant health scale for the live spawn (scarecrow.ts sets it). */
  hpScale: { base: number; perPlayer: number; max: number } | null;
  kit: ScarecrowKitState | null;
}

export function freshScarecrowState(): ScarecrowState {
  return { bossId: null, respawnAt: 0, hpScale: null, kit: null };
}

export function freshScarecrowKit(
  bossId: number,
  firstRain: number,
  firstPuppet = 0,
): ScarecrowKitState {
  return {
    bossId,
    rainTimer: firstRain,
    rain: [],
    rainLanded: 0,
    chaff: [],
    callsFired: 0,
    callWindup: 0,
    spacing: 0,
    swellsRisen: 0,
    swellId: null,
    swellFuse: 0,
    puppetTimer: firstPuppet,
    puppetCast: null,
    puppets: [],
    puppetLast: [],
  };
}

/** Stride of one patch in `ScarecrowKitState.chaff`. */
export const CHAFF_STRIDE = 4;
/** Stride of one puppet in `ScarecrowKitState.puppets`. */
export const PUPPET_STRIDE = 3;
/** Stride of one falling pumpkin in `ScarecrowKitState.rain`. */
export const RAIN_STRIDE = 3;
