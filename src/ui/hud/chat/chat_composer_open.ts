// Opening the chat composer pre-filled with text (the player menu's Whisper
// row, the Social window's whisper button): the one seam both layouts share.
//
// Desktop: the composer is a body-level bar; showing and focusing it is the
// whole open. Touch: the composer lives INSIDE the chat panel (#chatlog-wrap)
// and that panel only renders while body carries `mobile-chat-open` (the
// compact tier hides the whole wrap without it). The Chat button reaches that
// state through mobile_controls.ts + main.ts openChat; a pre-filled open has
// to reach the SAME state, or the focused composer is invisible and the
// prefill goes nowhere (the touch Whisper row did exactly that).
//
// Owns no state. The caller injects the elements and the presentation hook.

const MOBILE_TOUCH_CLASS = 'mobile-touch';
/** The live "chat panel open" class mobile_controls.ts toggles from the Chat button. */
export const MOBILE_CHAT_OPEN_CLASS = 'mobile-chat-open';
/** The long-press read-only peek; never shown together with the open panel. */
const MOBILE_CHATLOG_PEEK_CLASS = 'mobile-chatlog-peek';

/**
 * On the touch HUD the composer is the chat panel's first child (above the tabs
 * and log) rather than a sibling of #ui. Move it there once; idempotent, and a
 * no-op on desktop or a page without the chat frame.
 */
export function seatComposerInMobilePanel(
  body: HTMLElement,
  wrap: HTMLElement | null,
  input: HTMLElement,
): void {
  if (!body.classList.contains(MOBILE_TOUCH_CLASS)) return;
  if (!wrap || input.parentElement === wrap) return;
  wrap.insertBefore(input, wrap.firstChild);
}

export interface ChatComposerOpenDeps {
  body: HTMLElement;
  /** #chatlog-wrap; null only on a page without the chat frame. */
  wrap: HTMLElement | null;
  input: HTMLTextAreaElement;
  /** Tint + placeholder for the active send channel (the Chat button open's first step). */
  applyPresentation(): void;
}

/**
 * Open the composer holding `text`, caret at the end. On touch this first opens
 * the chat panel exactly as the Chat button does. The trailing `input` event
 * lets main.ts re-anchor and autosize the bar for the prefilled value.
 */
export function openChatComposerWithText(text: string, deps: ChatComposerOpenDeps): void {
  const { body, wrap, input } = deps;
  if (body.classList.contains(MOBILE_TOUCH_CLASS)) {
    body.classList.remove(MOBILE_CHATLOG_PEEK_CLASS);
    body.classList.add(MOBILE_CHAT_OPEN_CLASS);
    seatComposerInMobilePanel(body, wrap, input);
    deps.applyPresentation();
  }
  input.value = text;
  input.style.display = 'block';
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event('input'));
}
