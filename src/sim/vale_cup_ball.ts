// The Vale Cup boarball: pure, host-agnostic ball physics (docs/prd/vale-cup.md).
//
// A deterministic leaf module in the threat.ts/spatial.ts mold: no SimContext, no
// rng, no clocks; every function is a pure step over a plain kinematics record, so
// tests/vale_cup_ball.test.ts drives it directly. The match driver
// (src/sim/social/vale_cup.ts) owns WHEN these run; this module owns only the math.
//
// Walls come from the ONE Sowfield layout module (src/sim/vale_cup_layout.ts), the
// same records that build the movement colliders and the render boards, so the
// ball banks off exactly what players collide with and see. Reflection is analytic
// (colliders.ts only slides, it never reflects; see the ball-physics scout note).

import { DT } from './types';
import {
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_LINE_EAST_X,
  GOAL_LINE_WEST_X,
  GOAL_Z_MAX,
  GOAL_Z_MIN,
  PITCH_WALLS,
  type VcWallSegment,
} from './vale_cup_layout';

// ---------------------------------------------------------------------------
// Tuning constants (all yards / seconds). GRAVITY matches the player jump arc
// constant (src/sim/player_motion.ts) so lofted balls and jumping players
// share one gravity.
// ---------------------------------------------------------------------------
export const VC_BALL_GRAVITY = 16;
export const VC_BALL_RADIUS = 0.49; // a real soccer ball, 30% smaller than the old ball
export const VC_BALL_MAX_SPEED = 28; // yd/s cap on ground speed
export const VC_BALL_GROUND_RESTITUTION = 0.45; // bounce energy kept on landing
export const VC_BALL_WALL_RESTITUTION = 0.75; // bank energy kept off the boards
export const VC_BALL_ROLL_DECEL = 4; // yd/s^2 rolling friction
export const VC_BALL_SLOW_DECEL = 8; // yd/s^2 once nearly stopped...
export const VC_BALL_SLOW_SPEED = 2; // ...below this speed
export const VC_BALL_BOUNCE_MIN_VY = 1.2; // smaller landings settle instead of bouncing
export const VC_BALL_POCKET_DECEL = 14; // net pockets kill the ball fast (no bank)
// Body control (a ball must never sail through a fighter): a ball FASTER than
// any dribble carry that meets a fighter's body is trapped to a slow
// controlled roll at their feet. The threshold sits above the fastest sprint
// dribble carry (7 yd/s base speed * 1.5 sprint * VC_DRIBBLE_SPEED_MULT is
// about 12.1) so dribbling never traps, while every kick profile (power 16 to
// 26) is trappable by a body in its path.
export const VC_TRAP_MIN_BALL_SPEED = 13; // yd/s; the dribble-carry ceiling
export const VC_TRAP_ROLL_SPEED = 2.5; // yd/s controlled roll after the trap
export const VC_TRAP_VY_DAMP = 0.25; // vertical speed kept through the trap

// The mutable kinematics record the match state owns. `y` is the ball's BOTTOM
// height (entity pos.y convention: resting means y === groundY).
export interface VcBallKinematics {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function capSpeed(b: VcBallKinematics): void {
  const s = Math.hypot(b.vx, b.vz);
  if (s > VC_BALL_MAX_SPEED) {
    const k = VC_BALL_MAX_SPEED / s;
    b.vx *= k;
    b.vz *= k;
  }
}

function applyRollFriction(b: VcBallKinematics, decel: number): void {
  const s = Math.hypot(b.vx, b.vz);
  if (s <= 0) return;
  const rate = s < VC_BALL_SLOW_SPEED ? Math.max(decel, VC_BALL_SLOW_DECEL) : decel;
  const ns = Math.max(0, s - rate * DT);
  if (ns === 0) {
    b.vx = 0;
    b.vz = 0;
  } else {
    const k = ns / s;
    b.vx *= k;
    b.vz *= k;
  }
}

function integrateVertical(b: VcBallKinematics, groundY: number): void {
  b.vy -= VC_BALL_GRAVITY * DT;
  b.y += b.vy * DT;
  if (b.y <= groundY) {
    b.y = groundY;
    if (b.vy < -VC_BALL_BOUNCE_MIN_VY) {
      b.vy = -b.vy * VC_BALL_GROUND_RESTITUTION;
    } else {
      b.vy = 0;
    }
  }
}

function onGround(b: VcBallKinematics, groundY: number): boolean {
  return b.y <= groundY + 1e-3 && Math.abs(b.vy) < 1e-3;
}

// Reflect off one axis-aligned board segment when the ball's center penetrates
// the wall plane (offset inward by the ball radius) moving outward, within the
// segment's span. Both velocity components scale by the restitution so the
// reflected SPEED is speed * restitution with the normal component flipped.
function reflectOffWall(b: VcBallKinematics, w: VcWallSegment): boolean {
  if (w.nx !== 0) {
    const plane = w.x1 + w.nx * VC_BALL_RADIUS;
    const penetrated = w.nx > 0 ? b.x < plane : b.x > plane;
    const outbound = w.nx > 0 ? b.vx < 0 : b.vx > 0;
    if (!penetrated || !outbound) return false;
    const z0 = Math.min(w.z1, w.z2) - VC_BALL_RADIUS;
    const z1 = Math.max(w.z1, w.z2) + VC_BALL_RADIUS;
    if (b.z < z0 || b.z > z1) return false;
    b.x = 2 * plane - b.x;
    b.vx = -b.vx * VC_BALL_WALL_RESTITUTION;
    b.vz *= VC_BALL_WALL_RESTITUTION;
    return true;
  }
  const plane = w.z1 + w.nz * VC_BALL_RADIUS;
  const penetrated = w.nz > 0 ? b.z < plane : b.z > plane;
  const outbound = w.nz > 0 ? b.vz < 0 : b.vz > 0;
  if (!penetrated || !outbound) return false;
  const x0 = Math.min(w.x1, w.x2) - VC_BALL_RADIUS;
  const x1 = Math.max(w.x1, w.x2) + VC_BALL_RADIUS;
  if (b.x < x0 || b.x > x1) return false;
  b.z = 2 * plane - b.z;
  b.vz = -b.vz * VC_BALL_WALL_RESTITUTION;
  b.vx *= VC_BALL_WALL_RESTITUTION;
  return true;
}

// One 20 Hz physics step while the ball is IN PLAY (inside the boards).
// Integrates gravity + ground bounce, rolling friction, the speed cap, then the
// goal planes and the board reflections. Returns the SCORING team when the
// ball's center crossed a goal line between the posts this step ('A' scores in
// the east goal, 'B' in the west; west is team A's own goal), else null.
export function stepBallPhysics(b: VcBallKinematics, groundY: number): 'A' | 'B' | null {
  capSpeed(b);
  const px = b.x;
  const pz = b.z;
  const py = b.y;
  b.x += b.vx * DT;
  b.z += b.vz * DT;
  integrateVertical(b, groundY);
  if (onGround(b, groundY)) applyRollFriction(b, VC_BALL_ROLL_DECEL);

  // Goal planes first: a center crossing between the posts (inclusive at the
  // post line), UNDER the crossbar, is a score and must NOT bank off the
  // flanking board segments. A ball crossing above the bar height sails over.
  if (px >= GOAL_LINE_WEST_X && b.x < GOAL_LINE_WEST_X) {
    const t = (px - GOAL_LINE_WEST_X) / Math.max(1e-9, px - b.x);
    const zc = pz + (b.z - pz) * t;
    const yc = py + (b.y - py) * t;
    if (zc >= GOAL_Z_MIN && zc <= GOAL_Z_MAX && yc - groundY < GOAL_HEIGHT) return 'B';
  } else if (px <= GOAL_LINE_EAST_X && b.x > GOAL_LINE_EAST_X) {
    const t = (GOAL_LINE_EAST_X - px) / Math.max(1e-9, b.x - px);
    const zc = pz + (b.z - pz) * t;
    const yc = py + (b.y - py) * t;
    if (zc >= GOAL_Z_MIN && zc <= GOAL_Z_MAX && yc - groundY < GOAL_HEIGHT) return 'A';
  }

  for (const w of PITCH_WALLS) reflectOffWall(b, w);
  return null;
}

// One 20 Hz step while the ball sits in a net pocket after a goal ('goal'
// phase): pocket hits settle the ball dead, they never bank. The ball is
// clamped inside the pocket box behind `side`'s goal line and decelerates hard.
export function settleBallInPocket(
  b: VcBallKinematics,
  side: 'west' | 'east',
  groundY: number,
): void {
  b.x += b.vx * DT;
  b.z += b.vz * DT;
  integrateVertical(b, groundY);
  applyRollFriction(b, VC_BALL_POCKET_DECEL);
  const line = side === 'west' ? GOAL_LINE_WEST_X : GOAL_LINE_EAST_X;
  const dir = side === 'west' ? -1 : 1;
  const back = line + dir * (GOAL_DEPTH - VC_BALL_RADIUS);
  const lo = Math.min(line, back);
  const hi = Math.max(line, back);
  if (b.x < lo) {
    b.x = lo;
    b.vx = 0;
    b.vz = 0;
  } else if (b.x > hi) {
    b.x = hi;
    b.vx = 0;
    b.vz = 0;
  }
  const zLo = GOAL_Z_MIN + VC_BALL_RADIUS;
  const zHi = GOAL_Z_MAX - VC_BALL_RADIUS;
  if (b.z < zLo) {
    b.z = zLo;
    b.vx = 0;
    b.vz = 0;
  } else if (b.z > zHi) {
    b.z = zHi;
    b.vx = 0;
    b.vz = 0;
  }
}

// Dribbling is just running with the ball: a mover overlapping the ball nudges
// it along their own movement direction to a bit over their speed, and only
// when the ball is slower than that (running into the ball carries it, it never
// slows a faster ball down). `moverDx/moverDz` is the mover's displacement THIS
// tick (pos - prevPos). Returns true when the nudge changed the ball.
export const VC_DRIBBLE_SPEED_MULT = 1.15;
const VC_DRIBBLE_MIN_MOVER_SPEED = 0.5; // yd/s; standing still never nudges

export function applyDribbleNudge(b: VcBallKinematics, moverDx: number, moverDz: number): boolean {
  const step = Math.hypot(moverDx, moverDz);
  const moverSpeed = step / DT;
  if (moverSpeed < VC_DRIBBLE_MIN_MOVER_SPEED) return false;
  const target = moverSpeed * VC_DRIBBLE_SPEED_MULT;
  if (Math.hypot(b.vx, b.vz) >= target) return false;
  b.vx = (moverDx / step) * target;
  b.vz = (moverDz / step) * target;
  return true;
}

// Body control: a fighter standing in a fast ball's path TRAPS it. The
// velocity collapses to VC_TRAP_ROLL_SPEED along the fighter's movement
// direction this tick (their facing when standing still), and the vertical
// speed is damped, so the ball drops playable at their feet instead of sailing
// through them. Fires only ABOVE the dribble-carry ceiling: slower balls stay
// with applyDribbleNudge, so a dribbler never traps their own carried ball.
// `moverDx/moverDz` is the fighter's displacement THIS tick (pos - prevPos);
// `facing` uses the sim convention (facing f points along (sin f, cos f)).
// Returns true when the fighter trapped the ball.
export function applyBodyTrap(
  b: VcBallKinematics,
  moverDx: number,
  moverDz: number,
  facing: number,
): boolean {
  if (Math.hypot(b.vx, b.vz) < VC_TRAP_MIN_BALL_SPEED) return false;
  const step = Math.hypot(moverDx, moverDz);
  let dirX: number;
  let dirZ: number;
  if (step / DT >= VC_DRIBBLE_MIN_MOVER_SPEED) {
    dirX = moverDx / step;
    dirZ = moverDz / step;
  } else {
    dirX = Math.sin(facing);
    dirZ = Math.cos(facing);
  }
  b.vx = dirX * VC_TRAP_ROLL_SPEED;
  b.vz = dirZ * VC_TRAP_ROLL_SPEED;
  b.vy *= VC_TRAP_VY_DAMP;
  return true;
}

// Launch the ball from a kick: `power` is the ground speed (yd/s, capped) along
// the unit direction, `loft` the initial vertical speed.
export function launchBall(
  b: VcBallKinematics,
  dirX: number,
  dirZ: number,
  power: number,
  loft: number,
): void {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) return;
  const speed = Math.min(VC_BALL_MAX_SPEED, Math.max(0, power));
  b.vx = (dirX / len) * speed;
  b.vz = (dirZ / len) * speed;
  b.vy = Math.max(0, loft);
}
