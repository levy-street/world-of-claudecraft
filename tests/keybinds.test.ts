import { beforeEach, describe, expect, it } from 'vitest';
import { Keybinds, isReservedCode, keyLabel } from '../src/game/keybinds';

// minimal localStorage stub (the test env is plain node, no DOM)
function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

beforeEach(() => installStorage());

describe('keyLabel', () => {
  it('maps codes to short keycaps', () => {
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Digit0')).toBe('0');
    expect(keyLabel('Minus')).toBe('-');
    expect(keyLabel('Equal')).toBe('=');
    expect(keyLabel('KeyR')).toBe('R');
    expect(keyLabel('F5')).toBe('F5');
    expect(keyLabel('Numpad3')).toBe('Num3');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel(null)).toBe('');
  });
});

describe('reserved keys', () => {
  it('flags movement/system keys', () => {
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'Tab', 'Escape', 'Enter']) {
      expect(isReservedCode(c), c).toBe(true);
    }
    for (const c of ['Digit1', 'KeyR', 'F1', 'Minus']) {
      expect(isReservedCode(c), c).toBe(false);
    }
  });
});

describe('Keybinds', () => {
  it('starts on the default 1..0,-,= layout', () => {
    const kb = new Keybinds();
    expect(kb.codeForSlot(0)).toBe('Digit1');
    expect(kb.label(0)).toBe('1'); // slot 0 = Attack, key "1"
    expect(kb.codeForSlot(9)).toBe('Digit0');
    expect(kb.label(10)).toBe('-');
    expect(kb.label(11)).toBe('=');
    expect(kb.slotForCode('Digit1')).toBe(0);
    expect(kb.slotForCode('Equal')).toBe(11);
    expect(kb.slotForCode('KeyZ')).toBe(null);
  });

  it('binds a key to a slot, including the Attack slot', () => {
    const kb = new Keybinds();
    expect(kb.bind(0, 'KeyR')).toBe(true); // rebind Attack off "1"
    expect(kb.slotForCode('KeyR')).toBe(0);
    expect(kb.label(0)).toBe('R');
    expect(kb.slotForCode('Digit1')).toBe(null); // its old key is now free
  });

  it('rejects reserved keys and leaves the slot unchanged', () => {
    const kb = new Keybinds();
    expect(kb.bind(2, 'KeyW')).toBe(false);
    expect(kb.codeForSlot(2)).toBe('Digit3'); // default intact
  });

  it('clears a conflicting binding from its old slot (no duplicates)', () => {
    const kb = new Keybinds();
    // bind slot 3 to slot 0's default key
    expect(kb.bind(3, 'Digit1')).toBe(true);
    expect(kb.slotForCode('Digit1')).toBe(3);
    expect(kb.codeForSlot(0)).toBe(null); // stolen from slot 0
  });

  it('clear() removes a slot binding', () => {
    const kb = new Keybinds();
    kb.clear(4);
    expect(kb.codeForSlot(4)).toBe(null);
    expect(kb.label(4)).toBe('');
    expect(kb.slotForCode('Digit5')).toBe(null);
  });

  it('reset() restores defaults', () => {
    const kb = new Keybinds();
    kb.bind(0, 'KeyR');
    kb.clear(5);
    kb.reset();
    expect(kb.codeForSlot(0)).toBe('Digit1');
    expect(kb.codeForSlot(5)).toBe('Digit6');
  });

  it('persists across instances', () => {
    const a = new Keybinds();
    a.bind(0, 'KeyR');
    a.bind(1, 'KeyF');
    const b = new Keybinds(); // reloads from the same storage
    expect(b.slotForCode('KeyR')).toBe(0);
    expect(b.slotForCode('KeyF')).toBe(1);
  });

  it('drops duplicate codes when loading corrupt storage', () => {
    // two slots claim the same code — the later one must lose it on load
    localStorage.setItem('woc_keybinds', JSON.stringify(['KeyR', 'KeyR', 'Digit3']));
    const kb = new Keybinds();
    expect(kb.slotForCode('KeyR')).toBe(0); // first wins
    expect(kb.codeForSlot(1)).toBe(null); // duplicate dropped
  });
});
