// The Smith's Heart's weekly per-boss lockout (the owner's ruling of
// 2026-11-28; src/sim/instances/raid_boss_lockout.ts, the id leaf
// src/sim/raid_boss_lockout_id.ts, the corpse gate src/sim/loot/boss_loot_lock.ts):
// each of its five encounters saves the character on that difficulty until the
// weekly raid reset; a saved character may still enter and help, but the boss
// pays them nothing that week (no loot roll, no quest drop, no corpse rights,
// no Weekly Vault raid clear, no weekly raid quest); every boss of the raid
// credits the weekly RAID quest and the vault's RAID row, never the dungeon
// ones; old saves load; the ids ride the existing save and wire unchanged.
import { describe, expect, it } from 'vitest';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from '../src/sim/content/smith_heart';
import {
  SMITH_HEART_ESSENCE_ITEM,
  SMITH_HEART_ESSENCE_QUEST,
} from '../src/sim/content/smith_heart_rewards';
import { WEEKLY_QUESTS_BY_ID } from '../src/sim/content/weekly_quests';
import { BUILTIN_WORLD, DUNGEONS } from '../src/sim/data';
import {
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { bossLockoutOf } from '../src/sim/instances/raid_boss_lockout';
import { bossLootDenied } from '../src/sim/loot/boss_loot_lock';
import { partyLootCandidatesForMob } from '../src/sim/loot/loot_roll';
import {
  bossLockoutId,
  PER_BOSS_LOCKOUT_RAIDS,
  parseBossLockoutId,
} from '../src/sim/raid_boss_lockout_id';
import { activeRaidLockouts, lockoutKind } from '../src/sim/raid_lockout_state';
import { isRaidRoom } from '../src/sim/raid_rooms';
import { type CharacterState, type InstanceSlot, type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { currentWeeklyQuestWeek } from '../src/sim/weekly_quests';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const WEEK = 7 * 24 * 60 * 60 * 1000;
/** The realm's weekly raid reset (a fixed boundary every 7 days). */
const nextReset = (nowMs: number): number => (Math.floor(nowMs / WEEK) + 1) * WEEK;
/** A moment two days into some week. */
const T0 = 2900 * WEEK + 2 * 24 * 60 * 60 * 1000;

const COUNCIL_LOCK = `smith_heart:${COUNCIL_GUARDIAN}`;
const BREATH_LOCK = `smith_heart:${SMITH_HEART_GUARDIANS.breath}`;
const FINAL_LOCK = `smith_heart:${SMITH_HEART_FINAL_BOSS}`;

interface Raid {
  sim: Sim;
  inst: InstanceSlot;
  pids: number[];
  clock: { now: number };
}

/** A Smith's Heart claim (the dev door) for a party of the named raiders, each
 *  optionally loaded from a save; all of them inside. */
function raid(
  names: readonly string[],
  opts: {
    seed?: number;
    clock?: { now: number };
    states?: readonly (CharacterState | undefined)[];
    heroic?: boolean;
  } = {},
): Raid {
  const clock = opts.clock ?? { now: T0 };
  const sim = new Sim({
    seed: opts.seed ?? 31,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
    lockoutNowMs: () => clock.now,
    weeklyRaidResetMs: nextReset,
  });
  const pids = names.map((name, i) => {
    const state = opts.states?.[i];
    return sim.addPlayer('warrior', name, state ? { state } : undefined);
  });
  for (const pid of pids.slice(1)) {
    sim.partyInvite(pid, pids[0]);
    sim.partyAccept(pid);
  }
  for (const pid of pids) {
    if (!enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)) throw new Error(`enter ${pid}`);
  }
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
  ) as InstanceSlot;
  if (opts.heroic) inst.difficulty = 'heroic';
  return { sim, inst, pids, clock };
}

function meta(r: Raid, i = 0): PlayerMeta {
  const m = r.sim.meta(r.pids[i]);
  if (!m) throw new Error('meta');
  return m;
}

function body(r: Raid, mobId: string): Entity {
  const index = DUNGEONS[r.inst.dungeonId].spawns.findIndex((s) => s.mobId === mobId);
  const mob = r.sim.ctx.entities.get(r.inst.mobIds[index]);
  if (!mob) throw new Error(`${mobId} not placed`);
  return mob;
}

/** The boss dies to the first raider's blow; the death hub runs for real. */
function kill(r: Raid, mobId: string, killerIndex = 0): Entity {
  const mob = body(r, mobId);
  r.sim.ctx.handleDeath(mob, r.sim.ctx.entities.get(r.pids[killerIndex]) as Entity);
  return mob;
}

function killCouncil(r: Raid): void {
  kill(r, COUNCIL_SEAM_SINGER);
  kill(r, COUNCIL_GUARDIAN);
}

/** The charge picked at the emissary this week (set directly). */
function armWeekly(r: Raid, questId: string, i = 0): void {
  r.sim.resetDay = '2026-11-24';
  meta(r, i).weeklyQuest = {
    questId,
    week: currentWeeklyQuestWeek(r.sim.ctx),
    count: 0,
    state: 'active',
  };
}

function onEssenceQuest(r: Raid, i: number): void {
  meta(r, i).questLog.set(SMITH_HEART_ESSENCE_QUEST, {
    questId: SMITH_HEART_ESSENCE_QUEST,
    counts: [0],
    state: 'active',
  });
}

function save(r: Raid, i = 0): CharacterState {
  const state = r.sim.serializeCharacter(r.pids[i]);
  if (!state) throw new Error('serialize');
  return state;
}

describe('the per-boss lock id', () => {
  it('names one boss on one difficulty, and parses only its own raids', () => {
    expect([...PER_BOSS_LOCKOUT_RAIDS]).toEqual([SMITH_HEART_DUNGEON]);
    expect(bossLockoutId('smith_heart', COUNCIL_GUARDIAN, 'normal')).toBe(
      'smith_heart:heart_hammer_guardian',
    );
    expect(bossLockoutId('smith_heart', COUNCIL_GUARDIAN, 'heroic')).toBe(
      'smith_heart:heart_hammer_guardian:heroic',
    );
    expect(parseBossLockoutId('smith_heart:heart_breath_guardian:heroic')).toEqual({
      raidId: 'smith_heart',
      encounterId: 'heart_breath_guardian',
      difficulty: 'heroic',
    });
    expect(parseBossLockoutId('smith_heart:heart_breath_guardian')?.difficulty).toBe('normal');
    // Every older id keeps its own meaning.
    for (const id of [
      'smith_heart',
      'smith_heart:heroic',
      'smith_heart:normal:heroic',
      'ignivar_raid_arena',
      'ignivar_raid_arena:heroic',
      'nythraxis_boss_arena:heroic',
      'hollow_crypt:heroic',
      'worldboss:mirefen_tyrant',
      'weeklyquest:q_x',
      'smith_heart:heart_breath_guardian:mythic',
      'smith_heart:Bad Id',
      'smith_heart:a:heroic:x',
    ]) {
      expect(parseBossLockoutId(id), id).toBeNull();
    }
    expect(isRaidRoom(SMITH_HEART_DUNGEON)).toBe(false);
  });

  it('groups as a raid lockout on character select, both difficulties', () => {
    expect(lockoutKind(COUNCIL_LOCK)).toBe('raid');
    expect(lockoutKind(`${FINAL_LOCK}:heroic`)).toBe('raid');
    expect(lockoutKind('ignivar_raid_arena:heroic')).toBe('raid');
    expect(lockoutKind('hollow_crypt:heroic')).toBe('dungeon');
  });

  it('keys each of the five encounters, the council under its first member', () => {
    const r = raid(['Anna']);
    const ids = [
      ...SMITH_HEART_COUNCIL,
      SMITH_HEART_GUARDIANS.breath,
      SMITH_HEART_GUARDIANS.quench,
      SMITH_HEART_GUARDIANS.heat,
      SMITH_HEART_FINAL_BOSS,
    ].map((mobId) => bossLockoutOf(r.inst, mobId)?.lockId);
    expect(ids).toEqual([
      COUNCIL_LOCK,
      COUNCIL_LOCK,
      BREATH_LOCK,
      `smith_heart:${SMITH_HEART_GUARDIANS.quench}`,
      `smith_heart:${SMITH_HEART_GUARDIANS.heat}`,
      FINAL_LOCK,
    ]);
    const trash = DUNGEONS[SMITH_HEART_DUNGEON].spawns.find(
      (s) => bossLockoutOf(r.inst, s.mobId) === null,
    );
    expect(trash).toBeDefined();
    // The per-room raids never take a per-boss lock.
    const crucible = { ...r.inst, dungeonId: 'ignivar_raid_arena' };
    expect(bossLockoutOf(crucible, 'ignivar_herald_of_the_last_flame')).toBeNull();
  });
});

describe('the lock: per boss, per difficulty, to the weekly reset', () => {
  it('a council kill saves the raid to the council alone, until the weekly reset', () => {
    const r = raid(['Anna', 'Bea']);
    kill(r, COUNCIL_SEAM_SINGER);
    // The council locks with its LAST member.
    expect(meta(r).raidLockouts.size).toBe(0);
    kill(r, COUNCIL_GUARDIAN);
    for (const i of [0, 1]) {
      expect([...meta(r, i).raidLockouts]).toEqual([[COUNCIL_LOCK, nextReset(T0)]]);
    }
    // The IWorld read the HUD and the journal take (the offline primary).
    expect(r.sim.raidLockouts()).toEqual([{ id: COUNCIL_LOCK, msRemaining: nextReset(T0) - T0 }]);
    kill(r, SMITH_HEART_GUARDIANS.breath);
    expect([...meta(r).raidLockouts.keys()].sort()).toEqual([BREATH_LOCK, COUNCIL_LOCK]);
  });

  it('a Heroic kill locks apart from Normal', () => {
    const r = raid(['Anna'], { heroic: true });
    kill(r, SMITH_HEART_FINAL_BOSS);
    expect([...meta(r).raidLockouts.keys()]).toEqual([`${FINAL_LOCK}:heroic`]);
    // Saved on Heroic, still free on Normal: a Normal run pays in full.
    const normal = raid(['Anna'], { seed: 32, clock: r.clock, states: [save(r)] });
    onEssenceQuest(normal, 0);
    const corpse = kill(normal, SMITH_HEART_FINAL_BOSS);
    expect(corpse.loot?.items.map((s) => s.itemId)).toEqual([SMITH_HEART_ESSENCE_ITEM]);
    expect([...meta(normal).raidLockouts.keys()].sort()).toEqual([
      FINAL_LOCK,
      `${FINAL_LOCK}:heroic`,
    ]);
  });

  it('lifts at the weekly boundary: the next week the boss pays again', () => {
    const first = raid(['Anna']);
    kill(first, SMITH_HEART_FINAL_BOSS);
    const clock = { now: T0 };
    const second = raid(['Anna'], { seed: 33, clock, states: [save(first)] });
    expect(meta(second).raidLockouts.get(FINAL_LOCK)).toBe(nextReset(T0));
    clock.now = nextReset(T0) - 1;
    onEssenceQuest(second, 0);
    expect(kill(second, SMITH_HEART_FINAL_BOSS).loot).toBeNull();
    // Past the reset: a fresh claim, a fresh lock, and the drop is back.
    clock.now = nextReset(T0) + 1;
    const third = raid(['Anna'], { seed: 34, clock, states: [save(second)] });
    onEssenceQuest(third, 0);
    expect(kill(third, SMITH_HEART_FINAL_BOSS).loot?.items[0]?.itemId).toBe(
      SMITH_HEART_ESSENCE_ITEM,
    );
    expect(meta(third).raidLockouts.get(FINAL_LOCK)).toBe(nextReset(clock.now));
  });

  it('a saved helper keeps the boundary they were saved to', () => {
    const clock = { now: T0 };
    const first = raid(['Anna'], { clock });
    kill(first, SMITH_HEART_GUARDIANS.heat);
    const until = meta(first).raidLockouts.get(`smith_heart:${SMITH_HEART_GUARDIANS.heat}`);
    // A host whose reset slides (the offline flat week) never extends a lock.
    const second = raid(['Anna', 'Bea'], { seed: 35, clock, states: [save(first)] });
    clock.now += 60_000;
    kill(second, SMITH_HEART_GUARDIANS.heat, 1);
    expect(meta(second).raidLockouts.get(`smith_heart:${SMITH_HEART_GUARDIANS.heat}`)).toBe(until);
  });

  it('strikes the whole owning group, even a member who stayed outside', () => {
    const r = raid(['Anna', 'Bea']);
    // Bea steps back out to the overworld: still the claim's group.
    const bea = r.sim.ctx.entities.get(r.pids[1]) as Entity;
    bea.pos = r.sim.ctx.groundPos(0, 0);
    kill(r, SMITH_HEART_GUARDIANS.quench);
    expect(meta(r, 1).raidLockouts.has(`smith_heart:${SMITH_HEART_GUARDIANS.quench}`)).toBe(true);
  });

  it('never touches the per-room raids or the other dungeons', () => {
    const r = raid(['Anna']);
    kill(r, SMITH_HEART_FINAL_BOSS);
    expect(meta(r).raidLockouts.has(SMITH_HEART_DUNGEON)).toBe(false);
    expect(meta(r).raidLockouts.has(`${SMITH_HEART_DUNGEON}:heroic`)).toBe(false);
  });
});

describe('a kill while saved pays nothing', () => {
  /** Anna is saved to Ashgrand by an earlier run; Bea is not. Both on the
   *  essence quest, in one party, in a fresh claim. */
  function savedAndFresh() {
    const first = raid(['Anna']);
    kill(first, SMITH_HEART_FINAL_BOSS);
    const r = raid(['Anna', 'Bea'], { seed: 36, clock: first.clock, states: [save(first)] });
    onEssenceQuest(r, 0);
    onEssenceQuest(r, 1);
    return r;
  }

  it('rolls the quest drop for the unsaved raider only', () => {
    const r = savedAndFresh();
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    expect(corpse.loot?.items).toEqual([
      expect.objectContaining({ itemId: SMITH_HEART_ESSENCE_ITEM, personalFor: [r.pids[1]] }),
    ]);
    expect(corpse.bossLootLock).toEqual({ lockId: FINAL_LOCK, freshIds: [r.pids[1]] });
  });

  it('leaves the saved raider off the roll and copper candidates, the fresh one on', () => {
    const r = savedAndFresh();
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    // The death snapshot still names both (XP and quest kill credit are theirs).
    expect([...(corpse.lootRecipientIds ?? [])].sort()).toEqual([...r.pids].sort());
    expect(partyLootCandidatesForMob(r.sim.ctx, corpse).map((m) => m.entityId)).toEqual([
      r.pids[1],
    ]);
  });

  it('a council body felled before the lock still pays the raider it found fresh', () => {
    const r = raid(['Anna']);
    const singer = kill(r, COUNCIL_SEAM_SINGER);
    expect(singer.bossLootLock).toEqual({ lockId: COUNCIL_LOCK, freshIds: [r.pids[0]] });
    kill(r, COUNCIL_GUARDIAN);
    // Saved now by the last body's fall, yet the first body was judged fresh.
    expect(meta(r).raidLockouts.has(COUNCIL_LOCK)).toBe(true);
    const now = r.clock.now;
    expect(bossLootDenied(singer, meta(r), now)).toBe(false);
    expect(partyLootCandidatesForMob(r.sim.ctx, singer).map((m) => m.entityId)).toEqual([
      r.pids[0],
    ]);
  });

  it('the corpse gate: saved and not fresh, nothing else', () => {
    const lock = { lockId: FINAL_LOCK, freshIds: [7] };
    const saved = { entityId: 8, raidLockouts: new Map([[FINAL_LOCK, T0 + 10]]) };
    expect(bossLootDenied({ bossLootLock: lock }, saved, T0)).toBe(true);
    // The lock lapsed, another boss's lock, a fresh raider, no gate at all.
    expect(bossLootDenied({ bossLootLock: lock }, saved, T0 + 10)).toBe(false);
    expect(bossLootDenied({ bossLootLock: { ...lock, lockId: BREATH_LOCK } }, saved, T0)).toBe(
      false,
    );
    expect(bossLootDenied({ bossLootLock: lock }, { ...saved, entityId: 7 }, T0)).toBe(false);
    expect(bossLootDenied({}, saved, T0)).toBe(false);
  });

  it('rolls nothing at all when every participant is saved', () => {
    const first = raid(['Anna']);
    kill(first, SMITH_HEART_FINAL_BOSS);
    const r = raid(['Anna'], { seed: 37, clock: first.clock, states: [save(first)] });
    onEssenceQuest(r, 0);
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    expect(corpse.loot).toBeNull();
    expect(corpse.lootable).toBe(false);
  });

  it('keeps the saved raider off the corpse, its free-for-all lapse included', () => {
    const r = savedAndFresh();
    const corpse = kill(r, SMITH_HEART_FINAL_BOSS);
    // A purse on the corpse, tapped by the saved raider's own party (whose
    // default copper rule is the fair split), past its owner-lock.
    expect(r.sim.partyOf(r.pids[0])?.lootStrategies.currency).toBe('fair-split');
    corpse.tappedById = r.pids[0];
    corpse.loot = { copper: 900, items: corpse.loot?.items ?? [] };
    corpse.lootable = true;
    corpse.lootFfaTimer = 0;
    const [anna, bea] = [r.sim.ctx.entities.get(r.pids[0]), r.sim.ctx.entities.get(r.pids[1])];
    for (const p of [anna, bea]) if (p) p.pos = { ...corpse.pos };
    const copperBefore = meta(r, 0).copper;
    r.sim.tick();
    expect(r.sim.lootCorpse(corpse.id, r.pids[0])).toBe(false);
    const errors = r.sim
      .tick()
      .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
    expect(errors.map((e) => e.text)).toContain(
      'You have already defeated this boss this week, so it holds no loot for you.',
    );
    expect(meta(r, 0).copper).toBe(copperBefore);
    expect(r.sim.ctx.countItem(SMITH_HEART_ESSENCE_ITEM, r.pids[0])).toBe(0);
    // The unsaved raider takes the purse whole (no share for the saved one)
    // and their own remnant.
    const beaBefore = meta(r, 1).copper;
    expect(r.sim.lootCorpse(corpse.id, r.pids[1])).toBe(true);
    expect(meta(r, 1).copper - beaBefore).toBe(900);
    expect(r.sim.ctx.countItem(SMITH_HEART_ESSENCE_ITEM, r.pids[1])).toBe(1);
  });

  it('tells the saved raider at the kill why the boss paid them nothing', () => {
    const r = savedAndFresh();
    kill(r, SMITH_HEART_FINAL_BOSS);
    const lines = r.sim.tick().filter((e) => e.type === 'log' && e.pid === r.pids[0]);
    expect(lines.map((e) => (e as { text: string }).text)).toContain(
      'You have already defeated this boss this week, so it holds no loot for you.',
    );
    const bea = r.sim.tick().filter((e) => e.type === 'log' && e.pid === r.pids[1]);
    expect(bea.map((e) => (e as { text: string }).text)).not.toContain(
      'You have already defeated this boss this week, so it holds no loot for you.',
    );
  });

  it('still lets the saved raider in, and still counts the kill on their tally', () => {
    const r = savedAndFresh();
    // The door read no per-boss lock: the saved raider stands in the claim.
    const [anna, bea] = r.pids.map((pid) => r.sim.ctx.entities.get(pid) as Entity);
    expect(r.sim.instanceSlotAt(anna.pos)).not.toBeNull();
    expect(r.sim.instanceSlotAt(anna.pos)).toBe(r.sim.instanceSlotAt(bea.pos));
    kill(r, SMITH_HEART_FINAL_BOSS);
    expect(meta(r, 0).bossKills?.[SMITH_HEART_FINAL_BOSS]).toBe(2);
  });
});

describe('the weekly raid quest', () => {
  it('a council kill credits wk_raid', () => {
    const r = raid(['Anna']);
    armWeekly(r, 'wk_raid');
    kill(r, COUNCIL_SEAM_SINGER);
    expect(meta(r).weeklyQuest?.state).toBe('active');
    kill(r, COUNCIL_GUARDIAN);
    expect(meta(r).weeklyQuest).toMatchObject({ questId: 'wk_raid', state: 'completed' });
    expect(WEEKLY_QUESTS_BY_ID.wk_raid.count).toBe(1);
  });

  it('an Ashgrand kill credits wk_raid, and never the dungeons charge', () => {
    const raidRun = raid(['Anna']);
    armWeekly(raidRun, 'wk_raid');
    kill(raidRun, SMITH_HEART_FINAL_BOSS);
    expect(meta(raidRun).weeklyQuest?.state).toBe('completed');

    const dungeonRun = raid(['Anna'], { seed: 38 });
    armWeekly(dungeonRun, 'wk_dungeons');
    kill(dungeonRun, SMITH_HEART_FINAL_BOSS);
    expect(meta(dungeonRun).weeklyQuest).toMatchObject({
      questId: 'wk_dungeons',
      count: 0,
      state: 'active',
    });
  });

  it('credits every raider of the kill, a dead one included', () => {
    const r = raid(['Anna', 'Bea']);
    armWeekly(r, 'wk_raid', 0);
    armWeekly(r, 'wk_raid', 1);
    (r.sim.ctx.entities.get(r.pids[1]) as Entity).dead = true;
    kill(r, SMITH_HEART_GUARDIANS.breath);
    expect(meta(r, 0).weeklyQuest?.state).toBe('completed');
    expect(meta(r, 1).weeklyQuest?.state).toBe('completed');
  });

  it('a kill of a boss the raider is saved to credits nothing', () => {
    const first = raid(['Anna']);
    kill(first, SMITH_HEART_GUARDIANS.heat);
    const r = raid(['Anna'], { seed: 39, clock: first.clock, states: [save(first)] });
    armWeekly(r, 'wk_raid');
    kill(r, SMITH_HEART_GUARDIANS.heat);
    expect(meta(r).weeklyQuest).toMatchObject({ count: 0, state: 'active' });
    // Another boss of the same raid, not yet saved, does.
    kill(r, SMITH_HEART_GUARDIANS.quench);
    expect(meta(r).weeklyQuest?.state).toBe('completed');
  });
});

describe('the Weekly Vault', () => {
  it('counts every boss as a raid clear of its difficulty, never a dungeon clear', () => {
    const r = raid(['Anna']);
    killCouncil(r);
    const state = meta(r).weeklyRewards;
    expect(state?.raidClears).toEqual([1]);
    expect(state?.dungeons).toEqual([]);
    kill(r, SMITH_HEART_FINAL_BOSS);
    expect(meta(r).weeklyRewards?.raidClears).toEqual([1, 1]);
    expect(meta(r).weeklyRewards?.dungeons).toEqual([]);

    const heroic = raid(['Anna'], { seed: 40, heroic: true });
    kill(heroic, SMITH_HEART_GUARDIANS.breath);
    expect(meta(heroic).weeklyRewards?.raidClears).toEqual([2]);
    expect(meta(heroic).weeklyRewards?.dungeons).toEqual([]);
  });

  it('a kill of a boss the raider is saved to adds no clear', () => {
    const first = raid(['Anna']);
    kill(first, SMITH_HEART_GUARDIANS.breath);
    expect(meta(first).weeklyRewards?.raidClears).toEqual([1]);
    const r = raid(['Anna'], { seed: 41, clock: first.clock, states: [save(first)] });
    kill(r, SMITH_HEART_GUARDIANS.breath);
    expect(meta(r).weeklyRewards?.raidClears).toEqual([1]);
    // The council's first member alone is no kill yet.
    kill(r, COUNCIL_SEAM_SINGER);
    expect(meta(r).weeklyRewards?.raidClears).toEqual([1]);
    kill(r, COUNCIL_GUARDIAN);
    expect(meta(r).weeklyRewards?.raidClears).toEqual([1, 1]);
  });
});

describe('persistence and wire', () => {
  it('round-trips the per-boss locks through the save, dropping a lapsed one', () => {
    const r = raid(['Anna'], { heroic: true });
    kill(r, SMITH_HEART_GUARDIANS.quench);
    const state = save(r);
    expect(state.raidLockouts).toEqual({
      [`smith_heart:${SMITH_HEART_GUARDIANS.quench}:heroic`]: nextReset(T0),
    });
    const clock = { now: T0 };
    const back = raid(['Anna'], { seed: 42, clock, states: [state] });
    expect([...meta(back).raidLockouts]).toEqual([
      [`smith_heart:${SMITH_HEART_GUARDIANS.quench}:heroic`, nextReset(T0)],
    ]);
    // The roster's own read (server/characters.ts) keeps it while it runs.
    expect(activeRaidLockouts(state.raidLockouts, T0)).toEqual(state.raidLockouts);
    expect(activeRaidLockouts(state.raidLockouts, nextReset(T0))).toEqual({});
    clock.now = nextReset(T0) + 1;
    const later = raid(['Anna'], { seed: 43, clock, states: [state] });
    expect(meta(later).raidLockouts.size).toBe(0);
  });

  it('loads an old save without any per-boss id, and the old room ids as they were', () => {
    const r = raid(['Anna']);
    const legacy: CharacterState = {
      ...save(r),
      raidLockouts: { ignivar_raid_arena: T0 + WEEK, 'hollow_crypt:heroic': T0 + 1000 },
    };
    const back = raid(['Anna'], { seed: 44, states: [legacy] });
    expect(Object.fromEntries(meta(back).raidLockouts)).toEqual({
      ignivar_raid_arena: T0 + WEEK,
      'hollow_crypt:heroic': T0 + 1000,
    });
    // Nothing of the Smith's Heart is locked: its bosses pay in full.
    onEssenceQuest(back, 0);
    expect(kill(back, SMITH_HEART_FINAL_BOSS).loot?.items[0]?.itemId).toBe(
      SMITH_HEART_ESSENCE_ITEM,
    );
    const noField: CharacterState = { ...save(r) };
    delete noField.raidLockouts;
    expect(meta(raid(['Anna'], { seed: 45, states: [noField] })).raidLockouts.size).toBe(0);
  });
});
