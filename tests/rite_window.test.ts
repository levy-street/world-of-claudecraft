// @vitest-environment jsdom
//
// Behavioral guards for the Drowned Reliquary Rite difficulty popup after it
// adopts the shared window-frame chrome. Sparse by design: a display-font title
// moment, a blurb + guide, and the Easy/Medium/Hard ante grid in the body (the
// choices are the actions, so there is no footer). The frame owns the dialog (the
// popup had no dialog role before; Hud focus-traps the root and focuses the first
// .lp-ante-btn). These render the real DOM and assert the frame chrome, the ante
// buttons, the titlebar drag handle, and the choose/close callbacks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RITE_INTENSITY_ORDER } from '../src/sim/delves/rite_tuning';
import { RiteWindow, type RiteWindowDeps } from '../src/ui/rite_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

function fakeDeps(overrides: Partial<RiteWindowDeps> = {}): RiteWindowDeps {
  return { onChoose: () => {}, onClose: () => {}, ...overrides };
}

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  el.id = 'delve-rite-panel';
  el.className = 'window panel';
  document.body.appendChild(el);
});
afterEach(() => {
  el.remove();
});

describe('RiteWindow: frame adoption', () => {
  it('stamps the window-frame dialog chrome on an inner mount with titlebar, body, close', () => {
    new RiteWindow(fakeDeps()).render();
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // Sparse by design: the ante choices are the actions, so no footer.
    expect(frame?.querySelector('.window-footer')).toBeNull();
  });

  it('renders the blurb, the ordered guide, and one ante button per intensity', () => {
    new RiteWindow(fakeDeps()).render();
    const body = el.querySelector<HTMLElement>('.window-body') as HTMLElement;
    expect(body.querySelector('.lp-blurb')).not.toBeNull();
    expect(body.querySelector('.rite-guide')).not.toBeNull();
    expect(body.querySelectorAll('.lp-ante-btn[data-rite]').length).toBe(
      RITE_INTENSITY_ORDER.length,
    );
  });

  it('reuses the frame on a second render instead of rebuilding it cold', () => {
    const win = new RiteWindow(fakeDeps());
    win.render();
    const firstBody = el.querySelector('.window-body');
    win.render();
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('RiteWindow: move / resize / fit parity', () => {
  it('is a STATIC dialog: not even its titlebar starts a drag (fix-round ruling)', () => {
    // The rite ante picker is a transient centered popup in the same delve-NPC
    // flow as the quest dialog and the delve board; the maintainer fix round
    // put the whole family in STATIC_DIALOG_WINDOW_IDS (window_drag_handle.ts),
    // superseding the earlier grammar-parity draggability this test pinned.
    new RiteWindow(fakeDeps()).render();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(false);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });
});

describe('RiteWindow: callbacks', () => {
  it('routes an ante pick to onChoose with the picked intensity', () => {
    const onChoose = vi.fn();
    new RiteWindow(fakeDeps({ onChoose })).render();
    const first = el.querySelector<HTMLElement>('.lp-ante-btn[data-rite]') as HTMLElement;
    first.click();
    expect(onChoose).toHaveBeenCalledWith(first.dataset.rite);
    expect(onChoose).toHaveBeenCalledWith(RITE_INTENSITY_ORDER[0]);
  });

  it('routes the close control to the injected onClose dep', () => {
    const onClose = vi.fn();
    new RiteWindow(fakeDeps({ onClose })).render();
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
