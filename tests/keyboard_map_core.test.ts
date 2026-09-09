// The pure model behind the Key Bindings panel's keyboard overview
// (src/ui/keyboard_map_core.ts): every form factor's layout keeps its row
// geometry and draws no cap twice, the full size board covers every code the
// registry binds by default, the smaller boards report the bindings they
// cannot draw, and the annotation puts each binding on the right key in the
// right layer.
import { describe, expect, it } from 'vitest';
import { BIND_ACTIONS } from '../src/game/keybinds';
import {
  buildKeyboardMap,
  categoryClass,
  KEYBOARD_FORM_FACTORS,
  KEYBOARD_LAYERS,
  KEYBOARD_LAYOUT,
  type KeyboardFormFactor,
  keyboardLayoutCodes,
  keyboardLayoutFor,
  legendsDifferFromQwerty,
  splitCombo,
} from '../src/ui/keyboard_map_core';

const deps = {
  legend: (code: string) => code,
  name: (id: string) => `name:${id}`,
  category: (id: string) => (id.startsWith('slot') ? 'Action Bar' : 'Movement'),
};
const FORMS = KEYBOARD_FORM_FACTORS.map((f) => f.id);

describe('keyboard layouts', () => {
  it('offers full size, tenkeyless, 75% and 60%, full size first', () => {
    expect(FORMS).toEqual(['full', 'tkl', '75', '60']);
    expect(KEYBOARD_LAYOUT).toEqual(keyboardLayoutFor('full'));
  });

  it('the full size board has a cap for every code the registry binds by default, mouse included', () => {
    const codes = new Set(keyboardLayoutCodes('full'));
    for (const a of BIND_ACTIONS) {
      for (const combo of a.defaults) {
        const { code } = splitCombo(combo);
        expect(codes.has(code), `${a.id}: ${combo}`).toBe(true);
      }
    }
    for (const mouse of ['Mouse3', 'Mouse4', 'Mouse5']) expect(codes.has(mouse)).toBe(true);
  });

  it.each(FORMS)('%s never draws the same physical key twice', (form) => {
    const codes = keyboardLayoutCodes(form);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(FORMS)('%s keeps every row exactly its block width, so the grid never wraps', (form) => {
    for (const block of keyboardLayoutFor(form)) {
      // A key spanning two rows (numpad + and Enter) takes its column in the
      // NEXT row too, so that row is one unit short by design.
      let carried = 0;
      for (const row of block.rows) {
        const width = row.reduce((sum, k) => sum + (k.w ?? 1), 0) + carried;
        expect(width, `${form} ${block.id}: ${row.map((k) => k.code || '_').join(' ')}`).toBe(
          block.units,
        );
        carried = row.reduce((sum, k) => sum + ((k.h ?? 1) > 1 ? (k.w ?? 1) : 0), 0);
      }
    }
  });

  it('smaller boards drop the blocks they lack and keep the mouse buttons', () => {
    expect(keyboardLayoutFor('tkl').map((b) => b.id)).toEqual(['main', 'nav', 'mouse']);
    expect(keyboardLayoutFor('75').map((b) => b.id)).toEqual(['main', 'mouse']);
    expect(keyboardLayoutFor('60').map((b) => b.id)).toEqual(['main', 'mouse']);
    const c75 = new Set(keyboardLayoutCodes('75'));
    for (const code of [
      'F1',
      'Delete',
      'Home',
      'PageUp',
      'PageDown',
      'End',
      'ArrowUp',
      'ArrowLeft',
    ])
      expect(c75.has(code), code).toBe(true);
    expect(c75.has('Insert')).toBe(false);
    expect(c75.has('Numpad1')).toBe(false);
    const c60 = new Set(keyboardLayoutCodes('60'));
    expect(c60.has('F1')).toBe(false);
    expect(c60.has('ArrowUp')).toBe(false);
    expect(c60.has('KeyA')).toBe(true);
    // The 60% board has no F row, so its mouse column starts at the top.
    expect(keyboardLayoutFor('60')[1].rows[0][0].code).toBe('Mouse3');
  });

  it('offers the bare layer first, then Shift, Ctrl and Alt', () => {
    expect(KEYBOARD_LAYERS.map((l) => l.id)).toEqual(['', 'Shift+', 'Ctrl+', 'Alt+']);
  });
});

describe('legendsDifferFromQwerty', () => {
  const qwerty = (code: string) => (code.startsWith('Key') ? code.slice(3) : code.slice(5));

  it('is false for a QWERTY layout, an unknown layout, or one that only moves punctuation', () => {
    expect(legendsDifferFromQwerty(qwerty, qwerty)).toBe(false);
    expect(legendsDifferFromQwerty(() => null, qwerty)).toBe(false);
    // Lower-case reports still count as the same letter.
    expect(legendsDifferFromQwerty((c) => qwerty(c).toLowerCase(), qwerty)).toBe(false);
    // ISO boards print different punctuation under plain QWERTY; that alone is
    // not a layout change.
    expect(legendsDifferFromQwerty((c) => (c === 'Backslash' ? '#' : qwerty(c)), qwerty)).toBe(
      false,
    );
  });

  it('is true when a letter or digit prints something else (Colemak, AZERTY)', () => {
    // Colemak: the key QWERTY calls E prints F.
    expect(legendsDifferFromQwerty((c) => (c === 'KeyE' ? 'f' : qwerty(c)), qwerty)).toBe(true);
    // AZERTY: A and Q swap, and the digit row prints symbols unshifted.
    expect(legendsDifferFromQwerty((c) => (c === 'KeyA' ? 'q' : qwerty(c)), qwerty)).toBe(true);
    expect(legendsDifferFromQwerty((c) => (c === 'Digit1' ? '&' : qwerty(c)), qwerty)).toBe(true);
  });
});

describe('splitCombo / categoryClass', () => {
  it('splits a modifier head from the bare code and leaves a bare code alone', () => {
    expect(splitCombo('Shift+Digit1')).toEqual({ head: 'Shift+', code: 'Digit1' });
    expect(splitCombo('Ctrl+Alt+KeyA')).toEqual({ head: 'Ctrl+Alt+', code: 'KeyA' });
    expect(splitCombo('KeyA')).toEqual({ head: '', code: 'KeyA' });
    expect(splitCombo('NumpadAdd')).toEqual({ head: '', code: 'NumpadAdd' });
  });

  it('slugs a category for the painter class', () => {
    expect(categoryClass('Action Bar')).toBe('action-bar');
    expect(categoryClass('Pet')).toBe('pet');
  });
});

describe('buildKeyboardMap', () => {
  const snapshot = {
    forward: ['KeyW', 'ArrowUp'],
    slot12: ['Shift+KeyW', 'Numpad1'],
    petAttack: ['Ctrl+Digit1', null],
    slot0: ['Digit1', null],
    autorun: [null, null],
  };
  const find = (
    layer: '' | 'Shift+' | 'Ctrl+' | 'Alt+',
    code: string,
    form: KeyboardFormFactor = 'full',
  ) => {
    for (const block of buildKeyboardMap(snapshot, layer, deps, form).blocks)
      for (const row of block.rows) for (const k of row) if (k.code === code) return k;
    throw new Error(`no key ${code}`);
  };

  it('puts a bare binding on its cap in the bare layer and marks other layers', () => {
    const w = find('', 'KeyW');
    expect(w.layerBinding).toEqual({
      actionId: 'forward',
      index: 0,
      combo: 'KeyW',
      name: 'name:forward',
      category: 'Movement',
    });
    expect(w.otherLayers).toBe(true); // Shift+W is on the bar
    // The alternate slot carries index 1, what a rebind or unbind targets.
    expect(find('', 'ArrowUp').layerBinding?.index).toBe(1);
    expect(w.bindings.map((b) => b.combo)).toEqual(['KeyW', 'Shift+KeyW']);
  });

  it('switches the cap to the selected layer and orders that layer first', () => {
    const w = find('Shift+', 'KeyW');
    expect(w.layerBinding?.actionId).toBe('slot12');
    expect(w.bindings.map((b) => b.combo)).toEqual(['Shift+KeyW', 'KeyW']);
    const one = find('Ctrl+', 'Digit1');
    expect(one.layerBinding?.actionId).toBe('petAttack');
    expect(find('', 'Digit1').layerBinding?.actionId).toBe('slot0');
    expect(find('Alt+', 'Digit1').layerBinding).toBeNull();
    expect(find('Alt+', 'Digit1').otherLayers).toBe(true);
  });

  it('reports the bindings a smaller board cannot draw, and none on the full board', () => {
    expect(buildKeyboardMap(snapshot, '', deps, 'full').hidden).toEqual([]);
    expect(buildKeyboardMap(snapshot, '', deps, 'tkl').hidden.map((b) => b.combo)).toEqual([
      'Numpad1',
    ]);
    // Hidden means hidden in EVERY layer: the 60% board has no arrows or numpad.
    expect(
      buildKeyboardMap(snapshot, 'Shift+', deps, '60')
        .hidden.map((b) => b.combo)
        .sort(),
    ).toEqual(['ArrowUp', 'Numpad1']);
  });

  it('leaves an unused key empty and spells spacers as blank cells', () => {
    const q = find('', 'KeyQ');
    expect(q.layerBinding).toBeNull();
    expect(q.bindings).toEqual([]);
    expect(q.otherLayers).toBe(false);
    expect(q.legend).toBe('KeyQ');
    const spacer = buildKeyboardMap(snapshot, '', deps).blocks[0].rows[0][1];
    expect(spacer.spacer).toBe(true);
    expect(spacer.legend).toBe('');
    expect(spacer.w).toBe(1);
  });

  it('uses the layout legend override over the resolver', () => {
    expect(find('', 'ShiftLeft').legend).toBe('Shift');
    expect(find('', 'Numpad7').legend).toBe('7');
    expect(find('', 'ShiftRight', '75').w).toBe(1.75);
  });
});
