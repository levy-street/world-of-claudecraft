// Trailbreak on real terrain: the backward leap has to cover its 12 yards when
// the ground RISES behind the hunter (a walkable hillside used to catch the
// flat hop arc after two or three yards), while an unclimbable face or a wall
// at the hunter's back still ends the leap at its foot instead of beaching the
// body partway up it. Both spots are pinned on the shipped world seed and each
// test re-asserts the terrain shape it relies on, so a heightfield change fails
// here with a readable reason rather than a silent distance miss.

import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight, terrainSteepnessAt, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { EMPTY_TEST_WORLD } from './sim_shared';

const TRAILBREAK_DISTANCE = 12;
const SAMPLE_STEP = 0.5;

/** A hunter standing at (x, z) on the world terrain, facing AWAY from `backDir`
 *  (facing f points along (sin f, cos f); the leap travels along (-sin f, -cos f)). */
function hunterAt(sim: Sim, x: number, z: number, backDir: number): Entity {
  const p = sim.player;
  p.pos = { x, y: groundHeight(x, z, WORLD_SEED), z };
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = backDir - Math.PI;
  p.onGround = true;
  p.jumping = false;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.gcdRemaining = 0;
  p.cooldowns.delete('trailbreak');
  return p;
}

function worldHunter(): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'hunter', autoEquip: true });
  sim.setPlayerLevel(20);
  return sim;
}

/** Ground profile behind the start, one sample per half yard, as rises over the start. */
function riseProfile(x: number, z: number, backDir: number, yards: number): number[] {
  const g0 = groundHeight(x, z, WORLD_SEED);
  const out: number[] = [];
  for (let d = SAMPLE_STEP; d <= yards + 1e-9; d += SAMPLE_STEP) {
    out.push(groundHeight(x + Math.sin(backDir) * d, z + Math.cos(backDir) * d, WORLD_SEED) - g0);
  }
  return out;
}

function propFreeLine(x: number, z: number, backDir: number, yards: number): boolean {
  for (let d = 0; d <= yards + 1e-9; d += SAMPLE_STEP) {
    const px = x + Math.sin(backDir) * d;
    const pz = z + Math.cos(backDir) * d;
    if (groundHeight(px, pz, WORLD_SEED) < waterLevelAt(px, pz, WORLD_SEED)) return false;
    const r = resolvePosition(WORLD_SEED, px, pz, 0.5);
    if (Math.hypot(r.x - px, r.z - pz) > 0.05) return false;
  }
  return true;
}

function flyUntilLanded(sim: Sim, p: Entity): number {
  let ticks = 0;
  do {
    sim.tick();
    ticks++;
  } while (!p.onGround && ticks < 60);
  return ticks;
}

describe('Trailbreak over real terrain', () => {
  it('covers its full distance up a walkable rising hillside', () => {
    const x = -589;
    const z = -518;
    const backDir = 2.7489;
    // The spot: a prop-free, dry, monotone rise of about 5 yards over the leap,
    // every half-yard step well inside the walkable slope limit.
    const profile = riseProfile(x, z, backDir, TRAILBREAK_DISTANCE);
    expect(propFreeLine(x, z, backDir, TRAILBREAK_DISTANCE)).toBe(true);
    expect(profile[profile.length - 1]).toBeGreaterThan(4);
    for (let i = 0; i < profile.length; i++) {
      const prev = i === 0 ? 0 : profile[i - 1];
      expect(profile[i]).toBeGreaterThanOrEqual(prev - 0.05);
      expect((profile[i] - prev) / SAMPLE_STEP).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE * 0.6);
    }

    const sim = worldHunter();
    const p = hunterAt(sim, x, z, backDir);
    const start = { ...p.pos };
    sim.castAbility('trailbreak');
    expect(p.onGround).toBe(false);
    const launchVy = p.vy;

    flyUntilLanded(sim, p);
    const travelled = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    expect(p.onGround).toBe(true);
    expect(travelled).toBeGreaterThan(TRAILBREAK_DISTANCE - 1);
    expect(travelled).toBeLessThan(TRAILBREAK_DISTANCE + 1);
    expect(launchVy).toBeGreaterThan(JUMP_VELOCITY);
    // Seated on the hillside where it landed, not floating or buried.
    expect(p.pos.y).toBeCloseTo(groundHeight(p.pos.x, p.pos.z, WORLD_SEED), 3);
    expect(p.pos.y - start.y).toBeGreaterThan(3);
  });

  it('lands safely against an unclimbable face: at its foot or up its ledge, never beyond it', () => {
    const x = -574;
    const z = -358;
    const backDir = 4.3197;
    // The spot: gentle for the first two yards, then a rise steeper than the
    // climb limit within three yards of the hunter's back.
    const profile = riseProfile(x, z, backDir, 4);
    expect(propFreeLine(x, z, backDir, 4)).toBe(true);
    expect(Math.abs(profile[0])).toBeLessThan(0.3);
    const unclimbableAt = profile.findIndex((rise, i) => {
      const prev = i === 0 ? 0 : profile[i - 1];
      const px = x + Math.sin(backDir) * (i + 1) * SAMPLE_STEP;
      const pz = z + Math.cos(backDir) * (i + 1) * SAMPLE_STEP;
      return (
        rise > prev &&
        ((rise - prev) / SAMPLE_STEP > PLAYER_MAX_CLIMB_SLOPE ||
          terrainSteepnessAt(px, pz, WORLD_SEED) > PLAYER_MAX_CLIMB_SLOPE)
      );
    });
    expect(unclimbableAt).toBeGreaterThanOrEqual(2);
    expect(unclimbableAt).toBeLessThanOrEqual(6);

    const sim = worldHunter();
    const p = hunterAt(sim, x, z, backDir);
    const start = { ...p.pos };
    const hp = p.hp;
    sim.castAbility('trailbreak');
    // The plan aims at the foot of the face: no soaring launch up it.
    expect(p.vy).toBeLessThan(JUMP_VELOCITY * 2);
    flyUntilLanded(sim, p);
    const travelled = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    const faceTop = Math.max(...profile);
    expect(p.onGround).toBe(true);
    // The body ends seated on terrain, unhurt, and never beyond the face: at
    // its foot, or on its top when the kernel's own ledge climb (the same
    // mantle any jump into a ledge gets) pulls it up from the landing.
    expect(travelled).toBeLessThanOrEqual((unclimbableAt + 1) * SAMPLE_STEP + 1);
    expect(p.pos.y - start.y).toBeLessThanOrEqual(faceTop + 0.1);
    // Seated on the slope (the kernel's slope glue may sit a millimetre off
    // the centre sample on a pitched surface).
    expect(p.pos.y).toBeCloseTo(groundHeight(p.pos.x, p.pos.z, WORLD_SEED), 2);
    expect(p.hp).toBe(hp);
  });

  it('keeps the old launch exactly where the ground behind does not rise', () => {
    const sim = new Sim({
      seed: 11,
      playerClass: 'hunter',
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(20);
    const p = sim.player;
    const seed = sim.cfg.seed;
    // The empty test world is not perfectly level: pick a backward direction
    // along which no sample sits above the start (level or falling ground),
    // the case the fix must leave byte-identical.
    const g0 = groundHeight(p.pos.x, p.pos.z, seed);
    let backDir: number | null = null;
    for (let k = 0; k < 16 && backDir === null; k++) {
      const dir = (k * Math.PI) / 8;
      let level = true;
      for (let d = SAMPLE_STEP; d <= TRAILBREAK_DISTANCE + 1e-9; d += SAMPLE_STEP) {
        const px = p.pos.x + Math.sin(dir) * d;
        const pz = p.pos.z + Math.cos(dir) * d;
        const r = resolvePosition(seed, px, pz, 0.5);
        if (groundHeight(px, pz, seed) > g0 || Math.hypot(r.x - px, r.z - pz) > 0.05) {
          level = false;
          break;
        }
      }
      if (level) backDir = dir;
    }
    expect(backDir).not.toBeNull();
    const facing = (backDir as number) - Math.PI;
    p.facing = facing;
    p.gcdRemaining = 0;
    sim.castAbility('trailbreak');
    const flightSeconds = (2 * JUMP_VELOCITY) / GRAVITY;
    const speed = TRAILBREAK_DISTANCE / flightSeconds;
    expect(p.vy).toBe(JUMP_VELOCITY);
    expect(p.vx).toBeCloseTo(-Math.sin(facing) * speed, 9);
    expect(p.vz).toBeCloseTo(-Math.cos(facing) * speed, 9);
    expect(p.jumping).toBe(true);
    expect(p.onGround).toBe(false);
  });
});
