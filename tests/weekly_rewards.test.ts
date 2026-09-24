import { describe, expect, it, vi } from 'vitest';
import { nextWeeklyRaidResetMs } from '../src/reset_calendar';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { BUILTIN_WORLD, ITEMS, MOBS, NPCS } from '../src/sim/data';
import { prepareWeeklyVaultPlaytest } from '../src/sim/dev/weekly_vault_playtest';
import { createMob } from '../src/sim/entity';
import {
  enterDungeon,
  INSTANCE_CLEARED_EMPTY_TIMEOUT,
  leaveDungeon,
  updateInstances,
} from '../src/sim/instances/dungeons';
import { freshInstanceSlot } from '../src/sim/instances/instance_slot';
import { Sim } from '../src/sim/sim';
import { endArenaMatch, startArenaMatch } from '../src/sim/social/arena';
import { endBgMatch, startBgMatch } from '../src/sim/social/battleground';
import { ALL_CLASSES, type PlayerClass } from '../src/sim/types';
import { weeklyChoiceExhausted } from '../src/sim/weekly_reward_availability';
import { weeklyRewardTableOptions } from '../src/sim/weekly_reward_options';
import {
  advanceWeeklyRewards,
  earnedWeeklyRolls,
  emptyWeeklyRewards,
  finishWeeklyRewardOpen,
  prepareWeeklyRewardOpen as prepareOpen,
  sanitizeWeeklyRewards,
  WEEKLY_BACKLOG_LIMIT,
  WEEKLY_KEEPER_ENTITY_ID,
  WEEKLY_KEEPER_ID,
  WEEKLY_POOL_IDS,
  weeklyLootPool,
  weeklyRewardInfoFor,
} from '../src/sim/weekly_rewards';

const WEEK = 604800000;
const WORLD = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [WEEKLY_KEEPER_ID]: NPCS[WEEKLY_KEEPER_ID] },
  groundObjects: [],
};
function make(seed = 42, devCommands = true, cls: PlayerClass = 'mage') {
  let now = 1000;
  const sim = new Sim({
    seed,
    playerClass: cls,
    noPlayer: true,
    devCommands,
    world: WORLD,
    lockoutNowMs: () => now,
    weeklyRaidResetMs: (n) => (Math.floor(n / WEEK) + 1) * WEEK,
  });
  const pid = sim.addPlayer(cls, 'Collector');
  const player = sim.entities.get(pid)!;
  player.level = 20;
  const keeper = [...sim.entities.values()].find((e) => e.templateId === WEEKLY_KEEPER_ID)!;
  player.pos = { ...keeper.pos, x: keeper.pos.x - 1 };
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
  const meta = sim.players.get(pid)!;
  return {
    sim,
    pid,
    player,
    meta,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function prepareWeeklyRewardOpen(ctx: Sim['ctx'], key: string, pid: number) {
  const r = ctx.resolve(pid)!;
  const state = r.meta.weeklyRewards!;
  const batch = state.vaults[0];
  const choice = batch?.choices[Number(key.split(':')[1])];
  const tables = choice
    ? weeklyRewardTableOptions(
        { ...batch, bossUnlocks: batch.bossUnlocks ?? state.bossUnlocks },
        choice,
        r.meta.cls,
        r.e.level,
      ).map((table) => table.id)
    : [];
  return prepareOpen(ctx, key, pid, undefined, tables);
}
function openSelected(sim: Sim, key: string, pid: number) {
  const opening = prepareWeeklyRewardOpen(sim.ctx, key, pid);
  if (opening) finishWeeklyRewardOpen(opening, true);
}

describe('weekly vault choices', () => {
  it.each(ALL_CLASSES)(
    'can claim %s rewards when raid and world rolls exhaust their shared pool in either order',
    (cls) => {
      for (const worldFirst of [false, true]) {
        const { sim, pid, meta } = make(42, true, cls);
        const state = emptyWeeklyRewards(WEEK);
        state.bossUnlocks = { nythraxis_scourge_of_thornpeak: 1 };
        const pools = worldFirst ? (['world', 'raid'] as const) : (['raid', 'world'] as const);
        state.vaults = [
          {
            resetAtMs: 1000,
            bossUnlocks: { ...state.bossUnlocks },
            choices: pools.flatMap((pool) => Array.from({ length: 3 }, () => ({ pool }))),
          },
        ];
        meta.weeklyRewards = state;
        const batch = state.vaults[0];
        for (let i = 0; i < 6; i++) openSelected(sim, `1000:${i}`, pid);
        const rolled = batch.choices.flatMap((choice) => (choice.itemId ? [choice.itemId] : []));
        expect(rolled.length).toBeGreaterThanOrEqual(3);
        expect(new Set(rolled).size).toBe(rolled.length);
        for (const choice of batch.choices) {
          if (choice.itemId) expect(weeklyLootPool('world', cls)).toContain(choice.itemId);
          else expect(weeklyChoiceExhausted(batch, choice, cls, 20)).toBe(true);
        }
        const index = batch.choices.findIndex((choice) => choice.itemId);
        const itemId = batch.choices[index].itemId!;
        const before = sim.ctx.countItem(itemId, pid);
        sim.claimWeeklyReward(`1000:${index}`, pid);
        expect(state.vaults).toHaveLength(0);
        expect(sim.ctx.countItem(itemId, pid)).toBe(before + 1);
      }
    },
  );

  it('keeps a concealed legacy world reward openable even when its pool is fully reserved', () => {
    const { sim, pid, meta } = make();
    meta.weeklyRewards = emptyWeeklyRewards(WEEK);
    const ids = weeklyLootPool('world', 'mage');
    meta.weeklyRewards.vaults = [
      {
        resetAtMs: 1000,
        choices: ids.map((itemId, index) => ({
          pool: 'world',
          itemId,
          ...(index ? { opened: true as const } : {}),
        })),
      },
    ];
    const publicBatch = weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0];
    expect(publicBatch.choices[0]).toEqual({ pool: 'world', fixed: true });
    expect(weeklyChoiceExhausted(publicBatch, publicBatch.choices[0], 'mage', 20)).toBe(false);
    const pick = vi.spyOn(sim.ctx.rng, 'pick');
    openSelected(sim, '1000:0', pid);
    expect(pick).not.toHaveBeenCalled();
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBe(ids[0]);
    sim.claimWeeklyReward('1000:0', pid);
    expect(meta.weeklyRewards.vaults).toHaveLength(0);
  });

  it.each(['raid', 'world'] as const)(
    'avoids overlapping Nythraxis items when opening %s first, including an unacknowledged roll',
    (firstPool) => {
      const { sim, pid, meta } = make();
      meta.weeklyRewards = emptyWeeklyRewards(WEEK);
      meta.weeklyRewards.bossUnlocks = { nythraxis_scourge_of_thornpeak: 1 };
      meta.weeklyRewards.vaults = [
        {
          resetAtMs: 1000,
          bossUnlocks: { ...meta.weeklyRewards.bossUnlocks },
          choices: [{ pool: firstPool }, { pool: firstPool === 'raid' ? 'world' : 'raid' }],
        },
      ];
      const pick = vi.spyOn(sim.ctx.rng, 'pick').mockImplementation((items) => items[0]);
      const first = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid)!;
      expect(first).not.toBeNull();
      expect(weeklyLootPool('world', 'mage')).toContain(first.itemId);
      finishWeeklyRewardOpen(first, false);
      expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBeUndefined();
      const second = prepareWeeklyRewardOpen(sim.ctx, '1000:1', pid)!;
      expect(second).not.toBeNull();
      expect(weeklyLootPool('world', 'mage')).toContain(second.itemId);
      expect(second.itemId).not.toBe(first.itemId);
      finishWeeklyRewardOpen(second, true);
      sim.claimWeeklyReward('1000:1', pid);
      expect(meta.weeklyRewards.vaults).toHaveLength(1);
      const retry = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid)!;
      expect(retry.itemId).toBe(first.itemId);
      expect(pick).toHaveBeenCalledTimes(2);
      finishWeeklyRewardOpen(retry, true);
      const saved = sim.serializeCharacter(pid)!;
      const restored = sim.addPlayer('mage', 'AfterCrash', { state: saved });
      expect(
        sim.players.get(restored)!.weeklyRewards!.vaults[0].choices.map((choice) => choice.itemId),
      ).toEqual([first.itemId, second.itemId]);
      sim.claimWeeklyReward('1000:1', pid);
      expect(meta.weeklyRewards.vaults).toHaveLength(0);
    },
  );

  it('rolls distinct items within a week even when every draw picks the first candidate', () => {
    const { sim, pid, meta } = make();
    meta.weeklyRewards = emptyWeeklyRewards(WEEK);
    const batch = {
      resetAtMs: 1000,
      choices: [{ pool: 'pvp' as const }, { pool: 'pvp' as const }, { pool: 'pvp' as const }],
    };
    meta.weeklyRewards.vaults = [batch];
    const pick = vi.spyOn(sim.ctx.rng, 'pick').mockImplementation((items) => items[0]);
    for (let index = 0; index < batch.choices.length; index++)
      openSelected(sim, `1000:${index}`, pid);
    expect(meta.weeklyRewards.vaults[0].choices.map((choice) => choice.itemId)).toEqual(
      weeklyLootPool('pvp', 'mage').slice(0, 3),
    );
    expect(pick).toHaveBeenCalledTimes(3);
  });

  it('reserves hidden legacy and unacknowledged items across the whole week', () => {
    const { sim, pid, meta } = make();
    const ids = weeklyLootPool('pvp', 'mage');
    meta.weeklyRewards = emptyWeeklyRewards(WEEK);
    meta.weeklyRewards.vaults = [
      {
        resetAtMs: 1000,
        choices: [
          { pool: 'raid', itemId: ids[0] },
          { pool: 'dungeon', itemId: ids[1], opened: true, pendingSave: true },
          { pool: 'pvp' },
        ],
      },
    ];
    vi.spyOn(sim.ctx.rng, 'pick').mockImplementation((items) => items[0]);
    openSelected(sim, '1000:2', pid);
    expect(meta.weeklyRewards.vaults[0].choices.map((choice) => choice.itemId)).toEqual(
      ids.slice(0, 3),
    );
    expect(
      weeklyRewardInfoFor(sim.ctx, pid)!
        .state.vaults[0].choices.slice(0, 2)
        .every((choice) => !choice.itemId),
    ).toBe(true);
  });

  it('keeps a failed-save roll on retry while excluding it from later rolls', () => {
    const { sim, pid, meta } = make();
    meta.weeklyRewards = emptyWeeklyRewards(WEEK);
    meta.weeklyRewards.vaults = [{ resetAtMs: 1000, choices: [{ pool: 'pvp' }, { pool: 'pvp' }] }];
    const pick = vi.spyOn(sim.ctx.rng, 'pick').mockImplementation((items) => items[0]);
    const first = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid)!;
    finishWeeklyRewardOpen(first, false);
    openSelected(sim, '1000:1', pid);
    const retry = prepareWeeklyRewardOpen(sim.ctx, '1000:0', pid)!;
    expect(retry.itemId).toBe(first.itemId);
    expect(meta.weeklyRewards.vaults[0].choices[1].itemId).not.toBe(first.itemId);
    expect(pick).toHaveBeenCalledTimes(2);
  });

  it('excludes committed rolls after restoring a character without rewriting existing rewards', () => {
    const { sim, pid, meta } = make();
    const ids = weeklyLootPool('pvp', 'mage');
    meta.weeklyRewards = emptyWeeklyRewards(WEEK);
    meta.weeklyRewards.vaults = [
      {
        resetAtMs: 1000,
        choices: [
          { pool: 'pvp', itemId: ids[0], opened: true },
          { pool: 'pvp', itemId: ids[0] },
          { pool: 'pvp' },
        ],
      },
    ];
    const saved = sim.serializeCharacter(pid)!;
    const restored = sim.addPlayer('mage', 'Restored', { state: saved });
    vi.spyOn(sim.ctx.rng, 'pick').mockImplementation((items) => items[0]);
    openSelected(sim, '1000:1', restored);
    openSelected(sim, '1000:2', restored);
    expect(
      sim.players.get(restored)!.weeklyRewards!.vaults[0].choices.map((choice) => choice.itemId),
    ).toEqual([ids[0], ids[0], ids[1]]);
  });

  it('allows an item again in a different week', () => {
    const { sim, pid, meta } = make();
    meta.weeklyRewards = emptyWeeklyRewards(WEEK);
    meta.weeklyRewards.vaults = [
      { resetAtMs: 999, choices: [{ pool: 'pvp' }] },
      { resetAtMs: 1000, choices: [{ pool: 'pvp' }] },
    ];
    vi.spyOn(sim.ctx.rng, 'pick').mockImplementation((items) => items[0]);
    openSelected(sim, '999:0', pid);
    const first = meta.weeklyRewards.vaults[0].choices[0].itemId;
    sim.claimWeeklyReward('999:0', pid);
    openSelected(sim, '1000:0', pid);
    expect(meta.weeklyRewards.vaults[0].choices[0].itemId).toBe(first);
  });

  it('never falls back to a duplicate if an eligible pool is exhausted', () => {
    const { sim, pid, meta } = make();
    meta.weeklyRewards = emptyWeeklyRewards(WEEK);
    meta.weeklyRewards.vaults = [
      {
        resetAtMs: 1000,
        choices: [
          ...weeklyLootPool('pvp', 'mage').map((itemId) => ({ pool: 'pvp' as const, itemId })),
          { pool: 'pvp' },
        ],
      },
    ];
    const choices = meta.weeklyRewards.vaults[0].choices;
    const pick = vi.spyOn(sim.ctx.rng, 'pick');
    expect(prepareWeeklyRewardOpen(sim.ctx, `1000:${choices.length - 1}`, pid)).toBeNull();
    expect(choices.at(-1)).toEqual({ pool: 'pvp' });
    expect(pick).not.toHaveBeenCalled();
  });

  it('has enough distinct catalog items except shared shelves and filtered Warlock heroic raids', () => {
    for (const cls of ALL_CLASSES)
      for (let mask = 0; mask < 27; mask++) {
        const unlocks = [mask % 3, Math.floor(mask / 3) % 3, Math.floor(mask / 9)];
        const pools = WEEKLY_POOL_IDS.map((pool) => ({
          pool,
          group: pool.split('_')[0],
          maximum: pool.startsWith('raid')
            ? unlocks.filter((tier) => tier >= (pool.endsWith('_heroic') ? 2 : 1)).length
            : 3,
          ids: weeklyLootPool(pool, cls, unlocks),
        })).filter((pool) => pool.ids.length);
        for (const pool of pools) {
          // Cover this pool's maximum earned slots plus overlapping items that
          // other pools could consume first. Raid caps follow unlocked bosses.
          let needed = pool.maximum;
          for (const group of new Set(pools.map((other) => other.group))) {
            const maximum = group === 'raid' ? unlocks.filter(Boolean).length : 3;
            const competing = new Set(
              pools
                .filter((other) => other.group === group && other !== pool)
                .flatMap((other) => other.ids),
            );
            needed += Math.min(
              group === pool.group ? maximum - pool.maximum : maximum,
              pool.ids.filter((id) => competing.has(id)).length,
            );
          }
          // World shares Nythraxis with chosen raid tables. The all-class opening
          // test above proves that exhausting this shelf still permits a claim.
          // Warlocks exclude Healing Power gear, leaving fewer heroic raid items;
          // the regression below pins a successful claim after that pool exhausts.
          // Rogues' Varkhul heroic shelf is the two Crucible trinkets (PR 4173,
          // the trinket slot), both also on the Normal shelf, so the Varkhul-only
          // heroic unlock beside three Normal clears cannot cover the overlap
          // either; the same exhaustion regression covers it.
          expect(pool.ids.length, `${cls} ${unlocks} ${pool.pool}`).toBeGreaterThanOrEqual(
            (cls === 'warlock' || cls === 'rogue') && pool.pool === 'raid_heroic'
              ? 1
              : pool.pool === 'world' || pool.pool === 'raid'
                ? pool.maximum
                : needed,
          );
        }
      }
  });

  it('can claim a Rogue heroic raid reward after class filtering exhausts another slot', () => {
    // Anchored on a Warlock with Ignivar and Varkhul unlocked until the trinket
    // slot (PR 4173) put three Crucible trinkets on every class's heroic shelf,
    // so no two-boss heroic pool empties any more. The class filter still
    // empties a shelf: Varkhul's heroic weapons and armor are plate or caster
    // gear, so a Rogue sees only the two trinkets there, and a third heroic
    // row from the same boss is exhausted after the two open.
    const { sim, pid, meta } = make(42, true, 'rogue');
    const state = emptyWeeklyRewards(WEEK);
    state.bossUnlocks = { varkhul_forgefather_of_the_last_flame: 2 };
    state.vaults = [
      {
        resetAtMs: 1000,
        bossUnlocks: { ...state.bossUnlocks },
        choices: [{ pool: 'raid_heroic' }, { pool: 'raid_heroic' }, { pool: 'raid_heroic' }],
      },
    ];
    meta.weeklyRewards = state;
    const batch = state.vaults[0];
    openSelected(sim, '1000:0', pid);
    const itemId = batch.choices[0].itemId;
    expect(itemId).toBeDefined();
    if (!itemId) throw new Error('Missing filtered Rogue reward');
    openSelected(sim, '1000:1', pid);
    expect(batch.choices[1].itemId).toBeDefined();
    expect(new Set([itemId, batch.choices[1].itemId])).toEqual(
      new Set(['forgefathers_temper', 'heart_of_the_crucible']),
    );
    openSelected(sim, '1000:2', pid);
    expect(batch.choices[2].itemId).toBeUndefined();
    expect(weeklyChoiceExhausted(batch, batch.choices[2], 'rogue', 20)).toBe(true);
    const before = sim.ctx.countItem(itemId, pid);
    sim.claimWeeklyReward('1000:0', pid);
    expect(state.vaults).toHaveLength(0);
    expect(sim.ctx.countItem(itemId, pid)).toBe(before + 1);
  });

  it('rolls only on opening and conceals pending items until the host acknowledges durability', () => {
    const { sim, pid, meta } = make();
    const roll = vi.spyOn(sim.ctx.rng, 'pick');
    prepareWeeklyVaultPlaytest(sim.ctx, pid, true);
    const info = weeklyRewardInfoFor(sim.ctx, pid)!;
    const batch = meta.weeklyRewards!.vaults[0];
    expect(roll).not.toHaveBeenCalled();
    expect(info.state.vaults[0].choices.every((choice) => !choice.itemId)).toBe(true);
    roll.mockReturnValueOnce('orb_of_the_last_spring');
    const opening = prepareWeeklyRewardOpen(sim.ctx, `${batch.resetAtMs}:0`, pid)!;
    expect(roll).toHaveBeenCalledOnce();
    expect(roll.mock.calls[0][0]).toContain('orb_of_the_last_spring');
    expect(JSON.stringify(weeklyRewardInfoFor(sim.ctx, pid))).not.toContain(opening.itemId);
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.weeklyRewards!.vaults[0].choices[0]).toEqual({
      pool: opening.choice.pool,
      tableId: 'varkhul_forgefather_of_the_last_flame',
      itemId: opening.itemId,
      opened: true,
    });
    finishWeeklyRewardOpen(opening, false);
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBeUndefined();
    const retry = prepareWeeklyRewardOpen(sim.ctx, `${batch.resetAtMs}:0`, pid)!;
    expect(retry.itemId).toBe(opening.itemId);
    expect(roll).toHaveBeenCalledOnce();
    finishWeeklyRewardOpen(retry, true);
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBe(
      opening.itemId,
    );
    const restored = sim.addPlayer('mage', 'AfterCrash', { state: saved });
    const loaded = sim.players.get(restored)!.weeklyRewards!.vaults[0].choices[0];
    expect(loaded.opened).toBe(true);
    expect(loaded.itemId).toBe(opening.itemId);
    expect(loaded.pendingSave).toBeUndefined();
  });

  it('keeps legacy fixed items hidden until opening and freezes earned raid eligibility', () => {
    const { sim, pid, meta, setNow } = make();
    meta.weeklyRewards = emptyWeeklyRewards(2000);
    meta.weeklyRewards.raids = [1, 0, 0];
    meta.weeklyRewards.raidUnlocks = [1, 0, 0];
    setNow(2000);
    weeklyRewardInfoFor(sim.ctx, pid);
    expect(meta.weeklyRewards.vaults[0].raidUnlocks).toEqual([1, 0, 0]);
    meta.weeklyRewards.raidUnlocks = [2, 2, 2];
    const opening = prepareWeeklyRewardOpen(sim.ctx, '2000:0', pid)!;
    expect(weeklyLootPool('raid', 'mage', [1, 0, 0])).toContain(opening.itemId);
    finishWeeklyRewardOpen(opening, true);
    const fixed = 'orb_of_the_last_spring';
    meta.weeklyRewards = sanitizeWeeklyRewards({
      resetAtMs: 9000,
      vaults: [
        {
          resetAtMs: 1000,
          choices: [
            { pool: 'raid', itemId: fixed, tableId: 'varkhul_forgefather_of_the_last_flame' },
          ],
        },
      ],
    });
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0]).toEqual({
      pool: 'raid',
      fixed: true,
    });
    const roll = vi.spyOn(sim.ctx.rng, 'pick');
    sim.claimWeeklyReward('1000:0', pid);
    expect(meta.weeklyRewards!.vaults).toHaveLength(1);
    openSelected(sim, '1000:0', pid);
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBe(fixed);
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].tableId).toBe(
      'varkhul_forgefather_of_the_last_flame',
    );
    expect(roll).not.toHaveBeenCalled();
  });

  it('stages a rollover without opening the vault and rolls rewards on the next visit', () => {
    const { sim, pid, meta } = make();
    const emit = vi.spyOn(sim.ctx, 'emit');
    sim.chat('/dev weeklyvault rollover', pid);
    expect(emit.mock.calls.some(([event]) => event.type === 'weekly_rewards')).toBe(false);
    expect(meta.weeklyRewards!.vaults).toEqual([]);
    expect(meta.weeklyRewards!.raids).toEqual([2, 1, 2]);
    const info = weeklyRewardInfoFor(sim.ctx, pid)!;
    expect(info.readyWeeks).toBe(1);
    // Three raid, two dungeon and two pvp choices from the fixture's progress,
    // plus the two world choices its four completions earn (thresholds 2 and 4).
    expect(info.state.vaults[0].choices).toHaveLength(9);
    expect(info.state.vaults[0].choices.filter((choice) => choice.pool === 'world')).toHaveLength(
      2,
    );
    expect(info.state.raids).toEqual([0, 0, 0]);
    expect(info.state.dungeons).toEqual([]);
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults).toEqual(info.state.vaults);
  });

  it('does not stage rollover rewards when dev commands are disabled', () => {
    const { sim, pid, meta, player } = make(42, false);
    const position = { ...player.pos };
    sim.chat('/dev weeklyvault rollover', pid);
    expect(meta.weeklyRewards).toBeUndefined();
    expect(player.pos).toEqual(position);
  });

  it('uses the best difficulty at each milestone and caps rows at three choices', () => {
    const state = emptyWeeklyRewards(WEEK);
    state.raids = [2, 1, 2];
    state.dungeons = [2, 2, 2, 1, 1, 1, 1, 1];
    state.world = 4;
    state.pvp = 3;
    expect(earnedWeeklyRolls(state)).toEqual([1, 2, 2, 1, 2, 2]);
  });
  it('earns unopened slots at reset, keeps weeks distinct, and grants nothing for inactivity', () => {
    const state = emptyWeeklyRewards(WEEK);
    state.pvp = 5;
    advanceWeeklyRewards(state, WEEK - 1, (n) => n + WEEK);
    expect(state.vaults).toHaveLength(0);
    advanceWeeklyRewards(state, WEEK, (n) => n + WEEK);
    expect(state.vaults[0].choices).toHaveLength(3);
    expect(state.pvp).toBe(0);
    state.pvp = 1;
    advanceWeeklyRewards(state, WEEK * 2, (n) => n + WEEK);
    expect(state.vaults.map((v) => v.choices.length)).toEqual([3, 1]);
    advanceWeeklyRewards(state, WEEK * 100, (n) => n + WEEK);
    advanceWeeklyRewards(state, WEEK, (n) => n + WEEK);
    expect(state.vaults.flatMap((batch) => batch.choices).every((choice) => !choice.itemId)).toBe(
      true,
    );
    expect(state.resetAtMs).toBe(WEEK * 101);
  });
  it('chooses exactly the displayed item and consumes the whole week across all rows', () => {
    function run() {
      const { sim, pid, meta } = make();
      prepareWeeklyVaultPlaytest(sim.ctx, pid);
      const state = meta.weeklyRewards!;
      const batch = state.vaults[0];
      batch.choices.forEach((_, index) => {
        openSelected(sim, `${batch.resetAtMs}:${index}`, pid);
      });
      const token = `${state.resetAtMs}:${state.claimSequence}`;
      const itemId = batch.choices[1].itemId;
      const before = meta.inventory.length;
      const pick = vi.spyOn(sim.ctx.rng, 'pick');
      sim.claimWeeklyReward(`${batch.resetAtMs}:1`, pid, token);
      sim.claimWeeklyReward(`${batch.resetAtMs}:0`, pid, token);
      expect(state.vaults).toEqual([]);
      expect(meta.inventory).toHaveLength(before + 1);
      expect(meta.inventory.at(-1)!.itemId).toBe(itemId);
      expect(pick).not.toHaveBeenCalled();
      return { itemId, nextRandom: sim.ctx.rng.next() };
    }
    expect(run()).toEqual(run());
  });
  it('refuses full bags, stale choices, distant and dead claims without consuming or redrawing', () => {
    const { sim, pid, meta, player } = make();
    prepareWeeklyVaultPlaytest(sim.ctx, pid);
    const state = meta.weeklyRewards!;
    state.vaults[0].choices.forEach((_, index) => {
      openSelected(sim, `${state.vaults[0].resetAtMs}:${index}`, pid);
    });
    const key = `${state.vaults[0].resetAtMs}:0`;
    const before = JSON.stringify(state);
    const pick = vi.spyOn(sim.ctx.rng, 'pick');
    const capacity = vi.spyOn(sim.ctx, 'canAddItem').mockReturnValue(false);
    sim.claimWeeklyReward(key, pid);
    capacity.mockRestore();
    player.pos.x += 100;
    sim.claimWeeklyReward(key, pid);
    player.pos.x -= 100;
    player.dead = true;
    sim.claimWeeklyReward(key, pid);
    player.dead = false;
    sim.claimWeeklyReward('__proto__', pid);
    sim.claimWeeklyReward(key, pid, 'stale');
    expect(JSON.stringify(state)).toBe(before);
    expect(pick).not.toHaveBeenCalled();
  });
  it('preserves exact candidates across reads, save/load and later resets; mirrors only the oldest week', () => {
    const { sim, pid, meta, setNow } = make();
    prepareWeeklyVaultPlaytest(sim.ctx, pid);
    meta.weeklyRewards!.vaults[0].choices.forEach((_, index) => {
      openSelected(sim, `${meta.weeklyRewards!.vaults[0].resetAtMs}:${index}`, pid);
    });
    const first = structuredClone(meta.weeklyRewards!.vaults[0]);
    setNow(WEEK * 2);
    const info = weeklyRewardInfoFor(sim.ctx, pid)!;
    expect(info.readyWeeks).toBe(2);
    expect(info.state.vaults[0].choices).toEqual(first.choices);
    const saved = sim.serializeCharacter(pid)!;
    meta.weeklyRewards!.vaults[0].choices[0].itemId = 'changed';
    expect(saved.weeklyRewards!.vaults[0]).toEqual(first);
    const restoredPid = sim.addPlayer('mage', 'Reloaded', { state: saved });
    const e = sim.entities.get(restoredPid)!;
    e.pos = { ...sim.entities.get(pid)!.pos };
    sim.ctx.rebucket(e);
    const pick = vi.spyOn(sim.ctx.rng, 'pick');
    expect(weeklyRewardInfoFor(sim.ctx, restoredPid)!.state.vaults[0].choices).toEqual(
      first.choices,
    );
    sim.claimWeeklyReward(`${first.resetAtMs}:0`, restoredPid);
    expect(weeklyRewardInfoFor(sim.ctx, restoredPid)!.readyWeeks).toBe(1);
    expect(pick).not.toHaveBeenCalled();
    expect(sim.serializeCharacter(restoredPid)!.weeklyRewards!.vaults).toHaveLength(1);
  });
  it('converts prototype roll counters once to a single choice set', () => {
    const { sim, pid, meta } = make();
    meta.weeklyRewards = sanitizeWeeklyRewards({ resetAtMs: WEEK, pending: [20, 20, 1, 1, 0, 2] });
    const first = weeklyRewardInfoFor(sim.ctx, pid)!;
    expect(first.readyWeeks).toBe(1);
    expect(first.state.vaults[0].choices).toHaveLength(7);
    expect(meta.weeklyRewards!.legacyPending).toBeUndefined();
    expect(weeklyRewardInfoFor(sim.ctx, pid)).toEqual(first);
  });
  it('bounds malformed saves and always advances the calendar even at the ten-year backlog limit', () => {
    const itemId = weeklyLootPool('pvp', 'mage')[0];
    const raw = {
      resetAtMs: WEEK,
      raids: [2, -1, Infinity, 2],
      dungeons: Array(100).fill(2),
      world: 999,
      pvp: 999,
      claimSequence: NaN,
      vaults: Array.from({ length: 600 }, (_, i) => ({
        resetAtMs: i + 1,
        choices: Array(100).fill({ pool: 'pvp', itemId }),
      })),
    };
    const state = sanitizeWeeklyRewards(raw)!;
    expect(state.raids).toEqual([2, 0, 0]);
    expect(state.dungeons).toHaveLength(8);
    expect(state.world).toBe(8);
    expect(state.claimSequence).toBe(0);
    expect(state.vaults).toHaveLength(WEEKLY_BACKLOG_LIMIT);
    expect(state.vaults[0].choices).toHaveLength(12);
    advanceWeeklyRewards(state, WEEK, (n) => n + WEEK);
    expect(state.resetAtMs).toBe(WEEK * 2);
    expect(state.overflowed).toBe(true);
    expect(state.raids).toEqual([0, 0, 0]);
    expect(sanitizeWeeklyRewards([])).toBeUndefined();
  });
  it('unlocks raid pools only at the defeated difficulty and fills every pool for a class', () => {
    expect(weeklyLootPool('raid', 'mage', [0, 0, 0])).toEqual([]);
    expect(weeklyLootPool('raid_heroic', 'mage', [1, 1, 1])).toEqual([]);
    expect(weeklyLootPool('raid', 'mage', [0, 0, 1])).toContain('orb_of_the_last_spring');
    for (const pool of WEEKLY_POOL_IDS) {
      const ids = weeklyLootPool(pool, 'mage');
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids)
        if (ITEMS[id].requiredClass) expect(ITEMS[id].requiredClass).toContain('mage');
    }
    expect(weeklyLootPool('dungeon', 'mage')).not.toContain('boundstone_girdle');
    expect(weeklyLootPool('dungeon', 'mage')).not.toContain('gravewyrm_mantle');
    // The world row is ungated by raid kills: the previous tier is the catch-up
    // shelf (tests/weekly_vault_world_row.test.ts pins its tier and contents).
    expect(weeklyLootPool('world', 'mage', [0, 0, 0])).toEqual(weeklyLootPool('world', 'mage'));
  });
  it('opens rewards at a dedicated keeper without granting bank access', () => {
    const { sim, pid } = make();
    expect(sim.bankerIds).not.toContain(WEEKLY_KEEPER_ENTITY_ID);
    expect(sim.bankInfoFor(pid)).toBeNull();
    sim.targetEntity(WEEKLY_KEEPER_ENTITY_ID, pid);
    sim.interact(pid);
    expect(sim.tick().some((event) => event.type === 'weekly_rewards')).toBe(true);
    expect(weeklyRewardInfoFor(sim.ctx, pid)).not.toBeNull();
  });
  it('Talk opens the keeper menu only while alive and nearby', () => {
    const { sim, pid, player } = make();
    sim.talkToNpc(WEEKLY_KEEPER_ENTITY_ID, pid);
    expect(sim.tick().some((e) => e.type === 'weekly_rewards' && e.pid === pid)).toBe(true);
    player.pos.x -= 30;
    sim.talkToNpc(WEEKLY_KEEPER_ENTITY_ID, pid);
    expect(sim.tick().some((e) => e.type === 'weekly_rewards')).toBe(false);
    player.pos.x += 30;
    player.dead = true;
    sim.talkToNpc(WEEKLY_KEEPER_ENTITY_ID, pid);
    expect(sim.tick().some((e) => e.type === 'weekly_rewards')).toBe(false);
  });
  it.each(['2026-03-03T08:00:00Z', '2026-10-27T07:00:00Z'])(
    'uses the Crucible calendar across DST after %s',
    (instant) => {
      const now = Date.parse(instant);
      const state = emptyWeeklyRewards(now);
      state.pvp = 1;
      advanceWeeklyRewards(state, now, nextWeeklyRaidResetMs, () => true);
      expect(state.resetAtMs).toBe(nextWeeklyRaidResetMs(now));
      expect(state.resetAtMs - now).not.toBe(WEEK);
    },
  );
});

describe('weekly activity completion hooks', () => {
  it.each(['nythraxis_boss_arena', 'ignivar_raid_arena', 'ignivar_inner_crucible'])(
    'credits and upgrades the unique raid boss in %s',
    (dungeonId) => {
      const { sim, pid, meta, player } = make();
      const partyIds = [
        pid,
        sim.addPlayer('mage', 'Absent'),
        sim.addPlayer('mage', 'NeverEntered'),
        sim.addPlayer('mage', 'Leaving'),
      ];
      sim.partyInvite(partyIds[1], pid);
      sim.partyAccept(partyIds[1]);
      sim.partyInvite(partyIds[2], pid);
      sim.partyAccept(partyIds[2]);
      sim.partyInvite(partyIds[3], pid);
      sim.partyAccept(partyIds[3]);
      const inst = freshInstanceSlot(dungeonId, 0);
      // The existing owning slot is unused in this isolated world.
      inst.partyKey = `party:${sim.ctx.partyOf(pid)!.id}`;
      inst.enteredBy = new Set([pid, partyIds[1], partyIds[3]]);
      sim.instances.push(inst);
      sim.players.get(partyIds[3])!.leaving = true;
      for (const difficulty of ['normal', 'heroic'] as const) {
        inst.difficulty = difficulty;
        const template = MOBS[HEROIC_DUNGEON_TUNING[dungeonId].finalBossId];
        const boss = createMob(
          sim.ctx.nextId++,
          template,
          template.maxLevel,
          sim.ctx.groundPos(100, -300),
        );
        // Stage the final damageable phase; Varkhul spawns with an intermission health floor.
        boss.damageFloorHp = undefined;
        sim.ctx.addEntity(boss);
        inst.mobIds = [boss.id];
        player.pos = { ...boss.pos };
        player.prevPos = { ...player.pos };
        sim.ctx.rebucket(player);
        sim.ctx.dealDamage(player, boss, boss.hp * 100, false, 'physical', null, 'hit');
        if (difficulty === 'normal' && dungeonId !== 'nythraxis_boss_arena')
          expect(meta.raidLockouts.get(dungeonId)).toBe(meta.weeklyRewards!.resetAtMs);
        expect(meta.weeklyRewards!.raids.filter(Boolean)).toEqual([
          difficulty === 'heroic' ? 2 : 1,
        ]);
        expect(sim.players.get(partyIds[1])!.weeklyRewards!.raids).toEqual(
          meta.weeklyRewards!.raids,
        );
        expect(sim.players.get(partyIds[2])!.weeklyRewards).toBeUndefined();
        expect(sim.players.get(partyIds[3])!.weeklyRewards).toBeUndefined();
      }
    },
  );
  it('counts fresh normal dungeon clears through the fourth and eighth milestones', () => {
    const { sim, pid, meta, player } = make();
    for (let run = 1; run <= 9; run++) {
      enterDungeon(sim.ctx, 'hollow_crypt', pid);
      const inst = sim.instances.find(
        (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
      )!;
      const boss = inst.mobIds
        .map((id) => sim.entities.get(id)!)
        .find((e) => e?.templateId === 'morthen')!;
      player.pos = { ...boss.pos, x: boss.pos.x + 1 };
      player.prevPos = { ...player.pos };
      sim.ctx.rebucket(player);
      sim.ctx.dealDamage(player, boss, boss.hp * 100, false, 'physical', null, 'hit');
      expect(meta.weeklyRewards!.dungeons).toHaveLength(Math.min(run, 8));
      expect(earnedWeeklyRolls(meta.weeklyRewards!)[2]).toBe(run >= 8 ? 3 : run >= 4 ? 2 : 1);
      leaveDungeon(sim.ctx, pid);
      inst.emptyFor = INSTANCE_CLEARED_EMPTY_TIMEOUT;
      updateInstances(sim.ctx);
      expect(inst.partyKey).toBeNull();
    }
  });

  it.each(['normal', 'heroic'] as const)(
    'credits a real %s dungeon finale once through the death path',
    (difficulty) => {
      const { sim, pid, meta, player } = make();
      if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', pid);
      enterDungeon(sim.ctx, 'hollow_crypt', pid);
      const instance = sim.instances.find(
        (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
      )!;
      const boss = instance.mobIds
        .map((id) => sim.entities.get(id)!)
        .find((e) => e?.templateId === 'morthen')!;
      player.pos = { ...boss.pos, x: boss.pos.x + 1 };
      player.prevPos = { ...player.pos };
      sim.ctx.rebucket(player);
      sim.ctx.dealDamage(player, boss, boss.hp * 100, false, 'physical', null, 'hit');
      sim.ctx.dealDamage(player, boss, 100, false, 'physical', null, 'hit');
      expect(meta.weeklyRewards!.dungeons).toEqual([difficulty === 'heroic' ? 2 : 1]);
    },
  );
  it.each(['defeat', 'forfeit'] as const)(
    'counts only played ranked arena wins (%s), with a once-only result guard',
    (reason) => {
      const { sim, pid, meta } = make();
      const other = sim.addPlayer('warrior', 'Opponent');
      startArenaMatch(sim.ctx, '1v1', [pid], [other]);
      const match = [...sim.arenaMatches.values()][0];
      endArenaMatch(sim.ctx, match, 'A', reason);
      endArenaMatch(sim.ctx, match, 'A', reason);
      expect(meta.weeklyRewards?.pvp ?? 0).toBe(reason === 'defeat' ? 1 : 0);
      expect(sim.players.get(other)!.weeklyRewards?.pvp ?? 0).toBe(0);
    },
  );
  it.each([true, false])('counts battleground wins only when rated (%s)', (rated) => {
    const { sim, pid, meta } = make();
    const other = sim.addPlayer('warrior', 'Opponent');
    startBgMatch(sim.ctx, [pid], [other], { rated });
    const match = [...sim.bgMatches.values()][0];
    endBgMatch(sim.ctx, match, 0, 'caps');
    endBgMatch(sim.ctx, match, 0, 'caps');
    expect(meta.weeklyRewards?.pvp ?? 0).toBe(rated ? 1 : 0);
  });
});
