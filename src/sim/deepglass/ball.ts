// The Tidesow: pure, host-agnostic 3D fluid ball physics (docs/prd/deepglass.md).
//
// The vale_cup_ball.ts discipline, one axis richer: no SimContext, no rng, no
// clocks; every function is a pure step over a plain kinematics record, so the
// tests drive it directly. The match driver (./match.ts) owns WHEN these run;
// this module owns only the math.
//
// Gravity, ground bounce, rolling friction and axis-aligned board reflection
// are all gone. What replaces them is smaller: buoyancy, isotropic drag, and
// ONE analytic reflection off the inside of a sphere.

import { DT } from '../types';
import {
  bellInwardNormal,
  DEEPGLASS_CENTER,
  DEEPGLASS_RADIUS,
  DG_HOLE_PASS_R,
  DG_POCKET_DEPTH,
  distSqFromCentre,
  type Vec3,
} from './layout';

// ---------------------------------------------------------------------------
// Tuning (yards / seconds). See the PRD's physics table.
// ---------------------------------------------------------------------------
export const DG_BALL_RADIUS = 1.68; // 3.4 yd across, reads across the bell, 1.4x the original
export const DG_BALL_BUOYANCY = 0.8; // yd/s^2 up; an untouched ball slowly rises
export const DG_BALL_DRAG = 0.34; // /s, isotropic and exponential
/**
 * Gentle push back toward the middle, ramping in over the outer band.
 *
 * Measured over full bot bouts the Tidesow sat past 30 yd from the centre, the
 * outer third, hard against the glass, about HALF the time, because nothing
 * ever brought a dead ball back. The currents cannot: they are tangential and
 * deliberately fade to nothing at the wall so a body pinned there is not
 * scraped along it. This is the radial counterpart, and it only bites in the
 * outer band, so midfield play is untouched.
 */
export const DG_BALL_RETURN = 3.2; // yd/s^2 at the glass
const DG_RETURN_BAND = 0.72; // fraction of the radius where the push starts
/**
 * Speed cap, yd/s.
 *
 * Was 55, which is 2.75 yards of travel per 20 Hz tick, more than the whole
 * contact sphere, so a struck Tidesow routinely finished a tick on the far
 * side of a body it should have hit. Halving it is the single biggest thing
 * that makes the ball playable: at 34 the fastest shot in the game crosses the
 * bell in a little over two seconds and you can actually read its line.
 */
export const DG_BALL_MAX_SPEED = 34;
/**
 * The BURST ceiling: what a dash smash or a wall pinch may reach. Rocket
 * League's grammar, ordinary play lives under the cruise cap where the ball
 * is readable, and the two skill hits blow through it for a moment. The
 * overspeed drag in stepBallFluid bleeds a burst back under the cruise cap in
 * about a second, so a rocket is an EVENT, not a new cruising speed.
 */
export const DG_BALL_BURST_SPEED = 52;
/** Extra exponential drag, /s, applied only to speed above the cruise cap. */
const DG_BALL_OVERSPEED_DRAG = 1.15;
export const DG_GLASS_RESTITUTION = 0.82; // the glass is lively, wall play matters
/**
 * A WALL PINCH: the ball squeezed between a body and the glass in the same
 * instant. The bank keeps MORE than its energy (the squeeze is the pump) and
 * may exceed the cruise cap up to the burst ceiling. Rocket League's pinch,
 * spelled for a sphere.
 */
export const DG_PINCH_RESTITUTION = 1.5;
/**
 * A DASH SMASH: contact while the striker's dash flare is live. Never a trap
 * or a carry, the ball is BATTERED, with the striker's pace carried in full
 * plus a bonus impulse that scales with how hard the two came together. This
 * is what separates "dashed into it" from "bumped into it".
 */
export const DG_SMASH_RESTITUTION = 0.85;
export const DG_SMASH_BONUS = 8; // yd/s along the contact normal, flat
export const DG_SMASH_GAIN = 0.5; // plus this per yd/s of closing speed
/**
 * The kickoff throw-up: the Tidesow is fired at the crown and comes down off it
 * on a line nobody has called.
 *
 * A kickoff that simply sat the ball in the middle made the opening of every
 * bout the same race to the same spot. Now it is a jump ball: it climbs to the
 * top of the bell, bounces, and the six of them read the drop.
 */
export const DG_KICKOFF_UP_SPEED = 30; // yd/s straight up, reaches the crown
/**
 * How hard a bounce off the CROWN is scattered, radians of tilt at full
 * scatter. The glass is analytic everywhere else on purpose (wall play is a
 * skill), but a ball dropped on the very top of a sphere would otherwise come
 * straight back down the line it went up, which is the least interesting
 * possible kickoff. Only the crown cap scatters, see {@link DG_CROWN_COS}.
 */
const DG_CROWN_SCATTER = 0.5;
/** How far down the bell the "crown" reaches: the inward normal's -y component
 *  above this counts as the top cap (~36 degrees off the pole). */
const DG_CROWN_COS = 0.8;
export const DG_VOLLEY_MIN_SPEED = 15; // above this, a strike is a volley
export const DG_VOLLEY_MULT = 1.25;

// ---------------------------------------------------------------------------
// Bodies. A fighter is a capsule-ish blob whose centre is at the CHEST, one
// yard above the entity origin (the sim puts a body's origin at the soles).
// Testing the ball against the feet is what made a ball at chest height sail
// straight through a fighter who was looking right at it.
// ---------------------------------------------------------------------------
export const DG_BODY_CENTRE_Y = 1; // yd above the entity origin
export const DG_BODY_RADIUS = 1.5; // yd; generous on purpose, this is a sport

// Body control: a ball arriving faster than a fighter can shepherd is either
// TRAPPED (met square on) or DEFLECTED (clipped a shoulder). Either way the
// contact always changes the ball, it is never allowed to pass through.
/** Relative speed at or under which a body simply takes possession. */
export const DG_CONTROL_REL_SPEED = 13;
/** How head-on a fast contact must be to trap rather than deflect: the closing
 *  speed as a fraction of the relative speed. */
const DG_TRAP_SQUARENESS = 0.5;
/**
 * A trap hands the ball to its captor rather than stopping it dead: it takes
 * this fraction of their pace, capped, so a fighter who flies onto a loose ball
 * at speed is DRIBBLING it a tick later instead of watching it stall behind
 * them. A body standing still deadens it to {@link DG_TRAP_DEAD} instead.
 */
export const DG_TRAP_KEEP = 0.6;
export const DG_TRAP_MAX = 14;
export const DG_TRAP_DEAD = 3;
/** Bounce off a body, for the glancing contacts that are not traps. */
export const DG_BODY_RESTITUTION = 0.55;

// Carrying is just swimming with the ball: a mover overlapping it nudges it
// along their own movement direction to a bit over their speed.
export const DG_CARRY_LEAD = 1.15;
const DG_CARRY_MIN_MOVER_SPEED = 0.5; // yd/s; hanging still never nudges
/**
 * Relative speed at which a contact has become a pure trap.
 *
 * Between {@link DG_CONTROL_REL_SPEED} and here, the ball is handed on at a
 * factor blended from {@link DG_CARRY_LEAD} down to {@link DG_TRAP_KEEP}, the
 * two regimes used to meet at a CLIFF, so a ball met a hair over the control
 * threshold came off at 0.6x the carrier's pace while the same ball a hair under
 * came off at 1.15x. Nothing in the game reads worse than a contact whose
 * outcome doubles for no visible reason; a ramp costs nothing and every touch in
 * the band now behaves like the touches either side of it.
 */
const DG_TRAP_FULL_REL_SPEED = 21;
/**
 * How much of the ball's own SIDEWAYS drift survives a carry.
 *
 * Zero, the first pass, pinned the ball to the carrier's exact heading, which
 * looked like a ball welded to a stick: no dribbling skill, and no way to lose
 * it. A quarter of the drift leaves the Tidesow squirming a little in front of
 * you, so holding it through a turn is something you do rather than something
 * you are given.
 */
const DG_CARRY_SLIP = 0.25;
/** Outward nudge on a carry, yd/s, so the ball rides in FRONT of the chest
 *  rather than trying to occupy it. */
const DG_CARRY_STANDOFF = 0.5;

// ---------------------------------------------------------------------------
// Spin. The Tidesow is a ball in water, and a spinning ball in water CURVES, // which is the whole reason spin is here rather than as decoration. Every shot
// before this flew a straight line, so reading a shot was free: you saw where it
// was pointed and that was where it went. Now brushing across the ball as you
// fly past bends it, a keeper has to read the bend, and a shot round a body is a
// thing a player can learn to do on purpose.
// ---------------------------------------------------------------------------
/** Magnus coefficient: the sideways acceleration is this times |w||v| for a
 *  spin square to the flight. At 12 rad/s and 30 yd/s that is 7 yd/s^2, a
 *  couple of yards of bend across the bell, plainly visible and never silly. */
export const DG_BALL_MAGNUS = 0.02;
/** Cap on spin, rad/s. */
export const DG_BALL_SPIN_MAX = 15;
/** Spin bleed to the water, /s. Slower than the drag on the ball's travel, so a
 *  curling shot keeps curling for the whole of its flight. */
const DG_BALL_SPIN_DRAG = 0.55;
/** Spin off a strike, per yd/s of the striker's motion ACROSS the shot line: a
 *  clean push down the line curls nothing, a slice curls plenty. */
export const DG_SPIN_PER_SWIPE = 0.9;
/** Spin off a body contact, per yd/s of tangential rub. */
const DG_SPIN_PER_RUB = 0.35;
/** How much spin survives a bank off the glass. */
const DG_SPIN_GLASS_KEEP = 0.7;
/** How much of the ball's spin is converted into tangential speed when it banks
 *  off the glass, a spinning ball GRIPS, so it comes off at an angle. */
const DG_SPIN_GRIP = 0.06;

/** The mutable kinematics record the match state owns.
 *
 *  Spin is optional so every caller that predates it, the tests' ball
 *  literals, a fresh kickoff record, reads as "no spin" rather than NaN. */
export interface DgBallKinematics extends Vec3 {
  vx: number;
  vy: number;
  vz: number;
  /** Angular velocity, rad/s, right-handed about each axis. */
  sx?: number;
  sy?: number;
  sz?: number;
}

/** Set the ball's spin, capped. */
export function setBallSpin(b: DgBallKinematics, sx: number, sy: number, sz: number): void {
  const s = Math.hypot(sx, sy, sz);
  const k = s > DG_BALL_SPIN_MAX ? DG_BALL_SPIN_MAX / s : 1;
  b.sx = sx * k;
  b.sy = sy * k;
  b.sz = sz * k;
}

/** Add to the ball's spin, capped. */
export function addBallSpin(b: DgBallKinematics, sx: number, sy: number, sz: number): void {
  setBallSpin(b, (b.sx ?? 0) + sx, (b.sy ?? 0) + sy, (b.sz ?? 0) + sz);
}

export function ballSpin(b: DgBallKinematics): number {
  return Math.hypot(b.sx ?? 0, b.sy ?? 0, b.sz ?? 0);
}

function speedOf(b: DgBallKinematics): number {
  return Math.hypot(b.vx, b.vy, b.vz);
}

function capSpeed(b: DgBallKinematics, cap = DG_BALL_MAX_SPEED): void {
  const s = speedOf(b);
  if (s > cap) {
    const k = cap / s;
    b.vx *= k;
    b.vy *= k;
    b.vz *= k;
  }
}

/** Exponential drag, frame-rate independent by construction. */
function applyDrag(b: DgBallKinematics, perSecond: number): void {
  const k = Math.exp(-perSecond * DT);
  b.vx *= k;
  b.vy *= k;
  b.vz *= k;
}

const NORMAL_SCRATCH: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Reflect off the inside of the bell when the ball's centre penetrates the
 * glass (offset inward by the ball radius) moving outward. Analytic, like the
 * Vale Cup's board reflection, six wall segments and their span tests collapse
 * into this. Returns true when the ball banked.
 */
export function reflectOffBell(b: DgBallKinematics, scatter = 0, pinch = false): boolean {
  const limit = DEEPGLASS_RADIUS - DG_BALL_RADIUS;
  const d2 = distSqFromCentre(b.x, b.y, b.z);
  if (d2 <= limit * limit) return false;

  bellInwardNormal(b, NORMAL_SCRATCH);
  const n = NORMAL_SCRATCH; // unit, pointing back toward the centre
  // The crown scatters. `scatter` is a caller-supplied value in [-1, 1] (the
  // match hashes it off tick and salt, so the tick path stays rng-free and a
  // bout still replays exactly) and it tilts the INWARD NORMAL before the
  // reflection, which bends the bounce without touching its energy. Only up
  // at the top: everywhere else the glass stays analytic, because reading a
  // bank off the wall is a skill and scattering that would just be noise.
  if (scatter !== 0 && n.y < -DG_CROWN_COS) {
    const a = scatter * DG_CROWN_SCATTER;
    // Tilt in the plane spanned by the pole and the horizontal bearing the
    // ball arrived on, so the kick reads as the crown throwing it sideways.
    const hx = b.x - DEEPGLASS_CENTER.x;
    const hz = b.z - DEEPGLASS_CENTER.z;
    const h = Math.hypot(hx, hz);
    const ux = h > 1e-6 ? hx / h : 1;
    const uz = h > 1e-6 ? hz / h : 0;
    // n is ~(0,-1,0) up here and the tilt axis is horizontal, so the two are
    // perpendicular and this is a rotation; the normalize below absorbs the
    // small error where the cap meets its edge.
    const c = Math.cos(a);
    const s = Math.sin(a);
    n.x = n.x * c + ux * s;
    n.y = n.y * c;
    n.z = n.z * c + uz * s;
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    n.x /= len;
    n.y /= len;
    n.z /= len;
  }
  // Outward radial speed is -(v . n). Only bank when actually leaving.
  const vDotN = b.vx * n.x + b.vy * n.y + b.vz * n.z;
  // Push the centre back onto the limit sphere regardless, so a ball that
  // somehow ends up outside is always recovered.
  const d = Math.sqrt(d2) || 1;
  const k = limit / d;
  b.x = DEEPGLASS_CENTER.x + (b.x - DEEPGLASS_CENTER.x) * k;
  b.y = DEEPGLASS_CENTER.y + (b.y - DEEPGLASS_CENTER.y) * k;
  b.z = DEEPGLASS_CENTER.z + (b.z - DEEPGLASS_CENTER.z) * k;
  if (vDotN >= 0) return false; // already heading back inside

  // v' = (v - 2(v.n)n) * restitution, with n the unit inward normal. A PINCH
  // bank (body contact and glass in the same breath) GAINS energy, the
  // squeeze, and is allowed up to the burst ceiling.
  const restitution = pinch ? DG_PINCH_RESTITUTION : DG_GLASS_RESTITUTION;
  b.vx = (b.vx - 2 * vDotN * n.x) * restitution;
  b.vy = (b.vy - 2 * vDotN * n.y) * restitution;
  b.vz = (b.vz - 2 * vDotN * n.z) * restitution;
  if (pinch) capSpeed(b, DG_BALL_BURST_SPEED);

  // A spinning ball GRIPS the glass: the contact converts a slice of the spin
  // into travel along the wall (w x n), which is what makes a curling shot come
  // off the bell at an angle a straight one never would. The spin pays for it.
  const sx = b.sx ?? 0;
  const sy = b.sy ?? 0;
  const sz = b.sz ?? 0;
  if (sx !== 0 || sy !== 0 || sz !== 0) {
    b.vx += (sy * n.z - sz * n.y) * DG_SPIN_GRIP;
    b.vy += (sz * n.x - sx * n.z) * DG_SPIN_GRIP;
    b.vz += (sx * n.y - sy * n.x) * DG_SPIN_GRIP;
    setBallSpin(b, sx * DG_SPIN_GLASS_KEEP, sy * DG_SPIN_GLASS_KEEP, sz * DG_SPIN_GLASS_KEEP);
    capSpeed(b);
  }
  return true;
}

/**
 * Did the ball just leave the bell through a goal hole?
 *
 * Scoring IS escape now: the two goal mouths are circular holes cut through
 * the glass on the ±x axis (layout.ts DG_HOLE_R), and a ball whose centre
 * penetrates the glass limit sphere inside a hole's pass cylinder, travelling
 * outward on that axis, has scored and keeps flying, out into the housing's
 * pocket. Everywhere else the glass reflects it (reflectOffBell). 'A' scores
 * in the EAST hole, 'B' in the west, matching the Vale Cup credit convention.
 *
 * This replaced the old in-bell ring planes AND the invisible "goal wall"
 * across each mouth: with the goals in the glass itself there is no space
 * behind a ring for the ball to wedge into, which is what the wall existed to
 * prevent.
 */
export function escapedThroughHole(b: DgBallKinematics): 'A' | 'B' | null {
  const limit = DEEPGLASS_RADIUS - DG_BALL_RADIUS;
  if (distSqFromCentre(b.x, b.y, b.z) <= limit * limit) return null;
  const dy = b.y - DEEPGLASS_CENTER.y;
  const dz = b.z - DEEPGLASS_CENTER.z;
  if (dy * dy + dz * dz > DG_HOLE_PASS_R * DG_HOLE_PASS_R) return null;
  const dx = b.x - DEEPGLASS_CENTER.x;
  if (dx > 0 && b.vx > 0) return 'A';
  if (dx < 0 && b.vx < 0) return 'B';
  return null;
}

/**
 * One 20 Hz physics step while the ball is IN PLAY. Integrates buoyancy and
 * drag, caps speed, tests the goal holes, then banks off the glass. Returns
 * the SCORING team when the ball left the bell through a hole this step ('A'
 * scores in the east hole, 'B' in the west), else null.
 *
 * `current` is the deterministic current acceleration at the ball's position
 * (see ./currents.ts); pass zeros to disable. `scatter` (-1..1) is forwarded to
 * {@link reflectOffBell} and only bites on a crown bounce, the kickoff jump
 * ball comes off the top on a line nobody has called.
 */
export function stepBallFluid(
  b: DgBallKinematics,
  current: Vec3,
  scatter = 0,
  /**
   * How much of the tick's TRAVEL is left to run, 0..1. A contact tick has
   * already walked the ball to the moment of the hit, so integrating another
   * whole tick on top made a struck ball cover up to two ticks of ground in one
   * frame and leap out of the striker's hands. Forces still apply over the full
   * tick (they are tiny at this scale, and splitting them would need the
   * pre-contact velocity too); only the position step is scaled.
   */
  travel = 1,
  /** True for the couple of ticks after a body contact: a bank inside that
   *  window is a WALL PINCH (see DG_PINCH_RESTITUTION). */
  pinch = false,
): 'A' | 'B' | null {
  b.vy += DG_BALL_BUOYANCY * DT;
  b.vx += current.x * DT;
  b.vy += current.y * DT;
  b.vz += current.z * DT;

  // Magnus: a = k (w x v). Applied before the drag so the curve and the pace
  // bleed off together, which is what makes a long curler flatten out at the end
  // of its flight rather than hooking hardest when it is slowest.
  const sx = b.sx ?? 0;
  const sy = b.sy ?? 0;
  const sz = b.sz ?? 0;
  if (sx !== 0 || sy !== 0 || sz !== 0) {
    const k = DG_BALL_MAGNUS * DT;
    b.vx += (sy * b.vz - sz * b.vy) * k;
    b.vy += (sz * b.vx - sx * b.vz) * k;
    b.vz += (sx * b.vy - sy * b.vx) * k;
    const spinKeep = Math.exp(-DG_BALL_SPIN_DRAG * DT);
    b.sx = sx * spinKeep;
    b.sy = sy * spinKeep;
    b.sz = sz * spinKeep;
  }

  // Radial return: keep the ball off the glass so play stays in the bell.
  const rx = b.x - DEEPGLASS_CENTER.x;
  const ry = b.y - DEEPGLASS_CENTER.y;
  const rz = b.z - DEEPGLASS_CENTER.z;
  const r = Math.hypot(rx, ry, rz);
  const bandStart = DEEPGLASS_RADIUS * DG_RETURN_BAND;
  if (r > bandStart) {
    const t = Math.min(1, (r - bandStart) / (DEEPGLASS_RADIUS - bandStart));
    const a = (DG_BALL_RETURN * t * DT) / r;
    b.vx -= rx * a;
    b.vy -= ry * a;
    b.vz -= rz * a;
  }
  applyDrag(b, DG_BALL_DRAG);
  // Above the cruise cap (a burst), extra drag bleeds the excess off fast; the
  // hard ceiling is the burst cap. Under the cruise cap nothing changes.
  const sNow = speedOf(b);
  if (sNow > DG_BALL_MAX_SPEED) {
    const excess = (sNow - DG_BALL_MAX_SPEED) * Math.exp(-DG_BALL_OVERSPEED_DRAG * DT);
    const k = (DG_BALL_MAX_SPEED + excess) / sNow;
    b.vx *= k;
    b.vy *= k;
    b.vz *= k;
  }
  capSpeed(b, DG_BALL_BURST_SPEED);

  const step = DT * Math.max(0, Math.min(1, travel));
  b.x += b.vx * step;
  b.y += b.vy * step;
  b.z += b.vz * step;

  // The holes first: a ball leaving through a goal mouth must NOT then bank.
  const goal = escapedThroughHole(b);
  if (goal) return goal;

  reflectOffBell(b, scatter, pinch);
  return null;
}

/**
 * One step while the ball sits OUTSIDE the glass after a goal: it is drawn
 * gently onto the housing's pocket seat (a soft spring plus heavy drag), so a
 * rocket that just scored glides out through the hole and parks in the net
 * rather than sailing off across the stadium. Deliberately simple, the
 * celebration freezes play anyway, and the kickoff reseats the ball.
 */
const DG_POCKET_PULL = 2.4; // /s² per yard of error toward the pocket seat
export function settleBallInPocket(b: DgBallKinematics): void {
  const side = b.x >= DEEPGLASS_CENTER.x ? 1 : -1;
  const seatX = DEEPGLASS_CENTER.x + side * (DEEPGLASS_RADIUS + DG_POCKET_DEPTH);
  b.vx += (seatX - b.x) * DG_POCKET_PULL * DT;
  b.vy += (DEEPGLASS_CENTER.y - b.y) * DG_POCKET_PULL * DT;
  b.vz += (DEEPGLASS_CENTER.z - b.z) * DG_POCKET_PULL * DT;
  applyDrag(b, 4);
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;
}

// ---------------------------------------------------------------------------
// Contact. Two pieces: WHEN the ball met a body (a swept test, because both are
// moving yards per tick) and WHAT that does to it (never nothing).
// ---------------------------------------------------------------------------

/** A body as the contact code needs it: where it was, where it is, how fast. */
export interface DgContactBody {
  /** Chest centre at the START of the tick. */
  prev: Vec3;
  /** Chest centre at the END of the tick. */
  cur: Vec3;
  /** Velocity, yd/s. */
  vel: Vec3;
}

/**
 * The fraction of the tick at which a moving ball first comes within `reach` of
 * a moving body, or -1 for no contact.
 *
 * This is the fix for the ball clipping through people. The old test asked one
 * question, "is the ball inside the body's sphere at the END of the tick?",  * and at 20 Hz a struck ball hops two-and-a-half yards per tick while a boosting
 * body hops one and a half, so the pair regularly swapped sides between samples
 * with no sample ever seeing them touch. Solving the quadratic over the tick's
 * RELATIVE motion catches every one of those.
 */
export function sweptContactTime(
  ballFrom: Vec3,
  ballTo: Vec3,
  body: DgContactBody,
  reach: number,
): number {
  // Relative position and per-tick relative displacement.
  const px = ballFrom.x - body.prev.x;
  const py = ballFrom.y - body.prev.y;
  const pz = ballFrom.z - body.prev.z;
  const dx = ballTo.x - ballFrom.x - (body.cur.x - body.prev.x);
  const dy = ballTo.y - ballFrom.y - (body.cur.y - body.prev.y);
  const dz = ballTo.z - ballFrom.z - (body.cur.z - body.prev.z);

  const c = px * px + py * py + pz * pz - reach * reach;
  if (c <= 0) return 0; // already touching when the tick began
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return -1; // no relative motion and not already touching
  const b = 2 * (px * dx + py * dy + pz * dz);
  if (b >= 0) return -1; // separating
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1; // passes by outside the reach
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

export type DgTouch = 'trap' | 'carry' | 'deflect' | 'smash';

const CONTACT_N: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Resolve a contact between the ball and a body. ALWAYS changes the ball,  * which is the whole contract: a fighter the ball has touched is a fighter the
 * ball reacted to, whatever the speeds were.
 *
 *  - slow relative to the body   -> `carry`, the body takes possession
 *  - fast and met square on      -> `trap`, the ball deadens onto their chest
 *  - fast and merely clipped     -> `deflect`, it bounces off the shoulder
 *
 * The ball is also pushed out to the surface of the body so it can never end a
 * tick sitting inside someone.
 */
export function applyBodyContact(
  b: DgBallKinematics,
  body: DgContactBody,
  /** True while the body's dash flare is live: the contact is a SMASH, never
   *  a trap or a carry, and far faster than a bump (Rocket League's power
   *  touch). */
  dash = false,
): DgTouch {
  // Contact normal: from the body's chest out to the ball.
  let nx = b.x - body.cur.x;
  let ny = b.y - body.cur.y;
  let nz = b.z - body.cur.z;
  let n = Math.hypot(nx, ny, nz);
  if (n < 1e-6) {
    // Dead centre: shove it out along the body's own travel, or straight up if
    // they are not moving either, anything but leaving it stuck inside.
    const s = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
    if (s > 1e-6) {
      nx = body.vel.x / s;
      ny = body.vel.y / s;
      nz = body.vel.z / s;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
    n = 0;
  } else {
    nx /= n;
    ny /= n;
    nz /= n;
  }
  CONTACT_N.x = nx;
  CONTACT_N.y = ny;
  CONTACT_N.z = nz;

  // Never leave the ball inside the body.
  const surface = DG_BODY_RADIUS + DG_BALL_RADIUS;
  if (n < surface) {
    b.x = body.cur.x + nx * surface;
    b.y = body.cur.y + ny * surface;
    b.z = body.cur.z + nz * surface;
  }

  const rvx = b.vx - body.vel.x;
  const rvy = b.vy - body.vel.y;
  const rvz = b.vz - body.vel.z;
  const rel = Math.hypot(rvx, rvy, rvz);
  const bodySpeed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
  const closingNow = -(rvx * nx + rvy * ny + rvz * nz);

  if (dash) {
    // The SMASH. Reflect the relative motion hard, carry the striker's own
    // pace in full, then batter it along the contact normal by a flat bonus
    // plus a slice of the closing speed. Allowed up to the burst ceiling,     // this and the wall pinch are the two hits that break the cruise cap.
    const vn = rvx * nx + rvy * ny + rvz * nz;
    const k = (1 + DG_SMASH_RESTITUTION) * Math.min(0, vn);
    const punch = DG_SMASH_BONUS + DG_SMASH_GAIN * Math.max(0, closingNow);
    b.vx = body.vel.x + (rvx - k * nx) + nx * punch;
    b.vy = body.vel.y + (rvy - k * ny) + ny * punch;
    b.vz = body.vel.z + (rvz - k * nz) + nz * punch;
    capSpeed(b, DG_BALL_BURST_SPEED);
    return 'smash';
  }

  // Every branch below rubs the ball as it leaves: the component of the relative
  // motion ACROSS the contact normal is a rub, and a rub is spin. This is why a
  // ball taken on the run comes off turning, and why a fighter who slices past
  // one bends it.
  const rubX = rvx - (rvx * nx + rvy * ny + rvz * nz) * nx;
  const rubY = rvy - (rvx * nx + rvy * ny + rvz * nz) * ny;
  const rubZ = rvz - (rvx * nx + rvy * ny + rvz * nz) * nz;
  addBallSpin(
    b,
    (ny * rubZ - nz * rubY) * DG_SPIN_PER_RUB,
    (nz * rubX - nx * rubZ) * DG_SPIN_PER_RUB,
    (nx * rubY - ny * rubX) * DG_SPIN_PER_RUB,
  );

  if (rel <= DG_CONTROL_REL_SPEED) {
    // Possession: shepherd it along at a bit over the body's own pace, or just
    // cushion it if the body is hanging still. The ball keeps a slice of its own
    // sideways drift either way, a carry is a dribble, not a weld.
    if (bodySpeed < DG_CARRY_MIN_MOVER_SPEED) {
      b.vx = b.vx * 0.3 + nx * 0.6;
      b.vy = b.vy * 0.3 + ny * 0.6;
      b.vz = b.vz * 0.3 + nz * 0.6;
    } else {
      carryAlong(b, body, bodySpeed, DG_CARRY_LEAD, nx, ny, nz);
    }
    return 'carry';
  }

  const closing = -(rvx * nx + rvy * ny + rvz * nz);
  if (closing > 0 && closing / rel >= DG_TRAP_SQUARENESS) {
    // Met square on: the ball deadens onto its captor and comes along. The
    // hand-on factor ramps from a carry's lead down to the trap's keep across
    // the band above the control threshold, so there is no cliff between "just
    // about controllable" and "trapped".
    if (bodySpeed > 1e-6) {
      const t = Math.min(
        1,
        Math.max(0, (rel - DG_CONTROL_REL_SPEED) / (DG_TRAP_FULL_REL_SPEED - DG_CONTROL_REL_SPEED)),
      );
      const factor = DG_CARRY_LEAD + (DG_TRAP_KEEP - DG_CARRY_LEAD) * t;
      carryAlong(b, body, bodySpeed, factor, nx, ny, nz, DG_TRAP_MAX);
    } else {
      // Nobody moving: a shot met by a planted body drops out of the air.
      b.vx = nx * DG_TRAP_DEAD;
      b.vy = ny * DG_TRAP_DEAD;
      b.vz = nz * DG_TRAP_DEAD;
    }
    return 'trap';
  }

  // Clipped: bounce the relative velocity off the body and add the body back,
  // with a modest extra shove along the normal that scales with the closing
  // speed, the Rocket League touch rule, where every contact imparts a
  // little more than pure restitution would. A bump stays a bump; it just
  // never reads dead.
  const vn = rvx * nx + rvy * ny + rvz * nz;
  const k = (1 + DG_BODY_RESTITUTION) * vn;
  const shove = Math.min(4, 0.12 * Math.max(0, closingNow));
  b.vx = body.vel.x + (rvx - k * nx) + nx * shove;
  b.vy = body.vel.y + (rvy - k * ny) + ny * shove;
  b.vz = body.vel.z + (rvz - k * nz) + nz * shove;
  capSpeed(b);
  return 'deflect';
}

/**
 * Hand the ball on along a moving body's line at `factor` of their pace, keeping
 * a slice of the ball's own sideways drift and standing it off the chest.
 * Shared by the carry and the trap so the two cannot drift apart.
 */
function carryAlong(
  b: DgBallKinematics,
  body: DgContactBody,
  bodySpeed: number,
  factor: number,
  nx: number,
  ny: number,
  nz: number,
  cap?: number,
): void {
  let target = bodySpeed * factor;
  if (cap !== undefined) target = Math.min(target, cap);
  const ux = body.vel.x / bodySpeed;
  const uy = body.vel.y / bodySpeed;
  const uz = body.vel.z / bodySpeed;
  // The ball's drift ACROSS the carrier's line, kept in part.
  const along = b.vx * ux + b.vy * uy + b.vz * uz;
  const slipX = (b.vx - along * ux) * DG_CARRY_SLIP;
  const slipY = (b.vy - along * uy) * DG_CARRY_SLIP;
  const slipZ = (b.vz - along * uz) * DG_CARRY_SLIP;
  b.vx = ux * target + slipX + nx * DG_CARRY_STANDOFF;
  b.vy = uy * target + slipY + ny * DG_CARRY_STANDOFF;
  b.vz = uz * target + slipZ + nz * DG_CARRY_STANDOFF;
  if (cap !== undefined) {
    // The slip and the standoff must not smuggle the ball past the trap's cap.
    const s = Math.hypot(b.vx, b.vy, b.vz);
    if (s > cap && s > 1e-6) {
      const k = cap / s;
      b.vx *= k;
      b.vy *= k;
      b.vz *= k;
    }
  }
}

/**
 * Launch the ball from a strike. `power` is the speed along the unit direction.
 * A strike on an ALREADY-FAST ball is a volley and keeps a slice of the
 * incoming pace as a multiplier, the timing skill the PRD asks for. Returns
 * true when the strike landed as a volley (callers surface it to the HUD).
 *
 * `swipe` is the striker's own velocity, and it is what puts CURVE on the shot:
 * only the part of it across the shot line counts, so a straight push down the
 * line flies straight and slicing past the ball at pace bends it. Optional, so
 * every caller that has no body behind the strike (a test, a set piece) simply
 * gets no spin.
 */
export function launchBall(b: DgBallKinematics, dir: Vec3, power: number, swipe?: Vec3): boolean {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-6) return false;
  const volley = speedOf(b) >= DG_VOLLEY_MIN_SPEED;
  const speed = Math.min(DG_BALL_MAX_SPEED, Math.max(0, power) * (volley ? DG_VOLLEY_MULT : 1));
  const ux = dir.x / len;
  const uy = dir.y / len;
  const uz = dir.z / len;
  b.vx = ux * speed;
  b.vy = uy * speed;
  b.vz = uz * speed;
  if (swipe) {
    setBallSpin(
      b,
      (uy * swipe.z - uz * swipe.y) * DG_SPIN_PER_SWIPE,
      (uz * swipe.x - ux * swipe.z) * DG_SPIN_PER_SWIPE,
      (ux * swipe.y - uy * swipe.x) * DG_SPIN_PER_SWIPE,
    );
  } else {
    setBallSpin(b, 0, 0, 0);
  }
  return volley;
}

export { speedOf as ballSpeed };
