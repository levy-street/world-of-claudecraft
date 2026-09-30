// Fire and Fly's world quest text: the tracker lines and the instructor's trial
// buttons, one per scenario in the order he offers them. Pure; the dialog
// controller paints the buttons and sends each pick as a `{ courseId }` choice.

import { TURRET_SCENARIOS } from '../sim/content/fire_and_fly_scenarios';
import type { TurretScenarioDef, WorldQuestProgress } from '../sim/types';
import type { ActivityChoice } from '../sim/world_quest_activity';
import { formatNumber, type TranslationKey, t } from './i18n';

const TRIAL_TEXT: Readonly<Record<string, { name: TranslationKey; pitch: TranslationKey }>> = {
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

export interface FireAndFlyTrialChoice {
  difficulty: ActivityChoice;
  /** The scenario's board key, stable across languages (the button's data key). */
  key: string;
  label: string;
}

/** One button per trial; after the day's win each one is a practice run. */
export function fireAndFlyTrialChoices(
  practice: boolean,
  scenarios: readonly Readonly<TurretScenarioDef>[] = TURRET_SCENARIOS,
): FireAndFlyTrialChoice[] {
  const choices: FireAndFlyTrialChoice[] = [];
  for (const scenario of scenarios) {
    const text = Object.hasOwn(TRIAL_TEXT, scenario.boardKey)
      ? TRIAL_TEXT[scenario.boardKey]
      : null;
    if (!text) continue;
    const values = {
      name: t(text.name),
      detail: t(text.pitch),
      count: formatNumber(scenario.waves.length, { maximumFractionDigits: 0 }),
    };
    choices.push({
      difficulty: { courseId: scenario.id },
      key: scenario.boardKey,
      label: t(
        practice ? 'questUi.worldQuest.fireAndFly.practice' : 'questUi.worldQuest.fireAndFly.start',
        values,
      ),
    });
  }
  return choices;
}

/** The tracker's instruction line while the player is at the gate. */
export function fireAndFlyInstructionLines(progress: Pick<WorldQuestProgress, 'state'>): string[] {
  return [
    t(
      progress.state === 'completed'
        ? 'questUi.worldQuest.fireAndFly.complete'
        : 'questUi.worldQuest.fireAndFly.ready',
    ),
  ];
}
