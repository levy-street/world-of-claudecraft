// The HUD chrome focus-hygiene wiring hud.ts applies once at boot: which roots take
// the shared Enter/Space key guard and the pointer-only focus drop from
// src/ui/pointer_blur.ts (the "Space reopens the last-used menu" fix). Extracted so
// the root list is data a test can read directly and hud.ts stays a one-line
// consumer; the rationale for each half lives in pointer_blur.ts.
//
// Two families:
// - Non-modal overlay panels and the micromenu rail: canUseGameKeys() stays true
//   while they are up, so the global jump (Space) / chat (Enter) binds would hijack
//   those keys on a focused panel button. The key guard stops the keydown from
//   reaching the game layer (never preventing the default, so native activation
//   fires for keyboard users), and the pointer drop keeps a mouse click from leaving
//   the button focused for the next Space that escapes the game layer to re-click.
// - The always-on tracker and minimap overlays: their controls may stop click
//   propagation or repaint before Input's bubble-phase focus cleanup runs. The
//   capture-phase drop clears pointer focus before either can happen, while keyboard
//   activation keeps its focus.
//
// Host-agnostic: everything is reached through the injected query and the
// pointer_blur helpers, so it unit-tests in plain Node against hand-rolled fakes.

import { bindChromeButtonKeyGuard, bindPointerBlur, type ListenerHost } from './pointer_blur';

/** Non-modal overlay roots (and the micromenu rail) whose BUTTONs take the shared
 *  key guard plus the pointer-only focus drop. */
export const CHROME_GUARDED_PANELS: readonly string[] = [
  '#delve-board',
  '#lockpick-panel',
  '#delve-rite-panel',
  '#map-window',
  '#bank-window',
  '#bags',
  '#deeds-window',
  '#reliquary-window',
  '#professions-window',
  // The $WOC Exchange: markDialogRoot with no FocusManager trap and not in
  // isModalOpen, the exact enrolled profile (the deeds/reliquary shape), so
  // without the guard a focused Exchange button swallows Space/Enter meant
  // for the game while the window is open.
  '#woc-market-window',
  '#side-buttons',
];

/** Always-on overlays and the selector of the controls inside them that take the
 *  pointer-only focus drop (their own keydown arms carry keyboard activation). */
export const CHROME_TRACKER_BLURS: readonly (readonly [root: string, selector: string])[] = [
  ['#quest-tracker', '.qt-header, .qt-title'],
  ['#deed-tracker', '.dt-header'],
  ['#reliquary-tracker', '.dt-header'],
  ['#minimap-disc', 'button'],
];

/** Bind both halves over every guarded panel and the pointer drop over every
 *  always-on overlay. `query` resolves a selector to its root (hud.ts passes `$`). */
export function wireChromeFocus(query: (selector: string) => ListenerHost): void {
  for (const [root, selector] of CHROME_TRACKER_BLURS) bindPointerBlur(query(root), selector);
  for (const panelId of CHROME_GUARDED_PANELS) {
    const panel = query(panelId);
    bindChromeButtonKeyGuard(panel);
    bindPointerBlur(panel);
  }
}
