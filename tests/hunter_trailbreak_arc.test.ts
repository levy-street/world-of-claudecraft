// The Trailbreak launch planner over synthetic ground. Each case hands the
// planner a hand-built heightfield and then integrates the launch EXACTLY the
// movement kernel does (horizontal step, then vy -= G DT, y += vy DT, land when
// the feet reach the floor), so the assertions are about where the kernel
// would put the body, not about the parabola on paper.

import { describe, expect, it } from 'vitest';
import { MANTLE_REACH } from '../src/sim/colliders';
import {
  planTrailbreakArc,
  type TrailbreakSweepDeps,
  trailbreakFlatTicks,
  trailbreakMaxTicks,
} from '../src/sim/combat/hunter_trailbreak_arc';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import { DT } from '../src/sim/types';

const DISTANCE = 12;
/** Facing so the leap runs along +x: facing points along (sin f, cos f) and the
 *  leap along (-sin f, -cos f), so f = -PI/2 gives (1, 0). */
const FACING = -Math.PI / 2;
const FROM = { x: 0, y: 0, z: 0 };

interface Ground {
  /** Terrain height at a backward travel of `d` yards. */
  terrain(d: number): number;
  /** Prop top height at `d` (undefined: no prop). */
  prop?(d: number): number | undefined;
  /** Distance at which a full-height wall stands (undefined: none). */
  wallAt?: number;
}

function deps(ground: Ground): TrailbreakSweepDeps {
  const terrainAt = (x: number) => ground.terrain(x);
  return {
    groundAt: (x) => terrainAt(x),
    steepnessAt: (x) => Math.abs(terrainAt(x + 0.05) - terrainAt(x - 0.05)) / 0.1,
    floorAt: (x, _z, maxY) => {
      const top = ground.prop?.(x);
      const terrain = terrainAt(x);
      return top !== undefined && top <= maxY ? Math.max(terrain, top) : terrain;
    },
    resolve: (fromX, fromZ, toX, toZ) =>
      ground.wallAt !== undefined && toX >= ground.wallAt
        ? { x: fromX, z: fromZ }
        : { x: toX, z: toZ },
  };
}

/** The kernel's integration of a launch, returning the landing pose and the
 *  lowest clearance the feet had over the floor while airborne. */
function fly(ground: Ground, launch: { vx: number; vz: number; vy: number }) {
  let x = FROM.x;
  let y = FROM.y;
  let vy = launch.vy;
  let minClearance = Number.POSITIVE_INFINITY;
  const floorAt = (px: number, feet: number) => {
    const top = ground.prop?.(px);
    const terrain = ground.terrain(px);
    return top !== undefined && top <= feet + MANTLE_REACH ? Math.max(terrain, top) : terrain;
  };
  for (let tick = 1; tick <= 200; tick++) {
    const nx = x + launch.vx * DT;
    if (ground.wallAt !== undefined && nx >= ground.wallAt) {
      launch = { ...launch, vx: 0, vz: 0 };
    } else {
      x = nx;
    }
    // The kernel's verticalPass samples the support with the feet height it
    // ENTERED the tick with, then integrates and tests the landing.
    const support = floorAt(x, y);
    vy -= GRAVITY * DT;
    y += vy * DT;
    if (y <= support) {
      return { x, y: support, ticks: tick, minClearance };
    }
    minClearance = Math.min(minClearance, y - ground.terrain(x));
  }
  throw new Error('never landed');
}

describe('planTrailbreakArc', () => {
  it('plans the exact flat hop on level ground', () => {
    const arc = planTrailbreakArc(deps({ terrain: () => 0 }), FROM, FACING, DISTANCE);
    const flatSpeed = DISTANCE / ((2 * JUMP_VELOCITY) / GRAVITY);
    expect(arc.lifted).toBe(false);
    expect(arc.vy).toBe(JUMP_VELOCITY);
    expect(arc.vx).toBeCloseTo(flatSpeed, 12);
    expect(arc.vz).toBeCloseTo(0, 12);
    expect(arc.distance).toBe(DISTANCE);
    expect(arc.flightTicks).toBe(trailbreakFlatTicks());
  });

  it('keeps the flat hop on downhill ground (no dive)', () => {
    const arc = planTrailbreakArc(deps({ terrain: (d) => -0.5 * d }), FROM, FACING, DISTANCE);
    expect(arc.lifted).toBe(false);
    expect(arc.vy).toBe(JUMP_VELOCITY);
    expect(arc.vx).toBeCloseTo(DISTANCE / ((2 * JUMP_VELOCITY) / GRAVITY), 12);
  });

  it('lifts the arc up a walkable slope and lands the full distance', () => {
    const slope = 0.4;
    const ground: Ground = { terrain: (d) => Math.max(0, slope * d) };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.lifted).toBe(true);
    expect(arc.vy).toBeGreaterThan(JUMP_VELOCITY);
    expect(arc.flightTicks).toBe(trailbreakFlatTicks());
    expect(arc.landing.y).toBeCloseTo(slope * DISTANCE, 9);

    const landed = fly(ground, arc);
    expect(landed.ticks).toBe(arc.flightTicks);
    expect(landed.x).toBeCloseTo(DISTANCE, 6);
    expect(landed.y).toBeCloseTo(slope * DISTANCE, 6);
    expect(landed.minClearance).toBeGreaterThan(0);
  });

  it('lands at the full distance up the steepest walkable slope', () => {
    const slope = PLAYER_MAX_CLIMB_SLOPE * 0.95;
    const ground: Ground = { terrain: (d) => Math.max(0, slope * d) };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    const landed = fly(ground, arc);
    expect(landed.x).toBeCloseTo(DISTANCE, 6);
    expect(landed.minClearance).toBeGreaterThan(0);
  });

  it('stretches the flight to clear a bump the chord does not', () => {
    // Level at both ends, a 1.5-yard hump in the middle (the flat hop crests
    // at about 1.1 yards, so it would land on the hump).
    const ground: Ground = {
      terrain: (d) => (d > 3 && d < 9 ? 1.5 * Math.sin((Math.PI * (d - 3)) / 6) : 0),
    };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.lifted).toBe(true);
    expect(arc.flightTicks).toBeGreaterThan(trailbreakFlatTicks());
    expect(arc.flightTicks).toBeLessThanOrEqual(trailbreakMaxTicks());
    const landed = fly(ground, arc);
    expect(landed.x).toBeCloseTo(DISTANCE, 6);
    expect(landed.y).toBeCloseTo(0, 6);
    expect(landed.minClearance).toBeGreaterThan(0);
  });

  it('flies over a low prop top the flat hop already clears, without mantling onto it', () => {
    const ground: Ground = {
      terrain: () => 0,
      prop: (d) => (d > 5 && d < 7 ? 0.8 : undefined),
    };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.lifted).toBe(false);
    expect(arc.vy).toBe(JUMP_VELOCITY);
    const landed = fly(ground, arc);
    expect(landed.x).toBeGreaterThan(DISTANCE - 1);
    expect(landed.y).toBeCloseTo(0, 6);
  });

  it('lifts over a prop top the descending flat hop would mantle onto, landing past it', () => {
    // A crate late in the run, where the flat arc has already dropped under
    // its top: the plan stretches the flight so the feet clear it.
    const ground: Ground = {
      terrain: () => 0,
      prop: (d) => (d > 8 && d < 9.5 ? 0.8 : undefined),
    };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.lifted).toBe(true);
    expect(arc.flightTicks).toBeGreaterThan(trailbreakFlatTicks());
    expect(arc.flightTicks).toBeLessThan(trailbreakMaxTicks());
    const landed = fly(ground, arc);
    expect(landed.x).toBeCloseTo(DISTANCE, 6);
    expect(landed.y).toBeCloseTo(0, 6);
  });

  it('ends at the foot of an unclimbable face', () => {
    // Gentle for four yards, then a face steeper than the climb limit.
    const ground: Ground = {
      terrain: (d) => (d <= 4 ? 0.2 * d : 0.8 + (d - 4) * (PLAYER_MAX_CLIMB_SLOPE * 2)),
    };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.distance).toBeLessThanOrEqual(4);
    expect(arc.distance).toBeGreaterThanOrEqual(3.5);
    expect(arc.landing.y).toBeCloseTo(ground.terrain(arc.distance), 9);
    const landed = fly(ground, arc);
    expect(landed.x).toBeCloseTo(arc.distance, 6);
    expect(landed.y).toBeLessThan(1);
  });

  it('stops short of a wall on level ground and lands before it', () => {
    const ground: Ground = { terrain: () => 0, wallAt: 3.2 };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.lifted).toBe(false);
    expect(arc.distance).toBe(3);
    expect(arc.vy).toBe(JUMP_VELOCITY);
    const landed = fly(ground, arc);
    expect(landed.x).toBeCloseTo(3, 6);
  });

  it('hops in place with its back to a wall', () => {
    const ground: Ground = { terrain: () => 0, wallAt: 0.4 };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.distance).toBe(0);
    expect(arc.vx).toBe(0);
    expect(arc.vz).toBe(0);
    expect(arc.vy).toBe(JUMP_VELOCITY);
    expect(arc.lifted).toBe(false);
  });

  it('hops in place with its back to a very steep slope', () => {
    const ground: Ground = { terrain: (d) => Math.max(0, d) * (PLAYER_MAX_CLIMB_SLOPE * 2) };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.distance).toBe(0);
    expect(arc.vx).toBe(0);
    expect(arc.vy).toBe(JUMP_VELOCITY);
  });

  it('never launches up a continuous unclimbable slope that rises within reach per step', () => {
    // Slope 1.7: unclimbable, but each half-yard sample rises under the mantle
    // reach. The second sample ratchets past the reach of the last walkable
    // footing, so the leap ends at the very foot instead of soaring up it.
    const slope = 1.7;
    const ground: Ground = { terrain: (d) => Math.max(0, slope * d) };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.distance).toBeLessThanOrEqual(0.5);
    expect(arc.vy).toBeLessThan(JUMP_VELOCITY * 1.5);
    const landed = fly(ground, arc);
    expect(landed.x).toBeLessThanOrEqual(0.5);
    expect(landed.y).toBeLessThan(1);
  });

  it('flies over a ditch with a steep far bank on level ground, launch unchanged', () => {
    // A one-yard ditch from 4 to 6 yards with a bank steeper than the climb
    // limit: below the launch feet, so the hop crosses it as it always did.
    const ground: Ground = {
      terrain: (d) => (d > 4 && d < 6 ? -1 + Math.max(0, (d - 5.5) * 2) : 0),
    };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.lifted).toBe(false);
    expect(arc.distance).toBe(DISTANCE);
    expect(arc.vy).toBe(JUMP_VELOCITY);
    const landed = fly(ground, arc);
    expect(landed.x).toBeGreaterThan(DISTANCE - 1);
    expect(landed.y).toBeCloseTo(0, 6);
  });

  it('carries onto a kerb-height terrace behind a walkable approach', () => {
    // A 0.8-yard riser (unclimbable on foot, within mantle reach of the
    // ground before it) onto a level terrace: the arc lifts and lands on top.
    const ground: Ground = { terrain: (d) => (d >= 6 ? 0.8 : 0) };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.lifted).toBe(true);
    expect(arc.distance).toBe(DISTANCE);
    expect(arc.landing.y).toBeCloseTo(0.8, 9);
    const landed = fly(ground, arc);
    expect(landed.x).toBeCloseTo(DISTANCE, 6);
    expect(landed.y).toBeCloseTo(0.8, 6);
    expect(landed.minClearance).toBeGreaterThan(0);
  });

  it('ignores a steepness reading over ground that barely rises', () => {
    // The kernel's steepness memo can read a level shoulder beside a riser as
    // steep; a millimetre of rise under that reading is not a wall.
    const ground: Ground = { terrain: (d) => 0.001 * d };
    const arc = planTrailbreakArc(
      { ...deps(ground), steepnessAt: () => PLAYER_MAX_CLIMB_SLOPE * 2 },
      FROM,
      FACING,
      DISTANCE,
    );
    expect(arc.distance).toBe(DISTANCE);
    const landed = fly(ground, arc);
    expect(landed.x).toBeCloseTo(DISTANCE, 6);
  });

  it('caps the flight when no arc within the cap clears the bump', () => {
    // A walkable tent of ground (every step inside the climb limit) peaking
    // well above any arc the cap allows: the plan keeps the cap and the
    // kernel will land the body on the near face of the tent.
    const ground: Ground = { terrain: (d) => Math.max(0, 5.6 - 1.4 * Math.abs(d - 6)) };
    const arc = planTrailbreakArc(deps(ground), FROM, FACING, DISTANCE);
    expect(arc.flightTicks).toBe(trailbreakMaxTicks());
    expect(Number.isFinite(arc.vy)).toBe(true);
    expect(Number.isFinite(arc.vx)).toBe(true);
  });

  it('follows the facing for the backward direction', () => {
    const facing = 0.9;
    const arc = planTrailbreakArc(deps({ terrain: () => 0 }), FROM, facing, DISTANCE);
    const speed = Math.hypot(arc.vx, arc.vz);
    expect(arc.vx / speed).toBeCloseTo(-Math.sin(facing), 12);
    expect(arc.vz / speed).toBeCloseTo(-Math.cos(facing), 12);
  });
});
