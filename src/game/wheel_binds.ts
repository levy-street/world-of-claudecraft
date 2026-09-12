// The mouse wheel as a pair of bindable pseudo-keys. A wheel notch joins the
// same combo namespace mouse buttons use (mouse_binds.ts: a binding is a combo
// string over a KeyboardEvent.code or a pseudo-code), as `WheelUp` and
// `WheelDown`, so the whole existing rebind stack (persistence, the
// one-code-per-action sweep, modifier chords, the action-bar keycaps) carries
// the wheel with no parallel system. `Ctrl+WheelDown` is an ordinary chord.
//
// Camera zoom is not hard-wired to the wheel any more: it is the pair of edge
// actions `zoomIn` / `zoomOut` (keybinds.ts), which DEFAULT to the bare wheel.
// A player who wants abilities on the wheel rebinds zoom to a chord (Ctrl+wheel)
// or to keys, and the freed notches take slots like any key would.
//
// A notch is an instant: it has no release, so it can only ever fire an EDGE
// action (a slot tap, a window toggle, a zoom step). Binding one to a held
// (movement) action is refused, see `wheelCodeAllowedFor`.
//
// Pure (no DOM, no WheelEvent) so the rules unit-test directly; `input.ts` and
// `keybinds.ts` are the thin consumers.

/** Pseudo-code for a wheel notch rolled away from the player (deltaY < 0). */
export const WHEEL_UP_CODE = 'WheelUp';
/** Pseudo-code for a wheel notch rolled toward the player (deltaY > 0). */
export const WHEEL_DOWN_CODE = 'WheelDown';

/**
 * Camera distance moved per notch. Shared with the gamepad zoom buttons
 * (gamepad_map.ts GAMEPAD_ZOOM_STEP) and the touch pinch so every zoom input
 * feels the same speed.
 */
export const WHEEL_ZOOM_STEP = 1.4;

/** The two edge actions the bare wheel drives by default. */
export const ZOOM_IN_ACTION = 'zoomIn';
export const ZOOM_OUT_ACTION = 'zoomOut';

/**
 * The pseudo-code for a `WheelEvent.deltaY`, or null for a zero / NaN delta
 * (a horizontal-only tilt, or a synthetic event with no vertical travel), which
 * must fire nothing.
 */
export function wheelCodeForDelta(deltaY: number): string | null {
  if (!Number.isFinite(deltaY) || deltaY === 0) return null;
  return deltaY < 0 ? WHEEL_UP_CODE : WHEEL_DOWN_CODE;
}

/** True for a wheel pseudo-code (a bare code, not a combo). */
export function isWheelCode(code: string): boolean {
  return code === WHEEL_UP_CODE || code === WHEEL_DOWN_CODE;
}

/**
 * A wheel notch has no key-up, so it can only drive edge actions. Held
 * (movement / swim / emote wheel) actions poll a code every frame and would
 * never see it release, which would leave the player walking forever.
 */
export function wheelCodeAllowedFor(kind: 'held' | 'edge' | null): boolean {
  return kind === 'edge';
}

/**
 * The camera step a zoom action applies, positive to move the camera out, or
 * null for any other action. Both notches and keys bound to the zoom actions go
 * through this, so the two always step the same distance.
 */
export function zoomStepForAction(action: string): number | null {
  if (action === ZOOM_IN_ACTION) return -WHEEL_ZOOM_STEP;
  if (action === ZOOM_OUT_ACTION) return WHEEL_ZOOM_STEP;
  return null;
}

/**
 * Short on-screen label for a wheel pseudo-code ("WheelUp" -> "Wh↑"), or null
 * if the code is not one. A glyph-style token like the M4 mouse keycaps and the
 * arrow-key arrows keybinds.ts already paints: it fits a 34px action-bar keycap
 * and carries no word to translate, so it reads the same in every locale.
 */
export function wheelCodeLabel(code: string): string | null {
  if (code === WHEEL_UP_CODE) return 'Wh↑';
  if (code === WHEEL_DOWN_CODE) return 'Wh↓';
  return null;
}
