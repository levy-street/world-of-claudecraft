import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_WORLD, ITEMS, NPCS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type ItemDef, type PlayerClass } from '../src/sim/types';
import { weeklyRewardFitsClass } from '../src/sim/weekly_reward_eligibility';
import { WEEKLY_BOSS_TABLES, weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import {
  emptyWeeklyRewards,
  prepareWeeklyRewardOpen,
  WEEKLY_KEEPER_ID,
  WEEKLY_POOL_IDS,
  weeklyLootPool,
} from '../src/sim/weekly_rewards';

const ring = {
  id: 'vault_test_ring',
  name: 'Vault test ring',
  kind: 'armor',
  slot: 'ring',
  quality: 'epic',
  sellValue: 1,
} as const satisfies ItemDef;
const unwanted: ItemDef[] = [
  { ...ring, stats: { int: 1, agi: 20 } },
  { ...ring, spellPower: 1 },
  { ...ring, healPower: 1 },
];

function expectAllowedStats(cls: PlayerClass, item: ItemDef): void {
  if (cls === 'warrior' || cls === 'rogue' || cls === 'hunter') {
    expect(item.stats?.int ?? 0, `${cls}: ${item.id} Intellect`).toBeLessThanOrEqual(0);
    expect(item.spellPower ?? 0, `${cls}: ${item.id} Spell Power`).toBeLessThanOrEqual(0);
    expect(item.healPower ?? 0, `${cls}: ${item.id} Healing Power`).toBeLessThanOrEqual(0);
  }
  if (cls === 'warlock')
    expect(item.healPower ?? 0, `${cls}: ${item.id} Healing Power`).toBeLessThanOrEqual(0);
}

describe('weekly vault class restrictions', () => {
  it.each(['warrior', 'rogue', 'hunter'] as const)(
    'excludes every unwanted stat for %s, including mixed-stat items',
    (cls) => {
      for (const item of unwanted) expect(weeklyRewardFitsClass(cls, item)).toBe(false);
      expect(weeklyRewardFitsClass(cls, { ...ring, stats: { str: 4, agi: 4, sta: 4 } })).toBe(true);
      expect(weeklyRewardFitsClass(cls, ring)).toBe(true);
    },
  );

  it.each(['druid', 'shaman', 'paladin'] as const)('keeps every stat profile for %s', (cls) => {
    for (const item of unwanted) expect(weeklyRewardFitsClass(cls, item)).toBe(true);
    expect(weeklyRewardFitsClass(cls, { ...ring, requiredClass: ['mage'] })).toBe(false);
  });

  it('excludes all warlock Healing Power, even when paired with Spell Power', () => {
    expect(weeklyRewardFitsClass('warlock', { ...ring, healPower: 1 })).toBe(false);
    expect(weeklyRewardFitsClass('warlock', { ...ring, healPower: 1, spellPower: 50 })).toBe(false);
    expect(weeklyRewardFitsClass('warlock', { ...ring, stats: { int: 10 }, spellPower: 50 })).toBe(
      true,
    );
    for (const cls of ['mage', 'priest'] as const)
      expect(weeklyRewardFitsClass(cls, { ...ring, healPower: 10 })).toBe(true);
  });

  it.each(['mage', 'warlock', 'priest'] as const)(
    'keeps cloth, jewelry and weapon proficiency rules for %s',
    (cls) => {
      expect(weeklyRewardFitsClass(cls, ring)).toBe(true);
      for (const armorType of ['cloth', 'leather', 'mail'] as const) {
        expect(weeklyRewardFitsClass(cls, { ...ring, slot: 'chest', armorType })).toBe(
          armorType === 'cloth',
        );
      }
      const weapon: ItemDef = {
        ...ring,
        kind: 'weapon',
        slot: 'mainhand',
        weapon: { min: 1, max: 2, speed: 2 },
        requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
      };
      expect(weeklyRewardFitsClass(cls, weapon)).toBe(true);
      expect(
        weeklyRewardFitsClass(cls, {
          ...weapon,
          requiredClass: ['warrior', 'rogue', 'hunter', 'shaman', 'paladin'],
        }),
      ).toBe(false);
    },
  );

  it.each(ALL_CLASSES)(
    'filters all content tables for %s without emptying its reward rows',
    (cls) => {
      for (const pool of WEEKLY_POOL_IDS) {
        const items = weeklyLootPool(pool, cls);
        expect(items.length, `${cls}: ${pool}`).toBeGreaterThan(0);
        for (const id of items) expectAllowedStats(cls, ITEMS[id]);
        for (const table of WEEKLY_BOSS_TABLES)
          for (const id of weeklyBossLootPool(table.bossId, pool, cls))
            expectAllowedStats(cls, ITEMS[id]);
      }
    },
  );

  it.each(['warrior', 'rogue', 'hunter', 'warlock'] as const)(
    'applies restrictions to the authoritative roll and preserves a previously saved item for %s',
    (cls) => {
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
      const bossUnlocks = Object.fromEntries(WEEKLY_BOSS_TABLES.map((t) => [t.bossId, 2]));
      state.vaults = [
        { resetAtMs: 1000, bossUnlocks, choices: WEEKLY_POOL_IDS.map((pool) => ({ pool })) },
      ];
      meta.weeklyRewards = state;
      const pick = vi.spyOn(sim.ctx.rng, 'pick');
      for (const [index, pool] of WEEKLY_POOL_IDS.entries()) {
        const table =
          pool === 'world' || pool === 'pvp'
            ? pool
            : pool.startsWith('raid')
              ? 'nythraxis_scourge_of_thornpeak'
              : 'hollow_crypt';
        const opening = prepareWeeklyRewardOpen(sim.ctx, `1000:${index}`, pid, undefined, [table]);
        expect(opening, `${cls}: ${pool}`).not.toBeNull();
        if (opening) expectAllowedStats(cls, ITEMS[opening.itemId]);
      }
      for (const [items] of pick.mock.calls)
        for (const id of items as string[]) expectAllowedStats(cls, ITEMS[id]);

      // A saved item must never be replaced by the new eligibility policy.
      const savedId = Object.values(ITEMS).find((item) => (item.healPower ?? 0) > 0)?.id;
      if (!savedId) throw new Error('Missing Healing Power fixture');
      state.vaults[0].choices = [{ pool: 'world', itemId: savedId, fixed: true }];
      pick.mockClear();
      expect(prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid)?.itemId).toBe(savedId);
      expect(pick).not.toHaveBeenCalled();
    },
  );
});
