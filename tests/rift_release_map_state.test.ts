// The online riftState mirror must go inactive when a player leaves the band
// WITHOUT walking an exit (issue: die in a rift, release, open the map, still
// see the rift floor).
//
// Offline, Sim.riftFloor is derived per tick from the player's position, so it
// nulls the moment the ghost lands at the overworld graveyard. Online,
// ClientWorld.riftFloor only mirrors riftState events, and before this fix the
// sim emitted active: false in exactly one place (forceExitRiftPlayer, reached
// only from leaveRift), so every OTHER teleport out of the band left the client
// stuck on the rift map: spirit release (releaseAtNearestGraveyard), the dead
// Unstuck graveyard pull (reviveAtGraveyardForUnstuck), and slot teardown
// (freeRiftInstance, which emits nothing at all).
//
// The fix is one seam rather than per-site patches: emitRiftState stamps
// Entity.riftStateActive, and the per-tick reconciliation sweep in
// rift/runs.ts (reconcileRiftStateMirrors, driven from updateRiftInstances at
// tick resolution) emits the missing active: false once a flagged member no
// longer stands inside a floor region of a run they belong to. These tests pin
// the sweep's whole contract: the release and dead-Unstuck emits, per-pid
// isolation, exactly-once through teardown, descent never interleaving a
// false, the corpse-run re-entry round trip, and the dead-unreleased-body
// regression guard (a body still ON the floor keeps the rift map).
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, isRiftPos } from '../src/sim/data';
import { spawnNaturalRiftPortal } from '../src/sim/rift/portals';
import { descendRift, updateRiftInstances } from '../src/sim/rift/runs';
import type { RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { nearestOverworldGraveyard, reviveAtGraveyardForUnstuck } from '../src/sim/spirit';
import { dist2d, type Entity, type SimEvent } from '../src/sim/types';

const TEST_WORLD = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function makeSim(): Sim {
  return new Sim({
    seed: 90417,
    playerClass: 'warrior',
    noPlayer: true,
    autoEquip: true,
    devCommands: true,
    riftPortals: true,
    world: TEST_WORLD,
  });
}

type RiftStateEvent = Extract<SimEvent, { type: 'riftState' }>;

function riftStates(events: SimEvent[], pid: number): RiftStateEvent[] {
  return events.filter((e): e is RiftStateEvent => e.type === 'riftState' && e.pid === pid);
}

/** A duo inside one shared run on floor 0, plus the portal they walked through
 * (the enterAsParty fixture from rift_corpse_descent.test.ts). */
function enterAsParty(): {
  sim: Sim;
  leader: number;
  victim: number;
  run: RiftInstance;
  portal: Entity;
} {
  const sim = makeSim();
  const leader = sim.addPlayer('warrior', 'Leader');
  const victim = sim.addPlayer('warrior', 'Victim');
  sim.setPlayerLevel(20, leader);
  sim.setPlayerLevel(20, victim);
  expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
  const portal = sim.entities.get(sim.naturalRiftPortals[0].id)!;
  sim.partyInvite(victim, leader);
  sim.partyAccept(victim);
  sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, leader, undefined, portal);
  sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, victim, undefined, portal);
  const run = sim.riftInstances.find((i) => i.partyKey !== null)!;
  expect(run.memberIds.has(victim), 'both are bound to the run').toBe(true);
  // Drain the entry riftState(active: true) pair so every test asserts only on
  // the event stream its own actions produce.
  sim.tick();
  return { sim, leader, victim, run, portal };
}

/** Clear the floor so the descent opens (the rift_binding.test.ts recipe). */
function openDescent(sim: Sim, run: RiftInstance): void {
  for (const id of run.mobIds) {
    const mob = sim.entities.get(id);
    if (mob) {
      mob.hp = 0;
      mob.dead = true;
    }
  }
  run.litPylons = new Set(run.pylonIds);
  run.puzzleSolved = true;
  sim.tickCount += (20 - (sim.tickCount % 20)) % 20;
  updateRiftInstances(sim.ctx);
  expect(run.descentOpen, 'a cleared floor opens its descent').toBe(true);
}

function kill(sim: Sim, pid: number): Entity {
  const e = sim.entities.get(pid)!;
  e.hp = 0;
  e.dead = true;
  return e;
}

/** The overworld graveyard the run's ghosts should rise at: nearest to the
 * instance's returnPos (the rift arm of spirit.ts ghostGraveyard). */
function runGraveyard(run: RiftInstance): { x: number; z: number } {
  const graveyards = TEST_WORLD.services?.graveyards;
  return graveyards && graveyards.length > 0
    ? nearestOverworldGraveyard(run.returnPos.x, run.returnPos.z, graveyards)
    : nearestOverworldGraveyard(run.returnPos.x, run.returnPos.z);
}

describe('riftState goes inactive when a player leaves the band without an exit', () => {
  it('spirit release emits active: false for the ghost only, at the right graveyard', () => {
    const { sim, leader, victim, run } = enterAsParty();
    const body = kill(sim, victim);
    sim.releaseSpirit(victim);
    expect(body.ghost, 'the spirit released').toBe(true);
    expect(isRiftPos(body.pos.x), 'the ghost stands in the overworld').toBe(false);
    expect(dist2d(body.pos, { ...runGraveyard(run), y: 0 })).toBeLessThan(0.5);

    const events = sim.tick();
    const victimStates = riftStates(events, victim);
    expect(victimStates, 'exactly one riftState for the ghost').toHaveLength(1);
    expect(victimStates[0].active).toBe(false);
    // Per-pid isolation: the living member's map mode is untouched.
    expect(riftStates(events, leader)).toHaveLength(0);
  });

  it('dead Unstuck (the graveyard revive) emits active: false too', () => {
    const { sim, victim, run } = enterAsParty();
    const body = kill(sim, victim);
    reviveAtGraveyardForUnstuck(sim.ctx, victim);
    expect(body.dead, 'unstuck raised the player').toBe(false);
    expect(isRiftPos(body.pos.x)).toBe(false);
    expect(dist2d(body.pos, { ...runGraveyard(run), y: 0 })).toBeLessThan(0.5);

    const states = riftStates(sim.tick(), victim);
    expect(states).toHaveLength(1);
    expect(states[0].active).toBe(false);
  });

  it('a dead UNRELEASED body on the floor keeps the rift map (no active: false)', () => {
    const { sim, victim } = enterAsParty();
    const body = kill(sim, victim);
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 5; i++) events.push(...sim.tick());
    expect(body.dead, 'still a body on the floor').toBe(true);
    expect(body.ghost).toBe(false);
    expect(riftStates(events, victim), 'the body is still in the rift').toHaveLength(0);
  });

  it('teardown after both members released: active: false exactly once each, then the slot frees', () => {
    const { sim, leader, victim, run } = enterAsParty();
    const events: SimEvent[] = [];

    kill(sim, victim);
    sim.releaseSpirit(victim);
    events.push(...sim.tick());

    kill(sim, leader);
    sim.releaseSpirit(leader);
    events.push(...sim.tick());

    // Both ghosts wait at the graveyard; run the 1 Hz sweep past
    // RIFT_EMPTY_TIMEOUT so the empty slot frees. The reconciliation runs on
    // every pass too, so a repeat emit would show up in the drained stream.
    sim.tickCount += (20 - (sim.tickCount % 20)) % 20; // align to the 1 Hz boundary
    for (let s = 0; s < 200; s++) {
      updateRiftInstances(sim.ctx);
      sim.tickCount += 20;
    }
    events.push(...sim.tick());
    expect(run.partyKey, 'the empty slot freed').toBeNull();

    for (const pid of [victim, leader]) {
      const states = riftStates(events, pid);
      expect(states, `pid ${pid} got exactly one riftState`).toHaveLength(1);
      expect(states[0].active).toBe(false);
    }
  });

  it('floor descent emits active: true for descenders and never an interleaved false', () => {
    const { sim, leader, victim, run } = enterAsParty();
    openDescent(sim, run);
    descendRift(sim.ctx, leader);
    expect(run.floorIndex, 'the party moved down').toBe(1);

    const events: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      // Keep the descenders alive on the fresh floor so nothing dies mid-pin.
      for (const pid of [leader, victim]) {
        const e = sim.entities.get(pid)!;
        e.hp = e.maxHp;
      }
      events.push(...sim.tick());
    }
    for (const pid of [leader, victim]) {
      const states = riftStates(events, pid);
      expect(states.length, `pid ${pid} got the descent re-emit`).toBeGreaterThan(0);
      for (const state of states) {
        expect(state.active, 'descent keeps riftState active').toBe(true);
        expect(state.floorIndex).toBe(1);
      }
    }
  });

  it('corpse-run round trip: release goes false, portal re-entry re-emits true, the rez lands', () => {
    const { sim, victim, run, portal } = enterAsParty();
    const body = kill(sim, victim);
    sim.releaseSpirit(victim);
    const released = riftStates(sim.tick(), victim);
    expect(released).toHaveLength(1);
    expect(released[0].active).toBe(false);

    // Walk the ghost back through the portal (the dead-entry arm of enterRift).
    sim.time += 10; // clear the re-entry grace
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, victim, undefined, portal);
    expect(body.dead, 'entry never resurrects').toBe(true);
    expect(isRiftPos(body.pos.x), 'the ghost is back inside').toBe(true);
    const reentered = riftStates(sim.tick(), victim);
    expect(reentered, 're-entry re-emits the active state').toHaveLength(1);
    expect(reentered[0].active).toBe(true);
    expect(reentered[0].instanceId).toBe(run.instanceId);

    sim.resurrectAtCorpse(victim);
    expect(body.dead, 'the corpse rez lands').toBe(false);
    expect(body.ghost).toBe(false);
    // Standing alive inside the run: the sweep has nothing to reconcile.
    expect(riftStates(sim.tick(), victim)).toHaveLength(0);
  });
});
