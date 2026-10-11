import { describe, expect, it, vi } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { BUILTIN_WORLD, ITEMS, MOBS, NPCS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { freshInstanceSlot } from '../src/sim/instances/instance_slot';
import { Sim } from '../src/sim/sim';
import {
  sanitizeWeeklyBossUnlocks,
  WEEKLY_BOSS_TABLES,
  weeklyAvailableBossTables,
  weeklyBossChoiceExhausted,
  weeklyBossLootPool,
  weeklyBossTable,
} from '../src/sim/weekly_reward_tables';
import {
  advanceWeeklyRewards,
  emptyWeeklyRewards,
  finishWeeklyRewardOpen,
  prepareWeeklyRewardOpen,
  recordWeeklyBossKill,
  sanitizeWeeklyRewards,
  stateFor,
  WEEKLY_KEEPER_ID,
  weeklyRewardInfoFor,
} from '../src/sim/weekly_rewards';

function setup() {
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
  sim.entities.get(pid)!.level = 20;
  const keeper = [...sim.entities.values()].find(
    (entity) => entity.templateId === WEEKLY_KEEPER_ID,
  )!;
  sim.entities.get(pid)!.pos = { ...keeper.pos };
  const meta = sim.players.get(pid)!;
  meta.weeklyRewards = emptyWeeklyRewards(604800000);
  meta.weeklyRewards.bossUnlocks = { vael_the_mistcaller: 1, ysolei: 2 };
  meta.weeklyRewards.vaults = [
    {
      resetAtMs: 1000,
      bossUnlocks: { ...meta.weeklyRewards.bossUnlocks },
      choices: [{ pool: 'dungeon' }, { pool: 'dungeon_heroic' }],
    },
  ];
  return { sim, pid, meta, state: meta.weeklyRewards, batch: meta.weeklyRewards.vaults[0] };
}

describe('weekly boss-table eligibility', () => {
  it('registers every final boss that pays dungeon and raid clear credit exactly once', () => {
    for (const tuning of Object.values(HEROIC_DUNGEON_TUNING)) {
      expect(
        WEEKLY_BOSS_TABLES.filter((table) => table.bossId === tuning.finalBossId),
      ).toHaveLength(1);
    }
  });

  it.each([0, 3, 1.5, -1, 99, '2', null])('rejects invalid boss unlock tier %j', (tier) => {
    expect(sanitizeWeeklyBossUnlocks({ morthen: tier })).toEqual({});
  });
  it('registers named mid-bosses, actual raid rooms and no trash tables', () => {
    expect(weeklyBossTable('sexton_marrow')?.dungeonId).toBe('hollow_crypt');
    expect(weeklyBossTable('varkhul_forgefather_of_the_last_flame')?.dungeonId).toBe(
      'ignivar_inner_crucible',
    );
    expect(weeklyBossTable('crypt_skeleton')).toBeUndefined();
    for (const id of ['wildheart_stalker', 'wildheart_ravager', 'wildheart_hexcaller'])
      expect(weeklyBossTable(id)).toBeUndefined();
    expect(weeklyBossTable('wildheart_beastmaster')).toBeDefined();
    expect(Object.isFrozen(WEEKLY_BOSS_TABLES)).toBe(true);
    expect(WEEKLY_BOSS_TABLES.every(Object.isFrozen)).toBe(true);
    expect(new Set(WEEKLY_BOSS_TABLES.map((table) => table.bossId)).size).toBe(
      WEEKLY_BOSS_TABLES.length,
    );
  });

  it('sanitizes only known own-property IDs and valid difficulty tiers', () => {
    expect(sanitizeWeeklyBossUnlocks(undefined)).toBeUndefined();
    expect(sanitizeWeeklyBossUnlocks({})).toEqual({});
    const raw = Object.assign(Object.create({ morthen: 2 }), {
      sexton_marrow: 1,
      ysolei: 99,
      fake: 2,
    });
    expect(sanitizeWeeklyBossUnlocks(raw)).toEqual({ sexton_marrow: 1 });
    expect(weeklyBossTable('__proto__')).toBeUndefined();
    expect(weeklyBossTable('x'.repeat(129))).toBeUndefined();
  });

  it('offers only cleared bosses at the vault difficulty, without duplicates or trash loot', () => {
    const { batch } = setup();
    expect(weeklyAvailableBossTables(batch, batch.choices[0], 'mage').map((t) => t.bossId)).toEqual(
      ['vael_the_mistcaller', 'ysolei'],
    );
    expect(weeklyAvailableBossTables(batch, batch.choices[1], 'mage').map((t) => t.bossId)).toEqual(
      ['ysolei'],
    );
    const itemId = weeklyBossLootPool('vael_the_mistcaller', 'dungeon', 'mage')[0];
    batch.choices.push({ pool: 'pvp', itemId, pendingSave: true });
    expect(
      weeklyAvailableBossTables(batch, batch.choices[0], 'mage').flatMap((t) => t.items),
    ).not.toContain(itemId);
  });

  it('rejects forged boss, difficulty and category choices before RNG or state changes', () => {
    const { sim, pid, batch } = setup();
    const pick = vi.spyOn(sim.ctx.rng, 'pick');
    for (const [key, table] of [
      ['1000:0', 'morthen'],
      ['1000:1', 'vael_the_mistcaller'],
      ['1000:0', 'nythraxis_scourge_of_thornpeak'],
      ['1000:0', '__proto__'],
    ])
      expect(prepareWeeklyRewardOpen(sim.ctx, key, pid, undefined, table)).toBeNull();
    expect(pick).not.toHaveBeenCalled();
    expect(batch.choices.every((choice) => !choice.itemId && !choice.tableId)).toBe(true);
  });

  it('fixes the chosen table and item before saving and preserves both through retry and reload', () => {
    const { sim, pid, batch } = setup();
    const pick = vi.spyOn(sim.ctx.rng, 'pick');
    const opening = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid, undefined, 'sunken_bastion')!;
    expect(weeklyBossLootPool('vael_the_mistcaller', 'dungeon', 'mage')).toContain(opening.itemId);
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBeUndefined();
    finishWeeklyRewardOpen(opening, false);
    const retry = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid, undefined, 'ysolei')!;
    expect(retry.itemId).toBe(opening.itemId);
    expect(retry.choice.tableId).toBe('sunken_bastion');
    expect(pick).toHaveBeenCalledTimes(1);
    finishWeeklyRewardOpen(retry, true);
    const restored = sanitizeWeeklyRewards(
      JSON.parse(JSON.stringify(sim.serializeCharacter(pid)!.weeklyRewards)),
    )!;
    expect(restored.vaults[0].choices[0]).toEqual({
      pool: 'dungeon',
      tableId: 'sunken_bastion',
      itemId: opening.itemId,
      opened: true,
    });
    expect(restored.vaults[0].bossUnlocks).toEqual(batch.bossUnlocks);
  });

  it('freezes new weeks independently of subsequent clears', () => {
    const state = emptyWeeklyRewards(1000);
    state.bossUnlocks = { morthen: 1 };
    state.dungeons = [1];
    advanceWeeklyRewards(state, 2000, () => 604800000);
    state.bossUnlocks.morthen = 2;
    state.bossUnlocks.ysolei = 2;
    expect(state.vaults[0].bossUnlocks).toEqual({ morthen: 1 });
  });

  it('migrates only proven final bosses and preserves empty snapshots and legacy fixed items', () => {
    const { sim, meta, state } = setup();
    delete state.bossUnlocks;
    meta.deedStats.dungeonClears = { hollow_crypt: 3, 'sunken_bastion:heroic': 1 };
    stateFor(sim.ctx, meta);
    expect(state.bossUnlocks).toEqual({ morthen: 1, vael_the_mistcaller: 2 });
    const fixed = weeklyBossLootPool('ysolei', 'dungeon', 'mage')[0];
    state.vaults = [
      { resetAtMs: 1000, bossUnlocks: {}, choices: [{ pool: 'dungeon', itemId: fixed }] },
    ];
    const saved = sanitizeWeeklyRewards(state)!;
    expect(saved.vaults[0].bossUnlocks).toEqual({});
    expect(saved.vaults[0].choices[0].itemId).toBe(fixed);
  });

  it('records intermediate encounters without awarding an extra dungeon completion', () => {
    const { sim, pid, meta, state } = setup();
    const inst = freshInstanceSlot('hollow_crypt', 1);
    inst.difficulty = 'heroic';
    const boss = createMob(90001, MOBS.sexton_marrow, 20, { x: 0, y: 0, z: 0 });
    recordWeeklyBossKill(sim.ctx, boss, [meta], inst);
    expect(state.bossUnlocks!.sexton_marrow).toBe(2);
    expect(state.dungeons).toEqual([]);
    expect(sim.players.has(pid)).toBe(true);
  });

  it('does not unlock a boss table for ordinary Wildheart trash kills', () => {
    const { sim, meta, state } = setup();
    const inst = freshInstanceSlot('wildheart_basin', 1);
    const before = { ...state.bossUnlocks };
    for (const id of ['wildheart_stalker', 'wildheart_ravager', 'wildheart_hexcaller'])
      recordWeeklyBossKill(
        sim.ctx,
        createMob(90001, MOBS[id], 20, { x: 0, y: 0, z: 0 }),
        [meta],
        inst,
      );
    expect(state.bossUnlocks).toEqual(before);
    expect(state.dungeons).toEqual([]);
  });

  it('credits a real mid-boss death at its cleared difficulty without a final-boss milestone', () => {
    const { sim, pid, state } = setup();
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = sim.instances.find(
      (slot) => slot.dungeonId === 'hollow_crypt' && slot.partyKey !== null,
    )!;
    const boss = inst.mobIds
      .map((id) => sim.entities.get(id)!)
      .find((entity) => entity.templateId === 'sexton_marrow')!;
    const player = sim.entities.get(pid)!;
    player.pos = { ...boss.pos };
    sim.ctx.rebucket(player);
    sim.ctx.dealDamage(player, boss, boss.hp * 100, false, 'physical', null, 'hit');
    expect(state.bossUnlocks!.sexton_marrow).toBe(1);
    expect(state.dungeons).toEqual([]);
  });

  it('keeps normal Hollow Crypt rewards usable, including migrated unopened weeks', () => {
    const { sim, pid, meta, state } = setup();
    delete state.bossUnlocks;
    state.vaults = [{ resetAtMs: 1000, choices: [{ pool: 'dungeon' }] }];
    meta.deedStats.dungeonClears = { hollow_crypt: 1 };
    const opening = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid, undefined, 'hollow_crypt')!;
    expect(ITEMS[opening.itemId].quality).toBe('uncommon');
    finishWeeklyRewardOpen(opening, true);
    const restored = sanitizeWeeklyRewards(sim.serializeCharacter(pid)!.weeklyRewards)!;
    expect(restored.vaults[0].choices[0].itemId).toBe(opening.itemId);
    sim.claimWeeklyReward('1000:0', pid);
    expect(state.vaults).toHaveLength(0);
  });

  it('marks legacy fixed rolls without leaking their item or offering a replacement table', () => {
    const { sim, pid, batch } = setup();
    const itemId = weeklyBossLootPool('ysolei', 'dungeon', 'mage')[0];
    batch.choices = [{ pool: 'dungeon', itemId }];
    batch.bossUnlocks = {};
    const publicState = weeklyRewardInfoFor(sim.ctx, pid)!.state;
    expect(publicState.vaults[0].choices[0]).toEqual({ pool: 'dungeon', fixed: true });
    expect(JSON.stringify(publicState)).not.toContain(itemId);
    expect(sanitizeWeeklyRewards(publicState, true)!.vaults[0].choices[0].fixed).toBe(true);
    expect(sanitizeWeeklyRewards(publicState)!.vaults[0].choices[0].fixed).toBeUndefined();
    expect(
      weeklyBossChoiceExhausted(publicState.vaults[0], publicState.vaults[0].choices[0], 'mage'),
    ).toBe(false);
    const opening = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid)!;
    expect(opening.itemId).toBe(itemId);
  });

  it('allows claiming a revealed reward when all remaining eligible items are exhausted', () => {
    const { sim, pid, state, batch } = setup();
    const items = weeklyBossLootPool('vael_the_mistcaller', 'dungeon', 'mage');
    expect(items.length).toBeGreaterThan(0);
    batch.bossUnlocks = { vael_the_mistcaller: 1 };
    batch.choices = items.map((itemId) => ({ pool: 'dungeon', itemId, opened: true }));
    batch.choices.push({ pool: 'dungeon' });
    expect(weeklyBossChoiceExhausted(batch, batch.choices.at(-1)!, 'mage')).toBe(true);
    sim.claimWeeklyReward('1000:0', pid);
    expect(state.vaults).toHaveLength(0);
    expect(sim.countItem(items[0], pid)).toBe(1);
  });
});
