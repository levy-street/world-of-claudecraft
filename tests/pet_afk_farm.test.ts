import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Entity } from '../src/sim/types';

// Anti-AFK gate on aggressive pet auto-pull (hunter/warlock). An aggressive pet
// proactively pulls nearby hostiles only while the owner is actually playing; an
// idle owner's pet still DEFENDS (mob attacking owner/pet, or owner attacking a
// mob) but must not farm the area on its own. See petPickTarget + PET_OWNER_IDLE_TICKS.

const makeWorld = () => new Sim({ seed: 42, playerClass: 'hunter', noPlayer: true });

// Adopt a wild mob as the player's pet (mirrors a completed tame).
function givePet(sim: Sim, ownerPid: number): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null) {
      e.ownerId = ownerPid;
      e.hostile = false;
      e.hp = e.maxHp;
      return e;
    }
  }
  throw new Error('no wild mob available to adopt as a pet');
}

// A second, unowned, hostile wild mob to serve as the pull target.
function findWildHostile(sim: Sim, excludeId: number): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null && e.id !== excludeId) {
      e.hostile = true;
      return e;
    }
  }
  throw new Error('no second wild mob available');
}

function place(e: Entity, x: number, z: number): void {
  e.pos.x = x; e.pos.z = z;
  e.prevPos = { ...e.pos };
}

// Set up: aggressive pet next to the owner, a hostile mob 5yd from the pet that
// is NOT engaging anyone (so only the `aggressive` auto-pull branch can grab it).
function setup() {
  const sim = makeWorld();
  const pid = sim.addPlayer('hunter', 'Aleph');
  const owner = sim.entities.get(pid)!;
  const pet = givePet(sim, pid);
  sim.setPetMode('aggressive', pid);
  const target = findWildHostile(sim, pet.id);
  place(owner, 0, 0);
  place(pet, 1, 0);
  place(target, 6, 0); // 5yd from the pet, within PET_AGGRESSIVE_RANGE (18)
  target.aggroTargetId = null; // not engaging the owner or pet
  owner.targetId = null;
  owner.autoAttack = false;
  const meta = sim.meta(pid)!;
  const pick = (): Entity | null => (sim as any).petPickTarget(pet, owner);
  return { sim, pid, owner, pet, target, meta, pick };
}

describe('aggressive pet AFK-farm gate', () => {
  it('an ACTIVE owner\'s aggressive pet auto-pulls a nearby hostile', () => {
    const { sim, target, meta, pick } = setup();
    meta.lastActiveTick = sim.tickCount; // just acted
    expect(pick()?.id).toBe(target.id);
  });

  it('an IDLE owner\'s aggressive pet does NOT auto-pull a non-engaging hostile', () => {
    const { sim, meta, pick } = setup();
    meta.lastActiveTick = sim.tickCount - 100000; // long idle
    expect(pick()).toBeNull();
  });

  it('an IDLE owner\'s pet STILL defends when a mob engages the owner', () => {
    const { sim, owner, target, meta, pick } = setup();
    meta.lastActiveTick = sim.tickCount - 100000; // long idle
    target.aggroTargetId = owner.id; // the mob attacks the owner
    expect(pick()?.id).toBe(target.id);
  });
});

// Pin the stamping half end-to-end: drive the REAL movement / cast / auto-attack
// paths (not lastActiveTick set by hand) so a future tweak to those stamps can't
// silently regress the gate. Owner is parked far from the target so the mob's
// players-only proximity aggro never fires on the owner during a live tick.
describe('aggressive pet AFK-farm gate: activity stamping (end-to-end)', () => {
  function setupE2E() {
    const sim = makeWorld();
    const pid = sim.addPlayer('hunter', 'Brann');
    const owner = sim.entities.get(pid)!;
    const pet = givePet(sim, pid);
    sim.setPetMode('aggressive', pid);
    const target = findWildHostile(sim, pet.id);
    place(owner, 0, 0);
    place(pet, 28, 0);   // within leash of the owner
    place(target, 33, 0); // 5yd from the pet, 33yd from the owner (no proximity aggro)
    target.aggroTargetId = null;
    owner.targetId = null;
    owner.autoAttack = false;
    const meta = sim.meta(pid)!;
    meta.lastActiveTick = sim.tickCount - 100000; // start idle (gate closed)
    return { sim, pid, owner, pet, target, meta };
  }

  const isFresh = (sim: Sim, meta: { lastActiveTick: number }) =>
    sim.tickCount - meta.lastActiveTick <= 1;

  it('a real movement tick stamps activity and re-opens the gate', () => {
    const { sim, owner, pet, target, meta } = setupE2E();
    expect((sim as any).petPickTarget(pet, owner)).toBeNull(); // idle: no pull
    meta.moveInput.forward = true; // hold a movement key
    sim.tick();                    // updatePlayerMovement runs for real and stamps
    meta.moveInput.forward = false;
    expect(isFresh(sim, meta)).toBe(true);
    place(owner, 0, 0); place(pet, 28, 0); place(target, 33, 0); // undo a tick of drift
    expect((sim as any).petPickTarget(pet, owner)?.id).toBe(target.id);
  });

  it('a real ability cast stamps activity', () => {
    const { sim, pid, meta } = setupE2E();
    expect(isFresh(sim, meta)).toBe(false);
    sim.castAbility('raptor_strike', pid); // resolves (known at level 1), stamps
    expect(isFresh(sim, meta)).toBe(true);
  });

  it('starting auto-attack stamps activity', () => {
    const { sim, pid, owner, target, meta } = setupE2E();
    expect(isFresh(sim, meta)).toBe(false);
    owner.targetId = target.id;
    sim.startAutoAttack(pid);
    expect(isFresh(sim, meta)).toBe(true);
  });
});
