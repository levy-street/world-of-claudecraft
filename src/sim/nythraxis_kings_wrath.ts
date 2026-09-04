// The King's Wrath: Nythraxis's third phase (30% to 0%), replacing the old 5%
// Final Stand haste enrage.
//
// He enters it at NYTHRAXIS_PHASE_THREE_HP once no body-owning major is in
// flight (a Deathless Rage cast or its stun, the heroic court summon, a live
// Binding Sigil drag, a Bone Storm), the way Ignivar gates Judgment. On entry
// he gains a permanent damage bonus and two hazard cadences tighten; every
// phase 2 mechanic keeps running on its phase 2 cadence, and Bone Storm
// (nythraxis_bone_storm.ts) and the enrage clock (nythraxis_enrage_clock.ts)
// join. The pure pieces live here (tuning, the entry gate, the cadence
// tightening); the driver in encounters/nythraxis.ts owns the transition.
//
// `src/sim`-pure: no rng, no wall clock, no DOM.

import type { DungeonDifficulty } from './types';

export const NYTHRAXIS_PHASE_THREE_HP = 0.3;
export const NYTHRAXIS_KINGS_WRATH_AURA_ID = 'nythraxis_kings_wrath';
export const NYTHRAXIS_KINGS_WRATH_AURA_NAME = "King's Wrath";
export const NYTHRAXIS_KINGS_WRATH_DAMAGE_BONUS_NORMAL = 0.2;
export const NYTHRAXIS_KINGS_WRATH_DAMAGE_BONUS_HEROIC = 0.25;
/** Phase 3 cadences for the two floor hazards. */
export const NYTHRAXIS_WRATH_GRAVE_ERUPTION_EVERY_NORMAL = 10;
export const NYTHRAXIS_WRATH_GRAVE_ERUPTION_EVERY_HEROIC = 8;
export const NYTHRAXIS_WRATH_GRAVEFIRE_EVERY_NORMAL = 8;
export const NYTHRAXIS_WRATH_GRAVEFIRE_EVERY_HEROIC = 6;

export function nythraxisWrathGraveEruptionEvery(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_WRATH_GRAVE_ERUPTION_EVERY_HEROIC
    : NYTHRAXIS_WRATH_GRAVE_ERUPTION_EVERY_NORMAL;
}

export function nythraxisWrathGravefireEvery(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_WRATH_GRAVEFIRE_EVERY_HEROIC
    : NYTHRAXIS_WRATH_GRAVEFIRE_EVERY_NORMAL;
}

export function nythraxisKingsWrathDamageBonus(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_KINGS_WRATH_DAMAGE_BONUS_HEROIC
    : NYTHRAXIS_KINGS_WRATH_DAMAGE_BONUS_NORMAL;
}

/** Which body-owning majors are in flight right now, as the driver sees them. */
export interface NythraxisMajorsInFlight {
  deathlessCasting: boolean;
  deathlessStunned: boolean;
  courtSummoning: boolean;
  sigilUp: boolean;
  storming: boolean;
}

export function nythraxisAnyMajorInFlight(majors: NythraxisMajorsInFlight): boolean {
  return (
    majors.deathlessCasting ||
    majors.deathlessStunned ||
    majors.courtSummoning ||
    majors.sigilUp ||
    majors.storming
  );
}

/** True when phase 2 should hand over to The King's Wrath this tick. */
export function nythraxisPhaseThreeReady(
  hpFraction: number,
  majors: NythraxisMajorsInFlight,
): boolean {
  return hpFraction <= NYTHRAXIS_PHASE_THREE_HP && !nythraxisAnyMajorInFlight(majors);
}

/**
 * The cadence a hazard runs on: its difficulty cadence until phase 3, then
 * the tighter of that and the Wrath cadence (heroic's 12 s eruptions become
 * 10 s; nothing ever loosens).
 */
export function nythraxisWrathCadence(
  inWrath: boolean,
  baseCadence: number,
  wrathCadence: number,
): number {
  return inWrath ? Math.min(baseCadence, wrathCadence) : baseCadence;
}
