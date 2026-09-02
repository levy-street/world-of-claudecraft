// Pure, host-agnostic core for the practice DPS tracker: the compact readout
// that appears while a player works a training dummy, so a rotation or a build
// can be measured and compared without opening the full Damage Meters window.
//
// It reads the SAME encounter ledger the Damage Meters keep (src/ui/meters.ts,
// MeterData.current / history): an encounter whose threat-subject mob is a
// practice dummy (MobTemplate.dummy, the one flag the sim reads to hold a
// target inert) is a "practice run". No second combat ledger, no second event
// feed: a run's numbers are exactly the meters' numbers for the LOCAL player,
// so the two surfaces can never disagree about a rotation's output.
//
// Why runs, plural: the point of a training dummy is to compare. A player
// respecs, swaps a trinket, or changes a rotation, hits the dummy again, and
// wants the previous number still on screen next to the new one. The model
// keeps the most recent finished runs (newest first) beside the live one and
// marks the best, which is the whole comparison in one glance.
//
// Duration caveat, stated once: a LIVE encounter's duration is "now minus first
// hit" and keeps ticking through the meters' idle window (ENCOUNTER_END_SECONDS)
// before it closes, so the live DPS dips for a few seconds after the last hit.
// The FINISHED run's duration ends at the last activity (MeterData.endEncounter),
// so every number in `previous` is the honest one. No DOM, no i18n, no clock:
// the thin controller (practice_dps_controller.ts) localizes and formats.

import { MOBS } from '../../../sim/data';

/** How many finished runs the readout keeps beside the live one. */
export const PRACTICE_RUN_HISTORY = 5;

/** The slice of a meters Encounter the practice model reads. */
export interface PracticeEncounter {
  /** seconds of combat (live: now - first hit; finished: last hit - first hit) */
  duration: number;
  /** template id of the threat-subject mob (the biggest mob hit this segment) */
  mainMobTemplateId: string | null;
  tallies: ReadonlyMap<number, { dmg: number }>;
}

export interface PracticeRun {
  /** template id of the dummy this run was measured on */
  dummyTemplateId: string;
  /** the local player's total damage on this run (pets fold into the owner) */
  total: number;
  /** seconds, never below 1 (the meters clamp it the same way) */
  duration: number;
  dps: number;
}

export interface PracticeDpsModel {
  /** template id of the dummy the player is standing at (targeted), or null */
  targetDummyId: string | null;
  /** the run in progress, or null between runs */
  live: PracticeRun | null;
  /** finished runs, newest first, capped at PRACTICE_RUN_HISTORY */
  previous: PracticeRun[];
  /** the highest dps across live + previous, 0 when there is none */
  bestDps: number;
}

export interface PracticeDpsInput {
  current: PracticeEncounter | null;
  history: readonly PracticeEncounter[];
  /** the local player's entity id (the meters tally key) */
  playerId: number;
  /** template id of the player's current target, or null */
  targetTemplateId: string | null;
}

/** True for every inert practice target (the Highwatch row, the hub dummy, the
 *  proving-shore post): the single `dummy` template flag the sim itself reads. */
export function isPracticeDummy(templateId: string | null | undefined): boolean {
  return templateId !== null && templateId !== undefined && MOBS[templateId]?.dummy === true;
}

/** The local player's run on one encounter, or null when the encounter was not
 *  against a dummy or the player never landed a hit on it. */
export function practiceRunOf(enc: PracticeEncounter, playerId: number): PracticeRun | null {
  if (!isPracticeDummy(enc.mainMobTemplateId)) return null;
  const total = enc.tallies.get(playerId)?.dmg ?? 0;
  if (total <= 0) return null;
  const duration = Math.max(1, enc.duration);
  return {
    dummyTemplateId: enc.mainMobTemplateId as string,
    total,
    duration,
    dps: total / duration,
  };
}

/**
 * The readout's model, or null when it has nothing to say: no live run and the
 * player is not looking at a dummy. Standing at a dummy with no run yet still
 * yields a model (an empty one) so the controller can show the "hit it to
 * start" prompt; finished runs stay listed while the player keeps the dummy
 * targeted, which is exactly when a comparison is being made.
 */
export function practiceDpsModel(input: PracticeDpsInput): PracticeDpsModel | null {
  const live = input.current ? practiceRunOf(input.current, input.playerId) : null;
  const targetDummyId = isPracticeDummy(input.targetTemplateId) ? input.targetTemplateId : null;
  if (!live && targetDummyId === null) return null;
  const previous: PracticeRun[] = [];
  for (const enc of input.history) {
    const run = practiceRunOf(enc, input.playerId);
    if (run) previous.push(run);
    if (previous.length >= PRACTICE_RUN_HISTORY) break;
  }
  let bestDps = live?.dps ?? 0;
  for (const run of previous) if (run.dps > bestDps) bestDps = run.dps;
  return { targetDummyId, live, previous, bestDps };
}
