// The name of the Fire and Fly trial or mission a seat plays, read off its plan's
// scenario id: the arena's minimap label, the strip's accessible name and the result
// card's kicker show it while seated. Pure; the same plan reaches the offline view and
// the online `turp` mirror.

import { FIRE_AND_FLY_DUNGEON_ID } from '../sim/content/fire_and_fly_arena';
import { TURRET_MISSIONS } from '../sim/content/fire_and_fly_missions';
import { FIRE_AND_FLY_SCENARIOS } from '../sim/content/fire_and_fly_scenarios';
import type { TurretScenarioDef } from '../sim/types';
import type { TurretSessionView } from '../world_api/vehicles';
import { dungeonDisplayName } from './entity_i18n';
import { type TranslationKey, t } from './i18n';

/** Each trial's and mission's name and the instructor's pitch for it, by scenario board key: the one table. */
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
  pack: {
    name: 'questUi.worldQuest.fireAndFly.scenarios.pack',
    pitch: 'questUi.worldQuest.fireAndFly.pitch.pack',
  },
  giants: {
    name: 'questUi.worldQuest.fireAndFly.scenarios.giants',
    pitch: 'questUi.worldQuest.fireAndFly.pitch.giants',
  },
  deluge: {
    name: 'questUi.worldQuest.fireAndFly.scenarios.deluge',
    pitch: 'questUi.worldQuest.fireAndFly.pitch.deluge',
  },
  brittle: {
    name: 'questUi.worldQuest.fireAndFly.scenarios.brittle',
    pitch: 'questUi.worldQuest.fireAndFly.pitch.brittle',
  },
  powder: {
    name: 'questUi.worldQuest.fireAndFly.scenarios.powder',
    pitch: 'questUi.worldQuest.fireAndFly.pitch.powder',
  },
};

/** The trial's or mission's name for a plan's scenario id; null for a scenario without one. */
export function fireAndFlyTrialName(
  scenarioId: string,
  scenarios: readonly Readonly<TurretScenarioDef>[] = FIRE_AND_FLY_SCENARIOS,
): string | null {
  for (const scenario of scenarios) {
    if (scenario.id !== scenarioId) continue;
    return Object.hasOwn(FIRE_AND_FLY_TRIAL_TEXT, scenario.boardKey)
      ? t(FIRE_AND_FLY_TRIAL_TEXT[scenario.boardKey].name)
      : null;
  }
  return null;
}

/** Whether a plan's scenario is one of the recruits' missions rather than a trial. */
export function isFireAndFlyMission(scenarioId: string): boolean {
  return TURRET_MISSIONS.some((mission) => mission.id === scenarioId);
}

/**
 * The minimap's zone label inside an instance: the run's name while a seat in the
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
