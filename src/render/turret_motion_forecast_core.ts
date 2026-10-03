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
// transition is resolved once, never per frame. A hunt's member walks to its place
// at its pack's rally, stands, and leaves at the departure its rally record names
// (the cue sets it a second ahead), or walks back to its place after a throw while
// its pack still gathers.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES).

import { TURRET_ARENA, TURRET_RALLY, TURRET_TIMING } from '../sim/content/turret_defense';
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
import { type TurretRally, turretRallySlot } from '../sim/minigames/turret_rally';
import { DT, type TurretWaveRole, type Vec3 } from '../sim/types';
import type { TurretMonsterInput } from './turret_monster_pose_core';

/** Transitions forecast past one engine segment (a bounce, the next one, the landing, the rest). */
export const TURRET_FORECAST_STEPS = 4;
/** Seconds a correction takes to fall to a third (an exponential blend). */
export const TURRET_BLEND_SECONDS = 0.08;
/** A correction farther than this (yd) is a new body, not a correction: it snaps. */
export const TURRET_BLEND_MAX = 3;

/** A monster as the forecast reads it: a hunt's member also carries its pace, rally and place. */
export interface TurretForecastInput extends TurretMonsterInput {
  readonly pace?: number;
  readonly rally?: number;
  readonly slot?: number;
}

export interface TurretForecastKind {
  readonly radius: number;
  readonly marchSpeed: number;
  readonly role?: TurretWaveRole;
}

export interface TurretForecastCenter {
  readonly cx: number;
  readonly cz: number;
  /** The hunt's rallies still gathering (absent: none). */
  readonly rallies?: readonly Readonly<TurretRally>[];
}

/** The engine runs a transition on the first whole tick at or past a segment's end. */
function transitionTick(at: number): number {
  return Math.ceil(at);
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
export class TurretMotionForecast implements TurretForecastInput {
  id = 0;
  hp = 0;
  maxHp = 0;
  facing = 0;
  state: TurretMonsterState = 'march';
  seg: MotionSegment = stillSegment(0, 0, { x: 0, y: 0, z: 0 });
  pace: number | undefined = undefined;
  rally: number | undefined = undefined;
  slot: number | undefined = undefined;
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
    m: TurretForecastInput,
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
    this.pace = m.pace;
    this.rally = m.rally;
    this.slot = m.slot;
    this.cutAtDeparture(center);
    while (this.open && tick > this.seg.end) {
      if (this.steps >= TURRET_FORECAST_STEPS) {
        this.open = false;
        break;
      }
      this.steps++;
      if (!this.advance(m.hp > 0, kind, center, probe, phys)) this.open = false;
      else this.cutAtDeparture(center);
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

  /**
   * A gathering member's walk or stand ends at its pack's departure once the cue set it,
   * and the departure is a transition: the stand the forecast closed opens again.
   */
  private cutAtDeparture(center: TurretForecastCenter): void {
    if (this.state !== 'muster' && this.state !== 'hold') return;
    const depart = this.rallyOf(center)?.departTick ?? -1;
    if (depart < 0 || !(depart < this.seg.end) || !(depart >= this.seg.start)) return;
    this.seg = { ...this.seg, end: depart };
    this.open = true;
  }

  private rallyOf(center: TurretForecastCenter): Readonly<TurretRally> | undefined {
    const id = this.rally;
    return id === undefined ? undefined : center.rallies?.find((r) => r.id === id);
  }

  /** The pace of a leg to the tower: a departed pack's (a scout keeps its own), else its own. */
  private towerPace(kind: TurretForecastKind, rally: Readonly<TurretRally> | undefined): number {
    if (rally && kind.role !== 'scout') return rally.pace;
    return this.pace ?? kind.marchSpeed;
  }

  private marchIn(
    at: number,
    p: Vec3,
    pace: number,
    kind: TurretForecastKind,
    center: TurretForecastCenter,
  ): void {
    this.state = 'march';
    this.seg = marchSegment(
      at,
      p.x,
      p.y,
      p.z,
      center.cx,
      center.cz,
      pace,
      TURRET_ARENA.breachRadius + kind.radius,
    );
    this.facing = Math.atan2(center.cx - p.x, center.cz - p.z);
  }

  /** A gathering member at `p` at `at`: its departure, its stand, or its walk back to its place. */
  private gather(
    at: number,
    p: Vec3,
    walking: boolean,
    kind: TurretForecastKind,
    center: TurretForecastCenter,
  ): boolean {
    const rally = this.rallyOf(center);
    const depart = rally?.departTick ?? -1;
    if (!rally || (depart >= 0 && transitionTick(at) >= depart)) {
      // The departure pass runs before the bodies move: a body that reached its place on
      // the departure's tick leaves from there on that tick, not when it arrived.
      const from = this.state === 'rise' || depart < 0 ? at : Math.max(at, depart);
      this.marchIn(from, p, this.towerPace(kind, rally), kind, center);
      return true;
    }
    if (walking) {
      const slot = turretRallySlot(rally, center.cx, center.cz, this.slot ?? 0);
      this.state = 'muster';
      this.seg = marchSegment(at, p.x, p.y, p.z, slot.x, slot.z, this.pace ?? kind.marchSpeed, 0);
      this.facing = Math.atan2(slot.x - p.x, slot.z - p.z);
      return true;
    }
    const first = rally.firstArrivalTick >= 0 ? rally.firstArrivalTick : transitionTick(at);
    const end = depart >= 0 ? depart : first + rally.holdTicks + TURRET_RALLY.cueLeadTicks;
    this.state = 'hold';
    this.seg = stillSegment(at, Math.max(0, end - at), p);
    this.facing = Math.atan2(center.cx - p.x, center.cz - p.z);
    return true;
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
      case 'rise':
        if (this.rally !== undefined)
          return this.gather(at, positionAt(this.seg, at, probe), true, kind, center);
        this.marchIn(
          at,
          positionAt(this.seg, at, probe),
          this.pace ?? kind.marchSpeed,
          kind,
          center,
        );
        return true;
      case 'muster':
        return this.gather(at, positionAt(this.seg, at, probe), false, kind, center);
      case 'hold': {
        const depart = this.rallyOf(center)?.departTick ?? -1;
        if (this.rally !== undefined && !(depart >= 0 && transitionTick(at) >= depart))
          return false;
        return this.gather(at, positionAt(this.seg, at, probe), false, kind, center);
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
