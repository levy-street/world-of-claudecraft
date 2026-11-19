// The Masterless Strength's fight state (Entity.smithHeartFinal, on the
// boss): server-local sim authority. The client reads the fight from the
// boss's auras, bars and the fight's objects (final_ids.ts says which).
// Type-only.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import type { HeartQuarterZone } from '../../content/smith_heart_quarters';
import type { SmithHeartFeatAttempt } from './feat_attempt';
import type { FinalElementsState } from './final_elements_state';
import type { FinalDifficulty, FinalPoolKind } from './final_ids';
import type { FinalStage } from './final_phase_ids';
import type { FinalVoiceWatch } from './final_voice';
import type { TierSwingBase } from './tier_swing';

/** A bar in flight on the boss. */
export interface FinalBar {
  castId: string;
  at: { x: number; y: number; z: number };
  facing: number;
}

/** Basalt Fist's spot and its lanes, waiting for the bar. */
export interface FinalFist {
  objectId: number;
  x: number;
  z: number;
  lanes: number[];
  bearings: number[];
}

/** A Molten Swell rolling down its lane. */
export interface FinalSwell {
  laneId: number;
  waveId: number | null;
  x: number;
  z: number;
  facing: number;
  delay: number;
  front: number;
  struck: number[];
}

/** A Fire Whirl: its warning, then its run across the floor. */
export interface FinalWhirl {
  objectId: number;
  warn: number;
  life: number;
  heading: number;
  /** Seconds before it may strike each player again (by id). */
  cooldown: Record<number, number>;
  /** A Breath Dust Devil (wind: it wanders and throws) rather than a Fire
   *  Whirl, and the seconds to its next turn. */
  wind?: boolean;
  turn?: number;
}

/** A burning pool (embers, the frontal's forge fire, the Heat Splinter's
 *  Cinder Trail). */
export interface FinalPool {
  objectId: number;
  kind: FinalPoolKind;
  x: number;
  z: number;
  r: number;
  life: number;
}

/** A marked player's timer (Ember Mark, Drawn Lightning). */
export interface FinalMark {
  pid: number;
  left: number;
}

/** A timed spot on the floor (a Groaning Ice crack, a Tremor Crack, a Storm
 *  Orb). */
export interface FinalSpot {
  objectId: number;
  x: number;
  z: number;
  left: number;
}

/** Weight of the Anvil's mark under its bar. */
export interface FinalAnvil {
  objectId: number;
  x: number;
  z: number;
  /** Mythic: its bearing round the boss (radians), turning. */
  angle: number;
  left: number;
  /** The player its circle follows through the bar (0: none, a dev spot or
   *  Mythic's turning mark). */
  targetId: number;
}

/** The active quarter's kit clocks (fresh on entering a quarter). */
export interface FinalKitClocks {
  fist: number;
  ember: number;
  ice: number;
  bolt: number;
  drawn: number;
  orb: number;
  tremor: number;
  shell: number;
  devil: number;
}

/** A standing pillar (Wake the Stone): it stays until a blade shatters it. */
export interface FinalPillar {
  objectId: number;
  x: number;
  z: number;
  /** Storm-Charged: a strike ran into it (it pulses the raid). */
  charged: boolean;
}

/** A pillar on its way up: its warning spot on the floor. */
export interface FinalRise {
  objectId: number;
  x: number;
  z: number;
  left: number;
}

/** A Sky Strike on its way down, and the pillars it will run into (each its
 *  Arcing Stone ring's object). */
export interface FinalStrike {
  objectId: number;
  x: number;
  z: number;
  left: number;
  arcs: { pillarId: number; objectId: number }[];
}

/** A Crossing Blade's run: its blade, its line, its mark. */
export interface FinalBladeRun {
  bladeId: number;
  laneId: number;
  /** Its mark (the line runs through them until it locks). */
  target: number;
  phase: 'aim' | 'fly' | 'rest';
  left: number;
  from: { x: number; z: number };
  facing: number;
  length: number;
  /** The flight's progress (0 to 1) last tick. */
  flown: number;
  struck: number[];
}

/** The woken stars (the rework of 2026-11-18): which quarters are awake, in
 *  the order they woke, each star's clock, and what each has on the floor. */
export interface FinalStarsState {
  awake: SmithHeartVein[];
  clock: Record<SmithHeartVein, number>;
  pillars: FinalPillar[];
  rises: FinalRise[];
  strikes: FinalStrike[];
  blade: FinalBladeRun | null;
  /** The marks still to come in this round of blades. */
  bladeQueue: number[];
  chargedTimer: number;
  /** Seconds to the charged pillars' electric ground's next bite. */
  zoneTimer: number;
  /** Volleys laid (the hashed picks' salt). */
  volleys: number;
  /** Counters the tests and the readout read. */
  thrums: number;
  shattered: number;
  charges: number;
}

/** One Splinter of an intermission (part 2). */
export interface FinalAdd {
  id: number;
  vein: SmithHeartVein;
  /** Seconds still climbing out (nothing harms it, it strikes nobody). */
  rise: number;
  /** Shearing Blow's clock. */
  shear: number;
  /** Its own signature's two clocks (each Splinter reads its own). */
  a: number;
  b: number;
  /** The bar in flight (Shearing Blow, Rime Toll, Gale Pounce): its id,
   *  where its feet are planted, its locked facing, its target. */
  bar: string | null;
  barAt: { x: number; y: number; z: number } | null;
  barFacing: number;
  barTarget: number | null;
  /** The Heat: the last Cinder Trail patch's spot. */
  trailAt: { x: number; z: number } | null;
  /** The Breath: the pounce's quarry and the hunt's seconds and pulse. */
  quarry: number | null;
  hunt: number;
  buffet: number;
  /** The Hammer: its swing's base (before Mounting Weight). */
  weapon: { min: number; max: number } | null;
}

/** A Quenching Ring expanding from where its Splinter stood. */
export interface FinalRing {
  objectId: number;
  x: number;
  z: number;
  age: number;
  gaps: number[];
  struck: number[];
}

/** A Bursting Coal on a player. */
export interface FinalCoal {
  pid: number;
  left: number;
  sourceId: number;
}

/** The hidden phase's state (Mythic, final_hidden.ts). */
export interface FinalHiddenState {
  /** Seconds in this stage of the scene (kneel, rebirth). */
  scene: number;
  /** Its health as the rebirth began. */
  fromHp: number;
  /** The quarters' fall order (the frozen bars). */
  order: SmithHeartVein[];
  /** The collapse's seconds so far. */
  clock: number;
  /** Quarters fallen so far. */
  fallen: number;
  /** The next fall's warning has been given. */
  warned: boolean;
  /** The ring has broken: nothing stands. */
  broken: boolean;
  /** The collapse's clock when each quarter fell (its floor goes from then on). */
  fellAt: Partial<Record<SmithHeartVein, number>>;
  /** The bodies on their way down (final_plunge.ts). */
  plunges: FinalPlunge[];
}

/** A body falling with the floor: its seconds so far, where it fell from, its way. */
export interface FinalPlunge {
  playerId: number;
  clock: number;
  fromY: number;
  vx: number;
  vz: number;
}

/** Part 2's state: the intermissions, the poured elements, the final phase. */
export interface FinalPhaseState {
  stage: FinalStage;
  /** Intermissions begun (0, 1, 2). */
  intermissions: number;
  /** The stride's seconds so far (leap, finalLeap). */
  leapClock: number;
  /** Call of the Quarters' seconds left. */
  callLeft: number;
  adds: FinalAdd[];
  /** Splintered Strength's pulses this call, and its clock. */
  splinterPulses: number;
  splinterTimer: number;
  rings: FinalRing[];
  coals: FinalCoal[];
  /** Times each element was poured into it. */
  poured: Record<SmithHeartVein, number>;
  /** Seconds Heart Unbound still holds after a call ends. */
  unboundGrace: number;
  /** The final phase: its seconds and the fury. */
  finalClock: number;
  fury: number;
  furyTimer: number;
  furyWarned: boolean;
  /** Mythic: the Overload bars as the final phase switched them off (the
   *  hidden phase's order reads them). */
  hiddenBars: Record<SmithHeartVein, number> | null;
  /** Mythic: the hidden phase, once it has begun. */
  hidden: FinalHiddenState | null;
  /** The fallen quarters (quarterBit); 0 outside the collapse. */
  fallenMask: number;
}

export interface FinalFightState {
  kind: 'final';
  difficulty: FinalDifficulty;
  /** The boss's pool before its tier's (tier_health.ts), given back at a reset. */
  basePool?: number;
  /** The boss's swing before its tier's (tier_swing.ts), given back at a reset. */
  baseSwing?: TierSwingBase;
  finished: boolean;
  /** This pull's watch on the encounter's feat (feat_attempt.ts: a raider's death breaks it),
   *  created on first touch. */
  feat?: SmithHeartFeatAttempt;
  clock: number;
  /** The zone the boss stands in now. */
  zone: HeartQuarterZone;
  /** The quarter it was pulled in: its base form for the fight. */
  baseForm: SmithHeartVein | null;
  /** The last quarter it stood in (a change from it is a switch). */
  lastQuarter: SmithHeartVein | null;
  /** Each quarter's Overload bar, 0 to 1. */
  overload: Record<SmithHeartVein, number>;
  /** The next Overload pulse of the active bar. */
  pulseTimer: number;
  /** Heroic: the switch mark's seconds left (raid-wide). */
  shakenLeft: number;
  switches: number;
  bursts: number;
  /** Heart Unbound: stacks and its pulse clock. */
  unbound: number;
  unboundTimer: number;
  bar: FinalBar | null;
  gap: number;
  kit: FinalKitClocks;
  casts: number;
  // -- the Heat --
  fist: FinalFist | null;
  swells: FinalSwell[];
  whirls: FinalWhirl[];
  embers: FinalMark[];
  pools: FinalPool[];
  poolTick: number;
  // -- the Quench --
  cracks: FinalSpot[];
  // -- the Breath --
  /** The player the bolt's bar aims at. */
  boltTarget: number | null;
  drawn: FinalMark[];
  drawnTick: number;
  orbs: FinalSpot[];
  // -- the Hammer --
  tremors: FinalSpot[];
  // -- its own --
  anvil: FinalAnvil | null;
  /** Weight of the Anvil's clock (all fight, wherever it stands). */
  anvilClock: number;
  /** The woken stars (final_stars.ts). */
  stars: FinalStarsState;
  /** The frontal's swing count last seen (Mythic's watch). */
  cleaveSeen: number;
  /** Its own elements (final_strike.ts, final_fusion.ts, final_opposites.ts). */
  elements: FinalElementsState;
  /** Part 2: the intermissions and the final phase. */
  phase: FinalPhaseState;
  /** What its voice last saw of the fight (final_voice.ts). */
  voice: FinalVoiceWatch;
}
