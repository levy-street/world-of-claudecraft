// Mob/pet/feared-player one-tick step toward a destination: the body of
// `Sim.moveToward`, moved whole out of src/sim/sim.ts (the coordinator keeps a
// thin delegate, and `ctx.moveToward` still binds that delegate, so every
// caller resolves exactly as before). A MOVE, not a rewrite: the same fan of
// headings, the same slope, sheet and waterline gates in the same order, the
// same floor snap. It draws NO rng.

import { authoredMapActive, MOBS } from '../data';
import { groundSheetsActive } from '../ground_sheet_queries';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../pathfind';
import { floorHeightAt } from '../physics/character';
import { swimSurfaceY } from '../player_motion';
import type { SimContext } from '../sim_context';
import { angleTo, DT, dist2d, type Entity, type Vec3 } from '../types';
import {
  groundHeight,
  mobGroundHeight,
  nearSteepWalls,
  onUnderSheet,
  sheetStepMismatch,
  sheetWallBlocksStep,
  terrainSteepnessAt,
  waterLevelAt,
} from '../world';
import { phaseStep } from './phase_step';

const MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE;
const SWIM_DEPTH = PLAYER_SWIM_DEPTH; // ground this far under the water line = deep water
const BODY_RADIUS = PLAYER_BODY_RADIUS;

// Heading offsets (radians) a mob tries when its straight path is blocked, so it
// can slide around a prop instead of pinning on it. Desired heading (0) first;
// only evaluated past the first entry when that straight step is obstructed.
export const MOVE_SLIDE_FAN: readonly number[] = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6];

// Step `e` one tick toward `dest`. With `ignoreObstacles`, the mover phases
// straight through props (used to free a stuck evader, and forced on for
// templates flagged `phasesThroughObstacles`: mountain-sized world bosses
// that must never wedge on a collider mid-chase). Returns true on arrival.
export function moveTowardImpl(
  ctx: SimContext,
  e: Entity,
  dest: Vec3,
  speed: number,
  ignoreObstacles = false,
): boolean {
  if (!ignoreObstacles && MOBS[e.templateId]?.phasesThroughObstacles) ignoreObstacles = true;
  const d = dist2d(e.pos, dest);
  if (d < 0.3) return true;
  const desired = angleTo(e.pos, dest);
  e.facing = desired;
  // An immobile mob turns to face its destination and goes no further. It
  // must not fall through to the steps below, because every one of them ends
  // by SNAPPING pos.y to the ground, and it does that even when the
  // horizontal step is zero, which is what an immobile mob always takes.
  //
  // The Tidesow found this. It is an inert mob whose position is owned by the
  // deepball physics, and once a strike put it in combat the chase arm ran
  // this every tick and wrote the ball down onto the slate, a hundred feet
  // under where it was flying. The match restored pos immediately after, so
  // the ball LOOKED right in the sim, but prevPos had already captured the
  // floor, and the renderer interpolates prevPos -> pos, so the drawn ball
  // swept between the slate and its true height every single frame.
  // Authored maps only (the Tidesow lives there): the built-in world keeps
  // release's zero-step snap, which its pinned replays move by.
  if (speed <= 0 && authoredMapActive()) return false;
  const step = Math.min(speed * DT, d);
  const canSwim = ctx.mobCanSwim(MOBS[e.templateId]);
  // Read once per step, not per fan candidate: the seed rides a getter chain,
  // and every cave/carve sheet query below early-outs to the plain surface
  // answer on a map with no sheets (the built-in world), so this one
  // constant-time check skips them there and the release fan runs unchanged.
  const seed = ctx.cfg.seed;
  const sheets = groundSheetsActive();

  // The straight-line step (and the keep-out circles it still obeys): phase_step.ts.
  if (ignoreObstacles) return phaseStep(e, dest, desired, step, d, seed);
  // Mobs have no nav mesh. Try the straight path first; only if a prop or the
  // waterline eats it do we fan the heading out and take the best slide AROUND
  // the obstacle. That lets a mob round the camp props to reach its target
  // instead of pinning on them. Open-ground movers take the first branch.
  let bestX = e.pos.x,
    bestZ = e.pos.z,
    bestProgress = 1e-3;
  // Swimmers ride the water surface, so slope checks clamp submerged ground
  // to the waterline (a sloped lake bed is not a wall; see pathfind rideHeight).
  // The waterline itself is terrain/feature-aware: outside a declared lake's
  // footprint there is no waterline at all, so a dry sunken feature never
  // reads as a shore.
  const ride = (x: number, z: number, h: number): number => {
    const wl = waterLevelAt(x, z, seed);
    return canSwim && h < wl ? wl : h;
  };
  let h0 = Number.NaN; // lazily sampled: only steep cells pay for heights
  for (const off of MOVE_SLIDE_FAN) {
    const a = desired + off;
    const nx = e.pos.x + Math.sin(a) * step;
    const nz = e.pos.z + Math.cos(a) * step;
    // landlocked creatures stop at the waterline instead of walking under it
    if (!canSwim && groundHeight(nx, nz, seed) < waterLevelAt(nx, nz, seed) - SWIM_DEPTH) {
      continue;
    }
    // Mobs, pets, and feared players obey the wall rule too: no uphill step
    // onto unwalkably steep ground. Screened to the wall bands so the hot
    // open-world fan pays nothing; inside a band the memoized cell steepness
    // screens next, and only actual wall cells pay for exact heights. This
    // is a NEW gate for these movers, so the finer per-step cliff check
    // players get is not replicated here.
    if (
      nearSteepWalls(nx, nz) &&
      terrainSteepnessAt(nx, nz, seed) > MAX_CLIMB_SLOPE &&
      // Surface steepness is scenery to a mob walking a tunnel beneath it.
      !(sheets && onUnderSheet(nx, nz, seed, e.pos.y))
    ) {
      if (Number.isNaN(h0)) h0 = ride(e.pos.x, e.pos.z, groundHeight(e.pos.x, e.pos.z, seed));
      if (ride(nx, nz, groundHeight(nx, nz, seed)) > h0) continue;
    }
    // Cave/carve sheets: a candidate that resolves onto ANOTHER layer (the
    // surface over the tunnel, or the tunnel under the field) is a teleport,
    // not a step, and the rock walls are solid for mobs and pets too.
    if (sheets && sheetStepMismatch(seed, e.pos.x, e.pos.z, e.pos.y, nx, nz)) continue;
    if (sheets && sheetWallBlocksStep(seed, e.pos.x, e.pos.z, e.pos.y, nx, nz)) continue;
    // The Great Maze's hedge walls are hard for mobs too (the maze patrol
    // knights pace their dead ends instead of drifting through a hedge).
    // resolveMovePoint now does that on its own: the hedges are real collider
    // boxes, so this no longer needs its own segment test, and keeping one
    // would reject every candidate for a body that ever ended up inside a
    // hedge, leaving it stuck instead of letting the push-out carry it clear.
    const r = ctx.resolveMovePoint(nx, nz, BODY_RADIUS, e);
    const progress = d - Math.hypot(r.x - dest.x, r.z - dest.z);
    if (progress > bestProgress) {
      bestProgress = progress;
      bestX = r.x;
      bestZ = r.z;
    }
    if (off === 0 && progress >= step - 1e-3) break; // straight path is clear
  }
  e.pos.x = bestX;
  e.pos.z = bestZ;
  // The floor a body rests on, which for a PLAYER includes the standable prop
  // top underfoot, not just the terrain. Feared players are moved through here
  // and return early from the player step, so `stepPlayerMotion` and its whole
  // vertical pass never run for the duration: snapping to raw terrain dropped
  // anyone feared off a rampart deck several yards INSIDE the rampart, where
  // swept collision then refused every direction once the fear ended (from
  // inside a volume every direction is a surface). Same expression the vertical
  // pass and climb.ts already land against.
  //
  // Scoped to players deliberately: mobs and pets keep the terrain snap they
  // have always had, so their movement, and the parity draw order with it, is
  // untouched.
  const g =
    e.kind === 'player'
      ? floorHeightAt(seed, bestX, bestZ, BODY_RADIUS, e.pos.y + 1e-3)
      : sheets
        ? mobGroundHeight(bestX, bestZ, seed, e.pos.y)
        : groundHeight(bestX, bestZ, seed);
  // A body with its own wade depth (MobTemplate.wadeDepth) wades deeper than players swim.
  const wadeDepth = MOBS[e.templateId]?.wadeDepth ?? SWIM_DEPTH;
  e.pos.y =
    canSwim && g < waterLevelAt(bestX, bestZ, seed) - wadeDepth
      ? swimSurfaceY(bestX, bestZ, seed)
      : g;
  return dist2d(e.pos, dest) < 0.3;
}
