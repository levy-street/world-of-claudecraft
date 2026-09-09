// Pure model for the Key Bindings panel's keyboard overview: a desktop keyboard
// in the player's chosen form factor (full size with numpad, tenkeyless, 75%,
// 60%) plus the three bindable mouse buttons, each key annotated with what the
// player's current bindings put on it. DOM-free and game-free: the caller hands
// in the Keybinds snapshot (actionId -> [primary, secondary] combos) and
// resolvers for the key legend, the action's display name and its category,
// and gets back the blocks the painter (keyboard_map.ts) lays out plus the
// bindings that sit on keys the chosen board does not have. Registered in
// tests/architecture.test.ts UI_PURE_CORES.
//
// A binding is a combo string: the bare KeyboardEvent.code, optionally prefixed
// by modifiers in canonical order ("Shift+Digit1", see src/game/keybinds.ts).
// The overview shows one modifier LAYER at a time (none, Shift, Ctrl, Alt): a
// key is painted with the binding it carries in the selected layer, and marked
// when it also carries bindings in other layers, all of which the key's
// tooltip / detail line lists.

import type { TranslationKey } from './i18n';

/** A modifier layer: the canonical combo head, '' for the bare key. */
export type KeyboardLayer = '' | 'Shift+' | 'Ctrl+' | 'Alt+';

export const KEYBOARD_LAYERS: { id: KeyboardLayer; labelKey: TranslationKey }[] = [
  { id: '', labelKey: 'hudChrome.keyboardMap.layerNone' },
  { id: 'Shift+', labelKey: 'hudChrome.keyboardMap.layerShift' },
  { id: 'Ctrl+', labelKey: 'hudChrome.keyboardMap.layerCtrl' },
  { id: 'Alt+', labelKey: 'hudChrome.keyboardMap.layerAlt' },
];

/** The physical board sizes the overview can draw. A browser cannot detect
 *  which one is plugged in, so the player picks (keyboard_layout_pref_core.ts). */
export type KeyboardFormFactor = 'full' | 'tkl' | '75' | '60';

export const KEYBOARD_FORM_FACTORS: { id: KeyboardFormFactor; labelKey: TranslationKey }[] = [
  { id: 'full', labelKey: 'hudChrome.keyboardMap.formFull' },
  { id: 'tkl', labelKey: 'hudChrome.keyboardMap.formTkl' },
  { id: '75', labelKey: 'hudChrome.keyboardMap.form75' },
  { id: '60', labelKey: 'hudChrome.keyboardMap.form60' },
];

/** Which characters the caps print when the OS layout is not QWERTY: that
 *  layout's (a Colemak player types F on the key QWERTY calls E) or QWERTY's,
 *  which is what is physically printed on most boards. A key is its physical
 *  code either way, so both labellings point at the same binding. */
export type KeyboardLegendSource = 'layout' | 'qwerty';

export const KEYBOARD_LEGEND_SOURCES: { id: KeyboardLegendSource; labelKey: TranslationKey }[] = [
  { id: 'layout', labelKey: 'hudChrome.keyboardMap.legendLayout' },
  { id: 'qwerty', labelKey: 'hudChrome.keyboardMap.legendQwerty' },
];

/** The codes whose printed character a layout can move: letters and digits.
 *  Punctuation is left out on purpose, since ISO and ANSI boards already
 *  disagree on those under plain QWERTY and would flag every non-US board. */
const LAYOUT_SENSITIVE_CODES = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
];

/** Whether the reported layout prints a different character than QWERTY on
 *  any letter or digit key. `printed` returns the layout's character for a
 *  code (null when unknown); `qwerty` the code's QWERTY label. */
export function legendsDifferFromQwerty(
  printed: (code: string) => string | null,
  qwerty: (code: string) => string,
): boolean {
  return LAYOUT_SENSITIVE_CODES.some((code) => {
    const p = printed(code);
    return p !== null && p.toUpperCase() !== qwerty(code).toUpperCase();
  });
}

/** One physical key: its KeyboardEvent.code, width and height in key units
 *  (1 = a letter key), and an optional legend override for keys whose code
 *  label is too long for a keycap. A `spacer` is an empty cell that keeps the
 *  row geometry (the gap between F-key groups, the arrow cluster's blank). */
export interface KeyboardKeySpec {
  code: string;
  w?: number;
  h?: number;
  legend?: string;
  spacer?: boolean;
}

export type KeyboardBlockId = 'main' | 'nav' | 'numpad' | 'mouse';

export interface KeyboardBlockSpec {
  id: KeyboardBlockId;
  /** Width in key units; the painter's grid uses quarter-unit columns. */
  units: number;
  rows: KeyboardKeySpec[][];
}

const gap = (w: number): KeyboardKeySpec => ({ code: '', w, spacer: true });
const keys = (...codes: string[]): KeyboardKeySpec[] => codes.map((code) => ({ code }));
const key = (code: string, w: number, legend?: string): KeyboardKeySpec =>
  legend === undefined ? { code, w } : { code, w, legend };

// The rows every form factor shares (ANSI-style).
const F_ROW: KeyboardKeySpec[] = [
  { code: 'Escape' },
  gap(1),
  ...keys('F1', 'F2', 'F3', 'F4'),
  gap(0.5),
  ...keys('F5', 'F6', 'F7', 'F8'),
  gap(0.5),
  ...keys('F9', 'F10', 'F11', 'F12'),
];
const NUMBER_ROW: KeyboardKeySpec[] = keys(
  'Backquote',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
  'Minus',
  'Equal',
);
const TOP_LETTERS = keys(
  'KeyQ',
  'KeyW',
  'KeyE',
  'KeyR',
  'KeyT',
  'KeyY',
  'KeyU',
  'KeyI',
  'KeyO',
  'KeyP',
);
const HOME_LETTERS = keys('KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL');
const BOTTOM_LETTERS = keys('KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM');

/** The 15-unit main block of a full size, tenkeyless or 60% board. */
const MAIN_ROWS: KeyboardKeySpec[][] = [
  [...NUMBER_ROW, key('Backspace', 2, 'Bksp')],
  [key('Tab', 1.5), ...TOP_LETTERS, ...keys('BracketLeft', 'BracketRight'), key('Backslash', 1.5)],
  [key('CapsLock', 1.75), ...HOME_LETTERS, ...keys('Semicolon', 'Quote'), key('Enter', 2.25)],
  [
    key('ShiftLeft', 2.25, 'Shift'),
    ...BOTTOM_LETTERS,
    ...keys('Comma', 'Period', 'Slash'),
    key('ShiftRight', 2.75, 'Shift'),
  ],
  [
    key('ControlLeft', 1.25, 'Ctrl'),
    key('MetaLeft', 1.25, 'Meta'),
    key('AltLeft', 1.25, 'Alt'),
    key('Space', 6.25),
    key('AltRight', 1.25, 'Alt'),
    key('MetaRight', 1.25, 'Meta'),
    key('ContextMenu', 1.25, 'Menu'),
    key('ControlRight', 1.25, 'Ctrl'),
  ],
];

const NAV_BLOCK: KeyboardBlockSpec = {
  id: 'nav',
  units: 3,
  rows: [
    [gap(3)],
    [{ code: 'Insert', legend: 'Ins' }, { code: 'Home' }, { code: 'PageUp', legend: 'PgUp' }],
    [{ code: 'Delete', legend: 'Del' }, { code: 'End' }, { code: 'PageDown', legend: 'PgDn' }],
    [gap(3)],
    [gap(1), { code: 'ArrowUp' }, gap(1)],
    [{ code: 'ArrowLeft' }, { code: 'ArrowDown' }, { code: 'ArrowRight' }],
  ],
};

const NUMPAD_BLOCK: KeyboardBlockSpec = {
  id: 'numpad',
  units: 4,
  rows: [
    [gap(4)],
    [
      { code: 'NumLock', legend: 'Num' },
      { code: 'NumpadDivide', legend: '/' },
      { code: 'NumpadMultiply', legend: '*' },
      { code: 'NumpadSubtract', legend: '-' },
    ],
    [
      { code: 'Numpad7', legend: '7' },
      { code: 'Numpad8', legend: '8' },
      { code: 'Numpad9', legend: '9' },
      { code: 'NumpadAdd', legend: '+', h: 2 },
    ],
    [
      { code: 'Numpad4', legend: '4' },
      { code: 'Numpad5', legend: '5' },
      { code: 'Numpad6', legend: '6' },
    ],
    [
      { code: 'Numpad1', legend: '1' },
      { code: 'Numpad2', legend: '2' },
      { code: 'Numpad3', legend: '3' },
      { code: 'NumpadEnter', legend: 'Enter', h: 2 },
    ],
    [
      { code: 'Numpad0', legend: '0', w: 2 },
      { code: 'NumpadDecimal', legend: '.' },
    ],
  ],
};

/** The mouse buttons, with a spacer row when the board has an F row to align to. */
const mouseBlock = (fRow: boolean): KeyboardBlockSpec => ({
  id: 'mouse',
  units: 1,
  rows: [
    ...(fRow ? [[gap(1)]] : []),
    [{ code: 'Mouse3' }],
    [{ code: 'Mouse4' }],
    [{ code: 'Mouse5' }],
  ],
});

/** A 75% board: the main block with a right-hand column (Del, Home, PgUp,
 *  PgDn, End) and the arrow cluster tucked into the bottom two rows, 16 units. */
const MAIN_75: KeyboardBlockSpec = {
  id: 'main',
  units: 16,
  rows: [
    [...F_ROW, { code: 'Delete', legend: 'Del' }],
    [...MAIN_ROWS[0], { code: 'Home' }],
    [...MAIN_ROWS[1], { code: 'PageUp', legend: 'PgUp' }],
    [...MAIN_ROWS[2], { code: 'PageDown', legend: 'PgDn' }],
    [
      key('ShiftLeft', 2.25, 'Shift'),
      ...BOTTOM_LETTERS,
      ...keys('Comma', 'Period', 'Slash'),
      key('ShiftRight', 1.75, 'Shift'),
      { code: 'ArrowUp' },
      { code: 'End' },
    ],
    [
      key('ControlLeft', 1.25, 'Ctrl'),
      key('MetaLeft', 1.25, 'Meta'),
      key('AltLeft', 1.25, 'Alt'),
      key('Space', 6.25),
      key('AltRight', 1, 'Alt'),
      key('ContextMenu', 1, 'Menu'),
      key('ControlRight', 1, 'Ctrl'),
      ...keys('ArrowLeft', 'ArrowDown', 'ArrowRight'),
    ],
  ],
};

/** The layout for a form factor. Row 0 of every block lines up with the F row
 *  where the board has one. */
export function keyboardLayoutFor(formFactor: KeyboardFormFactor): KeyboardBlockSpec[] {
  const main: KeyboardBlockSpec = { id: 'main', units: 15, rows: [F_ROW, ...MAIN_ROWS] };
  switch (formFactor) {
    case 'full':
      return [main, NAV_BLOCK, NUMPAD_BLOCK, mouseBlock(true)];
    case 'tkl':
      return [main, NAV_BLOCK, mouseBlock(true)];
    case '75':
      return [MAIN_75, mouseBlock(true)];
    case '60':
      return [{ id: 'main', units: 15, rows: MAIN_ROWS }, mouseBlock(false)];
  }
}

/** The full size layout, the one every default binding has a cap on. */
export const KEYBOARD_LAYOUT: KeyboardBlockSpec[] = keyboardLayoutFor('full');

/** A binding riding on a key, in any layer. `index` is the action's slot the
 *  combo sits in (0 primary, 1 alternate), what a rebind or unbind targets. */
export interface KeyboardKeyBinding {
  actionId: string;
  index: number;
  combo: string;
  name: string;
  category: string;
}

export interface KeyboardKeyView {
  code: string;
  legend: string;
  w: number;
  h: number;
  spacer: boolean;
  /** The binding shown on the cap: the first one in the selected layer. */
  layerBinding: KeyboardKeyBinding | null;
  /** Every binding on this physical key, all layers, layer-then-action order. */
  bindings: KeyboardKeyBinding[];
  /** True when a binding exists in a layer other than the selected one. */
  otherLayers: boolean;
}

export interface KeyboardBlockView {
  id: KeyboardBlockId;
  units: number;
  rows: KeyboardKeyView[][];
}

export interface KeyboardMapView {
  blocks: KeyboardBlockView[];
  /** Bindings on keys the chosen form factor does not draw (a numpad bind on a
   *  tenkeyless board), so the overview can still list them. */
  hidden: KeyboardKeyBinding[];
}

export interface KeyboardMapDeps {
  /** Short keycap label for a bare code (keyLabel from src/game/keybinds, or
   *  the browser's real printed legend where available). */
  legend: (code: string) => string;
  name: (actionId: string) => string;
  category: (actionId: string) => string;
}

/** Split a combo into its modifier head ("Shift+", "" for none) and bare code. */
export function splitCombo(combo: string): { head: string; code: string } {
  const at = combo.lastIndexOf('+');
  // A trailing '+' is not a code separator (no code is empty), so only an
  // interior '+' splits; "Shift+Digit1" -> head "Shift+", code "Digit1".
  if (at <= 0 || at === combo.length - 1) return { head: '', code: combo };
  return { head: combo.slice(0, at + 1), code: combo.slice(at + 1) };
}

/** Category name -> the painter's class suffix ("Action Bar" -> "action-bar"). */
export function categoryClass(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Index every binding by its bare code, in registry order. */
function bindingsByCode(
  snapshot: Record<string, (string | null)[]>,
  deps: KeyboardMapDeps,
): Map<string, KeyboardKeyBinding[]> {
  const out = new Map<string, KeyboardKeyBinding[]>();
  for (const [actionId, combos] of Object.entries(snapshot)) {
    combos.forEach((combo, index) => {
      if (typeof combo !== 'string' || combo.length === 0) return;
      const { code } = splitCombo(combo);
      const list = out.get(code) ?? [];
      list.push({
        actionId,
        index,
        combo,
        name: deps.name(actionId),
        category: deps.category(actionId),
      });
      out.set(code, list);
    });
  }
  return out;
}

/** Annotate the `formFactor` layout with the snapshot's bindings for `layer`. */
export function buildKeyboardMap(
  snapshot: Record<string, (string | null)[]>,
  layer: KeyboardLayer,
  deps: KeyboardMapDeps,
  formFactor: KeyboardFormFactor = 'full',
): KeyboardMapView {
  const byCode = bindingsByCode(snapshot, deps);
  const drawn = new Set<string>();
  const blocks = keyboardLayoutFor(formFactor).map((block) => ({
    id: block.id,
    units: block.units,
    rows: block.rows.map((row) =>
      row.map((spec): KeyboardKeyView => {
        if (!spec.spacer) drawn.add(spec.code);
        const all = spec.spacer ? [] : (byCode.get(spec.code) ?? []);
        // Selected layer first so the cap and the detail line agree on order.
        const inLayer = all.filter((b) => splitCombo(b.combo).head === layer);
        const elsewhere = all.filter((b) => splitCombo(b.combo).head !== layer);
        return {
          code: spec.code,
          legend: spec.spacer ? '' : (spec.legend ?? deps.legend(spec.code)),
          w: spec.w ?? 1,
          h: spec.h ?? 1,
          spacer: spec.spacer === true,
          layerBinding: inLayer[0] ?? null,
          bindings: [...inLayer, ...elsewhere],
          otherLayers: elsewhere.length > 0,
        };
      }),
    ),
  }));
  const hidden: KeyboardKeyBinding[] = [];
  for (const [code, list] of byCode) if (!drawn.has(code)) hidden.push(...list);
  return { blocks, hidden };
}

/** Every bindable code the `formFactor` layout can show (no spacers). */
export function keyboardLayoutCodes(formFactor: KeyboardFormFactor = 'full'): string[] {
  const codes: string[] = [];
  for (const block of keyboardLayoutFor(formFactor))
    for (const row of block.rows) for (const k of row) if (!k.spacer) codes.push(k.code);
  return codes;
}
