// src/game/desktop_host_essentials.ts: the renderer-side probe that caches the
// shell's host facts for the perf reporter. Its job is to be harmless (never
// throw, never block, never fire at boot) and to NARROW whatever the bridge
// answered, so a buggy or compromised shell cannot inject keys into a payload
// posted to an endpoint that accepts anonymous reports.

import { describe, expect, it, vi } from 'vitest';
import {
  APP_MEM_MAX_MB,
  createHostEssentialsProbe,
  HOST_ESSENTIALS_FIRST_DELAY_MS,
  HOST_ESSENTIALS_REFRESH_MS,
  HOST_MEM_MAX_MB,
  hostEssentialsPayloadFields,
  narrowHostEssentials,
} from '../src/game/desktop_host_essentials';
import type { DesktopHostEssentials as HostEssentials } from '../src/runtime';

const FULL = {
  hostMemTotalMb: 16384,
  hostMemFreeMb: 4992,
  appWorkingSetMb: 1550,
  appRendererWsMb: 900,
  appGpuWsMb: 300,
  hostOnBattery: false,
  hostPowerPlan: 'high_performance',
  hostPowerMode: 'better_performance',
  hostHags: true,
  hostGameMode: false,
} as const satisfies HostEssentials;

/** A manual timer seam, so nothing here waits on a real clock. */
function fakeTimers() {
  const queue: { fn: () => void; ms: number }[] = [];
  return {
    queue,
    setTimer: (fn: () => void, ms: number) => {
      queue.push({ fn, ms });
      return queue.length;
    },
    clearTimer: (handle: unknown) => {
      const index = (handle as number) - 1;
      if (queue[index]) queue[index] = { fn: () => {}, ms: -1 };
    },
    /** Run the last-scheduled callback. */
    fire: () => {
      const next = queue[queue.length - 1];
      next?.fn();
    },
  };
}

describe('narrowHostEssentials', () => {
  it('passes a well-formed snapshot through unchanged', () => {
    expect(narrowHostEssentials(FULL)).toEqual(FULL);
  });

  it('never copies an unknown key through', () => {
    const narrowed = narrowHostEssentials({
      ...FULL,
      machineName: 'PLAYER-PC',
      hostPowerPlanGuid: '11111111-2222-3333-4444-555555555555',
    });
    expect(narrowed).toEqual(FULL);
    expect(Object.keys(narrowed ?? {})).not.toContain('machineName');
    expect(Object.keys(narrowed ?? {})).not.toContain('hostPowerPlanGuid');
  });

  it('refuses an out-of-vocabulary enum, a raw GUID included', () => {
    const narrowed = narrowHostEssentials({
      ...FULL,
      hostPowerPlan: '381b4222-f694-41f0-9685-ff5bb260df2e',
      hostPowerMode: 'turbo',
    });
    expect(narrowed?.hostPowerPlan).toBe('');
    expect(narrowed?.hostPowerMode).toBe('');
  });

  it('refuses a non-boolean for every boolean field', () => {
    const narrowed = narrowHostEssentials({
      ...FULL,
      hostOnBattery: 'true',
      hostHags: 1,
      hostGameMode: null,
    });
    expect(narrowed?.hostOnBattery).toBeNull();
    expect(narrowed?.hostHags).toBeNull();
    expect(narrowed?.hostGameMode).toBeNull();
  });

  it('refuses a negative, NaN, infinite or non-numeric megabyte figure and clamps a huge one', () => {
    const narrowed = narrowHostEssentials({
      ...FULL,
      hostMemTotalMb: Number.POSITIVE_INFINITY,
      hostMemFreeMb: -1,
      appWorkingSetMb: Number.NaN,
      appRendererWsMb: '900',
      appGpuWsMb: 999_999_999,
    });
    expect(narrowed?.hostMemTotalMb).toBeNull();
    expect(narrowed?.hostMemFreeMb).toBeNull();
    expect(narrowed?.appWorkingSetMb).toBeNull();
    expect(narrowed?.appRendererWsMb).toBeNull();
    // The process figures clamp at their OWN, tighter ceiling, and a host figure
    // at the host one: two ceilings, never one shared.
    expect(narrowed?.appGpuWsMb).toBe(APP_MEM_MAX_MB);
    expect(narrowHostEssentials({ ...FULL, hostMemTotalMb: 999_999_999 })?.hostMemTotalMb).toBe(
      HOST_MEM_MAX_MB,
    );
  });

  it('answers null for anything that is not an object', () => {
    for (const value of [null, undefined, 7, 'x', [FULL]]) {
      expect(narrowHostEssentials(value)).toBeNull();
    }
  });
});

describe('hostEssentialsPayloadFields', () => {
  it('omits absent fields rather than sending them as null', () => {
    const fields = hostEssentialsPayloadFields({
      ...FULL,
      hostMemFreeMb: null,
      hostHags: null,
      hostPowerMode: '',
    });
    expect('hostMemFreeMb' in fields).toBe(false);
    expect('hostHags' in fields).toBe(false);
    // '' IS a vocabulary member ("unknown"), so it is sent: the server stores
    // the same value either way, and omitting it would lose the distinction
    // between a shell that looked and one that has no such field at all.
    expect(fields.hostPowerMode).toBe('');
    expect(fields.hostOnBattery).toBe(false);
  });

  it('is empty for a probe that has no value', () => {
    expect(hostEssentialsPayloadFields(null)).toEqual({});
  });
});

describe('createHostEssentialsProbe', () => {
  it('reads nothing at start() and nothing at all without a bridge', () => {
    const timers = fakeTimers();
    const probe = createHostEssentialsProbe({ bridge: null, ...timers });
    probe.start();
    expect(probe.value()).toBeNull();
    // One timer armed, nothing invoked yet: never on the boot-critical path.
    expect(timers.queue).toHaveLength(1);
    expect(timers.queue[0].ms).toBe(HOST_ESSENTIALS_FIRST_DELAY_MS);
    timers.fire();
    expect(probe.value()).toBeNull();
    // No bridge means no re-arm: a missing method cannot appear mid-session.
    expect(timers.queue).toHaveLength(1);
  });

  it('caches the first settled reading and re-arms on the refresh cadence', async () => {
    const timers = fakeTimers();
    const getHostEssentials = vi.fn(async () => FULL);
    const probe = createHostEssentialsProbe({ getHostEssentials, ...timers });
    probe.start();
    expect(probe.value()).toBeNull();
    timers.fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(probe.value()).toEqual(FULL);
    expect(timers.queue[1].ms).toBe(HOST_ESSENTIALS_REFRESH_MS);
    // Shorter than the reporter's 5-minute repeat, so every beacon after the
    // first sees a reading taken inside its own interval.
    expect(HOST_ESSENTIALS_REFRESH_MS).toBeLessThan(5 * 60_000);
  });

  it('keeps the previous reading when a later fetch fails', async () => {
    const timers = fakeTimers();
    let call = 0;
    const getHostEssentials = vi.fn(async () => {
      call += 1;
      if (call === 1) return FULL;
      throw new Error('shell went away');
    });
    const probe = createHostEssentialsProbe({ getHostEssentials, ...timers });
    probe.start();
    timers.fire();
    await Promise.resolve();
    await Promise.resolve();
    timers.fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(probe.value()).toEqual(FULL);
  });

  it('never throws when the bridge throws synchronously', () => {
    const timers = fakeTimers();
    const probe = createHostEssentialsProbe({
      getHostEssentials: () => {
        throw new Error('bridge is gone');
      },
      ...timers,
    });
    probe.start();
    expect(() => timers.fire()).not.toThrow();
    expect(probe.value()).toBeNull();
  });

  it('stop() cancels the timer and keeps the last value readable', async () => {
    const timers = fakeTimers();
    const getHostEssentials = vi.fn(async () => FULL);
    const probe = createHostEssentialsProbe({ getHostEssentials, ...timers });
    probe.start();
    timers.fire();
    await Promise.resolve();
    await Promise.resolve();
    probe.stop();
    const before = getHostEssentials.mock.calls.length;
    timers.fire();
    expect(getHostEssentials.mock.calls.length).toBe(before);
    expect(probe.value()).toEqual(FULL);
  });

  it('start() is idempotent', () => {
    const timers = fakeTimers();
    const probe = createHostEssentialsProbe({ bridge: null, ...timers });
    probe.start();
    probe.start();
    expect(timers.queue).toHaveLength(1);
  });
});
