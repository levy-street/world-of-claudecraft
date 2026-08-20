import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CROSS_HOTBAR_LAYER_BUTTONS } from '../src/game/cross_hotbar';
import { CrossHotbarBindings } from '../src/game/cross_hotbar_bindings';
import {
  type CrossHotbarHoldInfo,
  createCrossHotbar,
  crossHotbarButtonLabels,
  crossHotbarHold,
  crossHotbarResting,
} from '../src/game/cross_hotbar_wiring';

const PAD_MODE_CLASS = 'xhb-mode';
// Both seams take the character scope, so every case here names one.
const SCOPE = 'char:test';

// minimal localStorage + body stubs (the test env is plain node, no DOM)
function installGlobals(): Set<string> {
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
  const classes = new Set<string>();
  (globalThis as any).document = {
    body: {
      classList: {
        toggle: (name: string, on: boolean) => {
          if (on) classes.add(name);
          else classes.delete(name);
        },
      },
    },
  };
  return classes;
}

let bodyClasses: Set<string>;
beforeEach(() => {
  bodyClasses = installGlobals();
});

function fakePad(connected: boolean, kind = 'xbox' as const) {
  return {
    isConnected: () => connected,
    getKind: () => kind,
    setCrossHotbar: vi.fn(),
    setCrossHotbarExpand: vi.fn(),
  };
}

function fakeHost(bar: CrossHotbarHoldInfo['slots'] = [], extras: string[] = []) {
  return {
    setCrossHotbar: vi.fn<(hold: CrossHotbarHoldInfo | null) => void>(),
    refreshControllerLabels: vi.fn(),
    crossHotbarEdit: () => null,
    crossHotbarSeed: () => ({ bar, extras }),
  };
}

describe('crossHotbarButtonLabels', () => {
  it('names every cell for the connected pad brand', () => {
    const xbox = crossHotbarButtonLabels('xbox');
    expect(xbox).toHaveLength(CROSS_HOTBAR_LAYER_BUTTONS.length * 2);
    // d-pad diamond then the face diamond, top/left/right/bottom each.
    expect(xbox.slice(4, 8)).toEqual(['Y', 'X', 'B', 'A']);
  });

  it('names all sixteen cells: the same eight buttons on each half', () => {
    const labels = crossHotbarButtonLabels('xbox');
    expect(labels).toHaveLength(16);
    expect(labels.slice(0, 8)).toEqual(labels.slice(8));
  });

  it('gives the d-pad four ONE glyph, which the overlay turns four ways', () => {
    // The options panel wants the full "D-pad up"; the on-screen cell already SITS
    // in the position it names, so a bare mark is what belongs under it.
    // All four identical on purpose: no font draws its four arrows (or its four
    // triangles) to the same size, so direction is a rotation the overlay applies
    // rather than four different characters.
    expect(crossHotbarButtonLabels('xbox').slice(0, 4)).toEqual([
      '\u25B2',
      '\u25B2',
      '\u25B2',
      '\u25B2',
    ]);
    // Brand-independent: the d-pad is identical on every pad.
    expect(crossHotbarButtonLabels('playstation').slice(0, 4)).toEqual(
      crossHotbarButtonLabels('nintendo').slice(0, 4),
    );
  });

  it('follows the brand rather than the position, so a Nintendo pad reads its own', () => {
    // The bottom face button is A on an Xbox pad and B on a Nintendo one; the
    // BINDING is position-indexed either way, so only the glyph may differ.
    expect(crossHotbarButtonLabels('xbox')[7]).toBe('A');
    expect(crossHotbarButtonLabels('nintendo')[7]).toBe('B');
    expect(crossHotbarButtonLabels('playstation')[7]).toBe('Cross');
  });
});

describe('crossHotbarResting', () => {
  it('shows the whole primary set with neither half armed', () => {
    const resting = crossHotbarResting(new CrossHotbarBindings(SCOPE), 'xbox');
    expect(resting.layer).toBeNull();
    expect(resting.expanded).toBe(false);
    // All SIXTEEN cells, empty until the bar is seeded.
    expect(resting.slots).toHaveLength(16);
    expect(resting.buttons).toEqual(crossHotbarButtonLabels('xbox'));
    // Each half says which trigger opens it, in the connected pad's own names.
    expect(resting.triggers).toEqual({ left: 'LT', right: 'RT' });
  });

  it('names the triggers for the connected brand', () => {
    expect(crossHotbarResting(new CrossHotbarBindings(SCOPE), 'playstation').triggers).toEqual({
      left: 'L2',
      right: 'R2',
    });
    expect(crossHotbarResting(new CrossHotbarBindings(SCOPE), 'nintendo').triggers).toEqual({
      left: 'ZL',
      right: 'ZR',
    });
  });
});

describe('crossHotbarHold', () => {
  it('arms a half but still carries the whole set', () => {
    const hold = crossHotbarHold(new CrossHotbarBindings(SCOPE), 'right', 1, 'playstation');
    expect(hold.layer).toBe('right');
    expect(hold.expanded).toBe(true);
    expect(hold.slots).toHaveLength(16);
    expect(hold.buttons[7]).toBe('Cross');
  });

  it('still shows the bar when no trigger is held, just unarmed', () => {
    const hold = crossHotbarHold(new CrossHotbarBindings(SCOPE), null, 0, 'xbox');
    expect(hold.layer).toBeNull();
    expect(hold.slots).toHaveLength(16);
  });
});

describe('pad mode', () => {
  it('takes over the hotbar only when the cross hotbar is on AND a pad is present', () => {
    const host = fakeHost();
    const wiring = createCrossHotbar(() => host, SCOPE);

    wiring.syncPadMode(fakePad(false));
    expect(bodyClasses.has(PAD_MODE_CLASS)).toBe(false);
    // No pad: the desktop rows stay, and the overlay is closed outright.
    expect(host.setCrossHotbar).toHaveBeenLastCalledWith(null);

    wiring.syncPadMode(fakePad(true));
    expect(bodyClasses.has(PAD_MODE_CLASS)).toBe(true);
    // A pad: the bar rests on screen so hiding the desktop rows leaves the player
    // with a hotbar rather than nothing.
    expect(host.setCrossHotbar).toHaveBeenLastCalledWith(expect.objectContaining({ layer: null }));
  });

  it('gives the pad up again when it disconnects', () => {
    const host = fakeHost();
    const wiring = createCrossHotbar(() => host, SCOPE);
    wiring.syncPadMode(fakePad(true));
    wiring.syncPadMode(fakePad(false));
    expect(bodyClasses.has(PAD_MODE_CLASS)).toBe(false);
    expect(host.setCrossHotbar).toHaveBeenLastCalledWith(null);
  });

  it('re-labels the pad on every sync, so a brand swap reaches the glyphs', () => {
    const host = fakeHost();
    createCrossHotbar(() => host, SCOPE).syncPadMode(fakePad(true, 'xbox'));
    expect(host.refreshControllerLabels).toHaveBeenCalled();
  });

  it('hands the hotbar back the moment the setting is switched off', () => {
    const host = fakeHost();
    const wiring = createCrossHotbar(() => host, SCOPE);
    const pad = fakePad(true);
    wiring.syncPadMode(pad);
    expect(bodyClasses.has(PAD_MODE_CLASS)).toBe(true);

    const store = { set: (_k: string, v: never) => v };
    expect(wiring.applySetting(pad, store, 'gamepadCrossHotbar', false)).toBe(true);
    expect(pad.setCrossHotbar).toHaveBeenCalledWith(false);
    // The desktop rows come back WITHOUT waiting for a reconnect.
    expect(bodyClasses.has(PAD_MODE_CLASS)).toBe(false);
    expect(host.setCrossHotbar).toHaveBeenLastCalledWith(null);
  });

  it('seeds the bar from the action bar the first time a pad appears', () => {
    const host = fakeHost([{ type: 'ability', id: 'heroic_strike' }], ['battle_stance']);
    const wiring = createCrossHotbar(() => host, SCOPE);
    wiring.bindings.reset();
    wiring.syncPadMode(fakePad(true));
    const slots = wiring.bindings.setActions(0);
    expect(slots[0]).toEqual({ type: 'ability', id: 'heroic_strike' });
    // the class extra lands in the first free cell, so a stance is reachable
    expect(slots[1]).toEqual({ type: 'ability', id: 'battle_stance' });
  });

  it('does not re-seed over a bar the player has arranged', () => {
    const host = fakeHost([{ type: 'ability', id: 'heroic_strike' }], []);
    const wiring = createCrossHotbar(() => host, SCOPE);
    wiring.bindings.reset();
    wiring.syncPadMode(fakePad(true));
    wiring.bindings.bind(0, 0, { type: 'ability', id: 'mine' });
    wiring.syncPadMode(fakePad(false));
    wiring.syncPadMode(fakePad(true));
    expect(wiring.bindings.setActions(0)[0]).toEqual({ type: 'ability', id: 'mine' });
  });

  it('leaves an unrelated setting alone', () => {
    const wiring = createCrossHotbar(() => fakeHost(), SCOPE);
    const store = { set: (_k: string, v: never) => v };
    expect(wiring.applySetting(fakePad(true), store, 'gamepadInvertY', true)).toBe(false);
  });
});

describe('onHold', () => {
  it('rests rather than hiding when the trigger is released', () => {
    const host = fakeHost();
    const wiring = createCrossHotbar(() => host, SCOPE);
    wiring.onHold('left', 0, 'xbox');
    expect(host.setCrossHotbar).toHaveBeenLastCalledWith(
      expect.objectContaining({ layer: 'left' }),
    );
    wiring.onHold(null, 0, 'xbox');
    // Releasing must NOT close the bar: in pad mode it is the only hotbar. It just
    // stops arming a half.
    expect(host.setCrossHotbar).toHaveBeenLastCalledWith(expect.objectContaining({ layer: null }));
  });
});

describe('the display preset', () => {
  it('puts exactly one preset class on the body', () => {
    // Each preset is a coherent look, so they are mutually exclusive: leaving two
    // on would blend two designs and neither would be the one the player picked.
    const wiring = createCrossHotbar(() => fakeHost(), SCOPE);
    const pad = fakePad(true);
    const store = { set: (_k: string, v: never) => v };

    expect(wiring.applySetting(pad, store, 'gamepadCrossHotbarDisplay', 1)).toBe(true);
    expect(bodyClasses.has('xhb-compact')).toBe(true);
    expect(bodyClasses.has('xhb-full')).toBe(false);
    expect(bodyClasses.has('xhb-minimal')).toBe(false);

    wiring.applySetting(pad, store, 'gamepadCrossHotbarDisplay', 2);
    expect(bodyClasses.has('xhb-minimal')).toBe(true);
    expect(bodyClasses.has('xhb-compact')).toBe(false);
  });

  it('falls back to full for a value that names no preset', () => {
    // The value is persisted, so it is untrusted: a hand-edited or older setting
    // must land on a real look rather than stripping every class.
    const wiring = createCrossHotbar(() => fakeHost(), SCOPE);
    const pad = fakePad(true);
    const store = { set: (_k: string, v: never) => v };
    wiring.applySetting(pad, store, 'gamepadCrossHotbarDisplay', 99);
    expect(bodyClasses.has('xhb-full')).toBe(true);
  });
});
