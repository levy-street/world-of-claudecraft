import { describe, expect, it } from 'vitest';
import { petFollow, petPickTarget, petRangedAttack, updatePet } from '../src/sim/pet/pet_ai';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity } from '../src/sim/types';

// Direct unit tests for the extracted pet-AI module (P1a). They drive the moved
// functions through the real Sim.ctx seam (so the still-on-Sim helpers they reach
// back for resolve), pinning the slice's behavior independent of the parity golden.

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function world(): { sim: AnySim; pid: number; owner: AnyEntity } {
  const sim = new Sim({ seed: 7, playerClass: 'hunter', noPlayer: true }) as AnySim;
  const pid = sim.addPlayer('hunter', 'Owner');
  const owner = sim.entities.get(pid) as AnyEntity;
  return { sim, pid, owner };
}

// Adopt the first wild mob as the player's pet (mirrors a completed tame/summon).
function adopt(sim: AnySim, pid: number, exclude: number[] = []): AnyEntity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null && !exclude.includes(e.id)) {
      e.ownerId = pid;
      e.hostile = false;
      e.hp = e.maxHp;
      return e as AnyEntity;
    }
  }
  throw new Error('no wild mob to adopt');
}

function wildHostile(sim: AnySim, exclude: number[]): AnyEntity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null && !exclude.includes(e.id)) {
      e.hostile = true;
      return e as AnyEntity;
    }
  }
  throw new Error('no wild hostile');
}

function place(e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
}

// Banish every entity except the named ones far off the map so a target scan only
// sees what the test set up (the ctor seeds wild mobs around the player).
function isolate(sim: AnySim, keep: number[]): void {
  for (const e of sim.entities.values()) {
    if (!keep.includes(e.id)) place(e as AnyEntity, 5000, 5000);
  }
}

describe('pet_ai module (P1a) — direct unit tests', () => {
  it('updatePet despawns a pet whose owner is no longer a tracked player', () => {
    const { sim, pid } = world();
    const pet = adopt(sim, pid);
    expect(sim.entities.has(pet.id)).toBe(true);
    sim.players.delete(pid); // owner entity remains but is no longer a player
    updatePet(sim.ctx, pet);
    expect(sim.entities.has(pet.id)).toBe(false); // despawnPersistentPet -> dropEntity
  });

  it('updatePet heels a targetless pet toward its owner (the petFollow arm)', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'passive'; // petPickTarget returns null -> the heel arm runs
    pet.aggroTargetId = null;
    isolate(sim, [pid, pet.id]);
    place(owner, 0, 0);
    place(pet, owner.pos.x + 20, owner.pos.z);
    sim.rebucket(pet);
    const d0 = dist2d(pet.pos, owner.pos);
    updatePet(sim.ctx, pet);
    expect(pet.aggroTargetId).toBeNull();
    expect(dist2d(pet.pos, owner.pos)).toBeLessThan(d0); // stepped toward the owner
  });

  it('petPickTarget returns null for a passive pet', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'passive';
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('petPickTarget auto-pulls a nearby hostile for an ACTIVE owner, not an idle one', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'aggressive';
    const target = wildHostile(sim, [pet.id]);
    isolate(sim, [pid, pet.id, target.id]);
    place(owner, 0, 0);
    place(pet, 1, 0);
    place(target, 6, 0); // 5yd from the pet, within PET_AGGRESSIVE_RANGE (18)
    target.aggroTargetId = null; // not engaging the owner or pet
    owner.targetId = null;
    owner.autoAttack = false;
    const meta = sim.meta(pid)!;
    meta.lastActiveTick = sim.tickCount; // active: the aggressive auto-pull gate is open
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(target.id);
    meta.lastActiveTick = sim.tickCount - 100000; // idle: a non-engaging hostile is left alone
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('petRangedAttack hurls a fire-school bolt that deals AP-scaled damage', () => {
    const { sim, pid } = world();
    const pet = adopt(sim, pid);
    const target = wildHostile(sim, [pet.id]);
    target.maxHp = 50000;
    target.hp = 50000;
    petRangedAttack(sim.ctx, pet, target, { range: 25, school: 'fire' });
    const ev = sim.drainEvents() as Array<Record<string, any>>;
    expect(
      ev.some((e) => e.type === 'spellfx' && e.fx === 'projectile' && e.school === 'fire'),
    ).toBe(true);
    expect(
      ev.some((e) => e.type === 'damage' && e.sourceId === pet.id && e.school === 'fire'),
    ).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp); // the bolt never misses (crit-only roll)
  });

  it('petFollow clears the cached path once the pet is at heel distance', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    place(owner, 0, 0);
    place(pet, owner.pos.x + 1, owner.pos.z); // within PET_FOLLOW_DISTANCE (3.5)
    pet.petPath = [{ x: 9, y: 0, z: 9 }];
    petFollow(sim.ctx, pet, owner);
    expect(pet.petPath).toEqual([]);
  });
});
