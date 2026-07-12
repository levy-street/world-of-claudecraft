// Pure navigation-decision core for the Esc options menu (spec section 5).
//
// The one place keyboard, controller, and pointer converge: a keyboard key on a focused
// row, or a controller menu verb (menu_gamepad_nav's MenuIntentKind), resolves to ONE
// shared FocusIntent the thin painter (options_window.ts) applies against the live DOM.
// The value coercion (slider step / page, clamped) and the index math (category cycle,
// row-focus clamp, segment rove) live here too, so a Vitest proves the whole navigation
// contract without a real pad and without a DOM (mirrors the pure-core split roving_index
// and menu_gamepad_nav already use).
//
// DOM/i18n-free and deterministic (no Math.random/Date.now/performance.now): every
// function is a same-input-same-output transform. Registered in tests/architecture.test.ts
// UI_PURE_CORES (and BARE_NAMED, since the file name is bare, not *_view/*_core). It stays
// game-free (a UI pure core may not import ../game): FocusIntent is a SUPERSET of the
// controller MenuIntentKind string values, declared here independently, so a MenuIntentKind
// is structurally assignable to FocusIntent and the painter needs no translation table (a
// test pins the superset against menu_gamepad_nav so it cannot drift).

/** The control kinds a detail row can present. The first three are value-bearing (the
 *  in-row adjust keys act on them); keybind + other own no value key. */
export type RowControlKind = 'slider' | 'switch' | 'segmented' | 'keybind' | 'other';

/**
 * The unified navigation intent. Its first twelve members are exactly the controller
 * verbs (menu_gamepad_nav MenuIntentKind); the last four are the keyboard-only extras the
 * pad verb set does not carry (a slider Page jump and a segment first/last edge). Keeping
 * FocusIntent a superset lets the painter pass a MenuIntentKind straight through.
 */
export type FocusIntent =
  | 'categoryPrev' // LB / Ctrl+Shift+Tab: previous category
  | 'categoryNext' // RB / Ctrl+Tab: next category
  | 'rowPrev' // D-pad Up: previous focusable row
  | 'rowNext' // D-pad Down: next focusable row
  | 'adjustDec' // D-pad Left / stick / ArrowLeft: decrease the focused value
  | 'adjustInc' // D-pad Right / stick / ArrowRight: increase the focused value
  | 'activate' // A: activate the focused control
  | 'back' // B: pop a pushed sub-view, else close
  | 'resetRow' // Y: reset the focused row to its default
  | 'clearKeybind' // X: clear the focused keybind slot
  | 'pageUp' // LT: page-scroll a long pane up
  | 'pageDown' // RT: page-scroll a long pane down
  | 'adjustMin' // slider/segment Home: jump to min / first
  | 'adjustMax' // slider/segment End: jump to max / last
  | 'adjustPageDec' // slider PageDown: decrease by SLIDER_PAGE_STEPS steps
  | 'adjustPageInc'; // slider PageUp: increase by SLIDER_PAGE_STEPS steps

/** The full FocusIntent set, for the superset guard + exhaustive tests. */
export const FOCUS_INTENTS: readonly FocusIntent[] = [
  'categoryPrev',
  'categoryNext',
  'rowPrev',
  'rowNext',
  'adjustDec',
  'adjustInc',
  'activate',
  'back',
  'resetRow',
  'clearKeybind',
  'pageUp',
  'pageDown',
  'adjustMin',
  'adjustMax',
  'adjustPageDec',
  'adjustPageInc',
];

/** PageUp/PageDown move a slider this many single steps (spec section 5: "10x step"). */
export const SLIDER_PAGE_STEPS = 10;

/**
 * The FocusIntent a keyboard key produces on a focused row of the given control kind, or
 * null for a key the control does not own (the caller falls through to native handling or
 * the trap's Tab). Per spec section 5:
 *   - switch: Left = off (adjustDec), Right = on (adjustInc); Space/Enter stay the native toggle.
 *   - segmented: Left/Right rove (adjustDec/adjustInc), Home/End jump to first/last.
 *   - slider: only Page keys are owned; Left/Right/Home/End stay native to the range input.
 */
export function rowKeyIntent(control: RowControlKind, key: string): FocusIntent | null {
  switch (control) {
    case 'switch':
      if (key === 'ArrowLeft') return 'adjustDec';
      if (key === 'ArrowRight') return 'adjustInc';
      return null;
    case 'segmented':
      if (key === 'ArrowLeft') return 'adjustDec';
      if (key === 'ArrowRight') return 'adjustInc';
      if (key === 'Home') return 'adjustMin';
      if (key === 'End') return 'adjustMax';
      return null;
    case 'slider':
      if (key === 'PageUp') return 'adjustPageInc';
      if (key === 'PageDown') return 'adjustPageDec';
      return null;
    default:
      return null;
  }
}

/**
 * A slider's next value after a step. `dir` is -1 (decrease) or 1 (increase); `steps` is 1
 * for a single step (D-pad / ArrowLeft-Right) or SLIDER_PAGE_STEPS for a Page jump. The
 * result is clamped to [min, max], so it is pinned at the ends in both directions. No
 * rounding: the range input already snaps to its own step; the painter re-reads the value.
 */
export function sliderStepValue(
  value: number,
  min: number,
  max: number,
  step: number,
  dir: -1 | 1,
  steps = 1,
): number {
  const next = value + dir * step * steps;
  return Math.min(max, Math.max(min, next));
}

/**
 * The target index for a segmented (radiogroup) value intent, or null when the intent is
 * not a segment adjust. adjustDec/adjustInc rove with wraparound (selection-follows-focus);
 * adjustMin/adjustMax jump to the first/last option. Returns null for an empty group.
 */
export function segIndexForIntent(
  count: number,
  current: number,
  intent: FocusIntent,
): number | null {
  if (count <= 0) return null;
  switch (intent) {
    case 'adjustDec':
      return wrapIndex(count, current, -1);
    case 'adjustInc':
      return wrapIndex(count, current, 1);
    case 'adjustMin':
      return 0;
    case 'adjustMax':
      return count - 1;
    default:
      return null;
  }
}

/** Next index with wraparound (category cycling, segment roving). `count <= 0` is a no-op. */
export function wrapIndex(count: number, current: number, dir: -1 | 1): number {
  if (count <= 0) return current;
  return (((current + dir) % count) + count) % count;
}

/** Next index clamped to [0, count - 1] (row focus never wraps). Returns -1 for no rows. */
export function clampIndex(count: number, current: number, dir: -1 | 1): number {
  if (count <= 0) return -1;
  return Math.min(count - 1, Math.max(0, current + dir));
}
