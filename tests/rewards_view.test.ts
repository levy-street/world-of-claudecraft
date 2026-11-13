import { describe, expect, it } from 'vitest';
import { WEEKLY_EMISSARY_NPC_DEF } from '../src/sim/content/weekly_quests';
import { GLIDER_NPC_DEF, WORLD_QUEST_GLIDER } from '../src/sim/content/world_quest_glider';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import { zoneAt } from '../src/sim/data';
import type { WeeklyQuestProgress } from '../src/sim/types';
import {
  REWARDS,
  rewardsClaimCounts,
  weeklyEmissaryPoint,
  weeklyQuestClaimable,
  worldQuestMapPoint,
} from '../src/ui/hud/rewards/rewards_view';

const weekly = (state: 'active' | 'completed', commended?: string): WeeklyQuestProgress => ({
  questId: 'q',
  week: 'wk_1',
  count: 0,
  state,
  ...(commended ? { commended } : {}),
});

describe('Rewards hub spec (menu consolidation step 7)', () => {
  it('has the three tabs in strip order, Vault first, under its own storage key', () => {
    expect(REWARDS.tabs.map((tab) => tab.id)).toEqual(['vault', 'weekly', 'worldQuests']);
    expect(REWARDS.defaultTab).toBe('vault');
    expect(REWARDS.storageKey).toBe('woc.rewards.tab');
    expect(REWARDS.ariaLabelKey).toBe('hudChrome.rewards.title');
  });
});

describe('rewardsClaimCounts: the rail pill', () => {
  it('sums the two claimable sources and reports each one', () => {
    expect(rewardsClaimCounts({ vaultReadyWeeks: 2, weeklyQuest: weekly('completed') })).toEqual({
      vault: 2,
      weekly: 1,
      total: 3,
    });
  });

  it('counts each arm on its own (per-dimension negatives)', () => {
    const none = { vaultReadyWeeks: 0, weeklyQuest: null };
    expect(rewardsClaimCounts(none).total).toBe(0);
    expect(rewardsClaimCounts({ ...none, vaultReadyWeeks: 3 })).toMatchObject({
      vault: 3,
      weekly: 0,
      total: 3,
    });
    expect(rewardsClaimCounts({ ...none, weeklyQuest: weekly('completed') })).toMatchObject({
      vault: 0,
      weekly: 1,
      total: 1,
    });
  });

  it('reads a missing, negative or fractional count as whole and non-negative', () => {
    expect(rewardsClaimCounts({ vaultReadyWeeks: null, weeklyQuest: null }).total).toBe(0);
    expect(rewardsClaimCounts({ vaultReadyWeeks: -2, weeklyQuest: null }).total).toBe(0);
    expect(
      rewardsClaimCounts({
        vaultReadyWeeks: Number.NaN,
        weeklyQuest: null,
      }).total,
    ).toBe(0);
    expect(rewardsClaimCounts({ vaultReadyWeeks: 2.7, weeklyQuest: null }).vault).toBe(2);
  });
});

describe('weeklyQuestClaimable: the commendation rule', () => {
  it('is claimable only while finished and not yet commended', () => {
    expect(weeklyQuestClaimable(null)).toBe(false);
    expect(weeklyQuestClaimable(weekly('active'))).toBe(false);
    expect(weeklyQuestClaimable(weekly('completed'))).toBe(true);
    expect(weeklyQuestClaimable(weekly('completed', 'eastbrook'))).toBe(false);
  });
});

describe('Show on Map points', () => {
  it('pans an ordinary world quest to its area centre', () => {
    const quest = WORLD_QUESTS.find((q) => q.objective.type !== 'glider');
    expect(quest).toBeDefined();
    if (!quest) return;
    expect(worldQuestMapPoint(quest)).toEqual({ x: quest.area.x, z: quest.area.z });
  });

  it('pans the glider course to its instructor, not the course area', () => {
    const point = worldQuestMapPoint(WORLD_QUEST_GLIDER);
    expect(point).toEqual({ x: GLIDER_NPC_DEF.pos.x, z: GLIDER_NPC_DEF.pos.z });
    expect(point).not.toEqual({ x: WORLD_QUEST_GLIDER.area.x, z: WORLD_QUEST_GLIDER.area.z });
  });

  it('names the emissary spawn and its zone for the read-only Weekly Quest tab', () => {
    const { x, z } = WEEKLY_EMISSARY_NPC_DEF.pos;
    expect(weeklyEmissaryPoint()).toEqual({ x, z, zoneId: zoneAt(x, z).id });
    expect(zoneAt(x, z).id).toBe('eastbrook_vale');
  });
});
