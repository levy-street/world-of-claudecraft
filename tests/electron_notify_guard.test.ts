import { describe, expect, it } from 'vitest';
import {
  createNotifyGuard,
  MAX_NOTIFICATIONS_PER_SESSION,
  NOTIFY_MIN_INTERVAL_MS,
} from '../electron/notify_guard.cjs';

// The notification rate limit (electron/notify_guard.cjs) is pure and injected,
// so the whole window boundary runs here without an Electron runtime. What it
// protects is not in the game's window: a lost floor turns one noisy source into
// a stream of OS toasts the player dismisses outside the app, and a floor that
// never reopens silently drops every notification after the first.

function createRig(options: { minIntervalMs?: number; sessionMax?: number } = {}) {
  const state = { now: 1_000_000 };
  const guard = createNotifyGuard({ now: () => state.now, ...options });
  return { guard, state };
}

describe('notification rate limit (electron/notify_guard.cjs)', () => {
  it('pins the minimum interval to its literal', () => {
    // The floor is felt by the player: it is how often the shell is allowed to
    // reach the operating system's notification surface for one kind.
    expect(NOTIFY_MIN_INTERVAL_MS).toBe(10000);
  });

  it('allows the first notification of a kind', () => {
    const rig = createRig();
    expect(rig.guard.allow('update-ready')).toBe(true);
  });

  it('refuses one millisecond inside the window and allows exactly at it', () => {
    // The comparison is >= the floor, not > it: an off-by-one the other way
    // would hold a notification back for a whole extra window.
    const rig = createRig();
    expect(rig.guard.allow('update-ready')).toBe(true);
    rig.state.now += NOTIFY_MIN_INTERVAL_MS - 1;
    expect(rig.guard.allow('update-ready')).toBe(false);

    const other = createRig();
    expect(other.guard.allow('update-ready')).toBe(true);
    other.state.now += NOTIFY_MIN_INTERVAL_MS;
    expect(other.guard.allow('update-ready')).toBe(true);
  });

  it('does not move the stamp on a refused call', () => {
    // A refusal that stamped would let a source asking inside the floor push its
    // own window out forever, so it would never notify again.
    const rig = createRig();
    expect(rig.guard.allow('update-ready')).toBe(true);
    rig.state.now += 9000;
    expect(rig.guard.allow('update-ready')).toBe(false);
    rig.state.now += 1000;
    expect(rig.guard.allow('update-ready')).toBe(true);
  });

  it('paces each kind on its own window', () => {
    // A shared window would let a repeating update notice mute a party invite
    // the player is actually waiting on.
    const rig = createRig();
    expect(rig.guard.allow('update-ready')).toBe(true);
    expect(rig.guard.allow('party-invite')).toBe(true);
    rig.state.now += 1;
    expect(rig.guard.allow('update-ready')).toBe(false);
    expect(rig.guard.allow('party-invite')).toBe(false);
    rig.state.now += NOTIFY_MIN_INTERVAL_MS;
    expect(rig.guard.allow('party-invite')).toBe(true);
    expect(rig.guard.allow('update-ready')).toBe(true);
  });

  it('honors an injected interval rather than the default', () => {
    const rig = createRig({ minIntervalMs: 250 });
    expect(rig.guard.allow('update-ready')).toBe(true);
    rig.state.now += 249;
    expect(rig.guard.allow('update-ready')).toBe(false);
    rig.state.now += 1;
    expect(rig.guard.allow('update-ready')).toBe(true);
  });

  it('refuses a non-string kind without taking a window', () => {
    // Fail closed: the handler validates the kind first, so anything else
    // reaching here is a mistake, and a junk key must not take a window of its
    // own or answer yes.
    const rig = createRig();
    expect(rig.guard.allow(42)).toBe(false);
    expect(rig.guard.allow(null)).toBe(false);
    expect(rig.guard.allow(undefined)).toBe(false);
    expect(rig.guard.allow({ kind: 'update-ready' })).toBe(false);
    // No cross-effect: a real kind still gets its first window immediately
    // after the junk refusals, which fails if any of them stamped anything.
    expect(rig.guard.allow('update-ready')).toBe(true);
  });

  it('refuses while an injected clock runs backwards past a stamp (fail-safe, not fail-open)', () => {
    // A large backwards step (NTP correction, resume weirdness) makes the
    // delta negative, which reads as inside the window: the kind stays muted
    // until the clock re-passes its stamp. For a best-effort surface the safe
    // failure is silence, never a burst; this pins that choice.
    const rig = createRig();
    expect(rig.guard.allow('update-ready')).toBe(true);
    rig.state.now -= NOTIFY_MIN_INTERVAL_MS * 5;
    expect(rig.guard.allow('update-ready')).toBe(false);
    rig.state.now += NOTIFY_MIN_INTERVAL_MS * 6;
    expect(rig.guard.allow('update-ready')).toBe(true);
  });

  it('pins the session cap to its literal', () => {
    // Generous on purpose: the per-kind floor already paces legitimate use, so
    // no real session should ever reach this. It exists for the ceiling on
    // clamped attacker-influenced text an unfocused player can be shown at all.
    expect(MAX_NOTIFICATIONS_PER_SESSION).toBe(50);
  });

  it('silently drops every notification once the session cap is reached', () => {
    // Same posture as the mirrored-console-line cap: the surface is bounded per
    // session, and reaching the bound is terminal rather than a window that
    // reopens (a reopening cap would just be a slower drip of the same spam).
    const rig = createRig();
    for (let shown = 0; shown < MAX_NOTIFICATIONS_PER_SESSION; shown += 1) {
      expect(rig.guard.allow('update-ready'), `notification ${shown} is under the cap`).toBe(true);
      rig.state.now += NOTIFY_MIN_INTERVAL_MS;
    }
    expect(rig.guard.allow('update-ready')).toBe(false);
    // Terminal for the whole session: no amount of waiting reopens it.
    rig.state.now += NOTIFY_MIN_INTERVAL_MS * 100;
    expect(rig.guard.allow('update-ready')).toBe(false);
  });

  it('counts the cap per session, not per kind', () => {
    // A per-kind cap would multiply the ceiling by the kind whitelist; the cap
    // exists to bound the OS surface as a whole, so every kind draws from it.
    const rig = createRig({ sessionMax: 2 });
    expect(rig.guard.allow('update-ready')).toBe(true);
    expect(rig.guard.allow('party-invite')).toBe(true);
    // A third kind with a completely fresh per-kind window is still refused.
    expect(rig.guard.allow('party-invite-2')).toBe(false);
    expect(rig.guard.allow('update-ready')).toBe(false);
  });

  it('does not spend the cap on refused calls', () => {
    // A refusal inside the per-kind floor (or a junk kind) never showed
    // anything, so counting it would let a noisy source burn the session cap
    // without a single toast reaching the player.
    const rig = createRig({ sessionMax: 2 });
    expect(rig.guard.allow('update-ready')).toBe(true);
    for (let refused = 0; refused < 10; refused += 1) {
      expect(rig.guard.allow('update-ready')).toBe(false);
    }
    expect(rig.guard.allow(42)).toBe(false);
    rig.state.now += NOTIFY_MIN_INTERVAL_MS;
    expect(rig.guard.allow('update-ready')).toBe(true);
    rig.state.now += NOTIFY_MIN_INTERVAL_MS;
    expect(rig.guard.allow('update-ready')).toBe(false);
  });

  it('refuses a non-positive or non-integer session cap at construction', () => {
    // Zero or negative would silence the surface entirely, and a fractional cap
    // is a wiring mistake; both fail loudly like the interval guard.
    expect(() => createRig({ sessionMax: 0 })).toThrow(TypeError);
    expect(() => createRig({ sessionMax: -1 })).toThrow(TypeError);
    expect(() => createRig({ sessionMax: 2.5 })).toThrow(TypeError);
    expect(() => createRig({ sessionMax: Number.NaN })).toThrow(TypeError);
    expect(() => createRig({ sessionMax: '50' as unknown as number })).toThrow(/createNotifyGuard/);
    // The default is valid, so the guard cannot be satisfied by refusing
    // everything.
    expect(() => createRig({ sessionMax: 1 })).not.toThrow();
  });

  it('refuses a non-positive, non-finite or non-numeric interval at construction', () => {
    // Zero or negative would disable the rate limit this module exists to be,
    // and a non-finite one would refuse every notification forever, so neither
    // may become a runtime to diagnose.
    expect(() => createRig({ minIntervalMs: 0 })).toThrow(TypeError);
    expect(() => createRig({ minIntervalMs: -5 })).toThrow(TypeError);
    expect(() => createRig({ minIntervalMs: Number.NaN })).toThrow(TypeError);
    expect(() => createRig({ minIntervalMs: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => createRig({ minIntervalMs: '10' as unknown as number })).toThrow(TypeError);
    expect(() => createRig({ minIntervalMs: 0 })).toThrow(/createNotifyGuard/);
    // The defaults are valid, so the guard cannot be satisfied by refusing
    // everything.
    expect(() => createRig()).not.toThrow();
  });

  it('refuses a clock that is not a function at construction', () => {
    expect(() => createNotifyGuard({ now: undefined as unknown as () => number })).toThrow(
      TypeError,
    );
    expect(() => createNotifyGuard({ now: 0 as unknown as () => number })).toThrow(
      /createNotifyGuard/,
    );
  });
});
