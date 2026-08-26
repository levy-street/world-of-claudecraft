// The show-jumping race's client-side mirror, extracted whole from
// src/net/online.ts at Masterwrought phase 12 (the monolith ratchet paid for
// the Perfecting client surface): the `mntRace` self-snapshot decode and the
// four race lifecycle events, folded into the one mirror ClientWorld's
// mountRaceView() counts down from. One of the wire-decode siblings
// (snapshot_timer_wire.ts, guild_bank_log_wire.ts): DOM-free,
// ClientWorld-free, every field re-validated, and the clock INJECTED (the
// net_pipeline_stats precedent), so the deadlines are absolute in the
// caller's own clock base and a test can pin them exactly.
import { MOUNT_RACE_COURSE } from '../sim/content/mounts';
import { type SimEvent, TICK_RATE } from '../sim/types';
import type { MountRaceView } from '../world_api/mounts';

/** The mirror's internal shape: wall-clock anchors (the caller's clock scale,
 *  render-interpolation timing only), goDeadlineMs for the 3..2..1 countdown
 *  and deadlineMs for the timed lap, so the view read can count both down;
 *  the server stays authoritative (its end event clears the mirror).
 *  clearedMask/cleared mirror the any-order jump progress. */
export interface MountRaceMirror {
  raceId: string;
  phase: 'countdown' | 'racing';
  clearedMask: number;
  cleared: number;
  jumpsTotal: number;
  goDeadlineMs: number;
  deadlineMs: number;
  timeLimitTicks: number;
}

/** The authoritative `mntRace` self-snapshot row (the server's own
 *  MountRaceView, tick-relative), re-anchored onto the caller's clock. Null
 *  clears the mirror (no race); every numeric field is clamped to a
 *  non-negative number and the phase to the two-member union. */
export function decodeMountRaceView(raw: unknown, nowMs: number): MountRaceMirror | null {
  const view = raw as MountRaceView | null;
  if (!view) return null;
  const goTicksLeft = Math.max(0, Number(view.goTicksLeft) || 0);
  const ticksLeft = Math.max(0, Number(view.ticksLeft) || 0);
  const timeLimitTicks = Math.max(0, Number(view.timeLimitTicks) || 0);
  return {
    raceId: String(view.raceId),
    phase: view.phase === 'racing' ? 'racing' : 'countdown',
    clearedMask: Math.max(0, Number(view.clearedMask) || 0),
    cleared: Math.max(0, Number(view.cleared) || 0),
    jumpsTotal: Math.max(0, Number(view.jumpsTotal) || 0),
    goDeadlineMs: nowMs + (goTicksLeft / TICK_RATE) * 1000,
    deadlineMs: nowMs + (ticksLeft / TICK_RATE) * 1000,
    timeLimitTicks,
  };
}

/** Fold one routed event into the mirror and return the mirror to keep: the
 *  same object (mutated in place) on a same-race progress event, a fresh one
 *  on a countdown or an unmatched start, null on the matching end, and the
 *  input untouched on every non-race event. Gate positions never ride the
 *  wire (the racing line derives from the shared MOUNT_RACE_COURSE content). */
export function applyMountRaceEventToMirror(
  mirror: MountRaceMirror | null,
  ev: SimEvent,
  nowMs: number,
): MountRaceMirror | null {
  if (ev.type === 'mountRaceCountdown') {
    return {
      raceId: ev.raceId,
      phase: 'countdown',
      clearedMask: 0,
      cleared: 0,
      jumpsTotal: MOUNT_RACE_COURSE.jumps.length,
      goDeadlineMs: nowMs + (ev.countdownTicks / TICK_RATE) * 1000,
      deadlineMs: 0,
      timeLimitTicks: 0,
    };
  }
  if (ev.type === 'mountRaceStart') {
    const deadlineMs = nowMs + (ev.timeLimitTicks / TICK_RATE) * 1000;
    if (mirror && mirror.raceId === ev.raceId) {
      mirror.phase = 'racing';
      mirror.jumpsTotal = ev.jumpsTotal;
      mirror.timeLimitTicks = ev.timeLimitTicks;
      mirror.deadlineMs = deadlineMs;
      return mirror;
    }
    // A start without a preceding countdown mirror (late join / dropped
    // event): build the racing mirror straight from the start event.
    return {
      raceId: ev.raceId,
      phase: 'racing',
      clearedMask: 0,
      cleared: 0,
      jumpsTotal: ev.jumpsTotal,
      goDeadlineMs: 0,
      deadlineMs,
      timeLimitTicks: ev.timeLimitTicks,
    };
  }
  if (ev.type === 'mountRaceJump') {
    if (mirror && mirror.raceId === ev.raceId) {
      mirror.clearedMask = ev.mask;
      mirror.cleared = ev.cleared;
      mirror.jumpsTotal = ev.jumpsTotal;
    }
    return mirror;
  }
  if (ev.type === 'mountRaceEnd') {
    return mirror?.raceId === ev.raceId ? null : mirror;
  }
  return mirror;
}
