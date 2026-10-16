// Where and how a body sitting on a seat is DRAWN (the seats are src/sim/seat_anchor.ts).
// A pure core: no Three, no DOM, no clock (the caller hands in dt), so a Vitest drives it.
//
// The sim keeps a seated body on its seat's STAND spot, clear of the furniture; the drawn
// body walks in, sits and gets up again round it, per view:
//   none ─(the body holds a seat)─> approach ─> seated ─(it stands)─> rising ─> leaving ─> none
//  - approach: from where the body was drawn (its stand spot), a short walk through the
//    seat's `via` point, if it has one, to the PRE-SIT spot just in front of the seat, facing
//    the way it walks and turning to the seat's facing over the last steps;
//  - seated: the root at the seat anchor, turned to the seat, lifted onto the seat surface
//    (seatRootY): the sit-down clip starts there from the same standing pose the approach
//    ended on (the chair clips are authored in that anchor space), then the seat's idle;
//  - rising: the stand-up clip, still at the anchor, faster when the body is already
//    walking away;
//  - leaving: from the pre-sit spot, the drawn body catches up with the live one.
// A body first seen already seated (joining near a seated patron, a view recreated) starts
// in `seated` with the sit-down skipped. A dead body is never drawn seated.

import {
  SEAT_HOLD_RADIUS,
  SEAT_HOLD_RISE,
  type SeatAnchor,
  type SeatPose,
  seatRootY,
} from '../sim/seat_anchor';

/** What the seated body does in its seat (the idle it plays). */
export type SeatIdleKind = 'rest' | 'talk' | 'drink';

/** The seat facts the animation reads (AnimState.seat). */
export interface SeatAnimInfo {
  pose: SeatPose;
  idle: SeatIdleKind;
  /** Getting up: the stand-up clip. */
  rising: boolean;
  /** Seen already seated: go straight to the idle, no sit-down. */
  skipDown: boolean;
  /** The stand-up clip's playback rate (faster when the body is already walking off). */
  rate: number;
}

export type SeatPhase = 'none' | 'approach' | 'seated' | 'rising' | 'leaving';

/** How far in front of the seat anchor the chair clips' standing frames put the body
 *  (sit_anims.glb, both clip families). A seat whose pre-sit spot is nearer (furniture in
 *  front, SeatAnchor.presit) slides the drawn root back over the clip's standing frames so
 *  the body starts and ends on that spot. */
export const SEAT_CLIP_PRESIT = 0.62;
/** The seconds of each clip over which the body stands on the floor before it is seated
 *  (sit-down) or after it has risen (stand-up), the window the pre-sit slide runs in. */
export const SEAT_DOWN_STANDING: Record<SeatPose, number> = {
  upright: 0.82,
  relaxed: 0.82,
  high: 0.7,
};
export const SEAT_UP_STANDING_FROM: Record<SeatPose, number> = {
  upright: 0.3,
  relaxed: 0.3,
  high: 0.25,
};
/** The walk in and out (yd/s): an unhurried step. */
export const SEAT_APPROACH_SPEED = 2.4;
/** The walk in ends standing still this long on the pre-sit spot before the sit-down (so
 *  the walk has settled into a standing pose when the rig switches to the seat's space). */
export const SEAT_APPROACH_DWELL = 0.2;
/** Over the last this-many yards of the walk in, the body turns to the seat's facing. */
export const SEAT_TURN_IN = 0.6;
/** The stand-up clips' lengths (Sit_Chair_StandUp, Sit_High_StandUp). */
export const SEAT_RISE_SECONDS: Record<SeatPose, number> = {
  upright: 0.9,
  relaxed: 0.9,
  high: 0.8,
};
/** A body already walking away gets up this much faster. */
export const SEAT_RISE_HURRY = 2.2;
/** The drawn body closes on the live one at this rate (1/s) while leaving, and is done
 *  within this distance. */
export const SEAT_LEAVE_RATE = 9;
export const SEAT_LEAVE_DONE = 0.05;
/** A leaving body that has not caught up by then is snapped (it never trails for long). */
export const SEAT_LEAVE_MAX_SECONDS = 1.2;
/** How far from its stand spot the live body may be and still count as getting up in
 *  place (rather than walking off at once). */
export const SEAT_RISE_IN_PLACE = 0.4;

interface P2 {
  x: number;
  z: number;
}

/** One view's seat state (the renderer keeps one per drawn body). */
export interface SeatViewState {
  phase: SeatPhase;
  seat: SeatAnchor | null;
  /** Seconds into the phase (rising: clip seconds, hurried or not). */
  t: number;
  /** Whether this view has been stepped before (a first sight skips the sit-down). */
  seen: boolean;
  skipDown: boolean;
  riseScale: number;
  /** The walk in: its waypoints and total length. */
  path: P2[];
  pathLen: number;
  /** The drawn pose this frame (the renderer's output). */
  x: number;
  y: number;
  z: number;
  facing: number;
  /** How far the rig's root sits over the drawn position (on the seat surface). */
  lift: number;
  /** Drawn locomotion while walking in or out. */
  moving: boolean;
  speed: number;
  anim: SeatAnimInfo | null;
}

export function createSeatViewState(): SeatViewState {
  return {
    phase: 'none',
    seat: null,
    t: 0,
    seen: false,
    skipDown: false,
    riseScale: 1,
    path: [],
    pathLen: 0,
    x: 0,
    y: 0,
    z: 0,
    facing: 0,
    lift: 0,
    moving: false,
    speed: 0,
    anim: null,
  };
}

/** The live body this frame: where the world draws it, and which seat it holds (null when
 *  it holds none, or is dead). */
export interface SeatLiveInput {
  held: SeatAnchor | null;
  x: number;
  y: number;
  z: number;
  facing: number;
  idle: SeatIdleKind;
}

/** A seat's forward (unit, world xz) from its facing (atan2(dx, dz)). */
function forwardOf(seat: SeatAnchor): P2 {
  return { x: Math.sin(seat.facing), z: Math.cos(seat.facing) };
}

/** The standing spot the sit-down clip starts from and the stand-up clip ends on. */
export function preSitSpot(seat: SeatAnchor): P2 {
  const f = forwardOf(seat);
  return { x: seat.x + f.x * seat.presit, z: seat.z + f.z * seat.presit };
}

const smooth = (u: number): number => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};

function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function beginApproach(s: SeatViewState, seat: SeatAnchor, fromX: number, fromZ: number): void {
  const pre = preSitSpot(seat);
  const path: P2[] = [{ x: fromX, z: fromZ }];
  if (seat.via) path.push({ x: seat.via.x, z: seat.via.z });
  path.push(pre);
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  s.phase = 'approach';
  s.seat = seat;
  s.t = 0;
  s.path = path;
  s.pathLen = len;
  s.skipDown = false;
}

/** The point `d` yards along the approach path, and the heading there. */
function alongPath(s: SeatViewState, d: number): { x: number; z: number; heading: number | null } {
  let left = d;
  for (let i = 1; i < s.path.length; i++) {
    const a = s.path[i - 1];
    const b = s.path[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 1e-6) continue;
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= seg || i === s.path.length - 1) {
      const u = Math.min(1, left / seg);
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, heading };
    }
    left -= seg;
  }
  const end = s.path[s.path.length - 1];
  return { x: end.x, z: end.z, heading: null };
}

function drawSeated(s: SeatViewState, seat: SeatAnchor, idle: SeatIdleKind, rising: boolean): void {
  // over the clips' standing frames the root slides from (to) where the pre-sit spot puts
  // the standing body, when furniture in front keeps it nearer than the clips stand it
  let slide = 0;
  if (!rising && !s.skipDown) {
    slide = 1 - smooth(s.t / SEAT_DOWN_STANDING[seat.pose]);
  } else if (rising) {
    const from = SEAT_UP_STANDING_FROM[seat.pose];
    slide = smooth((s.t - from) / (SEAT_RISE_SECONDS[seat.pose] - from));
  }
  const back = (seat.presit - SEAT_CLIP_PRESIT) * slide;
  const f = forwardOf(seat);
  s.x = seat.x + f.x * back;
  s.y = seat.floorY;
  s.z = seat.z + f.z * back;
  s.facing = seat.facing;
  s.lift = seatRootY(seat) - seat.floorY;
  s.moving = false;
  s.speed = 0;
  s.anim = { pose: seat.pose, idle, rising, skipDown: s.skipDown, rate: rising ? s.riseScale : 1 };
}

function drawLive(s: SeatViewState, live: SeatLiveInput): void {
  s.x = live.x;
  s.y = live.y;
  s.z = live.z;
  s.facing = live.facing;
  s.lift = 0;
  s.moving = false;
  s.speed = 0;
  s.anim = null;
}

/** Advance one view's seat presentation by `dt` seconds and write this frame's drawn pose
 *  into `s` (x, y, z, facing, lift, moving/speed, anim). */
export function stepSeatView(s: SeatViewState, live: SeatLiveInput, dt: number): void {
  const firstSight = !s.seen;
  s.seen = true;
  const held = live.held;
  // a seat change mid-way (a teleport from one seat to another) walks in afresh
  if (held && s.seat && held !== s.seat && s.phase !== 'none' && s.phase !== 'leaving') {
    beginApproach(s, held, s.x, s.z);
  }
  switch (s.phase) {
    case 'none':
      if (!held) {
        drawLive(s, live);
        return;
      }
      if (firstSight) {
        s.phase = 'seated';
        s.seat = held;
        s.t = 0;
        s.skipDown = true;
      } else {
        beginApproach(s, held, live.x, live.z);
      }
      break;
    case 'leaving':
      if (held) beginApproach(s, held, s.x, s.z);
      break;
    default:
      break;
  }

  if (s.phase === 'approach') {
    const seat = s.seat as SeatAnchor;
    if (!held) {
      s.phase = 'leaving';
      s.t = 0;
    } else {
      s.t += dt;
      const d = s.t * SEAT_APPROACH_SPEED;
      const walkTime = s.pathLen / SEAT_APPROACH_SPEED;
      if (s.t >= walkTime + SEAT_APPROACH_DWELL) {
        s.phase = 'seated';
        s.t = 0;
      } else if (d >= s.pathLen) {
        // arrived: stand still on the pre-sit spot, turned to the seat
        const end = s.path[s.path.length - 1];
        s.x = end.x;
        s.y = seat.floorY;
        s.z = end.z;
        s.facing = seat.facing;
        s.lift = 0;
        s.moving = false;
        s.speed = 0;
        s.anim = null;
        return;
      } else {
        const p = alongPath(s, d);
        const toGo = s.pathLen - d;
        const walkHeading = p.heading ?? seat.facing;
        const turn = Math.max(0, Math.min(1, 1 - toGo / SEAT_TURN_IN));
        s.x = p.x;
        s.y = seat.floorY;
        s.z = p.z;
        s.facing = angleLerp(walkHeading, seat.facing, turn);
        s.lift = 0;
        s.moving = true;
        s.speed = SEAT_APPROACH_SPEED;
        s.anim = null;
        return;
      }
    }
  }

  if (s.phase === 'seated') {
    const seat = s.seat as SeatAnchor;
    if (held) {
      s.t += dt;
      drawSeated(s, seat, live.idle, false);
      return;
    }
    // it stood up: get up at the seat, faster when it is already walking off
    const away = Math.hypot(live.x - seat.standX, live.z - seat.standZ);
    s.phase = 'rising';
    s.t = 0;
    s.riseScale = away > SEAT_RISE_IN_PLACE ? SEAT_RISE_HURRY : 1;
  }

  if (s.phase === 'rising') {
    const seat = s.seat as SeatAnchor;
    if (held) {
      // sat straight back down: settle back into the seat's idle
      s.phase = 'seated';
      s.t = 0;
      s.skipDown = true;
      drawSeated(s, seat, live.idle, false);
      return;
    }
    const away = Math.hypot(live.x - seat.standX, live.z - seat.standZ);
    if (away > SEAT_RISE_IN_PLACE) s.riseScale = SEAT_RISE_HURRY;
    s.t += dt * s.riseScale;
    if (s.t < SEAT_RISE_SECONDS[seat.pose]) {
      drawSeated(s, seat, live.idle, true);
      return;
    }
    const pre = preSitSpot(seat);
    s.phase = 'leaving';
    s.t = 0;
    s.x = pre.x;
    s.z = pre.z;
    s.y = seat.floorY;
  }

  if (s.phase === 'leaving') {
    s.t += dt;
    const dx = live.x - s.x;
    const dz = live.z - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= SEAT_LEAVE_DONE || s.t >= SEAT_LEAVE_MAX_SECONDS) {
      s.phase = 'none';
      s.seat = null;
      drawLive(s, live);
      return;
    }
    const k = 1 - Math.exp(-SEAT_LEAVE_RATE * dt);
    const step = Math.max(dist * k, Math.min(dist, SEAT_APPROACH_SPEED * dt));
    const ux = dx / dist;
    const uz = dz / dist;
    s.x += ux * step;
    s.z += uz * step;
    s.y += (live.y - s.y) * k;
    s.facing = angleLerp(
      s.facing,
      dist > 0.2 ? Math.atan2(ux, uz) : live.facing,
      Math.min(1, dt * 10),
    );
    s.lift = 0;
    s.moving = dt > 0 && step > 1e-4;
    s.speed = dt > 0 ? step / dt : 0;
    s.anim = null;
  }
}

/** The seat a body holds for drawing: its stand spot matched within the hold radius. The
 *  sim's own occupancy rule (seat_anchor.ts bodyHoldsSeat) with the presentation's inputs:
 *  a dead body never sits. */
export function heldSeatForDraw(
  seats: readonly SeatAnchor[],
  sitting: boolean,
  dead: boolean,
  x: number,
  y: number,
  z: number,
): SeatAnchor | null {
  if (!sitting || dead) return null;
  for (const seat of seats) {
    if (Math.abs(y - seat.floorY) > SEAT_HOLD_RISE) continue;
    if (Math.hypot(x - seat.standX, z - seat.standZ) <= SEAT_HOLD_RADIUS) return seat;
  }
  return null;
}
