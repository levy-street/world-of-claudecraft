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

import { buddyOwned, grantBuddy } from '../src/sim/buddies';
import {
  playerInsideInstance,
  revealBuddiesOnJoin,
  rollBossBuddyDrops,
  updateBuddyReveals,
} from '../src/sim/buddy_drops';
import {
  BUDDY_BOSS_DROPS,
  BUDDY_WORLD_REVEAL_DISTANCE,
  buddyBossDropsFor,
} from '../src/sim/content/buddy_sources';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { VENDOR_TEST_WORLD } from './sim_shared';

const KORZUL = 'korzul_the_gravewyrm';
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

  it('draws once per (player, row) at the normal rate, whatever each player owns', () => {
    const sim = makeWorld();
    const a = join(sim, 'Alpha');
    const b = join(sim, 'Beta');
    grantBuddy(sim.ctx, a, 'skeleton'); // already collected: still draws, never re-attaches
    sim.tick();
    const boss = bossAt(sim, KORZUL, 10, 10);
    const rows = buddyBossDropsFor(KORZUL);
    expect(rows.length).toBeGreaterThan(0);
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    rollBossBuddyDrops(sim.ctx, boss, [sim.players.get(a)!, sim.players.get(b)!], null);
    expect(chance).toHaveBeenCalledTimes(2 * rows.length);
    for (const call of chance.mock.calls) expect(call[0]).toBe(rows[0].chance);
    // Alpha owned it: no presence line, nothing pending. Beta won it: pending.
    expect(sim.players.get(a)!.buddies.pending).toEqual([]);
    expect(sim.players.get(b)!.buddies.pending.map((p) => p.key)).toEqual(['skeleton']);
    const presence = events(sim, 'buddyPresence');
    expect(presence).toHaveLength(1);
    expect(presence[0]).toMatchObject({ pid: b, key: 'skeleton' });
  });

  it('uses the heroic rate under a heroic claim, and skips heroic-only rows on normal', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const korzul = bossAt(sim, KORZUL, 10, 10);
    const chance = vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    rollBossBuddyDrops(sim.ctx, korzul, [meta], { difficulty: 'heroic' } as never);
    const row = buddyBossDropsFor(KORZUL)[0];
    expect(chance).toHaveBeenLastCalledWith(row.heroicChance);
    chance.mockClear();
    const ignivar = bossAt(sim, FORGE_BOSS, 20, 20);
    rollBossBuddyDrops(sim.ctx, ignivar, [meta], { difficulty: 'normal' } as never);
    expect(chance).not.toHaveBeenCalled();
    rollBossBuddyDrops(sim.ctx, ignivar, [meta], { difficulty: 'heroic' } as never);
    expect(chance).toHaveBeenCalledTimes(1);
  });

  it('records the kill position and the source kind on the pending entry', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const boss = bossAt(sim, KORZUL, 33, 44);
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    rollBossBuddyDrops(sim.ctx, boss, [meta], { difficulty: 'normal' } as never);
    expect(meta.buddies.pending[0]).toEqual({ key: 'skeleton', source: 'instance', x: 33, z: 44 });
  });

  it('is wired to the death site: killing a listed boss in the open world attaches a pending pet', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    const boss = bossAt(sim, KORZUL, player.pos.x + 3, player.pos.z);
    boss.tappedById = pid;
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    sim.ctx.handleDeath(boss, player);
    expect(meta.buddies.pending.map((p) => p.key)).toContain('skeleton');
    expect(meta.buddies.pending[0].source).toBe('world');
  });
});

describe('the reveal: on the zone-out, or once the player walks away', () => {
  it('a world-source companion reveals once the player is BUDDY_WORLD_REVEAL_DISTANCE away', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    meta.buddies.pending.push({
      key: 'skeleton',
      source: 'world',
      x: player.pos.x,
      z: player.pos.z,
    });
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'skeleton')).toBe(false);
    player.pos.x += BUDDY_WORLD_REVEAL_DISTANCE - 1;
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'skeleton')).toBe(false);
    player.pos.x += 2;
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'skeleton')).toBe(true);
    expect(meta.buddies.pending).toEqual([]);
    expect(player.buddyKey).toBe('skeleton');
    expect(events(sim, 'buddyRevealed')).toHaveLength(1);
  });

  it('an instance-source companion reveals as soon as the player stands outside every claim', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.buddies.pending.push({ key: 'phantom', source: 'instance', x: 0, z: 0 });
    // No claimed instance holds the player in this bare world: the sweep reveals.
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'phantom')).toBe(true);
  });

  it('the sweep runs from the tick at 1 Hz', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.buddies.pending.push({ key: 'phantom', source: 'instance', x: 0, z: 0 });
    for (let i = 0; i < 25 && !buddyOwned(meta, 'phantom'); i++) sim.tick();
    expect(buddyOwned(meta, 'phantom')).toBe(true);
  });

  it('a dead player reveals nothing until they are back on their feet', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    sim.entities.get(pid)!.dead = true;
    meta.buddies.pending.push({ key: 'phantom', source: 'instance', x: 0, z: 0 });
    updateBuddyReveals(sim.ctx);
    expect(buddyOwned(meta, 'phantom')).toBe(false);
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
    meta.buddies.pending.push({ key: 'skeleton', source: 'world', x: 99999, z: 99999 });
    meta.buddies.pending.push({ key: 'phantom', source: 'instance', x: 0, z: 0 });
    revealBuddiesOnJoin(sim.ctx, pid);
    expect(buddyOwned(meta, 'skeleton')).toBe(true);
    expect(buddyOwned(meta, 'phantom')).toBe(true);
  });

  it('a pending companion survives the save and reveals on the next join', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.buddies.pending.push({ key: 'phantom', source: 'instance', x: 0, z: 0 });
    const state = sim.serializeCharacter(pid)!;
    expect(state.buddies?.pending).toEqual([{ key: 'phantom', source: 'instance', x: 0, z: 0 }]);
    const again = makeWorld();
    const pid2 = again.addPlayer('warrior', 'Owner', { state });
    expect(buddyOwned(again.players.get(pid2)!, 'phantom')).toBe(true);
  });
});

describe('the boss source table', () => {
  it('names only real bosses and real companions', () => {
    for (const row of BUDDY_BOSS_DROPS) {
      expect(MOBS[row.bossId], `${row.bossId} is not a mob`).toBeTruthy();
      expect(row.chance).toBeGreaterThan(0);
      expect(row.chance).toBeLessThanOrEqual(0.05);
      if (row.heroicChance !== undefined)
        expect(row.heroicChance).toBeGreaterThanOrEqual(row.chance);
    }
  });
});
