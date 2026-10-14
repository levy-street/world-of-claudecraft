import { describe, expect, it, vi } from 'vitest';
import { TRINKET_ITEMS } from '../src/sim/content/trinkets';
import { BUILTIN_WORLD, ITEMS, NPCS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { trinketLootFitsClass } from '../src/sim/trinket_loot_eligibility';
import { ALL_CLASSES, type PlayerClass } from '../src/sim/types';
import { weeklyRewardFitsClass } from '../src/sim/weekly_reward_eligibility';
import { weeklyRewardTableOptions } from '../src/sim/weekly_reward_options';
import { WEEKLY_BOSS_TABLES, weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import {
  emptyWeeklyRewards,
  prepareWeeklyRewardOpen,
  WEEKLY_KEEPER_ID,
  WEEKLY_POOL_IDS,
  weeklyLootPool,
} from '../src/sim/weekly_rewards';

// Explicit item expectations keep the regression independent of effect classification.
const healing = ['menders_hourglass', 'wellspring_seed', 'last_flame_lantern'];
const physical = ['paired_talons', 'hunters_tally', 'forgefathers_temper', 'molten_fletching'];
const casting = ['stormjar', 'echoing_lens', 'kindling_orb'];
const utility = [
  'bastion_sigil',
  'mooring_stone',
  'gamblers_die',
  'sundered_prism',
  'wayfarers_lodestone',
  'medallion_of_defiance',
  'duelists_brand',
  'heart_of_the_crucible',
];
const casterUtility = [
  'bastion_sigil',
  'sundered_prism',
  'wayfarers_lodestone',
  'medallion_of_defiance',
  'heart_of_the_crucible',
];
const expected: Record<PlayerClass, string[]> = {
  warrior: [...physical, ...utility],
  rogue: [...physical, ...utility],
  hunter: [...physical, ...utility],
  mage: [...healing, ...casting, ...casterUtility],
  priest: [...healing, ...casting, ...casterUtility],
  warlock: [...casting, ...casterUtility],
  paladin: [...healing, ...physical, ...casting, ...utility],
  shaman: [...healing, ...physical, ...casting, ...utility],
  druid: [...healing, ...physical, ...casting, ...utility],
};

function expectSuitable(cls: PlayerClass, ids: readonly string[]) {
  for (const id of ids) {
    const item = ITEMS[id];
    if (item.slot === 'trinket')
      expect(expected[cls], `${cls}: ${id}`).toContain(item.heroicOf ?? id);
  }
}

describe('Weekly Vault trinket suitability', () => {
  it('covers the complete shipped trinket catalog', () => {
    expect([...healing, ...physical, ...casting, ...utility].sort()).toEqual(
      Object.keys(TRINKET_ITEMS).sort(),
    );
  });

  it.each(ALL_CLASSES)('offers the appropriate trinket effects for %s', (cls) => {
    for (const item of Object.values(TRINKET_ITEMS)) {
      expect(weeklyRewardFitsClass(cls, item), `${cls}: ${item.id}`).toBe(
        expected[cls].includes(item.id),
      );
      // Suitability follows effects even when the stat line changes at another tier.
      expect(weeklyRewardFitsClass(cls, { ...item, stats: {} }), `${cls}: ${item.id}`).toBe(
        expected[cls].includes(item.id) || utility.includes(item.id),
      );
      expect(trinketLootFitsClass(cls, item), `${cls}: ${item.id} effect`).toBe(
        expected[cls].includes(item.id) || utility.includes(item.id),
      );
      expect(
        weeklyRewardFitsClass(cls, { ...item, id: `heroic_${item.id}`, heroicOf: item.id }),
        `${cls}: heroic ${item.id}`,
      ).toBe(expected[cls].includes(item.id));
    }
  });

  it.each(ALL_CLASSES)('filters every pool and boss table for %s', (cls) => {
    for (const pool of WEEKLY_POOL_IDS) {
      expectSuitable(cls, weeklyLootPool(pool, cls));
      for (const table of WEEKLY_BOSS_TABLES)
        expectSuitable(cls, weeklyBossLootPool(table.bossId, pool, cls));
    }
    const ignivar = weeklyBossLootPool('ignivar_herald_of_the_last_flame', 'raid', cls);
    for (const id of ['kindling_orb', 'molten_fletching', 'last_flame_lantern'])
      expect(ignivar.includes(id), `${cls}: ${id}`).toBe(expected[cls].includes(id));
    for (const [boss, pool, id] of [
      ['ysolei', 'dungeon_heroic', 'menders_hourglass'],
      ['wildheart_high_priest', 'dungeon_heroic', 'paired_talons'],
      ['nythraxis_scourge_of_thornpeak', 'raid_heroic', 'mooring_stone'],
      ['nythraxis_scourge_of_thornpeak', 'raid_heroic', 'echoing_lens'],
      ['ignivar_herald_of_the_last_flame', 'raid_heroic', 'last_flame_lantern'],
    ] as const) {
      expect(weeklyBossLootPool(boss, pool, cls).includes(id), `${cls}: ${boss}: ${id}`).toBe(
        expected[cls].includes(id),
      );
      expect(weeklyLootPool(pool, cls).includes(id), `${cls}: ${pool}: ${id}`).toBe(
        expected[cls].includes(id),
      );
    }
  });

  it.each(ALL_CLASSES)('uses the same filtered catalog for new rolls for %s', (cls) => {
    const sim = new Sim({
      seed: 42,
      playerClass: cls,
      noPlayer: true,
      lockoutNowMs: () => 2000,
      world: {
        ...BUILTIN_WORLD,
        camps: [],
        groundObjects: [],
        npcs: { [WEEKLY_KEEPER_ID]: NPCS[WEEKLY_KEEPER_ID] },
      },
    });
    const pid = sim.addPlayer(cls, 'Collector');
    const player = sim.entities.get(pid);
    const keeper = [...sim.entities.values()].find((e) => e.templateId === WEEKLY_KEEPER_ID);
    const meta = sim.players.get(pid);
    if (!player || !keeper || !meta) throw new Error('Missing vault test actors');
    player.level = 20;
    player.pos = { ...keeper.pos };
    const state = emptyWeeklyRewards(604800000);
    const batch = {
      resetAtMs: 1000,
      bossUnlocks: Object.fromEntries(WEEKLY_BOSS_TABLES.map((table) => [table.bossId, 2])),
      choices: WEEKLY_POOL_IDS.map((pool) => ({ pool })),
    };
    state.vaults = [batch];
    meta.weeklyRewards = state;
    const pick = vi.spyOn(sim.ctx.rng, 'pick');
    for (const [index, choice] of batch.choices.entries()) {
      const options = weeklyRewardTableOptions(batch, choice, cls, player.level);
      const candidates = [...new Set(options.flatMap((option) => option.items))].sort();
      expect(candidates.length).toBeGreaterThan(0);
      expectSuitable(cls, candidates);
      pick.mockClear();
      const opening = prepareWeeklyRewardOpen(
        sim.ctx,
        `1000:${index}`,
        pid,
        undefined,
        options.map((option) => option.id),
      );
      expect(opening).not.toBeNull();
      expect(pick).toHaveBeenCalledExactlyOnceWith(candidates);
      if (opening) expectSuitable(cls, [opening.itemId]);
    }

    // Previously fixed rewards must not become a free reroll under a new filter.
    for (const itemId of ['last_flame_lantern', 'mooring_stone']) {
      state.vaults[0].choices = [{ pool: 'raid', itemId, fixed: true }];
      pick.mockClear();
      expect(prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid)?.itemId).toBe(itemId);
      expect(pick).not.toHaveBeenCalled();
    }
    pick.mockRestore();
  });
});
