import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { buddyOwned, grantBuddy, summonBuddy } from '../src/sim/buddies';
import {
  playerInsideInstance,
  revealBuddiesOnJoin,
  rollBossBuddyDrops,
  updateBuddyReveals,
} from '../src/sim/buddy_drops';
import {
  BUDDY_BOSS_CHANCE,
  BUDDY_BOSS_DROPS,
  BUDDY_FULL_GROUP,
  BUDDY_WORLD_REVEAL_DISTANCE,
  buddyBossDropsFor,
  buddyChancePerPlayer,
  FORGEMAW_PER_BOSS_CHANCE,
} from '../src/sim/content/buddy_sources';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { VENDOR_TEST_WORLD } from './sim_shared';

const NYTHRAXIS = 'nythraxis_scourge_of_thornpeak';
const FORGE_BOSS = 'ignivar_herald_of_the_last_flame';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: VENDOR_TEST_WORLD });
}

function join(sim: Sim, name = 'Owner'): number {
  const pid = sim.addPlayer('warrior', name);
  sim.tick();
  return pid;
}

function bossAt(sim: Sim, templateId: string, x: number, z: number): Entity {
  const template = MOBS[templateId];
  const boss = createMob(sim.ctx.nextId++, template, template.maxLevel, { x, y: 0, z });
  sim.ctx.addEntity(boss);
  return boss;
}

function events(sim: Sim, type: SimEvent['type']): SimEvent[] {
  return sim.tick().filter((ev) => ev.type === type);
}

describe('boss pets: one independent roll per player', () => {
  it('a boss with no rows draws nothing at all', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const wolf = bossAt(sim, 'forest_wolf', 10, 10);
    const chance = vi.spyOn(sim.ctx.rng, 'chance');
    rollBossBuddyDrops(sim.ctx, wolf, [sim.players.get(pid)!], null);
    expect(chance).not.toHaveBeenCalled();
    expect(buddyBossDropsFor('forest_wolf')).toEqual([]);
  });

  it('draws once per (player, row) at the split rate, whatever each player owns', () => {
    const sim = makeWorld();
    const a = join(sim, 'Alpha');
    const b = join(sim, 'Beta');
    grantBuddy(sim.ctx, a, 'crystal_lich'); // already collected: still draws, never re-attaches
    sim.tick();
    const boss = bossAt(sim, NYTHRAXIS, 10, 10);
    const rows = buddyBossDropsFor(NYTHRAXIS);
    expect(rows.length).toBeGreaterThan(0);
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    rollBossBuddyDrops(sim.ctx, boss, [sim.players.get(a)!, sim.players.get(b)!], {
      difficulty: 'heroic',
    } as never);
    expect(chance).toHaveBeenCalledTimes(2 * rows.length);
    // Two players split the full group's 1% total: 0.5% each.
    for (const call of chance.mock.calls) expect(call[0]).toBeCloseTo(0.005, 12);
    // Alpha owned it: no presence line, nothing pending. Beta won it: pending.
    expect(sim.players.get(a)!.buddies.pending).toEqual([]);
    expect(sim.players.get(b)!.buddies.pending.map((p) => p.key)).toEqual(['crystal_lich']);
    const presence = events(sim, 'buddyPresence');
    expect(presence).toHaveLength(1);
    expect(presence[0]).toMatchObject({ pid: b, key: 'crystal_lich' });
  });

  it('Normal Nythraxis and the Normal Crucible roll nothing; Heroic rolls', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const nythraxis = bossAt(sim, NYTHRAXIS, 10, 10);
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    rollBossBuddyDrops(sim.ctx, nythraxis, [meta], { difficulty: 'normal' } as never);
    rollBossBuddyDrops(sim.ctx, nythraxis, [meta], null);
    expect(chance).not.toHaveBeenCalled();
    rollBossBuddyDrops(sim.ctx, nythraxis, [meta], { difficulty: 'heroic' } as never);
    // Solo: the whole 1% total rides the one player.
    expect(chance).toHaveBeenCalledTimes(1);
    expect(chance.mock.calls[0][0]).toBeCloseTo(0.01, 12);
    chance.mockClear();
    const ignivar = bossAt(sim, FORGE_BOSS, 20, 20);
    rollBossBuddyDrops(sim.ctx, ignivar, [meta], { difficulty: 'normal' } as never);
    expect(chance).not.toHaveBeenCalled();
    rollBossBuddyDrops(sim.ctx, ignivar, [meta], { difficulty: 'heroic' } as never);
    expect(chance).toHaveBeenCalledTimes(1);
    // Forgemaw is spread across both Crucible bosses: half of 1% solo.
    expect(chance.mock.calls[0][0]).toBeCloseTo(0.005, 12);
  });

  it('Varkhul splits its half rate across a small group too', () => {
    const sim = makeWorld();
    const a = sim.players.get(join(sim, 'Alpha'))!;
    const b = sim.players.get(join(sim, 'Beta'))!;
    const varkhul = bossAt(sim, 'varkhul_forgefather_of_the_last_flame', 10, 10);
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    rollBossBuddyDrops(sim.ctx, varkhul, [a, b], { difficulty: 'normal' } as never);
    expect(chance).not.toHaveBeenCalled();
    rollBossBuddyDrops(sim.ctx, varkhul, [a, b], { difficulty: 'heroic' } as never);
    expect(chance).toHaveBeenCalledTimes(2);
    for (const call of chance.mock.calls) expect(call[0]).toBeCloseTo(0.0025, 12);
  });

  it('a full group of ten or more rolls the flat per-player rate', () => {
    const sim = makeWorld();
    const metas = Array.from({ length: 12 }, (_, i) => sim.players.get(join(sim, `P${i}`))!);
    const boss = bossAt(sim, NYTHRAXIS, 10, 10);
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    rollBossBuddyDrops(sim.ctx, boss, metas.slice(0, 10), { difficulty: 'heroic' } as never);
    expect(chance).toHaveBeenCalledTimes(10);
    for (const call of chance.mock.calls) expect(call[0]).toBe(0.001);
    chance.mockClear();
    rollBossBuddyDrops(sim.ctx, boss, metas, { difficulty: 'heroic' } as never);
    expect(chance).toHaveBeenCalledTimes(12);
    for (const call of chance.mock.calls) expect(call[0]).toBe(0.001);
  });

  it('records the kill position and the source kind on the pending entry', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const boss = bossAt(sim, NYTHRAXIS, 33, 44);
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    rollBossBuddyDrops(sim.ctx, boss, [meta], { difficulty: 'heroic' } as never);
    expect(meta.buddies.pending[0]).toEqual({
      key: 'crystal_lich',
      source: 'instance',
      x: 33,
      z: 44,
    });
  });

  it('is wired to the death site: an unclaimed (Normal-rate) Nythraxis kill attaches nothing', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    const boss = bossAt(sim, NYTHRAXIS, player.pos.x + 3, player.pos.z);
    boss.tappedById = pid;
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    sim.ctx.handleDeath(boss, player);
    expect(meta.buddies.pending).toEqual([]);
  });

  it('is wired to the death site: a Heroic claim kill attaches a pending pet', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    const boss = bossAt(sim, NYTHRAXIS, player.pos.x + 3, player.pos.z);
    boss.tappedById = pid;
    const inst = sim.ctx.instances[0];
    expect(inst, 'the test world has an instance slot').toBeTruthy();
    inst.partyKey = 'test-party';
    inst.difficulty = 'heroic';
    inst.mobIds.push(boss.id);
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    sim.ctx.handleDeath(boss, player);
    expect(meta.buddies.pending.map((p) => p.key)).toContain('crystal_lich');
    expect(meta.buddies.pending[0].source).toBe('instance');
  });

  it('is wired to the death site: a Normal claim kill attaches nothing', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    const boss = bossAt(sim, NYTHRAXIS, player.pos.x + 3, player.pos.z);
    boss.tappedById = pid;
    const inst = sim.ctx.instances[0];
    inst.partyKey = 'test-party';
    inst.difficulty = 'normal';
    inst.mobIds.push(boss.id);
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    sim.ctx.handleDeath(boss, player);
    expect(meta.buddies.pending).toEqual([]);
  });

  it('the death site splits across the credited party only, never a bystander', () => {
    const sim = makeWorld();
    const leader = join(sim, 'Leader');
    const member = join(sim, 'Member');
    const outsider = join(sim, 'Outsider');
    sim.partyInvite(member, leader);
    sim.partyAccept(member);
    sim.tick();
    expect(sim.ctx.partyOf(leader)?.members).toContain(member);
    const player = sim.entities.get(leader)!;
    for (const id of [member, outsider]) {
      const e = sim.entities.get(id)!;
      e.pos.x = player.pos.x + 1;
      e.pos.z = player.pos.z;
    }
    const boss = bossAt(sim, NYTHRAXIS, player.pos.x + 3, player.pos.z);
    boss.tappedById = leader;
    const inst = sim.ctx.instances[0];
    inst.partyKey = 'test-party';
    inst.difficulty = 'heroic';
    inst.mobIds.push(boss.id);
    // Record only the draws made from the buddy roll (other loot draws share
    // the same rng and can use the same probabilities).
    const buddyDraws: number[] = [];
    vi.spyOn(sim.ctx.rng, 'chance').mockImplementation((p: number) => {
      if (new Error().stack?.includes('rollBossBuddyDrops')) buddyDraws.push(p);
      return true;
    });
    sim.ctx.handleDeath(boss, player);
    // Two credited players: exactly two buddy draws, each at half of 1%.
    expect(buddyDraws).toHaveLength(2);
    for (const p of buddyDraws) expect(p).toBeCloseTo(0.005, 12);
    for (const id of [leader, member]) {
      expect(sim.players.get(id)!.buddies.pending.map((p) => p.key)).toEqual(['crystal_lich']);
    }
    expect(sim.players.get(outsider)!.buddies.pending).toEqual([]);
  });
});

describe('the reveal: on the zone-out, or once the player walks away', () => {
  it('a world-source companion reveals once the player is BUDDY_WORLD_REVEAL_DISTANCE away', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    meta.buddies.pending.push({
      key: 'crystal_lich',
      source: 'world',
      x: player.pos.x,
      z: player.pos.z,
    });
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'crystal_lich')).toBe(false);
    player.pos.x += BUDDY_WORLD_REVEAL_DISTANCE - 1;
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'crystal_lich')).toBe(false);
    player.pos.x += 2;
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'crystal_lich')).toBe(true);
    expect(meta.buddies.pending).toEqual([]);
    expect(player.buddyKey).toBe('crystal_lich');
    expect(events(sim, 'buddyRevealed')).toHaveLength(1);
  });

  it('an instance-source companion reveals as soon as the player stands outside every claim', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.buddies.pending.push({ key: 'forgemaw', source: 'instance', x: 0, z: 0 });
    // No claimed instance holds the player in this bare world: the sweep reveals.
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'forgemaw')).toBe(true);
  });

  it('the sweep runs from the tick at 1 Hz', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.buddies.pending.push({ key: 'forgemaw', source: 'instance', x: 0, z: 0 });
    for (let i = 0; i < 25 && !buddyOwned(meta, 'forgemaw'); i++) sim.tick();
    expect(buddyOwned(meta, 'forgemaw')).toBe(true);
  });

  it('a dead player reveals nothing until they are back on their feet', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    sim.entities.get(pid)!.dead = true;
    meta.buddies.pending.push({ key: 'forgemaw', source: 'instance', x: 0, z: 0 });
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'forgemaw')).toBe(false);
  });

  it('playerInsideInstance reads the claimed-instance band, never an unclaimed slot', () => {
    const origin = { x: 5000, z: 5000 };
    const ctx = {
      instances: [{ partyKey: 'party' }, { partyKey: null }],
      instanceOriginOf: () => origin,
    } as never;
    const inside = { pos: { x: 5010, y: 0, z: 5100 } } as Entity;
    const outside = { pos: { x: 5200, y: 0, z: 5000 } } as Entity;
    expect(playerInsideInstance(ctx, inside)).toBe(true);
    expect(playerInsideInstance(ctx, outside)).toBe(false);
    const unclaimed = { instances: [{ partyKey: null }], instanceOriginOf: () => origin } as never;
    expect(playerInsideInstance(unclaimed, inside)).toBe(false);
  });

  it('login reveals a world-source companion at once and an instance one when outside', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.buddies.pending.push({ key: 'crystal_lich', source: 'world', x: 99999, z: 99999 });
    meta.buddies.pending.push({ key: 'forgemaw', source: 'instance', x: 0, z: 0 });
    revealBuddiesOnJoin(sim.ctx, pid);
    expect(buddyOwned(meta, 'crystal_lich')).toBe(true);
    expect(buddyOwned(meta, 'forgemaw')).toBe(true);
  });

  it('a pending companion survives the save and reveals on the next join', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.buddies.pending.push({ key: 'forgemaw', source: 'instance', x: 0, z: 0 });
    const state = sim.serializeCharacter(pid)!;
    expect(state.buddies?.pending).toEqual([{ key: 'forgemaw', source: 'instance', x: 0, z: 0 }]);
    const again = makeWorld();
    const pid2 = again.addPlayer('warrior', 'Owner', { state });
    expect(buddyOwned(again.players.get(pid2)!, 'forgemaw')).toBe(true);
  });

  it('a buddy left out walks back out on the next join, a dismissed one stays dismissed', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'crystal_lich');
    expect(sim.entities.get(pid)?.buddyKey).toBe('crystal_lich');
    // Control: logging out with the buddy out brings it back.
    const out = makeWorld();
    const outPid = out.addPlayer('warrior', 'Owner', { state: sim.serializeCharacter(pid)! });
    expect(out.entities.get(outPid)?.buddyKey).toBe('crystal_lich');
    // An explicit dismiss from Cosmetics is remembered across the logout.
    expect(summonBuddy(sim.ctx, pid, 'crystal_lich')).toBe(true);
    expect(sim.entities.get(pid)?.buddyKey).toBe('');
    const back = makeWorld();
    const backPid = back.addPlayer('warrior', 'Owner', { state: sim.serializeCharacter(pid)! });
    expect(buddyOwned(back.players.get(backPid)!, 'crystal_lich')).toBe(true);
    expect(back.entities.get(backPid)?.buddyKey).toBe('');
  });
});

describe('the boss source table', () => {
  it('names only real bosses and real companions, every row heroic-only', () => {
    for (const row of BUDDY_BOSS_DROPS) {
      expect(MOBS[row.bossId], `${row.bossId} is not a mob`).toBeTruthy();
      expect(row.heroicOnly, row.bossId).toBe(true);
    }
  });

  it('pins the owner rates: 0.1% Nythraxis, 0.05% per Crucible boss', () => {
    expect(BUDDY_BOSS_CHANCE).toBe(0.001);
    expect(FORGEMAW_PER_BOSS_CHANCE).toBe(0.0005);
    expect(BUDDY_FULL_GROUP).toBe(10);
    expect(BUDDY_BOSS_DROPS.map((row) => [row.bossId, row.chance])).toEqual([
      [NYTHRAXIS, 0.001],
      [FORGE_BOSS, 0.0005],
      ['varkhul_forgefather_of_the_last_flame', 0.0005],
    ]);
  });

  it('buddyChancePerPlayer keeps the group total fixed under ten players', () => {
    for (let n = 1; n < BUDDY_FULL_GROUP; n++) {
      expect(buddyChancePerPlayer(0.001, n) * n, `n=${n}`).toBeCloseTo(0.01, 12);
    }
    expect(buddyChancePerPlayer(0.001, 1)).toBeCloseTo(0.01, 12);
    expect(buddyChancePerPlayer(0.001, 2)).toBeCloseTo(0.005, 12);
    expect(buddyChancePerPlayer(0.001, 10)).toBe(0.001);
    expect(buddyChancePerPlayer(0.001, 25)).toBe(0.001);
    expect(buddyChancePerPlayer(0.0005, 5)).toBeCloseTo(0.001, 12);
  });
});
