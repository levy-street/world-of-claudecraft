import { describe, expect, it } from 'vitest';
import {
  dailyRewardEventPresentation,
  rewardEventDate,
} from '../../src/admin/daily_reward_event_log';

describe('daily reward event log presentation', () => {
  it('uses the server reward day for Today and Yesterday', () => {
    expect(rewardEventDate('2026-07-16')).toBe('2026-07-16');
    expect(rewardEventDate('2026-07-16', -1)).toBe('2026-07-15');
  });

  it('describes a multiplied quest award and its contributing values', () => {
    const row = dailyRewardEventPresentation({
      id: 1,
      createdAt: '2026-07-16T01:00:00.000Z',
      kind: 'task',
      points: 20,
      totalPoints: 35,
      meta: {
        taskType: 'quest_completion',
        questId: 'wolf_hunt',
        multiplier: 2,
        basePoints: 10,
        onlineMinutes: 45,
      },
    });

    expect(row.action).toContain('wolf_hunt');
    expect(row.details).toEqual(['x2 reward multiplier', '10 base points', '45 online minutes']);
  });

  it('distinguishes arena outcomes and delve chest bonuses', () => {
    expect(
      dailyRewardEventPresentation({
        id: 2,
        createdAt: '2026-07-16T02:00:00.000Z',
        kind: 'task',
        points: 10,
        totalPoints: 10,
        meta: { taskType: 'arena_result', format: '2v2', won: false },
      }).action,
    ).toBe('Arena loss: 2v2');

    const chest = dailyRewardEventPresentation({
      id: 3,
      createdAt: '2026-07-16T03:00:00.000Z',
      kind: 'task',
      points: 30,
      totalPoints: 40,
      meta: {
        taskType: 'delve_clear',
        bonusType: 'delve_chest',
        delveId: 'crypt',
        tierId: 'heroic',
        chestTier: 'premium',
        bountifulMultiplier: 1.5,
      },
    });
    expect(chest.action).toContain('premium');
    expect(chest.details).toContain('x1.5 bountiful multiplier');
  });
});
