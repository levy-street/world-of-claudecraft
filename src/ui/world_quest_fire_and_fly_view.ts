// Fire and Fly's world quest text: the tracker lines and Master Gunner Alder's
// dialog, two sections in the order he offers them: the trials (the recruitment,
// each won one opening the next) and the missions (a recruit's only). Pure; the
// dialog controller paints the sections and sends each pick as a `{ courseId }` choice.

import { TURRET_MISSIONS } from '../sim/content/fire_and_fly_missions';
import { TURRET_SCENARIOS } from '../sim/content/fire_and_fly_scenarios';
import {
  type FireAndFlyRecruitment,
  fireAndFlyScenarioUnlocked,
} from '../sim/fire_and_fly_recruitment';
import type { TurretScenarioDef, WorldQuestProgress } from '../sim/types';
import type { ActivityChoice } from '../sim/world_quest_activity';
import { FIRE_AND_FLY_TRIAL_TEXT } from './fire_and_fly_trial_view';
import { formatNumber, type TranslationKey, t } from './i18n';

export interface FireAndFlyTrialChoice {
  difficulty: ActivityChoice;
  /** The scenario's board key, stable across languages (the button's data key). */
  key: string;
  label: string;
}

/** One of Alder's dialog sections: its start buttons, then what it still keeps locked. */
export interface FireAndFlyDialogSection {
  /** Stable across languages (the section's data key). */
  key: 'trials' | 'missions';
  title: string;
  choices: FireAndFlyTrialChoice[];
  /** Non-interactive lines after the buttons: each names what opens it. */
  locked: string[];
}

type Scenarios = readonly Readonly<TurretScenarioDef>[];

function scenarioText(scenario: Readonly<TurretScenarioDef>) {
  return Object.hasOwn(FIRE_AND_FLY_TRIAL_TEXT, scenario.boardKey)
    ? FIRE_AND_FLY_TRIAL_TEXT[scenario.boardKey]
    : null;
}

function choiceFor(
  scenario: Readonly<TurretScenarioDef>,
  practice: boolean,
  practiceKey: TranslationKey,
): FireAndFlyTrialChoice | null {
  const text = scenarioText(scenario);
  if (!text) return null;
  const values = {
    name: t(text.name),
    detail: t(text.pitch),
    count: formatNumber(scenario.waves.length, { maximumFractionDigits: 0 }),
  };
  return {
    difficulty: { courseId: scenario.id },
    key: scenario.boardKey,
    label: t(practice ? practiceKey : 'questUi.worldQuest.fireAndFly.start', values),
  };
}

/** One button per trial; after the day's win each one is a practice run. */
export function fireAndFlyTrialChoices(
  practice: boolean,
  scenarios: Scenarios = TURRET_SCENARIOS,
): FireAndFlyTrialChoice[] {
  const choices: FireAndFlyTrialChoice[] = [];
  for (const scenario of scenarios) {
    const choice = choiceFor(scenario, practice, 'questUi.worldQuest.fireAndFly.practice');
    if (choice) choices.push(choice);
  }
  return choices;
}

/**
 * Alder's two sections for a character's recruitment: the trials it may take (a
 * locked one names the trial that opens it), then the missions once recruited, or
 * a single line saying how to be recruited. After the day's win every button is a
 * practice run.
 */
export function fireAndFlyDialogSections(
  practice: boolean,
  recruitment: Readonly<FireAndFlyRecruitment>,
): FireAndFlyDialogSection[] {
  const trialSection: FireAndFlyDialogSection = {
    key: 'trials',
    title: t('questUi.worldQuest.fireAndFly.sections.trials'),
    choices: [],
    locked: [],
  };
  let previous: string | null = null;
  for (const scenario of TURRET_SCENARIOS) {
    const text = scenarioText(scenario);
    if (!text) continue;
    const name = t(text.name);
    if (fireAndFlyScenarioUnlocked(recruitment, scenario.id)) {
      const choice = choiceFor(scenario, practice, 'questUi.worldQuest.fireAndFly.practice');
      if (choice) trialSection.choices.push(choice);
    } else if (previous !== null) {
      trialSection.locked.push(t('questUi.worldQuest.fireAndFly.lockedTrial', { name, previous }));
    }
    previous = name;
  }
  const missionSection: FireAndFlyDialogSection = {
    key: 'missions',
    title: t('questUi.worldQuest.fireAndFly.sections.missions'),
    choices: [],
    locked: [],
  };
  if (recruitment.recruited) {
    for (const scenario of TURRET_MISSIONS) {
      if (!fireAndFlyScenarioUnlocked(recruitment, scenario.id)) continue;
      const choice = choiceFor(scenario, practice, 'questUi.worldQuest.fireAndFly.practiceMission');
      if (choice) missionSection.choices.push(choice);
    }
  } else if (previous !== null) {
    missionSection.locked.push(
      t('questUi.worldQuest.fireAndFly.missionsLocked', { name: previous }),
    );
  }
  return [trialSection, missionSection];
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
