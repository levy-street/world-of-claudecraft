// Pure-leaf pins for The King's Wrath (src/sim/nythraxis_kings_wrath.ts): the
// phase 3 tuning the guide quotes, the entry gate, and the cadence tightening.

import { describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_PHASE_THREE_HP,
  type NythraxisMajorsInFlight,
  nythraxisAnyMajorInFlight,
  nythraxisKingsWrathDamageBonus,
  nythraxisPhaseThreeReady,
  nythraxisWrathCadence,
  nythraxisWrathGraveEruptionEvery,
  nythraxisWrathGravefireEvery,
} from '../src/sim/nythraxis_kings_wrath';

const CALM: NythraxisMajorsInFlight = {
  deathlessCasting: false,
  deathlessStunned: false,
  courtSummoning: false,
  sigilUp: false,
  storming: false,
};

describe("Nythraxis The King's Wrath", () => {
  it('pins the player-facing tuning literally on both difficulties', () => {
    expect(NYTHRAXIS_PHASE_THREE_HP).toBe(0.3);
    expect([
      nythraxisKingsWrathDamageBonus('normal'),
      nythraxisKingsWrathDamageBonus('heroic'),
    ]).toEqual([0.2, 0.25]);
    expect([
      nythraxisWrathGraveEruptionEvery('normal'),
      nythraxisWrathGraveEruptionEvery('heroic'),
      nythraxisWrathGravefireEvery('normal'),
      nythraxisWrathGravefireEvery('heroic'),
    ]).toEqual([10, 8, 8, 6]);
  });

  it('enters at 30% only while no body-owning major is in flight', () => {
    expect(nythraxisPhaseThreeReady(0.31, CALM)).toBe(false);
    expect(nythraxisPhaseThreeReady(0.3, CALM)).toBe(true);
    expect(nythraxisPhaseThreeReady(0.05, CALM)).toBe(true);
    // Every major on its own holds the phase.
    for (const key of Object.keys(CALM) as (keyof NythraxisMajorsInFlight)[]) {
      const busy = { ...CALM, [key]: true };
      expect(nythraxisAnyMajorInFlight(busy), key).toBe(true);
      expect(nythraxisPhaseThreeReady(0.2, busy), key).toBe(false);
    }
    expect(nythraxisAnyMajorInFlight(CALM)).toBe(false);
  });

  it('tightens a cadence in Wrath and never loosens one', () => {
    expect(nythraxisWrathCadence(false, 15, 10)).toBe(15);
    expect(nythraxisWrathCadence(true, 15, 10)).toBe(10);
    // Heroic eruptions (12 s) still tighten to 10 s; heroic Gravefire (10 s)
    // tightens to 8 s; a cadence already tighter than Wrath keeps its own.
    expect(nythraxisWrathCadence(true, 12, 10)).toBe(10);
    expect(nythraxisWrathCadence(true, 10, 8)).toBe(8);
    expect(nythraxisWrathCadence(true, 6, 8)).toBe(6);
  });
});
