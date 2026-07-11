// Pure (pad snapshot -> menu intent) mapping for the Esc menu's controller mode
// (spec section 5). No DOM, no navigator, no timers/randomness: it is a deterministic
// transform, so the whole controller-navigation contract is provable without a real
// pad (mirrors the pure-core split gamepad_map.ts already uses; the thin GamepadManager
// consumer in gamepad.ts owns polling and the side effects).
//
// It reuses the gamepad_map button vocabulary (GP.*) rather than inventing a parallel
// naming scheme, and reuses risingEdges for up->down edge detection. Because a menu verb
// (A, B, X, Y, LB/RB, D-pad, LT/RT) also carries a DEFAULT WORLD binding, the manager
// cannot simply also dispatch world input while the menu is open. So this core returns,
// alongside the intents, the set of button edges the manager must SWALLOW: while a focus
// trap owns the pad (FocusManager.hasActiveTrap()), every rising edge of the frame is
// consumed, so world input (camera, movement, and the pad's Esc mapping) never
// double-fires. Outside a trap the menu does not own the pad: no intents, nothing
// consumed, and world input flows exactly as before.

import { GP, risingEdges } from './gamepad_map';

/** One menu navigation verb. None carry a payload, so a plain string discriminator is
 *  enough; the wiring dispatches each against the (later) focus model. */
export type MenuIntentKind =
  | 'categoryPrev' // LB: previous category from anywhere
  | 'categoryNext' // RB: next category from anywhere
  | 'rowPrev' // D-pad Up: move row focus up
  | 'rowNext' // D-pad Down: move row focus down
  | 'adjustDec' // D-pad Left or left-stick X left: decrease the focused value
  | 'adjustInc' // D-pad Right or left-stick X right: increase the focused value
  | 'activate' // A: activate the focused control
  | 'back' // B: pop a pushed sub-view, else close
  | 'resetRow' // Y: reset the focused row to its default
  | 'clearKeybind' // X: clear the focused keybind slot
  | 'pageUp' // LT: page-scroll a long pane up
  | 'pageDown'; // RT: page-scroll a long pane down

/** The button -> intent table, keyed by the W3C standard-mapping button index (GP.*).
 *  A lookup for a button with no menu verb (Back / Start / L3 / R3 / Guide) is
 *  undefined: that edge is still consumed while a trap is active (see the module note),
 *  it just produces no intent. */
export const MENU_BUTTON_INTENTS: Readonly<Partial<Record<number, MenuIntentKind>>> = {
  [GP.LB]: 'categoryPrev',
  [GP.RB]: 'categoryNext',
  [GP.DPAD_UP]: 'rowPrev',
  [GP.DPAD_DOWN]: 'rowNext',
  [GP.DPAD_LEFT]: 'adjustDec',
  [GP.DPAD_RIGHT]: 'adjustInc',
  [GP.A]: 'activate',
  [GP.B]: 'back',
  [GP.Y]: 'resetRow',
  [GP.X]: 'clearKeybind',
  [GP.LT]: 'pageUp',
  [GP.RT]: 'pageDown',
};

export interface MenuNavFrame {
  /** Pressed-state snapshot from the previous poll. LT/RT are already thresholded to
   *  booleans by the caller (gamepad.ts does this with TRIGGER_THRESHOLD). */
  prev: readonly boolean[];
  /** Pressed-state snapshot this poll. */
  cur: readonly boolean[];
  /** Left-stick X this poll (value adjust axis; the right stick is camera and unread here). */
  stickX: number;
  /** Left-stick X last poll, for detecting the past-threshold crossing. */
  prevStickX: number;
  /** Magnitude past which a stick push counts as one value-adjust step (the pad deadzone
   *  or a dedicated adjust threshold, chosen by the caller). */
  adjustThreshold: number;
  /** FocusManager.hasActiveTrap(): the menu owns the pad only while a trap is installed. */
  trapActive: boolean;
}

export interface MenuNavResult {
  /** Ordered menu verbs to dispatch this frame (button intents in ascending button
   *  order, then any stick-derived adjust). Empty outside a trap. */
  intents: MenuIntentKind[];
  /** Button indices whose rising edge the manager must NOT forward to world input.
   *  Ascending. Every rising edge of the frame while a trap is active; empty otherwise. */
  consumedButtons: number[];
}

/**
 * Map one poll frame to its menu intents + consumed button edges. Deterministic and
 * side-effect-free. Outside a trap it returns empty/empty so world input is untouched.
 */
export function mapMenuGamepad(frame: MenuNavFrame): MenuNavResult {
  if (!frame.trapActive) return { intents: [], consumedButtons: [] };

  const edges = risingEdges(frame.prev, frame.cur); // already ascending by index
  const intents: MenuIntentKind[] = [];
  // Adjust may come from both the D-pad and the stick in one frame; emit it at most once
  // per direction so it mirrors a single keypress rather than double-stepping.
  let incEmitted = false;
  let decEmitted = false;

  for (const button of edges) {
    const intent = MENU_BUTTON_INTENTS[button];
    if (!intent) continue; // consumed (below) but not a menu verb
    if (intent === 'adjustInc') {
      if (incEmitted) continue;
      incEmitted = true;
    } else if (intent === 'adjustDec') {
      if (decEmitted) continue;
      decEmitted = true;
    }
    intents.push(intent);
  }

  // Left-stick X value adjust: fire once on the crossing from within the threshold band
  // to past it (a held deflection does not repeat, matching the discrete keyboard step).
  const t = Math.max(0, frame.adjustThreshold);
  if (!incEmitted && frame.prevStickX <= t && frame.stickX > t) intents.push('adjustInc');
  if (!decEmitted && frame.prevStickX >= -t && frame.stickX < -t) intents.push('adjustDec');

  // While the trap owns the pad, swallow EVERY edge (mapped or not) so no world binding
  // double-fires. The stick is an axis, not an edge, so it is never in this set.
  return { intents, consumedButtons: edges };
}
