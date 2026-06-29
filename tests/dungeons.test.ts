// Direct unit tests for the dungeon-instancing module (src/sim/instances/dungeons.ts),
// extracted in session I1. Drives the module's exported functions against a real Sim's
// SimContext (and a few via the Sim facade), proving the door-trigger enter/leave path,
// the party-shared instance, the claim -> free empty-reset, and the raid-lockout gate.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  enterDungeon,
  instanceKeyFor,
  instanceOriginOf,
  leaveDungeon,
  updateDoorTriggers,
  updateInstances,
} from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 99): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function hollowDoor(sim: AnySim): AnyEntity {
  return [...sim.entities.values()].find(
    (e: AnyEntity) => e.templateId === 'dungeon_door' && e.dungeonId === 'hollow_crypt',
  ) as AnyEntity;
}

function claimedHollow(sim: AnySim): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
  );
}

describe('dungeons: door-trigger entry/exit', () => {
  it('walking onto a dungeon door teleports the player into a freshly claimed instance', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    const door = hollowDoor(sim);
    teleport(sim, p, door.pos.x, door.pos.z);

    updateDoorTriggers(sim.ctx, p);

    const slot = sim.instanceSlotAt(p.pos);
    expect(slot).not.toBeNull();
    const inst = claimedHollow(sim);
    expect(inst.slot).toBe(slot);
    expect(inst.partyKey).toBe(instanceKeyFor(sim.ctx, pid)); // solo:<pid>
    expect(inst.mobIds.length).toBeGreaterThan(0); // claimInstance spawned the elites
    expect(inst.exitId).not.toBeNull();
  });

  it('a party of two walking the same door shares ONE instance (instanceKeyFor)', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aaa');
    const b = sim.addPlayer('mage', 'Bbb');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    const ea = sim.entities.get(a) as AnyEntity;
    const eb = sim.entities.get(b) as AnyEntity;
    const door = hollowDoor(sim);

    teleport(sim, ea, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, ea);
    teleport(sim, eb, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, eb);

    expect(sim.instanceSlotAt(ea.pos)).toBe(sim.instanceSlotAt(eb.pos));
    const claimed = (sim.instances as any[]).filter(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
    );
    expect(claimed.length).toBe(1);
    expect(claimed[0].partyKey).toBe(instanceKeyFor(sim.ctx, a));
  });

  it('walking the exit portal climbs the player back out (no DUNGEON_LIST[0] fallback)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    const door = hollowDoor(sim);
    teleport(sim, p, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, p);
    const inst = claimedHollow(sim);

    const exit = sim.entities.get(inst.exitId) as AnyEntity;
    teleport(sim, p, exit.pos.x, exit.pos.z);
    updateDoorTriggers(sim.ctx, p);

    expect(sim.instanceSlotAt(p.pos)).toBeNull(); // back outside the instance
  });
});

describe('dungeons: empty-instance reset', () => {
  it('updateInstances frees an empty claimed instance past the timeout', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = claimedHollow(sim);
    const mobIds = [...inst.mobIds];
    const objectIds = [...inst.objectIds];
    const exitId = inst.exitId as number;
    expect(mobIds.length).toBeGreaterThan(0);

    // Move the player out to the overworld, jump the empty timer past the timeout.
    teleport(sim, p, 0, 0);
    inst.emptyFor = 100000;
    updateInstances(sim.ctx); // tickCount 0 % 20 === 0, so the reaper runs

    expect(inst.partyKey).toBeNull();
    expect(inst.mobIds.length).toBe(0);
    expect(inst.objectIds.length).toBe(0);
    expect(inst.exitId).toBeNull();
    expect(mobIds.every((id) => !sim.entities.has(id))).toBe(true);
    expect(objectIds.every((id) => !sim.entities.has(id))).toBe(true);
    expect(sim.entities.has(exitId)).toBe(false);
  });

  it('an occupied instance never resets (emptyFor stays 0)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = claimedHollow(sim);
    inst.emptyFor = 100000; // even pre-loaded, an occupied check resets it
    updateInstances(sim.ctx);
    expect(inst.partyKey).not.toBeNull();
    expect(inst.emptyFor).toBe(0);
  });
});

describe('dungeons: concurrent-instance capacity', () => {
  it('more than six solo parties can hold their own Hollow Crypt instance at once', () => {
    const sim = makeSim();
    const PARTIES = 8; // was capped at 6 concurrent instances before the bump
    for (let i = 0; i < PARTIES; i++) {
      const pid = sim.addPlayer('warrior', `Solo${i}`);
      sim.drainEvents();
      enterDungeon(sim.ctx, 'hollow_crypt', pid);
      const events = sim.drainEvents() as any[];
      expect(
        events.some((e) => e.type === 'error' && /All instances of .* are busy/.test(e.text ?? '')),
      ).toBe(false);
    }
    const claimed = (sim.instances as any[]).filter(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
    );
    expect(claimed.length).toBe(PARTIES);
    // every claimed party landed in a distinct slot (no double-booking)
    expect(new Set(claimed.map((i) => i.slot)).size).toBe(PARTIES);
  });
});

describe('dungeons: raid lockout gate', () => {
  function attunedRaid(sim: AnySim): number {
    const leader = sim.addPlayer('warrior', 'Lead');
    while ((sim.partyOf(leader)?.members.length ?? 1) < 5) {
      const pid = sim.addPlayer('priest', `Fill${sim.players.size}`);
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(leader);
    sim.players.get(leader)!.questsDone.add('q_nythraxis_bound_guardian');
    return leader;
  }

  it('an active lockout blocks entry and emits the locked-to-arena error', () => {
    const sim = makeSim();
    const leader = attunedRaid(sim);
    sim.players.get(leader)!.raidLockouts.set('nythraxis_boss_arena', 999999999);
    sim.drainEvents();

    enterDungeon(sim.ctx, 'nythraxis_boss_arena', leader);

    const events = sim.drainEvents() as any[];
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'You are locked to Nythraxis Raid Arena.',
      ),
    ).toBe(true);
    expect(sim.instanceSlotAt(sim.entities.get(leader)!.pos)).toBeNull(); // not entered
  });

  it('an expired lockout is deleted and no longer blocks entry', () => {
    const sim = makeSim();
    const leader = attunedRaid(sim);
    sim.players.get(leader)!.raidLockouts.set('nythraxis_boss_arena', 0); // 0 <= lockoutNowMs
    sim.drainEvents();

    enterDungeon(sim.ctx, 'nythraxis_boss_arena', leader);

    expect(sim.players.get(leader)!.raidLockouts.has('nythraxis_boss_arena')).toBe(false);
    const events = sim.drainEvents() as any[];
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'You are locked to Nythraxis Raid Arena.',
      ),
    ).toBe(false);
  });

  it('a non-raid party cannot enter the raid-required arena', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    sim.players.get(pid)!.questsDone.add('q_nythraxis_bound_guardian');
    sim.drainEvents();
    enterDungeon(sim.ctx, 'nythraxis_boss_arena', pid);
    const events = sim.drainEvents() as any[];
    expect(
      events.some(
        (e) =>
          e.type === 'error' && e.text === 'You must convert your party to a raid group first.',
      ),
    ).toBe(true);
  });
});

describe('dungeons: pure helpers', () => {
  it('instanceKeyFor keys solo vs party players', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aaa');
    expect(instanceKeyFor(sim.ctx, a)).toBe(`solo:${a}`);
    const b = sim.addPlayer('mage', 'Bbb');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    const party = sim.partyOf(a)!;
    expect(instanceKeyFor(sim.ctx, a)).toBe(`party:${party.id}`);
    expect(instanceKeyFor(sim.ctx, b)).toBe(`party:${party.id}`);
  });

  it('instanceOriginOf matches the data instanceOrigin for the slot', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = claimedHollow(sim);
    expect(instanceOriginOf(inst)).toEqual(instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot));
  });
});

describe('dungeons: leaveDungeon guard', () => {
  it('leaveDungeon from the overworld is a no-op (no fallback teleport)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    teleport(sim, p, 0, 0);
    const before = { ...p.pos };
    leaveDungeon(sim.ctx, pid);
    expect(p.pos.x).toBe(before.x);
    expect(p.pos.z).toBe(before.z);
  });
});
