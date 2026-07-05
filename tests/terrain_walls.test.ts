import { describe, expect, it } from 'vitest';
import { CAMPS, NPCS, ROADS, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z, ZONES } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { terrainSteepness } from '../src/sim/world';

// The mountain walls of the world (the inter-zone ridges and the outer rim) are
// meant to be impassable: every crossing outside the road pass must somewhere be
// steeper than the movement climb limit (MAX_CLIMB_SLOPE = 1.5 rise/run) so the
// slope gates in sim.ts actually stop the player. This file pins that terrain
// contract; tests/climb_slope.test.ts pins the movement gates themselves.

const WORLD_SEED = 20061; // the fixed production seed (src/main.ts, server/game.ts)
const CLIMB_LIMIT = 1.5;
const WALL_MARGIN = 1.7; // walls must beat the limit with headroom, not by a hair
const PASS_HALF_WIDTH = 10;

// Max steepness met along a straight crossing path.
function pathMaxSteepness(
  seed: number,
  from: { x: number; z: number },
  to: { x: number; z: number },
): number {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.5);
  let max = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = terrainSteepness(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t, seed);
    if (s > max) max = s;
  }
  return max;
}

const RIDGE_ZS = ZONES.slice(0, -1).map((zone) => zone.zMax);

describe('impassable terrain walls', () => {
  // CLIMB_LIMIT is deliberately a literal (an independent pin, not a
  // self-comparison); this keeps it from silently desyncing from the source.
  it('the pinned climb limit matches the movement constant', () => {
    expect(PLAYER_MAX_CLIMB_SLOPE).toBe(CLIMB_LIMIT);
  });

  it('every non-pass crossing of each zone ridge is steeper than the climb limit', () => {
    for (const rz of RIDGE_ZS) {
      for (let x = -172; x <= 172; x += 4) {
        if (Math.abs(x) < PASS_HALF_WIDTH + 26) continue; // the road pass corridor
        const max = pathMaxSteepness(WORLD_SEED, { x, z: rz - 50 }, { x, z: rz + 50 });
        expect(max, `ridge z=${rz} crossing at x=${x}`).toBeGreaterThan(WALL_MARGIN);
      }
    }
  });

  it('the pass shoulder band is already a real wall', () => {
    // The wall ramps from the flat pass opening (|x| < 10) to full height by
    // |x| = 34 (PASS_SHOULDER in src/sim/world.ts). The crossable zone must
    // stay contiguous with the road pass: by |x| = 16 every crossing already
    // beats the margin, so a terrain tweak cannot quietly widen the gap into
    // a cross-beside-the-pass hole.
    for (const rz of RIDGE_ZS) {
      for (let x = 16; x <= 34; x += 2) {
        for (const side of [-1, 1]) {
          const max = pathMaxSteepness(
            WORLD_SEED,
            { x: side * x, z: rz - 50 },
            { x: side * x, z: rz + 50 },
          );
          expect(max, `ridge z=${rz} shoulder at x=${side * x}`).toBeGreaterThan(WALL_MARGIN);
        }
      }
    }
  });

  it('every crossing of the world rim is steeper than the climb limit', () => {
    for (let z = WORLD_MIN_Z + 40; z <= WORLD_MAX_Z - 40; z += 4) {
      for (const side of [-1, 1]) {
        const max = pathMaxSteepness(
          WORLD_SEED,
          { x: side * (WORLD_MAX_X - 36), z },
          { x: side * (WORLD_MAX_X + 4), z },
        );
        expect(max, `x-rim side=${side} at z=${z}`).toBeGreaterThan(WALL_MARGIN);
      }
    }
    for (let x = -144; x <= 144; x += 4) {
      const south = pathMaxSteepness(
        WORLD_SEED,
        { x, z: WORLD_MIN_Z + 36 },
        { x, z: WORLD_MIN_Z - 4 },
      );
      expect(south, `south rim at x=${x}`).toBeGreaterThan(WALL_MARGIN);
      const north = pathMaxSteepness(
        WORLD_SEED,
        { x, z: WORLD_MAX_Z - 36 },
        { x, z: WORLD_MAX_Z + 4 },
      );
      expect(north, `north rim at x=${x}`).toBeGreaterThan(WALL_MARGIN);
    }
  });

  it('the road pass through each ridge stays gently walkable', () => {
    for (const rz of RIDGE_ZS) {
      for (let x = -8; x <= 8; x += 2) {
        const max = pathMaxSteepness(WORLD_SEED, { x, z: rz - 50 }, { x, z: rz + 50 });
        expect(max, `pass across ridge z=${rz} at x=${x}`).toBeLessThan(1.0);
      }
    }
  });

  it('camps, npcs, hubs, and road vertices all sit on walkable ground', () => {
    for (const camp of CAMPS) {
      expect(
        terrainSteepness(camp.center.x, camp.center.z, WORLD_SEED),
        `camp at (${camp.center.x},${camp.center.z})`,
      ).toBeLessThanOrEqual(CLIMB_LIMIT);
    }
    for (const [id, npc] of Object.entries(NPCS)) {
      const pos = (npc as { pos?: { x: number; z: number } }).pos;
      if (!pos) continue;
      expect(
        terrainSteepness(pos.x, pos.z, WORLD_SEED),
        `npc ${id} at (${pos.x},${pos.z})`,
      ).toBeLessThanOrEqual(CLIMB_LIMIT);
    }
    for (const zone of ZONES) {
      expect(
        terrainSteepness(zone.hub.x, zone.hub.z, WORLD_SEED),
        `hub of ${zone.name}`,
      ).toBeLessThanOrEqual(CLIMB_LIMIT);
    }
    for (const road of ROADS) {
      for (const p of road) {
        expect(
          terrainSteepness(p.x, p.z, WORLD_SEED),
          `road vertex (${p.x},${p.z})`,
        ).toBeLessThanOrEqual(CLIMB_LIMIT);
      }
    }
  });
});
