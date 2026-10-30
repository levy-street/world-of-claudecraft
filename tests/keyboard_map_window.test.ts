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
  // What each action-bar slot holds (Hud.slotActionName's answer), so a test can
  // drag an ability onto the bar under an open board.
  const slotNames = new Map<string, string>();
  const traps: { root: () => HTMLElement; opener: HTMLElement; released: boolean[] }[] = [];
  const deps = (): KeyboardMapPaintDeps => {
    depsReads++;
    return {
      bindings: () => keybinds.snapshot(),
      actionName: (id) => slotNames.get(id) ?? `name:${id}`,
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
  return { win, root, ui, armed, traps, keybinds, slotNames, depsReads: () => depsReads };
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

describe('KeyboardMapWindow: live refresh (the Hud slow-band poll)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function mutationsDuring(root: HTMLElement, run: () => void): number {
    const observer = new MutationObserver(() => undefined);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    run();
    const count = observer.takeRecords().length;
    observer.disconnect();
    return count;
  }

  /** The cap a slot action is bound to, and its painted action name. */
  function slotCap(r: ReturnType<typeof rig>): { code: string; text: () => string | undefined } {
    r.keybinds.bind('slot3', 0, 'KeyW');
    return {
      code: 'KeyW',
      text: () =>
        r.root()?.querySelector('[data-code="KeyW"] .kbm-action')?.textContent ?? undefined,
    };
  }

  it('repaints a slot cap when an ability is dragged onto the bar while the pop-out is open', () => {
    const r = rig();
    const cap = slotCap(r);
    r.win.open();
    expect(cap.text()).toBe('name:slot3');
    r.slotNames.set('slot3', 'Heroic Strike');
    r.win.refreshIfChanged();
    expect(cap.text()).toBe('Heroic Strike');
  });

  it('does no DOM work on a repeated identical poll, or after repaint() and relocalize()', () => {
    const r = rig();
    slotCap(r);
    r.win.open();
    const root = r.root();
    if (!root) throw new Error('no window');
    expect(mutationsDuring(root, () => r.win.refreshIfChanged())).toBe(0);
    r.keybinds.bind('slot4', 0, 'KeyE');
    r.win.repaint();
    expect(mutationsDuring(root, () => r.win.refreshIfChanged())).toBe(0);
    r.win.relocalize();
    expect(mutationsDuring(root, () => r.win.refreshIfChanged())).toBe(0);
  });

  it('holds the poll while a key capture is armed, then catches up once it clears', () => {
    const r = rig();
    const cap = slotCap(r);
    r.win.open();
    r.root()?.querySelector<HTMLButtonElement>('[data-code="KeyW"]')?.click();
    const capture = r.armed.at(-1);
    expect(capture).toBeTruthy();
    r.slotNames.set('slot3', 'Heroic Strike');
    r.win.refreshIfChanged();
    // The capture survived the poll and the cap still shows the old name.
    expect(r.armed.at(-1)).toBe(capture);
    expect(cap.text()).toBe('name:slot3');
    // The player cancels (Escape fires the capture with null): the next poll catches up.
    capture?.(null);
    r.win.refreshIfChanged();
    expect(cap.text()).toBe('Heroic Strike');
  });

  /** The first letter cap with nothing bound on it (the assign arm's target). */
  function emptyLetterCap(r: ReturnType<typeof rig>): HTMLButtonElement {
    const cap = [...(r.root()?.querySelectorAll<HTMLButtonElement>('.kbm-key[data-code]') ?? [])]
      .filter((cell) => /^Key[A-Z]$/.test(cell.dataset.code ?? ''))
      .find((cell) => !cell.disabled && cell.querySelector('.kbm-action') === null);
    if (!cap) throw new Error('fixture needs an unbound letter cap');
    return cap;
  }

  it('holds the poll while the assign row is shown (no capture armed), then catches up once it closes', () => {
    const r = rig();
    const cap = slotCap(r);
    r.win.open();
    const armedBefore = r.armed.length;
    emptyLetterCap(r).click();
    // The assign arm arms no capture: only the action row holds the board busy.
    expect(r.armed).toHaveLength(armedBefore);
    const actions = () => r.root()?.querySelector<HTMLElement>('.kbm-actions');
    const row = actions();
    expect(row?.hidden).toBe(false);
    expect(row?.childElementCount).toBe(2);
    r.slotNames.set('slot3', 'Heroic Strike');
    r.win.refreshIfChanged();
    // The poll held: the row is still up and the cap still shows the old name.
    expect(actions()).toBe(row);
    expect(actions()?.hidden).toBe(false);
    expect(cap.text()).toBe('name:slot3');
    // Cancel closes the row: the next poll shows the moved name.
    const cancel = row?.querySelector<HTMLButtonElement>('button.btn');
    expect(cancel?.textContent).toBe(t('hudChrome.actionBar.cancel'));
    cancel?.click();
    expect(actions()?.hidden).toBe(true);
    r.win.refreshIfChanged();
    expect(cap.text()).toBe('Heroic Strike');
  });

  it('picks up a bindings-only change (no slot name moved) on the poll', () => {
    const r = rig();
    r.win.open();
    const free = emptyLetterCap(r);
    const code = free.dataset.code ?? '';
    const text = (c: string) =>
      r.root()?.querySelector(`[data-code="${c}"] .kbm-action`)?.textContent ?? undefined;
    expect(text('KeyW')).toBe('name:forward');
    expect(text(code)).toBeUndefined();
    // A rebind made elsewhere (the options panel): forward moves off W.
    expect(r.keybinds.bind('forward', 0, code)).toBe(true);
    r.win.refreshIfChanged();
    expect(text(code)).toBe('name:forward');
    expect(text('KeyW')).not.toBe('name:forward');
  });

  it('keeps focus on the focused cap across a poll repaint', () => {
    const r = rig();
    slotCap(r);
    r.win.open();
    r.root()?.querySelector<HTMLButtonElement>('[data-code="KeyA"]')?.focus();
    r.slotNames.set('slot3', 'Heroic Strike');
    r.win.refreshIfChanged();
    expect(document.activeElement).toBe(r.root()?.querySelector('[data-code="KeyA"]'));
  });

  it('does nothing while closed', () => {
    const r = rig();
    slotCap(r);
    r.win.open();
    r.win.close();
    const root = r.root();
    if (!root) throw new Error('no window');
    r.slotNames.set('slot3', 'Heroic Strike');
    expect(mutationsDuring(root, () => r.win.refreshIfChanged())).toBe(0);
  });
});
