// @vitest-environment jsdom
//
// Behavioral guards for the town-focus window painter after it adopts the shared
// window-frame grammar (the pure allocation math is unit-tested in
// town_focus_view.test.ts). These render the real DOM through the frame builder
// and assert: the frame chrome is stamped on an inner mount, the titlebar is a
// drag handle (but the close button is not), the frame is a bounded flex column
// (titlebar then body then footer), the +/- steppers and the footer Save action
// route to the injected deps, and the close control routes to onClose.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { TownFocusView } from '../src/ui/town_focus_view';
import { renderTownFocusWindow, type TownFocusWindowDeps } from '../src/ui/town_focus_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

function view(overrides: Partial<TownFocusView> = {}): TownFocusView {
  return {
    rows: [
      { component: 'hide', points: 2, canIncrease: true, canDecrease: true },
      { component: 'fang', points: 0, canIncrease: true, canDecrease: false },
    ],
    totalSpent: 2,
    budget: 5,
    remaining: 3,
    inTown: true,
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<TownFocusWindowDeps> = {}): TownFocusWindowDeps {
  return { onStep: () => {}, onSave: () => {}, onClose: () => {}, ...overrides };
}

function townEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'town-focus-window';
  el.className = 'window panel';
  return el;
}

describe('renderTownFocusWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an inner mount with titlebar, body, footer, close', () => {
    const el = townEl();
    renderTownFocusWindow(el, view(), fakeDeps());
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('.window-footer')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    expect(el.style.display).toBe('block');
  });

  it('reuses the frame on a second render instead of rebuilding it cold', () => {
    const el = townEl();
    renderTownFocusWindow(el, view(), fakeDeps());
    const firstBody = el.querySelector('.window-body');
    renderTownFocusWindow(el, view(), fakeDeps());
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });

  it('frames a bounded flex column: titlebar then body then footer', () => {
    const el = townEl();
    renderTownFocusWindow(el, view(), fakeDeps());
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    const order = Array.from(frame?.children ?? []).map((c) => (c as HTMLElement).className);
    expect(order).toEqual(['window-titlebar', 'window-body', 'window-footer']);
  });
});

describe('renderTownFocusWindow: move / resize / fit parity', () => {
  it('makes the titlebar a drag handle the Hud recognizes, but never the close button', () => {
    const el = townEl();
    renderTownFocusWindow(el, view(), fakeDeps());
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });

  it('refuses the titlebar drag on the touch HUD', () => {
    const el = townEl();
    renderTownFocusWindow(el, view(), fakeDeps());
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    document.body.classList.add('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(false);
    document.body.classList.remove('mobile-touch');
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
  });
});

describe('renderTownFocusWindow: body content + callbacks', () => {
  it('renders the budget line, hint, and one row per component in the body', () => {
    const el = townEl();
    renderTownFocusWindow(el, view(), fakeDeps());
    const body = el.querySelector<HTMLElement>('.window-body') as HTMLElement;
    expect(body.querySelector('.town-focus-hint')).not.toBeNull();
    expect(body.querySelector('.town-focus-budget')).not.toBeNull();
    expect(body.querySelectorAll('.town-focus-row').length).toBe(2);
  });

  it('shows the not-in-town note and disables Save when out of town', () => {
    const el = townEl();
    renderTownFocusWindow(el, view({ inTown: false }), fakeDeps());
    expect(el.querySelector('.town-focus-not-in-town')).not.toBeNull();
    const save = el.querySelector<HTMLButtonElement>('.window-footer .town-focus-save');
    expect(save?.disabled).toBe(true);
  });

  it('routes the steppers, the footer Save, and the close through the injected deps', () => {
    const el = townEl();
    const onStep = vi.fn();
    const onSave = vi.fn();
    const onClose = vi.fn();
    renderTownFocusWindow(el, view(), fakeDeps({ onStep, onSave, onClose }));
    const steps = el.querySelectorAll<HTMLButtonElement>('.tf-step');
    // Row 0 (hide) has both steppers enabled: [0]=dec, [1]=inc.
    steps[0].click();
    steps[1].click();
    expect(onStep).toHaveBeenNthCalledWith(1, 'hide', -1);
    expect(onStep).toHaveBeenNthCalledWith(2, 'hide', 1);
    el.querySelector<HTMLButtonElement>('.window-footer .town-focus-save')?.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// The town-focus dialog is a full framed window, so hud.ts must wire it into the
// shared FocusManager like every other one (the trap mechanics are unit-tested in
// focus_manager.test.ts): TRAP Tab inside on open, focus-first, and RETURN focus
// to the opener on close (WCAG 2.4.3 / 2.1.2). This guards the I3 fix.
describe('town focus window: hud installs the WCAG focus trap (I3)', () => {
  // cwd-relative (not import.meta.url): the jsdom env makes import.meta.url a
  // non-file URL, so new URL(..., import.meta.url) would not resolve to a path.
  const hud = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8');

  it('opens a focus trap + focus-first on open, releases + returns focus on close', () => {
    const toggle = hud.slice(hud.indexOf('toggleTownFocus(): void {'));
    const toggleBody = toggle.slice(0, toggle.indexOf('\n  private renderTownFocus'));
    expect(toggleBody).toContain("this.focusManager.open({ root: () => $('#town-focus-window') })");
    expect(toggleBody).toContain('this.townFocusTrap.focusFirst();');
    const close = hud.slice(hud.indexOf('closeTownFocus(): void {'));
    const closeBody = close.slice(0, close.indexOf('\n  }'));
    expect(closeBody).toContain('this.townFocusTrap?.release();');
    expect(closeBody).toContain('this.townFocusTrap = null;');
  });
});
