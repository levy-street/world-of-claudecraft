import { describe, expect, it, vi } from 'vitest';
import { decodeWeeklyRewardInfo } from '../src/net/weekly_rewards_wire';
import { IGNIVAR_SIGIL_ITEMS } from '../src/sim/content/ignivar_loot';
import { TALENTS } from '../src/sim/content/talents';
import { BUILTIN_WORLD, ITEMS, NPCS } from '../src/sim/data';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import { Sim } from '../src/sim/sim';
import { IGNIVAR_BOSS_ID, type PlayerClass } from '../src/sim/types';
import {
  weeklyRewardKindAllowed,
  weeklySavedRewardItemAllowed,
} from '../src/sim/weekly_reward_eligibility';
import { weeklyRewardTableOptions } from '../src/sim/weekly_reward_options';
import { weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import {
  emptyWeeklyRewards,
  finishWeeklyRewardOpen,
  prepareWeeklyRewardOpen,
  sanitizeWeeklyRewards,
  WEEKLY_KEEPER_ID,
  weeklyLootPool,
  weeklyRewardInfoFor,
} from '../src/sim/weekly_rewards';

const GROUPS: readonly [PlayerClass, string][] = [
  ['warrior', 'anvil'],
  ['druid', 'anvil'],
  ['mage', 'anvil'],
  ['paladin', 'ember'],
  ['hunter', 'ember'],
  ['priest', 'ember'],
  ['shaman', 'tempest'],
  ['rogue', 'tempest'],
  ['warlock', 'tempest'],
];
const sigils = (ids: string[]) => ids.filter((id) => id.startsWith('sigil_')).sort();
const LEGACY_SIGILS = [
  'sigil_anvil_chest',
  'sigil_anvil_gloves',
  'sigil_anvil_helmet',
  'sigil_anvil_legs',
  'sigil_anvil_shoulder',
  'sigil_ember_chest',
  'sigil_ember_gloves',
  'sigil_ember_helmet',
  'sigil_ember_legs',
  'sigil_ember_shoulder',
  'sigil_tempest_chest',
  'sigil_tempest_gloves',
  'sigil_tempest_helmet',
  'sigil_tempest_legs',
  'sigil_tempest_shoulder',
];
describe('Weekly Vault redemption sigils', () => {
  it('excludes sigils from new rewards and only preserves exact authored sigils in saved rewards', () => {
    const template = ITEMS.sigil_anvil_chest;
    if (template.kind !== 'tool') throw new Error('Expected a tool sigil fixture');
    expect(weeklyRewardKindAllowed(template)).toBe(false);
    expect(weeklySavedRewardItemAllowed(template, 'raid')).toBe(true);
    expect(weeklySavedRewardItemAllowed({ ...template, kind: 'junk' }, 'raid')).toBe(false);
    for (const id of ['sigil_unknown_chest', '__proto__', 'constructor']) {
      expect(weeklyRewardKindAllowed({ ...template, id })).toBe(false);
      expect(weeklySavedRewardItemAllowed({ ...template, id }, 'raid')).toBe(false);
    }
  });
  it.each(GROUPS)('excludes sigils for %s across every loot focus while retaining cores', (cls) => {
    for (const spec of [undefined, ...TALENTS[cls].specs.map((s) => s.id)]) {
      for (const heroic of [false, true]) {
        const pool = heroic ? 'raid_heroic' : 'raid';
        for (const boss of [IGNIVAR_BOSS_ID, VARKHUL_BOSS_ID]) {
          expect(weeklyBossLootPool(boss, pool, cls, spec)).toContain('lastflame_core');
        }
        expect(weeklyLootPool(pool, cls, [0, 2, 2], spec)).toContain('lastflame_core');
        expect(sigils(weeklyBossLootPool(IGNIVAR_BOSS_ID, pool, cls, spec))).toEqual([]);
        expect(sigils(weeklyBossLootPool(VARKHUL_BOSS_ID, pool, cls, spec))).toEqual([]);
        expect(sigils(weeklyLootPool(pool, cls, [0, 2, 2], spec))).toEqual([]);
      }
      for (const pool of ['world', 'pvp', 'dungeon', 'dungeon_heroic'] as const) {
        expect(sigils(weeklyLootPool(pool, cls, undefined, spec))).toEqual([]);
      }
    }
  });

  it('omits sigils from previewed candidates and authoritative new rolls', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'mage',
      lockoutNowMs: () => 2000,
      weeklyRaidResetMs: () => 604800000,
    });
    sim.player.level = 20;
    const keeper = [...sim.entities.values()].find((e) => e.templateId === WEEKLY_KEEPER_ID)!;
    sim.player.pos = { ...keeper.pos };
    const state = emptyWeeklyRewards(604800000);
    state.lootSpec = 'fire';
    state.vaults = [
      {
        resetAtMs: 1000,
        bossUnlocks: { [IGNIVAR_BOSS_ID]: 2 },
        choices: [{ pool: 'raid_heroic' }],
      },
    ];
    sim.players.get(sim.playerId)!.weeklyRewards = state;
    const candidates = weeklyRewardTableOptions(
      state.vaults[0],
      state.vaults[0].choices[0],
      'mage',
      20,
      'fire',
    )[0].items;
    expect(candidates).toContain('lastflame_core');
    expect(sigils(candidates)).toEqual([]);
    const pick = vi.spyOn(sim.ctx.rng, 'pick').mockImplementation((items) => {
      expect(items).toEqual(candidates);
      expect(sigils(items as string[])).toEqual([]);
      return items[0];
    });
    const opening = prepareWeeklyRewardOpen(sim.ctx, '1000:0', sim.playerId, undefined, [
      IGNIVAR_BOSS_ID,
    ])!;
    expect(opening.itemId).toBe(candidates[0]);
    expect(pick).toHaveBeenCalledTimes(1);
    finishWeeklyRewardOpen(opening, true);
    pick.mockRestore();
  });

  it('preserves all authored sigils through saved and public ledgers while excluding other non-equipment', () => {
    expect(Object.keys(IGNIVAR_SIGIL_ITEMS).sort()).toEqual(LEGACY_SIGILS);
    for (const id of LEGACY_SIGILS) {
      const state = emptyWeeklyRewards(604800000);
      state.vaults = [
        { resetAtMs: 1000, choices: [{ pool: 'raid_heroic', itemId: id, opened: true }] },
      ];
      for (const publicView of [false, true]) {
        expect(
          sanitizeWeeklyRewards(JSON.parse(JSON.stringify(state)), publicView)?.vaults[0].choices[0]
            .itemId,
        ).toBe(id);
      }
    }
    const excluded = [
      'forgefathers_ember',
      'pattern_crucible_tank_mail',
      'mistcallers_duffel',
      'reins_grag_bear',
    ];
    for (const id of excluded) {
      const state = emptyWeeklyRewards(604800000);
      state.vaults = [
        { resetAtMs: 1000, choices: [{ pool: 'raid_heroic', itemId: id, opened: true }] },
      ];
      expect(sanitizeWeeklyRewards(state)?.vaults).toEqual([]);
      for (const [cls] of GROUPS) expect(weeklyLootPool('raid_heroic', cls)).not.toContain(id);
    }
  });

  it('retains a previously fixed sigil after save failure and reload and grants one on claim', () => {
    const sim = new Sim({
      seed: 42,
      noPlayer: true,
      playerClass: 'mage',
      lockoutNowMs: () => 2000,
      weeklyRaidResetMs: () => 604800000,
      world: {
        ...BUILTIN_WORLD,
        camps: [],
        npcs: { [WEEKLY_KEEPER_ID]: NPCS[WEEKLY_KEEPER_ID] },
        groundObjects: [],
      },
    });
    const pid = sim.addPlayer('mage', 'Collector');
    const player = sim.entities.get(pid)!;
    player.level = 20;
    player.pos = {
      ...[...sim.entities.values()].find((e) => e.templateId === WEEKLY_KEEPER_ID)!.pos,
    };
    const meta = sim.players.get(pid)!;
    const state = emptyWeeklyRewards(604800000);
    state.lootSpec = 'fire';
    state.vaults = [
      {
        resetAtMs: 1000,
        bossUnlocks: { [IGNIVAR_BOSS_ID]: 2 },
        choices: [
          {
            pool: 'raid_heroic',
            itemId: 'sigil_anvil_chest',
            tableId: IGNIVAR_BOSS_ID,
            lootSpec: 'fire',
          },
        ],
      },
    ];
    meta.weeklyRewards = state;
    const id = 'sigil_anvil_chest';
    const pick = vi.spyOn(sim.ctx.rng, 'pick');
    const opening = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid, undefined, [IGNIVAR_BOSS_ID])!;
    expect(opening.itemId).toBe(id);
    const pendingSaved = sim.serializeCharacter(pid)!;
    expect(pendingSaved.weeklyRewards!.vaults[0].choices[0]).toEqual({
      pool: 'raid_heroic',
      itemId: id,
      tableId: IGNIVAR_BOSS_ID,
      lootSpec: 'fire',
      opened: true,
    });
    finishWeeklyRewardOpen(opening, false);
    expect(
      decodeWeeklyRewardInfo(weeklyRewardInfoFor(sim.ctx, pid))!.state.vaults[0].choices[0].itemId,
    ).toBeUndefined();
    const retry = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid, undefined, [IGNIVAR_BOSS_ID])!;
    expect(retry.itemId).toBe(id);
    expect(pick).not.toHaveBeenCalled();
    finishWeeklyRewardOpen(retry, true);
    expect(
      decodeWeeklyRewardInfo(weeklyRewardInfoFor(sim.ctx, pid))!.state.vaults[0].choices[0].itemId,
    ).toBe(id);
    meta.weeklyRewards = sanitizeWeeklyRewards(sim.serializeCharacter(pid)!.weeklyRewards)!;
    expect(meta.weeklyRewards.vaults[0].choices[0]).toMatchObject({
      itemId: id,
      lootSpec: 'fire',
      opened: true,
    });
    const saved = sim.serializeCharacter(pid)!;
    const restoredPid = sim.addPlayer('mage', 'Restored', { state: saved });
    expect(sim.players.get(restoredPid)!.weeklyRewards!.vaults[0].choices[0]).toEqual(
      meta.weeklyRewards.vaults[0].choices[0],
    );
    delete saved.weeklyRewards!.vaults[0].choices[0].opened;
    const fixedPid = sim.addPlayer('mage', 'FixedUnopened', { state: saved });
    expect(sim.players.get(fixedPid)!.weeklyRewards!.vaults[0].choices[0]).toEqual({
      pool: 'raid_heroic',
      itemId: id,
      tableId: IGNIVAR_BOSS_ID,
      lootSpec: 'fire',
    });
    const before = sim.ctx.countItem(id, pid);
    sim.claimWeeklyReward('1000:0', pid);
    expect(sim.ctx.countItem(id, pid)).toBe(before + 1);
    expect(meta.weeklyRewards.vaults).toEqual([]);
    pick.mockRestore();
  });
});
