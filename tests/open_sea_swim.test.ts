import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import {
  isSwimming,
  SWIM_BUOYANCY_RISE,
  SWIM_MAX_PLUNGE,
  swimSurfaceY,
} from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { MoveInput, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import {
  isInWaterBody,
  isOpenSeaAt,
  terrainHeight,
  WATER_LEVEL,
  waterLevelAt,
} from '../src/sim/world';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The seas are real water now. The renderer has always painted every zone
// strip and the horizon apron at the waterline, but waterLevelAt() used to be
// -Infinity outside declared lake footprints, so the visible ocean was
// sim-dry: players walked the seabed under the surface, wedged on bed slopes,
// and the mounted water-wall never fired. waterLevelAt(x, z, seed) now
// recognizes everywhere the GENERATOR carved ground below the waterline
// (isOpenSeaAt), while an author's sculpted sunken stamp stays dry (#1518:
// the predicate reads terrainHeightSansEdits). On top of that, entering deep
// water is a real transition: a submerged body BUOYS to the surface at
// SWIM_BUOYANCY_RISE instead of teleporting, and a dive plunges briefly
// (bounded by SWIM_MAX_PLUNGE) before floating back up.

const SEED = 20061; // the production seed: coast geometry is seed-pinned

afterEach(() => setActiveWorldContent(null));

// A dry beach spot next to genuinely deep GENERATOR sea (outside every
// declared footprint), with a clear straight walk-in. Scanned, not
// hard-coded, so coastline reshaping never silently invalidates the suite.
function findBeachEntry(): { x: number; z: number; facing: number } {
  for (let z = -240; z <= 160; z += 6) {
    for (let x = -640; x <= 640; x += 6) {
      const g = terrainHeight(x, z, SEED);
      if (g < WATER_LEVEL + 0.15 || g > WATER_LEVEL + 0.9) continue;
      if (isBlocked(SEED, x, z, 1)) continue;
      for (const { dx, dz, facing } of [
        { dx: 1, dz: 0, facing: Math.PI / 2 },
        { dx: -1, dz: 0, facing: -Math.PI / 2 },
        { dx: 0, dz: 1, facing: 0 },
        { dx: 0, dz: -1, facing: Math.PI },
      ]) {
        const wx = x + dx * 12;
        const wz = z + dz * 12;
        if (isInWaterBody(wx, wz)) continue; // must exercise the SEA arm
        if (terrainHeight(wx, wz, SEED) >= WATER_LEVEL - PLAYER_SWIM_DEPTH - 0.6) continue;
        let clear = true;
        for (let d = 2; d <= 12; d += 2) {
          const px = x + dx * d;
          const pz = z + dz * d;
          if (
            isBlocked(SEED, px, pz, 1) ||
            terrainHeight(px, pz, SEED) >
              terrainHeight(x + dx * (d - 2), z + dz * (d - 2), SEED) + 0.5
          ) {
            clear = false;
            break;
          }
        }
        if (clear) return { x, z, facing };
      }
    }
  }
  throw new Error('no beach-to-deep-sea entry found on the southern coasts');
}

function makeSim(world?: WorldContent): Sim {
  if (world) setActiveWorldContent(world);
  const sim = new Sim(
    world
      ? { seed: SEED, playerClass: 'warrior', autoEquip: true, world }
      : { seed: SEED, playerClass: 'warrior', autoEquip: true },
  );
  sim.setPlayerLevel(60);
  return sim;
}

function teleport(sim: Sim, x: number, z: number, y: number, facing = 0): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = y;
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = facing;
  p.onGround = true;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
}

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  // The swim branch made the vertical stick part of the frame: neither is set
  // on a land or surface-swim frame, but both are declared, so a hand-built
  // MoveInput states them explicitly like every other suite does.
  dive: false,
  surface: false,
  ...over,
});

function hold(sim: Sim, input: MoveInput, ticks: number, onTick?: () => void): void {
  const meta = expectDefined(
    (sim as unknown as { players: Map<number, { moveInput: MoveInput }> }).players.get(
      (sim as unknown as { playerId: number }).playerId,
    ),
  );
  for (let i = 0; i < ticks; i++) {
    Object.assign(meta.moveInput, input);
    sim.tick();
    onTick?.();
  }
}

describe('the open sea is real water', () => {
  it('generator-carved sea outside every footprint carries the waterline', () => {
    const entry = findBeachEntry();
    // the beach itself is dry
    expect(waterLevelAt(entry.x, entry.z, SEED)).toBe(-Infinity);
    // walk the scan direction far enough to be over the carved sea
    const wx = entry.x + Math.sin(entry.facing) * 12;
    const wz = entry.z + Math.cos(entry.facing) * 12;
    expect(isInWaterBody(wx, wz)).toBe(false);
    expect(isOpenSeaAt(wx, wz, SEED)).toBe(true);
    expect(waterLevelAt(wx, wz, SEED)).toBe(WATER_LEVEL);
  });

  it('a sculpted sunken stamp outside every footprint stays dry (#1518)', () => {
    const spot = { x: 30, z: 40 }; // open vale ground, well above the waterline
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      terrainEdits: [{ x: spot.x, z: spot.z, radius: 6, delta: -25, falloff: 'flat', mode: 'add' }],
    });
    expect(terrainHeight(spot.x, spot.z, SEED)).toBeLessThan(WATER_LEVEL - PLAYER_SWIM_DEPTH);
    expect(isOpenSeaAt(spot.x, spot.z, SEED)).toBe(false);
    expect(waterLevelAt(spot.x, spot.z, SEED)).toBe(-Infinity);
  });

  it('instanced interiors never read as sea', () => {
    // instance space: far past the overworld's east edge
    expect(isOpenSeaAt(5000, 0, SEED)).toBe(false);
    expect(waterLevelAt(5000, 0, SEED)).toBe(-Infinity);
  });

  it('walking off the beach transitions to a surface swim, no teleport, and back out', () => {
    const entry = findBeachEntry();
    const sim = makeSim(EMPTY_TEST_WORLD);
    teleport(sim, entry.x, entry.z, terrainHeight(entry.x, entry.z, SEED), entry.facing);
    const p = sim.player;
    let maxRise = 0;
    let prevY = p.pos.y;
    hold(sim, mi({ forward: true }), 20 * 8, () => {
      maxRise = Math.max(maxRise, p.pos.y - prevY);
      prevY = p.pos.y;
    });
    // out over the deep sea, treading at the swim surface
    expect(isSwimming(p, SEED)).toBe(true);
    expect(p.pos.y).toBeCloseTo(swimSurfaceY(p.pos.x, p.pos.z, SEED), 5);
    // buoyancy, never the old bed-to-surface teleport: no single tick may rise
    // faster than the buoyancy rate (plus the tiny step-up allowance)
    expect(maxRise).toBeLessThanOrEqual(SWIM_BUOYANCY_RISE * DT + 1e-6);
    // and the shore releases the swimmer: walk straight back the way we came
    const back = mi({ forward: true });
    p.facing = entry.facing + Math.PI;
    hold(sim, back, 20 * 12);
    expect(isSwimming(p, SEED)).toBe(false);
    expect(p.pos.y).toBeGreaterThan(WATER_LEVEL - PLAYER_SWIM_DEPTH);
  });

  it('a body dropped over deep sea splashes, plunges no deeper than the cap, and floats up', () => {
    const entry = findBeachEntry();
    const wx = entry.x + Math.sin(entry.facing) * 12;
    const wz = entry.z + Math.cos(entry.facing) * 12;
    const surface = swimSurfaceY(wx, wz, SEED);
    const sim = makeSim(EMPTY_TEST_WORLD);
    const p = sim.player;
    teleport(sim, wx, wz, surface + 8);
    p.onGround = false; // free fall from 8yd above the surface
    const hpBefore = p.hp;
    let minY = Infinity;
    hold(sim, mi(), 20 * 4, () => {
      minY = Math.min(minY, p.pos.y);
    });
    expect(minY).toBeGreaterThanOrEqual(surface - SWIM_MAX_PLUNGE - 1e-6);
    expect(minY).toBeLessThan(surface - 0.2); // it actually dove under
    expect(p.pos.y).toBeCloseTo(surface, 5); // and buoyed back to the surface
    expect(p.hp).toBe(hpBefore); // water always breaks the fall
  });

  it('a body starting on the seabed rises to the surface instead of walking it', () => {
    const entry = findBeachEntry();
    const wx = entry.x + Math.sin(entry.facing) * 12;
    const wz = entry.z + Math.cos(entry.facing) * 12;
    const bed = terrainHeight(wx, wz, SEED);
    const surface = swimSurfaceY(wx, wz, SEED);
    const sim = makeSim(EMPTY_TEST_WORLD);
    const p = sim.player;
    teleport(sim, wx, wz, bed);
    let lastY = p.pos.y;
    hold(sim, mi(), 20 * 3, () => {
      expect(p.pos.y).toBeGreaterThanOrEqual(lastY - 1e-9); // monotonic rise
      lastY = p.pos.y;
    });
    expect(p.pos.y).toBeCloseTo(surface, 5);
  });
});
