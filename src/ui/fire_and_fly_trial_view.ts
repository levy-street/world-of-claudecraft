// The name of the Fire and Fly trial a seat plays, read off its plan's scenario id:
// the arena's minimap label and the result card's kicker show it while seated.
// Pure; the same plan reaches the offline view and the online `turp` mirror.

import { FIRE_AND_FLY_DUNGEON_ID } from '../sim/content/fire_and_fly_arena';
import { TURRET_SCENARIOS } from '../sim/content/fire_and_fly_scenarios';
import type { TurretScenarioDef } from '../sim/types';
import type { TurretSessionView } from '../world_api/vehicles';
import { dungeonDisplayName } from './entity_i18n';
import { type TranslationKey, t } from './i18n';

/** Each trial's name and the instructor's pitch for it, by scenario board key: the one table. */
export const FIRE_AND_FLY_TRIAL_TEXT: Readonly<
  Record<string, { name: TranslationKey; pitch: TranslationKey }>
> = {
  introduction: {
    name: 'questUi.worldQuest.fireAndFly.scenarios.introduction',
    pitch: 'questUi.worldQuest.fireAndFly.pitch.introduction',
  },
  standard: {
    name: 'questUi.worldQuest.fireAndFly.scenarios.standard',
    pitch: 'questUi.worldQuest.fireAndFly.pitch.standard',
  },
  hard: {
    name: 'questUi.worldQuest.fireAndFly.scenarios.hard',
    pitch: 'questUi.worldQuest.fireAndFly.pitch.hard',
  },
};

/** The trial's name for a plan's scenario id; null for a scenario without one. */
export function fireAndFlyTrialName(
  scenarioId: string,
  scenarios: readonly Readonly<TurretScenarioDef>[] = TURRET_SCENARIOS,
): string | null {
  for (const scenario of scenarios) {
    if (scenario.id !== scenarioId) continue;
    return Object.hasOwn(FIRE_AND_FLY_TRIAL_TEXT, scenario.boardKey)
      ? t(FIRE_AND_FLY_TRIAL_TEXT[scenario.boardKey].name)
      : null;
  }
  return null;
}

/**
 * The minimap's zone label inside an instance: the trial's name while a seat in the
 * Fire and Fly arena is up, else the instance's own name.
 */
export function interiorMinimapLabel(
  dungeonId: string,
  session: Pick<TurretSessionView, 'defense'> | null | undefined,
): string {
  if (dungeonId === FIRE_AND_FLY_DUNGEON_ID && session) {
    const trial = fireAndFlyTrialName(session.defense.plan.scenarioId);
    if (trial !== null) return trial;
  }
  return dungeonDisplayName(dungeonId);
}
