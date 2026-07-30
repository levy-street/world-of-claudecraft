import { describe, expect, it } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { BUILTIN_WORLD, isRiftPos } from '../src/sim/data';
import { spawnNaturalRiftPortal } from '../src/sim/rift/portals';
import { descendRift, updateRiftInstances } from '../src/sim/rift/runs';
import type { RiftInstance } from '../src/sim/rift/types';
import { installRiftUpgrade } from '../src/sim/rift/upgrader_draft';
import { Sim } from '../src/sim/sim';

const TEST_WORLD = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(): Sim {
  return new Sim({
    seed: 99117,
    playerClass: 'warrior',
    noPlayer: true,
    autoEquip: true,
    devCommands: true,
    riftPortals: true,
    world: TEST_WORLD,
  });
}

function clearToBoss(sim: Sim, inst: RiftInstance, pid: number): void {
  while (inst.floorIndex < inst.floorCount - 1) {
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob) mob.dead = true;
    }
    inst.litPylons = new Set(inst.pylonIds);
    inst.puzzleSolved = true;
    sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
    updateRiftInstances(sim.ctx);
    expect(inst.descentOpen).toBe(true);
    descendRift(sim.ctx, pid);
  }
}

describe('shared Rift race with group-isolated dungeon instances', () => {
  it('shares one instance inside a party but creates another for a competing group', () => {
    const sim = makeSim();
    const leader = sim.addPlayer('warrior', 'Aleph');
    const member = sim.addPlayer('priest', 'Bet');
    const rival = sim.addPlayer('rogue', 'Gimel');
    for (const pid of [leader, member, rival]) sim.setPlayerLevel(20, pid);
    sim.partyInvite(member, leader);
    sim.partyAccept(member);
    expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
    const portal = sim.entities.get(sim.naturalRiftPortals[0].id)!;

    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, leader, undefined, portal);
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, member, undefined, portal);
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, rival, undefined, portal);

    const active = sim.riftInstances.filter((instance) => instance.partyKey !== null);
    expect(active).toHaveLength(2);
    const partyRun = active.find((instance) => instance.memberIds.has(leader))!;
    const rivalRun = active.find((instance) => instance.memberIds.has(rival))!;
    expect(partyRun.memberIds).toEqual(new Set([leader, member]));
    expect(partyRun.instanceId).not.toBe(rivalRun.instanceId);
    expect(partyRun.slot).not.toBe(rivalRun.slot);
    expect(partyRun.eventId).toBe(rivalRun.eventId);
    expect(partyRun.seed).toBe(rivalRun.seed);
    expect(partyRun.mobIds).not.toEqual(rivalRun.mobIds);
  });

  it('rewards the first clear atomically while a mid-run competitor keeps playing to a lost finish', () => {
    const sim = makeSim();
    sim.utcDay = '2026-07-10';
    const winner = sim.addPlayer('warrior', 'Aleph');
    const loser = sim.addPlayer('mage', 'Bet');
    sim.setPlayerLevel(20, winner);
    sim.setPlayerLevel(20, loser);
    expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
    const portalInfo = sim.naturalRiftPortals[0];
    const portal = sim.entities.get(portalInfo.id)!;
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, winner, undefined, portal);
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, loser, undefined, portal);
    const winnerRun = sim.riftInstances.find((instance) => instance.memberIds.has(winner))!;
    const loserRun = sim.riftInstances.find((instance) => instance.memberIds.has(loser))!;
    expect(isRiftPos(sim.entities.get(loser)!.pos.x)).toBe(true);

    clearToBoss(sim, winnerRun, winner);
    const boss = sim.entities.get(winnerRun.bossId!)!;
    boss.dead = true;
    sim.drainEvents();
    sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
    updateRiftInstances(sim.ctx);
    const events = sim.drainEvents();

    const event = sim.riftEvents.find((candidate) => candidate.eventId === portalInfo.eventId)!;
    expect(event.status).toBe('cleared');
    expect(event.firstClear?.memberIds).toEqual([winner]);
    expect(event.firstClear?.memberNames).toEqual(['Aleph']);
    expect(winnerRun.outcome).toBe('won');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'riftRaceResult', pid: winner, outcome: 'won' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'riftRaceWorld' }));
    expect(sim.entities.has(portalInfo.id)).toBe(false);
    // The competing group is NOT torn down (maintainer decision, 2026-07-30):
    // no eject, no teleport, run still active, no premature loss banner.
    expect(loserRun.partyKey).not.toBeNull();
    expect(loserRun.outcome).toBe('active');
    expect(isRiftPos(sim.entities.get(loser)!.pos.x)).toBe(true);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'riftRaceResult', pid: loser, outcome: 'lost' }),
    );
    // Rifts pay NO Heroic Marks (maintainer decision): the win pays the gear
    // ladder and first-clear extras instead, and the corpse stays lootable.
    expect((boss.loot?.items ?? []).some((item) => item.itemId === HEROIC_MARK_ITEM_ID)).toBe(
      false,
    );
    expect((boss.loot?.items ?? []).length).toBeGreaterThan(0);
    // The winner corpse DOES carry the first-clear payload, so the loser-side
    // absence assertions below cannot pass vacuously.
    expect((boss.loot?.items ?? []).some((item) => item.instance?.rift !== undefined)).toBe(true);

    // The loser finishes their own run: lost outcome, egress spawned, but NO
    // completion loot of any kind (no gear ladder, no sealed cache, no
    // first-clear extras): a loser keeps only what dropped off the mobs.
    clearToBoss(sim, loserRun, loser);
    const loserBoss = sim.entities.get(loserRun.bossId!)!;
    loserBoss.dead = true;
    sim.drainEvents();
    sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
    updateRiftInstances(sim.ctx);
    const loserEvents = sim.drainEvents();
    expect(loserRun.outcome).toBe('lost');
    expect(loserRun.rewarded).toBe(true);
    expect(loserRun.exitId).not.toBeNull();
    expect(loserRun.cacheId).toBeNull(); // the sealed cache is completion loot
    expect(winnerRun.cacheId).not.toBeNull(); // ... and the winner does get it
    expect(loserEvents).toContainEqual(
      expect.objectContaining({
        type: 'riftRaceResult',
        pid: loser,
        outcome: 'lost',
        winnerNames: ['Aleph'],
      }),
    );
    // This kill was a dead-flag stamp (no handleDeath), so any corpse item here
    // could only have come from a completion payout: there must be NONE. The
    // per-item negatives stay as belt and braces should normal drops ever
    // appear on this path.
    const loserItems = loserBoss.loot?.items ?? [];
    expect(loserItems).toHaveLength(0);
    expect(loserItems.some((item) => item.itemId === HEROIC_MARK_ITEM_ID)).toBe(false);
    expect(loserItems.some((item) => item.instance?.rift !== undefined)).toBe(false);
    expect(loserItems.some((item) => item.itemId === RIFT_ESSENCE_ITEM_ID)).toBe(false);
    expect(
      loserItems.some((item) => (RIFT_GEM_IDS as readonly string[]).includes(item.itemId)),
    ).toBe(false);

    // Idempotent: re-observing the dead boss in a later sweep must not re-emit
    // the race result or re-roll the corpse ladder.
    const itemCount = loserItems.length;
    sim.tickCount += 20;
    updateRiftInstances(sim.ctx);
    const repeatEvents = sim.drainEvents();
    expect(
      repeatEvents.some((candidate) => (candidate as { type: string }).type === 'riftRaceResult'),
    ).toBe(false);
    expect((loserBoss.loot?.items ?? []).length).toBe(itemCount);
  });

  it('ranks same-window clears by boss-death tick, not slot order', () => {
    const sim = makeSim();
    sim.utcDay = '2026-07-10';
    const slow = sim.addPlayer('warrior', 'Gimel'); // enters first: LOWER slot
    const fast = sim.addPlayer('mage', 'Dalet'); // enters second: higher slot
    sim.setPlayerLevel(20, slow);
    sim.setPlayerLevel(20, fast);
    expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
    const portalInfo = sim.naturalRiftPortals[0];
    const portal = sim.entities.get(portalInfo.id)!;
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, slow, undefined, portal);
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, fast, undefined, portal);
    const slowRun = sim.riftInstances.find((instance) => instance.memberIds.has(slow))!;
    const fastRun = sim.riftInstances.find((instance) => instance.memberIds.has(fast))!;
    expect(slowRun.slot).toBeLessThan(fastRun.slot);
    clearToBoss(sim, slowRun, slow);
    clearToBoss(sim, fastRun, fast);

    // Both bosses die inside ONE sweep window, the higher slot one tick EARLIER:
    // the recorded kill tick, not the slot iteration order, must pick the winner.
    sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
    sim.tickCount += 1;
    sim.entities.get(fastRun.bossId!)!.dead = true;
    updateRiftInstances(sim.ctx); // pre-pass stamps fast's kill this tick
    sim.tickCount += 1;
    sim.entities.get(slowRun.bossId!)!.dead = true;
    updateRiftInstances(sim.ctx); // pre-pass stamps slow's kill one tick later
    expect(fastRun.bossDiedAtTick).not.toBeNull();
    expect(slowRun.bossDiedAtTick).not.toBeNull();
    expect(fastRun.bossDiedAtTick as number).toBeLessThan(slowRun.bossDiedAtTick as number);

    sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
    updateRiftInstances(sim.ctx); // the sweep claims in death order
    const event = sim.riftEvents.find((candidate) => candidate.eventId === portalInfo.eventId)!;
    expect(event.status).toBe('cleared');
    expect(event.firstClear?.memberIds).toEqual([fast]);
    expect(fastRun.outcome).toBe('won');
    // The race loser is decided in the same sweep but keeps their instance:
    // lost outcome, corpse loot, and an egress instead of a teardown.
    expect(slowRun.partyKey).not.toBeNull();
    expect(slowRun.outcome).toBe('lost');
    expect(slowRun.rewarded).toBe(true);
    expect(slowRun.exitId).not.toBeNull();
  });

  it('freezes the upgraded artifact when the first group enters', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(20, pid);
    spawnNaturalRiftPortal(sim.ctx, 0);
    const portalInfo = sim.naturalRiftPortals[0];
    const event = sim.riftEvents[0];
    const before = event.contentHash;
    const portal = sim.entities.get(portalInfo.id)!;
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, pid, undefined, portal);
    expect(event.contentLocked).toBe(true);
    expect(installRiftUpgrade(sim.ctx, event.eventId, event.upgrade, 'ai')).toBe(false);
    expect(event.contentHash).toBe(before);
  });
});
