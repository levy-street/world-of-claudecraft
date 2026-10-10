import { describe, expect, it, vi } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { BUILTIN_WORLD, ITEMS, NPCS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { weeklyLootSpecFitsItem } from '../src/sim/weekly_loot_spec';
import { weeklyRewardTableOptions } from '../src/sim/weekly_reward_options';
import { WEEKLY_BOSS_TABLES } from '../src/sim/weekly_reward_tables';
import {
  emptyWeeklyRewards,
  finishWeeklyRewardOpen,
  prepareWeeklyRewardOpen,
  setWeeklyLootSpec,
  WEEKLY_KEEPER_ID,
  WEEKLY_POOL_IDS,
  type WeeklyPoolId,
  type WeeklyVaultBatch,
  weeklyRewardInfoFor,
} from '../src/sim/weekly_rewards';

const WEEK = 604800000;
const SPECS = Object.entries(TALENTS).flatMap(([cls, tree]) =>
  tree.specs.map((spec) => [cls as PlayerClass, spec.id] as const),
);
const WORLD = {
  ...BUILTIN_WORLD,
  camps: [],
  groundObjects: [],
  npcs: { [WEEKLY_KEEPER_ID]: NPCS[WEEKLY_KEEPER_ID] },
};
function batch(pool: WeeklyPoolId = 'world'): WeeklyVaultBatch {
  return {
    resetAtMs: 1000,
    raidUnlocks: [2, 2, 2],
    bossUnlocks: Object.fromEntries(WEEKLY_BOSS_TABLES.map(({ bossId }) => [bossId, 2])),
    choices: [{ pool }],
  };
}
function setup(cls: PlayerClass = 'paladin') {
  const sim = new Sim({
    seed: 42,
    noPlayer: true,
    playerClass: cls,
    world: WORLD,
    lockoutNowMs: () => 2000,
    weeklyRaidResetMs: () => WEEK,
  });
  const pid = sim.addPlayer(cls, 'FocusedCollector');
  const player = sim.entities.get(pid)!;
  const keeper = [...sim.entities.values()].find((e) => e.templateId === WEEKLY_KEEPER_ID)!;
  player.level = 20;
  player.pos = { ...keeper.pos };
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
  const meta = sim.players.get(pid)!;
  const state = emptyWeeklyRewards(WEEK);
  state.vaults = [batch()];
  meta.weeklyRewards = state;
  return { sim, pid, player, keeper, meta, state };
}
function tables(h: ReturnType<typeof setup>) {
  const current = h.state.vaults[0];
  return weeklyRewardTableOptions(current, current.choices[0], h.meta.cls, 20, h.state.lootSpec);
}
function prepare(h: ReturnType<typeof setup>, token?: string) {
  return prepareWeeklyRewardOpen(
    h.sim.ctx,
    '1000:0',
    h.pid,
    token,
    tables(h).map((t) => t.id),
  );
}

describe('Weekly Vault loot focus integration', () => {
  it.each(SPECS)(
    'rolls %s %s from exactly the focused preview in every reward pool',
    (cls, spec) => {
      const h = setup(cls);
      h.sim.setWeeklyLootSpec(spec, h.pid);
      expect(h.state.lootSpec).toBe(spec);
      const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
      let rolledPools = 0;
      for (const pool of WEEKLY_POOL_IDS) {
        const current = batch(pool);
        h.state.vaults = [current];
        const base = weeklyRewardTableOptions(current, current.choices[0], cls, 20);
        const options = tables(h);
        const expected = base.flatMap((table) => {
          const items = table.items.filter((id) => weeklyLootSpecFitsItem(cls, spec, ITEMS[id]));
          return items.length ? [{ ...table, items }] : [];
        });
        expect(options, `${cls}:${spec}:${pool}`).toEqual(expected);
        const candidates = [...new Set(options.flatMap((table) => table.items))].sort();
        pick.mockClear();
        const opening = prepare(h);
        if (!candidates.length) {
          expect(opening).toBeNull();
          expect(pick).not.toHaveBeenCalled();
          continue;
        }
        rolledPools++;
        expect(opening).not.toBeNull();
        expect(pick.mock.calls).toEqual([[candidates]]);
        expect(candidates).toContain(opening!.itemId);
        expect(opening!.choice.lootSpec).toBe(spec);
        finishWeeklyRewardOpen(opening!, true);
        expect(weeklyRewardInfoFor(h.sim.ctx, h.pid)!.state.vaults[0].choices[0]).toMatchObject({
          itemId: opening!.itemId,
          lootSpec: spec,
          opened: true,
        });
      }
      expect(rolledPools).toBeGreaterThanOrEqual(4);
    },
  );

  it('authorizes the setter at the living keeper and increments the token only on actual changes', () => {
    const h = setup();
    const draws = vi.fn();
    h.sim.ctx.rng.setObserver(draws);
    for (const invalid of ['prot', 'fire', '', 'constructor', '__proto__']) {
      setWeeklyLootSpec(h.sim.ctx, invalid, h.pid);
    }
    setWeeklyLootSpec(h.sim.ctx, null, h.pid);
    expect(h.state.claimSequence).toBe(0);
    h.sim.setWeeklyLootSpec('protection', h.pid);
    expect(h.state.claimSequence).toBe(1);
    h.sim.setWeeklyLootSpec('protection', h.pid);
    expect(h.state.claimSequence).toBe(1);
    h.sim.setWeeklyLootSpec('holy', h.pid);
    h.sim.setWeeklyLootSpec('protection', h.pid);
    expect(h.state.claimSequence).toBe(3);
    expect(prepare(h, `${WEEK}:1`)).toBeNull();
    h.sim.setWeeklyLootSpec(null, h.pid);
    expect(h.state.lootSpec).toBeUndefined();
    expect(h.state.claimSequence).toBe(4);
    expect(draws).not.toHaveBeenCalled();
    for (const block of ['away', 'dead', 'leaving', 'keeperDead', 'missingPlayer'] as const) {
      h.player.pos = { ...h.keeper.pos };
      h.player.dead = block === 'dead';
      h.meta.leaving = block === 'leaving';
      h.keeper.dead = block === 'keeperDead';
      if (block === 'away') h.player.pos.x += 100;
      setWeeklyLootSpec(h.sim.ctx, 'holy', block === 'missingPlayer' ? -1 : h.pid);
      expect(h.state.lootSpec, block).toBeUndefined();
      expect(h.state.claimSequence, block).toBe(4);
    }
    expect(draws).not.toHaveBeenCalled();
  });

  it('refuses a focus change when its revision cannot advance safely', () => {
    const h = setup();
    h.state.claimSequence = Number.MAX_SAFE_INTEGER;
    h.sim.setWeeklyLootSpec('holy', h.pid);
    expect(h.state.lootSpec).toBeUndefined();
    expect(h.state.claimSequence).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('does not fall back or draw randomness when focus removes a source table', () => {
    const h = setup('warrior');
    h.sim.setWeeklyLootSpec('arms', h.pid);
    // Reserve this week's Arms-compatible drops from one actual boss, leaving
    // class-compatible one-handers behind. Focus must not widen to those items.
    const current = batch('dungeon');
    let excluded: WeeklyVaultBatch | undefined;
    for (const { bossId, category } of WEEKLY_BOSS_TABLES) {
      if (category !== 'dungeon') continue;
      const candidate: WeeklyVaultBatch = { ...current, bossUnlocks: { [bossId]: 2 } };
      const base = weeklyRewardTableOptions(candidate, candidate.choices[0], 'warrior', 20);
      const focused = weeklyRewardTableOptions(
        candidate,
        candidate.choices[0],
        'warrior',
        20,
        'arms',
      );
      const baseIds = new Set(base.flatMap((table) => table.items));
      const focusedIds = [...new Set(focused.flatMap((table) => table.items))];
      if (!focusedIds.length || focusedIds.length >= 12 || baseIds.size <= focusedIds.length)
        continue;
      candidate.choices = [
        { pool: 'dungeon' },
        ...focusedIds.map((itemId) => ({
          pool: 'dungeon' as const,
          itemId,
          opened: true as const,
        })),
      ];
      excluded = candidate;
      break;
    }
    expect(excluded).toBeDefined();
    expect(excluded!.choices.length).toBeLessThanOrEqual(12);
    expect(
      weeklyRewardTableOptions(excluded!, excluded!.choices[0], 'warrior', 20, 'arms'),
    ).toEqual([]);
    h.state.vaults = [excluded!];
    const draws = vi.fn();
    h.sim.ctx.rng.setObserver(draws);
    const ids = weeklyRewardTableOptions(excluded!, excluded!.choices[0], 'warrior', 20).map(
      (t) => t.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(prepareWeeklyRewardOpen(h.sim.ctx, '1000:0', h.pid, undefined, ids)).toBeNull();
    expect(draws).not.toHaveBeenCalled();
    expect(excluded!.choices[0]).toEqual({ pool: 'dungeon' });
  });

  it('persists current focus separately from a fixed reward and retries failed saves without rerolling', () => {
    const h = setup();
    h.sim.setWeeklyLootSpec('protection', h.pid);
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    const opening = prepare(h)!;
    expect(opening).not.toBeNull();
    finishWeeklyRewardOpen(opening, false);
    h.sim.setWeeklyLootSpec('holy', h.pid);
    expect(
      weeklyRewardInfoFor(h.sim.ctx, h.pid)!.state.vaults[0].choices[0].itemId,
    ).toBeUndefined();
    const retry = prepare(h)!;
    expect(retry.itemId).toBe(opening.itemId);
    expect(retry.choice.lootSpec).toBe('protection');
    expect(pick).toHaveBeenCalledTimes(1);
    expect(retry.choice).toMatchObject({ pendingSave: true, opening: true });
    const pendingSaved = h.sim.serializeCharacter(h.pid)!;
    const savedChoice = pendingSaved.weeklyRewards!.vaults[0].choices[0];
    expect(pendingSaved.weeklyRewards!.lootSpec).toBe('holy');
    expect(savedChoice).toMatchObject({
      itemId: opening.itemId,
      lootSpec: 'protection',
      opened: true,
    });
    expect(savedChoice.pendingSave).toBeUndefined();
    expect(savedChoice.opening).toBeUndefined();
    finishWeeklyRewardOpen(retry, true);
    const saved = h.sim.serializeCharacter(h.pid)!;
    const restoredPid = h.sim.addPlayer('paladin', 'AfterReconnect', { state: saved });
    const restored = h.sim.players.get(restoredPid)!.weeklyRewards!;
    expect(restored.lootSpec).toBe('holy');
    expect(restored.vaults[0].choices[0]).toMatchObject({
      itemId: opening.itemId,
      lootSpec: 'protection',
      opened: true,
    });
    expect(restored.vaults[0].choices[0].pendingSave).toBeUndefined();
    const before = h.sim.ctx.countItem(opening.itemId, h.pid);
    h.sim.claimWeeklyReward('1000:0', h.pid);
    h.sim.claimWeeklyReward('1000:0', h.pid);
    h.sim.openWeeklyReward('1000:0', 'world', h.pid);
    expect(h.sim.ctx.countItem(opening.itemId, h.pid)).toBe(before + 1);
    expect(h.state.vaults).toEqual([]);
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('strips absent, malformed, unknown, and wrong-class preferences at character load', () => {
    const h = setup();
    const saved = h.sim.serializeCharacter(h.pid)!;
    for (const raw of [
      undefined,
      null,
      1,
      {},
      [],
      '',
      'constructor',
      '__proto__',
      'unknown',
      'prot',
      'fire',
    ]) {
      // Deliberately corrupt the untrusted save boundary, including non-string data.
      const corrupted = {
        ...saved,
        weeklyRewards: { ...saved.weeklyRewards!, lootSpec: raw },
      };
      const restoredPid = h.sim.addPlayer('paladin', 'InvalidFocus', {
        state: corrupted as typeof saved,
      });
      const restored = h.sim.players.get(restoredPid)!.weeklyRewards!;
      expect(restored).toBeDefined();
      expect(restored.lootSpec).toBeUndefined();
      expect(restored.vaults[0].choices).toEqual([{ pool: 'world' }]);
    }
  });

  it('validates captured focus globally and independently of the current character class', () => {
    const h = setup();
    const saved = h.sim.serializeCharacter(h.pid)!;
    saved.weeklyRewards!.lootSpec = 'protection';
    saved.weeklyRewards!.vaults[0].choices = [
      { pool: 'world', itemId: 'bastion_sigil', opened: true, lootSpec: 'fire' },
      { pool: 'world', itemId: 'mooring_stone', opened: true, lootSpec: 'unknown' },
      { pool: 'world', lootSpec: 'holy' },
    ];
    const restoredPid = h.sim.addPlayer('paladin', 'CapturedFocus', { state: saved });
    const restored = h.sim.players.get(restoredPid)!.weeklyRewards!;
    expect(restored.lootSpec).toBe('protection');
    expect(restored.vaults[0].choices).toEqual([
      { pool: 'world', itemId: 'bastion_sigil', opened: true, lootSpec: 'fire' },
      { pool: 'world', itemId: 'mooring_stone', opened: true },
      { pool: 'world' },
    ]);
  });

  it('keeps concealed legacy rewards fixed in all-class mode after selecting a different focus', () => {
    const h = setup();
    h.state.vaults[0].choices[0] = { pool: 'world', itemId: 'forgefathers_temper' };
    h.sim.setWeeklyLootSpec('holy', h.pid);
    const pick = vi.spyOn(h.sim.ctx.rng, 'pick');
    const opening = prepare(h)!;
    expect(opening.itemId).toBe('forgefathers_temper');
    expect(opening.choice.lootSpec).toBeUndefined();
    finishWeeklyRewardOpen(opening, true);
    const canAdd = vi.spyOn(h.sim.ctx, 'canAddItem').mockReturnValue(false);
    h.sim.claimWeeklyReward('1000:0', h.pid);
    expect(h.state.vaults[0].choices[0].itemId).toBe('forgefathers_temper');
    canAdd.mockRestore();
    h.sim.claimWeeklyReward('1000:0', h.pid);
    expect(h.sim.ctx.countItem('forgefathers_temper', h.pid)).toBe(1);
    expect(pick).not.toHaveBeenCalled();
  });
});
