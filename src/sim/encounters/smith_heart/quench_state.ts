// The Guardian of the Quench's fight state (encounters/smith_heart/quench.ts),
// as Entity.smithHeartQuench on the guardian. A type-only leaf so
// src/sim/types.ts can name it. Sim authority only: the client reads the
// fight from the players' auras, the guardian's bars and auras, and the
// fight's objects (quench_ids.ts says which).

import type { QuenchDifficulty } from './quench_ids';
import type { SlainWatch } from './voice_slain';

/** A bar the guardian runs for the fight. */
export interface QuenchBar {
  castId: string;
  /** Where its feet were planted (world) and the facing it locked. */
  at: { x: number; y: number; z: number };
  facing: number;
}

/** One player's cold (the bar's exact value; the aura carries it rounded). */
export interface QuenchChill {
  cold: number;
  /** Seconds left frozen solid (0: not frozen). */
  frozen: number;
}

/** A spot a huddle has strained (instance-local), and for how long. */
export interface QuenchStrain {
  x: number;
  z: number;
  t: number;
  /** Loaded by a huddle this tick. */
  loaded: boolean;
}

/** A crack about to open (instance-local middle). */
export interface QuenchCrack {
  objectId: number;
  x: number;
  z: number;
  r: number;
  remaining: number;
}

/** An open hole (instance-local middle), oldest first. */
export interface QuenchHoleState {
  objectId: number;
  x: number;
  z: number;
  r: number;
}

/** A player held in the water. */
export interface QuenchTrap {
  /** The hole's middle and radius (it may skin over while they are in). */
  x: number;
  z: number;
  r: number;
  remaining: number;
  tick: number;
}

/** One of the Smith's blades: its claim object and where it floats now. */
export interface QuenchBlade {
  objectId: number;
  /** Its home (QUENCH_BLADE_SPOTS index). */
  home: number;
  x: number;
  z: number;
  /** Out of the ice and free to slash. */
  awake: boolean;
}

/** A slash's line: its blade, its object and how far along it is. */
export interface QuenchLine {
  /** The blade flying it (index into `blades`; -1 before the first). */
  blade: number;
  /** The line's object (-1 between two marks). */
  laneId: number;
  phase: 'aim' | 'fly' | 'rest';
  remaining: number;
  /** Its warning's whole length (seconds; what the painter fills to). */
  warn: number;
  /** Where the line starts, the way it runs and its whole length. */
  from: { x: number; z: number };
  facing: number;
  length: number;
  /** Players this flight has already struck. */
  struck: number[];
}

/** A round of slashes: the marks in order and the one under way. */
export interface QuenchSlash extends QuenchLine {
  /** The marked, by entity id, in their order. */
  marks: number[];
  /** The mark under way (index into `marks`). */
  step: number;
}

/** Mythic's interphase under way: its lines out and the wait for the next. */
export interface QuenchFlurry {
  lines: QuenchLine[];
  gap: number;
}

/** A player Living Rime holds (quench_rime.ts). */
export interface QuenchRimeMark {
  /** Its carrier's entity id. */
  id: number;
  /** Seconds left to heal it through before it bursts. */
  remaining: number;
}

export interface QuenchFightState {
  kind: 'quench';
  difficulty: QuenchDifficulty;
  /** The boss's pool before its tier's (tier_health.ts), given back at a reset. */
  basePool?: number;
  /** The guardian has fallen and the end was resolved. */
  finished: boolean;
  /** Seconds since the pull. */
  clock: number;
  /** The fight's half: two blades awake, the others waking, all four. */
  half: 'lake' | 'wake' | 'awake';
  bar: QuenchBar | null;
  /** Breath after a bar before the next begins. */
  gap: number;
  breathTimer: number;
  /** The shore ice: its slabs' objects and seconds until it stands. */
  rim: { ids: number[]; rising: number };
  chill: Record<number, QuenchChill>;
  strain: QuenchStrain[];
  cracks: QuenchCrack[];
  holes: QuenchHoleState[];
  trapped: Record<number, QuenchTrap>;
  /** Seconds before the water can take a player who just climbed out. */
  grace: Record<number, number>;
  blades: QuenchBlade[];
  deepenTimer: number;
  deepenStacks: number;
  slashTimer: number;
  /** Blades sent so far (the rotation among the awake). */
  slashes: number;
  slash: QuenchSlash | null;
  flurry: QuenchFlurry | null;
  /** The interphase has come (it comes once). */
  flurryDone: boolean;
  /** Seconds to the next Living Rime. */
  rimeTimer: number;
  /** Living Rime casts so far (the salt of its picks). */
  rimeCasts: number;
  /** A dev run with Living Rime switched off (`/dev heart quench rime off`). */
  rimeOff?: boolean;
  /** The players Living Rime holds now. */
  rimes: QuenchRimeMark[];
  /** Living Rimes healed through and burst this pull (the readout, the tests). */
  rimeBreaks: number;
  rimeBursts: number;
  /** Mechanic casts started (the deterministic salt of every pick). */
  casts: number;
  /** Tempering Strike's wind-up already cued for the swing under way
   *  (quench_strike_windup.ts); absent: never. */
  strikeWound?: boolean;
  /** Lines said this pull: `<moment>` to the fight clock. */
  said: Record<string, number>;
  /** The players seen dead this pull and the pull's deaths (the kill lines'
   *  watch, voice_slain.ts). */
  slain: SlainWatch;
}
