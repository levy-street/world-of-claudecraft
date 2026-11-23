// The Key Bindings panel's keyboard-layout converter
// (src/ui/keyboard_layout_convert_core.ts): the layout tables, the code move
// (a permutation of the letter block, so nothing ever collides and converting
// back is exact), the movement pin, and the OS-layout detection.

import { beforeEach, describe, expect, it } from 'vitest';
import { Keybinds } from '../src/game/keybinds';
import type { KeybindSetup } from '../src/ui/keybind_transfer_core';
import {
  CONVERTED_CODES,
  convertBindingsLayout,
  detectKeyboardLayout,
  isKeyboardLayoutId,
  KEYBOARD_LAYOUTS,
  type KeyboardLayoutId,
  layoutCodeMap,
} from '../src/ui/keyboard_layout_convert_core';

// The keep-in-place set the panel row pins (MOVEMENT_ACTION_IDS in
// keybind_layout_convert_rows.ts, pinned to these six literally in
// tests/keybind_layout_convert_rows.test.ts).
const MOVEMENT = new Set(['forward', 'back', 'turnLeft', 'turnRight', 'strafeLeft', 'strafeRight']);
const IDS = KEYBOARD_LAYOUTS.map((l) => l.id);
const layout = (id: KeyboardLayoutId) => KEYBOARD_LAYOUTS.find((l) => l.id === id)!;

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

function defaults(): KeybindSetup {
  installStorage();
  return new Keybinds().snapshot();
}

describe('keyboard_layout_convert_core: layout tables', () => {
  it('lists the common layouts, each with every letter exactly once on a letter-block key', () => {
    expect(IDS).toEqual([
      'qwerty-us',
      'qwerty-uk',
      'qwertz-de',
      'qwertz-ch',
      'azerty-fr',
      'azerty-be',
      'qwerty-es',
      'qwerty-it',
      'qwerty-nordic',
      'qwerty-da',
      'qwerty-no',
      'qwerty-br',
      'qwerty-pt',
      'qwerty-tr',
      'dvorak',
      'colemak',
    ]);
    for (const l of KEYBOARD_LAYOUTS) {
      const chars = [...l.chars.values()];
      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        expect(
          chars.filter((c) => c === letter),
          `${l.id} ${letter}`,
        ).toHaveLength(1);
      }
      for (const code of l.chars.keys()) expect(CONVERTED_CODES).toContain(code);
      expect(isKeyboardLayoutId(l.id)).toBe(true);
    }
    expect(isKeyboardLayoutId('qwerty')).toBe(false);
  });

  it('spells the letter rows of the layouts whose letters move', () => {
    const letters = (id: KeyboardLayoutId, codes: string[]) =>
      codes.map((c) => layout(id).chars.get(c)).join('');
    const top = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'];
    const home = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'];
    const bottom = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'];
    expect(letters('qwerty-us', top)).toBe('qwertyuiop');
    expect(letters('qwertz-de', top)).toBe('qwertzuiop');
    expect(letters('qwertz-de', bottom)).toBe('yxcvbnm');
    expect(letters('azerty-fr', top)).toBe('azertyuiop');
    expect(letters('azerty-fr', home)).toBe('qsdfghjkl');
    expect(layout('azerty-fr').chars.get('Semicolon')).toBe('m');
    expect(letters('azerty-fr', bottom)).toBe('wxcvbn,');
    expect(letters('dvorak', home)).toBe('aoeuidhtn');
    expect(letters('colemak', top)).toBe('qwfpgjluy;');
    // Turkish Q: dotless ı on the I key, the dotted i on the quote key.
    expect(letters('qwerty-tr', top)).toBe('qwertyuıop');
    expect(layout('qwerty-tr').chars.get('Quote')).toBe('i');
    expect(letters('colemak', home)).toBe('arstdhnei');
    // The punctuation around the letters, which the detector and the
    // leftover pairing both lean on.
    const punct = (id: KeyboardLayoutId) =>
      ['BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'IntlBackslash', 'Slash']
        .map((c) => layout(id).chars.get(c) ?? '_')
        .join(' ');
    expect(punct('qwerty-us')).toBe("[ ] \\ ; ' _ /");
    expect(punct('qwerty-uk')).toBe("[ ] # ; ' \\ /");
    expect(punct('qwertz-de')).toBe('ü + # ö ä < -');
    expect(punct('qwertz-ch')).toBe('ü ¨ $ ö ä < -');
    expect(punct('azerty-fr')).toBe('^ $ * m ù < !');
    expect(punct('azerty-be')).toBe('^ $ µ m ù < =');
    expect(punct('qwerty-es')).toBe('` + ç ñ ´ < -');
    expect(punct('qwerty-it')).toBe('è + ù ò à < -');
    expect(punct('qwerty-nordic')).toBe("å ¨ ' ö ä < -");
    expect(punct('qwerty-da')).toBe("å ¨ ' æ ø < -");
    expect(punct('qwerty-no')).toBe("å ¨ ' ø æ < -");
    expect(punct('qwerty-br')).toBe('´ [ ] ç ~ \\ ;');
    expect(punct('qwerty-pt')).toBe('+ ´ ~ ç º < -');
    expect(punct('qwerty-tr')).toBe('ğ ü , ş i < .');
    expect(punct('dvorak')).toBe('/ = \\ s - _ z');
    expect(punct('colemak')).toBe("[ ] \\ o ' _ /");
    // ANSI layouts have no key left of Z.
    expect(layout('qwerty-us').chars.has('IntlBackslash')).toBe(false);
    expect(layout('qwerty-uk').chars.get('IntlBackslash')).toBe('\\');
  });
});

describe('keyboard_layout_convert_core: the code move', () => {
  it('is a permutation of the letter block minus the pinned keys, for every layout pair', () => {
    const pinned = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
    for (const from of IDS) {
      for (const to of IDS) {
        if (from === to) continue;
        for (const pin of [new Set<string>(), pinned]) {
          const move = layoutCodeMap(from, to, pin);
          const keys = CONVERTED_CODES.filter((c) => !pin.has(c));
          expect([...move.keys()].sort(), `${from}->${to}`).toEqual([...keys].sort());
          expect([...move.values()].sort(), `${from}->${to} targets`).toEqual([...keys].sort());
        }
      }
    }
  });

  it('moves a letter to the key that prints it on the new layout', () => {
    const move = layoutCodeMap('qwerty-us', 'azerty-fr');
    expect(move.get('KeyM')).toBe('Semicolon');
    expect(move.get('KeyQ')).toBe('KeyA');
    expect(move.get('KeyA')).toBe('KeyQ');
    expect(move.get('KeyW')).toBe('KeyZ');
    expect(move.get('KeyZ')).toBe('KeyW');
    expect(move.get('KeyC')).toBe('KeyC');
    expect(layoutCodeMap('qwerty-us', 'qwertz-de').get('KeyZ')).toBe('KeyY');
    expect(layoutCodeMap('qwerty-us', 'dvorak').get('KeyE')).toBe('KeyD');
    expect(layoutCodeMap('qwerty-us', 'colemak').get('KeyK')).toBe('KeyN');
    expect(layoutCodeMap('qwerty-us', 'colemak').get('KeyE')).toBe('KeyK');
  });

  it('never moves anything onto or off a pinned key', () => {
    const move = layoutCodeMap('qwerty-us', 'azerty-fr', new Set(['KeyW']));
    expect(move.has('KeyW')).toBe(false);
    expect([...move.values()]).not.toContain('KeyW');
    // AZERTY prints z on the pinned KeyW, so Z's binding has nowhere to follow
    // its letter and keeps its own key, which nothing else claimed.
    expect(move.get('KeyZ')).toBe('KeyZ');
  });

  it('is empty for the same layout or an unknown one', () => {
    expect(layoutCodeMap('dvorak', 'dvorak').size).toBe(0);
    expect(layoutCodeMap('dvorak', 'nope' as KeyboardLayoutId).size).toBe(0);
    expect(layoutCodeMap('nope' as KeyboardLayoutId, 'dvorak').size).toBe(0);
  });
});

describe('keyboard_layout_convert_core: converting a setup', () => {
  beforeEach(installStorage);

  it('converts the default setup to AZERTY with movement kept in place', () => {
    const before = defaults();
    const { binds, moved } = convertBindingsLayout(before, 'qwerty-us', 'azerty-fr', MOVEMENT);
    // Movement stays on the physical WASD/QE cluster.
    expect(binds.forward[0]).toBe('KeyW');
    expect(binds.turnLeft[0]).toBe('KeyA');
    expect(binds.strafeLeft[0]).toBe('KeyQ');
    expect(binds.forward[1]).toBe('ArrowUp');
    // Letter-named keys follow their letter; the number row never moves.
    expect(binds.map[0]).toBe('Semicolon');
    // Only the move and turn keys are pinned: the Emote Wheel's X and the
    // Reliquary's Shift+X follow their letter like any other hotkey.
    const dvorak = convertBindingsLayout(before, 'qwerty-us', 'dvorak', MOVEMENT).binds;
    expect(dvorak.emoteWheel[0]).toBe('KeyB');
    expect(dvorak.reliquary[0]).toBe('Shift+KeyB');
    expect(binds.bags[0]).toBe('KeyB');
    expect(binds.slot0[0]).toBe('Digit1');
    expect(binds.slot9[0]).toBe('Digit0');
    expect(moved).toBeGreaterThan(0);
    // The input was not mutated.
    expect(before.map[0]).toBe('KeyM');
  });

  it('moves the movement keys too when they are not kept in place', () => {
    const { binds } = convertBindingsLayout(defaults(), 'qwerty-us', 'azerty-fr');
    expect(binds.forward).toEqual(['KeyZ', 'ArrowUp']);
    expect(binds.turnLeft).toEqual(['KeyQ', 'ArrowLeft']);
    expect(binds.strafeLeft[0]).toBe('KeyA');
  });

  it('carries modifiers and leaves non-letter keys, mouse and wheel alone', () => {
    const setup: KeybindSetup = {
      a: ['Shift+KeyM', 'Ctrl+Alt+KeyQ'],
      b: ['Mouse4', 'WheelUp'],
      c: ['Numpad1', 'F5'],
      d: [null, 'Shift+Digit1'],
    };
    const { binds, moved } = convertBindingsLayout(setup, 'qwerty-us', 'azerty-fr');
    expect(binds.a).toEqual(['Shift+Semicolon', 'Ctrl+Alt+KeyA']);
    expect(binds.b).toEqual(['Mouse4', 'WheelUp']);
    expect(binds.c).toEqual(['Numpad1', 'F5']);
    expect(binds.d).toEqual([null, 'Shift+Digit1']);
    expect(moved).toBe(2);
  });

  it('undoes itself key by key over the whole letter block, for every pair', () => {
    const pins = [new Set<string>(), new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])];
    for (const from of IDS) {
      for (const to of IDS) {
        if (from === to) continue;
        for (const pin of pins) {
          const there = layoutCodeMap(from, to, pin);
          const back = layoutCodeMap(to, from, pin);
          for (const code of CONVERTED_CODES) {
            if (pin.has(code)) continue;
            expect(back.get(there.get(code) ?? ''), `${from}->${to} ${code}`).toBe(code);
          }
        }
      }
    }
  });

  it('pins a movement key in every slot and modifier layer', () => {
    const setup: KeybindSetup = { forward: ['KeyI', 'KeyW'], other: ['Shift+KeyI', 'Alt+KeyW'] };
    const { binds } = convertBindingsLayout(setup, 'qwerty-us', 'dvorak', MOVEMENT);
    // KeyI is pinned only because forward's PRIMARY is on it.
    expect(binds.forward).toEqual(['KeyI', 'KeyW']);
    expect(binds.other).toEqual(['Shift+KeyI', 'Alt+KeyW']);
    // Without the pin both follow their letters.
    const free = convertBindingsLayout(setup, 'qwerty-us', 'dvorak').binds;
    expect(free.forward).toEqual(['KeyG', 'Comma']);
  });

  it('round-trips exactly between every pair of layouts', () => {
    const start = defaults();
    for (const from of IDS) {
      for (const to of IDS) {
        for (const pin of [new Set<string>(), MOVEMENT]) {
          const there = convertBindingsLayout(start, from, to, pin);
          const back = convertBindingsLayout(there.binds, to, from, pin);
          expect(back.binds, `${from}->${to}->${from}`).toEqual(start);
          expect(back.moved).toBe(there.moved);
        }
      }
    }
  });

  it('applies through Keybinds.importBindings without dropping a single binding', () => {
    const start = defaults();
    const count = (s: KeybindSetup) => Object.values(s).flat().filter(Boolean).length;
    for (const to of IDS) {
      for (const pin of [new Set<string>(), MOVEMENT]) {
        installStorage();
        const kb = new Keybinds();
        const { binds } = convertBindingsLayout(start, 'qwerty-us', to, pin);
        kb.importBindings(binds);
        expect(kb.snapshot(), `qwerty-us->${to}`).toEqual(binds);
        expect(count(kb.snapshot())).toBe(count(start));
      }
    }
  });

  it('reports nothing to move for the same layout', () => {
    expect(convertBindingsLayout(defaults(), 'colemak', 'colemak').moved).toBe(0);
  });
});

describe('keyboard_layout_convert_core: detecting the OS layout', () => {
  const printing = (id: KeyboardLayoutId) => (code: string) =>
    layout(id).chars.get(code)?.toUpperCase() ?? null;

  it('recognises every listed layout from its own characters', () => {
    for (const id of IDS) expect(detectKeyboardLayout(printing(id))).toBe(id);
  });

  it('rejects a layout with a single letter out of place', () => {
    // US with only KeyY swapped to QWERTZ's z: US fails on KeyY, QWERTZ on
    // KeyZ, so nothing matches even though every other key agrees with US.
    const oneOff = (code: string) =>
      code === 'KeyY' ? 'z' : (layout('qwerty-us').chars.get(code) ?? null);
    expect(detectKeyboardLayout(oneOff)).toBe(null);
  });

  it('returns null without a layout map or for a non-Latin layout', () => {
    expect(detectKeyboardLayout(() => null)).toBeNull();
    expect(detectKeyboardLayout((code) => (code.startsWith('Key') ? 'Ж' : null))).toBeNull();
  });

  it('reads a US board that reports an ISO key as US, and Danish apart from Swedish', () => {
    // Windows reports a character for IntlBackslash even on US; it ties UK on
    // score and the earlier, more common layout wins.
    const usIso = (code: string) =>
      code === 'IntlBackslash' ? '\\' : (layout('qwerty-us').chars.get(code) ?? null);
    expect(detectKeyboardLayout(usIso)).toBe('qwerty-us');
    expect(detectKeyboardLayout(printing('qwerty-da'))).toBe('qwerty-da');
    expect(detectKeyboardLayout(printing('qwerty-no'))).toBe('qwerty-no');
  });

  it('settles a letters-only match on the more common layout', () => {
    const lettersOnly = (code: string) =>
      code.startsWith('Key') ? (layout('qwerty-us').chars.get(code) ?? null) : null;
    expect(detectKeyboardLayout(lettersOnly)).toBe('qwerty-us');
  });
});
