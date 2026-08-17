import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopPresentationState } from '../src/runtime';

// The hidden latch is module state per page session, so every case boots a fresh
// module registry. What matters beyond the flip itself is that the latch is read
// at CHECK time: the frame loop samples it every frame, so a push that lands
// after init must be visible to the very next read.

async function boot(options: { withPresentation?: boolean } = {}) {
  vi.resetModules();
  const presentation = await import('../src/game/desktop_presentation');
  const shell: {
    push: ((state: DesktopPresentationState) => void) | null;
    unsubscribes: number;
  } = { push: null, unsubscribes: 0 };
  const bridge = (options.withPresentation === false
    ? {}
    : {
        onPresentationChanged: (callback: (state: DesktopPresentationState) => void) => {
          shell.push = callback;
          return () => {
            shell.unsubscribes += 1;
          };
        },
      }) as unknown as DesktopBridge;
  const unsubscribe = presentation.initDesktopPresentation(bridge);
  const push = (raw: unknown): void => {
    if (!shell.push) throw new Error('the bridge never received a subscription');
    shell.push(raw as DesktopPresentationState);
  };
  return { presentation, shell, unsubscribe, push };
}

describe('initDesktopPresentation', () => {
  it('starts unhidden and latches a push in both directions', async () => {
    const { presentation, push } = await boot();
    expect(presentation.desktopPresentationHidden()).toBe(false);
    push({ hidden: true });
    expect(presentation.desktopPresentationHidden()).toBe(true);
    push({ hidden: false });
    expect(presentation.desktopPresentationHidden()).toBe(false);
    push({ hidden: true });
    expect(presentation.desktopPresentationHidden()).toBe(true);
  });

  it('is sampled at check time, so a flip after init reaches the next read', async () => {
    const { presentation, push } = await boot();
    // Read once before the push: the frame loop calls this every frame, and a
    // caller that cached this first false would never see the window hide.
    expect(presentation.desktopPresentationHidden()).toBe(false);
    push({ hidden: true });
    expect(presentation.desktopPresentationHidden()).toBe(true);
  });

  it('is a no-op on a bridge without onPresentationChanged (older shell, or the web build)', async () => {
    const { presentation, unsubscribe, shell } = await boot({ withPresentation: false });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(presentation.desktopPresentationHidden()).toBe(false);
    expect(shell.push).toBeNull();
  });

  it('drops a malformed payload instead of coercing it, in both latch states', async () => {
    const { presentation, push } = await boot();
    // From the unhidden latch: nothing malformed may hide a visible window.
    push(null);
    expect(presentation.desktopPresentationHidden()).toBe(false);
    push('hidden');
    expect(presentation.desktopPresentationHidden()).toBe(false);
    push({ hidden: 1 });
    expect(presentation.desktopPresentationHidden()).toBe(false);
    push({ hidden: 'true' });
    expect(presentation.desktopPresentationHidden()).toBe(false);
    push({ visible: false });
    expect(presentation.desktopPresentationHidden()).toBe(false);

    // Negative arm: a well-formed push right after still lands, so the drops
    // above are the validation and not a dead subscription.
    push({ hidden: true });
    expect(presentation.desktopPresentationHidden()).toBe(true);

    // From the hidden latch: nothing malformed may reveal a hidden window
    // either, or a bad push would silently resume drawing off-screen.
    push(undefined);
    expect(presentation.desktopPresentationHidden()).toBe(true);
    push({ hidden: 0 });
    expect(presentation.desktopPresentationHidden()).toBe(true);
    push({ hidden: null });
    expect(presentation.desktopPresentationHidden()).toBe(true);
    push({ hidden: false });
    expect(presentation.desktopPresentationHidden()).toBe(false);
  });

  it('ignores unknown extra fields on an otherwise valid payload', async () => {
    const { presentation, push } = await boot();
    push({ hidden: true, minimized: false, bounds: { x: 0, y: 0 } });
    expect(presentation.desktopPresentationHidden()).toBe(true);
  });

  it('returns the shell unsubscribe hook', async () => {
    const { shell, unsubscribe } = await boot();
    unsubscribe();
    expect(shell.unsubscribes).toBe(1);
  });

  it('re-arms the latch on a fresh init, so a new session never inherits hidden', async () => {
    const first = await boot();
    first.push({ hidden: true });
    expect(first.presentation.desktopPresentationHidden()).toBe(true);
    const second = await boot();
    expect(second.presentation.desktopPresentationHidden()).toBe(false);
  });
});
