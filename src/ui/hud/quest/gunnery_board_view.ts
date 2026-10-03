// Pure view core for Master Gunner Alder's Gunnery Board: the trials and missions
// on its left (each with its best medal, a dash, or a padlock), the picked one's
// brief and facts on its right, and the one action under them. DOM-free; the
// window (gunnery_board_window.ts) paints exactly what this shapes. The facts are
// read off the scenario tables, so a retuned arsenal, wave count or gold bar shows
// here without an edit; the sim's lock refusal stays the authority on a start.

import { TURRET_MISSIONS } from '../../../sim/content/fire_and_fly_missions';
import { TURRET_SCENARIOS } from '../../../sim/content/fire_and_fly_scenarios';
import { FIRE_AND_FLY_NPC_DEF } from '../../../sim/content/world_quest_fire_and_fly';
import {
  FIRE_AND_FLY_MASTERY_MAX_STARS,
  type PersonalFireAndFlyRecords,
} from '../../../sim/fire_and_fly_personal_records';
import {
  type FireAndFlyRecruitment,
  fireAndFlyScenarioUnlocked,
} from '../../../sim/fire_and_fly_recruitment';
import { fireAndFlyScoreboardId } from '../../../sim/fire_and_fly_scoreboards';
import type { TurretArsenalDef, TurretScenarioDef } from '../../../sim/types';
import { WORLD_QUEST_MEDAL_RANK, type WorldQuestMedal } from '../../../sim/world_quest_scoreboards';
import { FIRE_AND_FLY_TRIAL_TEXT, fireAndFlyTrialName } from '../../fire_and_fly_trial_view';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { rovingTarget } from '../../roving_index';
import { worldQuestMedalArt } from '../../world_quest_leaderboard_view';

export type GunneryBoardGroup = 'trials' | 'missions';
/** A trial the recruitment counts as won but no record names (a retuned trial
 *  starts a fresh board) is 'won': won, its medal unknown. */
export type GunneryRowState = 'medal' | 'won' | 'open' | 'locked';

/** A character's best run on one scenario's all-time ladder. */
export interface GunneryBest {
  medal: WorldQuestMedal;
  points: number;
}

/** Best runs by scenario id; a scenario without one has no entry. */
export type GunneryBests = ReadonlyMap<string, GunneryBest>;

export interface GunneryBoardInput {
  recruitment: Readonly<FireAndFlyRecruitment>;
  /** Today's row is completed: every run from the board is practice. */
  rewardCollected: boolean;
  bests: GunneryBests;
  /** The player's pick; null or unknown falls back to the default selection. */
  selectedId: string | null;
  speakerName: string;
  speakerTitle: string;
  /** Alder's greeting to a newcomer; a recruit in the trials or a recruited gunner gets his own. */
  greeting: string;
}

export interface GunneryBoardRow {
  scenarioId: string;
  key: string;
  group: GunneryBoardGroup;
  name: string;
  state: GunneryRowState;
  medal: WorldQuestMedal | null;
  medalArt: string | null;
  /** The row's state in words: the medal's name, "won", "not won yet" or "locked". */
  stateText: string;
  selected: boolean;
}

export interface GunneryBoardSection {
  group: GunneryBoardGroup;
  title: string;
  rows: GunneryBoardRow[];
}

export interface GunneryArsenalChip {
  weapon: keyof TurretArsenalDef;
  text: string;
  empty: boolean;
}

export interface GunneryBoardDetail {
  scenarioId: string;
  group: GunneryBoardGroup;
  kicker: string;
  name: string;
  brief: string;
  arsenalLabel: string;
  arsenal: GunneryArsenalChip[];
  goldLabel: string;
  goldText: string;
  wavesLabel: string;
  wavesText: string;
  bestLabel: string;
  bestText: string;
  bestMedal: WorldQuestMedal | null;
  bestMedalArt: string | null;
  rewardLabel: string;
  rewardText: string;
  rewardCollected: boolean;
  /** What opens a locked scenario; null when it is open. */
  lockedReason: string | null;
  actionLabel: string;
  actionAria: string;
  actionDisabled: boolean;
}

export interface GunneryBoardView {
  title: string;
  speakerName: string;
  speakerTitle: string;
  greeting: string;
  closeLabel: string;
  listLabel: string;
  recruitmentText: string;
  /** The Gunner's Mastery line, once recruited; null before. */
  masteryText: string | null;
  sections: GunneryBoardSection[];
  detail: GunneryBoardDetail;
  selectedId: string;
}

type Scenario = Readonly<TurretScenarioDef>;

/** The limited weapons in the order the seat's sockets show them, with their names. */
const WEAPONS: readonly { weapon: keyof TurretArsenalDef; name: TranslationKey }[] = [
  { weapon: 'shockwave', name: 'hudChrome.turret.shockwave' },
  { weapon: 'fragmentation', name: 'hudChrome.turret.frag' },
];

const MEDAL_NAME: Record<WorldQuestMedal, TranslationKey> = {
  gold: 'hudChrome.turret.medalGold',
  silver: 'hudChrome.turret.medalSilver',
  bronze: 'hudChrome.turret.medalBronze',
};

const STATE_TEXT: Record<Exclude<GunneryRowState, 'medal'>, TranslationKey> = {
  won: 'hudChrome.gunneryBoard.won',
  open: 'hudChrome.gunneryBoard.notWon',
  locked: 'hudChrome.gunneryBoard.locked',
};

/** Which of Alder's greetings the recruitment calls for. */
export type GunneryGreetingStage = 'welcome' | 'trials' | 'recruited';

const GREETING_TEXT: Record<Exclude<GunneryGreetingStage, 'welcome'>, TranslationKey> = {
  trials: 'questUi.worldQuest.fireAndFly.greeting.trials',
  recruited: 'questUi.worldQuest.fireAndFly.greeting.recruited',
};

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/** Every scenario on the board, in the instructor's order: the trials, then the missions. */
export function gunneryBoardScenarios(): { group: GunneryBoardGroup; scenario: Scenario }[] {
  return [
    ...TURRET_SCENARIOS.map((scenario) => ({ group: 'trials' as const, scenario })),
    ...TURRET_MISSIONS.map((scenario) => ({ group: 'missions' as const, scenario })),
  ];
}

/** Each scenario's best: the character's all-time record on its board. */
export function gunneryBestsFromRecords(
  records: Readonly<PersonalFireAndFlyRecords>,
): Map<string, GunneryBest> {
  const bests = new Map<string, GunneryBest>();
  for (const { scenario } of gunneryBoardScenarios()) {
    const board = fireAndFlyScoreboardId(scenario.id, 'lifetime');
    const record = board && Object.hasOwn(records, board) ? records[board] : undefined;
    if (record) bests.set(scenario.id, { medal: record.medal, points: record.metric });
  }
  return bests;
}

/** The brief's key for a scenario's board key; null for a scenario without board text. */
export function gunneryBriefKey(boardKey: string): TranslationKey | null {
  return Object.hasOwn(FIRE_AND_FLY_TRIAL_TEXT, boardKey)
    ? FIRE_AND_FLY_TRIAL_TEXT[boardKey].brief
    : null;
}

export function gunneryGreetingStage(
  recruitment: Readonly<FireAndFlyRecruitment>,
): GunneryGreetingStage {
  if (recruitment.recruited) return 'recruited';
  return recruitment.trialsWon > 0 ? 'trials' : 'welcome';
}

/** The greeting the board shows: `welcome` until a trial is won. */
export function gunneryGreeting(
  recruitment: Readonly<FireAndFlyRecruitment>,
  welcome: string,
): string {
  const stage = gunneryGreetingStage(recruitment);
  return stage === 'welcome' ? welcome : t(GREETING_TEXT[stage]);
}

/** The greeting an NPC's dialog shows: Alder's follows his stage, any other NPC keeps its own. */
export function npcGreeting(
  templateId: string,
  world: { readonly fireAndFlyRecruitment: Readonly<FireAndFlyRecruitment> },
  greeting: string,
): string {
  return templateId === FIRE_AND_FLY_NPC_DEF.id
    ? gunneryGreeting(world.fireAndFlyRecruitment, greeting)
    : greeting;
}

/**
 * The voice clip an NPC greets with on open: Alder speaks the line of his greeting
 * stage (the welcome is his NPC greeting's own clip), every other NPC its greeting.
 */
export function greetingVoiceKey(
  templateId: string,
  world: { readonly fireAndFlyRecruitment: Readonly<FireAndFlyRecruitment> },
): string {
  const key = `greeting__${templateId}`;
  if (templateId !== FIRE_AND_FLY_NPC_DEF.id) return key;
  const stage = gunneryGreetingStage(world.fireAndFlyRecruitment);
  return stage === 'welcome' ? key : `${key}__${stage}`;
}

/** Whether the recruitment counts `scenarioId` as a won trial. */
function trialWon(recruitment: Readonly<FireAndFlyRecruitment>, scenarioId: string): boolean {
  const index = TURRET_SCENARIOS.findIndex((scenario) => scenario.id === scenarioId);
  return index >= 0 && index < recruitment.trialsWon;
}

/** The Gunner's Mastery stars from the missions' bests: gold 3, silver 2, bronze 1. */
export function gunneryMasteryStars(bests: GunneryBests): number {
  let stars = 0;
  for (const mission of TURRET_MISSIONS) {
    const best = bests.get(mission.id);
    if (best) stars += WORLD_QUEST_MEDAL_RANK[best.medal];
  }
  return stars;
}

/**
 * The scenario the board opens on: the next one to win, the first open scenario
 * without a medal, then the first without gold.
 */
export function gunneryBoardDefaultSelection(
  recruitment: Readonly<FireAndFlyRecruitment>,
  bests: GunneryBests,
): string {
  const all = gunneryBoardScenarios();
  const open = all.filter(({ scenario }) => fireAndFlyScenarioUnlocked(recruitment, scenario.id));
  const unwon = open.find(
    ({ scenario }) => !bests.has(scenario.id) && !trialWon(recruitment, scenario.id),
  );
  if (unwon) return unwon.scenario.id;
  const notGold = open.find(({ scenario }) => bests.get(scenario.id)?.medal !== 'gold');
  return (notGold ?? open[0] ?? all[0]).scenario.id;
}

/** The selection an arrow, Home or End key moves to; null for any other key. */
export function gunneryBoardStep(currentId: string, key: string): string | null {
  const all = gunneryBoardScenarios();
  const index = all.findIndex(({ scenario }) => scenario.id === currentId);
  const next = rovingTarget(key, Math.max(0, index), all.length, 'both');
  return next === null ? null : all[next].scenario.id;
}

function lockedReason(
  group: GunneryBoardGroup,
  index: number,
  recruitment: Readonly<FireAndFlyRecruitment>,
  scenario: Scenario,
): string | null {
  if (fireAndFlyScenarioUnlocked(recruitment, scenario.id)) return null;
  if (group === 'trials') {
    const previous = TURRET_SCENARIOS[index - 1];
    const name = previous ? fireAndFlyTrialName(previous.id) : null;
    return name ? t('hudChrome.gunneryBoard.lockedTrial', { previous: name }) : null;
  }
  const last = TURRET_SCENARIOS[TURRET_SCENARIOS.length - 1];
  const name = last ? fireAndFlyTrialName(last.id) : null;
  return name ? t('hudChrome.gunneryBoard.lockedMission', { name }) : null;
}

function rowFor(
  group: GunneryBoardGroup,
  scenario: Scenario,
  input: GunneryBoardInput,
  selectedId: string,
): GunneryBoardRow | null {
  const name = fireAndFlyTrialName(scenario.id);
  if (name === null) return null;
  const unlocked = fireAndFlyScenarioUnlocked(input.recruitment, scenario.id);
  const best = unlocked ? input.bests.get(scenario.id) : undefined;
  const unmedalled: Exclude<GunneryRowState, 'medal'> = !unlocked
    ? 'locked'
    : trialWon(input.recruitment, scenario.id)
      ? 'won'
      : 'open';
  return {
    scenarioId: scenario.id,
    key: scenario.boardKey,
    group,
    name,
    state: best ? 'medal' : unmedalled,
    medal: best?.medal ?? null,
    medalArt: best ? worldQuestMedalArt(best.medal) : null,
    stateText: best ? t(MEDAL_NAME[best.medal]) : t(STATE_TEXT[unmedalled]),
    selected: scenario.id === selectedId,
  };
}

function detailFor(
  group: GunneryBoardGroup,
  index: number,
  scenario: Scenario,
  input: GunneryBoardInput,
): GunneryBoardDetail {
  const name = fireAndFlyTrialName(scenario.id) ?? scenario.boardKey;
  const briefKey = gunneryBriefKey(scenario.boardKey);
  const reason = lockedReason(group, index, input.recruitment, scenario);
  const best = reason === null ? input.bests.get(scenario.id) : undefined;
  const bestText = best
    ? t('hudChrome.gunneryBoard.bestRun', {
        medal: t(MEDAL_NAME[best.medal]),
        points: whole(best.points),
      })
    : t('hudChrome.gunneryBoard.notPlayed');
  const actionLabel = t(
    input.rewardCollected
      ? 'hudChrome.gunneryBoard.practice'
      : group === 'trials'
        ? 'hudChrome.gunneryBoard.takeTrial'
        : 'hudChrome.gunneryBoard.takeMission',
  );
  return {
    scenarioId: scenario.id,
    group,
    kicker: t(
      group === 'trials'
        ? 'hudChrome.gunneryBoard.trialKicker'
        : 'hudChrome.gunneryBoard.missionKicker',
    ),
    name,
    brief: briefKey ? t(briefKey) : '',
    arsenalLabel: t('hudChrome.gunneryBoard.arsenal'),
    arsenal: WEAPONS.map(({ weapon, name: weaponName }) => {
      const count = scenario.arsenal?.[weapon] ?? 0;
      return {
        weapon,
        text: t('hudChrome.gunneryBoard.charges', { weapon: t(weaponName), count: whole(count) }),
        empty: count <= 0,
      };
    }),
    goldLabel: t('hudChrome.gunneryBoard.gold'),
    goldText: t('hudChrome.gunneryBoard.goldBar', {
      percent: formatNumber(scenario.medals.gold.minIntegrityShare, {
        style: 'percent',
        maximumFractionDigits: 0,
      }),
    }),
    wavesLabel: t('hudChrome.gunneryBoard.waves'),
    wavesText: whole(scenario.waves.length),
    bestLabel: t('hudChrome.gunneryBoard.best'),
    bestText,
    bestMedal: best?.medal ?? null,
    bestMedalArt: best ? worldQuestMedalArt(best.medal) : null,
    rewardLabel: t('hudChrome.gunneryBoard.reward'),
    rewardText: t(
      input.rewardCollected
        ? 'hudChrome.gunneryBoard.rewardCollected'
        : 'hudChrome.gunneryBoard.rewardAvailable',
    ),
    rewardCollected: input.rewardCollected,
    lockedReason: reason,
    actionLabel,
    actionAria: t('hudChrome.gunneryBoard.actionAria', { action: actionLabel, name }),
    actionDisabled: reason !== null,
  };
}

export function buildGunneryBoardView(input: GunneryBoardInput): GunneryBoardView {
  const all = gunneryBoardScenarios();
  const known = input.selectedId
    ? all.some(({ scenario }) => scenario.id === input.selectedId)
    : false;
  const selectedId =
    known && input.selectedId
      ? input.selectedId
      : gunneryBoardDefaultSelection(input.recruitment, input.bests);
  const sections: GunneryBoardSection[] = (['trials', 'missions'] as const).map((group) => ({
    group,
    title: t(
      group === 'trials' ? 'hudChrome.gunneryBoard.trials' : 'hudChrome.gunneryBoard.missions',
    ),
    rows: all.flatMap((entry) => {
      if (entry.group !== group) return [];
      const row = rowFor(group, entry.scenario, input, selectedId);
      return row ? [row] : [];
    }),
  }));
  const picked = all.find(({ scenario }) => scenario.id === selectedId) ?? all[0];
  const index = (picked.group === 'trials' ? TURRET_SCENARIOS : TURRET_MISSIONS).indexOf(
    picked.scenario,
  );
  const recruited = input.recruitment.recruited;
  return {
    title: t('hudChrome.gunneryBoard.title'),
    speakerName: input.speakerName,
    speakerTitle: input.speakerTitle,
    greeting: gunneryGreeting(input.recruitment, input.greeting),
    closeLabel: t('questUi.dialog.close'),
    listLabel: t('hudChrome.gunneryBoard.listLabel'),
    recruitmentText: recruited
      ? t('hudChrome.gunneryBoard.recruited')
      : t('hudChrome.gunneryBoard.recruitProgress', {
          won: whole(Math.min(input.recruitment.trialsWon, TURRET_SCENARIOS.length)),
          total: whole(TURRET_SCENARIOS.length),
        }),
    masteryText: recruited
      ? t('hudChrome.gunneryBoard.mastery', {
          stars: whole(gunneryMasteryStars(input.bests)),
          max: whole(FIRE_AND_FLY_MASTERY_MAX_STARS),
        })
      : null,
    sections,
    detail: detailFor(picked.group, index, picked.scenario, input),
    selectedId: picked.scenario.id,
  };
}
