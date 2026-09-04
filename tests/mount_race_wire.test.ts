// Paired suite for src/net/mount_race_wire.ts: the `mntRace` self-snapshot
// decode and the four-event fold ClientWorld's mountRaceMirror runs on,
// extracted whole from src/net/online.ts at Masterwrought phase 12. Clock
// injected, so every deadline is pinned exactly.
import { describe, expect, it } from 'vitest';
import {
  applyMountRaceEventToMirror,
  decodeMountRaceView,
  type MountRaceMirror,
} from '../src/net/mount_race_wire';
import { MOUNT_RACE_COURSE } from '../src/sim/content/mounts';
import { type SimEvent, TICK_RATE } from '../src/sim/types';

const NOW = 10_000;

describe('decodeMountRaceView', () => {
  it('re-anchors the tick-relative row onto the injected clock', () => {
    expect(
      decodeMountRaceView(
        {
          raceId: 'r1',
          phase: 'racing',
          clearedMask: 5,
          cleared: 2,
          jumpsTotal: 6,
          goTicksLeft: 0,
          ticksLeft: TICK_RATE * 3,
          timeLimitTicks: TICK_RATE * 30,
        },
        NOW,
      ),
    ).toEqual({
      raceId: 'r1',
      phase: 'racing',
      clearedMask: 5,
      cleared: 2,
      jumpsTotal: 6,
      goDeadlineMs: NOW,
      deadlineMs: NOW + 3000,
      timeLimitTicks: TICK_RATE * 30,
    });
  });

  it('null clears the mirror, and malformed fields clamp rather than throw', () => {
    expect(decodeMountRaceView(null, NOW)).toBeNull();
    const decoded = decodeMountRaceView(
      { raceId: 7, phase: 'bogus', clearedMask: -3, cleared: 'x', goTicksLeft: -20 },
      NOW,
    );
    expect(decoded).toEqual({
      raceId: '7',
      phase: 'countdown',
      clearedMask: 0,
      cleared: 0,
      jumpsTotal: 0,
      goDeadlineMs: NOW,
      deadlineMs: NOW,
      timeLimitTicks: 0,
    });
  });
});

describe('applyMountRaceEventToMirror', () => {
  const countdown: SimEvent = {
    type: 'mountRaceCountdown',
    raceId: 'r1',
    countdownTicks: TICK_RATE * 3,
  } as SimEvent;
  const start: SimEvent = {
    type: 'mountRaceStart',
    raceId: 'r1',
    jumpsTotal: 6,
    timeLimitTicks: TICK_RATE * 30,
  } as SimEvent;

  it('walks countdown, start, jump, and end on one race, mutating in place mid-race', () => {
    const fromCountdown = applyMountRaceEventToMirror(null, countdown, NOW);
    expect(fromCountdown).toEqual({
      raceId: 'r1',
      phase: 'countdown',
      clearedMask: 0,
      cleared: 0,
      jumpsTotal: MOUNT_RACE_COURSE.jumps.length,
      goDeadlineMs: NOW + 3000,
      deadlineMs: 0,
      timeLimitTicks: 0,
    });
    const racing = applyMountRaceEventToMirror(fromCountdown, start, NOW + 3000);
    // The SAME object, mutated: a HUD strip holding the mirror sees the flip.
    expect(racing).toBe(fromCountdown);
    expect(racing).toMatchObject({
      phase: 'racing',
      jumpsTotal: 6,
      timeLimitTicks: TICK_RATE * 30,
      deadlineMs: NOW + 3000 + 30_000,
    });
    const jumped = applyMountRaceEventToMirror(
      racing,
      { type: 'mountRaceJump', raceId: 'r1', mask: 3, cleared: 2, jumpsTotal: 6 } as SimEvent,
      NOW + 5000,
    );
    expect(jumped).toBe(racing);
    expect(jumped).toMatchObject({ clearedMask: 3, cleared: 2 });
    expect(
      applyMountRaceEventToMirror(jumped, { type: 'mountRaceEnd', raceId: 'r1' } as SimEvent, NOW),
    ).toBeNull();
  });

  it('a start with no matching countdown builds the racing mirror outright', () => {
    const stale: MountRaceMirror = {
      raceId: 'other',
      phase: 'countdown',
      clearedMask: 0,
      cleared: 0,
      jumpsTotal: 1,
      goDeadlineMs: 1,
      deadlineMs: 0,
      timeLimitTicks: 0,
    };
    expect(applyMountRaceEventToMirror(stale, start, NOW)).toEqual({
      raceId: 'r1',
      phase: 'racing',
      clearedMask: 0,
      cleared: 0,
      jumpsTotal: 6,
      goDeadlineMs: 0,
      deadlineMs: NOW + 30_000,
      timeLimitTicks: TICK_RATE * 30,
    });
  });

  it('ignores another race id and every non-race event, returning the input untouched', () => {
    const live = applyMountRaceEventToMirror(null, countdown, NOW) as MountRaceMirror;
    const snapshot = { ...live };
    expect(
      applyMountRaceEventToMirror(
        live,
        { type: 'mountRaceJump', raceId: 'other', mask: 1, cleared: 1, jumpsTotal: 6 } as SimEvent,
        NOW,
      ),
    ).toBe(live);
    expect(
      applyMountRaceEventToMirror(live, { type: 'mountRaceEnd', raceId: 'other' } as SimEvent, NOW),
    ).toBe(live);
    expect(applyMountRaceEventToMirror(live, { type: 'levelup', level: 2 } as SimEvent, NOW)).toBe(
      live,
    );
    expect(live).toEqual(snapshot);
    expect(applyMountRaceEventToMirror(null, { type: 'levelup', level: 2 } as SimEvent, NOW)).toBe(
      null,
    );
  });
});
