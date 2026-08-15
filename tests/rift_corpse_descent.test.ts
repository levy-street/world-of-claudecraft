// A rift corpse must come FORWARD with the run when the party descends.
//
// Rift floors are separate z-stacked regions (RIFT_FLOOR_SPACING in src/sim/data.ts,
// detection regions deliberately non-overlapping), and a rift death sends the ghost
// OUT to an overworld graveyard while the body stays on the floor. Before this fix
// descendRift advanced inst.floorIndex and touched no corpsePos, so a member who was
// dead when the party moved on had their corpse orphaned a whole floor behind: the
// region holds no live instance (riftInstanceAtPos returns null there, so no beacon
// and no exit), and enterRift always lands a returning ghost on the CURRENT floor,
// far outside CORPSE_REZ_RANGE. The corpse run is a first-class flow here (enterRift
// has a dedicated dead-entry arm), so losing it silently is a defect, not a rule.
//
// Both death states are covered, because they reach the new floor by different routes:
// a RELEASED spirit already carries corpsePos and is usually standing outside the
// region, so only the new sweep saves it. An UNRELEASED body rides the descent as an
// ordinary descender and stamps its corpse on arrival, which already worked before
// this fix; that case is pinned here as a REGRESSION guard, not as new behavior.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, isRiftPos, riftInstanceOrigin } from '../src/sim/data';
import { spawnNaturalRiftPortal } from '../src/sim/rift/portals';
import { descendRift, riftInstanceAtPos, updateRiftInstances } from '../src/sim/rift/runs';
import type { RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { CORPSE_REZ_RANGE } from '../src/sim/spirit';
import { dist2d, type Entity, PARTY_XP_RANGE } from '../src/sim/types';

const TEST_WORLD = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

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

/** A duo inside one shared run on floor 0, plus the portal they walked through. */
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
  expect(run.floorIndex, 'the duo starts on floor 0').toBe(0);
  expect(run.memberIds.has(victim), 'both are bound to the run').toBe(true);
  return { sim, leader, victim, run, portal };
}

/** Clear the floor for real so the descent opens (the rift_binding.test.ts recipe). */
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

describe('a rift corpse follows the run when the party descends', () => {
  it('carries a RELEASED spirit corpse forward, so the ghost can still corpse-run', () => {
    const { sim, leader, victim, run, portal } = enterAsParty();
    const body = kill(sim, victim);
    sim.releaseSpirit(victim);
    expect(body.ghost, 'the spirit released').toBe(true);
    const oldFloorOrigin = riftInstanceOrigin(run.slot, 0);
    expect(
      Math.abs(body.corpsePos!.z - oldFloorOrigin.z),
      'the corpse starts inside the floor 0 region',
    ).toBeLessThan(160);

    openDescent(sim, run);
    descendRift(sim.ctx, leader);
    expect(run.floorIndex, 'the party moved on').toBe(1);

    // The corpse came with the run: it now sits in the live floor 1 region.
    const corpse = body.corpsePos!;
    expect(riftInstanceAtPos(sim.ctx, corpse), 'the corpse is in a LIVE region').toBe(run);
    const newFloorOrigin = riftInstanceOrigin(run.slot, 1);
    expect(Math.abs(corpse.z - newFloorOrigin.z)).toBeLessThan(160);

    // Which makes the corpse run work again: re-enter, land on the current floor,
    // and the body is right there rather than a whole floor behind.
    sim.time += 10; // clear the re-entry grace
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, victim, undefined, portal);
    expect(body.dead, 'entry never resurrects').toBe(true);
    expect(
      dist2d(body.pos, corpse),
      'the returning ghost lands within corpse-rez range',
    ).toBeLessThanOrEqual(CORPSE_REZ_RANGE);
    sim.resurrectAtCorpse(victim);
    expect(body.dead, 'the corpse rez lands').toBe(false);
    expect(body.ghost).toBe(false);
  });

  it('carries an UNRELEASED body forward, so its later corpse lands on the new floor', () => {
    const { sim, leader, victim, run } = enterAsParty();
    const body = kill(sim, victim);
    expect(body.ghost, 'no release yet: still a body on the floor').toBe(false);
    expect(body.corpsePos, 'an unreleased body has stamped no corpse').toBeFalsy();

    openDescent(sim, run);
    descendRift(sim.ctx, leader);

    const newFloorOrigin = riftInstanceOrigin(run.slot, 1);
    expect(
      Math.abs(body.pos.z - newFloorOrigin.z),
      'the dead body rode the descent with the party',
    ).toBeLessThan(160);

    // Releasing now stamps the corpse where the body actually is: the NEW floor.
    sim.releaseSpirit(victim);
    expect(body.ghost).toBe(true);
    expect(riftInstanceAtPos(sim.ctx, body.corpsePos!), 'corpse in the live region').toBe(run);
  });

  it('gives the moved corpse and every descender their OWN position object', () => {
    // The descent resolves ONE arrival point and hands it to the whole party plus any
    // moved corpse. Sharing that Vec3 by reference instead of cloning it would tie a
    // corpse marker to a living player's position: the first step off the entry would
    // drag the corpse along, and a corpse run could never end. Nothing else in the
    // suite can see that, because aliased objects START with equal values, so this
    // asserts identity and then MUTATES to prove the values are genuinely independent.
    const { sim, leader, victim, run } = enterAsParty();
    const body = kill(sim, victim);
    sim.releaseSpirit(victim);
    const leaderEntity = sim.entities.get(leader)!;

    openDescent(sim, run);
    descendRift(sim.ctx, leader);

    const corpse = body.corpsePos!;
    expect(corpse, 'the corpse is not the leader position object').not.toBe(leaderEntity.pos);
    expect(corpse, 'nor the leader prevPos object').not.toBe(leaderEntity.prevPos);
    expect(leaderEntity.pos, 'pos and prevPos are distinct objects').not.toBe(leaderEntity.prevPos);

    // Walking away must not drag the corpse (or prevPos) with it.
    const corpseX = corpse.x;
    leaderEntity.pos.x += 25;
    expect(body.corpsePos!.x, 'the corpse stayed put').toBe(corpseX);
    expect(leaderEntity.prevPos.x, 'prevPos stayed put').not.toBe(leaderEntity.pos.x);
  });

  it('restores LOOT-ROLL eligibility for the graveyard-parked ghost (stated, not incidental)', () => {
    // A CONSEQUENCE of moving the corpse, pinned here so it is deliberate rather than
    // silent. combat/damage.ts uses a released member's corpsePos as their kill-time
    // participation position within PARTY_XP_RANGE, on purpose ("releasing during the
    // final seconds does not erase XP, loot-roll, or Heroic Mark rights"), and for a
    // rift the instance arm of that check never binds (instanceClaimIdAt scans dungeon
    // slots only), so the corpse arm always applies. That rule already held WITHIN a
    // floor; before this fix a descent silently revoked it by stranding the corpse
    // 340u back. Restoring it is the point, but it does mean a ghost parked at an
    // overworld graveyard keeps loot rights on kills near each new floor's entry.
    //
    // Asserted on lootRecipientIds, NOT on xp: RIFT_MIN_LEVEL equals MAX_LEVEL (both
    // 20), so every rift participant is at the cap by construction and the xp half of
    // that credit is always zero inside a rift. Loot and Mark rights are what the arm
    // actually decides here.
    const { sim, leader, victim, run } = enterAsParty();
    const body = kill(sim, victim);
    sim.releaseSpirit(victim);
    openDescent(sim, run);
    descendRift(sim.ctx, leader);
    expect(isRiftPos(body.pos.x), 'the ghost itself is out in the overworld').toBe(false);

    const corpse = body.corpsePos!;
    const mob = run.mobIds.map((id) => sim.entities.get(id)).find((m) => m && !m.dead)!;
    mob.pos = { x: corpse.x + 5, y: corpse.y, z: corpse.z };
    expect(dist2d(mob.pos, corpse)).toBeLessThanOrEqual(PARTY_XP_RANGE);

    const leaderEntity = sim.entities.get(leader)!;
    sim.dealDamage(leaderEntity, mob, 999999, false, 'physical', 'Strike', 'hit', true);
    expect(mob.dead, 'the mob died to the living member').toBe(true);
    expect(
      mob.lootRecipientIds,
      'the ghost is a kill-time loot recipient through their moved corpse',
    ).toContain(victim);
  });

  it('leaves a corpse OUTSIDE the torn-down floor alone', () => {
    const { sim, leader, victim, run } = enterAsParty();
    // A corpse from an earlier overworld death: it belongs to no rift floor, so the
    // descent must not drag it into the rift band. Pins the region test itself, not
    // just "some corpse moved".
    const body = sim.entities.get(victim)!;
    const overworldCorpse = { x: 12, y: 0, z: -34 };
    body.dead = true;
    body.ghost = true;
    body.corpsePos = { ...overworldCorpse };

    openDescent(sim, run);
    descendRift(sim.ctx, leader);

    expect(run.floorIndex).toBe(1);
    expect(body.corpsePos, 'an off-floor corpse is untouched').toEqual(overworldCorpse);
  });
});
