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
import {
  advanceWeeklyRewards,
  earnedWeeklyRolls,
  emptyWeeklyRewards,
  finishWeeklyRewardOpen,
  prepareWeeklyRewardOpen,
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
function make(seed = 42, devCommands = true) {
  let now = 1000;
  const sim = new Sim({
    seed,
    playerClass: 'mage',
    noPlayer: true,
    devCommands,
    world: WORLD,
    lockoutNowMs: () => now,
    weeklyRaidResetMs: (n) => (Math.floor(n / WEEK) + 1) * WEEK,
  });
  const pid = sim.addPlayer('mage', 'Collector');
  const player = sim.entities.get(pid)!;
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

describe('weekly vault choices', () => {
  it('rolls only on opening and conceals pending items until the host acknowledges durability', () => {
    const { sim, pid, meta } = make();
    const roll = vi.spyOn(sim.ctx.rng, 'pick');
    prepareWeeklyVaultPlaytest(sim.ctx, pid, true);
    const info = weeklyRewardInfoFor(sim.ctx, pid)!;
    const batch = meta.weeklyRewards!.vaults[0];
    expect(roll).not.toHaveBeenCalled();
    expect(info.state.vaults[0].choices.every((choice) => !choice.itemId)).toBe(true);
    const opening = prepareWeeklyRewardOpen(sim.ctx, `${batch.resetAtMs}:0`, pid)!;
    expect(roll).toHaveBeenCalledOnce();
    expect(JSON.stringify(weeklyRewardInfoFor(sim.ctx, pid))).not.toContain(opening.itemId);
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.weeklyRewards!.vaults[0].choices[0]).toEqual({
      pool: opening.choice.pool,
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
      vaults: [{ resetAtMs: 1000, choices: [{ pool: 'raid', itemId: fixed }] }],
    });
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0]).toEqual({ pool: 'raid' });
    const roll = vi.spyOn(sim.ctx.rng, 'pick');
    sim.claimWeeklyReward('1000:0', pid);
    expect(meta.weeklyRewards!.vaults).toHaveLength(1);
    sim.openWeeklyReward('1000:0', pid);
    expect(weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices[0].itemId).toBe(fixed);
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
    expect(info.state.vaults[0].choices).toHaveLength(7);
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
        sim.openWeeklyReward(`${batch.resetAtMs}:${index}`, pid);
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
      sim.openWeeklyReward(`${state.vaults[0].resetAtMs}:${index}`, pid);
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
      sim.openWeeklyReward(`${meta.weeklyRewards!.vaults[0].resetAtMs}:${index}`, pid);
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
  it('unlocks raid pools only at the defeated difficulty and keeps world rewards unavailable', () => {
    expect(weeklyLootPool('raid', 'mage', [0, 0, 0])).toEqual([]);
    expect(weeklyLootPool('raid_heroic', 'mage', [1, 1, 1])).toEqual([]);
    expect(weeklyLootPool('raid', 'mage', [0, 0, 1])).toContain('orb_of_the_last_spring');
    for (const pool of WEEKLY_POOL_IDS.filter((p) => p !== 'world')) {
      const ids = weeklyLootPool(pool, 'mage');
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids)
        if (ITEMS[id].requiredClass) expect(ITEMS[id].requiredClass).toContain('mage');
    }
    expect(weeklyLootPool('dungeon', 'mage')).not.toContain('boundstone_girdle');
    expect(weeklyLootPool('dungeon', 'mage')).not.toContain('gravewyrm_mantle');
    expect(weeklyLootPool('world', 'mage')).toEqual([]);
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
