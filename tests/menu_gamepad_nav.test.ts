import { describe, expect, it } from 'vitest';
import { GP, STANDARD_BUTTON_COUNT } from '../src/game/gamepad_map';
import {
  MENU_BUTTON_INTENTS,
  type MenuIntentKind,
  mapMenuGamepad,
} from '../src/game/menu_gamepad_nav';

// menu_gamepad_nav is a PURE core (no DOM, no navigator, deterministic): it maps a
// per-frame pad snapshot + the active-trap flag to menu intents and the set of button
// edges the wiring must swallow so world input never double-fires. It reuses the
// gamepad_map button vocabulary (GP.*), so a pad is never needed to prove it. The
// contract is same-input-same-output; there is no IWorld, so the Sim/ClientWorld parity
// row is N/A (like roving_index / dropdown_nav).

const N = STANDARD_BUTTON_COUNT;
const none = (): boolean[] => new Array(N).fill(false);
const press = (...idx: number[]): boolean[] => {
  const a = none();
  for (const i of idx) a[i] = true;
  return a;
};

// A frame that presses `buttons` as fresh rising edges (prev all-up) with the stick at
// rest, trap active unless overridden.
function edgeFrame(
  buttons: number[],
  opts: {
    trapActive?: boolean;
    stickX?: number;
    prevStickX?: number;
    adjustThreshold?: number;
  } = {},
) {
  return mapMenuGamepad({
    prev: none(),
    cur: press(...buttons),
    stickX: opts.stickX ?? 0,
    prevStickX: opts.prevStickX ?? 0,
    adjustThreshold: opts.adjustThreshold ?? 0.5,
    trapActive: opts.trapActive ?? true,
  });
}

// The full verb set of spec section 5, each mapped to a button (adjust also comes from
// the stick). Pins that no verb was dropped in the mapping.
const ALL_VERBS: MenuIntentKind[] = [
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
];

describe('menu_gamepad_nav: every controller verb maps to its button', () => {
  const cases: [number, MenuIntentKind][] = [
    [GP.LB, 'categoryPrev'],
    [GP.RB, 'categoryNext'],
    [GP.DPAD_UP, 'rowPrev'],
    [GP.DPAD_DOWN, 'rowNext'],
    [GP.DPAD_LEFT, 'adjustDec'],
    [GP.DPAD_RIGHT, 'adjustInc'],
    [GP.A, 'activate'],
    [GP.B, 'back'],
    [GP.Y, 'resetRow'],
    [GP.X, 'clearKeybind'],
    [GP.LT, 'pageUp'],
    [GP.RT, 'pageDown'],
  ];

  it('declares the exact button->intent table (no verb dropped, no extra)', () => {
    expect(new Set(Object.values(MENU_BUTTON_INTENTS))).toEqual(new Set(ALL_VERBS));
    // 12 distinct buttons carry the 12 verbs (adjust has a second, stick, source).
    expect(Object.keys(MENU_BUTTON_INTENTS)).toHaveLength(12);
  });

  it.each(
    cases,
  )('button %i yields exactly its intent and consumes its own edge', (button, intent) => {
    const r = edgeFrame([button]);
    expect(r.intents).toEqual([intent]);
    expect(r.consumedButtons).toEqual([button]);
  });
});

describe('menu_gamepad_nav: left-stick X value adjust (threshold + single-fire)', () => {
  it('fires adjustInc only on the crossing past +threshold, once, then not while held', () => {
    // rest -> past +threshold: one step
    expect(edgeFrame([], { stickX: 0.6, prevStickX: 0 }).intents).toEqual(['adjustInc']);
    // held past threshold: no repeat (keyboard single-step semantics)
    expect(edgeFrame([], { stickX: 0.7, prevStickX: 0.6 }).intents).toEqual([]);
    // dropped back below then crossing again: a fresh step
    expect(edgeFrame([], { stickX: 0.6, prevStickX: 0.2 }).intents).toEqual(['adjustInc']);
  });

  it('fires adjustDec crossing past -threshold, and nothing below the threshold', () => {
    expect(edgeFrame([], { stickX: -0.6, prevStickX: 0 }).intents).toEqual(['adjustDec']);
    // inside the threshold band: no adjust in either direction
    expect(edgeFrame([], { stickX: 0.4, prevStickX: 0 }).intents).toEqual([]);
    expect(edgeFrame([], { stickX: -0.4, prevStickX: 0 }).intents).toEqual([]);
  });

  it('never consumes a button for a stick move (the stick is not an edge)', () => {
    expect(edgeFrame([], { stickX: 0.9, prevStickX: 0 }).consumedButtons).toEqual([]);
  });

  it('coalesces a same-frame D-pad + stick adjust into a single step (mirror one keypress)', () => {
    const r = edgeFrame([GP.DPAD_RIGHT], { stickX: 0.9, prevStickX: 0 });
    expect(r.intents).toEqual(['adjustInc']); // not duplicated
    expect(r.consumedButtons).toEqual([GP.DPAD_RIGHT]);
  });
});

describe('menu_gamepad_nav: edges consumed EXACTLY when a trap is active', () => {
  it('consumes the handled edge and emits the intent while a trap is active', () => {
    const r = edgeFrame([GP.A], { trapActive: true });
    expect(r.intents).toEqual(['activate']);
    expect(r.consumedButtons).toEqual([GP.A]);
  });

  it('emits nothing and consumes nothing while no trap is active (world input flows)', () => {
    const r = edgeFrame([GP.A], { trapActive: false });
    expect(r.intents).toEqual([]);
    expect(r.consumedButtons).toEqual([]);
  });

  it('a stick move outside a trap produces no adjust (the menu does not own the pad)', () => {
    expect(edgeFrame([], { stickX: 0.9, prevStickX: 0, trapActive: false }).intents).toEqual([]);
  });

  it("consumes an UNMAPPED edge too, so the pad's Esc/world binding never double-fires", () => {
    // START defaults to the pad's Esc mapping; it is not a menu verb, but while the trap
    // owns the pad its edge must still be swallowed so it does not also close the menu.
    const r = edgeFrame([GP.START], { trapActive: true });
    expect(r.intents).toEqual([]); // no menu verb
    expect(r.consumedButtons).toEqual([GP.START]); // but consumed
  });

  it('consumes every rising edge of the frame in ascending button order', () => {
    const r = edgeFrame([GP.RB, GP.A, GP.START]); // 5, 0, 9 pressed
    expect(r.consumedButtons).toEqual([GP.A, GP.RB, GP.START]); // 0, 5, 9
    // intents keep the same ascending-by-button order for the mapped subset
    expect(r.intents).toEqual(['activate', 'categoryNext']);
  });

  it('only rising edges are consumed, not still-held buttons', () => {
    const r = mapMenuGamepad({
      prev: press(GP.A), // A already down last frame
      cur: press(GP.A, GP.B), // A held, B newly pressed
      stickX: 0,
      prevStickX: 0,
      adjustThreshold: 0.5,
      trapActive: true,
    });
    expect(r.consumedButtons).toEqual([GP.B]); // only the new edge
    expect(r.intents).toEqual(['back']); // B
  });
});
