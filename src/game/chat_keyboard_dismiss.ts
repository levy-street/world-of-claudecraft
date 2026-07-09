// The mobile chat keyboard-dismiss seam: the pure decision that differentiates an
// INTENTIONAL keyboard dismiss (blur the composer, keep chat open) from the existing
// composer-CLOSE path (blur after the composer is hidden, which must recover the
// mobile-chat viewport).
//
// On a touch HUD the chat toggle opens the composer focused (keyboard up), and until
// now the only ways the keyboard dropped were closing chat entirely or the OS back
// gesture. The dismiss chevron blurs the input WITHOUT closing chat: the log +
// composer stay at their resting seat and the keyboard_viewport applier reflows chat
// back automatically off the visualViewport resize.
//
// The distinguishing signal is the composer's display state at blur time. closeChat()
// hides the composer (display:none) BEFORE it blurs, so its blur must trigger the
// mobile-keyboard viewport recovery. A dismiss (or any focus loss while the composer
// is still shown) leaves display:block, so it must NOT recover, keeping chat open.
// This module is DOM-free and Node-testable; main.ts wires it to the real elements.

/**
 * Whether a `blur` on the chat composer should run the mobile-keyboard viewport
 * recovery (which removes `mobile-chat-open` and re-syncs the app viewport). True
 * only when the composer is already HIDDEN (`display === 'none'`), i.e. the blur came
 * from the close path (closeChat hides then blurs). A blur while the composer is still
 * shown (an intentional keyboard dismiss, or a focus loss that keeps chat open)
 * returns false, so chat stays open at its resting seat.
 */
export function shouldRecoverOnComposerBlur(composerDisplay: string): boolean {
  return composerDisplay === 'none';
}

/**
 * The keyboard-dismiss action's effect, expressed as a pure decision the wiring
 * applies to the real composer: blur it (drop the keyboard) but keep chat OPEN (do
 * not hide the composer, do not recover the viewport). Returned as data so a Node
 * test can assert the intent without a DOM: `blurComposer` true, `closeChat` false.
 */
export interface KeyboardDismissEffect {
  /** Blur the chat input, which drops the on-screen keyboard on Android and iOS. */
  blurComposer: boolean;
  /** Never close chat on a dismiss: the log + composer stay visible. */
  closeChat: boolean;
}

/** The dismiss chevron's effect: blur the composer, keep chat open. A constant-shaped
 *  decision (no inputs) so the wiring and a Node test share one source of truth. */
export function keyboardDismissEffect(): KeyboardDismissEffect {
  return { blurComposer: true, closeChat: false };
}
