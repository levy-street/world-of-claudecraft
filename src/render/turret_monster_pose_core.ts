// Fire and Fly monsters on screen, the pose half: where a private monster
// stands at a fractional tick, which way it faces, how its body tumbles in
// flight, settles onto a flank, its back or its front, and gets up, and the
// display clock that samples the engine's motion segments between sim ticks.
// The painter is turret_defense_visual.ts; turret_motion_forecast_core.ts
// carries a body past the end of its engine segment.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES): the attitude is a plain quaternion
// (the whole orientation, heading included) the painter copies onto its
// wrapper group.

import { type MotionSegment, positionAt } from '../sim/minigames/thrown_body';
import type { TurretMonsterState } from '../sim/minigames/turret_defense';
import { DT } from '../sim/types';
import { cannonHash01 } from './cannon_puff_core';
import { FALL_FLAIL_ENTER_SPEED } from './characters/anim_state';

/** How far the display tick may lead the last processed sim tick. */
export const TURRET_TICK_LEAD_MAX = 1.25;
/** How much further a clock that steps late (snapshots over a jittery link) may be led. */
export const TURRET_TICK_LATE_MAX = 3;
/** Ticks per tick the phase may slide back, so it follows a sim that runs slow. */
const PHASE_RELAX = 0.005;
/** Each step grows the late lead past the lead its clock needed by this much (ticks). */
const LATE_MARGIN = 0.25;
/** Ticks per tick the late lead gives back: slowly, it costs nothing while snapshots keep time. */
const LATE_RELAX = 0.002;

/**
 * The fractional tick the monsters are sampled on: the frame time in ticks
 * plus a phase, clamped to [clock, clock + TURRET_TICK_LEAD_MAX + late]. Every
 * frame bounds the phase from below (the tick it sees has already happened), so
 * the phase is the highest bound seen, relaxing slowly. Setting the lead to the
 * time since the tick last changed would step unevenly whenever the frame rate
 * is not a multiple of the tick rate (30 fps against 20 Hz); a phase advances
 * with frame time at any rate.
 *
 * Online the clock steps on snapshot arrival, and a snapshot later than the
 * earliest ones held the display at the cap: a stall, then a jump. So each step
 * measures the lead its clock needed and grows `late` to cover it with a margin,
 * up to `lateMax`, giving it back slowly. The cap only binds when a step is late:
 * a local sim steps on the frames themselves, its display never reaches even
 * TURRET_TICK_LEAD_MAX, and `late` changes nothing there.
 */
export class TurretDisplayClock {
  private phase = Number.NaN;
  private lastClock = Number.NaN;
  private lastTime = 0;
  private late = 0;

  constructor(private readonly lateMax: number = TURRET_TICK_LATE_MAX) {}

  /** Ticks the lead cap has grown past TURRET_TICK_LEAD_MAX for a clock that steps late. */
  get lateLead(): number {
    return this.late;
  }

  reset(): void {
    this.phase = Number.NaN;
    this.lastClock = Number.NaN;
    this.late = 0;
  }

  sample(clock: number, time: number): number {
    if (!(clock >= this.lastClock)) {
      this.phase = Number.NaN;
      this.late = 0;
    }
    const base = time / DT;
    const bound = clock - base;
    const elapsed = Math.max(0, time - this.lastTime);
    if (Number.isFinite(this.phase)) {
      const relaxed = this.phase - (PHASE_RELAX * elapsed) / DT;
      if (this.late > 0) this.late = Math.max(0, this.late - (LATE_RELAX * elapsed) / DT);
      if (clock > this.lastClock) {
        // The lead the last clock needed up to this step, with a margin for the next one.
        const needed = base + relaxed - this.lastClock - TURRET_TICK_LEAD_MAX + LATE_MARGIN;
        if (needed > this.late) this.late = Math.min(this.lateMax, needed);
      }
      this.phase = Math.max(bound, relaxed);
    } else this.phase = bound;
    this.lastClock = clock;
    this.lastTime = time;
    return Math.min(clock + TURRET_TICK_LEAD_MAX + this.late, Math.max(clock, base + this.phase));
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
  readonly templateId?: string;
}

/** The turret a body turns to face when it gets back on its feet. */
export interface TurretCenterInput {
  readonly cx: number;
  readonly cz: number;
}

export interface TurretMonsterPose {
  x: number;
  y: number;
  z: number;
  /** The heading an upright target faces. */
  yaw: number;
  /** An upright target keeps the heading the body already has (a corpse righting itself). */
  keepHeading: boolean;
  /** Walking toward the turret at `speed` (yd/s). */
  moving: boolean;
  speed: number;
  airborne: boolean;
  falling: boolean;
  /** The rig's death clip: a corpse once it is back on the ground (a body killed mid-air flies first). */
  dead: boolean;
  /** 0..1 through the current segment. */
  progress: number;
  /** Seconds into the current segment, capped at its length. */
  elapsed: number;
  attitude: TurretAttitudeTarget;
  /** Seconds the attitude takes to ease to a new target (TurretAttitude sets a floor per target). */
  easeSeconds: number;
  /** Unit horizontal tumble axis and signed spin (rad/s). */
  axisX: number;
  axisZ: number;
  spin: number;
  /** +1 or -1 by monster id: the tumble direction and the flank an upright body falls on. */
  side: number;
  /** A four-legged rig: it lies on a flank or on its back, legs up, never on its chest. */
  quadruped: boolean;
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
/**
 * The tumble axis leans off the square to the flight by up to this much (rad),
 * by monster id: a blast rarely strikes a body dead on its middle, so it rolls
 * a little as it flips, and lands on a flank as often as on its back.
 */
export const TURRET_TUMBLE_TILT = 0.5;
/** The shortest settle onto the ground: a slide shorter than this still lies down over it. */
export const TURRET_LIE_SECONDS = 0.35;
/** The shortest ease back upright (a corpse righting itself for its death clip). */
export const TURRET_UPRIGHT_SECONDS = 0.3;
export const TURRET_SINK_SECONDS = 1;
/** Half the body's thickness as a share of its height: how high a body lying down sits. */
export const TURRET_HALF_WIDTH = 0.16;

/** Templates whose rigs stand on four legs. */
export const TURRET_QUADRUPEDS: ReadonlySet<string> = new Set([
  'forest_wolf',
  'wild_boar',
  'webwood_spider',
]);

export function newTurretMonsterPose(): TurretMonsterPose {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    keepHeading: false,
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
    quadruped: false,
    sink: 0,
    windup: -1,
    health: 1,
  };
}

export function turretSpinSign(id: number): number {
  return Math.abs(id) % 2 === 1 ? 1 : -1;
}

/** How far a monster's tumble axis leans off the square to its flight (rad), by id. */
export function turretTumbleTilt(id: number): number {
  return (cannonHash01(id, 0x7ab1) * 2 - 1) * TURRET_TUMBLE_TILT;
}

/**
 * Resolves one monster's pose at a fractional tick into `out`. `frozen` is a
 * lost session: every body holds where the engine froze it, attitude included.
 * `center` turns a body getting up toward the turret it walks back to.
 */
export function turretMonsterPoseInto(
  out: TurretMonsterPose,
  m: TurretMonsterInput,
  kind: TurretKindInput,
  tick: number,
  ground: { ground(x: number, z: number): number },
  frozen = false,
  center: TurretCenterInput | null = null,
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
  out.keepHeading = false;
  out.moving = false;
  out.speed = 0;
  out.airborne = false;
  out.falling = false;
  out.dead = m.state === 'dead' || (m.state === 'skid' && m.hp <= 0);
  out.attitude = 'upright';
  out.easeSeconds = 0;
  out.axisX = 0;
  out.axisZ = 0;
  out.spin = 0;
  out.side = turretSpinSign(m.id);
  out.quadruped = kind.templateId !== undefined && TURRET_QUADRUPEDS.has(kind.templateId);
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
      let ax: number;
      let az: number;
      let fx: number;
      let fz: number;
      if (horizontal > 1e-6) {
        fx = seg.vx / horizontal;
        fz = seg.vz / horizontal;
      } else {
        fx = Math.sin(out.yaw);
        fz = Math.cos(out.yaw);
      }
      ax = fz;
      az = -fx;
      const tilt = turretTumbleTilt(m.id);
      const c = Math.cos(tilt);
      const s = Math.sin(tilt);
      ax = c * ax + s * fx;
      az = c * az + s * fz;
      out.axisX = ax;
      out.axisZ = az;
      const speed = Math.hypot(seg.vx, seg.vy, seg.vz);
      const rate = (TURRET_TUMBLE_PER_SPEED * speed) / Math.sqrt(Math.max(kind.mass, 1e-3));
      out.spin = out.side * Math.min(TURRET_TUMBLE_MAX, rate);
      break;
    }
    case 'skid':
      // A living body settles onto the ground; a corpse rights itself for its death clip.
      if (m.hp > 0) out.attitude = 'lie';
      else out.keepHeading = true;
      out.easeSeconds = length * DT;
      break;
    case 'down':
      out.attitude = 'lie';
      break;
    case 'rise':
      out.easeSeconds = length * DT;
      if (center) {
        const dx = center.cx - out.x;
        const dz = center.cz - out.z;
        if (dx !== 0 || dz !== 0) out.yaw = Math.atan2(dx, dz);
      }
      break;
    case 'dead': {
      out.keepHeading = true;
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

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Heading changes smaller than this keep an upright ease running rather than restarting it. */
const HEADING_EPS = 1e-3;

function headingDelta(a: number, b: number): number {
  const d = (a - b) % (2 * Math.PI);
  return Math.abs(d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
}

/**
 * A body's whole world orientation as a unit quaternion (heading included).
 * A flight integrates the tumble, so bounces and juggles stay continuous;
 * every other target eases from wherever the body was when the target
 * changed, and only a change of target (or of an upright heading) restarts
 * the ease, so a slide that becomes a rest keeps settling on the same curve.
 * Out of a tumble the ease starts fast and slows (the body keeps some of its
 * spin); otherwise it starts and ends at rest.
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
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private tw = 1;
  private target: TurretAttitudeTarget | null = null;
  private heading = 0;
  private keepHeading = false;
  private easeFrom = 0;
  private easeTicks = 0;
  private easeOut = false;
  private lastTick = Number.NaN;

  reset(): void {
    this.x = this.y = this.z = 0;
    this.w = 1;
    this.target = null;
    this.lastTick = Number.NaN;
  }

  /** The target being held or eased to: null before the first step. */
  get current(): TurretAttitudeTarget | null {
    return this.target;
  }

  step(pose: TurretMonsterPose, tick: number, reducedMotion = false): void {
    const seconds = Number.isFinite(this.lastTick) ? Math.max(0, tick - this.lastTick) * DT : 0;
    this.lastTick = tick;
    switch (pose.attitude) {
      case 'hold':
        return;
      case 'tumble':
        if (this.target === null) this.setHeading(pose.yaw);
        this.target = 'tumble';
        if (!reducedMotion) this.spin(pose.axisX, pose.axisZ, pose.spin * seconds);
        return;
      default:
        if (this.changed(pose)) this.begin(pose, tick);
        this.ease(tick);
    }
  }

  /** World y of the body's up axis: 1 upright, 0 lying down, -1 upside down. */
  upY(): number {
    return 1 - 2 * (this.x * this.x + this.z * this.z);
  }

  private changed(pose: TurretMonsterPose): boolean {
    if (pose.attitude !== this.target) return true;
    if (pose.attitude !== 'upright') return false;
    if (pose.keepHeading || this.keepHeading) return pose.keepHeading !== this.keepHeading;
    return headingDelta(pose.yaw, this.heading) > HEADING_EPS;
  }

  private begin(pose: TurretMonsterPose, tick: number): void {
    const fresh = this.target === null;
    if (fresh) this.setHeading(pose.yaw);
    this.easeOut = this.target === 'tumble';
    this.target = pose.attitude;
    this.keepHeading = pose.attitude === 'upright' && pose.keepHeading;
    if (pose.attitude === 'lie') this.lieTarget(pose.quadruped, pose.side);
    else {
      this.heading = this.keepHeading ? this.headingOr(pose.yaw) : pose.yaw;
      this.tx = 0;
      this.ty = Math.sin(this.heading / 2);
      this.tz = 0;
      this.tw = Math.cos(this.heading / 2);
    }
    if (fresh) {
      this.x = this.tx;
      this.y = this.ty;
      this.z = this.tz;
      this.w = this.tw;
    }
    this.fx = this.x;
    this.fy = this.y;
    this.fz = this.z;
    this.fw = this.w;
    const floor = pose.attitude === 'lie' ? TURRET_LIE_SECONDS : TURRET_UPRIGHT_SECONDS;
    this.easeFrom = tick;
    this.easeTicks = Math.max(floor, pose.easeSeconds) / DT;
  }

  private setHeading(yaw: number): void {
    this.x = 0;
    this.y = Math.sin(yaw / 2);
    this.z = 0;
    this.w = Math.cos(yaw / 2);
  }

  /** The heading of the current orientation (its twist about the world up), or `fallback` when it has none. */
  private headingOr(fallback: number): number {
    const len = Math.hypot(this.y, this.w);
    return len > 1e-4 ? 2 * Math.atan2(this.y, this.w) : fallback;
  }

  /**
   * The lying orientation nearest the current one: the least rotation that
   * lays a flank flat, or the back (a four-legged body lands on it legs up, a
   * two-legged one on its back or its front), whichever is closest. A body
   * that tumbled keeps the heading and the side its tumble gave it.
   */
  private lieTarget(quadruped: boolean, side: number): void {
    const { x, y, z, w } = this;
    // World y of the body's side (+x), up (+y) and forward (+z) axes.
    const sideY = 2 * (x * y + w * z);
    const upY = 1 - 2 * (x * x + z * z);
    const fwdY = 2 * (y * z - w * x);
    let ax: number;
    let ay: number;
    let az: number;
    let dy: number;
    let best = Math.abs(sideY);
    dy = sideY > 1e-9 ? 1 : sideY < -1e-9 ? -1 : side;
    ax = 1 - 2 * (y * y + z * z);
    ay = sideY;
    az = 2 * (x * z - w * y);
    const other = quadruped ? -upY : Math.abs(fwdY);
    if (other > best + 1e-6) {
      best = other;
      if (quadruped) {
        ax = 2 * (x * y - w * z);
        ay = upY;
        az = 2 * (y * z + w * x);
        dy = -1;
      } else {
        ax = 2 * (x * z + w * y);
        ay = fwdY;
        az = 1 - 2 * (x * x + y * y);
        dy = fwdY >= 0 ? 1 : -1;
      }
    }
    // The shortest arc from the chosen axis (ax, ay, az) to (0, dy, 0): r = (a x d, 1 + a.d).
    let rx = -az * dy;
    let ry = 0;
    let rz = ax * dy;
    let rw = 1 + ay * dy;
    if (rw < 1e-6) {
      // Pointing straight away: half a turn about any horizontal axis.
      rx = 1;
      ry = 0;
      rz = 0;
      rw = 0;
    }
    const n = Math.hypot(rx, ry, rz, rw) || 1;
    rx /= n;
    ry /= n;
    rz /= n;
    rw /= n;
    this.tx = rw * x + rx * w + ry * z - rz * y;
    this.ty = rw * y - rx * z + ry * w + rz * x;
    this.tz = rw * z + rx * y - ry * x + rz * w;
    this.tw = rw * w - rx * x - ry * y - rz * z;
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

  private ease(tick: number): void {
    const u = this.easeTicks > 0 ? clamp01((tick - this.easeFrom) / this.easeTicks) : 1;
    const t = this.easeOut ? 1 - (1 - u) * (1 - u) : u * u * (3 - 2 * u);
    let dot = this.fx * this.tx + this.fy * this.ty + this.fz * this.tz + this.fw * this.tw;
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
    const x = a * this.fx + b * this.tx;
    const y = a * this.fy + b * this.ty;
    const z = a * this.fz + b * this.tz;
    const w = a * this.fw + b * this.tw;
    const n = Math.hypot(x, y, z, w) || 1;
    this.x = x / n;
    this.y = y / n;
    this.z = z / n;
    this.w = w / n;
  }
}

/**
 * Height of the body's center above its lowest point for an attitude whose
 * up axis has world y `upY`: half the height upright, half the thickness lying
 * down, so a body rotated about its center never sinks into the ground.
 */
export function turretPivotHeight(height: number, upY: number): number {
  const c = Math.min(1, Math.abs(upY));
  return (height / 2) * c + TURRET_HALF_WIDTH * height * Math.sqrt(1 - c * c);
}
