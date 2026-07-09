// The mobile chat keyboard-dismiss seam: the pure decision that keeps a keyboard dismiss
// (blur, chat stays OPEN in its read view) apart from the composer-close path (blur after
// the composer is hidden, which recovers the mobile-chat viewport). DOM-free, Node-tested.

import { describe, expect, it } from 'vitest';
import { shouldRecoverOnComposerBlur } from '../src/game/chat_keyboard_dismiss';

describe('shouldRecoverOnComposerBlur (dismiss keeps chat open in read view)', () => {
  it('recovers on a blur only when the composer is already hidden (the close path)', () => {
    // closeChat() sets display:none BEFORE blurring, so its blur must recover the
    // mobile-chat viewport (remove mobile-chat-open, re-sync the app viewport).
    expect(shouldRecoverOnComposerBlur('none')).toBe(true);
  });

  it('does NOT recover on a blur while the composer is still shown (the read-view dismiss)', () => {
    // Hiding the keyboard blurs the composer while it is still display:block, so this
    // returns false and chat STAYS OPEN in its centered read view. Any non-'none' display
    // (the composer stays visible) keeps chat open; only the Chat button closes it.
    expect(shouldRecoverOnComposerBlur('block')).toBe(false);
    expect(shouldRecoverOnComposerBlur('')).toBe(false);
    expect(shouldRecoverOnComposerBlur('flex')).toBe(false);
  });
});
