import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { Sim } from '../src/sim/sim';
import type { Entity, Vec3 } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// Pets heel by pathfinding around obstacles (like a warrior charge route) rather
// than greedily wedging on a wall and then snapping to the owner. These tests pin
// that behavior: routing around a static collider, determinism, no mid-play
// teleport, and the last-resort warp only when the owner is truly unreachable.

const SEED = 42;

function place(e: Entity, x: number, z: number): void {
  e.pos = { x, y: terrainHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}

// Adopt an existing wild mob as a passive heel-only pet, then position the pet
// and its owner explicitly. Passive mode guarantees the pet never picks a combat
// target, so it stays in the heel branch under test.
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

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('pet heel pathfinding', () => {
  // The spawn building straddles z=3..12 at x≈0; a straight line from (0,-3) to
  // (0,8) is blocked, so the pet must route around it.
  const PET = { x: 0, y: 0, z: -3 };
  const OWNER = { x: 0, y: 0, z: 8 };

  it('routes around a static obstacle to reach the owner without passing through it', () => {
    const { sim, pet, owner } = setup(PET, OWNER);
    let maxStep = 0;
    let everBlocked = false;
    for (let i = 0; i < 20 * 8; i++) {
      const before = { ...pet.pos };
      sim.tick();
      maxStep = Math.max(maxStep, dist(before, pet.pos));
      if (isBlocked(SEED, pet.pos.x, pet.pos.z, 0.5)) everBlocked = true;
    }
    // converged onto the owner
    expect(dist(pet.pos, owner.pos)).toBeLessThan(4);
    // never tunneled through the collider
    expect(everBlocked).toBe(false);
    // moved smoothly the whole way — no teleport snap (a warp would be many yards)
    expect(maxStep).toBeLessThan(1.5);
  });

  it('is deterministic — identical seed yields an identical heel path', () => {
    const trace = () => {
      const { sim, pet } = setup(PET, OWNER);
      const path: Vec3[] = [];
      for (let i = 0; i < 20 * 6; i++) {
        sim.tick();
        path.push({ ...pet.pos });
      }
      return path;
    };
    expect(trace()).toEqual(trace());
  });

  it('does not teleport while following a distant owner over open ground', () => {
    // 50yd away with a clear line of sight: the pet should run, never snap.
    const { sim, pet, owner } = setup({ x: 200, y: 0, z: 200 }, { x: 200, y: 0, z: 250 });
    let maxStep = 0;
    for (let i = 0; i < 20 * 12; i++) {
      const before = { ...pet.pos };
      sim.tick();
      maxStep = Math.max(maxStep, dist(before, pet.pos));
    }
    expect(maxStep).toBeLessThan(1.5);
    expect(dist(pet.pos, owner.pos)).toBeLessThan(4);
  });

  it('does not snap on a stale unreachable path when a route actually exists', () => {
    // Regression: the teleport must be confirmed by a FRESH A* attempt, not by a
    // leftover single-waypoint cache. Owner is 62yd away on the far side of the
    // spawn building (straight line blocked, real route around exists), and the
    // pet carries a stale "no route" cache with the throttle still active: it
    // must path, never warp. (This used to stage across the west rim mountains,
    // which are now correctly unclimbable, so the route there no longer exists.)
    const { sim, pet, owner } = setup({ x: 0, y: 0, z: -25 }, { x: 0, y: 0, z: 37 });
    expect(dist(pet.pos, owner.pos)).toBeGreaterThan(60);
    pet.petPath = [{ ...owner.pos }]; // stale single-waypoint (looks "unreachable")
    pet.petPathCooldown = 0.4; // throttle active: would skip recompute without the fresh-attempt guard
    const before = { ...pet.pos };
    sim.tick();
    // moved by a normal step, not snapped to the owner
    expect(dist(before, pet.pos)).toBeLessThan(1.5);
    expect(dist(pet.pos, owner.pos)).toBeGreaterThan(30);
  });

  it('warps to the owner only as a last resort when no route exists', () => {
    // 87yd apart with the spawn building breaking line of sight and the gap beyond
    // the A* search window: no route can be found, so the pet snaps to heel.
    const { sim, pet, owner } = setup({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 82 });
    expect(dist(pet.pos, owner.pos)).toBeGreaterThan(60);
    sim.tick();
    expect(dist(pet.pos, owner.pos)).toBeLessThan(1);
  });

  it('bounds far-pet recovery instead of tracing line of sight across the world', () => {
    // Production regression (#1833): a pet stranded extremely far from its owner
    // took the last-resort branch every tick. The pathfinder returned its bounded
    // straight-line fallback, then lineOfSightClear sampled the ENTIRE separation
    // every 0.5yd. Clear off-map ground keeps this reproducer independent of props:
    // the old behavior scans 1,000 points and advances one ordinary movement step.
    // A separation beyond the bounded recovery window must snap the pet home.
    const { sim, pet, owner } = setup(
      { x: -10_000, y: 0, z: -10_000 },
      { x: -10_000, y: 0, z: -9_500 },
    );
    expect(dist(pet.pos, owner.pos)).toBe(500);
    sim.tick();
    expect(dist(pet.pos, owner.pos)).toBeLessThan(1);
  });

  it('keeps ordinary follow below the forced recovery boundary', () => {
    const below = setup({ x: -10_000, y: 0, z: -10_000 }, { x: -10_000, y: 0, z: -9_904 });
    below.sim.tick();
    expect(dist(below.pet.pos, below.owner.pos)).toBeGreaterThan(95);

    const above = setup({ x: -10_000, y: 0, z: -10_000 }, { x: -10_000, y: 0, z: -9_903 });
    above.sim.tick();
    expect(dist(above.pet.pos, above.owner.pos)).toBeLessThan(1);
  });
});
