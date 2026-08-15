// The throttled gamepad-activity notify: the renderer half of the desktop
// shell's display-sleep blocker. A permanent no-op off-desktop (and on shells
// predating the channel), one bridge call per 30 s window during active input,
// and the same total-failure shape as the other fire-and-forget crossings: a
// broken channel must never surface, and must never become a per-frame retry
// storm (the throttle stamp advances even when the call throws).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createGamepadActivityNotifier,
  GAMEPAD_ACTIVITY_NOTIFY_INTERVAL_MS,
} from '../src/game/gamepad_activity_notify';
import type { DesktopBridge } from '../src/runtime';

// Only the member this module reads; the rest of DesktopBridge is irrelevant
// here, so the double is cast at the one boundary instead of stubbing 20
// methods.
function fakeBridge(members: Partial<DesktopBridge>): DesktopBridge {
  return members as DesktopBridge;
}

describe('gamepad_activity_notify: throttled shell notify', () => {
  it('pins the interval to a literal 30 s (the shell contract, not a derived number)', () => {
    expect(GAMEPAD_ACTIVITY_NOTIFY_INTERVAL_MS).toBe(30000);
  });

  it('fires once, suppresses until the interval elapses, then fires again', () => {
    const notifyGamepadActivity = vi.fn();
    let now = 1_000_000;
    const notify = createGamepadActivityNotifier(fakeBridge({ notifyGamepadActivity }), () => now);

    notify();
    expect(notifyGamepadActivity).toHaveBeenCalledTimes(1);
    // the very next frame is the case that matters: the poll calls this ~60x/s
    now += 16;
    notify();
    now += 29_999 - 16;
    notify();
    expect(notifyGamepadActivity, 'still inside the window at 29999 ms').toHaveBeenCalledTimes(1);
    now = 1_000_000 + GAMEPAD_ACTIVITY_NOTIFY_INTERVAL_MS;
    notify();
    expect(notifyGamepadActivity).toHaveBeenCalledTimes(2);
    // and the window restarts from the notify that just fired
    now += GAMEPAD_ACTIVITY_NOTIFY_INTERVAL_MS - 1;
    notify();
    expect(notifyGamepadActivity).toHaveBeenCalledTimes(2);
    now += 1;
    notify();
    expect(notifyGamepadActivity).toHaveBeenCalledTimes(3);
  });

  it('is a permanent no-op without the bridge method (browsers, mobile, old shells)', () => {
    let now = 0;
    for (const bridge of [
      null,
      undefined,
      fakeBridge({}),
      { notifyGamepadActivity: true } as unknown as DesktopBridge,
    ]) {
      const notify = createGamepadActivityNotifier(bridge, () => now);
      for (let i = 0; i < 3; i++) {
        now += GAMEPAD_ACTIVITY_NOTIFY_INTERVAL_MS;
        expect(() => notify()).not.toThrow();
      }
    }
  });

  it('survives a synchronous throw and swallows a rejection, and still throttles', async () => {
    let now = 0;
    const calls: number[] = [];
    const thrower = createGamepadActivityNotifier(
      fakeBridge({
        notifyGamepadActivity: () => {
          calls.push(now);
          throw new Error('render frame was disposed');
        },
      }),
      () => now,
    );
    expect(() => thrower()).not.toThrow();
    now += 1;
    thrower();
    // a broken channel must not turn into a per-frame retry storm
    expect(calls).toEqual([0]);

    const rejecting = createGamepadActivityNotifier(
      fakeBridge({
        notifyGamepadActivity: (() => Promise.reject(new Error('ipc gone'))) as () => void,
      }),
      () => now,
    );
    expect(() => rejecting()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('calls the bridge as its receiver (a preload object using `this`)', () => {
    const now = 0;
    const bridge = {
      hits: 0,
      notifyGamepadActivity(this: { hits: number }): void {
        this.hits += 1;
      },
    } as unknown as DesktopBridge & { hits: number };
    const notify = createGamepadActivityNotifier(bridge, () => now);
    notify();
    expect(bridge.hits).toBe(1);
  });

  it('is wired into the gamepad poll callbacks in main.ts (textual composition pin)', () => {
    // The module suite proves the throttle in isolation; this pin proves the
    // composition root actually hands the poll the notifier (the house
    // pattern for desktop wiring pins).
    const mainSource = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');
    expect(mainSource).toContain('onActivity: createGamepadActivityNotifier(desktopBridge()),');
  });
});
