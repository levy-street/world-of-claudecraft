// WoW-raid-style rift instance binding and unspoiled-run recycling: the first
// mob kill (or plundered cache) pins a run to its members; clean runs merge and
// recycle so a freshly formed party is never split across leftover instances.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { spawnNaturalRiftPortal } from '../src/sim/rift/portals';
import {
  descendRift,
  leaveRift,
  riftInstanceAtPos,
  updateRiftInstances,
} from '../src/sim/rift/runs';
import type { RiftInstance } from '../src/sim/rift/types';
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

function activeRuns(sim: Sim): RiftInstance[] {
  return sim.riftInstances.filter((instance) => instance.partyKey !== null);
}

function markFirstKill(sim: Sim, inst: RiftInstance): void {
  const mob = sim.entities.get(inst.mobIds[0])!;
  mob.hp = 0;
  mob.dead = true;
  updateRiftInstances(sim.ctx); // tick-resolution pre-pass stamps progressed
  expect(inst.progressed).toBe(true);
}

function setup(memberCount: number): {
  sim: Sim;
  pids: number[];
  portal: import('../src/sim/types').Entity;
} {
  const sim = makeSim();
  const pids: number[] = [];
  for (let i = 0; i < memberCount; i++) {
    const pid = sim.addPlayer('warrior', `Binder${i}`);
    sim.setPlayerLevel(20, pid);
    pids.push(pid);
  }
  expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
  const portal = sim.entities.get(sim.naturalRiftPortals[0].id)!;
  return { sim, pids, portal };
}

function enter(sim: Sim, portal: import('../src/sim/types').Entity, pid: number): void {
  sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, pid, undefined, portal);
}

describe('unspoiled runs merge and recycle', () => {
  it('recycles independent clean solo runs into ONE shared run when the duo groups up', () => {
    const { sim, pids, portal } = setup(2);
    const [p1, p2] = pids;
    enter(sim, portal, p1);
    enter(sim, portal, p2);
    expect(activeRuns(sim)).toHaveLength(2); // ungrouped players race by design

    leaveRift(sim.ctx, p1);
    leaveRift(sim.ctx, p2);
    sim.time += 10; // clear the 3s re-entry grace
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    enter(sim, portal, p1);
    enter(sim, portal, p2);

    const runs = activeRuns(sim);
    expect(runs).toHaveLength(1);
    expect(runs[0].memberIds.has(p1)).toBe(true);
    expect(runs[0].memberIds.has(p2)).toBe(true);
    expect(runs[0].partyKey).toBe(`party:${sim.partyOf(p1)!.id}`);
  });

  it('merges the second member into the first member clean run when the invite lands late', () => {
    const { sim, pids, portal } = setup(2);
    const [p1, p2] = pids;
    sim.partyInvite(p2, p1);
    enter(sim, portal, p1); // walked in before the accept: solo-keyed run
    expect(activeRuns(sim)[0].partyKey).toBe(`solo:${p1}`);
    sim.partyAccept(p2);
    enter(sim, portal, p2);

    const runs = activeRuns(sim);
    expect(runs).toHaveLength(1);
    expect(runs[0].memberIds).toEqual(new Set([p1, p2]));
    expect(runs[0].partyKey).toBe(`party:${sim.partyOf(p1)!.id}`);
  });

  it('never recycles an OCCUPIED unspoiled leftover out from under its players', () => {
    const { sim, pids, portal } = setup(3);
    const [p1, p2, p3] = pids;
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    enter(sim, portal, p1);
    enter(sim, portal, p2);
    const sharedRun = activeRuns(sim)[0];
    expect(sharedRun.memberIds).toEqual(new Set([p1, p2]));

    // P1 abandons P2 mid-look (no kills yet), regroups with P3, and re-enters.
    leaveRift(sim.ctx, p1);
    sim.partyLeave(p1);
    sim.time += 10;
    sim.partyInvite(p3, p1);
    sim.partyAccept(p3);
    enter(sim, portal, p1);

    // P2 is still standing inside the old run: it must survive untouched even
    // though it is unspoiled and P1 (a member) just entered a different run.
    expect(sharedRun.partyKey).not.toBeNull();
    expect(sharedRun.outcome).toBe('active');
    const p2Entity = sim.entities.get(p2)!;
    expect(riftInstanceAtPos(sim.ctx, p2Entity.pos)).toBe(sharedRun);
    expect(sim.entities.has(sharedRun.mobIds[0])).toBe(true);
    // P1 got a fresh run for the new party instead.
    const p1Run = riftInstanceAtPos(sim.ctx, sim.entities.get(p1)!.pos)!;
    expect(p1Run).not.toBe(sharedRun);
    expect(p1Run.partyKey).toBe(`party:${sim.partyOf(p1)!.id}`);
  });

  it('survives party-id churn: a disband and reinvite still lands the duo together', () => {
    const { sim, pids, portal } = setup(2);
    const [p1, p2] = pids;
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    const firstPartyId = sim.partyOf(p1)!.id;
    enter(sim, portal, p1);
    expect(activeRuns(sim)[0].partyKey).toBe(`party:${firstPartyId}`);

    sim.partyLeave(p2); // 2-man party disbands entirely
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    expect(sim.partyOf(p2)!.id).not.toBe(firstPartyId);
    enter(sim, portal, p2);

    const runs = activeRuns(sim);
    expect(runs).toHaveLength(1);
    expect(runs[0].memberIds).toEqual(new Set([p1, p2]));
    expect(runs[0].partyKey).toBe(`party:${sim.partyOf(p2)!.id}`);
  });
});

describe('unspoiled runs and dead members', () => {
  it('never recycles a zero-kill wipe out from under its dead members', () => {
    const { sim, pids, portal } = setup(2);
    const [p1, p2] = pids;
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    enter(sim, portal, p1);
    enter(sim, portal, p2);
    const run = activeRuns(sim)[0];
    expect(run.progressed).toBe(false);

    // Wipe with ZERO kills: both die and release out of the region. The run is
    // unspoiled and player-empty, i.e. recycle bait, but the ghosts are owed a
    // corpse run (enterRift's death rules).
    const e1 = sim.entities.get(p1)!;
    const e2 = sim.entities.get(p2)!;
    e1.dead = true;
    e1.ghost = true; // released spirit: the only dead state allowed back in
    e2.dead = true;
    e2.ghost = true;
    const releasePos = { x: run.returnPos.x, y: 0, z: run.returnPos.z };
    e1.pos = { ...releasePos };
    e1.prevPos = { ...releasePos };
    e2.pos = { ...releasePos };
    e2.prevPos = { ...releasePos };
    sim.time += 10;

    // P1 resurrects, quits the party, and enters solo: gets a FRESH run, and
    // the wiped run must survive for the ghost.
    e1.dead = false;
    e1.ghost = false;
    sim.partyLeave(p1);
    enter(sim, portal, p1);
    expect(run.partyKey).not.toBeNull();
    expect(run.outcome).toBe('active');
    expect(riftInstanceAtPos(sim.ctx, e1.pos)).not.toBe(run);

    // The ghost re-enters their own run for the corpse.
    enter(sim, portal, p2);
    expect(riftInstanceAtPos(sim.ctx, e2.pos)).toBe(run);
  });
});

describe('progressed runs bind their members', () => {
  it('first kill pins the run: regrouping re-enters the SAME spoiled run for both', () => {
    const { sim, pids, portal } = setup(2);
    const [p1, p2] = pids;
    enter(sim, portal, p1);
    const run = activeRuns(sim)[0];
    markFirstKill(sim, run);
    leaveRift(sim.ctx, p1);
    sim.time += 10;
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);

    enter(sim, portal, p1);
    enter(sim, portal, p2);
    const runs = activeRuns(sim);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toBe(run); // the progressed run survived, nothing recycled
    expect(run.memberIds).toEqual(new Set([p1, p2]));
    expect(run.progressed).toBe(true);
  });

  it('progress survives descent: the flag persists across the floor teardown', () => {
    const { sim, pids, portal } = setup(1);
    const p1 = pids[0];
    enter(sim, portal, p1);
    const run = activeRuns(sim)[0];
    markFirstKill(sim, run);

    // Clear the floor for real so the descent opens, then take it.
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
    expect(run.descentOpen).toBe(true);
    descendRift(sim.ctx, p1);
    expect(run.floorIndex).toBe(1);
    // The new floor spawned all-new living mobs; only the persisted flag keeps
    // the run bound, so it MUST survive freeRiftFloorEntities.
    expect(run.progressed).toBe(true);
  });

  it('a bound player entering the portal always lands in their own run, never the party one', () => {
    const { sim, pids, portal } = setup(3);
    const [p1, p3] = [pids[0], pids[2]];
    enter(sim, portal, p1);
    const runA = activeRuns(sim)[0];
    markFirstKill(sim, runA);
    leaveRift(sim.ctx, p1);

    enter(sim, portal, p3);
    const runB = activeRuns(sim).find((candidate) => candidate !== runA)!;
    markFirstKill(sim, runB);

    // P1 joins P3's party, but P1 is bound to run A: the portal must route P1
    // back into A and never into the party's run B.
    sim.time += 10;
    sim.partyInvite(p1, p3);
    sim.partyAccept(p1);
    enter(sim, portal, p1);
    expect(runB.memberIds.has(p1)).toBe(false);
    expect(runA.memberIds.has(p1)).toBe(true);
    const p1Entity = sim.entities.get(p1)!;
    expect(riftInstanceAtPos(sim.ctx, p1Entity.pos)).toBe(runA);
  });

  it('a replacement invite joins the party live progressed run and becomes bound to it', () => {
    const { sim, pids, portal } = setup(3);
    const [p1, p2, p4] = pids;
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    enter(sim, portal, p1);
    enter(sim, portal, p2);
    const run = activeRuns(sim)[0];
    markFirstKill(sim, run);

    // P2 drops out entirely; the 2-man party disbands, P1 keeps fighting.
    leaveRift(sim.ctx, p2);
    sim.partyLeave(p2);
    sim.time += 10;
    sim.partyInvite(p4, p1);
    sim.partyAccept(p4);
    enter(sim, portal, p4);

    expect(run.memberIds.has(p4)).toBe(true);
    expect(activeRuns(sim)).toHaveLength(1);
    const p4Entity = sim.entities.get(p4)!;
    expect(riftInstanceAtPos(sim.ctx, p4Entity.pos)).toBe(run);
    // Bound now: even after leaving the party, P4 re-enters this same run.
    leaveRift(sim.ctx, p4);
    sim.partyLeave(p4);
    sim.time += 10;
    enter(sim, portal, p4);
    expect(riftInstanceAtPos(sim.ctx, sim.entities.get(p4)!.pos)).toBe(run);
  });

  it('plundering the hidden cache spoils the run exactly like a kill, and binds', () => {
    const sim = makeSim();
    const p1 = sim.addPlayer('warrior', 'Plunderer');
    const p2 = sim.addPlayer('priest', 'Sidekick');
    sim.setPlayerLevel(20, p1);
    sim.setPlayerLevel(20, p2);
    // ~45% of non-boss floors tuck a cache away; walk dev seeds until one does.
    // Capture the run BY SEED so stale leftovers from earlier iterations can
    // never be mistaken for the current one.
    let run: RiftInstance | null = null;
    let chest: import('../src/sim/types').Entity | undefined;
    for (let seed = 1; seed <= 40 && !chest; seed++) {
      sim.enterRift(seed, 20, p1);
      run = sim.riftInstances.find(
        (instance) =>
          instance.outcome === 'active' &&
          instance.memberIds.has(p1) &&
          instance.seed === seed >>> 0,
      )!;
      chest = run.objectIds
        .map((id) => sim.entities.get(id))
        .find((entity) => entity?.templateId === 'rift_treasure');
      if (!chest) {
        leaveRift(sim.ctx, p1);
        sim.time += 10;
      }
    }
    expect(chest, 'found a floor with a hidden cache').toBeDefined();
    expect(run!.progressed).toBe(false);
    const player = sim.entities.get(p1)!;
    player.pos = { ...chest!.pos };
    player.prevPos = { ...chest!.pos };
    sim.riftOpenTreasure(chest!.id, p1);
    expect(chest!.templateId).toBe('rift_treasure_open');
    expect(run!.progressed).toBe(true);

    // Same consequence as a kill: the spoiled run binds. Regrouping does not
    // recycle it; P1 re-enters the SAME run (chest stays open, no farm loop)
    // and the new mate lands in it too.
    leaveRift(sim.ctx, p1);
    sim.time += 10;
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    sim.enterRift(run!.seed, 20, p1);
    sim.enterRift(run!.seed, 20, p2);
    expect(riftInstanceAtPos(sim.ctx, sim.entities.get(p1)!.pos)).toBe(run);
    expect(riftInstanceAtPos(sim.ctx, sim.entities.get(p2)!.pos)).toBe(run);
    expect(sim.entities.get(chest!.id)?.templateId).toBe('rift_treasure_open');
  });
});
