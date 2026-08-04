// Mouse buttons as bindable pseudo-keys. A binding is stored as a combo string
// built from a KeyboardEvent.code (see keybinds.ts); a mouse button joins that
// same namespace as the pseudo-code `Mouse<n>`, so the whole existing rebind
// stack (persistence, the one-code-per-action sweep, modifier chords, the
// action-bar keycaps) carries mouse buttons with no parallel system. Pure (no
// DOM, no MouseEvent) so the numbering and reservation rules unit-test directly;
// `input.ts` is the thin consumer.
//
// Numbering deliberately follows the CLASSIC gaming convention players use when
// they say "bind it to mouse 4", NOT the DOM's `MouseEvent.button` index:
//
//   DOM button 0 (left)          -> Mouse1   reserved
//   DOM button 2 (right)         -> Mouse2   reserved
//   DOM button 1 (middle/wheel)  -> Mouse3
//   DOM button 3 (thumb back)    -> Mouse4
//   DOM button 4 (thumb forward) -> Mouse5
//   DOM button n >= 5            -> Mouse<n+1>   (extra buttons on gaming mice)
//
// Left and right stay RESERVED: they drive mouselook, click-to-move, and world
// click-picking, so letting a player rebind them would take camera control away
// with no way back. Everything from the middle button up is fair game.

/** Prefix every mouse pseudo-code carries, so a code namespace check is cheap. */
const MOUSE_CODE_PREFIX = 'Mouse';

/** Left and right: owned by camera/click-pick, never bindable. */
const RESERVED_MOUSE_CODES = new Set(['Mouse1', 'Mouse2']);

/**
 * The pseudo-code for a `MouseEvent.button` index, or null if the index is not a
 * real button (negative, fractional, or NaN). Reserved buttons still map to
 * their code here; use `bindableMouseCodeForButton` to get only bindable ones.
 */
export function mouseCodeForButton(button: number): string | null {
  if (!Number.isInteger(button) || button < 0) return null;
  if (button === 0) return 'Mouse1';
  if (button === 1) return 'Mouse3';
  if (button === 2) return 'Mouse2';
  return `${MOUSE_CODE_PREFIX}${button + 1}`;
}

/** True for any mouse pseudo-code, e.g. "Mouse4" (a bare code, not a combo). */
export function isMouseCode(code: string): boolean {
  return /^Mouse[1-9]\d*$/.test(code);
}

/** True for the two camera/click buttons, which are never bindable. */
export function isReservedMouseCode(code: string): boolean {
  return RESERVED_MOUSE_CODES.has(code);
}

/**
 * The pseudo-code for a button the player is allowed to bind, or null for the
 * reserved left/right buttons and non-button indices. This is the one call
 * `input.ts` gates every mouse capture and dispatch on.
 */
export function bindableMouseCodeForButton(button: number): string | null {
  const code = mouseCodeForButton(button);
  return code !== null && !isReservedMouseCode(code) ? code : null;
}

/**
 * True for the two buttons the camera/click-pick gesture owns (DOM 0 and 2).
 * `input.ts` gates its drag, pointer-lock, and click-pick tracking on this, so an
 * extra button press never disturbs a camera drag already in flight.
 */
export function isReservedMouseButton(button: number): boolean {
  const code = mouseCodeForButton(button);
  return code !== null && isReservedMouseCode(code);
}

/**
 * Short on-screen label for a mouse pseudo-code ("Mouse4" -> "M4"), or null if
 * the code is not one. Kept to a glyph-style token, like the keyboard keycaps in
 * keybinds.ts: it must fit a 34px action-bar keycap and it carries no word to
 * translate, so it reads the same in every locale.
 */
export function mouseCodeLabel(code: string): string | null {
  return isMouseCode(code) ? `M${code.slice(MOUSE_CODE_PREFIX.length)}` : null;
}
