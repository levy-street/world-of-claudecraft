import { beforeEach, describe, expect, it } from 'vitest';
import {
  actionAllowsShared,
  actionKind,
  BIND_ACTIONS,
  BIND_CATEGORIES,
  comboCode,
  comboMods,
  isModifierCode,
  isReservedCode,
  Keybinds,
  keyLabel,
  makeCombo,
} from '../src/game/keybinds';

// minimal localStorage stub (the test env is plain node, no DOM)
function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
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

  it('covers the expected categories and 23 action-bar slots (attack + 11 primary + 11 secondary)', () => {
    expect(BIND_CATEGORIES).toContain('Movement');
    expect(BIND_CATEGORIES).toContain('Action Bar');
    expect(BIND_ACTIONS.filter((a) => a.category === 'Action Bar').length).toBe(23);
    // The secondary bar's slots exist and default to the numpad row.
    expect(BIND_ACTIONS.find((a) => a.id === 'slot12')?.defaults).toEqual(['Numpad1']);
    expect(BIND_ACTIONS.find((a) => a.id === 'slot22')?.defaults).toEqual(['NumpadDecimal']);
    // Discord is a rebindable Interface window toggle (default U).
    const discord = BIND_ACTIONS.find((a) => a.id === 'discord');
    expect(discord?.category).toBe('Interface');
    expect(discord?.kind).toBe('edge');
    expect(discord?.defaults).toEqual(['KeyU']);
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
    expect(kb.actionForCode('KeyU')).toBe('discord');
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

  it('lets Space move from Jump to an action slot without driving both', () => {
    const kb = new Keybinds();
    expect(kb.bind('slot1', 0, 'Space')).toBe(true);
    expect(kb.actionForCode('Space')).toBe('slot1');
    expect(kb.codeAt('jump', 0)).toBe(null);
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

describe('Attack Move (shared key)', () => {
  it('defaults to A, sharing the code with Turn Left', () => {
    const kb = new Keybinds();
    expect(actionAllowsShared('attackMove')).toBe(true);
    expect(actionAllowsShared('turnLeft')).toBe(false);
    expect(kb.codeAt('attackMove', 0)).toBe('KeyA');
    expect(kb.codeAt('turnLeft', 0)).toBe('KeyA');
    // actionForCode prefers Turn Left (earlier in the registry); Attack Move is
    // dispatched ahead of it by Input only while its mode is on.
    expect(kb.actionForCode('KeyA')).toBe('turnLeft');
  });

  it('keeps its shared A across a save/reload that rebinds another action', () => {
    const first = new Keybinds();
    first.bind('jump', 0, 'KeyT'); // any rebind persists the whole map
    const reloaded = new Keybinds();
    expect(reloaded.codeAt('attackMove', 0)).toBe('KeyA');
    expect(reloaded.codeAt('turnLeft', 0)).toBe('KeyA');
  });

  it('does not steal A from Turn Left when (re)bound, nor get stolen', () => {
    const kb = new Keybinds();
    // rebinding Attack Move onto A must leave Turn Left's A intact
    expect(kb.bind('attackMove', 0, 'KeyA')).toBe(true);
    expect(kb.codeAt('turnLeft', 0)).toBe('KeyA');
    // and binding another action to A must not strip Attack Move's shared A
    expect(kb.bind('bags', 0, 'KeyA')).toBe(true);
    expect(kb.codeAt('attackMove', 0)).toBe('KeyA');
    expect(kb.codeAt('turnLeft', 0)).toBe(null); // non-shared loses it as usual
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
    localStorage.setItem(
      'woc_keybinds',
      JSON.stringify({
        slot0: ['KeyR', null],
        jump: ['KeyJ', null],
      }),
    );
    const kb = new Keybinds();
    expect(kb.actionForCode('KeyR')).toBe('slot0');
    expect(kb.actionForCode('KeyJ')).toBe('jump');
    expect(kb.actionForCode('KeyW')).toBe('forward');
    expect(kb.actionForCode('Tab')).toBe('target');
    expect(kb.actionForCode('KeyN')).toBe('talents');
    expect(kb.actionForCode('KeyH')).toBe('targetFriendly');
    expect(kb.actionForCode('Enter')).toBe('chat');
    expect(kb.actionForCode('Equal')).toBe('slot11');
    expect(kb.actionForCode('KeyY')).toBe(null);
  });

  it('drops a retained default that a stored binding already claimed', () => {
    // A stored binding takes KeyH (the default for the newer friendly-target
    // action), which is absent from the blob. The new action must not also keep
    // KeyH.
    localStorage.setItem(
      'woc_keybinds',
      JSON.stringify({
        jump: ['KeyH', null],
      }),
    );
    const kb = new Keybinds();
    expect(kb.actionForCode('KeyH')).toBe('jump');
    expect(kb.codeAt('targetFriendly', 0)).toBe(null);
  });

  it('drops duplicate codes when loading corrupt storage', () => {
    // two actions claim KeyR — the later one must lose it on load
    localStorage.setItem(
      'woc_keybinds',
      JSON.stringify({
        slot0: ['KeyR', null],
        slot1: ['KeyR', null],
      }),
    );
    const kb = new Keybinds();
    expect(kb.actionForCode('KeyR')).toBe('slot0');
    expect(kb.codeAt('slot1', 0)).toBe(null);
  });

  it('does not let stored Space action-bar bindings also keep default Jump', () => {
    localStorage.setItem(
      'woc_keybinds',
      JSON.stringify({
        slot1: ['Space', null],
      }),
    );
    const kb = new Keybinds();
    expect(kb.actionForCode('Space')).toBe('slot1');
    expect(kb.codeAt('jump', 0)).toBe(null);
  });
});

describe('per-character scope', () => {
  it('keeps two character scopes independent', () => {
    const alice = new Keybinds('char:alice');
    alice.bind('jump', 0, 'KeyZ'); // KeyZ is unbound by default
    const bob = new Keybinds('char:bob');
    // Bob never inherits Alice's change; he starts from defaults.
    expect(bob.actionForCode('KeyZ')).toBe(null);
    expect(bob.codeAt('jump', 0)).toBe('Space');
    bob.bind('jump', 0, 'KeyY'); // also unbound by default
    // Reloading each scope reads back only its own profile.
    expect(new Keybinds('char:alice').actionForCode('KeyZ')).toBe('jump');
    expect(new Keybinds('char:bob').actionForCode('KeyY')).toBe('jump');
    expect(new Keybinds('char:bob').actionForCode('KeyZ')).toBe(null);
  });

  it('writes to a namespaced key, not the legacy global key', () => {
    const kb = new Keybinds('char:alice');
    kb.bind('jump', 0, 'KeyJ');
    expect(localStorage.getItem('woc_keybinds:char:alice')).not.toBeNull();
    expect(localStorage.getItem('woc_keybinds')).toBeNull();
  });

  it('seeds a fresh character from the legacy account-wide blob', () => {
    // An existing player has account-wide binds under the bare key.
    localStorage.setItem(
      'woc_keybinds',
      JSON.stringify({
        jump: ['KeyJ', null],
        slot0: ['KeyR', null],
      }),
    );
    // A character with no profile yet inherits them as a one-time seed. KeyJ and
    // KeyR are the seeded jump/slot0 codes; the load-time uniqueness sweep also
    // strips them from their default owners (targetFriendlyNext/autorun), so each
    // code resolves to exactly the seeded action.
    const fresh = new Keybinds('char:alice');
    expect(fresh.actionForCode('KeyJ')).toBe('jump');
    expect(fresh.actionForCode('KeyR')).toBe('slot0');
  });

  it('diverges from the legacy seed without overwriting it', () => {
    localStorage.setItem('woc_keybinds', JSON.stringify({ jump: ['KeyJ', null] }));
    const alice = new Keybinds('char:alice');
    alice.bind('jump', 0, 'KeyK'); // diverge: persists Alice's scoped profile
    // Legacy blob is untouched, so another fresh character still seeds from it.
    expect(JSON.parse(localStorage.getItem('woc_keybinds')!).jump).toEqual(['KeyJ', null]);
    expect(new Keybinds('char:bob').actionForCode('KeyJ')).toBe('jump');
    // Alice now reads her own diverged profile, not the seed. KeyJ is
    // targetFriendlyNext's default, but seeding gave it to jump (the sweep
    // stripped it from targetFriendlyNext); after jump moves to KeyK nothing in
    // Alice's profile holds KeyJ.
    expect(new Keybinds('char:alice').actionForCode('KeyK')).toBe('jump');
    expect(new Keybinds('char:alice').actionForCode('KeyJ')).toBe(null);
  });

  it('an empty scope keeps using the legacy global key', () => {
    const kb = new Keybinds('');
    kb.bind('jump', 0, 'KeyJ');
    expect(localStorage.getItem('woc_keybinds')).not.toBeNull();
    expect(new Keybinds().actionForCode('KeyJ')).toBe('jump');
  });

  it('uses the production char:<numeric id> scope shape', () => {
    // Online scope is `char:${c.id}` where c.id is the numeric DB character id.
    const kb = new Keybinds('char:1729');
    kb.bind('jump', 0, 'KeyZ');
    expect(localStorage.getItem('woc_keybinds:char:1729')).not.toBeNull();
    expect(new Keybinds('char:1729').actionForCode('KeyZ')).toBe('jump');
  });

  it('namespaces the offline scope (offline:<class>:<name>) per character', () => {
    // Offline scope is `offline:${playerClass}:${name}` (the only stable handle).
    const aldric = new Keybinds('offline:warrior:Aldric');
    aldric.bind('jump', 0, 'KeyZ');
    expect(localStorage.getItem('woc_keybinds:offline:warrior:Aldric')).not.toBeNull();
    expect(localStorage.getItem('woc_keybinds')).toBeNull();
    // A different offline character starts from defaults, not Aldric's binding.
    expect(new Keybinds('offline:mage:Brenna').actionForCode('KeyZ')).toBe(null);
    expect(new Keybinds('offline:mage:Brenna').codeAt('jump', 0)).toBe('Space');
    // The same scope reads back its own profile.
    expect(new Keybinds('offline:warrior:Aldric').actionForCode('KeyZ')).toBe('jump');
  });

  it('shares one store across same-class same-name offline characters', () => {
    // Offline characters are not persisted, so class+name is the only handle:
    // two offline sessions with the same class and name intentionally share one
    // profile. A different name does not.
    new Keybinds('offline:warrior:Aldric').bind('jump', 0, 'KeyZ');
    expect(new Keybinds('offline:warrior:Aldric').actionForCode('KeyZ')).toBe('jump');
    expect(new Keybinds('offline:warrior:Borin').actionForCode('KeyZ')).toBe(null);
  });

  it('seeds from the legacy blob when the scoped value is corrupt JSON', () => {
    localStorage.setItem('woc_keybinds', JSON.stringify({ jump: ['KeyZ', null] }));
    localStorage.setItem('woc_keybinds:char:alice', '{not valid json');
    // A corrupt scoped value behaves like an absent one: still seed from legacy,
    // do not drop to bare defaults.
    expect(new Keybinds('char:alice').actionForCode('KeyZ')).toBe('jump');
  });

  it('seeds from the legacy blob when the scoped value is not a plain object', () => {
    localStorage.setItem('woc_keybinds', JSON.stringify({ jump: ['KeyZ', null] }));
    // A JSON array is typeof 'object' but is not a valid profile; it must seed.
    localStorage.setItem('woc_keybinds:char:alice', JSON.stringify(['garbage']));
    expect(new Keybinds('char:alice').actionForCode('KeyZ')).toBe('jump');
    // A JSON scalar likewise.
    localStorage.setItem('woc_keybinds:char:bob', JSON.stringify(42));
    expect(new Keybinds('char:bob').actionForCode('KeyZ')).toBe('jump');
  });

  it('reset() persists to the scoped key and leaves the legacy blob untouched', () => {
    localStorage.setItem('woc_keybinds', JSON.stringify({ jump: ['KeyJ', null] }));
    const alice = new Keybinds('char:alice');
    alice.bind('jump', 0, 'KeyZ'); // KeyZ is unbound by default
    alice.reset();
    // Alice's scoped profile is back to defaults...
    expect(new Keybinds('char:alice').codeAt('jump', 0)).toBe('Space');
    expect(new Keybinds('char:alice').actionForCode('KeyZ')).toBe(null);
    // ...and reset never wrote the legacy key.
    expect(JSON.parse(localStorage.getItem('woc_keybinds')!).jump).toEqual(['KeyJ', null]);
  });
});

describe('modifier combos', () => {
  it('builds a canonical combo string in fixed Ctrl/Alt/Shift/Meta order', () => {
    expect(makeCombo('Digit1', { ctrl: false, alt: false, shift: false })).toBe('Digit1');
    expect(makeCombo('Digit1', { ctrl: false, alt: false, shift: true })).toBe('Shift+Digit1');
    expect(makeCombo('KeyA', { ctrl: true, alt: true, shift: true })).toBe('Ctrl+Alt+Shift+KeyA');
    // order is fixed regardless of which flags are set
    expect(makeCombo('KeyF', { ctrl: true, alt: false, shift: true })).toBe('Ctrl+Shift+KeyF');
    // Meta (Cmd on macOS / Win key) folds in last, so Cmd+1 is its own chord; a
    // bare 1 stays byte-identical because an omitted/false meta changes nothing.
    expect(makeCombo('Digit1', { ctrl: false, alt: false, shift: false, meta: true })).toBe(
      'Meta+Digit1',
    );
    expect(makeCombo('KeyA', { ctrl: true, alt: false, shift: true, meta: true })).toBe(
      'Ctrl+Shift+Meta+KeyA',
    );
    expect(makeCombo('Digit1', { ctrl: false, alt: false, shift: false, meta: false })).toBe(
      'Digit1',
    );
  });

  it('splits a combo back into its code and modifiers', () => {
    expect(comboCode('Shift+Digit1')).toBe('Digit1');
    expect(comboCode('Ctrl+Alt+Shift+KeyA')).toBe('KeyA');
    expect(comboCode('Meta+Digit1')).toBe('Digit1');
    expect(comboCode('Minus')).toBe('Minus'); // bare code, no '+'
    expect(comboMods('Ctrl+Shift+KeyF')).toEqual({
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
    expect(comboMods('Digit1')).toEqual({ ctrl: false, alt: false, shift: false, meta: false });
    expect(comboMods('Meta+Digit1')).toEqual({ ctrl: false, alt: false, shift: false, meta: true });
  });

  it('identifies the bare modifier keys', () => {
    for (const c of ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'AltRight', 'MetaLeft']) {
      expect(isModifierCode(c), c).toBe(true);
    }
    for (const c of ['KeyW', 'Digit1', 'Space']) expect(isModifierCode(c), c).toBe(false);
  });

  it('labels a combo with its modifier prefix', () => {
    expect(keyLabel('Shift+Digit1')).toBe('Shift+1');
    expect(keyLabel('Ctrl+Alt+KeyA')).toBe('Ctrl+Alt+A');
    expect(keyLabel('Ctrl+Minus')).toBe('Ctrl+-');
  });

  it('reserves Escape under any modifier', () => {
    expect(isReservedCode('Shift+Escape')).toBe(true);
    expect(isReservedCode('Ctrl+Escape')).toBe(true);
    expect(isReservedCode('Shift+Digit1')).toBe(false);
  });
});

describe('modifier binding (edge actions)', () => {
  it('binds Shift+1 as an edge action distinct from bare 1', () => {
    const kb = new Keybinds();
    expect(kb.bind('slot1', 0, 'Shift+Digit1')).toBe(true);
    expect(kb.edgeActionForCombo('Shift+Digit1')).toBe('slot1');
    expect(kb.codeAt('slot1', 0)).toBe('Shift+Digit1');
    // bare Digit1 (Attack/slot0) is untouched — the modified chord did not evict it
    expect(kb.edgeActionForCombo('Digit1')).toBe('slot0');
    expect(kb.primaryLabel('slot1')).toBe('Shift+1');
  });

  it('lets the same physical key carry several distinct chords', () => {
    const kb = new Keybinds();
    kb.bind('slot1', 0, 'Shift+Digit1');
    kb.bind('slot2', 0, 'Ctrl+Digit1');
    expect(kb.edgeActionForCombo('Digit1')).toBe('slot0');
    expect(kb.edgeActionForCombo('Shift+Digit1')).toBe('slot1');
    expect(kb.edgeActionForCombo('Ctrl+Digit1')).toBe('slot2');
  });

  it('round-trips a modified binding across instances', () => {
    const a = new Keybinds();
    a.bind('slot1', 0, 'Shift+Digit1');
    const b = new Keybinds();
    expect(b.edgeActionForCombo('Shift+Digit1')).toBe('slot1');
    expect(b.codeAt('slot1', 0)).toBe('Shift+Digit1');
  });

  it('binds Meta+1 (Cmd/Win) as a chord distinct from bare 1', () => {
    const kb = new Keybinds();
    expect(kb.bind('slot1', 0, 'Meta+Digit1')).toBe(true);
    expect(kb.edgeActionForCombo('Meta+Digit1')).toBe('slot1');
    // bare Digit1 (Attack/slot0) is not stolen by the Cmd+1 chord
    expect(kb.edgeActionForCombo('Digit1')).toBe('slot0');
    expect(kb.primaryLabel('slot1')).toBe('Meta+1');
  });
});

describe('modifiers and held (movement) actions', () => {
  it('strips modifiers when binding a held action so the per-frame poll still matches', () => {
    const kb = new Keybinds();
    // try to bind Shift+W to a movement action: the modifier is dropped
    expect(kb.bind('forward', 0, 'Shift+KeyW')).toBe(true);
    expect(kb.codeAt('forward', 0)).toBe('KeyW');
    expect(kb.heldActionForCode('KeyW')).toBe('forward');
  });

  it('labels the stored value (what the rebind toast shows), not the captured chord', () => {
    // hud.ts reads back codeAt(action, index) so the "bound" toast matches the
    // keycap: a held action drops the modifier, an edge action keeps the chord.
    const kb = new Keybinds();
    kb.bind('forward', 0, 'Shift+KeyW'); // held -> stored bare
    expect(keyLabel(kb.codeAt('forward', 0))).toBe('W');
    kb.bind('slot1', 0, 'Shift+Digit1'); // edge -> stored full chord
    expect(keyLabel(kb.codeAt('slot1', 0))).toBe('Shift+1');
  });

  it('matches held actions by physical key, ignoring any held modifier', () => {
    const kb = new Keybinds();
    // default forward = KeyW; the held lookup is modifier-agnostic
    expect(kb.heldActionForCode('KeyW')).toBe('forward');
    expect(kb.heldActionForCode('Space')).toBe('jump');
    // edge keys are not held
    expect(kb.heldActionForCode('Digit1')).toBe(null);
  });
});
