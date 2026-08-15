import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, CAMPS } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { rideSteepnessAt } from '../src/sim/ride_height';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';
import { terrainDownhill, terrainHeight, terrainSteepness, WATER_LEVEL } from '../src/sim/world';

// Movement gates for unwalkable slopes (the report: players climbing the
// mountains and the world rim by strafing diagonally or spamming jump).
// Contract, mirroring classic MMO rules:
//  - an uphill step onto ground steeper than MAX_CLIMB_SLOPE is blocked no
//    matter the approach angle (a switchback cannot beat the limit),
//  - airborne movement cannot carry you into a face you could not walk up,
//  - you cannot jump while standing on unwalkably steep ground, and
//  - standing on such ground slides you downhill until footing is walkable.
// tests/terrain_walls.test.ts pins that the walls themselves are steep enough.

// Seed 42, not the production seed: the movement gates are seed-agnostic (any
// steep-enough wall exercises them) and the terrain contract at the production
// seed is pinned separately in tests/terrain_walls.test.ts.
const SEED = 42;
const CLIMB_LIMIT = 1.5;

// These gates are about TERRAIN (the seed-procedural rim walls and slopes), not
// entity content, and the walkers below tick a minute of world time each. Keep
// every terrain-relevant field (zones, roads, terrainEdits, biomePaint,
// waterLevel) identical to BUILTIN_WORLD and strip only the constructor-spawned
// ambient mobs/NPCs/objects; the approach scan below still proves the steep
// band and crest exist (it throws if they do not).
const CLIMB_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(): Sim {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    autoEquip: true,
    world: CLIMB_TEST_WORLD,
  });
  sim.setPlayerLevel(60); // rim mobs must not decide these tests
  return sim;
}

function teleport(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = true;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
}

// A z where the run-up to the west rim wall is dry, collider-free, and far from
// mob camps, plus where the wall's steep band begins and where its crest tops out.
let rimApproach: { z: number; xStart: number; xCrest: number } | null = null;
function findWestRimApproach(seed: number): { z: number; xStart: number; xCrest: number } {
  if (rimApproach) return rimApproach;
  rimApproach = scanWestRimApproach(seed);
  return rimApproach;
}

function scanWestRimApproach(seed: number): { z: number; xStart: number; xCrest: number } {
  outer: for (let z = -60; z <= 820; z += 7) {
    for (const camp of CAMPS) {
      if (Math.hypot(camp.center.x + 160, camp.center.z - z) < camp.radius + 80) continue outer;
    }
    let xSteep = Number.NaN;
    for (let x = -130; x >= -178; x -= 0.5) {
      if (terrainHeight(x, z, seed) < WATER_LEVEL + 0.5) continue outer;
      if (Number.isNaN(xSteep) && isBlocked(seed, x, z, 0.6)) continue outer;
      if (Number.isNaN(xSteep) && terrainSteepness(x, z, seed) > CLIMB_LIMIT + 0.2) {
        xSteep = x;
      }
    }
    if (Number.isNaN(xSteep)) continue;
    let xCrest = xSteep;
    let hCrest = -Infinity;
    for (let x = xSteep; x >= -184; x -= 0.5) {
      const h = terrainHeight(x, z, seed);
      if (h > hCrest) {
        hCrest = h;
        xCrest = x;
      }
    }
    return { z, xStart: xSteep + 6, xCrest };
  }
  throw new Error('no clean west-rim approach found for this seed');
}

// A steep on-wall footing reachable for the slide tests: the first point past
// the steep band start with real steepness.
function findSteepFooting(seed: number): { x: number; z: number } {
  const { z, xStart } = findWestRimApproach(seed);
  for (let x = xStart; x >= -184; x -= 0.25) {
    if (terrainSteepness(x, z, seed) > CLIMB_LIMIT + 0.4 && !isBlocked(seed, x, z, 0.6)) {
      return { x, z };
    }
  }
  throw new Error('no steep footing found');
}

const WEST = -Math.PI / 2; // facing f moves along (sin f, cos f); west = -x

describe('unwalkable slope movement gates', () => {
  // CLIMB_LIMIT is deliberately a literal (an independent pin, not a
  // self-comparison); this keeps it from silently desyncing from the source.
  it('the pinned climb limit matches the movement constant', () => {
    expect(PLAYER_MAX_CLIMB_SLOPE).toBe(CLIMB_LIMIT);
  });

  it('cannot climb the rim wall by strafing diagonally (switchback)', { timeout: 30000 }, () => {
    const sim = makeSim();
    const { z, xStart, xCrest } = findWestRimApproach(SEED);
    teleport(sim, xStart, z);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player meta');
    meta.moveInput.forward = true;
    for (let i = 0; i < 20 * 60; i++) {
      // hug the live gradient at ~65 degrees off uphill, alternating sides:
      // the classic switchback that beats a direction-only slope check
      const down = terrainDownhill(sim.player.pos.x, sim.player.pos.z, SEED);
      const uphill = down ? Math.atan2(-down.x, -down.z) : WEST;
      sim.player.facing = uphill + (Math.floor(i / 15) % 2 === 0 ? 1.15 : -1.15);
      sim.tick();
      expect(sim.player.pos.x, `tick ${i}: crossed the rim crest`).toBeGreaterThan(xCrest);
    }
  });

  it('cannot climb the rim wall by spamming jump into it', { timeout: 30000 }, () => {
    // What "cannot climb" means is a HEIGHT, not an x. This used to assert
    // pos.x > xCrest, which only holds while the rim is an unbroken rise all
    // the way to the map edge; since d5af0bfda ("every land border is walkable,
    // not just the pass roads") the margin past the crest is coast, and the
    // land west of it descends into open sea. A walker that correctly SLIDES
    // off the steep face and rounds the headland at sea level then passes the
    // crest's x about 19yd BELOW it, having climbed nothing: the old proxy read
    // that as a breach. Measure the climb itself instead, both ways it could
    // happen (walking up the face, or laddering it with a ledge grab).
    const sim = makeSim();
    const { z, xStart, xCrest } = findWestRimApproach(SEED);
    const hCrest = terrainHeight(xCrest, z, SEED);
    teleport(sim, xStart, z);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player meta');
    meta.moveInput.forward = true;
    meta.moveInput.jump = true;
    sim.player.facing = WEST;
    for (let i = 0; i < 20 * 60; i++) {
      sim.tick();
      expect(sim.player.pos.y, `tick ${i}: climbed to the rim crest height`).toBeLessThan(hCrest);
      expect(sim.player.climb, `tick ${i}: laddered the rim with a ledge climb`).toBeFalsy();
    }
  });

  it('slides downhill off unwalkably steep ground', () => {
    const sim = makeSim();
    const spot = findSteepFooting(SEED);
    teleport(sim, spot.x, spot.z);
    const startY = sim.player.pos.y;
    for (let i = 0; i < 20 * 20; i++) sim.tick();
    const p = sim.player.pos;
    expect(terrainSteepness(p.x, p.z, SEED)).toBeLessThanOrEqual(CLIMB_LIMIT);
    expect(p.y).toBeLessThan(startY);
  });

  it('cannot jump while standing on unwalkably steep ground', () => {
    const sim = makeSim();
    const spot = findSteepFooting(SEED);
    teleport(sim, spot.x, spot.z);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player meta');
    meta.moveInput.jump = true;
    // The kernel decides the jump from the state at the START of a tick
    // (player_motion.ts: STANDING there, with the RIDE-surface steepness
    // memo over the climb limit AND an actual downhill at the exact
    // position; rideSteepnessAt clamps submerged ground to the waterline so
    // a lake-bed dip never strips control from a wader), and the body also
    // moves within the tick. So the honest assertion is at the jump's
    // launch moment, with the kernel's own predicate: whenever vy flips
    // positive this tick, the PRE-tick state must not have been
    // standing-on-kernel-steep. An airborne launch is the coyote window (a
    // slide-off opens it by design, and the airborne contour gate still
    // refuses any face you could not walk up). The natural-relief terrain
    // is what makes the raw-steepness/post-tick shortcut misfire: a slide
    // can end in a shoreline dip whose raw memo reads steep while the
    // ridden surface is walkable.
    let prevVy = 0;
    for (let i = 0; i < 20 * 5; i++) {
      const p = sim.player;
      const preSteep =
        p.onGround &&
        rideSteepnessAt(p.pos.x, p.pos.z, SEED) > CLIMB_LIMIT &&
        terrainDownhill(p.pos.x, p.pos.z, SEED) !== null;
      sim.tick();
      if (prevVy <= 0 && p.vy > 0) {
        expect(preSteep, `tick ${i}: jumped off steep ground`).toBe(false);
      }
      prevVy = p.vy;
    }
  });

  it('still crosses the zone ridge through the road pass', () => {
    const sim = makeSim();
    teleport(sim, 0, 160);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player meta');
    meta.moveInput.forward = true;
    sim.player.facing = 0; // north, straight up the pass
    for (let i = 0; i < 20 * 30 && sim.player.pos.z < 210; i++) sim.tick();
    expect(sim.player.pos.z).toBeGreaterThan(210);
  });

  it('normal jumping on walkable ground still works', () => {
    const sim = makeSim();
    teleport(sim, 0, -40); // flat vale ground near the hub
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player meta');
    const startY = sim.player.pos.y;
    meta.moveInput.jump = true;
    sim.tick();
    meta.moveInput.jump = false;
    expect(sim.player.onGround).toBe(false);
    let apex = startY;
    for (let i = 0; i < 20 * 2 && !sim.player.onGround; i++) {
      sim.tick();
      apex = Math.max(apex, sim.player.pos.y);
    }
    expect(sim.player.onGround).toBe(true);
    expect(apex - startY).toBeGreaterThan(0.7);
  });
});
