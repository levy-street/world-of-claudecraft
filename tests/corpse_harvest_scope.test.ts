// Direct regression coverage for professions/corpse_harvest_scope.ts
// `sameHarvestScope`, driven by REAL instance/rift/delve fixtures
// (tests/helpers/instanced_contexts.ts) and the actual ownership registries
// (`ctx.instances`, `ctx.riftInstances`, `ctx.delveRuns`), never an unrelated
// out-of-range refusal as proof of ownership. Complements
// tests/corpse_harvest_cast.test.ts (the live cast) and
// tests/harvest_admission.test.ts (the pure admission decision).
//
// The invariant under test: authorization requires BOTH registration
// (a slot's mobIds roster, a rift's mobIds + memberIds, a delve run's mobIds)
// AND physical location (the same InstanceSlot object, the same rift floor,
// the same delve occupancy band), checked for the CORPSE and the ACTOR
// independently. Neither half substitutes for the other: a teleported
// stranger can share a position with no membership, and a departed member
// can keep membership with no position. The delve arm additionally uses a
// COLD (non-mutating) read of the actor's own run rather than the real
// `delveRunForPlayer`, which can rebind a run to a new occupant as a side
// effect a scope CHECK must never trigger. With no live claim anywhere, a
// corpse or an actor still inside the instance plane (`DUNGEON_X_THRESHOLD`
// east) is an orphan on that side and never resolves to open-world content.
// Every position comparison is written as the negation of the true sense
// (e.g. `!(x <= n)`) so a non-finite coordinate is rejected rather than
// silently admitted (`NaN > n` and `NaN <= n` are both false).

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { sameHarvestScope } from '../src/sim/professions/corpse_harvest_scope';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { placeInDelve, placeInDungeon, placeInRift } from './helpers/instanced_contexts';
import { EMPTY_TEST_WORLD } from './sim_shared';

const SCOPE_TEST_WORLD = { ...EMPTY_TEST_WORLD, roads: [] };

function makeSim(seed: number): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: SCOPE_TEST_WORLD });
}

function mustEntity(sim: Sim, pid: number): Entity {
  return expectDefined(sim.entities.get(pid));
}

function spawnWolfAt(sim: Sim, id: number, pos: Entity['pos']): Entity {
  const template = MOBS.forest_wolf;
  const mob = createMob(id, template, template.maxLevel, { ...pos });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  sim.entities.set(mob.id, mob);
  return mob;
}

describe('dungeon/raid: same live SLOT, not just a matching partyKey string', () => {
  it('a real, correctly-owned claim (actor and corpse both in the SAME slot) is authorized', () => {
    const sim = makeSim(101);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const placement = placeInDungeon(sim, pid);
    const slot = sim.ctx.instances.find(
      (i) => i.dungeonId === placement.dungeonId && i.slot === placement.slot,
    );
    expect(slot).toBeDefined();
    if (!slot) return;
    const mob = spawnWolfAt(sim, 9001, mustEntity(sim, pid).pos);
    slot.mobIds.push(mob.id);

    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(true);
  });

  it('REGRESSION: two live slots sharing one partyKey must not authorize a corpse claimed by the WRONG slot', () => {
    const sim = makeSim(102);
    const actorPid = sim.addPlayer('warrior', 'Actor');
    const fillerPid = sim.addPlayer('warrior', 'Filler');
    sim.tick();

    // Two REAL, independently-claimed solo instances.
    const actorPlacement = placeInDungeon(sim, actorPid);
    const fillerPlacement = placeInDungeon(sim, fillerPid);
    const actorSlot = sim.ctx.instances.find(
      (i) => i.dungeonId === actorPlacement.dungeonId && i.slot === actorPlacement.slot,
    );
    const fillerSlot = sim.ctx.instances.find(
      (i) => i.dungeonId === fillerPlacement.dungeonId && i.slot === fillerPlacement.slot,
    );
    expect(actorSlot).toBeDefined();
    expect(fillerSlot).toBeDefined();
    if (!actorSlot || !fillerSlot) return;
    expect(actorSlot).not.toBe(fillerSlot);

    // Simulate the exact collision the review flagged: the filler's slot now
    // carries the SAME partyKey string as the actor's (a stale/reused key),
    // and the corpse is registered ONLY to the filler's slot, not the one the
    // actor is physically standing in.
    fillerSlot.partyKey = actorSlot.partyKey;
    const mob = spawnWolfAt(sim, 9002, mustEntity(sim, fillerPid).pos);
    fillerSlot.mobIds.push(mob.id);

    // The actor never entered the filler's slot: real ownership must refuse.
    expect(sameHarvestScope(sim.ctx, actorPid, mob)).toBe(false);
  });

  it("REGRESSION: a stranger merely standing at the owner's coordinates, never having entered the party, must not be authorized", () => {
    const sim = makeSim(107);
    const ownerPid = sim.addPlayer('warrior', 'Owner');
    const strangerPid = sim.addPlayer('warrior', 'Stranger');
    sim.tick();
    const placement = placeInDungeon(sim, ownerPid);
    const slot = sim.ctx.instances.find(
      (i) => i.dungeonId === placement.dungeonId && i.slot === placement.slot,
    );
    expect(slot).toBeDefined();
    if (!slot) return;
    const owner = mustEntity(sim, ownerPid);
    const mob = spawnWolfAt(sim, 9007, owner.pos);
    slot.mobIds.push(mob.id);

    // The stranger never entered the owner's party/instance; only their raw
    // position happens to coincide (a teleport, not a real entry).
    const stranger = mustEntity(sim, strangerPid);
    stranger.pos = { ...owner.pos };
    stranger.prevPos = { ...stranger.pos };
    expect(sim.ctx.instanceKeyFor(strangerPid)).not.toBe(slot.partyKey);

    expect(sameHarvestScope(sim.ctx, strangerPid, mob)).toBe(false);
  });

  it("REGRESSION: a claimed corpse dragged outside its own slot must not be authorized even for the slot's rightful owner", () => {
    const sim = makeSim(108);
    const ownerPid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const placement = placeInDungeon(sim, ownerPid);
    const slot = sim.ctx.instances.find(
      (i) => i.dungeonId === placement.dungeonId && i.slot === placement.slot,
    );
    expect(slot).toBeDefined();
    if (!slot) return;
    const mob = spawnWolfAt(sim, 9008, mustEntity(sim, ownerPid).pos);
    slot.mobIds.push(mob.id);

    // The corpse's own position is dragged out of the claimed slot's
    // footprint entirely (e.g. a stale registration surviving a move).
    mob.pos = sim.groundPos(0, 0);

    expect(sameHarvestScope(sim.ctx, ownerPid, mob)).toBe(false);
  });
});

describe("rift: the corpse must belong to the live instance's OWN mob roster, not just its region", () => {
  it('a real, correctly-owned rift corpse (registered in mobIds, actor a member) is authorized', () => {
    const sim = makeSim(103);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const { instance } = placeInRift(sim, pid);
    const mob = spawnWolfAt(sim, 9003, mustEntity(sim, pid).pos);
    instance.mobIds.push(mob.id);

    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(true);
  });

  it('REGRESSION: a mob merely standing in the region, absent from the instance mobIds roster, must not be authorized', () => {
    const sim = makeSim(104);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const { instance } = placeInRift(sim, pid);
    // Same region, same member: everything region/membership can see says
    // yes. The corpse's own mob id was never added to instance.mobIds (a
    // stale mob from a prior floor, or a neighboring instance's leak).
    const mob = spawnWolfAt(sim, 9004, mustEntity(sim, pid).pos);
    expect(instance.mobIds).not.toContain(mob.id);

    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(false);
  });

  it('REGRESSION: a member who has walked back to the open world (position off the active floor) must not be authorized', () => {
    const sim = makeSim(1041);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const { instance } = placeInRift(sim, pid);
    const mob = spawnWolfAt(sim, 90041, mustEntity(sim, pid).pos);
    instance.mobIds.push(mob.id);

    // Membership persists, but the actor's live position is no longer on the
    // instance's own floor.
    const actor = mustEntity(sim, pid);
    actor.pos = sim.groundPos(0, 0);
    expect(instance.memberIds.has(pid)).toBe(true);

    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(false);
  });
});

describe('delve: cold membership check, no mutating rebind', () => {
  it('a real, correctly-owned delve corpse (registered in mobIds, actor the live occupant) is authorized', () => {
    const sim = makeSim(105);
    const ownerPid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const { run } = placeInDelve(sim, ownerPid);
    const mob = spawnWolfAt(sim, 9005, mustEntity(sim, ownerPid).pos);
    run.mobIds.push(mob.id);

    expect(sameHarvestScope(sim.ctx, ownerPid, mob)).toBe(true);
  });

  it("REGRESSION: an unrelated orphan wandering into an ABANDONED run's band must not have sameHarvestScope rebind the run onto them", () => {
    // The real rebindDelveRunToOccupant (delves/runs.ts) only fires when the
    // run's OWN key has zero live occupants (ctx.partyMembersForKey) AND the
    // visiting entity's own key owns no run yet: an owner still standing in
    // their own run is NOT eligible (this is what makes the ordinary
    // positive case above harmless to call this cold view from). Abandon the
    // run for real (the owner disconnects) before the orphan walks in, so
    // the rebind condition genuinely holds and the cold view is the only
    // thing standing between "check" and "claim".
    const sim = makeSim(106);
    const ownerPid = sim.addPlayer('warrior', 'Owner');
    const orphanPid = sim.addPlayer('warrior', 'Orphan');
    sim.tick();
    const { run } = placeInDelve(sim, ownerPid);
    const origin = { ...run.origin };
    sim.removePlayer(ownerPid);
    expect(sim.ctx.partyMembersForKey(expectDefined(run.partyKey)).length).toBe(0);

    const orphan = mustEntity(sim, orphanPid);
    orphan.pos = { x: origin.x, y: orphan.pos.y, z: origin.z };
    orphan.prevPos = { ...orphan.pos };

    const beforePartyKey = run.partyKey;
    const beforeRunCount = sim.ctx.delveRuns.length;

    // An unrelated open-world corpse: the scope check itself must stay a
    // cold, non-mutating read while it evaluates the orphan's membership.
    const mob = spawnWolfAt(sim, 9006, { x: 0, y: 0, z: 0 });
    sameHarvestScope(sim.ctx, orphanPid, mob);

    expect(run.partyKey).toBe(beforePartyKey);
    expect(sim.ctx.delveRuns.length).toBe(beforeRunCount);
  });

  it('REGRESSION: a non-finite actor position must never satisfy the band comparison (NaN is not <= 120)', () => {
    const sim = makeSim(1061);
    const ownerPid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const { run } = placeInDelve(sim, ownerPid);
    const mob = spawnWolfAt(sim, 90061, mustEntity(sim, ownerPid).pos);
    run.mobIds.push(mob.id);

    const owner = mustEntity(sim, ownerPid);
    owner.pos = { ...owner.pos, x: Number.NaN };

    expect(sameHarvestScope(sim.ctx, ownerPid, mob)).toBe(false);
  });

  it("REGRESSION: a registered delve corpse dragged outside its own run's band must not be authorized for the run's live occupant", () => {
    const sim = makeSim(1071);
    const ownerPid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const { run } = placeInDelve(sim, ownerPid);
    const mob = spawnWolfAt(sim, 90071, mustEntity(sim, ownerPid).pos);
    run.mobIds.push(mob.id);

    // The owner never moves (still the run's live occupant, key-matched and
    // inside the band); only the corpse's own registration survives a move
    // to an unrelated open-world position.
    mob.pos = sim.groundPos(0, 0);

    expect(sameHarvestScope(sim.ctx, ownerPid, mob)).toBe(false);
  });

  it('REGRESSION: a non-finite CORPSE position must never satisfy the band comparison either', () => {
    const sim = makeSim(1072);
    const ownerPid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const { run } = placeInDelve(sim, ownerPid);
    const mob = spawnWolfAt(sim, 90072, mustEntity(sim, ownerPid).pos);
    run.mobIds.push(mob.id);
    mob.pos.z = Number.NaN;

    expect(sameHarvestScope(sim.ctx, ownerPid, mob)).toBe(false);
  });
});

describe('REGRESSION: non-finite positions are rejected up front, on every axis, before any context branch', () => {
  it('a non-finite actor Y position is rejected even for a real dungeon claim (y was never checked before)', () => {
    const sim = makeSim(1081);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const placement = placeInDungeon(sim, pid);
    const slot = sim.ctx.instances.find(
      (i) => i.dungeonId === placement.dungeonId && i.slot === placement.slot,
    );
    expect(slot).toBeDefined();
    if (!slot) return;
    const actor = mustEntity(sim, pid);
    const mob = spawnWolfAt(sim, 9009, actor.pos);
    slot.mobIds.push(mob.id);

    actor.pos = { ...actor.pos, y: Number.NaN };
    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(false);
  });

  it('a non-finite corpse Y position is rejected even for a real dungeon claim', () => {
    const sim = makeSim(1082);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const placement = placeInDungeon(sim, pid);
    const slot = sim.ctx.instances.find(
      (i) => i.dungeonId === placement.dungeonId && i.slot === placement.slot,
    );
    expect(slot).toBeDefined();
    if (!slot) return;
    const mob = spawnWolfAt(sim, 9010, mustEntity(sim, pid).pos);
    slot.mobIds.push(mob.id);

    mob.pos.y = Number.NaN;
    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(false);
  });

  it('a non-finite actor position is rejected in the open-world fallback too', () => {
    const sim = makeSim(1083);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const actor = mustEntity(sim, pid);
    const mob = spawnWolfAt(sim, 9011, actor.pos);

    actor.pos = { ...actor.pos, x: Number.POSITIVE_INFINITY };
    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(false);
  });
});

describe('no live claim: the instance-plane orphan check is symmetric on actor and corpse', () => {
  it('REGRESSION: an actor standing in the instance plane with no claim, and an open-world corpse, must not be authorized', () => {
    const sim = makeSim(1091);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const actor = mustEntity(sim, pid);
    const mob = spawnWolfAt(sim, 9012, sim.groundPos(0, 0));

    // No live dungeon/rift/delve claim anywhere; only the actor's raw
    // coordinates sit inside the instance plane (a stray teleport, never a
    // real entry, so no InstanceSlot/RiftInstance/DelveRun exists to check).
    actor.pos = { x: 999999, y: actor.pos.y, z: 999999 };

    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(false);
  });

  it('an ordinary open-world actor and corpse, both outside the instance plane with no claim, are authorized', () => {
    const sim = makeSim(1092);
    const pid = sim.addPlayer('warrior', 'Alpha');
    sim.tick();
    const actor = mustEntity(sim, pid);
    const mob = spawnWolfAt(sim, 9013, actor.pos);

    expect(sameHarvestScope(sim.ctx, pid, mob)).toBe(true);
  });
});
