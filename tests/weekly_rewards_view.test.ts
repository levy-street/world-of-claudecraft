import { describe, expect, it } from 'vitest';
import { emptyWeeklyRewards } from '../src/sim/weekly_rewards';
import { buildWeeklyRewardsView, weeklyCountdown } from '../src/ui/weekly_rewards_view';

describe('weekly reward presentation', () => {
  it('keeps the four requested rows ordered and disables the future world quest pool', () => {
    const state = emptyWeeklyRewards(604800000);
    state.raidUnlocks = [1, 0, 0];
    state.raids = [1, 0, 0];
    const rows = buildWeeklyRewardsView(
      { state, nowMs: 0, canClaim: true, worldQuestsAvailable: false, readyWeeks: 0 },
      'mage',
    );
    expect(rows.map((r) => r.category)).toEqual(['raid', 'dungeon', 'world', 'pvp']);
    expect(rows[0].pools[0].earned).toBe(1);
    expect(rows[2].available).toBe(false);
    expect(rows[2].pools[0].items).toEqual([]);
    expect(rows[0].pools[0].qualities).not.toHaveLength(0);
  });
  it('shows days, hours, minutes and seconds and clamps expired resets to zero', () => {
    expect(weeklyCountdown(90061000, 0)).toBe('01d 01h 01m 01s');
    expect(weeklyCountdown(0, 1000)).toBe('00d 00h 00m 00s');
  });
});
