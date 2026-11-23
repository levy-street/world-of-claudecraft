import { describe, expect, it, vi } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { BUILTIN_WORLD, ITEMS, MOBS, NPCS } from '../src/sim/data';
import { regrowHead } from '../src/sim/encounters/drowned_temple/hydra_regrowth';
import { createMob } from '../src/sim/entity';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { freshInstanceSlot } from '../src/sim/instances/instance_slot';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, IGNIVAR_BOSS_ID } from '../src/sim/types';
import {
  sanitizeWeeklyBossUnlocks,
  WEEKLY_BOSS_TABLES,
  weeklyAvailableBossTables,
  weeklyBossBodies,
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
  weeklyLootPool,
  weeklyRewardInfoFor,
} from '../src/sim/weekly_rewards';
import { boss, fight } from './helpers/temple_fight';

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
  it.each(ALL_CLASSES)(
    'offers one Crucible core per boss table at either difficulty for %s',
    (cls) => {
      for (const pool of ['raid', 'raid_heroic'] as const) {
        for (const bossId of [IGNIVAR_BOSS_ID, VARKHUL_BOSS_ID]) {
          const items = weeklyBossLootPool(bossId, pool, cls);
          expect(items.filter((id) => id === 'lastflame_core')).toHaveLength(1);
          expect(
            items.filter((id) => !['weapon', 'armor', 'held_offhand'].includes(ITEMS[id].kind)),
          ).toEqual(['lastflame_core']);
        }
        expect(weeklyLootPool(pool, cls)).toContain('lastflame_core');
      }
      for (const pool of ['dungeon', 'dungeon_heroic', 'world', 'pvp'] as const)
        expect(weeklyLootPool(pool, cls)).not.toContain('lastflame_core');
      expect(weeklyBossLootPool('nythraxis_scourge_of_thornpeak', 'raid', cls)).not.toContain(
        'lastflame_core',
      );
    },
  );

  it.each(['raid', 'raid_heroic'] as const)(
    'preserves a %s core through opening, reload and claim',
    (pool) => {
      const { sim, pid, meta, state, batch } = setup();
      state.lootSpec = 'fire';
      batch.bossUnlocks = { [VARKHUL_BOSS_ID]: 2 };
      batch.choices = [{ pool }];
      const pick = vi.spyOn(sim.ctx.rng, 'pick').mockImplementation((items) => {
        expect(items).toContain('lastflame_core');
        return 'lastflame_core';
      });
      const opening = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid, undefined, VARKHUL_BOSS_ID)!;
      expect(opening.itemId).toBe('lastflame_core');
      expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBeUndefined();
      finishWeeklyRewardOpen(opening, true);
      expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBe(
        'lastflame_core',
      );
      expect(
        sanitizeWeeklyRewards(weeklyRewardInfoFor(sim.ctx, pid)!.state, true)!.vaults[0].choices[0]
          .itemId,
      ).toBe('lastflame_core');
      const restored = sanitizeWeeklyRewards(
        JSON.parse(JSON.stringify(sim.serializeCharacter(pid)!.weeklyRewards)),
      )!;
      expect(restored.vaults[0].choices[0]).toEqual({
        pool,
        tableId: VARKHUL_BOSS_ID,
        itemId: 'lastflame_core',
        opened: true,
        lootSpec: 'fire',
      });
      meta.weeklyRewards = restored;
      sim.claimWeeklyReward('1000:0', pid);
      expect(restored.vaults).toHaveLength(0);
      expect(sim.countItem('lastflame_core', pid)).toBe(1);
      expect(pick).toHaveBeenCalledOnce();
      expect(state.vaults).toHaveLength(1);
    },
  );

  it('rejects saved cores in non-raid slots and unrelated non-equipment rewards', () => {
    const state = emptyWeeklyRewards(604800000);
    state.vaults = [
      {
        resetAtMs: 1000,
        choices: [
          { pool: 'raid', itemId: 'lastflame_core', opened: true },
          ...(['dungeon', 'dungeon_heroic', 'world', 'pvp'] as const).map((pool) => ({
            pool,
            itemId: 'lastflame_core',
            opened: true as const,
          })),
          { pool: 'raid', itemId: 'formula_lastflame_zeal', opened: true },
          { pool: 'raid', itemId: 'forgefathers_ember', opened: true },
        ],
      },
    ];
    expect(sanitizeWeeklyRewards(state)!.vaults[0].choices).toEqual([
      { pool: 'raid', itemId: 'lastflame_core', opened: true },
    ]);
  });

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

  it('limits raid and dungeon batches to bosses killed in the earned week', () => {
    const { sim, meta } = setup();
    const state = sanitizeWeeklyRewards({
      ...emptyWeeklyRewards(1000),
      raidClears: [2],
      dungeons: [2],
      bossUnlocks: {
        ignivar_herald_of_the_last_flame: 2,
        nythraxis_scourge_of_thornpeak: 2,
        morthen: 2,
        ysolei: 2,
      },
      weeklyBossUnlocks: { nythraxis_scourge_of_thornpeak: 2, ysolei: 2 },
    })!;
    meta.weeklyRewards = state;
    stateFor(sim.ctx, meta);
    const batch = state.vaults[0];
    expect(batch.choices.map((choice) => choice.pool)).toEqual(['raid_heroic', 'dungeon_heroic']);
    expect(weeklyAvailableBossTables(batch, batch.choices[0], 'mage').map((t) => t.bossId)).toEqual(
      ['nythraxis_scourge_of_thornpeak'],
    );
    expect(weeklyAvailableBossTables(batch, batch.choices[1], 'mage').map((t) => t.bossId)).toEqual(
      ['ysolei'],
    );
    expect(
      prepareWeeklyRewardOpen(
        sim.ctx,
        '1000:0',
        meta.entityId,
        undefined,
        'ignivar_herald_of_the_last_flame',
      ),
    ).toBeNull();
    expect(
      prepareWeeklyRewardOpen(sim.ctx, '1000:1', meta.entityId, undefined, 'hollow_crypt'),
    ).toBeNull();
    const saved = sim.serializeCharacter(meta.entityId)!;
    expect(saved.weeklyRewards?.weeklyBossUnlocks).toEqual({});
  });

  it('fills only the deploy week from lifetime unlocks and clears the map at rollover', () => {
    const { sim, meta } = setup();
    const state = sanitizeWeeklyRewards({
      ...emptyWeeklyRewards(1000),
      dungeons: [1],
      bossUnlocks: { morthen: 1 },
    })!;
    meta.weeklyRewards = state;
    state.resetAtMs = 604800000;
    stateFor(sim.ctx, meta);
    expect(state.weeklyBossUnlocks).toEqual({ morthen: 1 });
    const saved = sim.serializeCharacter(meta.entityId)!;
    const restoredPid = sim.addPlayer('mage', 'AfterDeploySave', { state: saved });
    expect(sim.players.get(restoredPid)?.weeklyRewards?.weeklyBossUnlocks).toEqual({ morthen: 1 });
    state.resetAtMs = 1000;
    stateFor(sim.ctx, meta);
    expect(state.vaults[0].choices).toEqual([{ pool: 'dungeon' }]);
    expect(state.vaults[0].bossUnlocks).toEqual({ morthen: 1 });
    expect(state.weeklyBossUnlocks).toEqual({});
    expect(state.bossUnlocks).toEqual({ morthen: 1 });
    expect(sanitizeWeeklyRewards(JSON.parse(JSON.stringify(state)))?.weeklyBossUnlocks).toEqual({});
    stateFor(sim.ctx, meta);
    expect(state.weeklyBossUnlocks).toEqual({});
    state.weeklyBossUnlocks = { ysolei: 1 };
    state.dungeons = [1];
    advanceWeeklyRewards(state, 604800000, () => 1209600000);
    expect(state.vaults[1].bossUnlocks).toEqual({ ysolei: 1 });
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
    expect(state.weeklyBossUnlocks!.sexton_marrow).toBe(2);
    expect(weeklyRewardInfoFor(sim.ctx, pid)?.state.weeklyBossUnlocks?.sexton_marrow).toBe(2);
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

// The Mere Hydra is one boss of three placed bodies (FinderEncounter.otherBodyIds):
// one table, keyed on the centre head, unlocked by the kill and never by a head.
describe('weekly boss table of a several-bodied boss (the Mere Hydra)', () => {
  const HEADS = ['mere_hydra_head_left', 'mere_hydra_head_center', 'mere_hydra_head_right'];

  it('registers one table, on the centre head, and maps every head to it', () => {
    expect(weeklyBossTable('mere_hydra_head_center')).toEqual({
      bossId: 'mere_hydra_head_center',
      dungeonId: 'drowned_temple',
      category: 'dungeon',
    });
    expect(weeklyBossTable('mere_hydra_head_left')).toBeUndefined();
    expect(weeklyBossTable('mere_hydra_head_right')).toBeUndefined();
    for (const head of HEADS) {
      expect(weeklyBossBodies(head)?.bossId, head).toBe('mere_hydra_head_center');
      // The boss itself leads its own bodies.
      expect(weeklyBossBodies(head)?.bodyIds, head).toEqual([
        'mere_hydra_head_center',
        'mere_hydra_head_left',
        'mere_hydra_head_right',
      ]);
    }
    // Every ordinary boss, and every other mob, is its own single body.
    for (const { bossId } of WEEKLY_BOSS_TABLES)
      if (bossId !== 'mere_hydra_head_center') expect(weeklyBossBodies(bossId)).toBeUndefined();
    expect(weeklyBossBodies('drowned_pilgrim')).toBeUndefined();
    // Its shelf is the loot the kill really pays, per difficulty.
    expect(weeklyBossLootPool('mere_hydra_head_center', 'dungeon', 'warrior')).toContain(
      'merecleaver',
    );
    expect(
      weeklyBossLootPool('mere_hydra_head_center', 'dungeon_heroic', 'warrior').length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ['normal', 1],
    ['heroic', 2],
  ] as const)('unlocks on the %s kill only when the third head falls', (difficulty, tier) => {
    const f = fight(difficulty);
    const meta = f.sim.players.get(f.tank.id)!;
    const state = stateFor(f.sim.ctx, meta);
    const heads = HEADS.map((id) => boss(f, id));
    // The centre head first: it owns the table, and its death alone is no kill.
    f.sim.ctx.handleDeath(heads[1], f.tank);
    expect(state.bossUnlocks?.mere_hydra_head_center).toBeUndefined();
    f.sim.ctx.handleDeath(heads[0], f.tank);
    expect(state.bossUnlocks?.mere_hydra_head_center).toBeUndefined();
    f.sim.ctx.handleDeath(heads[2], f.tank);
    expect(state.bossUnlocks?.mere_hydra_head_center).toBe(tier);
    // No head has a ledger row of its own, and the Hydra is not the finale.
    expect(state.bossUnlocks?.mere_hydra_head_left).toBeUndefined();
    expect(state.bossUnlocks?.mere_hydra_head_right).toBeUndefined();
    expect(state.dungeons).toEqual([]);
    // The whole party in the claim is credited, not only the one who struck.
    for (const other of f.others) {
      const otherState = stateFor(f.sim.ctx, f.sim.players.get(other.id)!);
      expect(otherState.bossUnlocks?.mere_hydra_head_center).toBe(tier);
    }
  });

  it('a wipe with heads down unlocks nothing, and a kill ending on a regrown head still does', () => {
    const f = fight('normal');
    const meta = f.sim.players.get(f.tank.id)!;
    const state = stateFor(f.sim.ctx, meta);
    const heads = HEADS.map((id) => boss(f, id));
    // Two who must never be credited by the claim-roster fallback below: a
    // party member who never set foot in the claim, and a stranger.
    const waiting = f.sim.addPlayer('priest', 'Doorwaiter');
    f.sim.partyInvite(waiting, f.tank.id);
    f.sim.partyAccept(waiting);
    const stranger = f.sim.addPlayer('rogue', 'Passerby');
    const unlockOf = (pid: number) =>
      stateFor(f.sim.ctx, f.sim.players.get(pid)!).bossUnlocks?.mere_hydra_head_center;
    f.sim.ctx.handleDeath(heads[0], f.tank);
    f.sim.ctx.handleDeath(heads[1], f.tank);
    // The wipe stands both back up (mere_hydra.ts resetHydra regrows them whole).
    regrowHead(f.sim.ctx, heads[0], 1);
    regrowHead(f.sim.ctx, heads[1], 1);
    expect(state.bossUnlocks?.mere_hydra_head_center).toBeUndefined();
    // The next attempt: the last body to fall is one that grew back, which
    // carries no kill credit of its own (Entity.regrown).
    f.sim.ctx.handleDeath(heads[2], f.tank);
    f.sim.ctx.handleDeath(heads[1], f.tank);
    expect(state.bossUnlocks?.mere_hydra_head_center).toBeUndefined();
    expect(heads[0].regrown).toBe(true);
    f.sim.ctx.handleDeath(heads[0], f.tank);
    expect(state.bossUnlocks?.mere_hydra_head_center).toBe(1);
    // The roster that stood in for the missing recipients is the claim's own:
    // everyone who entered it, and nobody else.
    for (const other of f.others) expect(unlockOf(other.id), 'a member inside').toBe(1);
    expect(unlockOf(waiting), 'a party member who never entered').toBeUndefined();
    expect(unlockOf(stranger), 'a stranger').toBeUndefined();
  });

  it('a last head on its first life that dies with nobody to credit unlocks nothing', () => {
    // Only a head that grew back may arrive without recipients. A first-life
    // body nobody is credited for is the same no-credit death it is for any
    // other boss, never a reason to pay the whole roster.
    const f = fight('normal');
    const state = stateFor(f.sim.ctx, f.sim.players.get(f.tank.id)!);
    const heads = HEADS.map((id) => boss(f, id));
    f.sim.ctx.handleDeath(heads[0], f.tank);
    f.sim.ctx.handleDeath(heads[1], f.tank);
    expect(heads[2].regrown).not.toBe(true);
    expect(heads[2].tappedById).toBeNull();
    f.sim.ctx.handleDeath(heads[2], null);
    expect(heads.every((h) => h.dead)).toBe(true);
    expect(state.bossUnlocks?.mere_hydra_head_center).toBeUndefined();
  });

  it('an ordinary boss with nobody to credit still unlocks nothing', () => {
    // The early return this change reordered: single-bodied bosses keep it.
    const { sim, meta, state } = setup();
    const inst = freshInstanceSlot('hollow_crypt', 1);
    inst.enteredBy.add(meta.entityId);
    const before = { ...state.bossUnlocks };
    const marrow = createMob(90001, MOBS.sexton_marrow, 20, { x: 0, y: 0, z: 0 });
    recordWeeklyBossKill(sim.ctx, marrow, [], inst);
    expect(state.bossUnlocks).toEqual(before);
    // And with a recipient it is credited as before.
    recordWeeklyBossKill(sim.ctx, marrow, [meta], inst);
    expect(state.bossUnlocks?.sexton_marrow).toBe(1);
  });
});
