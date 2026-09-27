// Endless cannon play past the authored victory.
//
// The three authored waves stay the quest: clearing them with the commander
// down completes the world quest, pays its reward and latches the medal, exactly
// as before. Instead of leaving the cannon, the defender then keeps the line
// for as long as they can: the authored patterns repeat with every round
// tougher (more health, faster march, tighter spawn cadence) until the
// emplacement falls or the hard round cap ends the run. No extra reward rides
// on it; the waves held are the score (CannonResult.wavesCleared).
//
// Pure helpers over the encounter state: no rng, no clock.

import { CANNON_WAVES } from '../content/cannon_encounter';
import type { CannonEncounterState, CannonResult, CannonSpawnDef } from '../types';

export const CANNON_ENDLESS = Object.freeze({
  /** Enemy health multiplier grows by this per endless round. */
  hpPerRound: 0.15,
  /** March speed multiplier grows by this per endless round. */
  speedPerRound: 0.07,
  /** Spawn cadence tightens by this per endless round, down to minCadence. */
  cadencePerRound: 0.06,
  minCadence: 0.5,
  /** Rounds past the authored three before the run is called; growth makes it
   *  unwinnable well before then, this only bounds a session. */
  maxRounds: 40,
});

/** 0 during the authored waves, 1 for the first endless wave, and so on. */
export function cannonEndlessRound(state: Pick<CannonEncounterState, 'wave' | 'endless'>): number {
  return state.endless ? Math.max(0, state.wave - (CANNON_WAVES.length - 1)) : 0;
}

export function cannonEndlessHpScale(round: number): number {
  return 1 + CANNON_ENDLESS.hpPerRound * round;
}

export function cannonEndlessSpeedScale(round: number): number {
  return 1 + CANNON_ENDLESS.speedPerRound * round;
}

export function cannonEndlessCadence(round: number): number {
  return Math.max(CANNON_ENDLESS.minCadence, 1 - CANNON_ENDLESS.cadencePerRound * round);
}

/** The spawn list for any wave index: authored, then the patterns cycling with a tighter cadence. */
export function cannonWaveSpawns(
  state: Pick<CannonEncounterState, 'wave' | 'endless'>,
): readonly CannonSpawnDef[] {
  if (state.wave < CANNON_WAVES.length) return CANNON_WAVES[state.wave];
  const pattern = CANNON_WAVES[(state.wave - CANNON_WAVES.length) % CANNON_WAVES.length];
  const cadence = cannonEndlessCadence(cannonEndlessRound(state));
  return pattern.map((spawn) => ({ ...spawn, atTick: Math.round(spawn.atTick * cadence) }));
}

/** Flip a won encounter into endless play: keep the victory, restart the clock. */
export function beginCannonEndless(
  state: CannonEncounterState,
  medal: CannonResult['medal'],
  intermissionTicks: number,
): void {
  state.endless = true;
  state.victoryMedal = medal;
  state.wavesCleared = state.wavesCleared ?? CANNON_WAVES.length;
  state.phase = 'intermission';
  state.phaseUntilTick = state.tick + intermissionTicks;
  state.shots = [];
  state.fires = [];
}

export function cannonEndlessAtCap(state: Pick<CannonEncounterState, 'wave' | 'endless'>): boolean {
  return cannonEndlessRound(state) >= CANNON_ENDLESS.maxRounds;
}
