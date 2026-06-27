import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type Vec3 } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// A controlled pet (hunter/warlock) whose owner teleports far away (e.g. into a
// dungeon/arena instance, whose origin sits thousands of yards off in world space)
// can be left stranded: the heel pathfinder cannot bridge that gap. The far-leash
// timer reunites the pet, warping it onto the owner after PET_FAR_LEASH_SECONDS
// spent beyond PET_FAR_LEASH_DISTANCE. These tests pin that behavior deterministically.

const SEED = 42;

function place(e: Entity, x: number, z: number): void {
  e.pos = { x, y: terrainHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}

// Root the pet so it cannot move under its own power. This isolates the far-leash
// timer from the heel locomotion: a rooted pet's petFollow returns early (so the
// 60yd last-resort heel warp can never fire), the distance to a stationary owner
// stays constant, and the ONLY thing that can teleport the pet is the far-leash.
function root(pet: Entity): void {
  pet.auras.push({
    id: 't_root',
    name: 'Test Root',
    kind: 'root',
    remaining: 1e6,
    duration: 1e6,
    value: 0,
    sourceId: pet.id,
    school: 'nature',
  });
}

// Adopt an existing wild mob as a passive heel-only pet (mirrors pet_follow.test.ts).
// Passive mode guarantees the pet never picks a combat target, so it stays in the
// heel branch and only the far-leash logic can move it across the map.
function setup(petAt: Vec3, ownerAt: Vec3): { sim: Sim; pet: Entity; owner: Entity } {
  const sim = new Sim({ seed: SEED, playerClass: 'hunter', noPlayer: true });
  const pid = sim.addPlayer('hunter', 'Aleph');
  const owner = sim.entities.get(pid)!;
  let pet: Entity | null = null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null) {
      pet = e;
      break;
    }
  }
  if (!pet) throw new Error('no wild mob to adopt');
  pet.ownerId = pid;
  pet.hostile = false;
  pet.hp = pet.maxHp;
  pet.petMode = 'passive';
  place(pet, petAt.x, petAt.z);
  place(owner, ownerAt.x, ownerAt.z);
  return { sim, pet, owner };
}

describe('pet far-leash reunite', () => {
  it('warps a stranded pet back to its owner after ~15s very far away', () => {
    // 200yd apart: well beyond every normal follow/leash range (max 60yd).
    const { sim, pet, owner } = setup({ x: 300, y: 0, z: 300 }, { x: 300, y: 0, z: 500 });
    root(pet);
    expect(dist2d(pet.pos, owner.pos)).toBeGreaterThan(90);

    let teleportTick = -1;
    for (let i = 1; i <= 20 * 16; i++) {
      sim.tick();
      if (teleportTick === -1 && dist2d(pet.pos, owner.pos) < 5) teleportTick = i;
    }

    // reunited onto the owner, with the timer reset
    expect(dist2d(pet.pos, owner.pos)).toBeLessThan(1);
    expect(pet.petFarTimer).toBe(0);
    // the warp is the 15s far-leash, not the instant 60yd heel last-resort (which a
    // rooted pet can never reach): it fires right around tick 300 (15s at 20Hz).
    expect(teleportTick).toBeGreaterThanOrEqual(290);
    expect(teleportTick).toBeLessThanOrEqual(310);
  });

  it('does not teleport while the pet is within range, and never accumulates the timer', () => {
    // 12yd apart: beyond the heel follow distance but well within the far-leash
    // range, so the pet just heels in normally and the timer stays pinned at 0.
    const { sim, pet, owner } = setup({ x: 300, y: 0, z: 300 }, { x: 300, y: 0, z: 312 });
    let maxStep = 0;
    for (let i = 0; i < 20 * 16; i++) {
      const before = { ...pet.pos };
      sim.tick();
      maxStep = Math.max(maxStep, dist2d(before, pet.pos));
      expect(pet.petFarTimer).toBe(0);
    }
    // converged onto the owner by walking, never snapped
    expect(dist2d(pet.pos, owner.pos)).toBeLessThan(4);
    expect(maxStep).toBeLessThan(1.5);
  });

  it('resets the timer if the pet returns to range before 15s elapse', () => {
    const { sim, pet, owner } = setup({ x: 300, y: 0, z: 300 }, { x: 300, y: 0, z: 500 });
    root(pet);
    // accumulate part of the way (10s) while far
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    expect(pet.petFarTimer).toBeGreaterThan(5);
    // bring the pet back within range: the very next tick must clear the timer
    place(pet, owner.pos.x, owner.pos.z - 3);
    sim.tick();
    expect(pet.petFarTimer).toBe(0);
  });

  it('reunites with an owner who teleported into a different instance/dungeon', () => {
    // The primary bug: the owner zones into an instance (a far-off origin in world
    // space) and gains a dungeonId; the stranded pet must be warped to the owner's
    // CURRENT location and inherit the instance. Uses a real summoned warlock imp
    // (a persistent demon pet) rather than an adopted overworld mob, so the
    // reunite isn't pre-empted by the overworld culling a stranded wild adoptee.
    const sim = new Sim({ seed: SEED, playerClass: 'warlock' });
    const owner = sim.player;
    sim.castAbility('summon_imp');
    for (let i = 0; i < 140; i++) sim.tick(); // resolve the ~5s summon cast
    let pet: Entity | null = null;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && e.ownerId === owner.id && !e.dead) pet = e;
    }
    if (!pet) throw new Error('imp was not summoned');

    // owner teleports thousands of yards away into a dungeon instance
    place(owner, 5000, 5000);
    owner.dungeonId = 'hollow_crypt';
    expect(dist2d(pet.pos, owner.pos)).toBeGreaterThan(1000);

    for (let i = 0; i < 20 * 16; i++) sim.tick();

    expect(dist2d(pet.pos, owner.pos)).toBeLessThan(1);
    expect(pet.dungeonId).toBe('hollow_crypt');
    expect(pet.petFarTimer).toBe(0);
  });

  it('is deterministic: identical seed yields an identical reunite', () => {
    const trace = (): { tick: number; pos: Vec3 } => {
      const { sim, pet, owner } = setup({ x: 300, y: 0, z: 300 }, { x: 300, y: 0, z: 500 });
      root(pet);
      let tick = -1;
      for (let i = 1; i <= 20 * 16; i++) {
        sim.tick();
        if (tick === -1 && dist2d(pet.pos, owner.pos) < 5) tick = i;
      }
      return { tick, pos: { ...pet.pos } };
    };
    expect(trace()).toEqual(trace());
  });
});
