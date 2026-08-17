import { describe, expect, it } from 'vitest';
import {
  createPowerSave,
  POWER_SAVE_IDLE_MS,
  POWER_SAVE_MIN_PING_INTERVAL_MS,
} from '../electron/power_save.cjs';

// The display-sleep lease (electron/power_save.cjs) is pure and injected, so the
// whole state machine runs here without an Electron runtime: the blocker, the
// timers, and the clock are all fakes, and every transition is asserted through
// what they were asked to do. That matters because the real failure modes are
// silent: a lease never released keeps a laptop's display awake all night, and a
// lease never taken lets the display sleep in the middle of a controller session.

interface ArmedTimer {
  handle: number;
  callback: () => void;
  delayMs: number;
}

function createRig(options: { idleMs?: number; minPingIntervalMs?: number } = {}) {
  const started: string[] = [];
  const issued: number[] = [];
  const stopped: number[] = [];
  const armed: ArmedTimer[] = [];
  const cleared: number[] = [];
  const state = { now: 1_000_000, nextBlockerId: 40, nextHandle: 500, startFails: false };
  const powerSave = createPowerSave({
    start: (type: string) => {
      started.push(type);
      if (state.startFails) throw new Error('powerSaveBlocker unavailable');
      state.nextBlockerId += 1;
      issued.push(state.nextBlockerId);
      return state.nextBlockerId;
    },
    stop: (id: number) => {
      stopped.push(id);
      return true;
    },
    setTimer: (callback: () => void, delayMs: number) => {
      state.nextHandle += 1;
      armed.push({ handle: state.nextHandle, callback, delayMs });
      return state.nextHandle;
    },
    clearTimer: (handle: unknown) => {
      cleared.push(handle as number);
    },
    now: () => state.now,
    ...options,
  });
  return { powerSave, started, issued, stopped, armed, cleared, state };
}

describe('power save lease (electron/power_save.cjs)', () => {
  it('pins the idle and rate-limit intervals to their literals', () => {
    // Both are felt by the player: the idle window is how long a walked-away
    // controller session keeps the display awake, and the floor is how much IPC
    // the renderer's input loop is allowed to turn into work.
    expect(POWER_SAVE_IDLE_MS).toBe(60000);
    expect(POWER_SAVE_MIN_PING_INTERVAL_MS).toBe(10000);
  });

  it('takes the display-sleep blocker on the first activity ping', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    // The blocker TYPE is the contract with Electron: 'prevent-app-suspension'
    // would keep the process alive without keeping the screen on, which is the
    // one thing this feature exists to do.
    expect(rig.started).toEqual(['prevent-display-sleep']);
    expect(rig.armed).toHaveLength(1);
    expect(rig.armed[0].delayMs).toBe(POWER_SAVE_IDLE_MS);
    expect(rig.stopped).toEqual([]);
  });

  it('ignores activity while the window is hidden', () => {
    const rig = createRig();
    rig.powerSave.setHidden(true);
    rig.powerSave.notifyActivity();
    rig.powerSave.notifyActivity();
    expect(rig.started).toEqual([]);
    expect(rig.armed).toEqual([]);
  });

  it('rate limits a ping inside the floor to a complete no-op', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    rig.state.now += POWER_SAVE_MIN_PING_INTERVAL_MS - 1;
    rig.powerSave.notifyActivity();
    // Not just "no second start": a refused ping must not re-arm either, or the
    // release would be pushed out by every frame of stick drift and the lease
    // would never expire.
    expect(rig.started).toHaveLength(1);
    expect(rig.armed).toHaveLength(1);
    expect(rig.cleared).toEqual([]);
  });

  it('accepts a ping at exactly the floor and re-arms the release', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    rig.state.now += POWER_SAVE_MIN_PING_INTERVAL_MS;
    rig.powerSave.notifyActivity();
    // Still one claim (it was never dropped), but the idle countdown restarts:
    // the old timer is cleared by handle and a fresh one armed.
    expect(rig.started).toHaveLength(1);
    expect(rig.cleared).toEqual([rig.armed[0].handle]);
    expect(rig.armed).toHaveLength(2);
    expect(rig.armed[1].delayMs).toBe(POWER_SAVE_IDLE_MS);
  });

  it('releases the claim it recorded when the idle timer fires', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    rig.armed[0].callback();
    // The id handed back by start(), not a hardcoded one: stopping the wrong id
    // would release some other component's claim and leave ours held forever.
    expect(rig.stopped).toEqual([rig.issued[0]]);
  });

  it('takes a fresh claim on the next ping after an idle release', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    rig.armed[0].callback();
    // Immediately, without waiting out the floor: the rate limit guards a LIVE
    // claim, so once the claim is gone the next real activity must be able to
    // re-take it rather than leaving the display unprotected mid-session.
    rig.powerSave.notifyActivity();
    expect(rig.started).toEqual(['prevent-display-sleep', 'prevent-display-sleep']);
    expect(rig.issued[1]).not.toBe(rig.issued[0]);
    expect(rig.armed).toHaveLength(2);
  });

  it('releases immediately when the window goes hidden, and clears the pending timer', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    rig.powerSave.setHidden(true);
    expect(rig.stopped).toEqual([rig.issued[0]]);
    expect(rig.cleared).toEqual([rig.armed[0].handle]);
    // And the timer that was armed must not be able to act later either.
    rig.armed[0].callback();
    expect(rig.stopped).toEqual([rig.issued[0]]);
  });

  it('claims nothing on un-hide until real activity arrives', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    rig.powerSave.setHidden(true);
    rig.powerSave.setHidden(false);
    expect(rig.started).toHaveLength(1);
    rig.powerSave.notifyActivity();
    expect(rig.started).toEqual(['prevent-display-sleep', 'prevent-display-sleep']);
    expect(rig.armed).toHaveLength(2);
  });

  it('releases on shutdown and stays terminal afterwards', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    rig.powerSave.shutdown();
    expect(rig.stopped).toEqual([rig.issued[0]]);
    // Late window events during teardown must not re-arm anything in a process
    // that is on its way out.
    rig.powerSave.setHidden(false);
    rig.powerSave.notifyActivity();
    rig.powerSave.shutdown();
    expect(rig.started).toHaveLength(1);
    expect(rig.armed).toHaveLength(1);
    expect(rig.stopped).toEqual([rig.issued[0]]);
  });

  it('never stops the same claim twice', () => {
    const rig = createRig();
    rig.powerSave.notifyActivity();
    rig.armed[0].callback();
    rig.powerSave.setHidden(true);
    rig.powerSave.setHidden(false);
    rig.powerSave.shutdown();
    // Stopping an already-released id would drop a claim a later start() owns.
    expect(rig.stopped).toEqual([rig.issued[0]]);
  });

  it('stays unheld and unarmed when the blocker cannot start', () => {
    const rig = createRig();
    rig.state.startFails = true;
    rig.powerSave.notifyActivity();
    expect(rig.started).toHaveLength(1);
    expect(rig.armed).toEqual([]);
    expect(rig.stopped).toEqual([]);
    // A platform that refuses once must still be retried, and the retry must be
    // a full claim rather than a timer armed over nothing.
    rig.state.startFails = false;
    rig.state.now += POWER_SAVE_MIN_PING_INTERVAL_MS;
    rig.powerSave.notifyActivity();
    expect(rig.started).toHaveLength(2);
    expect(rig.armed).toHaveLength(1);
  });

  it('refuses a non-positive or non-finite interval at construction', () => {
    // One case per field per failure mode: a zero (or negative) idle window
    // would re-arm a timer that fires immediately, and a non-finite one arms a
    // timer that never fires, so neither may become a runtime to diagnose.
    expect(() => createRig({ idleMs: 0 })).toThrow(TypeError);
    expect(() => createRig({ idleMs: -1 })).toThrow(TypeError);
    expect(() => createRig({ idleMs: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => createRig({ idleMs: Number.NaN })).toThrow(TypeError);
    expect(() => createRig({ minPingIntervalMs: 0 })).toThrow(TypeError);
    expect(() => createRig({ minPingIntervalMs: -1 })).toThrow(TypeError);
    expect(() => createRig({ minPingIntervalMs: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => createRig({ minPingIntervalMs: Number.NaN })).toThrow(TypeError);
    // The defaults themselves are valid, so the guard cannot be satisfied by
    // refusing everything.
    expect(() => createRig()).not.toThrow();
  });

  it('honors injected intervals rather than the defaults', () => {
    const rig = createRig({ idleMs: 250, minPingIntervalMs: 50 });
    rig.powerSave.notifyActivity();
    expect(rig.armed[0].delayMs).toBe(250);
    rig.state.now += 49;
    rig.powerSave.notifyActivity();
    expect(rig.armed).toHaveLength(1);
    rig.state.now += 1;
    rig.powerSave.notifyActivity();
    expect(rig.armed).toHaveLength(2);
  });

  it('treats only literal true as hidden: a truthy non-boolean releases nothing', () => {
    // The production caller derives a real boolean, so this is boundary
    // strictness: a permissive coercion would let a junk value release a live
    // claim (or latch hidden and mute every later ping).
    const rig = createRig();
    rig.powerSave.notifyActivity();
    expect(rig.started).toHaveLength(1);
    rig.powerSave.setHidden(1 as unknown as boolean);
    expect(rig.stopped).toHaveLength(0);
    // hidden never latched: the next spaced ping still lands and re-arms
    rig.state.now += POWER_SAVE_MIN_PING_INTERVAL_MS;
    rig.powerSave.notifyActivity();
    expect(rig.armed).toHaveLength(2);
  });
});
