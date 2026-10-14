// Pure model for the Key Bindings panel's "convert to keyboard layout" action.
// Bindings are stored as physical KeyboardEvent.codes (src/game/keybinds.ts), so
// a setup made for one OS layout keeps its POSITIONS on another: QWERTY's M
// (code KeyM) is the key that prints "," under AZERTY. Converting moves each
// binding to the key that prints the SAME character on the new layout, so a
// letter-named key (M for the map, B for bags) follows its letter. DOM-free and
// storage-free: the caller hands in the Keybinds snapshot and gets a converted
// snapshot back to apply through Keybinds.importBindings. Registered in
// tests/architecture.test.ts UI_PURE_CORES.
//
// Three rules keep the result playable:
// - Only the letter block converts (letters plus the punctuation keys around
//   them). The number row, F-keys, numpad, arrows, mouse and wheel stay put:
//   they are the action-bar row and named keys, not characters.
// - The codes bound to the actions in `pinnedActions` (the movement keys, when
//   the player keeps them in place) do not move, and nothing moves onto them,
//   so WASD stays the comfortable cluster under any layout.
// - The mapping is a PERMUTATION of the converted keys: a key whose character
//   the new layout lacks takes a key no character claimed, so no two bindings
//   ever land on one key, and converting back undoes the conversion exactly.

import type { TranslationKey } from './i18n';
import type { KeybindSetup } from './keybind_transfer_core';

export type KeyboardLayoutId =
  | 'qwerty-us'
  | 'qwerty-uk'
  | 'qwertz-de'
  | 'qwertz-ch'
  | 'azerty-fr'
  | 'azerty-be'
  | 'qwerty-es'
  | 'qwerty-it'
  | 'qwerty-nordic'
  | 'qwerty-da'
  | 'qwerty-no'
  | 'qwerty-br'
  | 'qwerty-pt'
  | 'qwerty-tr'
  | 'dvorak'
  | 'colemak';

/** The converted keys, row by row: the top letter row with its three trailing
 *  punctuation keys, the home row, then the bottom row from the ISO key left of
 *  Z (absent on ANSI boards). Each layout lists its printed character per code
 *  in this order. */
const TOP_CODES = [
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
  'BracketLeft',
  'BracketRight',
  'Backslash',
];
const HOME_CODES = [
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyJ',
  'KeyK',
  'KeyL',
  'Semicolon',
  'Quote',
];
const BOTTOM_CODES = [
  'IntlBackslash',
  'KeyZ',
  'KeyX',
  'KeyC',
  'KeyV',
  'KeyB',
  'KeyN',
  'KeyM',
  'Comma',
  'Period',
  'Slash',
];
export const CONVERTED_CODES: readonly string[] = [...TOP_CODES, ...HOME_CODES, ...BOTTOM_CODES];

export interface KeyboardLayoutSpec {
  id: KeyboardLayoutId;
  labelKey: TranslationKey;
  /** The unmodified character each converted code prints; a code the layout's
   *  usual board lacks (the ISO key on an ANSI board) is absent. */
  chars: ReadonlyMap<string, string>;
}

/** Build a layout's code -> character map from its three rows, each a
 *  space-separated character list in TOP/HOME/BOTTOM_CODES order ('_' marks a
 *  key the board does not have). */
function rows(top: string, home: string, bottom: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const fill = (codes: string[], list: string) => {
    const chars = list.split(' ');
    if (chars.length !== codes.length) throw new Error(`layout row needs ${codes.length} keys`);
    codes.forEach((code, i) => {
      if (chars[i] !== '_') out.set(code, chars[i]);
    });
  };
  fill(TOP_CODES, top);
  fill(HOME_CODES, home);
  fill(BOTTOM_CODES, bottom);
  return out;
}

/** The common desktop layouts, in picker order. */
export const KEYBOARD_LAYOUTS: readonly KeyboardLayoutSpec[] = [
  {
    id: 'qwerty-us',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyUs',
    chars: rows('q w e r t y u i o p [ ] \\', "a s d f g h j k l ; '", '_ z x c v b n m , . /'),
  },
  {
    id: 'qwerty-uk',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyUk',
    chars: rows('q w e r t y u i o p [ ] #', "a s d f g h j k l ; '", '\\ z x c v b n m , . /'),
  },
  {
    id: 'qwertz-de',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertzDe',
    chars: rows('q w e r t z u i o p ü + #', 'a s d f g h j k l ö ä', '< y x c v b n m , . -'),
  },
  {
    id: 'qwertz-ch',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertzCh',
    chars: rows('q w e r t z u i o p ü ¨ $', 'a s d f g h j k l ö ä', '< y x c v b n m , . -'),
  },
  {
    id: 'azerty-fr',
    labelKey: 'hudChrome.keybindLayout.layouts.azertyFr',
    chars: rows('a z e r t y u i o p ^ $ *', 'q s d f g h j k l m ù', '< w x c v b n , ; : !'),
  },
  {
    id: 'azerty-be',
    labelKey: 'hudChrome.keybindLayout.layouts.azertyBe',
    chars: rows('a z e r t y u i o p ^ $ µ', 'q s d f g h j k l m ù', '< w x c v b n , ; : ='),
  },
  {
    id: 'qwerty-es',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyEs',
    chars: rows('q w e r t y u i o p ` + ç', 'a s d f g h j k l ñ ´', '< z x c v b n m , . -'),
  },
  {
    id: 'qwerty-it',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyIt',
    chars: rows('q w e r t y u i o p è + ù', 'a s d f g h j k l ò à', '< z x c v b n m , . -'),
  },
  {
    id: 'qwerty-nordic',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyNordic',
    chars: rows("q w e r t y u i o p å ¨ '", 'a s d f g h j k l ö ä', '< z x c v b n m , . -'),
  },
  {
    id: 'qwerty-da',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyDa',
    chars: rows("q w e r t y u i o p å ¨ '", 'a s d f g h j k l æ ø', '< z x c v b n m , . -'),
  },
  {
    id: 'qwerty-no',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyNo',
    chars: rows("q w e r t y u i o p å ¨ '", 'a s d f g h j k l ø æ', '< z x c v b n m , . -'),
  },
  {
    id: 'qwerty-br',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyBr',
    chars: rows('q w e r t y u i o p ´ [ ]', 'a s d f g h j k l ç ~', '\\ z x c v b n m , . ;'),
  },
  {
    id: 'qwerty-pt',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyPt',
    chars: rows('q w e r t y u i o p + ´ ~', 'a s d f g h j k l ç º', '< z x c v b n m , . -'),
  },
  {
    // Turkish Q: the dotless ı sits on QWERTY's I key and the dotted i on the
    // quote key, so an I hotkey follows the i the player types.
    id: 'qwerty-tr',
    labelKey: 'hudChrome.keybindLayout.layouts.qwertyTr',
    chars: rows('q w e r t y u ı o p ğ ü ,', 'a s d f g h j k l ş i', '< z x c v b n m ö ç .'),
  },
  {
    id: 'dvorak',
    labelKey: 'hudChrome.keybindLayout.layouts.dvorak',
    chars: rows("' , . p y f g c r l / = \\", 'a o e u i d h t n s -', '_ ; q j k x b m w v z'),
  },
  {
    id: 'colemak',
    labelKey: 'hudChrome.keybindLayout.layouts.colemak',
    chars: rows('q w f p g j l u y ; [ ] \\', "a r s t d h n e i o '", '_ z x c v b k m , . /'),
  },
];

/** The layout the default bindings were authored for. */
export const DEFAULT_SOURCE_LAYOUT: KeyboardLayoutId = 'qwerty-us';

const LAYOUT_BY_ID = new Map(KEYBOARD_LAYOUTS.map((l) => [l.id, l]));

export function isKeyboardLayoutId(id: string): id is KeyboardLayoutId {
  return LAYOUT_BY_ID.has(id as KeyboardLayoutId);
}

/** The code -> code move that converts `from` bindings to `to`, over the
 *  converted keys minus `pinned`. Codes it leaves out stay where they are. */
export function layoutCodeMap(
  from: KeyboardLayoutId,
  to: KeyboardLayoutId,
  pinned: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const src = LAYOUT_BY_ID.get(from)?.chars;
  const tgt = LAYOUT_BY_ID.get(to)?.chars;
  const move = new Map<string, string>();
  if (!src || !tgt || from === to) return move;
  const keys = CONVERTED_CODES.filter((c) => !pinned.has(c));
  // The new layout's key for each character; the first key wins a duplicate.
  const keyFor = new Map<string, string>();
  for (const code of keys) {
    const ch = tgt.get(code);
    if (ch !== undefined && !keyFor.has(ch)) keyFor.set(ch, code);
  }
  const claimed = new Set<string>();
  const unplaced: string[] = [];
  for (const code of keys) {
    const ch = src.get(code);
    const dest = ch === undefined ? undefined : keyFor.get(ch);
    if (dest === undefined || claimed.has(dest)) {
      unplaced.push(code);
      continue;
    }
    move.set(code, dest);
    claimed.add(dest);
  }
  // Keys whose character the new layout lacks: stay put when nothing claimed
  // the spot, otherwise take the remaining unclaimed keys in board order.
  const free = keys.filter((c) => !claimed.has(c));
  const freeSet = new Set(free);
  const stay = unplaced.filter((c) => freeSet.has(c));
  for (const code of stay) move.set(code, code);
  const staySet = new Set(stay);
  const open = free.filter((c) => !staySet.has(c));
  unplaced
    .filter((c) => !staySet.has(c))
    .forEach((code, i) => {
      move.set(code, open[i]);
    });
  return move;
}

export interface LayoutConversion {
  binds: KeybindSetup;
  /** How many bindings land on a different key. */
  moved: number;
}

/** Convert a Keybinds snapshot from one layout to another. Modifier prefixes
 *  ride along ("Shift+KeyM" -> "Shift+Semicolon"). Every code bound to an
 *  action in `pinnedActions` stays where it is, in every slot and layer. */
export function convertBindingsLayout(
  binds: KeybindSetup,
  from: KeyboardLayoutId,
  to: KeyboardLayoutId,
  pinnedActions: ReadonlySet<string> = new Set(),
): LayoutConversion {
  const pinned = new Set<string>();
  for (const id of pinnedActions) {
    for (const combo of binds[id] ?? []) if (combo) pinned.add(bareCode(combo));
  }
  const move = layoutCodeMap(from, to, pinned);
  const out: KeybindSetup = {};
  let moved = 0;
  for (const [id, slots] of Object.entries(binds)) {
    out[id] = slots.map((combo) => {
      if (!combo) return combo;
      const code = bareCode(combo);
      const dest = move.get(code);
      if (dest === undefined || dest === code) return combo;
      moved++;
      return combo.slice(0, combo.length - code.length) + dest;
    });
  }
  return { binds: out, moved };
}

/** The bare code of a combo: the part after the last modifier "+". */
function bareCode(combo: string): string {
  return combo.slice(combo.lastIndexOf('+') + 1);
}

/** The listed layout the OS layout matches, or null. `printed` returns the
 *  character the active layout prints for a code (null when unknown, as
 *  navigator.keyboard.getLayoutMap reports it). Every letter key must match;
 *  ties on the punctuation go to the earlier, more common layout. */
export function detectKeyboardLayout(
  printed: (code: string) => string | null,
): KeyboardLayoutId | null {
  let best: KeyboardLayoutId | null = null;
  let bestScore = -1;
  for (const layout of KEYBOARD_LAYOUTS) {
    let score = 0;
    let ok = true;
    for (const [code, ch] of layout.chars) {
      const p = printed(code);
      const same = p !== null && p.toUpperCase() === ch.toUpperCase();
      if (same) score++;
      else if (code.startsWith('Key')) {
        ok = false;
        break;
      }
    }
    if (ok && score > bestScore) {
      best = layout.id;
      bestScore = score;
    }
  }
  return best;
}
