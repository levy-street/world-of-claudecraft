// Which control family on-screen hint text should speak for: keyboard/mouse,
// the touch interface, or a gamepad.
//
// The HUD already had a binary signal (body.mobile-touch, owned by
// mobile_controls.ts setActive) that the new-adventurer tutorial reads for its
// touch copy. A gamepad had no equivalent: the pad infrastructure
// (gamepad.ts, gamepad_map.ts) knows a pad is connected and even its brand,
// but nothing surfaced "the player is HOLDING the pad right now" to the UI
// layer, so every hint spoke keyboard at a controller player.
//
// This module is that signal. GamepadManager.poll marks activity whenever the
// pad actually produces input (a button down or a stick past the deadzone);
// the first mark lazily installs window listeners that clear the flag the
// moment a key or mouse button is pressed, so the hint mode always tracks the
// device the player touched last. Touch wins outright: the mobile interface
// replaces the control scheme entirely, while a pad merely coexists with the
// keyboard.
//
// The flag rides a body class (the mobile-touch precedent) so consumers need
// no reference to the manager, and hint text re-renders on the same
// class-read-per-frame pattern the tutorial already uses.

export type InputHintMode = 'keyboard' | 'touch' | 'pad';

export const PAD_ACTIVE_CLASS = 'pad-active';

// The GamepadManager poll calls markPadActivity from plain Node in its unit
// suite (tests/gamepad.test.ts runs without a DOM, and its focus arms stub a
// partial document whose body classList carries no add), so every
// document/window touch here is guarded on the full classList surface:
// headless the signal is simply inert and the hint mode stays 'keyboard'.
const hasDom = (): boolean =>
  typeof document !== 'undefined' &&
  typeof document.body?.classList?.add === 'function' &&
  typeof document.body.classList.contains === 'function';

let clearsInstalled = false;

function clearPadActivity(): void {
  if (hasDom()) document.body.classList.remove(PAD_ACTIVE_CLASS);
}

function clearPadActivityOnMouseMove(event: MouseEvent): void {
  // A 1000 Hz mouse fires this per event forever once a pad was seen; skip the
  // classList write unless there is actually a mark to clear.
  if (!event.isTrusted) return;
  if (!hasDom() || !document.body.classList.contains(PAD_ACTIVE_CLASS)) return;
  clearPadActivity();
}

/** Called by GamepadManager.poll whenever the pad produced real input this
 *  frame. Cheap when already marked (a classList.add no-op). */
export function markPadActivity(): void {
  if (!hasDom()) return;
  if (!clearsInstalled) {
    clearsInstalled = true;
    window.addEventListener('keydown', clearPadActivity);
    window.addEventListener('mousedown', clearPadActivity);
    window.addEventListener('mousemove', clearPadActivityOnMouseMove, { passive: true });
  }
  document.body.classList.add(PAD_ACTIVE_CLASS);
}

/** The control family hint text should speak for right now. */
export function currentInputHintMode(): InputHintMode {
  if (!hasDom()) return 'keyboard';
  if (document.body.classList.contains('mobile-touch')) return 'touch';
  if (document.body.classList.contains(PAD_ACTIVE_CLASS)) return 'pad';
  return 'keyboard';
}
