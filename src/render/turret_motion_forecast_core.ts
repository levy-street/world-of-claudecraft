// Fire and Fly monsters on screen, the forecast half. A segment ends on a
// fractional tick, but the engine only starts the next one when the tick that
// covers that end runs; a display tick that leads the sim clock would hold the
// body at the end point, then jump once the new segment arrives (a bounce, the
// slide after a landing, the first step of the march back). The forecast plays
// the engine's own transition rules with its pure resolver over the same ground
// and hands the painter the segment the engine is about to start; the engine's
// next segment starts on exactly the same tick, so when it arrives it takes
// over where the forecast stands. What the forecast cannot know (a trunk its
// probe lacks, a knock) is blended out: a segment change that moves the body
// leaves a small offset that decays in a few frames instead of a pop. A
// transition is resolved once, never per frame.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES).

import { TURRET_ARENA, TURRET_TIMING } from '../sim/content/turret_defense';
import {
  groundOr,
  type MotionSegment,
  marchSegment,
  positionAt,
  resolveFlightEnd,
  stillSegment,
  type ThrowPhysics,
  type ThrowProbe,
} from '../sim/minigames/thrown_body';
import type { TurretMonsterState } from '../sim/minigames/turret_defense';
import { DT, type Vec3 } from '../sim/types';
import type { TurretMonsterInput } from './turret_monster_pose_core';

/** Transitions forecast past one engine segment (a bounce, the next one, the landing, the rest). */
export const TURRET_FORECAST_STEPS = 4;
/** Seconds a correction takes to fall to a third (an exponential blend). */
export const TURRET_BLEND_SECONDS = 0.08;
/** A correction farther than this (yd) is a new body, not a correction: it snaps. */
export const TURRET_BLEND_MAX = 3;

export interface TurretForecastKind {
  readonly radius: number;
  readonly marchSpeed: number;
}

export interface TurretForecastCenter {
  readonly cx: number;
  readonly cz: number;
}

function sameSegment(a: MotionSegment, b: MotionSegment): boolean {
  return a.kind === b.kind && a.start === b.start && a.end === b.end && a.x === b.x && a.z === b.z;
}

/** The engine's rest point: never inside the strike ring (the tower's footprint lies within it). */
function outsideStrike(
  p: Vec3,
  kind: TurretForecastKind,
  center: TurretForecastCenter,
  probe: ThrowProbe,
): Vec3 {
  const dx = p.x - center.cx;
  const dz = p.z - center.cz;
  const d = Math.hypot(dx, dz);
  const reach = TURRET_ARENA.breachRadius + kind.radius;
  if (d >= reach) return p;
  const ux = d > 1e-9 ? dx / d : 0;
  const uz = d > 1e-9 ? dz / d : 1;
  const x = center.cx + ux * reach;
  const z = center.cz + uz * reach;
  return { x, y: groundOr(probe, x, z, p.y), z };
}

/**
 * One body's motion as the painter samples it: the engine's own state and
 * segment, or past that segment's end, the ones the engine will start next.
 * The fields a pose reads are refreshed in place by `resolve`; `blend` then
 * eases out any jump a segment change makes.
 */
export class TurretMotionForecast implements TurretMonsterInput {
  id = 0;
  hp = 0;
  maxHp = 0;
  facing = 0;
  state: TurretMonsterState = 'march';
  seg: MotionSegment = stillSegment(0, 0, { x: 0, y: 0, z: 0 });
  /** Transitions forecast past the engine's segment so far. */
  steps = 0;
  private source: MotionSegment | null = null;
  private open = true;
  private shown: MotionSegment | null = null;
  private lastTick = Number.NaN;
  private ox = 0;
  private oy = 0;
  private oz = 0;

  reset(): void {
    this.source = null;
    this.steps = 0;
    this.open = true;
    this.shown = null;
    this.lastTick = Number.NaN;
    this.ox = this.oy = this.oz = 0;
  }

  resolve(
    m: TurretMonsterInput,
    kind: TurretForecastKind,
    center: TurretForecastCenter,
    tick: number,
    probe: ThrowProbe,
    phys: ThrowPhysics,
  ): this {
    this.id = m.id;
    this.hp = m.hp;
    this.maxHp = m.maxHp;
    if (!this.source || !sameSegment(this.source, m.seg)) {
      this.source = m.seg;
      this.state = m.state;
      this.seg = m.seg;
      this.facing = m.facing;
      this.steps = 0;
      this.open = true;
    }
    while (this.open && tick > this.seg.end) {
      if (this.steps >= TURRET_FORECAST_STEPS) {
        this.open = false;
        break;
      }
      this.steps++;
      if (!this.advance(m.hp > 0, kind, center, probe, phys)) this.open = false;
    }
    return this;
  }

  /**
   * Adds the fading correction to a pose sampled on `seg` at `tick`. When the
   * segment changes, the old and the new one are compared at the same tick:
   * where the new one begins (a transition that chains, so a forecast step or
   * a rest pushed off the tower reads its true jump), or now while the old one
   * still runs (a forecast the engine corrected, a body knocked mid-stride).
   */
  blend(pose: { x: number; y: number; z: number }, tick: number, probe: ThrowProbe): void {
    if (Number.isFinite(this.lastTick)) {
      const k = Math.exp(-(Math.max(0, tick - this.lastTick) * DT) / TURRET_BLEND_SECONDS);
      this.ox *= k;
      this.oy *= k;
      this.oz *= k;
    }
    this.lastTick = tick;
    if (this.shown !== this.seg) {
      if (this.shown !== null) {
        const at = Math.max(this.seg.start, Math.min(tick, this.shown.end));
        const was = positionAt(this.shown, at, probe);
        const now = positionAt(this.seg, at, probe);
        this.ox += was.x - now.x;
        this.oy += was.y - now.y;
        this.oz += was.z - now.z;
        if (Math.hypot(this.ox, this.oy, this.oz) > TURRET_BLEND_MAX)
          this.ox = this.oy = this.oz = 0;
      }
      this.shown = this.seg;
    }
    pose.x += this.ox;
    pose.y += Math.max(0, this.oy);
    pose.z += this.oz;
  }

  /** One engine transition from the end of the current segment; false where the engine's is not motion. */
  private advance(
    living: boolean,
    kind: TurretForecastKind,
    center: TurretForecastCenter,
    probe: ThrowProbe,
    phys: ThrowPhysics,
  ): boolean {
    const at = this.seg.end;
    switch (this.state) {
      case 'fly': {
        if (this.seg.kind !== 'fly') return false;
        const out = resolveFlightEnd(this.seg, kind.radius, probe, phys);
        if (out.kind === 'bounce' || out.kind === 'wall') {
          this.seg = out.seg;
          return true;
        }
        // A splash or a flight lost in the void: the body holds until the engine speaks.
        if (out.kind !== 'land') return false;
        if (out.skid) {
          this.state = 'skid';
          this.seg = out.skid;
        } else this.rest(living, at, outsideStrike(out, kind, center, probe));
        return true;
      }
      case 'skid':
        this.rest(living, at, outsideStrike(positionAt(this.seg, at, probe), kind, center, probe));
        return true;
      case 'down':
        this.state = 'rise';
        this.seg = stillSegment(at, TURRET_TIMING.riseTicks, positionAt(this.seg, at, probe));
        return true;
      case 'rise': {
        const p = positionAt(this.seg, at, probe);
        this.state = 'march';
        this.seg = marchSegment(
          at,
          p.x,
          p.y,
          p.z,
          center.cx,
          center.cz,
          kind.marchSpeed,
          TURRET_ARENA.breachRadius + kind.radius,
        );
        this.facing = Math.atan2(center.cx - p.x, center.cz - p.z);
        return true;
      }
      default:
        return false;
    }
  }

  private rest(living: boolean, at: number, p: Vec3): void {
    this.state = living ? 'down' : 'dead';
    this.seg = stillSegment(at, living ? TURRET_TIMING.downTicks : TURRET_TIMING.corpseTicks, p);
  }
}
