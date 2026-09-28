// Fire and Fly monsters on screen, the pose half: where a private monster
// stands at a fractional tick, which way it faces, how its body tumbles in
// flight, lies down and gets up, and the display clock that samples the
// engine's motion segments between sim ticks. The painter is
// turret_defense_visual.ts.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES): the attitude is a plain quaternion
// the painter copies onto its wrapper group.

import { type MotionSegment, positionAt } from '../sim/minigames/thrown_body';
import type { TurretMonsterState } from '../sim/minigames/turret_defense';
import { DT, type TurretSizeClass } from '../sim/types';
import { FALL_FLAIL_ENTER_SPEED } from './characters/anim_state';

/** How far the display tick may lead the last processed sim tick. */
export const TURRET_TICK_LEAD_MAX = 1.25;
/** Ticks per tick the phase may slide back, so it follows a sim that runs slow. */
const PHASE_RELAX = 0.005;

/**
 * The fractional tick the monsters are sampled on: the frame time in ticks
 * plus a phase, clamped to [clock, clock + TURRET_TICK_LEAD_MAX]. Every frame
 * bounds the phase from below (the tick it sees has already happened), so the
 * phase is the highest bound seen, relaxing slowly. Setting the lead to the
 * time since the tick last changed would step unevenly whenever the frame rate
 * is not a multiple of the tick rate (30 fps against 20 Hz); a phase advances
 * with frame time at any rate.
 */
export class TurretDisplayClock {
  private phase = Number.NaN;
  private lastClock = Number.NaN;
  private lastTime = 0;

  reset(): void {
    this.phase = Number.NaN;
    this.lastClock = Number.NaN;
  }

  sample(clock: number, time: number): number {
    if (!(clock >= this.lastClock)) this.phase = Number.NaN;
    this.lastClock = clock;
    const base = time / DT;
    const bound = clock - base;
    if (Number.isFinite(this.phase)) {
      const relaxed = this.phase - (PHASE_RELAX * Math.max(0, time - this.lastTime)) / DT;
      this.phase = Math.max(bound, relaxed);
    } else this.phase = bound;
    this.lastTime = time;
    return Math.min(clock + TURRET_TICK_LEAD_MAX, Math.max(clock, base + this.phase));
  }
}

export type TurretAttitudeTarget = 'tumble' | 'lie' | 'upright' | 'hold';

/** The fields of an engine monster (or its read-only view) a pose reads. */
export interface TurretMonsterInput {
  readonly id: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly state: TurretMonsterState;
  readonly seg: Readonly<MotionSegment>;
  readonly facing: number;
}

export interface TurretKindInput {
  readonly mass: number;
}

export interface TurretMonsterPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Walking toward the turret at `speed` (yd/s). */
  moving: boolean;
  speed: number;
  airborne: boolean;
  falling: boolean;
  /** The rig's death clip: a corpse at rest (a body killed mid-air flies first). */
  dead: boolean;
  /** 0..1 through the current segment. */
  progress: number;
  /** Seconds into the current segment, capped at its length. */
  elapsed: number;
  attitude: TurretAttitudeTarget;
  /** Seconds the attitude takes to ease to its target from where the segment began. */
  easeSeconds: number;
  /** Unit horizontal tumble axis (perpendicular to the flight) and signed spin (rad/s). */
  axisX: number;
  axisZ: number;
  spin: number;
  /** +1 or -1 by monster id: the tumble direction and the side a body lies on. */
  side: number;
  /** 0..1 of the corpse's sink, over the last TURRET_SINK_SECONDS of its rest. */
  sink: number;
  /** 0..1 through the strike windup, -1 outside it. */
  windup: number;
  /** hp / maxHp. */
  health: number;
}

/** Spin per yd/s of launch speed, divided by sqrt(mass) so a heavy body barely rolls. */
export const TURRET_TUMBLE_PER_SPEED = 0.28;
export const TURRET_TUMBLE_MAX = 12;
export const TURRET_LIE_SECONDS = 0.2;
export const TURRET_UPRIGHT_SECONDS = 0.2;
export const TURRET_SINK_SECONDS = 1;
/** Half the body's thickness as a share of its height: how high a body lying on its side sits. */
export const TURRET_HALF_WIDTH = 0.16;

/** Capsule height of a monster's stand-in, by size class (yd). */
export const TURRET_STAND_IN_HEIGHT: Readonly<Record<TurretSizeClass, number>> = {
  small: 1.1,
  medium: 2,
  large: 2.8,
  huge: 3.4,
};

export function newTurretMonsterPose(): TurretMonsterPose {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    moving: false,
    speed: 0,
    airborne: false,
    falling: false,
    dead: false,
    progress: 0,
    elapsed: 0,
    attitude: 'hold',
    easeSeconds: 0,
    axisX: 0,
    axisZ: 0,
    spin: 0,
    side: 1,
    sink: 0,
    windup: -1,
    health: 1,
  };
}

export function turretSpinSign(id: number): number {
  return Math.abs(id) % 2 === 1 ? 1 : -1;
}

/**
 * Resolves one monster's pose at a fractional tick into `out`. `frozen` is a
 * lost session: every body holds where the engine froze it, attitude included.
 */
export function turretMonsterPoseInto(
  out: TurretMonsterPose,
  m: TurretMonsterInput,
  kind: TurretKindInput,
  tick: number,
  ground: { ground(x: number, z: number): number },
  frozen = false,
): TurretMonsterPose {
  const seg = m.seg;
  const p = positionAt(seg, tick, ground);
  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  const length = Math.max(0, seg.end - seg.start);
  const into = Math.min(length, Math.max(0, tick - seg.start));
  out.progress = length > 0 ? into / length : 1;
  out.elapsed = into * DT;
  out.yaw = m.facing;
  out.moving = false;
  out.speed = 0;
  out.airborne = false;
  out.falling = false;
  out.dead = m.state === 'dead';
  out.attitude = 'upright';
  out.easeSeconds = TURRET_UPRIGHT_SECONDS;
  out.axisX = 0;
  out.axisZ = 0;
  out.spin = 0;
  out.side = turretSpinSign(m.id);
  out.sink = 0;
  out.windup = -1;
  out.health = m.maxHp > 0 ? Math.min(1, Math.max(0, m.hp / m.maxHp)) : 0;
  switch (m.state) {
    case 'march':
      if (seg.kind === 'march') {
        if (seg.dx !== 0 || seg.dz !== 0) out.yaw = Math.atan2(seg.dx, seg.dz);
        out.moving = !frozen && seg.speed > 0 && tick < seg.end;
        out.speed = out.moving ? seg.speed : 0;
      }
      break;
    case 'windup':
      out.windup = out.progress;
      break;
    case 'fly': {
      if (seg.kind !== 'fly') {
        out.attitude = 'hold';
        break;
      }
      out.airborne = true;
      out.falling = seg.vy - seg.g * out.elapsed < -FALL_FLAIL_ENTER_SPEED;
      out.attitude = 'tumble';
      const horizontal = Math.hypot(seg.vx, seg.vz);
      if (horizontal > 1e-6) {
        out.axisX = seg.vz / horizontal;
        out.axisZ = -seg.vx / horizontal;
      } else {
        out.axisX = Math.cos(out.yaw);
        out.axisZ = -Math.sin(out.yaw);
      }
      const speed = Math.hypot(seg.vx, seg.vy, seg.vz);
      const rate = (TURRET_TUMBLE_PER_SPEED * speed) / Math.sqrt(Math.max(kind.mass, 1e-3));
      out.spin = out.side * Math.min(TURRET_TUMBLE_MAX, rate);
      break;
    }
    case 'skid':
      // A living body slides onto its side; a corpse rights itself for its death clip.
      out.attitude = m.hp > 0 ? 'lie' : 'upright';
      out.easeSeconds = length * DT;
      break;
    case 'down':
      out.attitude = 'lie';
      out.easeSeconds = TURRET_LIE_SECONDS;
      break;
    case 'rise':
      out.easeSeconds = length * DT;
      break;
    case 'dead': {
      const sinkTicks = TURRET_SINK_SECONDS / DT;
      if (length > sinkTicks) {
        out.sink = Math.min(1, Math.max(0, (tick - (seg.end - sinkTicks)) / sinkTicks));
      }
      break;
    }
    case 'gone':
      out.attitude = 'hold';
      break;
  }
  if (frozen) {
    out.attitude = 'hold';
    out.spin = 0;
    out.sink = 0;
  }
  return out;
}

function smooth(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/**
 * A body's world attitude as a unit quaternion (applied over its yaw).
 * Flights integrate the tumble so bounces and juggles stay continuous;
 * every other target eases from wherever the segment found the body.
 */
export class TurretAttitude {
  x = 0;
  y = 0;
  z = 0;
  w = 1;
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private fw = 1;
  private state: TurretMonsterState | null = null;
  private segStart = Number.NaN;
  private lastTick = Number.NaN;

  reset(): void {
    this.x = this.y = this.z = 0;
    this.w = 1;
    this.state = null;
    this.segStart = Number.NaN;
    this.lastTick = Number.NaN;
  }

  step(
    pose: TurretMonsterPose,
    state: TurretMonsterState,
    segStart: number,
    tick: number,
    reducedMotion = false,
  ): void {
    if (state !== this.state || segStart !== this.segStart) {
      this.state = state;
      this.segStart = segStart;
      this.fx = this.x;
      this.fy = this.y;
      this.fz = this.z;
      this.fw = this.w;
    }
    const seconds = Number.isFinite(this.lastTick) ? Math.max(0, tick - this.lastTick) * DT : 0;
    this.lastTick = tick;
    switch (pose.attitude) {
      case 'hold':
        return;
      case 'tumble':
        if (!reducedMotion) this.spin(pose.axisX, pose.axisZ, pose.spin * seconds);
        return;
      case 'lie': {
        const half = (pose.side * Math.PI) / 4;
        const s = Math.sin(half);
        this.ease(Math.sin(pose.yaw) * s, 0, Math.cos(pose.yaw) * s, Math.cos(half), pose);
        return;
      }
      case 'upright':
        this.ease(0, 0, 0, 1, pose);
        return;
    }
  }

  /** World y of the body's up axis: 1 upright, 0 lying on its side. */
  upY(): number {
    return 1 - 2 * (this.x * this.x + this.z * this.z);
  }

  private spin(ax: number, az: number, angle: number): void {
    if (angle === 0) return;
    const s = Math.sin(angle / 2);
    const aw = Math.cos(angle / 2);
    const rx = ax * s;
    const rz = az * s;
    const { x, y, z, w } = this;
    this.x = aw * x + rx * w - rz * y;
    this.y = aw * y - rx * z + rz * x;
    this.z = aw * z + rx * y + rz * w;
    this.w = aw * w - rx * x - rz * z;
    const n = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= n;
    this.y /= n;
    this.z /= n;
    this.w /= n;
  }

  private ease(tx: number, ty: number, tz: number, tw: number, pose: TurretMonsterPose): void {
    const t = pose.easeSeconds > 0 ? smooth(pose.elapsed / pose.easeSeconds) : 1;
    let dot = this.fx * tx + this.fy * ty + this.fz * tz + this.fw * tw;
    let sign = 1;
    if (dot < 0) {
      dot = -dot;
      sign = -1;
    }
    let a: number;
    let b: number;
    if (dot > 0.9995) {
      a = 1 - t;
      b = t * sign;
    } else {
      const theta = Math.acos(dot);
      const sin = Math.sin(theta);
      a = Math.sin((1 - t) * theta) / sin;
      b = (Math.sin(t * theta) / sin) * sign;
    }
    const x = a * this.fx + b * tx;
    const y = a * this.fy + b * ty;
    const z = a * this.fz + b * tz;
    const w = a * this.fw + b * tw;
    const n = Math.hypot(x, y, z, w) || 1;
    this.x = x / n;
    this.y = y / n;
    this.z = z / n;
    this.w = w / n;
  }
}

/**
 * Height of the body's center above its lowest point for an attitude whose
 * up axis has world y `upY`: half the height upright, half the thickness on
 * its side, so a body rotated about its center never sinks into the ground.
 */
export function turretPivotHeight(height: number, upY: number): number {
  const c = Math.min(1, Math.abs(upY));
  return (height / 2) * c + TURRET_HALF_WIDTH * height * Math.sqrt(1 - c * c);
}
