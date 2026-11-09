// The Masterless Strength's fight state (Entity.smithHeartFinal, on the
// boss): server-local sim authority. The client reads the fight from the
// boss's auras, bars and the fight's objects (final_ids.ts says which).
// Type-only.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import type { HeartQuarterZone } from '../../content/smith_heart_quarters';
import type { FinalDifficulty, FinalPoolKind } from './final_ids';
import type { FinalStage } from './final_phase_ids';
import type { FinalVoiceWatch } from './final_voice';

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

/** The wind: its warning, then its blow toward `heading`. */
export interface FinalWind {
  objectId: number;
  heading: number;
  warn: number;
  blow: number;
  rimTick: number;
}

/** Weight of the Anvil's mark under its bar. */
export interface FinalAnvil {
  objectId: number;
  x: number;
  z: number;
  /** Mythic: its bearing round the boss (radians), turning. */
  angle: number;
  left: number;
}

/** The active quarter's kit clocks (fresh on entering a quarter). */
export interface FinalKitClocks {
  fist: number;
  whirl: number;
  ember: number;
  ice: number;
  wind: number;
  bolt: number;
  drawn: number;
  orb: number;
  tremor: number;
  anvil: number;
  shell: number;
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
  /** Each poured element's own clock. */
  pouredClock: Record<SmithHeartVein, number>;
  /** Seconds Heart Unbound still holds after a call ends. */
  unboundGrace: number;
  /** The final phase: its seconds, the mix's turn and clock, the fury. */
  finalClock: number;
  mixTurn: number;
  mixTimer: number;
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
  finished: boolean;
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
  /** Taking Root's seconds left, and the spot it holds. */
  rootLeft: number;
  rootAt: { x: number; y: number; z: number } | null;
  /** Seconds after a root lets go in which no planted bar begins (the
   *  tank's window to start the drag). */
  dragGrace: number;
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
  /** The cold bar by player id (0 to 100). */
  cold: Record<number, number>;
  /** Frozen players' seconds left (by id). */
  frozen: Record<number, number>;
  cracks: FinalSpot[];
  // -- the Breath --
  wind: FinalWind | null;
  /** The player the bolt's bar aims at. */
  boltTarget: number | null;
  drawn: FinalMark[];
  drawnTick: number;
  orbs: FinalSpot[];
  // -- the Hammer --
  tremors: FinalSpot[];
  anvil: FinalAnvil | null;
  /** The frontal's swing count last seen (Mythic's watch). */
  cleaveSeen: number;
  /** Part 2: the intermissions and the final phase. */
  phase: FinalPhaseState;
  /** What its voice last saw of the fight (final_voice.ts). */
  voice: FinalVoiceWatch;
}
