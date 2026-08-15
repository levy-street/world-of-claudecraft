// Tells the desktop shell that a gamepad is in use, so its power-save arm never
// blanks the display mid-session.
//
// The OS counts keyboard and mouse input for us (those events reach the window
// through the system), but a pad is POLLED inside the renderer: to the OS a
// pad-only session looks like an untouched window, and the screensaver or
// display sleep can fire in the middle of a fight. The renderer therefore has
// to say so out loud, which is what the shell's notifyGamepadActivity is for.
//
// Throttled, because the caller is the per-frame poll: an unthrottled notify
// would be an IPC message 60+ times a second for a whole session. One message
// per 30 s keeps any OS idle timer (the shortest common display-sleep setting
// is a minute) from ever expiring while the pad is moving, at a cost of two
// numbers and a comparison per frame.
//
// Lives in src/game beside the other bridge consumers so main.ts stays a
// firewall (composition only) and the throttle is unit-testable with a fake
// clock, without a live shell or a real pad.

import type { DesktopBridge } from '../runtime';

/** Minimum gap between two notifies. Comfortably under the shortest common OS
 *  display-sleep setting, and long enough that the IPC cost is unmeasurable. */
export const GAMEPAD_ACTIVITY_NOTIFY_INTERVAL_MS = 30000;

/**
 * Build the throttled notifier the gamepad poll calls on real input.
 *
 * Returns a permanent no-op when the installed shell has no notify method (an
 * older desktop build, the mobile shells, and every browser), so the caller has
 * no bridge-capability branch of its own and the idle path stays one call to an
 * empty function.
 *
 * Total, like the other bridge pushes: a torn-down IPC channel that throws
 * synchronously and a rejected call both leave the frame loop undisturbed, and
 * the throttle still advances so a broken channel cannot turn into a per-frame
 * retry storm.
 */
export function createGamepadActivityNotifier(
  bridge: DesktopBridge | null | undefined,
  now: () => number = () => performance.now(),
): () => void {
  const notify = bridge?.notifyGamepadActivity;
  if (typeof notify !== 'function') return () => {};
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - last < GAMEPAD_ACTIVITY_NOTIFY_INTERVAL_MS) return;
    last = at;
    try {
      // Promise.resolve covers a shell whose notify answers a promise; the
      // declared return is void, so without the catch a rejection from such a
      // shell would surface as an unhandled rejection.
      void Promise.resolve(notify.call(bridge)).catch(() => {});
    } catch {
      /* the shell's channel is gone; the pad still drives the game */
    }
  };
}
