// The mobile chat keyboard-dismiss seam: the pure decision that keeps an intentional
// keyboard dismiss (blur, chat stays OPEN in its read view) apart from the composer-CLOSE
// path (blur after the composer is hidden, which closes the mobile chat view).
// DOM-free, Node-tested; main.ts wires it to the real composer element.
//
// New model: tapping the Chat button opens a centered READ view (composer visible above
// the panel, keyboard down). Tapping the composer raises the keyboard; hiding the keyboard
// returns to the read view (chat stays open). Only the Chat button closes chat entirely.

/**
 * Whether a `blur` on the chat composer should close the mobile chat view. True only when the
 * composer is already HIDDEN (`display === 'none'`), i.e. the blur came from the close
 * path (closeChat hides the composer, THEN blurs it). A blur while the composer is still
 * shown is a keyboard dismiss that returns to the read view, so it returns false and chat
 * stays open.
 */
export function shouldRecoverOnComposerBlur(composerDisplay: string): boolean {
  return composerDisplay === 'none';
}

export type ComposerBlurViewportAction = 'recover' | 'none';

/** Resolve the viewport action without coupling the blur listener to DOM state. */
export function composerBlurViewportAction(
  composerDisplay: string,
  _mobileTouch: boolean,
): ComposerBlurViewportAction {
  if (shouldRecoverOnComposerBlur(composerDisplay)) return 'recover';
  return 'none';
}
