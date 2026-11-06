// Rewards (menu consolidation step 7, 2026-11-06): one tabbed window for the
// time-gated rewards that were scattered across three surfaces. Vault is the
// weekly rewards sheet the Bank and the Dungeon Finder both painted, Weekly
// Quest is the emissary's offer board (readable anywhere, picked at the NPC),
// and World Quests is the day's board that sat on the World Map rail.
//
// Pure: the hub spec, the claimable counts behind the rail pill, and the map
// points the tabs' Show on Map buttons pan to. The pill and the tabs read the
// SAME inputs through the same functions, so they can never disagree.

import { WEEKLY_EMISSARY_NPC_DEF } from '../../../sim/content/weekly_quests';
import { GLIDER_NPC_DEF } from '../../../sim/content/world_quest_glider';
import { zoneAt } from '../../../sim/data';
import type { WeeklyQuestProgress, WorldQuestDef } from '../../../sim/types';
import type { WindowHubSpec } from '../hub/window_hub_view';

export type RewardsTab = 'vault' | 'weekly' | 'worldQuests';

export const REWARDS: WindowHubSpec<RewardsTab> = {
  tabs: [
    { id: 'vault', labelKey: 'hudChrome.rewards.tabVault' },
    { id: 'weekly', labelKey: 'hudChrome.rewards.tabWeekly' },
    { id: 'worldQuests', labelKey: 'hudChrome.rewards.tabWorldQuests' },
  ],
  defaultTab: 'vault',
  storageKey: 'woc.rewards.tab',
  ariaLabelKey: 'hudChrome.rewards.title',
  closeKey: 'hudChrome.rewards.close',
  stripClass: 'rewards-hub-tabs',
  tabClass: 'rewards-hub-tab',
  focusPrefix: 'rewardsHub',
};

/** What each tab has waiting, and the pill's total. */
export interface RewardsClaimCounts {
  /** Weekly Vault batches ready to open (`weeklyRewardInfo.readyWeeks`). */
  readonly vault: number;
  /** 1 while the week's charge is finished and its commendation unclaimed. */
  readonly weekly: number;
  /** Today's board quests finished (the World Quests tab's own count). */
  readonly worldQuests: number;
  readonly total: number;
}

export interface RewardsClaimInput {
  /** `IWorld.weeklyRewardInfo?.readyWeeks`; null when the read is absent. */
  readonly vaultReadyWeeks: number | null | undefined;
  readonly weeklyQuest: WeeklyQuestProgress | null;
  /** The World Quests tab's completed count (`buildWorldQuestRailView().completed`). */
  readonly worldQuestsCompleted: number;
}

const whole = (value: number | null | undefined): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;

/** The finished-and-unclaimed rule, the same one the commendation strip uses
 *  (`buildWeeklyCommendation` in weekly_quests_view.ts). */
export function weeklyQuestClaimable(progress: WeeklyQuestProgress | null): boolean {
  return progress?.state === 'completed' && !progress.commended;
}

export function rewardsClaimCounts(input: RewardsClaimInput): RewardsClaimCounts {
  const vault = whole(input.vaultReadyWeeks);
  const weekly = weeklyQuestClaimable(input.weeklyQuest) ? 1 : 0;
  const worldQuests = whole(input.worldQuestsCompleted);
  return { vault, weekly, worldQuests, total: vault + weekly + worldQuests };
}

export interface RewardsMapPoint {
  readonly x: number;
  readonly z: number;
}

/** Where a world quest's Show on Map pans: the glider course starts at its
 *  NPC, every other objective at its area's centre (the map pin's point). */
export function worldQuestMapPoint(
  quest: Pick<WorldQuestDef, 'objective' | 'area'>,
): RewardsMapPoint {
  const pos = quest.objective.type === 'glider' ? GLIDER_NPC_DEF.pos : quest.area;
  return { x: pos.x, z: pos.z };
}

/** The weekly emissary's spawn and zone, for the Weekly Quest tab's "pick at
 *  the emissary" line (the sim spawns it from this def beside the Weekly
 *  Vault's door, weekly_quests.ts). */
export function weeklyEmissaryPoint(): RewardsMapPoint & { readonly zoneId: string } {
  const { x, z } = WEEKLY_EMISSARY_NPC_DEF.pos;
  return { x, z, zoneId: zoneAt(x, z).id };
}
