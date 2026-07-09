// The mobile chat keyboard-dismiss seam: the pure decision that keeps an intentional
// keyboard dismiss (blur, chat stays open) apart from the composer-close path (blur
// after hide, which recovers the mobile-chat viewport). DOM-free, Node-tested.

import { describe, expect, it } from 'vitest';
import {
  keyboardDismissEffect,
  shouldRecoverOnComposerBlur,
} from '../src/game/chat_keyboard_dismiss';

describe('shouldRecoverOnComposerBlur (dismiss vs close differentiation)', () => {
  it('recovers on a blur only when the composer is already hidden (the close path)', () => {
    // closeChat() sets display:none BEFORE blurring, so its blur must recover the
    // mobile-chat viewport (remove mobile-chat-open, re-sync the app viewport).
    expect(shouldRecoverOnComposerBlur('none')).toBe(true);
  });

  it('does NOT recover on a blur while the composer is still shown (the dismiss / keep-open path)', () => {
    // The keyboard-dismiss chevron blurs while the composer is still display:block, so
    // this returns false and chat STAYS OPEN at its resting seat. Any non-'none' display
    // (the composer stays visible) keeps chat open.
    expect(shouldRecoverOnComposerBlur('block')).toBe(false);
    expect(shouldRecoverOnComposerBlur('')).toBe(false);
    expect(shouldRecoverOnComposerBlur('flex')).toBe(false);
  });
});

describe('keyboardDismissEffect (the dismiss chevron intent)', () => {
  it('blurs the composer but never closes chat', () => {
    // The dismiss drops the keyboard (blur) while keeping the log + composer up. Pinning
    // both fields proves a regression that funnelled dismiss into the close path (which
    // would set closeChat true) fails here.
    expect(keyboardDismissEffect()).toEqual({ blurComposer: true, closeChat: false });
  });

  it('is a pure constant (input-free: this module owns ONLY the dismiss decision)', () => {
    // The dismiss effect is input-free and stable. main.ts applies ONLY effect.blurComposer
    // at the chevron's click (it never reads effect.closeChat); the Enter-send, Escape-close,
    // and chat-toggle paths keep their own closeChat calls, which hide then blur, so
    // shouldRecoverOnComposerBlur('none') is true for them (proven above). The value pin at
    // the top of this describe is the real guard; a self-equal comparison would pass for
    // ANY constant, so it is deliberately omitted here.
    expect(keyboardDismissEffect().blurComposer).toBe(true);
  });
});
