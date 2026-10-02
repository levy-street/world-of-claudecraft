// Fire and Fly's recruitment: the trials are taken in order (a won trial opens the
// next), and winning the last one makes the character a recruited gunner for good,
// which opens every mission. Only a run Master Gunner Alder seated counts (a paid
// run or a practice one, never a dev seat). The state is per character, saved in
// the world quest block, and mirrored to the owner's client for the dialog's locks.

import { TURRET_MISSIONS } from './content/fire_and_fly_missions';
import { TURRET_SCENARIOS } from './content/fire_and_fly_scenarios';

export interface FireAndFlyRecruitment {
  /** Trials won in order: the next one is TURRET_SCENARIOS[trialsWon]. */
  trialsWon: number;
  /** Set by the last trial's win and never cleared, even if trials are added later. */
  recruited: boolean;
}

export function freshFireAndFlyRecruitment(): FireAndFlyRecruitment {
  return { trialsWon: 0, recruited: false };
}

/**
 * A saved or wired record, or a fresh one for anything malformed: an old save without
 * one unlocks nothing, and the count never names more trials than exist.
 */
export function sanitizeFireAndFlyRecruitment(value: unknown): FireAndFlyRecruitment {
  if (!value || typeof value !== 'object') return freshFireAndFlyRecruitment();
  const row = value as Partial<Record<keyof FireAndFlyRecruitment, unknown>>;
  const trialsWon =
    typeof row.trialsWon === 'number' &&
    Number.isSafeInteger(row.trialsWon) &&
    row.trialsWon >= 0 &&
    row.trialsWon <= TURRET_SCENARIOS.length
      ? row.trialsWon
      : 0;
  // Every trial won is the recruitment, whatever the flag says.
  return { trialsWon, recruited: row.recruited === true || trialsWon >= TURRET_SCENARIOS.length };
}

/** The save's form: absent while nothing is won, so an untouched save keeps its shape. */
export function savedFireAndFlyRecruitment(
  state: FireAndFlyRecruitment,
): FireAndFlyRecruitment | undefined {
  const clean = sanitizeFireAndFlyRecruitment(state);
  return clean.trialsWon > 0 || clean.recruited ? clean : undefined;
}

/** Whether the character may be seated for `scenarioId`; false for an unknown one. */
export function fireAndFlyScenarioUnlocked(
  state: FireAndFlyRecruitment,
  scenarioId: string,
): boolean {
  const trial = TURRET_SCENARIOS.findIndex((scenario) => scenario.id === scenarioId);
  if (trial >= 0) return state.recruited || trial <= state.trialsWon;
  return state.recruited && TURRET_MISSIONS.some((mission) => mission.id === scenarioId);
}

/** The trial the recruitment asks for next; null once recruited. */
export function fireAndFlyNextTrialId(state: FireAndFlyRecruitment): string | null {
  if (state.recruited) return null;
  return TURRET_SCENARIOS[Math.min(state.trialsWon, TURRET_SCENARIOS.length - 1)]?.id ?? null;
}

/** Counts a won instructor seat of `scenarioId`; true when the recruitment moved. */
export function recordFireAndFlyRecruitmentWin(
  state: FireAndFlyRecruitment,
  scenarioId: string,
): boolean {
  const trial = TURRET_SCENARIOS.findIndex((scenario) => scenario.id === scenarioId);
  if (trial < 0 || trial + 1 <= state.trialsWon) return false;
  state.trialsWon = trial + 1;
  if (state.trialsWon >= TURRET_SCENARIOS.length) state.recruited = true;
  return true;
}
