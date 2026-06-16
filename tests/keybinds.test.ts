import { beforeEach, describe, expect, it } from 'vitest';
import {
  Keybinds, BIND_ACTIONS, BIND_CATEGORIES, actionKind, isReservedCode, keyLabel,
} from '../src/game/keybinds';

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
    expect(keyLabel('Minus')).toBe('-');
    expect(keyLabel('Equal')).toBe('=');
    expect(keyLabel('KeyR')).toBe('R');
    expect(keyLabel('F5')).toBe('F5');
    expect(keyLabel('Numpad3')).toBe('Num3');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel(null)).toBe('');
  });
});

describe('registry', () => {
  it('classifies movement as held and the rest as edge', () => {
    expect(actionKind('forward')).toBe('held');
    expect(actionKind('jump')).toBe('held');
    expect(actionKind('emoteWheel')).toBe('held');
    expect(actionKind('autorun')).toBe('edge');
    expect(actionKind('target')).toBe('edge');
    expect(actionKind('slot0')).toBe('edge');
    expect(actionKind('nope')).toBe(null);
  });

  it('covers the expected categories and 12 action-bar slots', () => {
    expect(BIND_CATEGORIES).toContain('Movement');
    expect(BIND_CATEGORIES).toContain('Action Bar');
    expect(BIND_ACTIONS.filter((a) => a.category === 'Action Bar').length).toBe(12);
  });

  it('no two actions share a default code', () => {
    // Known pre-existing upstream (v0.7) collision, out of scope for this branch:
    // `targetFriendly` and `meters` both default to KeyH. Allowlisted so this guard
    // still protects our own bindings (e.g. skills=K / leaderboard=Y) without taking
    // on an unrelated upstream keybind fix.
    const KNOWN_UPSTREAM_DUPLICATE_CODES = new Set(['KeyH']);
    const seen = new Map<string, string>();
    for (const a of BIND_ACTIONS) {
      for (const code of a.defaults) {
        if (KNOWN_UPSTREAM_DUPLICATE_CODES.has(code)) { seen.set(code, a.id); continue; }
        const prev = seen.get(code);
        expect(prev, `${a.id} and ${prev} both default to ${code}`).toBeUndefined();
        seen.set(code, a.id);
      }
    }
  });
});

describe('reserved keys', () => {
  it('reserves only Escape (everything else is rebindable now)', () => {
    expect(isReservedCode('Escape')).toBe(true);
    for (const c of ['KeyW', 'Space', 'Tab', 'Enter', 'Digit1', 'KeyR']) {
      expect(isReservedCode(c), c).toBe(false);
    }
  });
});

describe('Keybinds defaults', () => {
  it('resolves default movement, system, and action-bar keys to actions', () => {
    const kb = new Keybinds();
    expect(kb.actionForCode('KeyW')).toBe('forward');
    expect(kb.actionForCode('ArrowUp')).toBe('forward'); // secondary default
    expect(kb.actionForCode('KeyD')).toBe('turnRight');
    expect(kb.actionForCode('Space')).toBe('jump');
    expect(kb.actionForCode('Tab')).toBe('target');
    expect(kb.actionForCode('KeyB')).toBe('bags');
    expect(kb.actionForCode('KeyX')).toBe('emoteWheel');
    expect(kb.actionForCode('Digit1')).toBe('slot0'); // Attack
    expect(kb.actionForCode('Equal')).toBe('slot11');
    expect(kb.actionForCode('KeyH')).toBe('targetFriendly');
    expect(kb.actionForCode('KeyJ')).toBe('targetFriendlyNext');
    expect(kb.actionForCode('KeyZ')).toBe(null);
  });

  it('exposes primary/secondary codes and labels', () => {
    const kb = new Keybinds();
    expect(kb.codeAt('forward', 0)).toBe('KeyW');
    expect(kb.codeAt('forward', 1)).toBe('ArrowUp');
    expect(kb.codesForAction('forward')).toEqual(['KeyW', 'ArrowUp']);
    expect(kb.primaryLabel('slot0')).toBe('1');
    expect(kb.labelAt('forward', 1)).toBe('↑');
  });
});

describe('binding', () => {
  it('rebinds the Attack slot off "1"', () => {
    const kb = new Keybinds();
    expect(kb.bind('slot0', 0, 'KeyR')).toBe(true);
    expect(kb.actionForCode('KeyR')).toBe('slot0');
    expect(kb.primaryLabel('slot0')).toBe('R');
    expect(kb.actionForCode('Digit1')).toBe(null); // old key freed
  });

  it('rebinds a movement key', () => {
    const kb = new Keybinds();
    expect(kb.bind('jump', 0, 'KeyJ')).toBe(true);
    expect(kb.actionForCode('KeyJ')).toBe('jump');
    expect(kb.actionForCode('Space')).toBe(null);
  });

  it('binds a secondary key without disturbing the primary', () => {
    const kb = new Keybinds();
    expect(kb.bind('slot1', 1, 'KeyZ')).toBe(true);
    expect(kb.codeAt('slot1', 0)).toBe('Digit2');
    expect(kb.codeAt('slot1', 1)).toBe('KeyZ');
    expect(kb.actionForCode('KeyZ')).toBe('slot1');
  });

  it('rejects the reserved Escape key', () => {
    const kb = new Keybinds();
    expect(kb.bind('jump', 0, 'Escape')).toBe(false);
    expect(kb.codeAt('jump', 0)).toBe('Space');
  });

  it('clears a conflicting code from another action (cross-category)', () => {
    const kb = new Keybinds();
    // steal W (forward's primary) for the bags window
    expect(kb.bind('bags', 0, 'KeyW')).toBe(true);
    expect(kb.actionForCode('KeyW')).toBe('bags');
    expect(kb.codeAt('forward', 0)).toBe(null); // primary stolen
    expect(kb.actionForCode('ArrowUp')).toBe('forward'); // alternate still drives forward
  });

  it('clear() removes one binding slot', () => {
    const kb = new Keybinds();
    kb.clear('forward', 1);
    expect(kb.codesForAction('forward')).toEqual(['KeyW']);
    expect(kb.actionForCode('ArrowUp')).toBe(null);
  });

  it('reset() restores defaults', () => {
    const kb = new Keybinds();
    kb.bind('slot0', 0, 'KeyR');
    kb.clear('jump', 0);
    kb.reset();
    expect(kb.actionForCode('Digit1')).toBe('slot0');
    expect(kb.actionForCode('Space')).toBe('jump');
  });
});

describe('persistence', () => {
  it('round-trips bindings across instances', () => {
    const a = new Keybinds();
    a.bind('slot0', 0, 'KeyR');
    a.bind('jump', 0, 'KeyJ');
    const b = new Keybinds();
    expect(b.actionForCode('KeyR')).toBe('slot0');
    expect(b.actionForCode('KeyJ')).toBe('jump');
    expect(b.actionForCode('Space')).toBe(null);
  });

  it('keeps defaults for actions missing from older saved data', () => {
    // Simulate a save written before some actions existed: it only contains a
    // couple of bindings. Every other action must keep its default, not load
    // unbound.
    localStorage.setItem('woc_keybinds', JSON.stringify({
      slot0: ['KeyR', null],
      jump: ['KeyJ', null],
    }));
    const kb = new Keybinds();
    expect(kb.actionForCode('KeyR')).toBe('slot0');
    expect(kb.actionForCode('KeyJ')).toBe('jump');
    expect(kb.actionForCode('KeyW')).toBe('forward');
    expect(kb.actionForCode('Tab')).toBe('target');
    expect(kb.actionForCode('KeyN')).toBe('talents');
    expect(kb.actionForCode('KeyH')).toBe('targetFriendly');
    expect(kb.actionForCode('Enter')).toBe('chat');
    expect(kb.actionForCode('Equal')).toBe('slot11');
    expect(kb.actionForCode('KeyK')).toBe('skills');
    expect(kb.actionForCode('KeyY')).toBe('leaderboard');
    expect(kb.actionForCode('KeyI')).toBe(null);
  });

  it('drops a retained default that a stored binding already claimed', () => {
    // A stored binding takes KeyH (the default for the newer friendly-target
    // action), which is absent from the blob. The new action must not also keep
    // KeyH.
    localStorage.setItem('woc_keybinds', JSON.stringify({
      jump: ['KeyH', null],
    }));
    const kb = new Keybinds();
    expect(kb.actionForCode('KeyH')).toBe('jump');
    expect(kb.codeAt('targetFriendly', 0)).toBe(null);
  });

  it('drops duplicate codes when loading corrupt storage', () => {
    // two actions claim KeyR — the later one must lose it on load
    localStorage.setItem('woc_keybinds', JSON.stringify({
      slot0: ['KeyR', null],
      slot1: ['KeyR', null],
    }));
    const kb = new Keybinds();
    expect(kb.actionForCode('KeyR')).toBe('slot0');
    expect(kb.codeAt('slot1', 0)).toBe(null);
  });
});
