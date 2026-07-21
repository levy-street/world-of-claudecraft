import { describe, expect, it } from 'vitest';
import { clientEnvBits, installPageStateTracking, pageStateBits } from '../src/game/client_env';

describe('clientEnvBits', () => {
  it('imports cleanly and reports no bits under plain Node', () => {
    expect(clientEnvBits()).toBe(0);
  });
});

describe('pageStateBits', () => {
  function fakePage(opts: { focused: boolean; visibility?: DocumentVisibilityState }) {
    const doc = {
      focused: opts.focused,
      visibilityState: opts.visibility ?? ('visible' as DocumentVisibilityState),
      hasFocus() {
        return this.focused;
      },
    };
    const target = new EventTarget();
    const cleanup = installPageStateTracking(target, doc);
    return { doc, target, cleanup };
  }

  it('reports no bits when tracking was never installed (plain Node)', () => {
    expect(pageStateBits()).toBe(0);
  });

  it('reports 0 for a focused, visible page', () => {
    const { cleanup } = fakePage({ focused: true });
    expect(pageStateBits()).toBe(0);
    cleanup();
  });

  it('sets bit 0 when the document is hidden', () => {
    const { cleanup } = fakePage({ focused: true, visibility: 'hidden' });
    expect(pageStateBits()).toBe(1);
    cleanup();
  });

  it('sets bit 1 only when the page never held focus during the period', () => {
    const { cleanup } = fakePage({ focused: false });
    expect(pageStateBits()).toBe(2);
    cleanup();
  });

  it('clears bit 1 if a focus event landed during the period', () => {
    const { target, cleanup } = fakePage({ focused: false });
    target.dispatchEvent(new Event('focus'));
    expect(pageStateBits()).toBe(0);
    // still unfocused at the drain, so the next period starts without focus
    expect(pageStateBits()).toBe(2);
    cleanup();
  });

  it('carries the focus state at each drain into the next period', () => {
    const { doc, cleanup } = fakePage({ focused: true });
    expect(pageStateBits()).toBe(0);
    doc.focused = false;
    // focused at the previous drain, so this period saw focus
    expect(pageStateBits()).toBe(0);
    expect(pageStateBits()).toBe(2);
    cleanup();
  });

  it('combines both bits for a hidden, unfocused page', () => {
    const { cleanup } = fakePage({ focused: false, visibility: 'hidden' });
    expect(pageStateBits()).toBe(3);
    cleanup();
  });

  it('reports no bits after cleanup', () => {
    const { cleanup } = fakePage({ focused: false, visibility: 'hidden' });
    cleanup();
    expect(pageStateBits()).toBe(0);
  });
});
