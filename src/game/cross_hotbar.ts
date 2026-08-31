// Pure, host-agnostic cross-hotbar (XHB) model: the console-MMO trigger-modifier
// hotbar. No DOM, no `navigator`, no timers, so the trigger state machine and the
// button-to-slot resolution unit-test without a real controller (the same
// pure-core split gamepad_map.ts uses for the stick math). The thin
// `GamepadManager` consumer in gamepad.ts owns polling and dispatch.
//
// Holding a trigger lights eight slots at once: the d-pad diamond and the face
// diamond. The left trigger reaches one eight, the right trigger the other, so
// one set is sixteen actions reachable without lifting a thumb. Tapping the
// opposite trigger while holding swaps to the second set (the "double" bar), for
// thirty-two in reach.

import { GP } from './gamepad_map';

/**
 * The basic Attack, as the bar holds it. Attack is not an ability and has no id of
 * its own: it is the action bar's fixed slot-0 toggle. The spellbook already names
 * it 'attack' when it asks for an icon, so the bar reuses that spelling rather than
 * inventing a second one, and every consumer branches on this constant.
 */
export const CROSS_HOTBAR_ATTACK_ID = 'attack';

/**
 * Put an action on the first free cell, reading the sets in order. Answers null
 * when the bar is full, so the caller can leave the layout untouched rather than
 * evicting something the player put there.
 */
export function placeInFirstFreeCell(
  layout: CrossHotbarLayout,
  action: CrossHotbarAction,
): CrossHotbarAction[][] | null {
  if (action === null) return null;
  for (let set = 0; set < layout.length; set++) {
    const position = layout[set].indexOf(null);
    if (position < 0) continue;
    const next = layout.map((cells) => [...cells]);
    next[set][position] = action;
    return next;
  }
  return null;
}

/** The chord that opens arrange mode. One definition, so the pad that reads it and
 *  the hint that names it can never drift apart. */
export const CROSS_HOTBAR_ARRANGE_CHORD = { bumper: GP.LB, button: GP.Y } as const;

/** Which trigger is currently held, naming the eight slots it reaches. */
export type CrossHotbarLayer = 'left' | 'right';

/** The trigger button for a layer; the two buttons that never fire their own
 *  bound action while the cross hotbar is on (they are the modifier). */
export const CROSS_HOTBAR_TRIGGERS: Record<CrossHotbarLayer, number> = {
  left: GP.LT,
  right: GP.RT,
};

/** True for a trigger reserved as a cross-hotbar modifier. Unlike the eight
 * layer buttons, a modifier has no bare flat-binding behavior while the cross
 * hotbar is enabled. */
export function isCrossHotbarModifier(button: number): boolean {
  return button === CROSS_HOTBAR_TRIGGERS.left || button === CROSS_HOTBAR_TRIGGERS.right;
}

// The eight buttons one held trigger reaches, in display order: the d-pad
// diamond first, then the face diamond, each read top, left, right, bottom. The
// order is the panel's and the overlay's; the indices are physical POSITIONS
// (gamepad_map.ts explains why position, not silk-screen, is the stable key).
export const CROSS_HOTBAR_LAYER_BUTTONS: readonly number[] = [
  GP.DPAD_UP,
  GP.DPAD_LEFT,
  GP.DPAD_RIGHT,
  GP.DPAD_DOWN,
  GP.Y,
  GP.X,
  GP.B,
  GP.A,
];

// Compact glyphs for the on-screen bar. The options panel wants the full hardware
// name ("D-pad up"), but under a 44px cell that is noise: the cell already SITS in
// the diamond position it names, so the arrow alone reads faster and cannot crowd
// its neighbours. Face buttons keep their silk-screen letter, which is already short.
// ONE glyph, turned four ways. No two arrow (or triangle) characters in a font are
// drawn to the same size, and swapping between character sets only trades one
// mismatch for a smaller one; rotating a single glyph is the only way all four
// come out identical. The direction lives in CROSS_HOTBAR_DPAD_TURNS, which the
// overlay applies as a rotation.
const DPAD_GLYPH = '\u25B2';

export const CROSS_HOTBAR_DPAD_GLYPHS: Record<number, string> = {
  [GP.DPAD_UP]: DPAD_GLYPH,
  [GP.DPAD_LEFT]: DPAD_GLYPH,
  [GP.DPAD_RIGHT]: DPAD_GLYPH,
  [GP.DPAD_DOWN]: DPAD_GLYPH,
};

/** Degrees to turn the shared glyph by, per d-pad direction. */
export const CROSS_HOTBAR_DPAD_TURNS: Record<number, number> = {
  [GP.DPAD_UP]: 0,
  [GP.DPAD_LEFT]: -90,
  [GP.DPAD_RIGHT]: 90,
  [GP.DPAD_DOWN]: 180,
};

export const CROSS_HOTBAR_SLOTS_PER_LAYER = CROSS_HOTBAR_LAYER_BUTTONS.length;
export const CROSS_HOTBAR_SLOTS_PER_SET = CROSS_HOTBAR_SLOTS_PER_LAYER * 2;

// Two sets: the one a bare trigger hold reaches, and the one the opposite-trigger
// tap swaps to. Two is what the 34 action-bar slots actually fit (32 mirrored,
// the last two staying keyboard-only), so the count is derived from the slot
// budget rather than invented.
export const CROSS_HOTBAR_SET_COUNT = 2;
export const CROSS_HOTBAR_PRIMARY_SET = 0;
export const CROSS_HOTBAR_EXPANDED_SET = 1;

/** One cross-hotbar cell: the ability or item on it, or nothing. Structurally the
 *  HUD's HotbarAction, redeclared here so this pure game core owns no UI import. */
export type CrossHotbarAction = { type: 'ability' | 'item'; id: string } | null;

/** Per set, the sixteen actions the cross hotbar casts.
 *
 *  The bar owns its actions rather than pointing at action-bar slots. Mirroring
 *  the slots kept one loadout for both input devices, which sounds tidy and is
 *  wrong: the best pad layout is not the best keyboard layout, and a player
 *  arranging one was silently rearranging the other. It is SEEDED from the action
 *  bar once so nobody starts empty, and independent from then on. */
export type CrossHotbarLayout = readonly (readonly CrossHotbarAction[])[];

/** An empty bar: every cell unset, awaiting the one-time seed from the action bar. */
export function defaultCrossHotbarLayout(): CrossHotbarAction[][] {
  return Array.from({ length: CROSS_HOTBAR_SET_COUNT }, () =>
    Array.from({ length: CROSS_HOTBAR_SLOTS_PER_SET }, () => null as CrossHotbarAction),
  );
}

/** True once anything at all sits on the bar, so the one-time seed runs exactly
 *  once and never overwrites a layout the player has arranged. */
export function isCrossHotbarSeeded(layout: CrossHotbarLayout): boolean {
  return layout.some((set) => set.some((cell) => cell !== null));
}

/**
 * The one-time seed: the player's action bar in order, then the class's signature
 * extras appended to the first free cells. `extras` exists for actions a class
 * needs on a pad but that the action bar does not carry by default (a warrior's
 * stance is KNOWN at level one yet unbound, so a pad player could never reach it).
 * Anything already seeded from the bar is not added twice.
 */
export function seedCrossHotbarLayout(
  barActions: readonly CrossHotbarAction[],
  extras: readonly string[] = [],
): CrossHotbarAction[][] {
  const layout = defaultCrossHotbarLayout();
  const flat: CrossHotbarAction[] = [];
  for (const action of barActions) flat.push(action ?? null);
  const already = new Set(
    flat.filter((a): a is { type: 'ability' | 'item'; id: string } => a !== null).map((a) => a.id),
  );
  for (const id of extras) {
    if (already.has(id)) continue;
    already.add(id);
    const free = flat.indexOf(null);
    const cell: CrossHotbarAction = { type: 'ability', id };
    if (free >= 0) flat[free] = cell;
    else flat.push(cell);
  }
  for (let set = 0; set < CROSS_HOTBAR_SET_COUNT; set++) {
    for (let i = 0; i < CROSS_HOTBAR_SLOTS_PER_SET; i++) {
      layout[set][i] = flat[set * CROSS_HOTBAR_SLOTS_PER_SET + i] ?? null;
    }
  }
  return layout;
}

/** Position within a set (0 to 15) for a physical button under a held trigger, or
 *  null when the button is not one of the eight (a bumper, a stick click, Start). */
export function crossHotbarPosition(layer: CrossHotbarLayer, button: number): number | null {
  const within = CROSS_HOTBAR_LAYER_BUTTONS.indexOf(button);
  if (within < 0) return null;
  return layer === 'left' ? within : within + CROSS_HOTBAR_SLOTS_PER_LAYER;
}

/** True for a button the cross hotbar claims while a trigger is held, so the
 *  consumer knows to suppress that button's own flat binding for that chord. */
export function isCrossHotbarButton(button: number): boolean {
  return CROSS_HOTBAR_LAYER_BUTTONS.includes(button);
}

/** The action a press casts, or null when the button is unclaimed or the cell is
 *  empty. */
export function crossHotbarActionFor(
  layout: CrossHotbarLayout,
  set: number,
  layer: CrossHotbarLayer,
  button: number,
): CrossHotbarAction {
  const position = crossHotbarPosition(layer, button);
  if (position === null) return null;
  return layout[set]?.[position] ?? null;
}

/** The sixteen actions of one set, in display order, for the overlay. */
export function crossHotbarSetActions(
  layout: CrossHotbarLayout,
  set: number,
): readonly CrossHotbarAction[] {
  return layout[set] ?? [];
}

/** Live trigger state. `ltDown`/`rtDown` are carried so the reducer is a closed
 *  function of its own previous output plus this poll's two booleans: the
 *  opposite-trigger TAP is a rising edge, which needs last poll's reading. */
export interface CrossHotbarTriggerState {
  /** The trigger being held, or null when the cross hotbar is dormant. */
  hold: CrossHotbarLayer | null;
  /** Whether the opposite-trigger tap has swapped THIS HOLD to the other set. It
   *  lasts as long as the hold does, which is what makes it a reach rather than a
   *  switch. */
  expanded: boolean;
  /** Which set the bar sits on with nothing held. Survives holds, so it is the
   *  standing choice the set-switch button flips. */
  standing: boolean;
  ltDown: boolean;
  rtDown: boolean;
}

export const INITIAL_CROSS_HOTBAR_TRIGGER_STATE: CrossHotbarTriggerState = {
  hold: null,
  expanded: false,
  standing: false,
  ltDown: false,
  rtDown: false,
};

/**
 * Advance the trigger state one poll. A hold survives only while its own trigger
 * stays down; releasing it drops to the other trigger if that one is still held,
 * which is what a player rolling from one trigger to the other expects. While
 * holding, a rising edge on the opposite trigger toggles the expanded set (tapping
 * it again returns to the primary), so the second sixteen are a tap away and the
 * way back is the same tap.
 */
export function nextCrossHotbarTriggerState(
  prev: CrossHotbarTriggerState,
  ltDown: boolean,
  rtDown: boolean,
  expandEnabled: boolean,
): CrossHotbarTriggerState {
  const down = (layer: CrossHotbarLayer): boolean => (layer === 'left' ? ltDown : rtDown);
  let hold = prev.hold !== null && down(prev.hold) ? prev.hold : null;
  let expanded = hold !== null && prev.expanded;

  if (hold === null) {
    // Adopt whichever trigger is down. A same-poll tie resolves to the left one so
    // the result never depends on the order the two buttons happen to be read in.
    hold = ltDown ? 'left' : rtDown ? 'right' : null;
    expanded = false;
  } else if (expandEnabled) {
    const opposite: CrossHotbarLayer = hold === 'left' ? 'right' : 'left';
    const oppositeWasDown = opposite === 'left' ? prev.ltDown : prev.rtDown;
    if (down(opposite) && !oppositeWasDown) expanded = !expanded;
  }

  // `standing` is deliberately untouched: releasing a trigger must not undo the
  // set the player switched to, or the switch would last exactly one hold.
  return { hold, expanded, standing: prev.standing, ltDown, rtDown };
}

/**
 * Let go of the bar: the hold, the mid-hold reach and the two trigger latches drop
 * together. `standing` survives for the same reason the reducer above leaves it
 * alone: it is the set the player chose, not a part of this hold, and a window
 * opening or the window losing focus must not silently undo it.
 */
export function releaseCrossHotbarHold(state: CrossHotbarTriggerState): CrossHotbarTriggerState {
  return { ...INITIAL_CROSS_HOTBAR_TRIGGER_STATE, standing: state.standing };
}

/** Flip the standing set. The mid-hold reach is left alone: it is relative to
 *  whatever is standing, which is what makes the two compose. */
export function toggleCrossHotbarStandingSet(
  state: CrossHotbarTriggerState,
): CrossHotbarTriggerState {
  return { ...state, standing: !state.standing };
}

/**
 * The set a trigger state reads from: the standing choice, swapped while a hold
 * has reached across. Read as XOR rather than either flag alone, so tapping the
 * opposite trigger always means "the other set" no matter which one is standing.
 */
export function crossHotbarActiveSet(state: CrossHotbarTriggerState): number {
  return state.expanded !== state.standing ? CROSS_HOTBAR_EXPANDED_SET : CROSS_HOTBAR_PRIMARY_SET;
}

/**
 * Coerce a persisted (therefore untrusted) layout into a usable one, keeping every
 * entry that names a real action-bar slot and falling back to the default for the
 * rest. A shrunk or grown ACTION_BAR_SLOTS, a hand-edited storage value, and a
 * layout written by an older build all land here.
 */
export function sanitizeCrossHotbarLayout(raw: unknown): CrossHotbarAction[][] {
  const fallback = defaultCrossHotbarLayout();
  if (!Array.isArray(raw)) return fallback;
  return fallback.map((defaults, set) => {
    const storedSet = raw[set];
    if (!Array.isArray(storedSet)) return defaults;
    return defaults.map((_empty, position) => {
      const stored = storedSet[position];
      // A layout written before the bar owned its actions stored slot NUMBERS.
      // There is no way to resolve one here without the action bar, so it reads
      // as unset and the one-time seed refills the bar from the player's own
      // slots, which is what that migration should produce anyway.
      if (!stored || typeof stored !== 'object') return null;
      const { type, id } = stored as { type?: unknown; id?: unknown };
      if ((type !== 'ability' && type !== 'item') || typeof id !== 'string' || id === '') {
        return null;
      }
      return { type, id };
    });
  });
}
