// How a dungeon guide walks with the group: he never paths in a straight line
// to anyone (walkways in a dungeon can float over a void), he walks the
// breadcrumb trail of the rearmost member's own recent steps, holding a few
// trail yards behind them, and when he has fallen far behind (or onto another
// floor) he catches up on his own: a snap onto the trail a few yards behind
// that member. Positions are written directly (he has no collision and no
// body anyone bumps into), heights come from the trail itself, so he stands
// wherever the players stood. Pure geometry over plain vectors: no SimContext,
// no rng, no clock.

import { angleTo, dist2d, type Vec3 } from '../types';
import type { DungeonGuideRun, GuideFollowTuning } from './types';

/** Trail yards between two recorded crumbs. */
export const TRAIL_STEP = 1.5;
/** The longest trail kept (about 360 trail yards). */
export const TRAIL_MAX = 240;
/** A gap this long between two crumbs is a jump (a release run, a teleport):
 *  a catch-up never walks back across one. */
export const TRAIL_JUMP = 6;

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Record the leader's step onto the trail (one crumb per TRAIL_STEP yards). */
export function recordTrail(run: DungeonGuideRun, at: Vec3): void {
  const last = run.trail[run.trail.length - 1];
  if (last && dist3(last, at) < TRAIL_STEP) return;
  run.trail.push({ x: at.x, y: at.y, z: at.z });
  if (run.trail.length > TRAIL_MAX) run.trail.splice(0, run.trail.length - TRAIL_MAX);
}

/** Trail yards from `from` through every crumb to `to`. */
export function trailLength(from: Vec3, trail: readonly Vec3[], to: Vec3): number {
  let len = 0;
  let at = from;
  for (const c of trail) {
    len += dist3(at, c);
    at = c;
  }
  return len + dist3(at, to);
}

/** Should the guide catch up on his own (out of combat only)? */
export function needsCatchUp(guide: Vec3, nearest: Vec3, tuning: GuideFollowTuning): boolean {
  const flat = dist2d(guide, nearest);
  if (flat > tuning.catchUpDistance) return true;
  return Math.abs(guide.y - nearest.y) > tuning.bandHeight && flat > 8;
}

/** The trail point `behind` trail yards back from `leader`, never across a
 *  jump; the crumbs after it stay as the trail ahead of the guide. Null when
 *  there is no trail at all, or when a jump (a release run, a teleport) lies
 *  closer than `behind`: he waits until the member has walked far enough on
 *  the far side of it, rather than appearing on top of them. */
export function catchUpPoint(
  trail: readonly Vec3[],
  leader: Vec3,
  behind: number,
): { at: Vec3; rest: Vec3[] } | null {
  if (trail.length === 0) return null;
  let walked = 0;
  let prev = leader;
  for (let i = trail.length - 1; i >= 0; i--) {
    const c = trail[i];
    const seg = dist3(prev, c);
    if (seg > TRAIL_JUMP && i < trail.length - 1) return null;
    walked += seg;
    if (walked >= behind || i === 0) return { at: { ...c }, rest: trail.slice(i + 1) };
    prev = c;
  }
  return null;
}

export interface FollowStep {
  pos: Vec3;
  facing: number;
  moved: boolean;
}

/** One tick of walking the trail toward `leader`, stopping `gap` trail yards
 *  short of them. Consumes the crumbs he passes. */
export function stepAlongTrail(
  run: DungeonGuideRun,
  guide: Vec3,
  facing: number,
  leader: Vec3,
  tuning: GuideFollowTuning,
  dt: number,
): FollowStep {
  const remaining = trailLength(guide, run.trail, leader);
  if (remaining <= tuning.gap || run.trail.length === 0) {
    return { pos: guide, facing: angleTo(guide, leader), moved: false };
  }
  const speed = remaining - tuning.gap > tuning.hurryBeyond ? tuning.runSpeed : tuning.walkSpeed;
  let budget = Math.min(speed * dt, remaining - tuning.gap);
  const pos = { x: guide.x, y: guide.y, z: guide.z };
  let heading = facing;
  while (budget > 1e-6 && run.trail.length > 0) {
    const target = run.trail[0];
    const d = dist3(pos, target);
    if (d > 1e-6 && dist2d(pos, target) > 1e-3) heading = angleTo(pos, target);
    if (d <= budget) {
      pos.x = target.x;
      pos.y = target.y;
      pos.z = target.z;
      budget -= d;
      run.trail.shift();
    } else {
      const f = budget / d;
      pos.x += (target.x - pos.x) * f;
      pos.y += (target.y - pos.y) * f;
      pos.z += (target.z - pos.z) * f;
      budget = 0;
    }
  }
  return { pos, facing: heading, moved: true };
}

/** One tick along an authored walk (the finale path), on the floor heights
 *  `ground` gives. Returns the new position, its heading, and the index of the
 *  next path point (path.length once he has arrived). */
export function stepAlongPath(
  pos: Vec3,
  facing: number,
  path: readonly Vec3[],
  index: number,
  speed: number,
  dt: number,
): { pos: Vec3; facing: number; index: number } {
  let budget = speed * dt;
  const at = { x: pos.x, y: pos.y, z: pos.z };
  let heading = facing;
  let i = index;
  while (budget > 1e-6 && i < path.length) {
    const target = path[i];
    const d = dist2d(at, target);
    if (d > 1e-3) heading = angleTo(at, target);
    if (d <= budget) {
      at.x = target.x;
      at.y = target.y;
      at.z = target.z;
      budget -= d;
      i++;
    } else {
      const f = budget / d;
      at.x += (target.x - at.x) * f;
      at.y += (target.y - at.y) * f;
      at.z += (target.z - at.z) * f;
      budget = 0;
    }
  }
  return { pos: at, facing: heading, index: i };
}
