// The Guardian of the Quench's fight state (encounters/smith_heart/quench.ts),
// as Entity.smithHeartQuench on the guardian. A type-only leaf so
// src/sim/types.ts can name it. Sim authority only: the client reads the
// fight from the players' auras, the guardian's bars and auras, and the
// fight's objects (quench_ids.ts says which).

import type { QuenchDifficulty, QuenchEchoKind } from './quench_ids';

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
}

/** An echo's footprint waiting at a blade. */
export interface QuenchEcho {
  objectId: number;
  kind: QuenchEchoKind;
  x: number;
  z: number;
  facing: number;
  /** Seconds to its landing (then its blast shows for a moment). */
  remaining: number;
  /** Seconds its blast still shows after landing (0: not landed yet). */
  shown: number;
  /** It repeats the guardian's breath bar now running (a cut bar drops it). */
  ofBar?: true;
}

/** Heroic: two blades crossing the lake. */
export interface QuenchDance {
  /** CROSSING_PAIRS index and its two blades (indices into `blades`). */
  pair: number;
  a: number;
  b: number;
  laneId: number;
  phase: 'warn' | 'fly' | 'crack';
  remaining: number;
  from: { x: number; z: number };
  to: { x: number; z: number };
  /** Players the flying blades have already struck. */
  struck: number[];
}

export interface QuenchFightState {
  kind: 'quench';
  difficulty: QuenchDifficulty;
  /** The guardian has fallen and the end was resolved. */
  finished: boolean;
  /** Seconds since the pull. */
  clock: number;
  /** The fight's half: the Lake, the blades waking, the Echoes. */
  half: 'lake' | 'wake' | 'echoes';
  bar: QuenchBar | null;
  /** Breath after a bar before the next begins. */
  gap: number;
  breathTimer: number;
  /** Tempering Strike's swing count as last seen (a reset is a strike). */
  cleaveSeen: number;
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
  echoes: QuenchEcho[];
  deepenTimer: number;
  deepenStacks: number;
  danceTimer: number;
  dances: number;
  lastPair: number;
  dance: QuenchDance | null;
  /** Mechanic casts started (the deterministic salt of every pick). */
  casts: number;
  /** Lines said this pull: `<moment>` to the fight clock. */
  said: Record<string, number>;
}
