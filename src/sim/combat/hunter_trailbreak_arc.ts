// Trailbreak's launch planner: the hunter's backward leap is a real ballistic
// hop through the shared movement kernel (player_motion.ts), not a scripted
// flight, so air control, fence clearance, and the landing rules all apply to
// it unchanged. The flat hop arc crests about 1.1 yards, so on ground that
// RISES behind the hunter the arc met the hillside after a tick or two and the
// landing killed the horizontal velocity: a 12-yard leap that travelled one.
//
// The fix plans the launch against the ground the leap will cross. A sweep
// walks the backward line half a yard at a time, stopping where the kernel
// would stop the body anyway (a face taller than the hop can carry over, a
// wall or a full-height prop) so the landing point is the last spot the body
// can reach. The arc is then the parabola from the feet to that landing point,
// lifted just enough to clear everything sampled between them. Ground that
// does not rise (level, downhill) plans the exact launch the old code used;
// ground that rises by any amount takes the lifted branch, which lands on the
// planned tick instead of the flat hop's one-tick-early undershoot, so a
// near-level cast can differ from a level one by that tick (a 0.15-yard apex).
//
// Pure and host-agnostic: terrain, floor, and collision reads come in through
// `TrailbreakSweepDeps`, so a Vitest can drive it over a synthetic hillside,
// and `trailbreakArcFor` binds the live Sim's own resolvers. Draws no rng.

import { MANTLE_REACH } from '../colliders';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../pathfind';
import { floorHeightAt } from '../physics';
import { GRAVITY, JUMP_VELOCITY } from '../player_motion';
import { walkedSteepnessAt } from '../ride_height';
import type { SimContext } from '../sim_context';
import { DT, type Entity, type Vec3 } from '../types';
import { groundHeight } from '../world';

/** Sweep resolution along the backward line, in yards. */
export const TRAILBREAK_SWEEP_STEP = 0.5;
/** Longest flight a lifted arc may take, as a multiple of the flat hop; past
 *  it the interior bump wins and the kernel simply lands the body on it early. */
export const TRAILBREAK_FLIGHT_STRETCH = 2;
/** The flat hop: JUMP_VELOCITY up, back on the ground after this many ticks.
 *  A function, not a module constant: when the live Sim loads, this module is
 *  reached while player_motion.ts is still evaluating (its import graph leads
 *  here), so a top-level read of its constants sees them uninitialised and a
 *  module constant built from them is NaN (a pure test importing this module
 *  directly never shows it; a `new Sim` does). */
export function trailbreakFlatTicks(): number {
  return Math.round((2 * JUMP_VELOCITY) / GRAVITY / DT);
}
export function trailbreakMaxTicks(): number {
  return trailbreakFlatTicks() * TRAILBREAK_FLIGHT_STRETCH;
}
/** Yards the arc keeps above terrain it crosses. Small: the kernel lands only
 *  when the feet reach the terrain, so any positive margin flies over it. */
export const TRAILBREAK_TERRAIN_CLEARANCE = 0.05;
/** Aim the landing a hair under the seat so the planned landing tick is the
 *  one the kernel's `feet <= support` test fires on, not the tick after. */
const LANDING_BIAS = 1e-3;
/** A resolve that moves the sample by more than this is a wall, not a nudge. */
const DIVERT_EPSILON = PLAYER_BODY_RADIUS * 0.25;

export interface TrailbreakSweepDeps {
  /** Lift-inclusive terrain height: the surface the walkable-slope rule reads. */
  groundAt(x: number, z: number): number;
  /** Terrain steepness (rise over run) at a point. */
  steepnessAt(x: number, z: number): number;
  /** The standable floor under a body whose feet may reach up to `maxY`:
   *  terrain, or a prop top within reach. */
  floorAt(x: number, z: number, maxY: number): number;
  /** Swept collision resolve from the last clear point to the next sample. */
  resolve(fromX: number, fromZ: number, toX: number, toZ: number): { x: number; z: number };
}

export interface TrailbreakArc {
  vx: number;
  vz: number;
  vy: number;
  /** Where the sweep ends: the feet seat the kernel is expected to land on. */
  landing: Vec3;
  /** Yards of backward travel the plan covers (the full distance when clear). */
  distance: number;
  /** Ticks the planned flight takes. */
  flightTicks: number;
  /** True when the launch differs from the flat hop (rising ground or a bump). */
  lifted: boolean;
}

/**
 * Plan Trailbreak's launch velocity from `from` along the hunter's back.
 *
 * Facing f points along (sin f, cos f), so the leap runs along (-sin f, -cos f).
 * The result is the velocity triple the movement kernel integrates from the
 * next tick on; nothing here moves the body.
 */
export function planTrailbreakArc(
  deps: TrailbreakSweepDeps,
  from: Vec3,
  facing: number,
  distance: number,
): TrailbreakArc {
  const dirX = -Math.sin(facing);
  const dirZ = -Math.cos(facing);
  const flatTicks = trailbreakFlatTicks();
  const flatSeconds = flatTicks * DT;

  // The sweep: every half-yard sample the body can reach, with the floor the
  // kernel would seat it on there. It stops at the first sample the kernel
  // would refuse mid-flight: a collision resolve that diverts the body (a
  // building, a tree, a prop too tall to mantle; fences are ignored, the
  // jumping body passes them), or ground rising faster than the climb limit
  // that the arc cannot simply fly over. The kernel gates an airborne body
  // only on ground ABOVE its feet, so a short steep feature (a ditch's far
  // bank, a kerb, a stair riser, a steepness-memo blip on a level shoulder)
  // is footing the leap carries over, exactly as the flat hop always did; the
  // plan below lifts the arc to clear it. What ends the sweep is a face that
  // climbs more than MANTLE_REACH above the last WALKABLE footing (the hop's
  // own reach: a cliff, a terrace wall) or a face that keeps climbing (a
  // continuous unclimbable slope ratchets past that reach on its second
  // sample), so the leap ends at the foot instead of launching up the face.
  let safeX = from.x;
  let safeZ = from.z;
  let safeFloor = from.y;
  let walkableFloor = from.y;
  let previousGround = deps.groundAt(from.x, from.z);
  const samples: { d: number; floor: number }[] = [];
  const steps = Math.max(1, Math.ceil(distance / TRAILBREAK_SWEEP_STEP));
  let reachedFull = false;
  for (let index = 1; index <= steps; index++) {
    const progress = index / steps;
    const nextX = from.x + dirX * distance * progress;
    const nextZ = from.z + dirZ * distance * progress;
    const step = Math.hypot(nextX - safeX, nextZ - safeZ);
    if (step < 1e-6) continue;
    const nextGround = deps.groundAt(nextX, nextZ);
    const unclimbable =
      nextGround > previousGround &&
      ((nextGround - previousGround) / step > PLAYER_MAX_CLIMB_SLOPE ||
        deps.steepnessAt(nextX, nextZ) > PLAYER_MAX_CLIMB_SLOPE);
    if (unclimbable && nextGround > Math.max(from.y, walkableFloor) + MANTLE_REACH) break;
    const resolved = deps.resolve(safeX, safeZ, nextX, nextZ);
    if (Math.hypot(resolved.x - nextX, resolved.z - nextZ) > DIVERT_EPSILON) break;
    safeX = resolved.x;
    safeZ = resolved.z;
    previousGround = nextGround;
    // A prop top within mantle reach of the last floor is footing the arc can
    // carry onto (the kernel's airborne support query reaches the same
    // MANTLE_REACH above the feet); anything taller was a wall to the resolve.
    safeFloor = deps.floorAt(safeX, safeZ, safeFloor + MANTLE_REACH);
    if (!unclimbable) walkableFloor = safeFloor;
    samples.push({ d: Math.hypot(safeX - from.x, safeZ - from.z), floor: safeFloor });
    reachedFull = index === steps;
  }

  const landing = { x: safeX, y: safeFloor, z: safeZ };
  const last = samples[samples.length - 1];
  if (!last || last.d < TRAILBREAK_SWEEP_STEP * 0.5) {
    // Back to a wall: nowhere to go, so the leap is a hop in place. The
    // kernel used to reach the same spot by killing the velocity against the
    // face; planning it as a hop keeps the body off the wall entirely.
    return {
      vx: 0,
      vz: 0,
      vy: JUMP_VELOCITY,
      landing: { x: from.x, y: from.y, z: from.z },
      distance: 0,
      flightTicks: flatTicks,
      lifted: false,
    };
  }

  // The plan: the parabola from the feet to the landing seat over flight time
  // T. With vy0 = rise / T + G T / 2 it lands exactly at (L, rise), and it sits
  // above the straight chord by (G T^2 / 2) u (1 - u) at fraction u of the
  // travel: the same hop arc as flat ground, riding the chord. Every interior
  // sample the chord does not already clear therefore needs T^2 large enough,
  // and the largest such need sets the flight (never shorter than the flat
  // hop, capped at trailbreakMaxTicks()). A prop top needs the same margin as
  // terrain: the airborne support query only mantles a body whose feet pass
  // BELOW a top within MANTLE_REACH, so feet that clear the top fly on.
  const travel = reachedFull ? distance : last.d;
  const rise = last.floor - from.y;
  let neededSquared = 0;
  for (const sample of samples) {
    if (sample === last) continue;
    const u = sample.d / travel;
    if (u <= 0 || u >= 1) continue;
    const excess = sample.floor - from.y - rise * u + TRAILBREAK_TERRAIN_CLEARANCE;
    if (excess <= 0) continue;
    neededSquared = Math.max(neededSquared, (2 * excess) / (GRAVITY * u * (1 - u)));
  }
  const neededTicks = Math.ceil(Math.sqrt(neededSquared) / DT);
  const flightTicks = Math.min(trailbreakMaxTicks(), Math.max(flatTicks, neededTicks));
  const lifted = rise > 0 || flightTicks > flatTicks;
  if (!lifted) {
    // Flat, downhill, or a shortened run over level ground: the launch the
    // kernel has always been given, so no tuned feel or golden changes here.
    const speed = travel / flatSeconds;
    return {
      vx: dirX * speed,
      vz: dirZ * speed,
      vy: JUMP_VELOCITY,
      landing,
      distance: travel,
      flightTicks: flatTicks,
      lifted: false,
    };
  }
  const seconds = flightTicks * DT;
  // The kernel integrates vy -= G DT before y += vy DT, which lands every arc
  // G DT / 2 per second of flight under the continuous parabola; folding that
  // into the launch makes the planned landing tick the real one.
  const vy = (rise - LANDING_BIAS) / seconds + (GRAVITY * seconds) / 2 + (GRAVITY * DT) / 2;
  const speed = travel / seconds;
  return {
    vx: dirX * speed,
    vz: dirZ * speed,
    vy,
    landing,
    distance: travel,
    flightTicks,
    lifted: true,
  };
}

/** The live binding: the Sim's own terrain, floor, and swept-collision reads
 *  (delve modules, doors, rift walls included), fences ignored the way the
 *  jumping body ignores them, and the kernel's own walked-steepness view (a
 *  stair band reads as its treads, not the carved ground under them). The
 *  hunter must already be flagged airborne so the resolve grants the mantle
 *  lift the kernel grants mid-flight; the resolve judges every sample at the
 *  launch feet height, which is conservative (a low prop far up a hill may
 *  read as a wall and shorten the leap) and never lets the body clip. */
export function trailbreakArcFor(ctx: SimContext, hunter: Entity, distance: number): TrailbreakArc {
  const seed = ctx.cfg.seed;
  return planTrailbreakArc(
    {
      groundAt: (x, z) => groundHeight(x, z, seed),
      steepnessAt: (x, z) => walkedSteepnessAt(x, z, seed),
      floorAt: (x, z, maxY) => floorHeightAt(seed, x, z, PLAYER_BODY_RADIUS, maxY),
      resolve: (fromX, fromZ, toX, toZ) =>
        ctx.resolveMove(fromX, fromZ, toX, toZ, PLAYER_BODY_RADIUS, hunter, true),
    },
    hunter.pos,
    hunter.facing,
    distance,
  );
}
