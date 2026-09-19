import { describe, expect, it } from 'vitest';
import { earnedWeeklyRolls, emptyWeeklyRewards } from '../src/sim/weekly_rewards';
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
  it('matches every raid and dungeon milestone difficulty to the actual loot rolls', () => {
    const cases = [];
    for (let raidMask = 0; raidMask < 27; raidMask++) {
      const state = emptyWeeklyRewards();
      state.raids = [raidMask % 3, Math.floor(raidMask / 3) % 3, Math.floor(raidMask / 9)];
      cases.push(state);
    }
    for (let completed = 0; completed <= 8; completed++) {
      for (let heroic = 0; heroic <= completed; heroic++) {
        const state = emptyWeeklyRewards();
        state.dungeons = Array(heroic)
          .fill(2)
          .concat(Array(completed - heroic).fill(1));
        cases.push(state);
      }
    }
    for (const state of cases) {
      const rows = buildWeeklyRewardsView(
        { state, nowMs: 0, canClaim: true, worldQuestsAvailable: false, readyWeeks: 0 },
        'mage',
      );
      const actual = earnedWeeklyRolls(state);
      for (const [index, row] of rows.slice(0, 2).entries()) {
        expect(row.milestones.filter((m) => m.difficulty === 'normal')).toHaveLength(
          actual[index * 2],
        );
        expect(row.milestones.filter((m) => m.difficulty === 'heroic')).toHaveLength(
          actual[index * 2 + 1],
        );
        for (const milestone of row.milestones) {
          expect(milestone.heroicRemaining).toBe(
            milestone.difficulty === 'normal' ? milestone.required - milestone.heroic : 0,
          );
          if (milestone.completed)
            expect(milestone.heroic + milestone.normal).toBe(milestone.required);
          else expect(milestone.difficulty).toBeNull();
        }
      }
    }
  });
});
