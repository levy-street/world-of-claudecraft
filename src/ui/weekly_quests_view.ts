// Pure view core for the weekly emissary's window: the four offer cards, the
// one the character holds (or has finished), the reward line, the reset
// countdown, and the confirm-dialog model. DOM-free; the painter
// (weekly_quests_window.ts) renders exactly what this shapes.
import { HEROIC_MARK_ITEM_ID } from '../sim/content/dungeon_difficulty';
import {
  WEEKLY_EMISSARY_NPC_DEF,
  WEEKLY_QUEST_REWARD,
  WEEKLY_QUESTS,
  type WeeklyQuestDef,
  type WeeklyQuestKind,
} from '../sim/content/weekly_quests';
import { ITEMS } from '../sim/data';
import { EMISSARY_CACHE_MARKS } from '../sim/emissary_cache';
import { FACTION_IDS, type FactionId, maxStandingForLevel } from '../sim/factions';
import type { WeeklyQuestProgress } from '../sim/types';
import { weeklyQuestRewardCopper } from '../sim/weekly_quests';
import { npcDisplayName, npcDisplayTitle } from './entity_display_core';
import { itemDisplayName } from './entity_i18n';
import { formatDuration, formatMoney, formatNumber, t } from './i18n';

export type WeeklyQuestCardState = 'open' | 'active' | 'completed' | 'locked';

export interface WeeklyQuestCardView {
  id: string;
  kind: WeeklyQuestKind;
  /** The card header (the category) and the emissary's charge wording. */
  category: string;
  lore: string;
  goal: string;
  difficulty: string;
  art: string;
  medal: string;
  state: WeeklyQuestCardState;
  /** The button label: pick, the live tally, done, or locked for the week. */
  buttonLabel: string;
  count: number;
  required: number;
}

/** One faction the finished charge's commendation can go to. */
export interface WeeklyCommendationOption {
  factionId: FactionId;
  label: string;
  /** No standing headroom at this level: the sim would refuse, so the button is off. */
  capped: boolean;
  /** This is the faction the week's commendation already went to. */
  claimed: boolean;
}

export interface WeeklyCommendationView {
  heading: string;
  note: string;
  options: WeeklyCommendationOption[];
  /** Set once claimed; every option is then inert. */
  claimedText: string | null;
}

export interface WeeklyQuestsView {
  title: string;
  subtitle: string;
  resetText: string;
  cards: WeeklyQuestCardView[];
  footer: string;
  /** The commendation choice, shown only while the week's charge is finished. */
  commendation: WeeklyCommendationView | null;
  emissaryName: string;
  emissaryTitle: string;
  emissaryPortrait: string;
}

export interface WeeklyQuestDialogView {
  questId: string;
  heading: string;
  lore: string;
  goalLabel: string;
  goalCount: string;
  rewardMoney: string;
  /** The commendation line: standing with a faction of the owner's choice. */
  rewardStanding: string;
  rewardItem: string;
  rewardItemIcon: string;
  rewardItemDesc: string;
  note: string;
  art: string;
  accept: string;
  decline: string;
}

export const WEEKLY_ART_DIR = 'ui/weekly';

type WeeklyWorld = {
  weeklyQuest: WeeklyQuestProgress | null;
  weeklyQuestResetAtMs: number;
  /** Standing per faction and the level, for the commendation's cap check. */
  factions?: Readonly<Partial<Record<FactionId, number>>>;
  player?: { level: number };
};

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

function factionLabel(factionId: FactionId): string {
  return t(`hudChrome.reputation.faction.${factionId}`);
}

/** The commendation choice for a finished charge: one option per faction, a
 *  capped faction inert (the sim would refuse it), and the claimed one
 *  marked once the choice is made. Null while the charge is not finished. */
export function buildWeeklyCommendation(world: WeeklyWorld): WeeklyCommendationView | null {
  const held = world.weeklyQuest;
  if (!held || held.state !== 'completed') return null;
  const cap = maxStandingForLevel(world.player?.level ?? 1);
  const claimed = held.commended ?? null;
  const options = FACTION_IDS.map(
    (factionId): WeeklyCommendationOption => ({
      factionId,
      label: factionLabel(factionId),
      capped: (world.factions?.[factionId] ?? 0) >= cap,
      claimed: claimed === factionId,
    }),
  );
  return {
    heading: t('hudChrome.weekly.commendHeading'),
    note: t('hudChrome.weekly.commendNote', {
      amount: whole(WEEKLY_QUEST_REWARD.commendationStanding),
    }),
    options,
    claimedText:
      claimed === null
        ? null
        : t('hudChrome.weekly.commendClaimed', { faction: factionLabel(claimed as FactionId) }),
  };
}

function categoryText(kind: WeeklyQuestKind): string {
  return t(`hudChrome.weekly.kinds.${kind}.category`);
}

function cardState(quest: WeeklyQuestDef, held: WeeklyQuestProgress | null): WeeklyQuestCardState {
  if (!held) return 'open';
  if (held.questId !== quest.id) return 'locked';
  return held.state === 'completed' ? 'completed' : 'active';
}

function buttonLabel(state: WeeklyQuestCardState, count: number, required: number): string {
  const tally = {
    count: formatNumber(count, { maximumFractionDigits: 0 }),
    required: formatNumber(required, { maximumFractionDigits: 0 }),
  };
  switch (state) {
    case 'active':
      return t('hudChrome.weekly.inProgress', tally);
    case 'completed':
      return t('hudChrome.weekly.completed');
    case 'locked':
      return t('hudChrome.weekly.lockedThisWeek');
    default:
      return t('hudChrome.weekly.choose');
  }
}

/** Seconds until the reset as the player reads it; never negative. */
export function weeklyResetText(resetAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((resetAtMs - nowMs) / 1000));
  return t('hudChrome.weekly.resetsIn', { time: formatDuration(seconds) });
}

export function buildWeeklyQuestsView(world: WeeklyWorld, nowMs: number): WeeklyQuestsView {
  const held = world.weeklyQuest;
  const cards = WEEKLY_QUESTS.map((quest): WeeklyQuestCardView => {
    const state = cardState(quest, held);
    const count = state === 'open' || state === 'locked' ? 0 : (held?.count ?? 0);
    return {
      id: quest.id,
      kind: quest.kind,
      category: categoryText(quest.kind),
      lore: t(`hudChrome.weekly.kinds.${quest.kind}.lore`),
      goal: t(`hudChrome.weekly.kinds.${quest.kind}.goal`, {
        count: formatNumber(quest.count, { maximumFractionDigits: 0 }),
      }),
      difficulty: t('hudChrome.weekly.anyDifficulty'),
      art: `${WEEKLY_ART_DIR}/${quest.kind}.webp`,
      medal: `${WEEKLY_ART_DIR}/medal_${quest.kind}.webp`,
      state,
      buttonLabel: buttonLabel(state, count, quest.count),
      count,
      required: quest.count,
    };
  });
  return {
    title: t('hudChrome.weekly.title'),
    subtitle: t('hudChrome.weekly.subtitle'),
    resetText: weeklyResetText(world.weeklyQuestResetAtMs, nowMs),
    cards,
    footer: held ? t('hudChrome.weekly.footerHeld') : t('hudChrome.weekly.footerPick'),
    commendation: buildWeeklyCommendation(world),
    emissaryName: npcDisplayName(WEEKLY_EMISSARY_NPC_DEF.id),
    emissaryTitle: npcDisplayTitle(WEEKLY_EMISSARY_NPC_DEF.id),
    emissaryPortrait: `${WEEKLY_ART_DIR}/emissary.webp`,
  };
}

/** The confirm dialog for one card, priced for this character's level. */
export function buildWeeklyQuestDialog(
  quest: WeeklyQuestDef,
  level: number,
  resetText: string,
): WeeklyQuestDialogView {
  const mark = ITEMS[HEROIC_MARK_ITEM_ID];
  const cache = ITEMS[WEEKLY_QUEST_REWARD.cacheItemId];
  const marks = formatNumber(EMISSARY_CACHE_MARKS, { maximumFractionDigits: 0 });
  return {
    questId: quest.id,
    heading: t('hudChrome.weekly.dialogHeading', { category: categoryText(quest.kind) }),
    lore: t(`hudChrome.weekly.kinds.${quest.kind}.lore`),
    goalLabel: t(`hudChrome.weekly.kinds.${quest.kind}.goalLabel`),
    goalCount: t('hudChrome.weekly.tally', {
      count: formatNumber(0, { maximumFractionDigits: 0 }),
      required: formatNumber(quest.count, { maximumFractionDigits: 0 }),
    }),
    rewardMoney: formatMoney(weeklyQuestRewardCopper(level)),
    rewardStanding: t('hudChrome.weekly.commendRewardLine', {
      amount: whole(WEEKLY_QUEST_REWARD.commendationStanding),
    }),
    rewardItem: cache ? itemDisplayName(cache) : WEEKLY_QUEST_REWARD.cacheItemId,
    rewardItemIcon: `ui/items/${WEEKLY_QUEST_REWARD.cacheItemId}.webp`,
    rewardItemDesc: t('hudChrome.weekly.cacheDesc', {
      count: marks,
      item: mark ? itemDisplayName(mark) : HEROIC_MARK_ITEM_ID,
    }),
    note: t('hudChrome.weekly.dialogNote', { reset: resetText }),
    art: `${WEEKLY_ART_DIR}/${quest.kind}.webp`,
    accept: t('hudChrome.weekly.accept'),
    decline: t('hudChrome.weekly.decline'),
  };
}
