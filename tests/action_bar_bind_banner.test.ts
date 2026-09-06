// @vitest-environment jsdom
//
// The on-bar key-binding banner as a HUD-root element: built by its own module,
// its buttons wired to the caller, and placed against the LIVE primary bar in
// HUD author px (the #ui zoom divided out) so a bar moved with Interface Unlock
// never paints over its own Done / Reset buttons (the stuck-mode bug).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createActionBarBindBanner,
  placeActionBarBindBanner,
} from '../src/ui/hud/action_bar/action_bar_bind_banner';

vi.mock('../src/ui/i18n', () => ({
  t: (key: string, params?: Record<string, string>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}));

function rect(el: HTMLElement, box: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({
      ...box,
      x: box.left,
      y: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => box,
    }) as DOMRect;
}

describe('createActionBarBindBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
  });

  it('builds the banner with the hint, a status line, and Reset + Done wired to the caller', () => {
    const onReset = vi.fn();
    const onDone = vi.fn();
    const banner = createActionBarBindBanner({ onReset, onDone });
    expect(banner.el.id).toBe('actionbar-bind-banner');
    expect(banner.el.getAttribute('role')).toBe('status');
    expect(banner.el.querySelector('.actionbar-bind-hint')?.textContent).toBe(
      'hudChrome.actionBar.bannerHint',
    );
    const buttons = banner.el.querySelectorAll<HTMLButtonElement>('.actionbar-bind-actions button');
    expect([...buttons].map((b) => b.textContent)).toEqual([
      'hudChrome.actionBar.reset',
      'hudChrome.actionBar.done',
    ]);
    buttons[0].click();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    buttons[1].click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('writes the status line and clears it', () => {
    const banner = createActionBarBindBanner({ onReset: () => {}, onDone: () => {} });
    banner.setStatus('bound');
    expect(banner.el.querySelector('.actionbar-bind-status')?.textContent).toBe('bound');
    banner.setStatus('');
    expect(banner.el.querySelector('.actionbar-bind-status')?.textContent).toBe('');
  });

  it('removes itself from the document', () => {
    const banner = createActionBarBindBanner({ onReset: () => {}, onDone: () => {} });
    document.getElementById('ui')?.appendChild(banner.el);
    expect(banner.el.isConnected).toBe(true);
    banner.remove();
    expect(banner.el.isConnected).toBe(false);
  });
});

describe('placeActionBarBindBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"><div id="actionbar"></div></div>';
  });

  it('positions the banner above the live bar in HUD author px, dividing out the UI zoom', () => {
    const ui = document.getElementById('ui') as HTMLElement;
    const bar = document.getElementById('actionbar') as HTMLElement;
    Object.defineProperty(ui, 'clientWidth', { value: 1600 });
    Object.defineProperty(ui, 'clientHeight', { value: 900 });
    // The bar was moved with Interface Unlock: its visual box is zoomed 1.25x.
    rect(bar, { left: 617.5, top: 900, width: 800, height: 82.5 });
    const banner = createActionBarBindBanner({ onReset: () => {}, onDone: () => {} });
    ui.appendChild(banner.el);
    Object.defineProperty(banner.el, 'offsetWidth', { value: 350 });
    Object.defineProperty(banner.el, 'offsetHeight', { value: 100 });
    placeActionBarBindBanner(banner.el, bar, ui, 1.25);
    // Author px: bar left 494, top 720, width 640; banner centred above with the 8px gap.
    expect(banner.el.style.left).toBe('639px');
    expect(banner.el.style.top).toBe('612px');
  });

  it('uses the bottom-centre fallback when the bar is hidden (no box)', () => {
    const ui = document.getElementById('ui') as HTMLElement;
    Object.defineProperty(ui, 'clientWidth', { value: 1600 });
    Object.defineProperty(ui, 'clientHeight', { value: 900 });
    const banner = createActionBarBindBanner({ onReset: () => {}, onDone: () => {} });
    ui.appendChild(banner.el);
    Object.defineProperty(banner.el, 'offsetWidth', { value: 350 });
    Object.defineProperty(banner.el, 'offsetHeight', { value: 100 });
    placeActionBarBindBanner(banner.el, null, ui, 1);
    expect(banner.el.style.left).toBe('625px');
    expect(Number.parseFloat(banner.el.style.top)).toBeLessThan(800);
  });
});
