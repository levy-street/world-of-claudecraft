import { describe, expect, it } from 'vitest';
import { weeklyItemWithinLevel } from '../src/sim/weekly_reward_options';
import { WEEKLY_BOSS_TABLES, weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import {
  earnedWeeklyRolls,
  emptyWeeklyRewards,
  type WeeklyPoolId,
} from '../src/sim/weekly_rewards';
import { buildWeeklyRewardsView, weeklyCountdown } from '../src/ui/weekly_rewards_view';

describe('weekly reward presentation', () => {
  it('shows two Normal and one Heroic clear of the same raid as three milestones', () => {
    const state = emptyWeeklyRewards();
    state.raids = [2, 0, 0];
    state.raidClears = [2, 1, 1];
    state.raidUnlocks = [2, 0, 0];
    state.bossUnlocks = { nythraxis_scourge_of_thornpeak: 2 };
    const raid = buildWeeklyRewardsView(
      {
        playerLevel: 20,
        state,
        nowMs: 0,
        canClaim: true,
        worldQuestsAvailable: false,
        readyWeeks: 0,
      },
      'mage',
    )[0];
    expect(raid.progress).toBe(3);
    expect(raid.milestones.map((m) => [m.completed, m.difficulty])).toEqual([
      [true, 'heroic'],
      [true, 'normal'],
      [true, 'normal'],
    ]);
    expect(earnedWeeklyRolls(state).slice(0, 2)).toEqual([2, 1]);
  });

  it('keeps the four requested rows ordered and follows the world row availability flag', () => {
    const state = emptyWeeklyRewards(604800000);
    state.raidUnlocks = [1, 0, 0];
    state.raids = [1, 0, 0];
    state.raidClears = [1];
    state.bossUnlocks = { nythraxis_scourge_of_thornpeak: 1 };
    state.world = 2;
    const rows = buildWeeklyRewardsView(
      {
        playerLevel: 20,
        state,
        nowMs: 0,
        canClaim: true,
        worldQuestsAvailable: false,
        readyWeeks: 0,
      },
      'mage',
    );
    expect(rows.map((r) => r.category)).toEqual(['raid', 'dungeon', 'world', 'pvp']);
    expect(rows[0].pools[0].earned).toBe(1);
    // The previous-tier pool lists either way; the flag alone gates the row and
    // its milestones, so a class with nothing to wear never shows a hollow tick.
    expect(rows[2].available).toBe(false);
    expect(rows[2].milestones.map((m) => m.completed)).toEqual([false, false, false]);
    expect(rows[2].pools[0].items).not.toHaveLength(0);
    const live = buildWeeklyRewardsView(
      {
        playerLevel: 20,
        state,
        nowMs: 0,
        canClaim: true,
        worldQuestsAvailable: true,
        readyWeeks: 0,
      },
      'mage',
    );
    expect(live[2].available).toBe(true);
    expect(live[2].milestones.map((m) => m.completed)).toEqual([true, false, false]);
  });
  it('previews loot only from bosses killed this week', () => {
    const state = emptyWeeklyRewards();
    state.bossUnlocks = { morthen: 2, ysolei: 2 };
    state.weeklyBossUnlocks = { ysolei: 2 };
    const dungeon = buildWeeklyRewardsView(
      {
        playerLevel: 20,
        state,
        nowMs: 0,
        canClaim: true,
        worldQuestsAvailable: false,
        readyWeeks: 0,
      },
      'mage',
    )[1];
    expect(dungeon.pools[1].tables.map((table) => table.id)).toEqual(['drowned_temple']);
  });
  it('previews every class-eligible boss table in the all catalog, kills or not', () => {
    const state = emptyWeeklyRewards();
    state.bossUnlocks = {};
    state.weeklyBossUnlocks = {};
    const info = {
      playerLevel: 60,
      state,
      nowMs: 0,
      canClaim: false,
      worldQuestsAvailable: true,
      readyWeeks: 0,
    };
    const [raid, dungeon] = buildWeeklyRewardsView(info, 'warrior', { catalog: 'all' });
    const expected = (category: 'raid' | 'dungeon', pool: WeeklyPoolId) => [
      ...new Set(
        WEEKLY_BOSS_TABLES.filter(
          (table) =>
            table.category === category &&
            weeklyBossLootPool(table.bossId, pool, 'warrior').some((id) =>
              weeklyItemWithinLevel(id, 60),
            ),
        ).map((table) => (category === 'dungeon' ? table.dungeonId : table.bossId)),
      ),
    ];
    for (const entry of [...raid.pools, ...dungeon.pools]) {
      const category = entry.pool.startsWith('raid') ? 'raid' : 'dungeon';
      expect(entry.tables.map((table) => table.id).sort()).toEqual(
        expected(category, entry.pool).sort(),
      );
      expect(entry.emptyReason).toBeNull();
    }
    expect(dungeon.pools[0].tables.map((table) => table.id)).toEqual(
      expect.arrayContaining([
        'hollow_crypt',
        'sunken_bastion',
        'drowned_temple',
        'gravewyrm_sanctum',
        'wildheart_basin',
      ]),
    );
    expect(dungeon.pools[1].tables.map((table) => table.id)).toEqual(
      expect.arrayContaining(['hollow_crypt', 'gravewyrm_sanctum', 'wildheart_basin']),
    );
    for (const entry of raid.pools)
      expect(entry.tables.map((table) => table.id)).toEqual(
        expect.arrayContaining(['nythraxis_scourge_of_thornpeak']),
      );
    expect(raid.catalog).toBe('all');
    // The default (keeper) catalog stays cleared-only and names the real reason,
    // even when lifetime unlocks exist: only this week's kills count there.
    state.bossUnlocks = { morthen: 2, nythraxis_scourge_of_thornpeak: 2 };
    const keeper = buildWeeklyRewardsView(info, 'warrior');
    for (const row of keeper.slice(0, 2)) {
      expect(row.catalog).toBe('eligible');
      for (const entry of row.pools) {
        expect(entry.tables).toEqual([]);
        expect(entry.emptyReason).toBe('noClears');
      }
    }
  });
  it('filters every previewed item by equip level, not just whole tables', () => {
    const state = emptyWeeklyRewards();
    const info = (playerLevel: number) => ({
      playerLevel,
      state,
      nowMs: 0,
      canClaim: false,
      worldQuestsAvailable: true,
      readyWeeks: 0,
    });
    const atMax = buildWeeklyRewardsView(info(60), 'warrior', { catalog: 'all' });
    const low = buildWeeklyRewardsView(info(10), 'warrior', { catalog: 'all' });
    let trimmed = false;
    for (const [rowIndex, row] of low.slice(0, 2).entries())
      for (const [poolIndex, entry] of row.pools.entries()) {
        const full = atMax[rowIndex].pools[poolIndex];
        for (const table of entry.tables) {
          // Every listed item must be wearable within the offset at level 10.
          for (const id of table.items) expect(weeklyItemWithinLevel(id, 10)).toBe(true);
          const fullItems = full.tables.find((candidate) => candidate.id === table.id)!.items;
          expect(fullItems).toEqual(expect.arrayContaining(table.items));
          if (table.items.length < fullItems.length) trimmed = true;
        }
        expect(entry.items).toEqual([...new Set(entry.tables.flatMap((t) => t.items))].sort());
        if (entry.tables.length < full.tables.length) trimmed = true;
      }
    // Positive control: level 10 really does drop something level 60 lists.
    expect(trimmed).toBe(true);
  });
  it('reports the empty reason per pool, not per row', () => {
    const state = emptyWeeklyRewards();
    state.weeklyBossUnlocks = { ysolei: 1 };
    const dungeon = buildWeeklyRewardsView(
      {
        playerLevel: 20,
        state,
        nowMs: 0,
        canClaim: true,
        worldQuestsAvailable: false,
        readyWeeks: 0,
      },
      'mage',
    )[1];
    expect(dungeon.pools.map((entry) => [entry.pool, entry.emptyReason])).toEqual([
      ['dungeon', null],
      ['dungeon_heroic', 'noClears'],
    ]);
  });
  it('names level as the empty reason once cleared tables exist but are over level', () => {
    const state = emptyWeeklyRewards();
    state.weeklyBossUnlocks = { nythraxis_scourge_of_thornpeak: 2 };
    const raid = buildWeeklyRewardsView(
      {
        playerLevel: 1,
        state,
        nowMs: 0,
        canClaim: true,
        worldQuestsAvailable: true,
        readyWeeks: 0,
      },
      'warrior',
    )[0];
    expect(raid.pools.map((entry) => [entry.tables.length, entry.emptyReason])).toEqual([
      [0, 'level'],
      [0, 'level'],
    ]);
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
      state.raidClears = state.raids.filter(Boolean).sort((a, b) => b - a);
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
        {
          playerLevel: 20,
          state,
          nowMs: 0,
          canClaim: true,
          worldQuestsAvailable: false,
          readyWeeks: 0,
        },
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
