// The Guardian of the Breath's fight state (encounters/smith_heart/breath.ts),
// as Entity.smithHeartBreath on the guardian. A type-only leaf so
// src/sim/types.ts can name it. Sim authority only: the client reads the
// fight from the wind object's template, the guardian's bars and auras, the
// players' auras and the fight's objects (breath_ids.ts says which).

import type { BreathDifficulty, BreathWindPhase } from './breath_ids';

/** The wind's clock (phase 1, and the heroic gusts of phase 2). */
export interface BreathWind {
  phase: BreathWindPhase;
  /** Seconds left in the phase, and its whole length. */
  remaining: number;
  total: number;
  /** Where it blows (or will blow) toward: compass degrees. */
  bearing: number;
  /** Blows begun this pull (the next bearing's index). */
  blows: number;
}

/** A bar the guardian runs for the fight. */
export interface BreathBar {
  castId: string;
  /** Where its feet were planted (world). */
  at: { x: number; y: number; z: number };
  targetId: number | null;
}

/** Captain Thessaly's circle of calm (instance-local centre). */
export interface BreathCalm {
  objectId: number;
  x: number;
  z: number;
  state: 'land' | 'hold' | 'spent';
  remaining: number;
  /** The players it anchored, in the order they stepped in. */
  seated: number[];
}

/** A timed spot on the floor: a strike's warning, charged ground's life. */
export interface BreathSpot {
  objectId: number;
  x: number;
  z: number;
  r: number;
  remaining: number;
  /** A strike: what it deals on landing (and whether it leaves charged
   *  ground: a conductor's). Charged ground: its bite's clock. */
  kind: 'barrage' | 'drawn' | 'charged';
  tick: number;
}

/** Heroic: a loose gale and who it tossed when (player id to fight clock). */
export interface BreathGale {
  objectId: number;
  k: number;
  t: number;
  tossed: Record<number, number>;
}

/** Phase 2: the Thunder's Cradle in flight. */
export interface BreathCradle {
  playerId: number;
  objectId: number;
  x: number;
  z: number;
  remaining: number;
}

/** Phase 2: the marked conductor. */
export interface BreathDrawn {
  playerId: number;
  remaining: number;
  /** Seconds to the next strike at their feet. */
  next: number;
}

export interface BreathFightState {
  kind: 'breath';
  difficulty: BreathDifficulty;
  /** The guardian has fallen and the end was resolved. */
  finished: boolean;
  /** Seconds since the pull. */
  clock: number;
  /** The fight's half: the Wind, the storm breaking, the Storm. */
  half: 'wind' | 'break' | 'storm';
  /** The hashed start of the blows' bearing order (breath_ids.ts blowBearing). */
  start: number;
  wind: BreathWind;
  bar: BreathBar | null;
  /** Breath after a bar before the next begins. */
  gap: number;
  inhaleTimer: number;
  /** Phase 1: the next circle of calm. */
  circleTimer: number;
  calm: BreathCalm | null;
  /** Seconds each pinned player has been pressed since its last hit. */
  pinned: Record<number, number>;
  /** Players gone over an open lip this pull (each said once). */
  overLip: number[];
  /** Players Thessaly's calm anchors now (an anchor run out, heroic leaves
   *  them spent). */
  anchors: number[];
  /** The vortex object while the guardian draws breath, and its clock. */
  vortex: { objectId: number; x: number; z: number; tick: number } | null;
  gales: BreathGale[];
  /** The storm breaking: the barrage's clock (seconds left, next volley). */
  barrage: { remaining: number; next: number; volleys: number } | null;
  spots: BreathSpot[];
  forkTimer: number;
  cradleTimer: number;
  drawnTimer: number;
  swellTimer: number;
  swellPulses: number;
  gustTimer: number;
  cradle: BreathCradle | null;
  drawn: BreathDrawn | null;
  /** Mechanic casts started (the deterministic salt of every pick). */
  casts: number;
  /** Lines said this pull: `<speaker>_<moment>` to the fight clock. */
  said: Record<string, number>;
}
