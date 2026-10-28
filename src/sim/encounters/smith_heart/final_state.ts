// The Masterless Strength's fight state (Entity.smithHeartFinal, on the
// boss): server-local sim authority. The client reads the fight from the
// boss's auras, bars and the fight's objects (final_ids.ts says which).
// Type-only.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import type { HeartQuarterZone } from '../../content/smith_heart_quarters';
import type { FinalDifficulty } from './final_ids';

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

/** A burning pool (embers, the frontal's forge fire). */
export interface FinalPool {
  objectId: number;
  kind: 'ember' | 'forge';
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

export interface FinalFightState {
  kind: 'final';
  difficulty: FinalDifficulty;
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
}
