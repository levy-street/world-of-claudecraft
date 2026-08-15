import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { ownerIsMounted, petPickTarget } from '../src/sim/pet/pet_ai';
import { completeTame, petOf } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import type { Entity, PetMode } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// Riding across a zone used to drag the pet into every fight on the way, and no
// stance avoided it: defensive correctly answers whatever is attacking its owner
// (which is exactly what you pull running through a camp), and even passive still
// body-pulled, because that scan never consulted the stance at all. A mounted owner
// is travelling, so the pet now just heels.

const SEED = 21;
type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function place(e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: terrainHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}

function world(mode: PetMode = 'defensive'): {
  sim: AnySim;
  hid: number;
  hunter: AnyEntity;
  pet: AnyEntity;
} {
  const sim = new Sim({ seed: SEED, playerClass: 'hunter', noPlayer: true }) as AnySim;
  const hid = sim.addPlayer('hunter', 'Rider') as number;
  sim.setPlayerLevel(20, hid);
  const hunter = sim.entities.get(hid) as AnyEntity;
  place(hunter, 300, 300); // open ground, away from the starting camps
  const beast = createMob(sim.nextId++, MOBS.forest_wolf, 2, {
    x: hunter.pos.x + 3,
    y: hunter.pos.y,
    z: hunter.pos.z,
  }) as AnyEntity;
  beast.hostile = true;
  sim.addEntity(beast);
  completeTame(sim.ctx, hunter, beast);
  const pet = petOf(sim.ctx, hid) as AnyEntity;
  pet.petMode = mode;
  place(pet, hunter.pos.x + 1, hunter.pos.z);
  return { sim, hid, hunter, pet };
}

/** A hostile mob already locked onto the hunter, i.e. what you pull running through. */
function chaser(sim: AnySim, hunter: AnyEntity): AnyEntity {
  const m = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: hunter.pos.x + 4,
    y: hunter.pos.y,
    z: hunter.pos.z + 1,
  }) as AnyEntity;
  m.hostile = true;
  m.aiState = 'chase';
  m.aggroTargetId = hunter.id;
  sim.addEntity(m);
  return m;
}

/** Give the rider a mount they actually own, or updateMountTransition dismounts them. */
function mount(sim: AnySim, hid: number, hunter: AnyEntity): void {
  sim.addItem('reins_valorsteed', 1, hid);
  hunter.mountKey = 'valorsteed';
}

/**
 * An idle mob parked beside a LAGGING pet and well outside MAX_AGGRO_RADIUS (20) of
 * the hunter, so the only thing that can aggro it is the pet's own body-pull. Placing
 * it near a heeling pet instead would sit inside the hunter's radius and the player
 * would pull it, which proves nothing about the pet.
 */
function strayNearPet(sim: AnySim, hunter: AnyEntity, pet: AnyEntity): AnyEntity {
  place(pet, hunter.pos.x, hunter.pos.z + 38);
  const m = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: pet.pos.x + 2,
    y: pet.pos.y,
    z: pet.pos.z,
  }) as AnyEntity;
  m.hostile = true;
  m.aiState = 'idle';
  m.aggroTargetId = null;
  m.spawnPos = { ...m.pos };
  sim.addEntity(m);
  return m;
}

describe('ownerIsMounted', () => {
  it('reads the mount slot, treating the empty string as dismounted', () => {
    expect(ownerIsMounted({ mountKey: 'valorsteed' } as Entity)).toBe(true);
    expect(ownerIsMounted({ mountKey: '' } as Entity)).toBe(false);
    expect(ownerIsMounted({} as Entity)).toBe(false);
  });
});

describe('a mounted owner leaves the pet heeling', () => {
  it('ignores a mob chasing the hunter, which defensive would otherwise answer', () => {
    const { sim, hid, hunter, pet } = world('defensive');
    const mob = chaser(sim, hunter);
    // Control: on foot, this is exactly the case a defensive pet engages.
    expect(petPickTarget(sim.ctx, pet, hunter)?.id).toBe(mob.id);
    mount(sim, hid, hunter);
    expect(petPickTarget(sim.ctx, pet, hunter)).toBeNull();
  });

  it('holds in aggressive stance too', () => {
    const { sim, hid, hunter, pet } = world('aggressive');
    const mob = chaser(sim, hunter);
    expect(petPickTarget(sim.ctx, pet, hunter)?.id).toBe(mob.id);
    mount(sim, hid, hunter);
    expect(petPickTarget(sim.ctx, pet, hunter)).toBeNull();
  });

  it('drops a target the pet already had when the owner mounts up', () => {
    const { sim, hid, hunter, pet } = world('defensive');
    const mob = chaser(sim, hunter);
    sim.tick();
    expect(pet.aggroTargetId).toBe(mob.id);
    mount(sim, hid, hunter);
    sim.tick();
    expect(pet.aggroTargetId).toBeNull();
    expect(pet.inCombat).toBe(false);
  });

  it('does not body-pull an idle mob the pet rides past', () => {
    // pullNearbyMobs never consulted the stance, so this is the half that passive
    // did NOT fix: a trailing pet aggroed camps onto itself regardless.
    const { sim, hid, hunter, pet } = world('passive');
    mount(sim, hid, hunter);
    const idle = strayNearPet(sim, hunter, pet);
    for (let i = 0; i < 4; i++) sim.tick();
    expect(idle.aggroTargetId).toBeNull();
    expect(idle.aiState).toBe('idle');
  });

  it('still body-pulls that same mob on foot, so the pull itself is intact', () => {
    const { sim, hunter, pet } = world('passive');
    const idle = strayNearPet(sim, hunter, pet);
    for (let i = 0; i < 4; i++) sim.tick();
    expect(idle.aggroTargetId).toBe(pet.id);
  });

  it('self-restores the moment the rider dismounts, with no toggling', () => {
    const { sim, hid, hunter, pet } = world('defensive');
    const mob = chaser(sim, hunter);
    mount(sim, hid, hunter);
    sim.tick();
    expect(pet.aggroTargetId).toBeNull();
    hunter.mountKey = ''; // what casting or swinging does via forceDismount
    sim.tick();
    expect(pet.aggroTargetId).toBe(mob.id);
  });
});
