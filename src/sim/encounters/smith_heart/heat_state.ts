// The Guardian of the Heat's fight state (encounters/smith_heart/heat.ts), as
// Entity.smithHeartHeat on the guardian. A type-only leaf so src/sim/types.ts
// can name it. Sim authority only: the client reads the fight from the
// guardian's bars and auras, the adds, the players' auras and the fight's
// objects (heat_ids.ts says which).

import type {
  HeatDifficulty,
  HeatPhase,
  HeatRiverState,
  HeatStage,
  HeatZoneState,
} from './heat_ids';
import type { SlainWatch } from './voice_slain';

/** A bar the guardian runs for the fight. */
export interface HeatBar {
  castId: string;
  /** Where its feet were planted (world) and the facing it locked. */
  at: { x: number; y: number; z: number };
  facing: number;
}

/** Basalt Fist on its bar: its spot and its three lanes' objects. */
export interface HeatFist {
  objectId: number;
  x: number;
  z: number;
  lanes: number[];
  bearings: number[];
}

/** A Molten Swell rolling down its lane from a fist's spot. */
export interface HeatSwell {
  laneId: number;
  waveId: number | null;
  x: number;
  z: number;
  facing: number;
  /** Seconds before the wave starts (then null: rolling). */
  delay: number;
  /** Yards down the lane the wave's front has rolled. */
  front: number;
  /** The players this wave already struck. */
  struck: number[];
}

/** An overflow river from the wellspring. */
export interface HeatRiver {
  objectId: number;
  facing: number;
  state: HeatRiverState;
  remaining: number;
  tick: number;
}

/** One overflow (at 70 and at 40 percent). */
export interface HeatOverflow {
  /** First (70 percent) or second (40 percent). */
  n: 1 | 2;
  /** Seconds the Hearth has overflowed (the `under` stage's own clock). */
  clock: number;
  riverIn: number;
  boltIn: number;
  /** Surges so far (the rivers' hashed salt). */
  surges: number;
  /** Volleys so far (the bolts' hashed salt). */
  volleys: number;
  rivers: HeatRiver[];
}

/** A Hearthseed on the floor. */
export interface HeatSeed {
  objectId: number;
  x: number;
  z: number;
  life: number;
}

/** A Wakefire band warning or burning. */
export interface HeatZone {
  objectId: number;
  band: number;
  state: HeatZoneState;
  remaining: number;
  tick: number;
}

/** A Wakefire run: the bands in their order, the next one's start. */
/** One round of the Wheel of the Hearth on the floor. */
export interface HeatWheelRound {
  safe: number;
  state: 'warn' | 'burn';
  remaining: number;
  tick: number;
  /** The red slices' objects, in slice order. */
  reds: number[];
  safeId: number;
}

export interface HeatZoneRun {
  order: number[];
  next: number;
  stepIn: number;
}

/** Where a Rolling Cinder will land. */
export interface HeatFall {
  objectId: number;
  x: number;
  z: number;
  remaining: number;
  /** The player it will hunt (picked as it falls). */
  quarry: number | null;
}

/** A burning patch on the floor (a cinder's scorch, a Cinder Trail). */
export interface HeatPatch {
  objectId: number;
  x: number;
  z: number;
  life: number;
  tick: number;
}

/** A Rolling Cinder (a mob the encounter walks). */
export interface HeatCinder {
  id: number;
  quarry: number | null;
  /** Seconds before it picks a new quarry (its last one gone). */
  retarget: number;
  /** Its health a tick ago (a drop is a hit: it is struck back). */
  hpSeen: number;
}

/** A Wellkeeper and its Kindling Mark's clock. */
export interface HeatKeeper {
  id: number;
  markIn: number;
}

/** A player a Wellkeeper marked: the mark, then the trail. */
export interface HeatMark {
  pid: number;
  /** Seconds before the trail catches (then 0). */
  markIn: number;
  /** Seconds the trail still runs. */
  trailLeft: number;
  dropIn: number;
}

/** A Seedflame and the player it hunts. */
export interface HeatSprout {
  id: number;
  quarry: number | null;
}

export interface HeatFightState {
  kind: 'heat';
  difficulty: HeatDifficulty;
  /** The boss's pool before its tier's (tier_health.ts), given back at a reset. */
  basePool?: number;
  /** The guardian has fallen and the end was resolved. */
  finished: boolean;
  /** Seconds since the pull. */
  clock: number;
  phase: HeatPhase;
  stage: HeatStage;
  /** Seconds left in a timed stage (sinking, rising). */
  stageLeft: number;
  overflow: HeatOverflow | null;
  overflows: number;
  bar: HeatBar | null;
  /** Breath after a bar before the next begins. */
  gap: number;
  fistTimer: number;
  fists: number;
  fist: HeatFist | null;
  swells: HeatSwell[];
  flareTimer: number;
  wellTick: number;
  seedTimer: number;
  seedWaves: number;
  seeds: HeatSeed[];
  zoneTimer: number;
  zoneRun: HeatZoneRun | null;
  /** The Wheel of the Hearth (Mythic): its clock, how many ran, this run's safe
   *  slices, the next round's index, the rounds on the floor. */
  wheelTimer: number;
  wheelRuns: number;
  wheelSafes: number[];
  wheelNext: number;
  wheelRounds: HeatWheelRound[];
  zones: HeatZone[];
  cinderTimer: number;
  cindersCalled: number;
  falls: HeatFall[];
  scorches: HeatPatch[];
  cinders: HeatCinder[];
  /** Heroic's adds of the overflows. */
  spawn: number[];
  keepers: HeatKeeper[];
  marks: HeatMark[];
  trails: HeatPatch[];
  sprouts: HeatSprout[];
  /** Wellspawn that reached the wellspring, and the hits they dealt. */
  feeds: number;
  /** Mechanic casts started (the hashed picks' salt). */
  casts: number;
  /** Lines said this pull: `<moment>` to the fight clock. */
  said: Record<string, number>;
  /** The players seen dead this pull and the pull's deaths (the kill lines'
   *  watch, voice_slain.ts). */
  slain: SlainWatch;
}
