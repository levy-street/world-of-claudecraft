import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopDisplayChange } from '../src/runtime';

// The shell's display change crosses the bridge into a module-scope latch that
// the renderer registers itself with later, so the order of those two events is
// the interesting part: this suite drives both, plus the payload validation, the
// feature check that keeps web and older shells untouched, and the unsubscribe.

const CHANGE: DesktopDisplayChange = { scaleFactor: 2 };

// Each boot is a fresh module registry, because the target latch is module state
// that lives for exactly one page session.
async function boot(options: { withDisplayChanged?: boolean } = {}) {
  vi.resetModules();
  const mod = await import('../src/game/desktop_display_change');
  const shell: { push: ((change: DesktopDisplayChange) => void) | null; unsubscribes: number } = {
    push: null,
    unsubscribes: 0,
  };
  const bridge = (options.withDisplayChanged === false
    ? {}
    : {
        onDisplayChanged: (callback: (change: DesktopDisplayChange) => void) => {
          shell.push = callback;
          return () => {
            shell.unsubscribes += 1;
          };
        },
      }) as unknown as DesktopBridge;
  const unsubscribe = mod.initDesktopDisplayChange(bridge);
  const push = (raw: unknown): void => {
    if (!shell.push) throw new Error('the bridge never received a subscription');
    shell.push(raw as DesktopDisplayChange);
  };
  return { mod, shell, unsubscribe, push };
}

describe('initDesktopDisplayChange', () => {
  it('is a no-op on a bridge without onDisplayChanged (older shell, or the web build)', async () => {
    const { shell, unsubscribe } = await boot({ withDisplayChanged: false });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(shell.push).toBeNull();
  });

  it('forwards a valid change to the registered target', async () => {
    const { mod, push } = await boot();
    const target = vi.fn();
    mod.setDisplayChangeTarget(target);
    push(CHANGE);
    expect(target).toHaveBeenCalledTimes(1);
    push({ scaleFactor: 1 });
    expect(target).toHaveBeenCalledTimes(2);
  });

  it('drops a change that arrives before the renderer registers, and forwards the next', async () => {
    // Deliberate: the renderer reads window.devicePixelRatio live when it is
    // constructed, so it self-heals, and there is nothing to replay into.
    const { mod, push } = await boot();
    push(CHANGE);
    const target = vi.fn();
    mod.setDisplayChangeTarget(target);
    expect(target).not.toHaveBeenCalled();
    push(CHANGE);
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('stops forwarding once the target is cleared', async () => {
    const { mod, push } = await boot();
    const target = vi.fn();
    mod.setDisplayChangeTarget(target);
    push(CHANGE);
    mod.setDisplayChangeTarget(null);
    push(CHANGE);
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('never forwards a payload without a finite scale factor', async () => {
    // The shell is an independently updated binary, so the field is re-checked
    // on this side of the boundary too. A non-finite scale factor is the arm
    // that matters: it would poison the renderer's pixel-ratio math outright.
    const { mod, push } = await boot();
    const target = vi.fn();
    mod.setDisplayChangeTarget(target);
    for (const raw of [
      null,
      undefined,
      'change',
      42,
      {},
      { displayId: 7 },
      { scaleFactor: '2' },
      { scaleFactor: null },
      { scaleFactor: Number.NaN },
      { scaleFactor: Number.POSITIVE_INFINITY },
      { scaleFactor: Number.NEGATIVE_INFINITY },
    ]) {
      push(raw);
    }
    expect(target).not.toHaveBeenCalled();
    // The rig itself is not vacuous: a well-formed payload still lands.
    push(CHANGE);
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('accepts a payload carrying extra fields but forwards none of them', async () => {
    // A future or tampered shell sending more than the one whitelisted field
    // must not be able to get that data across: the target takes no arguments,
    // so the extras have nowhere to go even when the payload is otherwise valid.
    const { mod, push } = await boot();
    const target = vi.fn();
    mod.setDisplayChangeTarget(target);
    push({ scaleFactor: 1.5, displayId: 2528732444, label: 'Built-in Retina Display' });
    expect(target).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledWith();
  });

  it('returns the shell unsubscribe hook', async () => {
    const { shell, unsubscribe } = await boot();
    unsubscribe();
    expect(shell.unsubscribes).toBe(1);
  });

  it('clears a stale target from the previous session on init', async () => {
    // initDesktopDisplayChange runs once per page session; a target latched by a
    // previous one must not survive into the next.
    const { mod, push } = await boot();
    const stale = vi.fn();
    mod.setDisplayChangeTarget(stale);
    const bridge = { onDisplayChanged: () => () => {} } as unknown as DesktopBridge;
    mod.initDesktopDisplayChange(bridge);
    push(CHANGE);
    expect(stale).not.toHaveBeenCalled();
  });
});
