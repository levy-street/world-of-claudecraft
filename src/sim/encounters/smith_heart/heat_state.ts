// The Guardian of the Heat's fight state (encounters/smith_heart/heat.ts), as
// Entity.smithHeartHeat on the guardian. A type-only leaf so src/sim/types.ts
// can name it. Sim authority only: the client reads the fight from the
// guardian's bars and auras, the adds, the players' auras and the fight's
// objects (heat_ids.ts says which).

import type { SmithHeartFeatAttempt } from './feat_attempt';
import type { HardEnrageState } from './hard_enrage';
import type { HeatDifficulty, HeatPhase, HeatStage, HeatZoneState } from './heat_ids';
import type { TierSwingBase } from './tier_swing';
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

/** A ring of lava rolling out of the wellspring (heat_waves.ts). */
export interface HeatRing {
  objectId: number;
  /** Its corridors' bearings (sim facing, radians). */
  gaps: number[];
  /** Yards from the wellspring's middle its wall's front has rolled. */
  front: number;
  /** The players its wall already struck. */
  struck: number[];
}

/** The next ring: its corridors glowing on the floor until it leaves the lip. */
export interface HeatRingPlan {
  gaps: number[];
  /** The corridors' warning objects. */
  gapIds: number[];
  launchIn: number;
}

/** One overflow (at 70 and at 40 percent): its lava waves and Falling Cinders. */
export interface HeatOverflow {
  /** First (70 percent) or second (40 percent). */
  n: 1 | 2;
  /** Seconds the Hearth has overflowed (the `under` stage's own clock). */
  clock: number;
  boltIn: number;
  /** Volleys so far (the bolts' hashed salt). */
  volleys: number;
  /** Rings planned and launched so far (the corridors' hashed salt). */
  planned: number;
  launched: number;
  /** The rings rolling out, and the next one's warning (null once the last
   *  has left the lip, and before the guardian is under). */
  rings: HeatRing[];
  next: HeatRingPlan | null;
}

/** A Hearthseed on the floor. */
export interface HeatSeed {
  objectId: number;
  x: number;
  z: number;
  life: number;
  /** Seconds of its flight left (HEAT_TUNING.seedFlight at the throw): it
   *  lands (the seed cue) when this runs out. */
  flight: number;
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
  /** Once erupted: the red slices on the way to the next round's safe slice
   *  (heat_wheel.ts wheelCrossing), put out after `douse` more seconds and
   *  never burning anyone meanwhile. Empty on a run's last round. */
  doused: number[];
  douse: number;
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

/** A Live Coal on its bearer (heat_coal.ts): the absorb left rides the
 *  bearer's aura; the fuse and the leaps are kept here. */
export interface HeatCoal {
  /** Its bearer now. */
  pid: number;
  /** Seconds to its burst (a leap carries it on, never resets it). */
  fuse: number;
  /** Seconds to its next burn tick. */
  tick: number;
  /** Seconds before it may leap again (after a leap). */
  grace: number;
  /** The bearer it last left, and how long that one stays out of its reach. */
  prev: number | null;
  prevGrace: number;
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
  /** The boss's swing before its tier's (tier_swing.ts), given back at a reset. */
  baseSwing?: TierSwingBase;
  /** The guardian has fallen and the end was resolved. */
  finished: boolean;
  /** This pull's watch on the encounter's feat (feat_attempt.ts), created on first touch. */
  feat?: SmithHeartFeatAttempt;
  /** Seconds since the pull. */
  clock: number;
  /** Forge-Fury, the hard enrage (hard_enrage.ts; Heroic and Mythic), created
   *  on its first tick at the pull. */
  enrage?: HardEnrageState;
  phase: HeatPhase;
  /** The fight clock when this phase began (the cinders' soft enrage reads
   *  how long phase 3 has run, heat_cinders.ts). */
  phaseAt: number;
  stage: HeatStage;
  /** Seconds left in a timed stage (sinking, rising). */
  stageLeft: number;
  overflow: HeatOverflow | null;
  overflows: number;
  bar: HeatBar | null;
  /** Breath after a bar before the next begins. */
  gap: number;
  fistTimer: number;
  /** Seconds the due fist has waited out Wakefire (heat_fist.ts
   *  wakefireHoldsFist): the next one comes that much sooner, so the
   *  fight keeps its 22 s rhythm round the runs. */
  fistHeld: number;
  fists: number;
  fist: HeatFist | null;
  /** Heroic and Mythic: the second marked player's fist, slammed with the
   *  first (heat_fist.ts; HEAT_DIFFICULTY `fistMarks`). */
  fistTwin: HeatFist | null;
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
  /** Heroic's Live Coals (heat_coal.ts): the clock (fighting time only),
   *  how many were set (the pick's salt), the fight clock of the last set
   *  (the Wheel waits it out), the coals on players, and the tallies. */
  coalTimer: number;
  coalCasts: number;
  coalAt: number;
  coals: HeatCoal[];
  /** Every player seen wearing Cinder Grip this pull (the tanks: never a
   *  coal's pick). */
  gripWorn: number[];
  coalOuts: number;
  coalLeaps: number;
  coalBursts: number;
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
