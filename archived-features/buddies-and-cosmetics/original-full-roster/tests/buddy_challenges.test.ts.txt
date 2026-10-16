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

import {
  buddyAttemptSeconds,
  recordBossDamageForBuddies,
  resetBuddyChallenge,
  resolveBuddyChallenges,
} from '../src/sim/buddy_challenges';
import { buddyCosmeticDef } from '../src/sim/content/buddy_cosmetics';
import {
  BUDDY_CHALLENGE_BOSSES,
  BUDDY_COSMETIC_CHALLENGES,
  type BuddyCosmeticChallenge,
  buddyCosmeticChallengesFor,
} from '../src/sim/content/buddy_sources';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { type Entity, TICK_RATE } from '../src/sim/types';
import { VENDOR_TEST_WORLD } from './sim_shared';

const NYTHRAXIS = 'nythraxis_scourge_of_thornpeak';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: VENDOR_TEST_WORLD });
}

function join(sim: Sim, name = 'Owner'): number {
  const pid = sim.addPlayer('warrior', name);
  sim.tick();
  return pid;
}

function bossAt(sim: Sim, templateId: string): Entity {
  const template = MOBS[templateId];
  const boss = createMob(sim.ctx.nextId++, template, template.maxLevel, { x: 5, y: 0, z: 5 });
  sim.ctx.addEntity(boss);
  return boss;
}

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

describe('boss-pet cosmetic challenges', () => {
  const speed = BUDDY_COSMETIC_CHALLENGES.find(
    (c): c is Extract<BuddyCosmeticChallenge, { kind: 'speed' }> =>
      c.bossId === NYTHRAXIS && c.kind === 'speed',
  )!;
  const dps = BUDDY_COSMETIC_CHALLENGES.find(
    (c): c is Extract<BuddyCosmeticChallenge, { kind: 'dps' }> =>
      c.bossId === NYTHRAXIS && c.kind === 'dps',
  )!;

  it('the content table names real bosses and real looks', () => {
    expect(speed).toBeTruthy();
    expect(dps).toBeTruthy();
    for (const row of BUDDY_COSMETIC_CHALLENGES) {
      expect(MOBS[row.bossId], row.bossId).toBeTruthy();
      expect(buddyCosmeticDef(row.cosmeticId), row.cosmeticId).not.toBeNull();
      expect(BUDDY_CHALLENGE_BOSSES.has(row.bossId)).toBe(true);
    }
    expect(buddyCosmeticChallengesFor('forest_wolf')).toEqual([]);
  });

  it('tracks nothing for an untracked mob', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const wolf = bossAt(sim, 'forest_wolf');
    recordBossDamageForBuddies(sim.ctx, sim.entities.get(pid)!, wolf, 100);
    expect(buddyAttemptSeconds(sim.ctx, wolf)).toBe(0);
  });

  it('a fast kill pays the speed look to every recipient; a slow one pays nobody', () => {
    const sim = makeWorld();
    const a = join(sim, 'Alpha');
    const b = join(sim, 'Beta');
    const boss = bossAt(sim, NYTHRAXIS);
    recordBossDamageForBuddies(sim.ctx, sim.entities.get(a)!, boss, 10);
    ticks(sim, TICK_RATE * 5);
    expect(buddyAttemptSeconds(sim.ctx, boss)).toBeCloseTo(5, 5);
    resolveBuddyChallenges(sim.ctx, boss, [sim.players.get(a)!, sim.players.get(b)!]);
    expect(sim.players.get(a)!.buddies.cosmetics.has(speed.cosmeticId)).toBe(true);
    expect(sim.players.get(b)!.buddies.cosmetics.has(speed.cosmeticId)).toBe(true);

    // Second attempt, too slow.
    const c = join(sim, 'Gamma');
    const slow = bossAt(sim, NYTHRAXIS);
    recordBossDamageForBuddies(sim.ctx, sim.entities.get(c)!, slow, 10);
    ticks(sim, TICK_RATE * (speed.seconds + 1));
    resolveBuddyChallenges(sim.ctx, slow, [sim.players.get(c)!]);
    expect(sim.players.get(c)!.buddies.cosmetics.has(speed.cosmeticId)).toBe(false);
  });

  it('the dps look is personal: only the player whose own damage meets the rate earns it', () => {
    const sim = makeWorld();
    const a = join(sim, 'Alpha');
    const b = join(sim, 'Beta');
    const boss = bossAt(sim, NYTHRAXIS);
    const seconds = 10;
    recordBossDamageForBuddies(sim.ctx, sim.entities.get(a)!, boss, dps.dps * seconds);
    recordBossDamageForBuddies(sim.ctx, sim.entities.get(b)!, boss, 1);
    ticks(sim, TICK_RATE * seconds);
    resolveBuddyChallenges(sim.ctx, boss, [sim.players.get(a)!, sim.players.get(b)!]);
    expect(sim.players.get(a)!.buddies.cosmetics.has(dps.cosmeticId)).toBe(true);
    expect(sim.players.get(b)!.buddies.cosmetics.has(dps.cosmeticId)).toBe(false);
  });

  it('pet damage credits the owner', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const boss = bossAt(sim, NYTHRAXIS);
    const pet = createMob(sim.ctx.nextId++, MOBS.forest_wolf, 1, { x: 1, y: 0, z: 1 });
    pet.ownerId = pid;
    recordBossDamageForBuddies(sim.ctx, pet, boss, dps.dps * 10);
    ticks(sim, TICK_RATE * 10);
    resolveBuddyChallenges(sim.ctx, boss, [sim.players.get(pid)!]);
    expect(sim.players.get(pid)!.buddies.cosmetics.has(dps.cosmeticId)).toBe(true);
  });

  it('an evade or respawn re-arms the clock', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const boss = bossAt(sim, NYTHRAXIS);
    recordBossDamageForBuddies(sim.ctx, sim.entities.get(pid)!, boss, 10);
    ticks(sim, TICK_RATE * (speed.seconds + 5));
    resetBuddyChallenge(boss);
    expect(buddyAttemptSeconds(sim.ctx, boss)).toBe(0);
    recordBossDamageForBuddies(sim.ctx, sim.entities.get(pid)!, boss, 10);
    ticks(sim, TICK_RATE * 2);
    resolveBuddyChallenges(sim.ctx, boss, [sim.players.get(pid)!]);
    expect(sim.players.get(pid)!.buddies.cosmetics.has(speed.cosmeticId)).toBe(true);
  });

  it('a kill with no recorded attempt pays nothing and draws no rng', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const boss = bossAt(sim, NYTHRAXIS);
    const next = vi.spyOn(sim.ctx.rng, 'next');
    const chance = vi.spyOn(sim.ctx.rng, 'chance');
    resolveBuddyChallenges(sim.ctx, boss, [sim.players.get(pid)!]);
    expect(sim.players.get(pid)!.buddies.cosmetics.size).toBe(0);
    expect(next).not.toHaveBeenCalled();
    expect(chance).not.toHaveBeenCalled();
  });
});
