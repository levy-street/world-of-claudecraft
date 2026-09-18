// State classes that replaced the root-anchored `:has()` selectors.
//
// A rule such as `body:has(#start-screen:not([style*="display: none"])) #ui`
// makes the `style` attribute of EVERY element under body a `:has()` feature of
// body, and Blink's invalidation set for that feature is the whole subtree: the
// first inline-style write of a frame (a compass mark, the tutorial arrow) made
// the browser re-resolve style for the entire visible HUD, about 580 elements
// and 6.5 ms per frame on an Intel HD 530. Each state below is instead a class
// toggled by the code that already owns the state, on the anchor the old rule
// keyed on. tests/css_root_anchored_has.test.ts keeps `:has()` off body, :root,
// html and #ui, and pins each name here to the rule that reads it.

/** On body from the HTML until the world entry hides the start screen. */
export const START_SCREEN_OPEN_CLASS = 'start-screen-open';
/** On #ui while #options-menu is visible: the Esc menu scrim. */
export const OPTIONS_OPEN_CLASS = 'options-open';
/** On body while the paladin Devotion medallion sits on its last charge. */
export const DEVOTION_LAST_CHARGE_CLASS = 'devotion-last-charge';
/** On body while #trade-window and #bags are both open: the touch split dock. */
export const TRADE_AND_BAGS_OPEN_CLASS = 'trade-and-bags-open';
/** On #chatlog-wrap while the pointer is over the chat composer. */
export const CHAT_COMPOSER_HOVER_CLASS = 'chat-composer-hover';
/** On #chatlog-wrap while the chat composer has keyboard focus. */
export const CHAT_COMPOSER_FOCUS_CLASS = 'chat-composer-focus';
/** On body while the desktop shell's pre-game Exit Game button is revealed. */
export const DESKTOP_LOGIN_EXIT_SHOWN_CLASS = 'desktop-login-exit-shown';
/** On body while the composer is focused (the touch reply layout); predates the
 *  set above and lives here beside its focus-mirrored sibling. */
export const MOBILE_CHAT_REPLY_CLASS = 'mobile-chat-reply';
