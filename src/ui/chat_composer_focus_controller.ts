// The classes mirror-tied to the chat composer's hover and focus.
//
// On desktop #chat-input is a body-level sibling of #ui (on touch it moves
// inside #chatlog-wrap), so the chat frame's "stay fully opaque while the player
// is on the composer" rule could only reach it through body, and a body-anchored
// :has() re-styles the whole HUD on every inline write. The frame's static
// ancestor #chatlog-wrap carries the state instead.

import {
  CHAT_COMPOSER_FOCUS_CLASS,
  CHAT_COMPOSER_HOVER_CLASS,
  MOBILE_CHAT_REPLY_CLASS,
} from './root_state_classes';

export interface ChatComposerFocusDeps {
  body: HTMLElement;
  /** #chatlog-wrap; null only on a page without the chat frame. */
  wrap: HTMLElement | null;
  /** The composer's own focus work (re-anchor, autosize), after the classes flip. */
  onFocus: () => void;
}

/** The close path's reset: the composer can be hidden while hovered or focused,
 *  and a hidden element gets its mouseleave only on the next pointer move, so
 *  closing drops every mirrored class at once. */
export function resetChatComposer(body: HTMLElement, wrap: HTMLElement | null): void {
  body.classList.toggle(MOBILE_CHAT_REPLY_CLASS, false);
  wrap?.classList.toggle(CHAT_COMPOSER_HOVER_CLASS, false);
  wrap?.classList.toggle(CHAT_COMPOSER_FOCUS_CLASS, false);
}

// mouseenter/mouseleave stand in for :hover: a composer appearing under a
// stationary pointer gets no mouseenter, and one hidden while hovered gets its
// mouseleave on the next pointer move, so the class can trail :hover by one
// pointer event on those edges; --chat-soft is the frame's opacity softness,
// cosmetic and never actionable, and the wrap's own :hover / :focus-within rules
// still hold. Every flip is toggle(token, force) so an already-true state writes
// nothing.
export function bindChatComposerFocusState(input: HTMLElement, deps: ChatComposerFocusDeps): void {
  const { body, wrap, onFocus } = deps;
  input.addEventListener('mouseenter', () =>
    wrap?.classList.toggle(CHAT_COMPOSER_HOVER_CLASS, true),
  );
  input.addEventListener('mouseleave', () =>
    wrap?.classList.toggle(CHAT_COMPOSER_HOVER_CLASS, false),
  );
  input.addEventListener('focus', () => {
    // Actively replying (issue 1577 round 2 (7)/(8)): the composer is focused, so
    // expand it and fade the chat window behind it. Class is mirror-tied to focus
    // so it clears the moment the composer loses focus.
    body.classList.toggle(MOBILE_CHAT_REPLY_CLASS, true);
    wrap?.classList.toggle(CHAT_COMPOSER_FOCUS_CLASS, true);
    onFocus();
  });
  input.addEventListener('blur', () => {
    body.classList.toggle(MOBILE_CHAT_REPLY_CLASS, false);
    wrap?.classList.toggle(CHAT_COMPOSER_FOCUS_CLASS, false);
  });
}
