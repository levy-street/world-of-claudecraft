// @vitest-environment happy-dom
// The Key Bindings panel's keyboard-layout row (src/ui/keybind_layout_convert_rows.ts),
// driven through its seam: the expando opens and closes, the target preselects
// from the OS layout, the live count follows the pickers and the movement
// switch, Convert hands the converted snapshot and its layout to the painter's
// apply, the next open starts from that layout, and focus survives the rebuild.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConvertedLayout } from '../src/game/keybinds';
import { setInterfaceMode } from '../src/game/mobile_controls';
import {
  buildKeybindLayoutConvertRow,
  type KeybindLayoutConvertDeps,
  MOVEMENT_ACTION_IDS,
} from '../src/ui/keybind_layout_convert_rows';
import type { KeybindSetup } from '../src/ui/keybind_transfer_core';
import type { KeyboardLayoutId } from '../src/ui/keyboard_layout_convert_core';

const SETUP: KeybindSetup = {
  forward: ['KeyW', 'ArrowUp'],
  map: ['KeyM', null],
  bags: ['KeyB', null],
  slot1: ['Digit1', null],
};

interface Picker {
  el: HTMLElement;
  options: { value: string; label: string }[];
  ariaLabel?: string;
  onChange?: (v: string) => void;
}

function rig(
  detected: KeyboardLayoutId | null,
  opts: {
    setup?: KeybindSetup;
    convertedLayout?: ConvertedLayout | null;
    apply?: (binds: KeybindSetup, note: string, layout: ConvertedLayout) => void;
  } = {},
) {
  document.body.innerHTML = '<div id="body"></div>';
  const host = document.getElementById('body') as HTMLElement;
  const live = { setup: structuredClone(opts.setup ?? SETUP) };
  const dropdowns: Picker[] = [];
  const applied: { binds: KeybindSetup; note: string; layout: ConvertedLayout }[] = [];
  let detectCalls = 0;
  let resolveDetect: (id: KeyboardLayoutId | null) => void = () => {};
  const deps: KeybindLayoutConvertDeps = {
    keybinds: () => ({
      snapshot: () => structuredClone(live.setup),
      convertedLayout: () => opts.convertedLayout ?? null,
    }),
    buildDropdown: (options, current, onChange, _placeholder, a11y) => {
      const el = document.createElement('div');
      el.dataset.value = current;
      el.innerHTML = '<button class="ui-dd-btn"></button>';
      dropdowns.push({ el, options, ariaLabel: a11y?.ariaLabel, onChange });
      return el;
    },
    setDropdownValue: (root, value) => {
      root.dataset.value = value;
    },
    detectLayout: () => {
      detectCalls++;
      return new Promise((resolve) => {
        resolveDetect = resolve;
      });
    },
  };
  buildKeybindLayoutConvertRow(
    host,
    deps,
    opts.apply ?? ((binds, note, layout) => applied.push({ binds, note, layout })),
  );
  const open = host.querySelector<HTMLButtonElement>('.kb-layout .set-toggle')!;
  const pane = host.querySelector<HTMLElement>('.kb-layout-pane')!;
  const status = pane.querySelector<HTMLElement>('[role="status"]')!;
  const apply = pane.querySelector<HTMLButtonElement>('.ui-btn--gold')!;
  const keep = pane.querySelector<HTMLButtonElement>('.ui-btn--plate')!;
  return {
    host,
    live,
    open,
    pane,
    status,
    apply,
    keep,
    dropdowns,
    applied,
    detectCalls: () => detectCalls,
    detect: async () => {
      resolveDetect(detected);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('buildKeybindLayoutConvertRow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    setInterfaceMode('auto');
  });

  it('pins only the six move and turn actions, never every held action', () => {
    expect([...MOVEMENT_ACTION_IDS].sort()).toEqual([
      'back',
      'forward',
      'strafeLeft',
      'strafeRight',
      'turnLeft',
      'turnRight',
    ]);
  });

  it('offers every layout in both pickers, each named by its row', () => {
    const r = rig(null);
    expect(r.dropdowns).toHaveLength(2);
    for (const picker of r.dropdowns) {
      expect(picker.options.map((o) => o.value)).toEqual([
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
      expect(picker.options.map((o) => o.label)).toContain('QWERTY (Swedish, Finnish)');
      expect(picker.el.querySelector('.ui-dd-btn')?.classList.contains('ui-btn')).toBe(true);
    }
    expect(r.dropdowns.map((d) => d.ariaLabel)).toEqual(['Hotkeys made for', 'Convert to']);
  });

  it('starts closed, opens with the target preselected from the OS layout, and closes again', async () => {
    const r = rig('azerty-fr');
    expect(r.pane.hidden).toBe(true);
    expect(r.open.getAttribute('aria-expanded')).toBe('false');
    r.open.click();
    expect(r.pane.hidden).toBe(false);
    expect(r.open.getAttribute('aria-expanded')).toBe('true');
    // Same layout on both sides until detection lands: nothing to convert.
    expect(r.status.textContent).toBe('No hotkeys change between these layouts.');
    expect(r.apply.disabled).toBe(true);
    await r.detect();
    expect(r.dropdowns[1].el.dataset.value).toBe('azerty-fr');
    // Only the map moves (KeyM -> Semicolon); movement is kept, digits stay.
    expect(r.status.textContent).toBe('Hotkeys that will move: 1');
    expect(r.apply.disabled).toBe(false);
    // Closing runs no second detection.
    r.open.click();
    expect(r.pane.hidden).toBe(true);
    expect(r.open.getAttribute('aria-expanded')).toBe('false');
    expect(r.detectCalls()).toBe(1);
  });

  it('counts the movement keys once they are no longer kept in place, and applies', async () => {
    const r = rig('azerty-fr');
    r.open.click();
    await r.detect();
    expect(r.keep.getAttribute('aria-pressed')).toBe('true');
    r.keep.click();
    expect(r.keep.getAttribute('aria-pressed')).toBe('false');
    expect(r.status.textContent).toBe('Hotkeys that will move: 2');
    r.apply.click();
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].binds.forward).toEqual(['KeyZ', 'ArrowUp']);
    expect(r.applied[0].binds.map).toEqual(['Semicolon', null]);
    expect(r.applied[0].binds.slot1).toEqual(['Digit1', null]);
    expect(r.applied[0].note).toBe('Hotkeys converted from QWERTY (US) to AZERTY (French).');
    expect(r.applied[0].layout).toEqual({ id: 'azerty-fr', keptMovement: false });
  });

  it('converts the Emote Wheel and its Shift layer while movement stays in place', async () => {
    const r = rig('dvorak', {
      setup: {
        forward: ['KeyW', null],
        emoteWheel: ['KeyX', null],
        reliquary: ['Shift+KeyX', null],
      },
    });
    r.open.click();
    await r.detect();
    r.apply.click();
    expect(r.applied[0].binds.forward).toEqual(['KeyW', null]);
    expect(r.applied[0].binds.emoteWheel).toEqual(['KeyB', null]);
    expect(r.applied[0].binds.reliquary).toEqual(['Shift+KeyB', null]);
  });

  it('converts from the layout picked as "made for"', async () => {
    const r = rig('qwerty-us', { setup: { map: ['Semicolon', null] } });
    r.open.click();
    await r.detect();
    r.dropdowns[0].onChange?.('azerty-fr');
    expect(r.status.textContent).toBe('Hotkeys that will move: 1');
    r.apply.click();
    expect(r.applied[0].binds.map).toEqual(['KeyM', null]);
    expect(r.applied[0].note).toBe('Hotkeys converted from AZERTY (French) to QWERTY (US).');
    expect(r.applied[0].layout).toEqual({ id: 'qwerty-us', keptMovement: true });
  });

  it('keeps a target the player already picked when detection lands late', async () => {
    const r = rig('azerty-fr');
    r.open.click();
    r.dropdowns[1].onChange?.('qwertz-de');
    await r.detect();
    // The late detection never overwrites the player's own pick.
    expect(r.dropdowns[1].el.dataset.value).toBe('qwerty-us');
    // QWERTZ moves no bound letter here (M and B print the same).
    expect(r.status.textContent).toBe('No hotkeys change between these layouts.');
    expect(r.apply.disabled).toBe(true);
  });

  it('ignores an unknown picker value', async () => {
    const r = rig(null);
    r.open.click();
    await r.detect();
    r.dropdowns[1].onChange?.('dvorak');
    // Only Bags moves under Dvorak (M prints m on the same key).
    const toDvorak = 'Hotkeys that will move: 1';
    expect(r.status.textContent).toBe(toDvorak);
    r.dropdowns[1].onChange?.('not-a-layout');
    expect(r.status.textContent, 'the target stays Dvorak').toBe(toDvorak);
    expect(r.apply.disabled).toBe(false);
    r.dropdowns[0].onChange?.('not-a-layout');
    expect(r.status.textContent, 'and the source stays QWERTY (US)').toBe(toDvorak);
  });

  it('applies nothing when the live setup stopped moving after the count was shown', async () => {
    const r = rig('azerty-fr');
    r.open.click();
    await r.detect();
    expect(r.apply.disabled).toBe(false);
    r.live.setup = { slot1: ['Digit1', null] };
    r.apply.click();
    expect(r.applied).toHaveLength(0);
  });

  it('names the movement switch by its row, not just On / Off', () => {
    const r = rig(null);
    expect(r.keep.getAttribute('aria-label')).toBe('Keep movement keys in place');
    r.keep.click();
    expect(r.keep.getAttribute('aria-label')).toBe('Keep movement keys in place');
  });

  it('starts "made for" on QWERTY (US) when the recorded layout is not a listed one', () => {
    const r = rig(null, { convertedLayout: { id: 'bogus', keptMovement: true } });
    expect(r.dropdowns[0].el.dataset.value).toBe('qwerty-us');
    // ...and does not lock the movement switch for a record it cannot use.
    expect(r.keep.disabled).toBe(false);
    const s = rig(null, { convertedLayout: { id: 'colemak', keptMovement: false } });
    expect(s.dropdowns[0].el.dataset.value).toBe('colemak');
    expect(s.keep.disabled).toBe(false);
  });

  it('locks movement in place when the last conversion kept it, so it is never scrambled', async () => {
    // Converted US -> AZERTY with movement kept: forward is still on KeyW,
    // its US position, while the record says AZERTY.
    const r = rig('qwerty-us', {
      setup: { forward: ['KeyW', null], map: ['Semicolon', null] },
      convertedLayout: { id: 'azerty-fr', keptMovement: true },
    });
    expect(r.dropdowns[0].el.dataset.value).toBe('azerty-fr');
    expect(r.keep.disabled).toBe(true);
    expect(r.keep.getAttribute('aria-pressed')).toBe('true');
    expect(r.pane.textContent).toContain(
      'Movement keys stayed in place last time, so they stay in place again.',
    );
    r.keep.click();
    expect(r.keep.getAttribute('aria-pressed'), 'a disabled switch ignores the press').toBe('true');
    r.open.click();
    await r.detect();
    r.apply.click();
    // Converting back to US moves the map home and leaves forward where it is
    // (converting it as AZERTY would have sent it to KeyZ).
    expect(r.applied[0].binds.map).toEqual(['KeyM', null]);
    expect(r.applied[0].binds.forward).toEqual(['KeyW', null]);
    expect(r.applied[0].layout).toEqual({ id: 'qwerty-us', keptMovement: true });
  });

  it('leaves the switch free when the last conversion moved movement too', () => {
    const r = rig(null, { convertedLayout: { id: 'azerty-fr', keptMovement: false } });
    expect(r.keep.disabled).toBe(false);
    expect(r.pane.textContent).not.toContain('Movement keys stayed in place last time');
  });

  it('never re-converts: the next open starts from the layout just converted to', async () => {
    // A painter-shaped host: apply swaps the live map and rebuilds the row,
    // exactly as OptionsWindow.applyKeybindSetup re-renders the panel.
    document.body.innerHTML = '<div id="body"></div>';
    const host = document.getElementById('body') as HTMLElement;
    let live = structuredClone(SETUP);
    let liveLayout: ConvertedLayout | null = null;
    let froms: HTMLElement[] = [];
    const deps: KeybindLayoutConvertDeps = {
      keybinds: () => ({
        snapshot: () => structuredClone(live),
        convertedLayout: () => liveLayout,
      }),
      buildDropdown: (_o, current) => {
        const el = document.createElement('div');
        el.dataset.value = current;
        froms.push(el);
        return el;
      },
      setDropdownValue: (root, value) => {
        root.dataset.value = value;
      },
      detectLayout: async () => 'azerty-fr',
    };
    const build = () => {
      host.replaceChildren();
      froms = [];
      buildKeybindLayoutConvertRow(host, deps, (binds, _note, layout) => {
        live = binds;
        liveLayout = layout;
        build();
      });
    };
    build();
    const opener = () => host.querySelector<HTMLButtonElement>('.kb-layout .set-toggle')!;
    const applyBtn = () => host.querySelector<HTMLButtonElement>('.ui-btn--gold')!;
    opener().click();
    await Promise.resolve();
    await Promise.resolve();
    applyBtn().click();
    expect(live.map).toEqual(['Semicolon', null]);
    // The rebuild handed focus to the new opener instead of dropping it.
    expect(document.activeElement).toBe(opener());
    // Reopened: "made for" now starts on AZERTY, and so does the target, so
    // nothing moves a second time.
    expect(froms[0].dataset.value).toBe('azerty-fr');
    opener().click();
    await Promise.resolve();
    await Promise.resolve();
    expect(applyBtn().disabled).toBe(true);
    // A Reset or an imported code clears the record (Keybinds, pinned in
    // tests/keybinds.test.ts): the row is back to QWERTY (US).
    liveLayout = null;
    build();
    expect(froms[0].dataset.value).toBe('qwerty-us');
  });

  it('leaves no focus hand-off armed after an apply that did not rebuild, or threw', async () => {
    // A later build of the row (a panel repaint for something else) must not
    // pull focus off whatever the player is in.
    const laterBuildKeepsFocus = () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      buildKeybindLayoutConvertRow(
        host,
        {
          keybinds: () => ({ snapshot: () => ({}), convertedLayout: () => null }),
          buildDropdown: () => document.createElement('div'),
          setDropdownValue: () => {},
          detectLayout: async () => null,
        },
        () => {},
      );
      return document.activeElement === input;
    };
    // Apply without a rebuild.
    const r = rig('azerty-fr');
    r.open.click();
    await r.detect();
    r.apply.click();
    expect(r.applied).toHaveLength(1);
    expect(laterBuildKeepsFocus()).toBe(true);
    // Apply that throws.
    const t = rig('azerty-fr', {
      apply: () => {
        throw new Error('storage full');
      },
    });
    t.open.click();
    await t.detect();
    try {
      t.apply.click();
    } catch {
      /* the throw itself is the painter's business */
    }
    expect(laterBuildKeepsFocus()).toBe(true);
  });

  it('builds nothing on the touch interface, which has no keyboard to convert', () => {
    setInterfaceMode('touch');
    document.body.innerHTML = '<div id="body"></div>';
    const host = document.getElementById('body') as HTMLElement;
    // An empty seam: the gate returns before any dep is touched.
    buildKeybindLayoutConvertRow(host, {} as KeybindLayoutConvertDeps, () => {});
    expect(host.querySelector('.kb-layout')).toBeNull();
  });
});
