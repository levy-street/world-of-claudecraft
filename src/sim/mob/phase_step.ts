// One phasing step: Sim.moveToward's straight-line mode, moved out of sim.ts whole.
//
// A phasing mover (MobTemplate.phasesThroughObstacles, or a stuck evader freed with
// ignoreObstacles) walks the straight line through props, the waterline and the steep-wall
// gate. This is that step, unchanged, plus the one thing a phasing body still obeys: its
// template's keep-out circles (mob/keep_out.ts), which bend the step round a place it must
// never enter. A mover with no circles takes exactly the step it always took.
//
// Draws no rng. The caller (Sim.moveToward) has already faced the body along `desired`
// and sized `step` (capped at the distance left, `d`).

import { MOBS } from '../data';
import { swimSurfaceY } from '../player_motion';
import type { Entity, Vec3 } from '../types';
import { groundHeight, waterLevelAt } from '../world';
import { keepOutStep, type MutablePoint } from './keep_out';

const kept: MutablePoint = { x: 0, z: 0 };

/** Take one phasing step toward `dest`. Returns true on arrival. */
export function phaseStep(
  e: Entity,
  dest: Vec3,
  desired: number,
  step: number,
  d: number,
  seed: number,
): boolean {
  let nx = e.pos.x + Math.sin(desired) * step;
  let nz = e.pos.z + Math.cos(desired) * step;
  const circles = MOBS[e.templateId]?.keepOut;
  const bent =
    circles !== undefined && keepOutStep(circles, e.pos.x, e.pos.z, nx, nz, dest.x, dest.z, kept);
  if (bent) {
    // Walking round a rim (or out of a circle) faces the way the body actually moves; held
    // on a rim, it keeps facing whatever it was chasing.
    const moved = Math.hypot(kept.x - e.pos.x, kept.z - e.pos.z);
    if (moved > step * 0.5) e.facing = Math.atan2(kept.x - e.pos.x, kept.z - e.pos.z);
    nx = kept.x;
    nz = kept.z;
  }
  e.pos.x = nx;
  e.pos.z = nz;
  const g = groundHeight(nx, nz, seed);
  // Ride the surface while phasing rather than sink under terrain or water, EXCEPT
  // a body tall enough to wade this water: its feet stay on the bed and the surface
  // rides up its legs (MobTemplate.wadeDepth). The first Balgath floated across the
  // Mirefen lakes at travel speed with his boots on the waterline, which is what a
  // thirteen-yard giant in four yards of fen must never do.
  const wadeDepth = MOBS[e.templateId]?.wadeDepth;
  e.pos.y =
    wadeDepth !== undefined && g >= waterLevelAt(nx, nz, seed) - wadeDepth
      ? g
      : Math.max(g, swimSurfaceY(nx, nz, seed));
  if (bent) return Math.hypot(dest.x - nx, dest.z - nz) < 0.3;
  return d - step < 0.3;
}
