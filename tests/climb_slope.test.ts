import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { CAMPS } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
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

function makeSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
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
    const sim = makeSim();
    const { z, xStart, xCrest } = findWestRimApproach(SEED);
    teleport(sim, xStart, z);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player meta');
    meta.moveInput.forward = true;
    meta.moveInput.jump = true;
    sim.player.facing = WEST;
    for (let i = 0; i < 20 * 60; i++) {
      sim.tick();
      expect(sim.player.pos.x, `tick ${i}: crossed the rim crest`).toBeGreaterThan(xCrest);
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
    for (let i = 0; i < 20 * 5; i++) {
      sim.tick();
      const p = sim.player;
      if (terrainSteepness(p.pos.x, p.pos.z, SEED) > CLIMB_LIMIT) {
        expect(p.vy, `tick ${i}: jumped off steep ground`).toBeLessThanOrEqual(0);
      }
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
