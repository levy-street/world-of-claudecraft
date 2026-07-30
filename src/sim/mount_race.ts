// The Highwatch show-jumping race, server-authoritative, a sibling system behind
// SimContext. A permanent, always-open minigame in the stables paddock: a rider
// standing on the glowing square behind the start arch presses Start Race (the
// 'mount_race_start' wire command), watches a movement-locked 3..2..1..GO
// countdown, then must clear every jump of
// MOUNT_RACE_COURSE (airborne, crossing the bar line) IN ANY ORDER and ride back
// through the arch before the budget expires. A missed jump is not fatal: ride
// back and take it. There is no shared state at all: the session lives on
// PlayerMeta.mountRace, every event is pid-scoped, and any number of riders can
// race the same course simultaneously without touching each other.
//
// Gate detection is a ground-plane segment test: the rider's per-tick movement
// segment (prevPos -> pos, both maintained by the tick prologue + movement kernel)
// against the gate's crossing segment (raceGateSegment, perpendicular to the gate
// heading). A jump additionally requires Entity.jumping (airborne from a deliberate
// jump, the same flag the movement kernel keys fence clearance on), so a grounded
// ride-through clears nothing; crossing is non-directional so a rider may take a
// gate (or the finish arch) from either side. Dying, dismounting, cancelling, or
// leaving the paddock voids the run; there is no race fee, reward item, or
// cooldown. The lesson's existing one-time fee is charged when Start Race lends
// its training mount.
//
// A race finished while a riding lesson (src/sim/mounts_training.ts) is live is
// what credits that quest now (mounting no longer does), via the
// mountTrainingRaceFinished hook this module calls on a 'finished' outcome.
//
// Determinism: driven off live player state and the deterministic sim clock
// (ctx.tickCount) only; draws NO rng and perturbs no draw order. `src/sim`-pure:
// no DOM/Three, no Math.random/Date.now/performance.now (enforced by
// tests/architecture.test.ts).

import type { MountRaceView } from '../world_api';
import {
  isOnMountRaceStartPlatform,
  MOUNT_RACE_COURSE,
  raceGateSegment,
  STABLE_PADDOCK,
} from './content/mounts';
import { forceDismount } from './mounts';
import {
  abandonMountTraining,
  mountTrainingRaceFinished,
  needsRidingLessonRace,
  prepareRidingLessonRace,
} from './mounts_training';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { type Entity, type MountRaceSession, TICK_RATE } from './types';

/** The personal arch-to-arch budget in sim ticks (the timed lap, measured from GO). */
export const MOUNT_RACE_TIME_LIMIT_TICKS = Math.round(
  MOUNT_RACE_COURSE.timeLimitSeconds * TICK_RATE,
);

/** The 3..2..1..GO countdown before the timed lap begins (sim ticks). */
export const MOUNT_RACE_COUNTDOWN_TICKS = 3 * TICK_RATE;

// How far beyond the paddock fence a racer may stray before the run voids
// (jumping clean over the perimeter fence is leaving the course).
const PADDOCK_MARGIN = 2;

function outsidePaddock(e: Entity): boolean {
  return (
    e.pos.x < STABLE_PADDOCK.x1 - PADDOCK_MARGIN ||
    e.pos.x > STABLE_PADDOCK.x2 + PADDOCK_MARGIN ||
    e.pos.z < STABLE_PADDOCK.z1 - PADDOCK_MARGIN ||
    e.pos.z > STABLE_PADDOCK.z2 + PADDOCK_MARGIN
  );
}

/** Number of set bits (jumps cleared) in the mask. */
function popcount(n: number): number {
  let c = 0;
  let m = n;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

// Ground-plane segment intersection via the classic orientation test. Collinear
// grazes count as no crossing, which is fine at 20 Hz movement granularity.
function orient(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function segmentsCross(
  p1x: number,
  p1z: number,
  p2x: number,
  p2z: number,
  q1x: number,
  q1z: number,
  q2x: number,
  q2z: number,
): boolean {
  const o1 = orient(p1x, p1z, p2x, p2z, q1x, q1z);
  const o2 = orient(p1x, p1z, p2x, p2z, q2x, q2z);
  const o3 = orient(q1x, q1z, q2x, q2z, p1x, p1z);
  const o4 = orient(q1x, q1z, q2x, q2z, p2x, p2z);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Whether the rider's movement THIS tick crossed the gate's line, from EITHER
 *  side (any-order marking + riding back for a missed gate both need this). The
 *  gate's `dir` still orients the crossing segment (perpendicular to it), it just
 *  no longer filters the crossing direction. */
function crossedGate(
  e: Entity,
  gate: { x: number; z: number; dir: number },
  halfWidth: number,
): boolean {
  const dx = e.pos.x - e.prevPos.x;
  const dz = e.pos.z - e.prevPos.z;
  if (dx === 0 && dz === 0) return false;
  const s = raceGateSegment(gate, halfWidth);
  return segmentsCross(e.prevPos.x, e.prevPos.z, e.pos.x, e.pos.z, s.ax, s.az, s.bx, s.bz);
}

function endRace(
  ctx: SimContext,
  meta: PlayerMeta,
  s: MountRaceSession,
  outcome: 'finished' | 'timeout' | 'abandoned',
): void {
  meta.mountRace = null;
  ctx.emit({
    type: 'mountRaceEnd',
    raceId: s.raceId,
    outcome,
    timeTicks: Math.max(0, ctx.tickCount - s.goTick),
    pid: s.ownerId,
  });
  // A timeout is a failed attempt, not a quiet reset. Take any race mount back
  // immediately and close a live lesson in the same authoritative tick. An
  // explicit Cancel remains retryable and deliberately skips this branch.
  if (outcome === 'timeout') {
    const e = ctx.entities.get(meta.entityId);
    if (e) forceDismount(ctx, e);
    abandonMountTraining(ctx, meta);
  }
  // A clean finish while a riding lesson is live credits the lesson (mounting no
  // longer does); the hook is a no-op when there is no active lesson.
  if (outcome === 'finished') mountTrainingRaceFinished(ctx, meta);
}

/** Wire-initiated race start ('mount_race_start'): arm a countdown if the acting
 *  player is standing on the glowing square behind the arch. An active riding
 *  lesson is prepared here, without the old extra gossip click; other racers must
 *  already be mounted. */
export function startMountRace(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e } = r;
  if (e.dead || meta.mountRace) return;
  if (!isOnMountRaceStartPlatform(e.pos)) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  if (!e.onGround) return;
  if (needsRidingLessonRace(meta)) {
    if (!prepareRidingLessonRace(ctx, meta, e)) return;
  } else if (!e.mountKey) {
    return;
  }
  const goTick = ctx.tickCount + MOUNT_RACE_COUNTDOWN_TICKS;
  const session: MountRaceSession = {
    raceId: `race_${meta.entityId}_${ctx.tickCount}`,
    ownerId: meta.entityId,
    phase: 'countdown',
    goTick,
    deadlineTick: goTick + MOUNT_RACE_TIME_LIMIT_TICKS,
    clearedMask: 0,
  };
  meta.mountRace = session;
  ctx.emit({
    type: 'mountRaceCountdown',
    raceId: session.raceId,
    countdownTicks: MOUNT_RACE_COUNTDOWN_TICKS,
    pid: meta.entityId,
  });
}

/** Explicitly exit a live race from the centered Cancel Race button. The lesson
 *  remains armed so the rider can immediately retry from the platform. */
export function cancelMountRace(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r?.meta.mountRace) return;
  endRace(ctx, r.meta, r.meta.mountRace, 'abandoned');
}

/** Server-authoritative per-tick driver, run every tick for every player (from
 *  the coordinator's per-player loop, after movement so prevPos -> pos is this
 *  tick's motion). Advances the countdown, marks jumps, finishes, and voids the
 *  player's OWN race; never reads or writes another player's. Draws no rng. */
export function tickMountRace(ctx: SimContext, meta: PlayerMeta): void {
  const e = ctx.entities.get(meta.entityId);
  if (!e) return;
  const s = meta.mountRace;
  if (!s) return; // starting is the mount_race_start command, never an arch crossing
  // Dying, losing the mount, or leaving the paddock voids the run (either phase).
  if (e.dead || !e.mountKey || outsidePaddock(e)) {
    endRace(ctx, meta, s, 'abandoned');
    return;
  }
  if (s.phase === 'countdown') {
    // Gates are inert until GO; at GO the timed lap begins.
    if (ctx.tickCount >= s.goTick) {
      s.phase = 'racing';
      s.deadlineTick = s.goTick + MOUNT_RACE_TIME_LIMIT_TICKS;
      ctx.emit({
        type: 'mountRaceStart',
        raceId: s.raceId,
        timeLimitTicks: MOUNT_RACE_TIME_LIMIT_TICKS,
        jumpsTotal: MOUNT_RACE_COURSE.jumps.length,
        pid: meta.entityId,
      });
    }
    return;
  }
  // Racing.
  if (ctx.tickCount >= s.deadlineTick) {
    endRace(ctx, meta, s, 'timeout');
    return;
  }
  const jumps = MOUNT_RACE_COURSE.jumps;
  const allMask = (1 << jumps.length) - 1;
  if (s.clearedMask !== allMask) {
    // Any UNMARKED jump clears when crossed airborne (Entity.jumping), from either
    // side and in any order. One mark per tick (a single 20 Hz step segment can
    // meaningfully cross only one gate); the lowest unmarked index wins a tie.
    if (e.jumping) {
      for (let i = 0; i < jumps.length; i++) {
        const bit = 1 << i;
        if (s.clearedMask & bit) continue;
        if (crossedGate(e, jumps[i], MOUNT_RACE_COURSE.jumpHalfWidth)) {
          s.clearedMask |= bit;
          ctx.emit({
            type: 'mountRaceJump',
            raceId: s.raceId,
            jump: i,
            cleared: popcount(s.clearedMask),
            mask: s.clearedMask,
            jumpsTotal: jumps.length,
            pid: s.ownerId,
          });
          break;
        }
      }
    }
    return;
  }
  // Every jump marked: crossing the arch (either direction) finishes the race.
  if (crossedGate(e, MOUNT_RACE_COURSE.arch, MOUNT_RACE_COURSE.archHalfWidth)) {
    endRace(ctx, meta, s, 'finished');
  }
}

/** Read-only projection of the player's own active race for IWorld: the HUD strip
 *  progress/timer, the center-screen countdown, and the racing line's visibility
 *  all key off it. Null when not racing (line and strip stay hidden). */
export function mountRaceViewFor(ctx: SimContext, pid?: number): MountRaceView | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const s = r.meta.mountRace;
  if (!s) return null;
  return {
    raceId: s.raceId,
    phase: s.phase,
    clearedMask: s.clearedMask,
    cleared: popcount(s.clearedMask),
    jumpsTotal: MOUNT_RACE_COURSE.jumps.length,
    goTicksLeft: Math.max(0, s.goTick - ctx.tickCount),
    ticksLeft: Math.max(0, s.deadlineTick - ctx.tickCount),
    timeLimitTicks: MOUNT_RACE_TIME_LIMIT_TICKS,
  };
}
