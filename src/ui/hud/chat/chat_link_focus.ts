// Pointer-only focus drop for chat link tokens (quest, item, deed, Reliquary
// page), the fix for "Space re-opens the last clicked chat link".
//
// A chat link is a focusable span, so a mouse click leaves it holding document
// focus. Input's window-level cleanup (Input.releaseMouseActivatedFocus) runs in
// the bubble phase, AFTER the link's own click handler, and by then that handler
// has opened a window whose focus bridge (window_focus.ts captureFocus) recorded
// the still-focused link as its return-focus opener. Closing the window planted
// focus back on the link (scrolling the chat to it), and the next Space re-ran
// the link's keydown arm instead of jumping. An item link has no activation, but
// stale focus on it had the same shape: any window closed later handed focus
// back to it and its focus tooltip re-opened.
//
// The drop here is delegated in the CAPTURE phase, the pointer_blur.ts recipe,
// so it lands before the link's handler and a mouse open records no opener.
// Keyboard activation (click detail 0) keeps its focus and its opener return.
//
// One carve-out: an item link is only dropped on a MOUSE click. On touch, the
// focus a tap places on it is what shows its tooltip (tooltip_binding.ts
// focusin), and the blur would hide it again (focusout). An unknown pointer type
// keeps the focus, the pre-fix behavior.
//
// Host-agnostic (everything reached off the passed event), so it unit-tests in
// plain Node against hand-rolled fakes.

import { type BlurrableEl, dropPointerFocus, type ListenerHost } from '../../pointer_blur';

/** Links whose click opens something: always dropped on a pointer click. */
export const CHAT_ACTION_LINK_SELECTOR = '.chat-quest-link, .chat-deed-link';
/** Inspect-only links (focus shows the tooltip): dropped on a mouse click only. */
export const CHAT_INSPECT_LINK_SELECTOR = '.chat-item-link';

interface ChatLinkClick {
  detail: number;
  pointerType?: string;
  target: { closest?(selector: string): unknown } | null;
}

function asBlurrable(x: unknown): BlurrableEl | null {
  return x && typeof (x as BlurrableEl).blur === 'function' ? (x as BlurrableEl) : null;
}

/** Bind the capture-phase pointer focus drop for every chat link inside `pane`. */
export function bindChatLinkPointerBlur(pane: ListenerHost): void {
  pane.addEventListener(
    'click',
    (e) => {
      const click = e as unknown as ChatLinkClick;
      if (click.detail <= 0) return;
      const action = asBlurrable(click.target?.closest?.(CHAT_ACTION_LINK_SELECTOR));
      if (action) {
        dropPointerFocus(action);
        return;
      }
      if (click.pointerType !== 'mouse') return;
      const inspect = asBlurrable(click.target?.closest?.(CHAT_INSPECT_LINK_SELECTOR));
      if (inspect) dropPointerFocus(inspect);
    },
    true,
  );
}
