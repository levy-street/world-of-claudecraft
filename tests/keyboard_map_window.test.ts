// @vitest-environment happy-dom
// The keyboard overview pop-out (src/ui/keyboard_map_window.ts): one
// #keyboard-map-window .window.panel under #ui, open() painting from fresh deps
// on the shared focus trap, close() disposing the board's armed capture and
// releasing the trap, repaint() gated on isOpen, relocalize() rebuilding an
// open window, and the X routing to close().
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: { click: () => {} } }));

import { Keybinds } from '../src/game/keybinds';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { t } from '../src/ui/i18n';
import type { KeyboardMapPaintDeps } from '../src/ui/keyboard_map';
import { KeyboardMapWindow } from '../src/ui/keyboard_map_window';

function rig() {
  localStorage.clear();
  document.body.replaceChildren();
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.appendChild(ui);
  const keybinds = new Keybinds();
  const armed: (((code: string | null) => void) | null)[] = [];
  let depsReads = 0;
  const traps: { root: () => HTMLElement; opener: HTMLElement; released: boolean[] }[] = [];
  const deps = (): KeyboardMapPaintDeps => {
    depsReads++;
    return {
      bindings: () => keybinds.snapshot(),
      actionName: (id) => `name:${id}`,
      actionCategory: () => 'Movement',
      categories: () => [{ id: 'Movement', label: 'Movement' }],
      layer: '',
      onLayerChange: () => {},
      rebind: {
        keybinds: () => keybinds,
        captureKey: (cb) => {
          armed.push(cb);
        },
        confirmDialog: () => {},
        onChanged: () => {},
        assignable: () => [],
        buildDropdown: () => document.createElement('div'),
      },
    };
  };
  const win = new KeyboardMapWindow(deps, {
    openFocusTrap: (root, opener) => {
      const trap = { root, opener, released: [] as boolean[] };
      traps.push(trap);
      const handle: FocusTrapHandle = {
        focusFirst: () => {
          root().querySelector<HTMLElement>('button')?.focus();
        },
        release: (returnFocus = true) => {
          trap.released.push(returnFocus);
        },
        opener: () => opener,
      };
      return handle;
    },
  });
  const root = () => document.querySelector<HTMLElement>('#keyboard-map-window');
  return { win, root, ui, armed, traps, keybinds, depsReads: () => depsReads };
}

describe('KeyboardMapWindow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mints one .window.panel under #ui on first open, labelled by its title, and opens the focus trap', () => {
    const r = rig();
    expect(r.root()).toBeNull();
    r.win.open();
    const root = r.root();
    expect(root).not.toBeNull();
    expect(root?.parentElement).toBe(r.ui);
    expect(root?.classList.contains('window')).toBe(true);
    expect(root?.classList.contains('panel')).toBe(true);
    expect(root?.getAttribute('role')).toBe('dialog');
    expect(root?.getAttribute('aria-labelledby')).toBe('keyboard-map-title');
    expect(root?.querySelector('#keyboard-map-title')?.textContent).toBe(
      t('hudChrome.keyboardMap.title'),
    );
    expect(root?.querySelector('[data-close]')?.getAttribute('aria-label')).toBe(
      t('hudChrome.keyboardMap.close'),
    );
    expect(root?.style.display).toBe('block');
    expect(r.win.isOpen).toBe(true);
    expect(root?.querySelectorAll('button.kbm-key').length).toBeGreaterThan(100);
    expect(r.traps).toHaveLength(1);
    expect(document.activeElement?.closest('#keyboard-map-window')).toBe(root);
    // A second open reuses the one element and repaints from fresh deps.
    r.win.open();
    expect(document.querySelectorAll('#keyboard-map-window')).toHaveLength(1);
    expect(r.depsReads()).toBe(2);
    expect(r.traps).toHaveLength(2);
    expect(r.traps[0].released).toEqual([false]); // replaced without a focus move
  });

  it('close() disarms a capture a clicked key left armed and releases the trap with focus return', () => {
    const r = rig();
    r.win.open();
    r.root()?.querySelector<HTMLButtonElement>('[data-code="KeyW"]')?.click();
    expect(r.armed.at(-1)).not.toBeNull();
    r.win.close();
    expect(r.armed.at(-1)).toBeNull();
    expect(r.root()?.style.display).toBe('none');
    expect(r.win.isOpen).toBe(false);
    expect(r.traps[0].released).toEqual([true]);
    // Closing again is a no-op, not a second release.
    r.win.close();
    expect(r.traps[0].released).toEqual([true]);
  });

  it('the X routes to close()', () => {
    const r = rig();
    r.win.open();
    r.root()?.querySelector<HTMLButtonElement>('[data-close]')?.click();
    expect(r.win.isOpen).toBe(false);
  });

  it('repaint() redraws only while open; relocalize() rebuilds an open window from fresh deps', () => {
    const r = rig();
    r.win.repaint(); // never opened: nothing to paint, nothing minted
    expect(r.root()).toBeNull();
    r.win.open();
    const before = r.root()?.querySelector('[data-code="KeyW"] .kbm-action')?.textContent;
    expect(before).toBe('name:forward');
    // A rebind made elsewhere shows up on repaint.
    r.keybinds.bind('slot3', 0, 'KeyW');
    r.win.repaint();
    expect(r.root()?.querySelector('[data-code="KeyW"] .kbm-action')?.textContent).toBe(
      'name:slot3',
    );
    r.win.close();
    const reads = r.depsReads();
    r.win.relocalize(); // closed: no rebuild
    expect(r.depsReads()).toBe(reads);
    r.win.open();
    r.win.relocalize();
    expect(r.depsReads()).toBe(reads + 2);
    expect(r.win.isOpen).toBe(true);
  });
});
